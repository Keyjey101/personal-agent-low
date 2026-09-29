import { Ranked, Task } from './types';
import { LocalParts, localParts, parseHM } from './time';
import { dueDateEnd } from './reminders';

/* ---------- конфигурация ---------- */

export interface ProactiveCfg {
  level: number; // 0..4
  quiet: { start: string; end: string };
  work: { start: string; end: string; days: string[] };
  budget: { max_per_day: number; min_interval_hours: number; max_critical_work_per_day: number };
  backoff: { base_days: number; max_days: number };
  muteDays: number;
  staleProjectDays: number;
}

/* ---------- окна отправки (ТЗ 8.3) ---------- */

export interface SendStats {
  nonCriticalToday: number;
  criticalWorkToday: number;
  lastSentAt: string | null;
}

export interface SendWindowInput {
  now: Date;
  tz: string;
  cfg: ProactiveCfg;
  critical: boolean;
  stats: SendStats;
  sessionActive: boolean;
  lastUserMessageAt: string | null;
}

export type SendDecision = { action: 'send' | 'suppress' | 'queue'; reason?: string };

export function inQuietHours(p: LocalParts, cfg: ProactiveCfg): boolean {
  const start = parseHM(cfg.quiet.start);
  const end = parseHM(cfg.quiet.end);
  return start > end
    ? p.hm >= start || p.hm < end      // 23:00–09:00, через полночь
    : p.hm >= start && p.hm < end;
}

export function inWorkHours(p: LocalParts, cfg: ProactiveCfg): boolean {
  if (!cfg.work.days.includes(p.weekday)) return false;
  return p.hm >= parseHM(cfg.work.start) && p.hm < parseHM(cfg.work.end);
}

export function checkSendWindow(input: SendWindowInput): SendDecision {
  const { now, tz, cfg, critical, stats } = input;
  const p = localParts(now, tz);

  if (input.sessionActive) return { action: 'suppress', reason: 'session' };
  if (input.lastUserMessageAt &&
      now.getTime() - new Date(input.lastUserMessageAt).getTime() < 30 * 60_000) {
    return { action: 'suppress', reason: 'busy' };
  }

  if (inQuietHours(p, cfg)) {
    return critical
      ? { action: 'queue', reason: 'quiet' }
      : { action: 'suppress', reason: 'quiet' };
  }

  if (inWorkHours(p, cfg)) {
    if (!critical) return { action: 'queue', reason: 'work_hours' };
    if (stats.criticalWorkToday >= cfg.budget.max_critical_work_per_day) {
      return { action: 'suppress', reason: 'critical_budget' };
    }
    return { action: 'send' };
  }

  if (!critical) {
    if (stats.nonCriticalToday >= cfg.budget.max_per_day) return { action: 'suppress', reason: 'budget' };
    if (stats.lastSentAt &&
        now.getTime() - new Date(stats.lastSentAt).getTime() < cfg.budget.min_interval_hours * 3_600_000) {
      return { action: 'suppress', reason: 'interval' };
    }
  }
  return { action: 'send' };
}

/* ---------- backoff и муты по темам (ТЗ 8.3.4–8.3.5) ---------- */

export interface TopicState {
  lastSentAt?: string;
  ignoreCount?: number;
  mutedUntil?: string;
  countedIgnoreFor?: string; // lastSentAt, для которого ignore уже посчитан
}

export function backoffDays(ignoreCount: number, cfg: ProactiveCfg): number {
  return Math.min(cfg.backoff.base_days * 2 ** Math.max(0, ignoreCount), cfg.backoff.max_days);
}

export function topicAllowed(state: TopicState | undefined, now: Date, cfg: ProactiveCfg): { allowed: boolean; reason?: string } {
  if (state?.mutedUntil && state.mutedUntil > now.toISOString()) return { allowed: false, reason: 'muted' };
  if (!state?.lastSentAt) return { allowed: true };
  const nextAllowed = new Date(state.lastSentAt).getTime() + backoffDays(state.ignoreCount ?? 0, cfg) * 86_400_000;
  if (now.getTime() < nextAllowed) return { allowed: false, reason: 'backoff' };
  return { allowed: true };
}

export function registerSend(state: TopicState | undefined, now: Date): TopicState {
  return { ...(state ?? {}), lastSentAt: now.toISOString() };
}

/** Пользователь отреагировал на тему — счётчик игноров сбрасывается. */
export function registerReaction(state: TopicState | undefined): TopicState {
  return { ...(state ?? {}), ignoreCount: 0, countedIgnoreFor: undefined };
}

