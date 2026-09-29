import { describe, expect, it } from 'vitest';
import { energyCap, intoxicationAllows, rankCandidates, ScoringContext, ScoringWeights } from '../../src/domain/scoring';
import { Task } from '../../src/domain/types';

const W: ScoringWeights = {
  priority: 10, staleness_per_day: 1, staleness_cap: 14, due_3d: 15,
  overdue: 25, momentum_7d: 5, quick_win_low_energy: 8, status_next: 5,
};

function mkTask(p: Partial<Task> = {}): Task {
  return {
    id: p.id ?? 1, project_id: p.project_id ?? null, parent_task_id: null,
    title: p.title ?? 'Задача', description: '', status: p.status ?? 'todo',
    estimated_minutes: p.estimated_minutes ?? null, energy_required: p.energy_required ?? null,
    focus_required: p.focus_required ?? 'normal', danger_level: p.danger_level ?? 'none',
    tags: [], due_at: p.due_at ?? null, recurrence: 'none',
    deferred_until: p.deferred_until ?? null,
    created_at: p.created_at ?? new Date().toISOString(),
    updated_at: new Date().toISOString(), started_at: null, completed_at: null,
    project_status: p.project_status, project_name: p.project_name ?? null,
    project_priority: p.project_priority,
  };
}

function ctx(p: Partial<ScoringContext> = {}): ScoringContext {
  return {
    now: p.now ?? new Date('2026-09-29T19:00:00Z'),
    todayLocal: p.todayLocal ?? '2026-09-29',
    state: p.state ?? null,
    blockedIds: p.blockedIds ?? new Set<number>(),
    snoozed: p.snoozed ?? new Map(),
    momentumProjectIds: p.momentumProjectIds ?? new Set(),
    weights: W,
  };
}

describe('energyCap', () => {
  it('низкая энергия — только лёгкие задачи', () => {
    expect(energyCap(1)).toBe(2);
    expect(energyCap(2)).toBe(2);
    expect(energyCap(4)).toBe(3);
    expect(energyCap(6)).toBe(4);
    expect(energyCap(9)).toBe(5);
    expect(energyCap(null)).toBe(3);
  });
});

describe('intoxicationAllows', () => {
  it('значительное опьянение: только danger=none + focus=low', () => {
    expect(intoxicationAllows(mkTask({ danger_level: 'none', focus_required: 'low' }), 'significant')).toBe(true);
    expect(intoxicationAllows(mkTask({ danger_level: 'none', focus_required: 'normal' }), 'significant')).toBe(false);
    expect(intoxicationAllows(mkTask({ danger_level: 'tools', focus_required: 'low' }), 'significant')).toBe(false);
  });
  it('лёгкое опьянение: без инструмента, фокус low/normal', () => {
    expect(intoxicationAllows(mkTask({ danger_level: 'tools' }), 'mild')).toBe(false);
    expect(intoxicationAllows(mkTask({ danger_level: 'none', focus_required: 'normal' }), 'mild')).toBe(true);
  });
  it('трезв — без ограничений', () => {
    expect(intoxicationAllows(mkTask({ danger_level: 'tools' }), 'none')).toBe(true);
    expect(intoxicationAllows(mkTask({ danger_level: 'heavy' }), null)).toBe(true);
  });
});

describe('rankCandidates — фильтры', () => {
  it('выбрасывает заблокированные и отложенные', () => {
    const tasks = [
      mkTask({ id: 1, title: 'заблокирована' }),
      mkTask({ id: 2, title: 'отложена до завтра', deferred_until: '2026-09-30T00:00:00Z' }),
      mkTask({ id: 3, title: 'ок' }),
    ];
    const r = rankCandidates(tasks, ctx({ blockedIds: new Set([1]) }));
    expect(r.map((x) => x.task.id)).toEqual([3]);
  });

  it('учитывает доступное время', () => {
    const tasks = [mkTask({ id: 1, estimated_minutes: 60 }), mkTask({ id: 2, estimated_minutes: 15 })];
    const r = rankCandidates(tasks, ctx({ state: { id: 1, recorded_at: new Date().toISOString(), energy: 5, mood: null, available_minutes: 30, focus: null, intoxication: null, note: null } }));
    expect(r.map((x) => x.task.id)).toEqual([2]);
  });

  it('учитывает энергию', () => {
    const tasks = [mkTask({ id: 1, energy_required: 4 }), mkTask({ id: 2, energy_required: 2 })];
    const r = rankCandidates(tasks, ctx({ state: { id: 1, recorded_at: new Date().toISOString(), energy: 2, mood: null, available_minutes: null, focus: null, intoxication: null, note: null } }));
    expect(r.map((x) => x.task.id)).toEqual([2]);
  });

  it('пропущенное предложение (снуз) не предлагается до истечения', () => {
    const tasks = [mkTask({ id: 1 })];
    const r = rankCandidates(tasks, ctx({ snoozed: new Map([[1, '2026-09-30T00:00:00Z']]) }));
    expect(r).toHaveLength(0);
  });
});

describe('rankCandidates — скоринг', () => {
  it('просроченный дедлайн бьёт свежую задачу', () => {
    const old = new Date('2026-09-01T00:00:00Z').toISOString();
    const tasks = [
      mkTask({ id: 1, title: 'свежая', created_at: new Date().toISOString() }),
      mkTask({ id: 2, title: 'просроченная коммуналка', created_at: old, due_at: '2026-09-20' }),
    ];
    const r = rankCandidates(tasks, ctx());
    expect(r[0].task.id).toBe(2);
    expect(r[0].reasons).toContain('просрочено');
  });

  it('status=next даёт бонус', () => {
    const tasks = [mkTask({ id: 1, status: 'next' }), mkTask({ id: 2, status: 'todo' })];
    const r = rankCandidates(tasks, ctx());
    expect(r[0].task.id).toBe(1);
    expect(r[0].reasons).toContain('назначено следующим');
  });

  it('тай-брейк: при равном счёте короче — выше', () => {
    const c = new Date('2026-09-29T10:00:00Z').toISOString();
    const tasks = [
      mkTask({ id: 1, title: 'длинная', estimated_minutes: 60, created_at: c }),
      mkTask({ id: 2, title: 'короткая', estimated_minutes: 10, created_at: c }),
    ];
    const r = rankCandidates(tasks, ctx());
    expect(r[0].task.id).toBe(2);
  });
});
