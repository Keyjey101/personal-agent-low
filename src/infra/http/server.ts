import Fastify, { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import fstatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { verify } from '@node-rs/argon2';
import { Repo, CreateTaskInput } from '../db/repos';
import { TaskOps } from '../../services/taskops';
import { Settings } from '../../services/settings';
import { BackupService } from '../../services/backup';
import { AppConfig } from '../../config';
import { z } from 'zod';
import { localParts, todayStartIso } from '../../domain/time';
import type { Logger } from 'pino';

export interface HttpDeps {
  config: AppConfig;
  repo: Repo;
  ops: TaskOps;
  settings: Settings;
  backup: BackupService;
  log: Logger;
}

const SESSION_TTL_MS = 30 * 24 * 3_600_000;

export async function buildHttpServer(deps: HttpDeps): Promise<FastifyInstance> {
  const { config, repo, ops, settings, backup, log } = deps;
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  await app.register(cookie, { secret: config.SESSION_SECRET });

  /* ---------- простенький rate-limit на логин ---------- */
  const loginAttempts = new Map<string, { n: number; resetAt: number }>();
  function loginAllowed(ip: string): boolean {
    const now = Date.now();
    const a = loginAttempts.get(ip);
    if (!a || a.resetAt < now) { loginAttempts.set(ip, { n: 0, resetAt: now + 15 * 60_000 }); return true; }
    return a.n < 5;
  }

  /* ---------- auth ---------- */

  app.post('/api/auth/login', async (req, reply) => {
    const ip = req.ip;
    const body = z.object({ password: z.string().min(1) }).safeParse(req.body);
    if (!loginAllowed(ip)) return reply.code(429).send({ error: 'Слишком много попыток, подожди 15 минут' });
    if (!body.success) return reply.code(400).send({ error: 'Нужен пароль' });
    const ok = await verify(config.WEB_PASSWORD_HASH, body.data.password).catch(() => false);
    const a = loginAttempts.get(ip)!;
    if (!ok) { a.n++; return reply.code(401).send({ error: 'Неверный пароль' }); }
    a.n = 0;
    reply.setCookie('sid', String(Date.now() + SESSION_TTL_MS), {
      path: '/', httpOnly: true, sameSite: 'lax', signed: true, maxAge: SESSION_TTL_MS / 1000,
    });
    return { ok: true };
  });

  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/api/') || req.url === '/api/auth/login' || req.url === '/healthz') return;
    const raw = req.cookies['sid'];
    if (!raw) return reply.code(401).send({ error: 'unauthorized' });
    const unsigned = app.unsignCookie(raw);
    if (!unsigned.valid) return reply.code(401).send({ error: 'unauthorized' });
    if (Number(unsigned.value) < Date.now()) return reply.code(401).send({ error: 'expired' });
  });

  app.get('/healthz', async () => {
    try { repo.listProjects(); return { ok: true, db: true }; } catch { return { ok: false, db: false }; }
  });

  /* ---------- состояние и действия ---------- */

  app.get('/api/state', async () => {
    const tz = settings.tz();
    const now = new Date();
    return {
      time: localParts(now, tz),
      state: ops.currentState(),
      completed_today: repo.countTypeSince('TASK_COMPLETED', todayStartIso(now, tz)),
      next: ops.getRanked().slice(0, 5).map((r) => ({
        id: r.task.id, title: r.task.title, project: r.task.project_name ?? null,
        est_min: r.task.estimated_minutes ?? null, reasons: r.reasons,
      })),
      session: repo.activeSession(),
      muted_topics: settings.mutedTopics(),
    };
  });

  app.post('/api/state', async (req) => {
    const body = z.object({
      energy: z.number().int().min(1).max(10).optional(),
      mood: z.string().max(100).optional(),
      available_minutes: z.number().int().min(1).max(720).optional(),
      focus: z.enum(['low', 'normal', 'high']).optional(),
      intoxication: z.enum(['none', 'mild', 'significant']).optional(),
      note: z.string().max(300).optional(),
    }).safeParse(req.body);
    if (!body.success) return { error: body.error.issues[0].message };
    ops.recordState(body.data);
    return { ok: true };
  });

  /* ---------- проекты ---------- */

  app.get('/api/projects', async (req) => {
    const q = req.query as { status?: any };
    const counts = repo.openCounts();
    return repo.listProjects(q.status).map((p) => ({ ...p, open_tasks: counts.get(p.id) ?? 0 }));
  });

  app.post('/api/projects', async (req) => {
    const body = z.object({
      name: z.string().min(1), description: z.string().optional(),
      area: z.string().default('other'), priority: z.number().int().min(1).max(5).optional(),
    }).safeParse(req.body);
    if (!body.success) return { error: body.error.issues[0].message };
    return repo.createProject(body.data, new Date().toISOString());
  });

  app.get('/api/projects/:id', async (req, reply) => {
    const id = Number((req.params as any).id);
    const p = repo.getProject(id);
    if (!p) return reply.code(404).send({ error: 'не найден' });
    const tasks = repo.listTasks({ projectId: id });
    const blocked = repo.blockedIds();
    return { project: p, tasks, blocked_task_ids: [...blocked].filter((i) => tasks.some((t) => t.id === i)) };
  });

  app.patch('/api/projects/:id', async (req) => {
    const id = Number((req.params as any).id);
    const body = z.object({
      name: z.string().min(1).optional(), description: z.string().optional(),
      status: z.enum(['active', 'paused', 'done', 'cancelled']).optional(),
      priority: z.number().int().min(1).max(5).optional(),
    }).safeParse(req.body);
    if (!body.success) return { error: body.error.issues[0].message };
    const p = repo.updateProject(id, body.data, new Date().toISOString());
    if (p) repo.addEvent('PROJECT_UPDATED', { projectId: id, payload: { via: 'web' } }, new Date().toISOString());
    return p ?? { error: 'не найден' };
  });

  /* ---------- задачи ---------- */

  app.get('/api/tasks', async (req) => {
    const q = req.query as { status?: string; project_id?: string; tag?: string; due_before?: string };
    const status = q.status ? (q.status.split(',') as any) : undefined;
    return repo.listTasks({
      status,
      projectId: q.project_id !== undefined ? Number(q.project_id) : undefined,
      tag: q.tag, dueBefore: q.due_before, limit: 500,
    });
  });

  app.post('/api/tasks', async (req) => {
    const body = z.object({
      title: z.string().min(1), project_id: z.number().int().nullable().optional(),
      description: z.string().optional(),
      estimated_minutes: z.number().int().min(1).max(600).nullable().optional(),
      energy_required: z.number().int().min(1).max(5).nullable().optional(),
      focus_required: z.enum(['low', 'normal', 'high']).optional(),
      danger_level: z.enum(['none', 'tools', 'electricity', 'heavy', 'height']).optional(),
      due_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      recurrence: z.enum(['none', 'daily', 'weekly', 'monthly']).optional(),
      tags: z.array(z.string()).optional(),
      status: z.enum(['idea', 'todo', 'next']).optional(),
    }).safeParse(req.body);
    if (!body.success) return { error: body.error.issues[0].message };
    return ops.createTask(body.data as CreateTaskInput, 'user');
  });

  app.patch('/api/tasks/:id', async (req) => {
    const id = Number((req.params as any).id);
    const body = z.object({
      title: z.string().min(1).optional(), description: z.string().optional(),
      status: z.enum(['idea', 'todo', 'next', 'active', 'waiting', 'done', 'cancelled']).optional(),
      estimated_minutes: z.number().int().min(1).max(600).nullable().optional(),
      energy_required: z.number().int().min(1).max(5).nullable().optional(),
      focus_required: z.enum(['low', 'normal', 'high']).optional(),
      danger_level: z.enum(['none', 'tools', 'electricity', 'heavy', 'height']).optional(),
      due_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      recurrence: z.enum(['none', 'daily', 'weekly', 'monthly']).optional(),
      deferred_until: z.string().nullable().optional(),
      tags: z.array(z.string()).optional(),
    }).safeParse(req.body);
    if (!body.success) return { error: body.error.issues[0].message };
    try { return ops.updateTask(id, body.data); } catch (e) { return { error: (e as Error).message }; }
  });

  app.post('/api/tasks/:id/complete', async (req) => {
    const id = Number((req.params as any).id);
    try {
      const r = ops.completeTask(id);
      return { ok: true, task: r.task, recurrence_instance_id: r.newInstance?.id ?? null };
    } catch (e) { return { error: (e as Error).message }; }
  });

  app.post('/api/tasks/:id/snooze', async (req) => {
    const id = Number((req.params as any).id);
    const body = z.object({ days: z.number().int().min(1).max(30).default(1) }).safeParse(req.body ?? {});
    ops.snoozeSuggestion(id, body.success ? body.data.days : 1);
    return { ok: true };
  });

  /* ---------- память / события / граф ---------- */

  app.get('/api/memory', async () => repo.listMemory(false));

  app.post('/api/memory', async (req) => {
    const body = z.object({
      kind: z.enum(['preference', 'fact', 'insight', 'routine', 'pattern']),
      content: z.string().min(3),
    }).safeParse(req.body);
    if (!body.success) return { error: body.error.issues[0].message };
    return repo.insertMemory({ ...body.data, source: 'user_told' }, new Date().toISOString());
  });

  app.patch('/api/memory/:id', async (req) => {
    const id = Number((req.params as any).id);
    const body = z.object({ is_active: z.boolean() }).safeParse(req.body);
    if (!body.success) return { error: 'нужен is_active' };
    repo.setMemoryActive(id, body.data.is_active, new Date().toISOString());
    return { ok: true };
  });

  app.get('/api/events', async (req) => {
    const q = req.query as { type?: string; since?: string; limit?: string };
    return repo.listEvents({
      type: q.type, since: q.since, limit: Math.min(Number(q.limit ?? 100), 500),
    });
  });

  app.get('/api/entities', async () => ({
    entities: repo.listEntities(),
    edges: repo.listEntityEdges(),
  }));

  /* ---------- настройки ---------- */

  const SETTING_KEYS = ['tz', 'proactivity_level', 'quiet_hours', 'work_hours',
    'proactive_budget', 'backoff', 'mute_days_after_explicit_no', 'scoring_weights', 'stale_project_days'];

  app.get('/api/settings', async () => {
    const out: Record<string, unknown> = {};
    for (const k of SETTING_KEYS) out[k] = repo.getJson(k, null);
    return out;
  });

  app.patch('/api/settings', async (req) => {
    const body = z.record(z.any()).safeParse(req.body);
    if (!body.success) return { error: 'некорректный JSON' };
    for (const [k, v] of Object.entries(body.data)) {
      if (!SETTING_KEYS.includes(k)) continue;
      if (k === 'proactivity_level' && (typeof v !== 'number' || v < 0 || v > 4)) continue;
      repo.setJson(k, v);
    }
    return { ok: true };
  });

  /* ---------- бэкапы ---------- */

  app.post('/api/backup', async () => backup.run());

  app.get('/api/backups', async () => backup.list());

  app.get('/api/backups/:file', async (req, reply) => {
    const file = (req.params as any).file as string;
    const p = backup.filePath(file);
    if (!p) return reply.code(404).send({ error: 'нет такого файла' });
    reply.header('content-disposition', `attachment; filename="${file}"`);
    return reply.send(fs.createReadStream(p));
  });

  /* ---------- статика SPA ---------- */

  const webDist = path.resolve(process.cwd(), 'web-dist');
  if (fs.existsSync(webDist)) {
    await app.register(fstatic, { root: webDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
      return reply.sendFile('index.html');
    });
  } else {
    log.warn({ webDist }, 'web-dist не найден — SPA не отдаётся');
    app.get('/', async () => ({ ok: true, note: 'web UI не собран' }));
  }

  return app;
}
