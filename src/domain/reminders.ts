import { ReminderCondition, Task } from './types';
import { tzToUtc } from './time';

export interface ConditionCtx {
  now: Date;
  tz: string;
  todayLocal: string;
  getTask(id: number): Task | undefined;
  lastCompletedAtForProject(projectId: number): string | null;
}

/**
 * Безопасный вычислитель условий напоминаний: белый список типов,
 * никакого динамического кода (ТЗ 8.5).
 */
export function evaluateCondition(cond: ReminderCondition | null, ctx: ConditionCtx): boolean {
  if (!cond) return false;
  switch (cond.type) {
    case 'task_stale': {
      const t = ctx.getTask(cond.task_id);
      if (!t || t.status === 'done' || t.status === 'cancelled') return false;
      const staleMs = ctx.now.getTime() - new Date(t.updated_at).getTime();
      return staleMs >= cond.days * 86_400_000;
    }
    case 'project_no_progress': {
      const last = ctx.lastCompletedAtForProject(cond.project_id);
      if (!last) return true;
      return ctx.now.getTime() - new Date(last).getTime() >= cond.days * 86_400_000;
    }
    case 'due_near': {
      const t = ctx.getTask(cond.task_id);
      if (!t || !t.due_at || t.status === 'done' || t.status === 'cancelled') return false;
      const dueEnd = dueDateEnd(t.due_at, ctx.tz);
      return dueEnd.getTime() - ctx.now.getTime() <= cond.hours * 3_600_000;
    }
    case 'not_done_by': {
      const t = ctx.getTask(cond.task_id);
      if (!t || t.status === 'done' || t.status === 'cancelled') return false;
      return ctx.todayLocal >= cond.by;
    }
    case 'and':
      return cond.conditions.every((c) => evaluateCondition(c, ctx));
    case 'or':
      return cond.conditions.some((c) => evaluateCondition(c, ctx));
    default:
      return false;
  }
}

/** Конец локального дня дедлайна в UTC. */
export function dueDateEnd(dueLocal: string, tz: string): Date {
  const [y, m, d] = dueLocal.split('-').map(Number);
  return tzToUtc(tz, y, m, d, 23, 59);
}
