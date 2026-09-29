import path from 'node:path';
import { loadConfig } from './config';
import { createLogger } from './logger';
import { openDb, WriteLock } from './infra/db/client';
import { migrate } from './infra/db/migrate';
import { Repo } from './infra/db/repos';
import { Settings } from './services/settings';
import { TaskOps } from './services/taskops';
import { LlmClient } from './infra/llm/glm';
import { AgentLoop } from './services/agent/loop';
import { SessionService } from './services/session';
import { ProactiveEngine } from './services/proactive/engine';
import { BackupService } from './services/backup';
import { Scheduler } from './services/scheduler';
import { TgBot } from './infra/telegram/bot';
import { buildHttpServer } from './infra/http/server';
import { ensureSeed } from './services/seed';
import { systemClock } from './clock';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.DATA_DIR, config.LOG_LEVEL);

  /* ---------- БД ---------- */
  const db = openDb(config.DATA_DIR);
  migrate(db, path.resolve(process.cwd(), 'migrations'));
  const repo = new Repo(db);
  if (ensureSeed(repo)) logger.info('seed applied');

  /* ---------- сервисы ---------- */
  const clock = systemClock;
  const lock = new WriteLock();
  const settings = new Settings(repo);
  const ops = new TaskOps(repo, settings, clock);
  const llm = new LlmClient({
    apiKey: config.GLM_API_KEY, baseUrl: config.GLM_BASE_URL,
    model: config.GLM_MODEL, dailyTokenLimit: config.GLM_DAILY_TOKEN_LIMIT,
  }, logger);

  // бот создаётся первым: сессии/движок шлют сообщения через него
  const bot: TgBot = new TgBot({
    token: config.TELEGRAM_BOT_TOKEN,
    allowedChatId: Number(config.TELEGRAM_ALLOWED_CHAT_ID),
    repo, ops, settings, log: logger,
    getLoop: () => loop,
    getSessions: () => sessions,
  });

  const sessions: SessionService = new SessionService(repo, ops, settings, clock, (text, tid) => bot.sendToUser(text, tid));
  const loop: AgentLoop = new AgentLoop({ llm, repo, ops, settings, sessions, clock, lock, log: logger });
  const engine = new ProactiveEngine({ repo, ops, settings, llm, clock, log: logger, sender: (text, tid) => bot.sendToUser(text, tid) });
  const backup = new BackupService(db, repo, config.DATA_DIR, () => settings.tz(), clock, logger);
  const scheduler = new Scheduler({ clock, repo, settings, engine, sessions, backup, lock, log: logger });

  /* ---------- HTTP ---------- */
  const server = await buildHttpServer({ config, repo, ops, settings, backup, log: logger });
  await server.listen({ port: config.PORT, host: '0.0.0.0' });
  // eslint-disable-next-line no-console
  console.log(`[http] listening on :${config.PORT}`);

  /* ---------- Telegram polling ---------- */
  if (config.TELEGRAM_ALLOWED_CHAT_ID) {
    await bot.start();
  } else {
    logger.warn('TELEGRAM_ALLOWED_CHAT_ID не задан — Telegram отключён');
  }

  scheduler.start();
  // eslint-disable-next-line no-console
  console.log('[dispatcher] up and running');

  /* ---------- graceful shutdown ---------- */
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    // eslint-disable-next-line no-console
    console.log(`[shutdown] ${signal}`);
    scheduler.stop();
    try { await bot.stop(); } catch { /* noop */ }
    try { await server.close(); } catch { /* noop */ }
    try { db.close(); } catch { /* noop */ }
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('fatal:', e);
  process.exit(1);
});
