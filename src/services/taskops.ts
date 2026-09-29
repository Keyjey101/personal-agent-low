import { Repo, CreateTaskInput } from '../infra/db/repos';
import { Settings } from './settings';
import { Clock } from '../clock';
import { canTransition, nextRecurrenceDue } from '../domain/task';
import { localParts } from '../domain/time';
import { Ranked, Task, TaskStatus, UserState } from '../domain/types';
import { ScoringContext, rankCandidates } from '../domain/scoring';
import { ValidationError } from '../domain/errors';

const STATE_TTL_MS = 12 * 3_600_000;

export class TaskOps {
  constructor(private repo: Repo, private settings: Settings, private clock: Clock) {}

  private now(): string { return this.clock.now().toISOString(); }
  private todayLocal(): string { return localParts(this.clock.now(), this.settings.tz()).dateStr; }

  /* ---------- создание/обновление ---------- */

  createTask(input: CreateTaskInput, source: 'user' | 'agent' = 'agent'): Task {
    const task = this.repo.createTask(input, this.now());
    this.repo.addEvent('TASK_CREATED', { taskId: task.id, projectId: task.project_id, payload: { source } }, this.now());
    return task;
  }

  updateTask(id: number, patch: Partial<Record<string, unknown>>): Task {
    const task = this.repo.getTask(id);
    if (!task) throw new ValidationError(`Задача ${id} не найдена`);
    if (patch.status && !canTransition(task.status, patch.status as TaskStatus)) {
      throw new ValidationError(`Недопустимый переход статуса: ${task.status} → ${patch.status}`);
    }
    const updated = this.repo.updateTask(id, patch, this.now());
    this.repo.addEvent('TASK_UPDATED', { taskId: id, projectId: task.project_id, payload: { patch: Object.keys(patch) } }, this.now());
    return updated!;
  }

  completeTask(id: number, note?: string): { task: Task; newInstance: Task | null } {
    const task = this.repo.getTask(id);
    if (!task) throw new ValidationError(`Задача ${id} не найдена`);
    if (task.status === 'done') throw new ValidationError(`Задача ${id} уже завершена`);
    const now = this.now();
    const updated = this.repo.updateTask(id, { status: 'done', completed_at: now, started_at: task.started_at ?? now }, now)!;
    this.repo.addEvent('TASK_COMPLETED', { taskId: id, projectId: task.project_id, text: note ?? null, payload: {} }, now);

    // рекуррентность: следующий экземпляр
    let newInstance: Task | null = null;
    if (task.recurrence !== 'none') {
      const due = nextRecurrenceDue(task.due_at, task.recurrence, this.todayLocal());
      newInstance = this.repo.createTask({
        project_id: task.project_id, parent_task_id: null, title: task.title,
        description: task.description, status: 'todo',
        estimated_minutes: task.estimated_minutes, energy_required: task.energy_required,
        focus_required: task.focus_required, danger_level: task.danger_level,
        tags: task.tags, due_at: due, recurrence: task.recurrence,
      }, now);
      this.repo.addEvent('TASK_CREATED', {
        taskId: newInstance.id, projectId: task.project_id,
        payload: { recurrence_instance: true, due },
      }, now);
    }

    // родитель завершается, когда все дети done
    if (task.parent_task_id) this.tryCompleteParent(task.parent_task_id);

    return { task: updated, newInstance };
  }

  private tryCompleteParent(parentId: number): void {
    const parent = this.repo.getTask(parentId);
    if (!parent || parent.status === 'done' || parent.status === 'cancelled') return;
    const children = this.repo.childrenOf(parentId);
    if (children.length && children.every((c) => c.status === 'done' || c.status === 'cancelled')) {
      const now = this.now();
      this.repo.updateTask(parentId, { status: 'done', completed_at: now }, now);
      this.repo.addEvent('TASK_COMPLETED', { taskId: parentId, projectId: parent.project_id, payload: { auto: true } }, now);
    }
  }

