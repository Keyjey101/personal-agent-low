import { describe, expect, it } from 'vitest';
import {
  ProactiveCfg, backoffDays, checkSendWindow, evalRules, isProjectStale, projectStaleDays,
  registerIgnoreIfStale, registerMute, registerReaction, registerSend, topicAllowed,
} from '../../src/domain/proactivity';
import { Ranked, Task } from '../../src/domain/types';

const cfg: ProactiveCfg = {
  level: 2,
  quiet: { start: '23:00', end: '09:00' },
  work: { start: '07:00', end: '18:00', days: ['mon', 'tue', 'wed', 'thu', 'fri'] },
  budget: { max_per_day: 2, min_interval_hours: 4, max_critical_work_per_day: 1 },
  backoff: { base_days: 1, max_days: 7 },
  muteDays: 7,
  staleProjectDays: 10,
};

const emptyStats = { nonCriticalToday: 0, criticalWorkToday: 0, lastSentAt: null };
const TUE_NOON = new Date('2026-09-29T09:00:00Z'); // вторник, 12:00 Москвы
const TUE_EVENING = new Date('2026-09-29T15:30:00Z'); // вторник, 18:30 Москвы
const SAT_MORNING = new Date('2026-10-03T07:00:00Z'); // суббота, 10:00 Москвы
const NIGHT = new Date('2026-09-29T21:00:00Z'); // 00:00 Москвы — тихие часы

function mkRanked(title: string, est = 20): Ranked {
  return {
    task: {
      id: 1, project_id: null, parent_task_id: null, title, description: '', status: 'next',
      estimated_minutes: est, energy_required: 2, focus_required: 'normal', danger_level: 'none',
      tags: [], due_at: null, recurrence: 'none', deferred_until: null,
      created_at: new Date().toISOString(), updated_at: '', started_at: null, completed_at: null,
    } as Task,
    score: 10, reasons: [],
  };
}

describe('checkSendWindow', () => {
  it('тихие часы: некритичное подавляется, критичное в очередь', () => {
    expect(checkSendWindow({ now: NIGHT, tz: 'Europe/Moscow', cfg, critical: false, stats: emptyStats, sessionActive: false, lastUserMessageAt: null }).action).toBe('suppress');
    expect(checkSendWindow({ now: NIGHT, tz: 'Europe/Moscow', cfg, critical: true, stats: emptyStats, sessionActive: false, lastUserMessageAt: null }).action).toBe('queue');
  });

  it('рабочие часы: некритичное в очередь до вечера', () => {
    const d = checkSendWindow({ now: TUE_NOON, tz: 'Europe/Moscow', cfg, critical: false, stats: emptyStats, sessionActive: false, lastUserMessageAt: null });
    expect(d.action).toBe('queue');
    expect(d.reason).toBe('work_hours');
  });

  it('рабочие часы: критичное идёт, но не больше лимита в день', () => {
    const d = checkSendWindow({ now: TUE_NOON, tz: 'Europe/Moscow', cfg, critical: true, stats: emptyStats, sessionActive: false, lastUserMessageAt: null });
    expect(d.action).toBe('send');
    const limited = checkSendWindow({ now: TUE_NOON, tz: 'Europe/Moscow', cfg, critical: true, stats: { ...emptyStats, criticalWorkToday: 1 }, sessionActive: false, lastUserMessageAt: null });
    expect(limited.action).toBe('suppress');
    expect(limited.reason).toBe('critical_budget');
  });

  it('вечером: бюджет и минимальный интервал между сообщениями', () => {
    const budget = checkSendWindow({ now: TUE_EVENING, tz: 'Europe/Moscow', cfg, critical: false, stats: { ...emptyStats, nonCriticalToday: 2 }, sessionActive: false, lastUserMessageAt: null });
    expect(budget.action).toBe('suppress');
    const interval = checkSendWindow({ now: TUE_EVENING, tz: 'Europe/Moscow', cfg, critical: false, stats: { ...emptyStats, lastSentAt: new Date(TUE_EVENING.getTime() - 3_600_000).toISOString() }, sessionActive: false, lastUserMessageAt: null });
    expect(interval.reason).toBe('interval');
  });

  it('активная сессия или свежий диалог — не беспокоить', () => {
    const d = checkSendWindow({ now: TUE_EVENING, tz: 'Europe/Moscow', cfg, critical: false, stats: emptyStats, sessionActive: true, lastUserMessageAt: null });
    expect(d.reason).toBe('session');
    const busy = checkSendWindow({ now: TUE_EVENING, tz: 'Europe/Moscow', cfg, critical: false, stats: emptyStats, sessionActive: false, lastUserMessageAt: new Date(TUE_EVENING.getTime() - 10 * 60_000).toISOString() });
    expect(busy.reason).toBe('busy');
  });
});

