import { Ranked, Task, UserState, Intox } from './types';
import { daysBetween } from './time';

export interface ScoringWeights {
  priority: number; staleness_per_day: number; staleness_cap: number;
  due_3d: number; overdue: number; momentum_7d: number; quick_win_low_energy: number; status_next: number;
}

export interface ScoringContext {
  now: Date;
  todayLocal: string;                 // 'YYYY-MM-DD' в локальной таймзоне
  state: UserState | null;            // актуальность (≤ 12 ч) проверяет вызывающий
  blockedIds: Set<number>;
  snoozed: Map<number, string>;       // taskId -> ISO «до»
  momentumProjectIds: Set<number>;    // проекты с done за последние 7 дней
  momentumCounts?: Map<number, number>; // сколько именно done — градиент движения
  weights: ScoringWeights;
}

/** Верхняя граница energy_required по самоотчёту (ТЗ 6.1.4). */
export function energyCap(energy: number | null | undefined): number {
  if (!energy) return 3;
  if (energy <= 2) return 2;
  if (energy <= 4) return 3;
  if (energy <= 6) return 4;
  return 5;
}

/** Разрешено ли действие по состоянию опьянения (ТЗ 6.1.5). */
export function intoxicationAllows(task: Task, intoxication: Intox | null | undefined): boolean {
  if (intoxication === 'significant') return task.danger_level === 'none' && task.focus_required === 'low';
  if (intoxication === 'mild') return task.danger_level === 'none' && (task.focus_required === 'low' || task.focus_required === 'normal');
  return true;
}

export function passesFilters(task: Task, ctx: ScoringContext): boolean {
  if (task.status !== 'todo' && task.status !== 'next') return false;
  if (ctx.blockedIds.has(task.id)) return false;
  if (task.project_status && task.project_status !== 'active') return false;
  if (task.deferred_until && task.deferred_until > ctx.now.toISOString()) return false;
  const snooze = ctx.snoozed.get(task.id);
  if (snooze && snooze > ctx.now.toISOString()) return false;
  const cap = energyCap(ctx.state?.energy ?? null);
  if ((task.energy_required ?? 3) > cap) return false;
  if (!intoxicationAllows(task, ctx.state?.intoxication ?? null)) return false;
  const avail = ctx.state?.available_minutes;
  if (avail != null && (task.estimated_minutes ?? 30) > avail) return false;
  return true;
}

export function scoreTask(task: Task, ctx: ScoringContext): Ranked {
  const w = ctx.weights;
  const reasons: string[] = [];
  let score = 0;

  // приоритет проекта; у задач без проекта — 3
  const prio = task.project_id ? (task.project_priority ?? 3) : 3;
  if (prio >= 4) reasons.push('приоритетный проект');
  score += w.priority * prio;

  const staleDays = Math.min(w.staleness_per_day * daysBetween(task.created_at, ctx.now), w.staleness_cap);
  score += staleDays;
  if (staleDays >= 3) reasons.push(`ждёт ${Math.floor(staleDays)} дн`);

  if (task.due_at) {
    if (task.due_at < ctx.todayLocal) { score += w.overdue; reasons.push('просрочено'); }
    else if (task.due_at <= plusDays(ctx.todayLocal, 3)) { score += w.due_3d; reasons.push('дедлайн близко'); }
  }

  if (task.project_id && ctx.momentumProjectIds.has(task.project_id)) {
    // градиент: 1 done за неделю — базовый бонус, каждый следующий +50%, максимум ×2
    const n = ctx.momentumCounts?.get(task.project_id) ?? 1;
    const bonus = w.momentum_7d * Math.min(1 + 0.5 * Math.max(0, n - 1), 2);
    score += bonus;
    reasons.push('проект в движении');
  }

  const est = task.estimated_minutes ?? 30;
  if (est <= 15 && (ctx.state?.energy ?? 5) <= 4) { score += w.quick_win_low_energy; reasons.push('быстрая победа'); }

  if (task.status === 'next') { score += w.status_next; reasons.push('назначено следующим'); }

  return { task, score, reasons };
}

function plusDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

export function rankCandidates(tasks: Task[], ctx: ScoringContext): Ranked[] {
  return tasks
    .filter((t) => passesFilters(t, ctx))
    .map((t) => scoreTask(t, ctx))
    .sort((a, b) =>
      b.score - a.score ||
      (a.task.estimated_minutes ?? 999) - (b.task.estimated_minutes ?? 999) ||
      a.task.created_at.localeCompare(b.task.created_at),
    );
}
