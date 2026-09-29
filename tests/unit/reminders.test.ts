import { describe, expect, it } from 'vitest';
import { evaluateCondition } from '../../src/domain/reminders';
import { canTransition, nextRecurrenceDue } from '../../src/domain/task';

const NOW = new Date('2026-09-29T19:00:00Z');

function ctx(tasks: Record<number, any> = {}, projectLast: Record<number, string | null> = {}) {
  return {
    now: NOW, tz: 'Europe/Moscow', todayLocal: '2026-09-29',
    getTask: (id: number) => tasks[id],
    lastCompletedAtForProject: (id: number) => projectLast[id] ?? null,
  };
}

describe('evaluateCondition', () => {
  it('task_stale: задача не трогалась N дней', () => {
    const tasks = { 5: { status: 'todo', updated_at: '2026-09-20T00:00:00Z' } };
    expect(evaluateCondition({ type: 'task_stale', task_id: 5, days: 7 }, ctx(tasks))).toBe(true);
    expect(evaluateCondition({ type: 'task_stale', task_id: 5, days: 30 }, ctx(tasks))).toBe(false);
    expect(evaluateCondition({ type: 'task_stale', task_id: 6, days: 1 }, ctx(tasks))).toBe(false);
  });

  it('project_no_progress: нет завершений вообще — true', () => {
    expect(evaluateCondition({ type: 'project_no_progress', project_id: 3, days: 10 }, ctx())).toBe(true);
    const last = '2026-09-15T00:00:00Z';
    expect(evaluateCondition({ type: 'project_no_progress', project_id: 3, days: 10 }, ctx({}, { 3: last }))).toBe(true);
    const recent = '2026-09-28T00:00:00Z';
    expect(evaluateCondition({ type: 'project_no_progress', project_id: 3, days: 10 }, ctx({}, { 3: recent }))).toBe(false);
  });

  it('due_near: дедлайн через сутки', () => {
    const tasks = { 8: { status: 'todo', due_at: '2026-09-30' } };
    expect(evaluateCondition({ type: 'due_near', task_id: 8, hours: 48 }, ctx(tasks))).toBe(true);
    expect(evaluateCondition({ type: 'due_near', task_id: 8, hours: 6 }, ctx(tasks))).toBe(false);
  });

  it('not_done_by: дата прошла, задача открыта', () => {
    const tasks = { 9: { status: 'todo' } };
    expect(evaluateCondition({ type: 'not_done_by', task_id: 9, by: '2026-09-28' }, ctx(tasks))).toBe(true);
    const done = { 9: { status: 'done' } };
    expect(evaluateCondition({ type: 'not_done_by', task_id: 9, by: '2026-09-28' }, ctx(done))).toBe(false);
  });

  it('and/or', () => {
    const tasks = { 5: { status: 'todo', updated_at: '2026-09-20T00:00:00Z' } };
    const stale = { type: 'task_stale', task_id: 5, days: 7 } as const;
    const fresh = { type: 'task_stale', task_id: 5, days: 60 } as const;
    expect(evaluateCondition({ type: 'and', conditions: [stale, fresh] }, ctx(tasks))).toBe(false);
    expect(evaluateCondition({ type: 'or', conditions: [stale, fresh] }, ctx(tasks))).toBe(true);
  });

  it('выполненная задача не триггерит', () => {
    const tasks = { 5: { status: 'done', updated_at: '2026-09-20T00:00:00Z' } };
    expect(evaluateCondition({ type: 'task_stale', task_id: 5, days: 1 }, ctx(tasks))).toBe(false);
  });
});

describe('nextRecurrenceDue', () => {
  it('monthly с клампом к длине месяца', () => {
    expect(nextRecurrenceDue('2026-01-31', 'monthly', '2026-01-05')).toBe('2026-02-28');
    expect(nextRecurrenceDue('2026-09-10', 'monthly', '2026-09-29')).toBe('2026-10-10');
  });
  it('weekly и daily', () => {
    expect(nextRecurrenceDue('2026-09-29', 'weekly', '2026-09-29')).toBe('2026-10-06');
    expect(nextRecurrenceDue('2026-09-29', 'daily', '2026-09-29')).toBe('2026-09-30');
  });
  it('если due в прошлом — ближайшая дата цикла в будущем', () => {
    expect(nextRecurrenceDue('2026-09-01', 'monthly', '2026-09-29')).toBe('2026-10-01');
    expect(nextRecurrenceDue('2026-08-10', 'monthly', '2026-09-29')).toBe('2026-10-10');
  });
});

describe('canTransition', () => {
  it('разрешает разумные переходы', () => {
    expect(canTransition('todo', 'active')).toBe(true);
    expect(canTransition('active', 'done')).toBe(true);
    expect(canTransition('done', 'todo')).toBe(true);
  });
  it('запрещает сомнительные', () => {
    expect(canTransition('idea', 'active')).toBe(false);
    expect(canTransition('done', 'active')).toBe(false);
  });
});