/** Явное «не надо» — мут темы. */
export function registerMute(state: TopicState | undefined, now: Date, cfg: ProactiveCfg): TopicState {
  return { ...(state ?? {}), mutedUntil: new Date(now.getTime() + cfg.muteDays * 86_400_000).toISOString() };
}

/**
 * Отправка висит > 2 часов без единого сообщения пользователя после неё —
 * считаем игнором (один раз на отправку) и растим backoff.
 */
export function registerIgnoreIfStale(state: TopicState | undefined, now: Date, userMessagesAfterLastSend: number): TopicState {
  if (!state?.lastSentAt) return state ?? {};
  if (state.countedIgnoreFor === state.lastSentAt) return state;
  const age = now.getTime() - new Date(state.lastSentAt).getTime();
  if (age > 2 * 3_600_000 && userMessagesAfterLastSend === 0) {
    return { ...state, ignoreCount: (state.ignoreCount ?? 0) + 1, countedIgnoreFor: state.lastSentAt };
  }
  return state;
}

/* ---------- правила уровня 1–2 (ТЗ 8.2) ---------- */

export interface ProactiveCandidate {
  key: string;            // уникальный ключ срабатывания
  topic: string;          // ключ темы для backoff
  critical: boolean;
  minLevel: number;
  hint: string;           // данные для генерации текста
  taskId?: number;
  projectId?: number;
}

export interface RuleInput {
  now: Date;
  tz: string;
  todayLocal: string;
  cfg: ProactiveCfg;
  tasks: Task[];                      // открытые задачи с due_at
  candidates: Ranked[];               // ранжированные действия
  completedToday: number;
  staleProjects: { id: number; name: string; lastCompletedAt: string | null }[];
}

export function evalRules(input: RuleInput): ProactiveCandidate[] {
  const { now, tz, cfg, tasks, candidates, completedToday, staleProjects, todayLocal } = input;
  const p = localParts(now, tz);
  const out: ProactiveCandidate[] = [];

  // 1. deadline_warning: due < 48 ч (уровень 1, критичное)
  for (const t of tasks) {
    if (!t.due_at || t.status === 'done' || t.status === 'cancelled') continue;
    const dueEnd = dueDateEnd(t.due_at, tz);
    const diffH = (dueEnd.getTime() - now.getTime()) / 3_600_000;
    if (diffH <= 48) {
      out.push({
        key: `deadline:${t.id}`, topic: `deadline:${t.id}`, critical: true, minLevel: 1,
        hint: `Дедлайн задачи «${t.title}» — ${t.due_at} (сегодня ${todayLocal}).`,
        taskId: t.id, projectId: t.project_id ?? undefined,
      });
    }
  }

  if (cfg.level >= 2) {
    // 2. evening_window: сразу после рабочих часов, сегодня ничего не сделано
    const endM = parseHM(cfg.work.end);
    const isWorkday = cfg.work.days.includes(p.weekday);
    if (isWorkday && p.hm >= endM && p.hm < endM + 60 && completedToday === 0) {
      const short = candidates.find((c) => (c.task.estimated_minutes ?? 30) <= 40);
      if (short) {
        out.push({
          key: 'evening_window', topic: 'evening', critical: false, minLevel: 2,
          hint: `Вечер, сегодня ещё ничего не сделано. Есть окно. Подходит: «${short.task.title}» (~${short.task.estimated_minutes ?? 30} мин).`,
          taskId: short.task.id, projectId: short.task.project_id ?? undefined,
        });
      }
    }
    // 3. weekend_morning: выходные ~10:00
    if (!isWorkday && p.hm >= 600 && p.hm < 660 && completedToday === 0 && candidates.length) {
      const best = candidates[0];
      out.push({
        key: 'weekend_morning', topic: 'weekend', critical: false, minLevel: 2,
        hint: `Выходной, пока ничего не сделано. Кандидат: «${best.task.title}».`,
        taskId: best.task.id, projectId: best.task.project_id ?? undefined,
      });
    }
    // 4. stale_project: проект без прогресса N дней
    for (const pr of staleProjects) {
      out.push({
        key: `stale:${pr.id}`, topic: `stale:${pr.id}`, critical: false, minLevel: 2,
        hint: `Проект «${pr.name}» без продвижения больше ${cfg.staleProjectDays} дней.`,
        projectId: pr.id,
      });
    }
  }

  return out.filter((c) => cfg.level >= c.minLevel);
}
