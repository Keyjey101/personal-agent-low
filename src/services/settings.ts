import { Repo } from '../infra/db/repos';
import { ProactiveCfg, TopicState } from '../domain/proactivity';
import { ScoringWeights } from '../domain/scoring';

const DEFAULT_WEIGHTS: ScoringWeights = {
  priority: 10, staleness_per_day: 1, staleness_cap: 14, due_3d: 15,
  overdue: 25, momentum_7d: 5, quick_win_low_energy: 8, status_next: 5,
};

const DEFAULT_CFG: Omit<ProactiveCfg, 'level' | 'staleProjectDays'> = {
  quiet: { start: '23:00', end: '09:00' },
  work: { start: '07:00', end: '18:00', days: ['mon', 'tue', 'wed', 'thu', 'fri'] },
  budget: { max_per_day: 2, min_interval_hours: 4, max_critical_work_per_day: 1 },
  backoff: { base_days: 1, max_days: 7 },
  muteDays: 7,
};

export class Settings {
  constructor(private repo: Repo) {}

  tz(): string { return this.repo.getJson<string>('tz', 'Europe/Moscow'); }
  setTz(v: string): void { this.repo.setJson('tz', v); }

  proactivityLevel(): number { return this.repo.getJson<number>('proactivity_level', 2); }
  setProactivityLevel(v: number): void {
    if (v < 0 || v > 4) throw new Error('Уровень проактивности — 0..4');
    this.repo.setJson('proactivity_level', v);
  }

  proactiveCfg(): ProactiveCfg {
    return {
      level: this.proactivityLevel(),
      staleProjectDays: this.repo.getJson<number>('stale_project_days', 10),
      ...DEFAULT_CFG,
      ...{
        quiet: this.repo.getJson('quiet_hours', DEFAULT_CFG.quiet),
        work: this.repo.getJson('work_hours', DEFAULT_CFG.work),
        budget: this.repo.getJson('proactive_budget', DEFAULT_CFG.budget),
        backoff: this.repo.getJson('backoff', DEFAULT_CFG.backoff),
      },
      muteDays: this.repo.getJson<number>('mute_days_after_explicit_no', 7),
    };
  }

  scoringWeights(): ScoringWeights {
    return { ...DEFAULT_WEIGHTS, ...this.repo.getJson<Partial<ScoringWeights>>('scoring_weights', {}) };
  }

  /* ---- «Потом» на кнопке: предложение отложено, задача не тронута (ТЗ 22.6) ---- */

  snoozes(): Map<number, string> {
    const raw = this.repo.getJson<Record<string, string>>('suggestion_snooze', {});
    const nowIso = new Date().toISOString();
    const out = new Map<number, string>();
    for (const [k, v] of Object.entries(raw)) {
      if (v > nowIso) out.set(Number(k), v);
    }
    return out;
  }

  setSnooze(taskId: number, untilIso: string): void {
    const raw = this.repo.getJson<Record<string, string>>('suggestion_snooze', {});
    raw[String(taskId)] = untilIso;
    this.repo.setJson('suggestion_snooze', raw);
  }

  /* ---- состояние тем проактивности (backoff / муты) ---- */

  proactiveState(): Record<string, TopicState> {
    return this.repo.getJson<Record<string, TopicState>>('proactive_state', {});
  }

  setProactiveTopic(topic: string, state: TopicState): void {
    const all = this.proactiveState();
    all[topic] = state;
    this.repo.setJson('proactive_state', all);
  }

  mutedTopics(): { topic: string; mutedUntil: string }[] {
    const nowIso = new Date().toISOString();
    return Object.entries(this.proactiveState())
      .filter(([_, s]) => s.mutedUntil && s.mutedUntil > nowIso)
      .map(([topic, s]) => ({ topic, mutedUntil: s.mutedUntil! }));
  }
}
