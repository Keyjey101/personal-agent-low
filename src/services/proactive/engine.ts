import { Repo } from '../../infra/db/repos';
import { TaskOps } from '../taskops';
import { Settings } from '../settings';
import { LlmClient } from '../../infra/llm/glm';
import { Clock } from '../../clock';
import { localParts, todayStartIso, workWindowIso } from '../../domain/time';
import { evaluateCondition } from '../../domain/reminders';
import { ProactiveCandidate, checkSendWindow, evalRules, registerIgnoreIfStale, registerReaction, registerSend, topicAllowed, isProjectStale, projectStaleDays } from '../../domain/proactivity';
import { PROACTIVE_SYSTEM } from '../agent/prompts';
import type { Logger } from 'pino';

export type Sender = (text: string, proposeTaskId?: number | null) => Promise<void>;

/**
 * Проактивный движок (ТЗ 8): напоминания + правила + бюджеты + backoff.
 * Вызывается планировщиком каждые 30 секунд.
 */
export class ProactiveEngine {
  private queued = new Map<string, ProactiveCandidate>();
  private queueFlushedFor = '';
  private lastSuppressed = new Map<string, { reason: string; at: number }>();

  constructor(private deps: {
    repo: Repo; ops: TaskOps; settings: Settings; llm: LlmClient; clock: Clock; log: Logger; sender: Sender;
  }) {}

  async tick(): Promise<void> {
    await this.tickReminders();
    await this.tickRules();
    this.flushQueue();
  }

  /* ---------- напоминания ---------- */

  private async tickReminders(): Promise<void> {
    const { repo, clock, settings } = this.deps;
    const now = clock.now();
    const nowIso = now.toISOString();
    const tz = settings.tz();
    const cfg = settings.proactiveCfg();
    const todayLocal = localParts(now, tz).dateStr;
    const condCtx = {
      now, tz, todayLocal,
      getTask: (id: number) => repo.getTask(id),
      lastCompletedAtForProject: (id: number) => repo.lastCompletedAtForProject(id),
    };

    for (const r of repo.pendingReminders()) {
      if (r.muted_until && r.muted_until > nowIso) continue;

      let due = false;
      if (r.kind === 'simple') due = !!r.due_at && r.due_at <= nowIso;
      else due = evaluateCondition(r.condition, condCtx);
      if (!due) continue;

      // cooldown для повторяющихся
      if (r.last_fired_at && r.fire_count > 0) {
        const since = now.getTime() - new Date(r.last_fired_at).getTime();
        if (since < r.cooldown_hours * 3_600_000) continue;
      }
      if (r.fire_count >= r.max_fires && r.max_fires > 1) {
        repo.updateReminder(r.id, { status: 'fired' });
        continue;
      }

      const decision = this.sendWindow(r.critical, tz, now);
      if (decision.action === 'suppress') {
        this.logSuppressed(`reminder:${r.id}`, decision.reason!);
        continue;
      }
      if (decision.action === 'queue') continue; // тихие часы — повторим следующим тиком

      await this.send(`⏰ ${r.message_hint}`, `reminder:${r.id}`, r.critical, null);
      const fireCount = r.fire_count + 1;
      repo.updateReminder(r.id, {
        last_fired_at: nowIso,
        fire_count: fireCount,
        status: fireCount >= r.max_fires ? 'fired' : 'pending',
      });
      repo.addEvent('REMINDER_FIRED', { payload: { reminder_id: r.id, hint: r.message_hint } }, nowIso);
      break; // не больше одного срабатывания за тик
    }
  }

  /* ---------- правила ---------- */

