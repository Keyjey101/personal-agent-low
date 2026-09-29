import { Clock } from '../clock';
import { WriteLock } from '../infra/db/client';
import { Repo } from '../infra/db/repos';
import { Settings } from './settings';
import { ProactiveEngine } from './proactive/engine';
import { SessionService } from './session';
import { BackupService } from './backup';
import { localParts, todayStartIso } from '../domain/time';
import type { Logger } from 'pino';

const TICK_MS = 30_000;
const BACKUP_AT_HM = 3 * 60 + 30; // 03:30 локального времени

/** Планировщик (ТЗ 9): один тик каждые 30 секунд, без перекрытий. */
export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private backupDoneFor = '';

  constructor(private deps: {
    clock: Clock; repo: Repo; settings: Settings; engine: ProactiveEngine;
    sessions: SessionService; backup: BackupService; lock: WriteLock; log: Logger;
  }) {}

  start(): void {
    this.timer = setInterval(() => { void this.tick(); }, TICK_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.deps.lock.run(async () => {
        await this.deps.engine.tick();
        await this.deps.sessions.expireOverdue();
        await this.dailyJobs();
      });
    } catch (e) {
      this.deps.log.error({ err: (e as Error).stack }, 'scheduler tick failed');
    } finally {
      this.running = false;
    }
  }

  private async dailyJobs(): Promise<void> {
    const { clock, repo, settings } = this.deps;
    const now = clock.now();
    const p = localParts(now, settings.tz());
    if (p.hm < BACKUP_AT_HM) return;
    if (this.backupDoneFor === p.dateStr) return;
    const already = repo.listEvents({ type: 'BACKUP_DONE', since: todayStartIso(now, settings.tz()), limit: 1 });
    if (already.length) { this.backupDoneFor = p.dateStr; return; }
    await this.deps.backup.run();
    this.backupDoneFor = p.dateStr;
  }
}