describe('backoff и муты', () => {
  it('экспоненциальный рост с капой', () => {
    expect(backoffDays(0, cfg)).toBe(1);
    expect(backoffDays(1, cfg)).toBe(2);
    expect(backoffDays(2, cfg)).toBe(4);
    expect(backoffDays(10, cfg)).toBe(7);
  });

  it('после отправки тема недоступна до истечения backoff', () => {
    const now = new Date('2026-09-29T15:30:00Z');
    let st = registerSend(undefined, now);
    expect(topicAllowed(st, new Date(now.getTime() + 3600_000), cfg).allowed).toBe(false);
    expect(topicAllowed(st, new Date(now.getTime() + 25 * 3600_000), cfg).allowed).toBe(true);
  });

  it('мут после «не надо» блокирует на muteDays', () => {
    const now = new Date('2026-09-29T15:30:00Z');
    const st = registerMute({}, now, cfg);
    expect(st.mutedUntil).toBeTruthy();
    expect(topicAllowed(st, new Date(now.getTime() + 6 * 86_400_000), cfg).allowed).toBe(false);
    expect(topicAllowed(st, new Date(now.getTime() + 8 * 86_400_000), cfg).allowed).toBe(true);
  });

  it('игнор без реакции растит счётчик, реакция сбрасывает', () => {
    const sent = new Date('2026-09-28T10:00:00Z');
    let st = registerSend(undefined, sent);
    st = registerIgnoreIfStale(st, new Date('2026-09-28T13:00:00Z'), 0); // 3 часа тишины
    expect(st.ignoreCount).toBe(1);
    st = registerIgnoreIfStale(st, new Date('2026-09-28T14:00:00Z'), 0); // повторно не считаем
    expect(st.ignoreCount).toBe(1);
    st = registerReaction(st);
    expect(st.ignoreCount).toBe(0);
  });
});

describe('stale-проекты', () => {
  const NOW = new Date('2026-10-01T10:00:00Z');
  it('проект без завершений считается от создания, а не «вечно»', () => {
    const fresh = new Date(NOW.getTime() - 2 * 86_400_000).toISOString();
    const old = new Date(NOW.getTime() - 15 * 86_400_000).toISOString();
    expect(isProjectStale(fresh, null, NOW, 10)).toBe(false);   // создан 2 дня назад — не «стоит 10 дней»
    expect(isProjectStale(old, null, NOW, 10)).toBe(true);
    expect(projectStaleDays(old, null, NOW)).toBe(15);
  });
  it('после завершения счётчик обнуляется', () => {
    const created = new Date(NOW.getTime() - 15 * 86_400_000).toISOString();
    const lastDone = new Date(NOW.getTime() - 3 * 86_400_000).toISOString();
    expect(isProjectStale(created, lastDone, NOW, 10)).toBe(false);
  });
});

describe('evalRules', () => {
  const base = {
    now: TUE_EVENING, tz: 'Europe/Moscow', todayLocal: '2026-09-29', cfg,
    tasks: [] as Task[], candidates: [mkRanked('Помыть ванну')], completedToday: 0, staleProjects: [],
  };

  it('вечер буднего дня без свершений → evening_window', () => {
    const out = evalRules(base);
    expect(out.some((c) => c.topic === 'evening')).toBe(true);
  });

  it('если сегодня уже сделано — не предлагает вечер', () => {
    const out = evalRules({ ...base, completedToday: 1 });
    expect(out.some((c) => c.topic === 'evening')).toBe(false);
  });

  it('дедлайн ближе 48 часов → критичный кандидат', () => {
    const tasks = [{
      id: 7, project_id: null, title: 'Оплатить коммуналку', status: 'todo', due_at: '2026-09-30',
    } as unknown as Task];
    const out = evalRules({ ...base, now: TUE_NOON, tasks, completedToday: 1 });
    const dl = out.find((c) => c.topic === 'deadline:7');
    expect(dl).toBeTruthy();
    expect(dl!.critical).toBe(true);
  });

  it('выходной утром → weekend_morning', () => {
    const out = evalRules({ ...base, now: SAT_MORNING, todayLocal: '2026-10-03', completedToday: 0 });
    expect(out.some((c) => c.topic === 'weekend')).toBe(true);
  });

  it('застоявшийся проект → stale', () => {
    const out = evalRules({ ...base, staleProjects: [{ id: 3, name: 'Ремонт кухни', lastCompletedAt: null }] });
    expect(out.some((c) => c.topic === 'stale:3')).toBe(true);
  });

  it('уровень 0 — ничего', () => {
    const out = evalRules({ ...base, cfg: { ...cfg, level: 0 } });
    expect(out.filter((c) => c.minLevel > 0)).toHaveLength(0);
  });
});