  cancelTask(id: number, reason?: string): Task {
    const task = this.repo.getTask(id);
    if (!task) throw new ValidationError(`Задача ${id} не найдена`);
    const now = this.now();
    const updated = this.repo.updateTask(id, { status: 'cancelled' }, now)!;
    this.repo.addEvent('TASK_CANCELLED', { taskId: id, projectId: task.project_id, text: reason ?? null, payload: {} }, now);
    return updated;
  }

  splitTask(id: number, subtasks: { title: string; estimated_minutes?: number; energy_required?: number }[]): Task[] {
    const parent = this.repo.getTask(id);
    if (!parent) throw new ValidationError(`Задача ${id} не найдена`);
    if (!subtasks.length) throw new ValidationError('Пустой список подзадач');
    const now = this.now();
    const children = subtasks.map((s, i) => this.repo.createTask({
      project_id: parent.project_id, parent_task_id: id, title: s.title,
      estimated_minutes: s.estimated_minutes ?? null, energy_required: s.energy_required ?? null,
      status: i === 0 ? 'next' : 'todo',
    }, now));
    for (const c of children) {
      this.repo.addEvent('TASK_CREATED', { taskId: c.id, projectId: parent.project_id, payload: { split_from: id } }, now);
    }
    this.repo.addEvent('TASK_SPLIT', { taskId: id, projectId: parent.project_id, payload: { children: children.map((c) => c.id) } }, now);
    return children;
  }

  addDependency(fromId: number, toId: number, relation: 'requires' | 'blocks' | 'related_to' = 'requires'): void {
    const from = this.repo.getTask(fromId);
    const to = this.repo.getTask(toId);
    if (!from || !to) throw new ValidationError('Задача не найдена');
    this.repo.addTaskEdge(fromId, toId, relation, this.now());
    this.repo.addEvent('DEPENDENCY_ADDED', { taskId: fromId, payload: { to: toId, relation } }, this.now());
  }

  /* ---------- состояние пользователя ---------- */

  recordState(s: { energy?: number; mood?: string; available_minutes?: number; focus?: string; intoxication?: string; note?: string }): void {
    this.repo.insertState({
      energy: s.energy ?? null, mood: s.mood ?? null, available_minutes: s.available_minutes ?? null,
      focus: (s.focus as UserState['focus']) ?? null, intoxication: (s.intoxication as UserState['intoxication']) ?? null,
      note: s.note ?? null,
    }, this.now());
    this.repo.addEvent('STATE_RECORDED', { payload: s as Record<string, unknown> }, this.now());
  }

  currentState(): UserState | null {
    const s = this.repo.latestState();
    if (!s) return null;
    return this.clock.now().getTime() - new Date(s.recorded_at).getTime() > STATE_TTL_MS ? null : s;
  }

  /* ---------- предложения ---------- */

  snoozeSuggestion(taskId: number, days = 1): void {
    const until = new Date(this.clock.now().getTime() + days * 86_400_000).toISOString();
    this.settings.setSnooze(taskId, until);
    this.repo.addEvent('SUGGESTION_SNOOZED', { taskId, payload: { until, days } }, this.now());
  }

  rejectSuggestion(taskId: number): void {
    this.repo.addEvent('SUGGESTION_REJECTED', { taskId }, this.now());
  }

  /* ---------- скоринг ---------- */

  scoringContext(): ScoringContext {
    const now = this.clock.now();
    return {
      now,
      todayLocal: localParts(now, this.settings.tz()).dateStr,
      state: this.currentState(),
      blockedIds: this.repo.blockedIds(),
      snoozed: this.settings.snoozes(),
      momentumProjectIds: this.repo.projectIdsCompletedSince(new Date(now.getTime() - 7 * 86_400_000).toISOString()),
      weights: this.settings.scoringWeights(),
    };
  }

  getRanked(): Ranked[] {
    return rankCandidates(this.repo.candidates(), this.scoringContext());
  }

  topAction(excludeIds: number[] = []): Ranked | null {
    return this.getRanked().find((r) => !excludeIds.includes(r.task.id)) ?? null;
  }
}
