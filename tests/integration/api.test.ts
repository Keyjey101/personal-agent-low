import { describe, expect, it } from 'vitest';
import { hash } from '@node-rs/argon2';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { buildHttpServer } from '../../src/infra/http/server';
import { Settings } from '../../src/services/settings';
import { TaskOps } from '../../src/services/taskops';
import { BackupService } from '../../src/services/backup';
import { StatsService } from '../../src/services/stats';
import { systemClock } from '../../src/clock';
import { createSilentLogger } from '../../src/logger';
import { makeTestDb } from '../helpers/testdb';
import type { FastifyInstance } from 'fastify';

const PASSWORD = 'test-pass-123';

async function setup(): Promise<{ app: FastifyInstance }> {
  const { db, repo } = makeTestDb();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'disp-'));
  const settings = new Settings(repo);
  const ops = new TaskOps(repo, settings, systemClock);
  const backup = new BackupService(db, repo, tmp, () => 'Europe/Moscow', systemClock, createSilentLogger());
  const stats = new StatsService(repo, settings, systemClock);
  const app = await buildHttpServer({
    config: {
      TELEGRAM_BOT_TOKEN: 'x', TELEGRAM_ALLOWED_CHAT_ID: '', GLM_API_KEY: 'x',
      GLM_BASE_URL: 'http://localhost:1', GLM_MODEL: 'm', GLM_DAILY_TOKEN_LIMIT: 0,
      WEB_PASSWORD_HASH: await hash(PASSWORD, {}), SESSION_SECRET: 'test-secret-test-secret-test',
      TZ: 'Europe/Moscow', DATA_DIR: tmp, PORT: 0, LOG_LEVEL: 'info',
      REFLECTOR_ENABLED: true, REFLECTOR_HOUR: 4, REFLECTOR_MAX_EVENTS: 200,
    },
    repo, ops, settings, backup, stats, log: createSilentLogger(),
  });
  return { app };
}

let cookie = '';

describe('api', () => {
  it('healthz публичный', async () => {
    const { app } = await setup();
    const r = await app.inject({ method: 'GET', url: '/healthz' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, db: true });
  });

  it('без авторизации — 401', async () => {
    const { app } = await setup();
    const r = await app.inject({ method: 'GET', url: '/api/state' });
    expect(r.statusCode).toBe(401);
  });

  it('неверный пароль — 401, верный — cookie и доступ', async () => {
    const { app } = await setup();
    const bad = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'wrong' } });
    expect(bad.statusCode).toBe(401);

    const ok = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: PASSWORD } });
    expect(ok.statusCode).toBe(200);
    const rawCookie = ok.headers['set-cookie'];
    const setCookie = Array.isArray(rawCookie) ? rawCookie : [String(rawCookie)];
    cookie = setCookie.find((c) => c.startsWith('sid='))!.split(';')[0];

    const state = await app.inject({ method: 'GET', url: '/api/state', headers: { cookie } });
    expect(state.statusCode).toBe(200);
    expect(state.json()).toHaveProperty('next');
  });

  it('создание задачи, завершение, рекуррентность', async () => {
    const { app } = await setup();
    const created = await app.inject({
      method: 'POST', url: '/api/tasks', headers: { cookie },
      payload: { title: 'Оплатить коммуналку', due_at: '2026-10-10', recurrence: 'monthly', estimated_minutes: 10 },
    });
    expect(created.statusCode).toBe(200);
    const task = created.json();
    expect(task.id).toBeTruthy();

    const done = await app.inject({ method: 'POST', url: `/api/tasks/${task.id}/complete`, headers: { cookie } });
    expect(done.json()).toMatchObject({ ok: true });
    // рекуррентная задача породила следующий экземпляр
    const list = await app.inject({ method: 'GET', url: '/api/tasks?status=todo', headers: { cookie } });
    const nextInstance = list.json().find((t: any) => t.title === 'Оплатить коммуналку');
    expect(nextInstance.due_at).toBe('2026-11-10');
  });

  it('настройки читаются и патчатся, мусорные ключи игнорируются', async () => {
    const { app } = await setup();
    const before = await app.inject({ method: 'GET', url: '/api/settings', headers: { cookie } });
    expect(before.json().proactivity_level).toBe(2);

    const patch = await app.inject({
      method: 'PATCH', url: '/api/settings', headers: { cookie },
      payload: { proactivity_level: 3, evil_key: 'x' },
    });
    expect(patch.statusCode).toBe(200);
    const after = await app.inject({ method: 'GET', url: '/api/settings', headers: { cookie } });
    expect(after.json().proactivity_level).toBe(3);
    expect(after.json().evil_key).toBeUndefined();
  });

  it('бэкап создаётся и попадает в список', async () => {
    const { app } = await setup();
    const r = await app.inject({ method: 'POST', url: '/api/backup', headers: { cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.json().file).toMatch(/^app-\d{4}-\d{2}-\d{2}\.db\.gz$/);
    const list = await app.inject({ method: 'GET', url: '/api/backups', headers: { cookie } });
    expect(list.json().length).toBeGreaterThanOrEqual(1);
  });

  it('reopen возвращает случайно закрытую задачу (undo)', async () => {
    const { app } = await setup();
    const created = await app.inject({
      method: 'POST', url: '/api/tasks', headers: { cookie },
      payload: { title: 'Почистить пылесос', estimated_minutes: 10 },
    });
    const id = created.json().id;
    await app.inject({ method: 'POST', url: `/api/tasks/${id}/complete`, headers: { cookie } });

    const reopened = await app.inject({ method: 'POST', url: `/api/tasks/${id}/reopen`, headers: { cookie } });
    expect(reopened.statusCode).toBe(200);
    expect(reopened.json().status).toBe('todo');
    expect(reopened.json().completed_at).toBeNull();

    const again = await app.inject({ method: 'POST', url: `/api/tasks/${id}/reopen`, headers: { cookie } });
    expect(again.statusCode).toBe(400); // вернуть можно только done
  });

  it('stats отдаёт метрики выполнения и принятия', async () => {
    const { app } = await setup();
    const created = await app.inject({
      method: 'POST', url: '/api/tasks', headers: { cookie },
      payload: { title: 'Помыть ванну', estimated_minutes: 20 },
    });
    await app.inject({ method: 'POST', url: `/api/tasks/${created.json().id}/complete`, headers: { cookie } });
    await app.inject({ method: 'POST', url: `/api/tasks/${created.json().id}/snooze`, headers: { cookie }, payload: { days: 1 } });

    const stats = await app.inject({ method: 'GET', url: '/api/stats', headers: { cookie } });
    expect(stats.statusCode).toBe(200);
    const body = stats.json();
    expect(body.today.completed).toBeGreaterThanOrEqual(1);
    expect(body.today.snoozed).toBeGreaterThanOrEqual(1);
    expect(body.last14).toHaveLength(14);
    expect(body.last14[13].completed).toBeGreaterThanOrEqual(1); // сегодня — последний элемент
    expect(body.daysWithProgress7).toBeGreaterThanOrEqual(1);
  });
});
