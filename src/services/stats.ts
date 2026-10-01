import { Repo } from '../infra/db/repos';
import { Settings } from './settings';
import { Clock } from '../clock';
import { localParts, todayStartIso } from '../domain/time';

export interface DayStat { date: string; completed: number }
export interface StatsOverview {
  today: { completed: number; proactiveSent: number; rejected: number; snoozed: number };
  last14: DayStat[];
  daysWithProgress7: number;   // из 7: дней с ≥1 завершённой задачей
  completed7: number;
  acceptance7: { sent: number; rejected: number; snoozed: number };
}

/** Метрики «Диспетчера» (ROADMAP §4): выполнение, принятие предложений. */
export class StatsService {
  constructor(private repo: Repo, private settings: Settings, private clock: Clock) {}

  overview(): StatsOverview {
    const now = this.clock.now();
    const tz = this.settings.tz();
    const todayStart = todayStartIso(now, tz);

    const since7 = new Date(now.getTime() - 7 * 86_400_000).toISOString();
    const since14 = new Date(now.getTime() - 14 * 86_400_000).toISOString();

    const completions = this.repo.listEvents({ type: 'TASK_COMPLETED', since: since14, limit: 2000 });
    const byDay = new Map<string, number>();
    for (const e of completions) {
      const d = localParts(new Date(e.ts), tz).dateStr;
      byDay.set(d, (byDay.get(d) ?? 0) + 1);
    }
    const last14: DayStat[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = localParts(new Date(now.getTime() - i * 86_400_000), tz).dateStr;
      last14.push({ date: d, completed: byDay.get(d) ?? 0 });
    }

    const days7 = last14.slice(-7);
    const sent = this.repo.listEvents({ type: 'PROACTIVE_SENT', since: since7, limit: 1000 });

    return {
      today: {
        completed: this.repo.countTypeSince('TASK_COMPLETED', todayStart),
        proactiveSent: this.repo.countTypeSince('PROACTIVE_SENT', todayStart),
        rejected: this.repo.countTypeSince('SUGGESTION_REJECTED', todayStart),
        snoozed: this.repo.countTypeSince('SUGGESTION_SNOOZED', todayStart),
      },
      last14,
      daysWithProgress7: days7.filter((d) => d.completed > 0).length,
      completed7: days7.reduce((s, d) => s + d.completed, 0),
      acceptance7: {
        sent: sent.length,
        rejected: this.repo.countTypeSince('SUGGESTION_REJECTED', since7),
        snoozed: this.repo.countTypeSince('SUGGESTION_SNOOZED', since7),
      },
    };
  }
}