  private async tickRules(): Promise<void> {
    const { repo, ops, settings, clock } = this.deps;
    const now = clock.now();
    const tz = settings.tz();
    const cfg = settings.proactiveCfg();
    if (cfg.level < 1) return;

    const p = localParts(now, tz);
    const ranked = ops.getRanked();
    const openTasks = repo.listTasks({ status: ['todo', 'next', 'active', 'waiting'], limit: 500 })
      .filter((t) => t.due_at);
    const completedToday = repo.countTypeSince('TASK_COMPLETED', todayStartIso(now, tz));
    const counts = repo.openCounts();
    const staleProjects: { id: number; name: string; lastCompletedAt: string | null; daysStale: number }[] = [];
    for (const pr of repo.listProjects('active')) {
      if ((counts.get(pr.id) ?? 0) === 0) continue;
      const last = repo.lastCompletedAtForProject(pr.id);
      if (isProjectStale(pr.created_at, last, now, cfg.staleProjectDays)) {
        staleProjects.push({
          id: pr.id, name: pr.name, lastCompletedAt: last,
          daysStale: projectStaleDays(pr.created_at, last, now),
        });
      }
    }

    const cands = evalRules({
      now, tz, todayLocal: p.dateStr, cfg,
      tasks: openTasks, candidates: ranked, completedToday, staleProjects,
    }).sort((a, b) => Number(b.critical) - Number(a.critical));

    const state = settings.proactiveState();
    for (const cand of cands) {
      const topic = cand.topic;
      let st = state[topic];

      // учёт реакции/игнора по прошлой отправке
      if (st?.lastSentAt) {
        const msgsAfter = repo.userMessagesAfter(st.lastSentAt).length;
        st = msgsAfter > 0 ? registerReaction(st) : registerIgnoreIfStale(st, now, msgsAfter);
        if (st !== state[topic]) settings.setProactiveTopic(topic, st);
        state[topic] = st;
      }

      const allowed = topicAllowed(st, now, cfg);
      if (!allowed.allowed) {
        this.logSuppressed(topic, allowed.reason!);
        continue;
      }

      const decision = this.sendWindow(cand.critical, tz, now);
      if (decision.action === 'suppress') {
        this.logSuppressed(topic, decision.reason!);
        continue;
      }
      if (decision.action === 'queue') {
        this.queued.set(topic, cand); // до конца рабочих часов
        continue;
      }

      const text = (await this.deps.llm.shortText(PROACTIVE_SYSTEM, cand.hint))
        ?? `${cand.hint}\nДелаешь?`;
      await this.send(text, topic, cand.critical, cand.taskId ?? null);
      break; // одно проактивное сообщение за тик
    }
  }

  /* ---------- очередь до конца рабочих часов ---------- */

  private flushQueue(): void {
    if (!this.queued.size) return;
    const { settings, clock } = this.deps;
    const now = clock.now();
    const tz = settings.tz();
    const cfg = settings.proactiveCfg();
    const p = localParts(now, tz);
    const workEnd = parseHMint(cfg.work.end);
    if (p.hm < workEnd + 5) return;
    if (this.queueFlushedFor === p.dateStr) return;

    const first = [...this.queued.values()][0];
    const decision = this.sendWindow(first.critical, tz, now);
    if (decision.action !== 'send') return; // подавлено — не чистим, попробуем следующим тиком

    this.queueFlushedFor = p.dateStr;
    this.queued.clear();
    void this.deps.llm.shortText(PROACTIVE_SYSTEM, first.hint)
      .then((text) => this.send(text ?? `${first.hint}\nДелаешь?`, first.topic, first.critical, first.taskId ?? null))
      .catch((e) => this.deps.log.error({ err: (e as Error).message }, 'flushQueue send failed'));
  }

  /* ---------- общие ---------- */

  private sendWindow(critical: boolean, tz: string, now: Date) {
    const { repo, settings } = this.deps;
    const cfg = settings.proactiveCfg();
    const stats = repo.proactiveStats(todayStartIso(now, tz), inWork(now, tz, cfg) ? workWindowIso(now, tz, cfg.work.start, cfg.work.end) : null);
    return checkSendWindow({
      now, tz, cfg, critical,
      stats: {
        nonCriticalToday: stats.nonCriticalToday,
        criticalWorkToday: stats.criticalWorkToday,
        // интервал считаем за 24 часа, а не «с начала дня»: иначе после полуночи лимит обнулялся
        lastSentAt: repo.lastProactiveSentAt(24),
      },
      sessionActive: !!repo.activeSession(),
      lastUserMessageAt: repo.lastUserMessageAt(),
    });
  }

  private async send(text: string, topic: string, critical: boolean, taskId: number | null): Promise<void> {
    const { repo, settings, clock } = this.deps;
    const nowIso = clock.now().toISOString();
    // сначала помечаем тему (защита от ретрая при падении отправки), потом шлём
    settings.setProactiveTopic(topic, registerSend(settings.proactiveState()[topic], clock.now()));
    await this.deps.sender(this.escapeText(text), taskId);
    repo.addEvent('PROACTIVE_SENT', { taskId, payload: { topic, critical, text } }, nowIso);
    this.deps.log.info({ topic, critical }, 'proactive sent');
  }

  /** Тексты генерит модель — экранируем всё, кроме нашей разметки (её здесь нет). */
  private escapeText(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  private logSuppressed(topic: string, reason: string): void {
    const now = Date.now();
    const prev = this.lastSuppressed.get(topic);
    if (prev && prev.reason === reason && now - prev.at < 3_600_000) return;
    this.lastSuppressed.set(topic, { reason, at: now });
    this.deps.repo.addEvent('PROACTIVE_SUPPRESSED', { payload: { topic, reason } }, this.deps.clock.now().toISOString());
  }
}

function parseHMint(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function inWork(now: Date, tz: string, cfg: { work: { start: string; end: string; days: string[] } }): boolean {
  const p = localParts(now, tz);
  if (!cfg.work.days.includes(p.weekday)) return false;
  const start = parseHMint(cfg.work.start);
  const end = parseHMint(cfg.work.end);
  return p.hm >= start && p.hm < end;
}
