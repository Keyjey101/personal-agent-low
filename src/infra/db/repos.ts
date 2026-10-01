import type { DB } from './client';
import {
  Area, EventRow, Focus, Danger, MemoryEntry, Project, ProjectStatus, Ranked, Reminder,
  ReminderCondition, Session, Task, TaskStatus, UserState, Recurrence,
} from '../../domain/types';

/* ---------- мапперы строк ---------- */

type Row = Record<string, any>;

function mapTask(r: Row): Task {
  return {
    id: r.id,
    project_id: r.project_id ?? null,
    parent_task_id: r.parent_task_id ?? null,
    title: r.title,
    description: r.description ?? '',
    status: r.status as TaskStatus,
    estimated_minutes: r.estimated_minutes ?? null,
    energy_required: r.energy_required ?? null,
    focus_required: (r.focus_required ?? 'normal') as Focus,
    danger_level: (r.danger_level ?? 'none') as Danger,
    tags: JSON.parse(r.tags || '[]'),
    due_at: r.due_at ?? null,
    recurrence: (r.recurrence ?? 'none') as Recurrence,
    deferred_until: r.deferred_until ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
    started_at: r.started_at ?? null,
    completed_at: r.completed_at ?? null,
    project_status: r.project_status ?? undefined,
    project_name: r.project_name ?? null,
    project_priority: r.project_priority ?? undefined,
  };
}

function mapProject(r: Row): Project {
  return {
    id: r.id, name: r.name, description: r.description ?? '',
    area: r.area as Area, status: r.status as ProjectStatus,
    priority: r.priority, created_at: r.created_at, updated_at: r.updated_at,
    completed_at: r.completed_at ?? null,
  };
}

function mapEvent(r: Row): EventRow {
  return {
    id: r.id, ts: r.ts, type: r.type,
    task_id: r.task_id ?? null, project_id: r.project_id ?? null,
    text: r.text ?? null, payload: JSON.parse(r.payload || '{}'),
  };
}

function mapMemory(r: Row): MemoryEntry {
  return {
    id: r.id, kind: r.kind, content: r.content, source: r.source,
    confidence: r.confidence, is_active: !!r.is_active,
    supersedes: r.supersedes ?? null, created_at: r.created_at, updated_at: r.updated_at,
  };
}

function mapReminder(r: Row): Reminder {
  return {
    id: r.id, kind: r.kind as 'simple' | 'conditional',
    due_at: r.due_at ?? null,
    condition: r.condition ? (JSON.parse(r.condition) as ReminderCondition) : null,
    message_hint: r.message_hint ?? '',
    critical: !!r.critical, cooldown_hours: r.cooldown_hours,
    status: r.status as Reminder['status'],
    last_fired_at: r.last_fired_at ?? null,
    fire_count: r.fire_count, max_fires: r.max_fires,
    muted_until: r.muted_until ?? null,
    created_by: r.created_by as 'user' | 'agent', created_at: r.created_at,
  };
}

function mapSession(r: Row): Session {
  return {
    id: r.id, mode: r.mode as Session['mode'], started_at: r.started_at,
    ends_at: r.ends_at, current_task_id: r.current_task_id ?? null,
    completed_count: r.completed_count, status: r.status as Session['status'],
  };
}

function ftsQuery(q: string): string {
  return q.split(/\s+/).filter(Boolean).map((w) => `"${w.replace(/["]/g, '')}"`).join(' ');
}

/* ---------- репозиторий ---------- */

export interface CreateTaskInput {
  project_id?: number | null;
  parent_task_id?: number | null;
  title: string;
  description?: string;
  status?: TaskStatus;
  estimated_minutes?: number | null;
  energy_required?: number | null;
  focus_required?: Focus;
  danger_level?: Danger;
  tags?: string[];
  due_at?: string | null;
  recurrence?: Recurrence;
  deferred_until?: string | null;
}

export class Repo {
  constructor(private db: DB) {}

  /* ----- settings ----- */

  getJson<T>(key: string, fallback: T): T {
    const r = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as Row | undefined;
    if (!r) return fallback;
    try { return JSON.parse(r.value) as T; } catch { return fallback; }
  }
  setJson(key: string, value: unknown): void {
    this.db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ).run(key, JSON.stringify(value));
  }

  /* ----- projects ----- */

  createProject(input: { name: string; description?: string; area: Area | string; priority?: number; status?: ProjectStatus }, now: string): Project {
    const info = this.db.prepare(
      `INSERT INTO projects (name, description, area, status, priority, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(input.name, input.description ?? '', input.area, input.status ?? 'active', input.priority ?? 3, now, now);
    return this.getProject(Number(info.lastInsertRowid))!;
  }

  updateProject(id: number, patch: Partial<{ name: string; description: string; status: ProjectStatus; priority: number; area: string }>, now: string): Project | undefined {
    const keys = Object.keys(patch);
    if (!keys.length) return this.getProject(id);
    const sets = keys.map((k) => `${k} = @${k}`).join(', ');
    this.db.prepare(`UPDATE projects SET ${sets}, updated_at = @__now WHERE id = @__id`)
      .run({ ...patch, __now: now, __id: id } as any);
    return this.getProject(id);
  }

  getProject(id: number): Project | undefined {
    const r = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    return r ? mapProject(r as Row) : undefined;
  }

  listProjects(status?: ProjectStatus): Project[] {
    const rows = status
      ? this.db.prepare('SELECT * FROM projects WHERE status = ? ORDER BY priority DESC, id').all(status)
      : this.db.prepare('SELECT * FROM projects ORDER BY priority DESC, id').all();
    return (rows as Row[]).map(mapProject);
  }

  openCounts(): Map<number, number> {
    const rows = this.db.prepare(
      `SELECT project_id, COUNT(*) n FROM tasks
       WHERE project_id IS NOT NULL AND status IN ('todo','next','active','waiting')
       GROUP BY project_id`,
    ).all() as Row[];
    return new Map(rows.map((r) => [r.project_id as number, r.n as number]));
  }

  /* ----- tasks ----- */

  createTask(input: CreateTaskInput, now: string): Task {
    const info = this.db.prepare(
      `INSERT INTO tasks (project_id, parent_task_id, title, description, status, estimated_minutes,
        energy_required, focus_required, danger_level, tags, due_at, recurrence, deferred_until, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.project_id ?? null, input.parent_task_id ?? null, input.title, input.description ?? '',
      input.status ?? 'todo', input.estimated_minutes ?? null, input.energy_required ?? null,
      input.focus_required ?? 'normal', input.danger_level ?? 'none',
      JSON.stringify(input.tags ?? []), input.due_at ?? null, input.recurrence ?? 'none',
      input.deferred_until ?? null, now, now,
    );
    return this.getTask(Number(info.lastInsertRowid))!;
  }

  updateTask(id: number, patch: Partial<Record<string, unknown>>, now: string): Task | undefined {
    const allowed = ['title', 'description', 'status', 'estimated_minutes', 'energy_required',
      'focus_required', 'danger_level', 'tags', 'due_at', 'recurrence', 'deferred_until',
      'started_at', 'completed_at', 'project_id', 'parent_task_id'];
    const keys = Object.keys(patch).filter((k) => allowed.includes(k));
    if (!keys.length) return this.getTask(id);
    const params: Record<string, unknown> = { __now: now, __id: id };
    for (const k of keys) {
      params[k] = k === 'tags' ? JSON.stringify(patch[k]) : patch[k];
    }
    const sets = keys.map((k) => `${k} = @${k}`).join(', ');
    this.db.prepare(`UPDATE tasks SET ${sets}, updated_at = @__now WHERE id = @__id`).run(params as any);
    return this.getTask(id);
  }

  getTask(id: number): Task | undefined {
    const r = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    return r ? mapTask(r as Row) : undefined;
  }

  listTasks(filter: { status?: TaskStatus | TaskStatus[]; projectId?: number | null; dueBefore?: string; tag?: string; limit?: number } = {}): Task[] {
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (filter.status) {
      const arr = Array.isArray(filter.status) ? filter.status : [filter.status];
      where.push(`t.status IN (${arr.map((_, i) => `@s${i}`).join(',')})`);
      arr.forEach((s, i) => (params[`s${i}`] = s));
    }
    if (filter.projectId !== undefined) { where.push('t.project_id = @pid'); params.pid = filter.projectId; }
    if (filter.dueBefore) { where.push('t.due_at IS NOT NULL AND t.due_at <= @due'); params.due = filter.dueBefore; }
    const limit = filter.limit ?? 500;
    const sql = `SELECT t.*, p.status AS project_status, p.name AS project_name, p.priority AS project_priority
      FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY t.id DESC LIMIT ${limit}`;
    let rows = this.db.prepare(sql).all(params) as Row[];
    if (filter.tag) rows = rows.filter((r) => JSON.parse(r.tags || '[]').includes(filter.tag));
    return rows.map(mapTask);
  }

  childrenOf(id: number): Task[] {
    const rows = this.db.prepare('SELECT * FROM tasks WHERE parent_task_id = ? ORDER BY id').all(id);
    return (rows as Row[]).map(mapTask);
  }

  /** Кандидаты для скоринга: todo/next, проект active или без проекта. */
  candidates(): Task[] {
    const rows = this.db.prepare(
      `SELECT t.*, p.status AS project_status, p.name AS project_name, p.priority AS project_priority
       FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
       WHERE t.status IN ('todo','next')
         AND (t.project_id IS NULL OR p.status = 'active')
       ORDER BY t.id`,
    ).all();
    return (rows as Row[]).map(mapTask);
  }

  searchTasks(q: string): Task[] {
    const match = ftsQuery(q);
    if (!match) return [];
    try {
      const rows = this.db.prepare(
        `SELECT t.*, p.status AS project_status, p.name AS project_name, p.priority AS project_priority
         FROM tasks_fts f JOIN tasks t ON t.id = f.rowid
         LEFT JOIN projects p ON p.id = t.project_id
         WHERE tasks_fts MATCH ? ORDER BY rank LIMIT 20`,
      ).all(match) as Row[];
      return rows.map(mapTask);
    } catch {
      return [];
    }
  }

  /* ----- edges (зависимости) ----- */

  addTaskEdge(fromTaskId: number, toTaskId: number, relation: 'requires' | 'blocks' | 'related_to', now: string): void {
    const [from, to, rel] = relation === 'blocks'
      ? [toTaskId, fromTaskId, 'requires'] // «A blocks B» нормализуем в «B requires A»
      : [fromTaskId, toTaskId, relation];
    if (from === to) throw new Error('Задача не может зависеть сама от себя');
    if (rel === 'requires' && this.wouldCreateCycle(from, to)) {
      throw new Error('Эта зависимость создала бы цикл');
    }
    this.db.prepare(
      'INSERT INTO task_edges (from_task_id, to_task_id, relation, created_at) VALUES (?, ?, ?, ?) ' +
      'ON CONFLICT(from_task_id, to_task_id, relation) DO NOTHING',
    ).run(from, to, rel, now);
  }

  edgesForTask(id: number): { from: number; to: number; relation: string }[] {
    const rows = this.db.prepare('SELECT from_task_id, to_task_id, relation FROM task_edges WHERE from_task_id = ? OR to_task_id = ?').all(id, id);
    return (rows as Row[]).map((r) => ({ from: r.from_task_id, to: r.to_task_id, relation: r.relation }));
  }

  requiresEdges(): { from: number; to: number }[] {
    const rows = this.db.prepare("SELECT from_task_id, to_task_id FROM task_edges WHERE relation = 'requires'").all();
    return (rows as Row[]).map((r) => ({ from: r.from_task_id, to: r.to_task_id }));
  }

  /** Прямая блокировка: задача, у которой есть незакрытая requires-зависимость. */
  blockedIds(): Set<number> {
    const rows = this.db.prepare(
      `SELECT DISTINCT e.from_task_id AS id FROM task_edges e
       JOIN tasks t ON t.id = e.to_task_id
       WHERE e.relation = 'requires' AND t.status NOT IN ('done','cancelled')`,
    ).all();
    return new Set((rows as Row[]).map((r) => r.id as number));
  }

  private wouldCreateCycle(fromId: number, toId: number): boolean {
    const adj = new Map<number, number[]>();
    for (const e of this.requiresEdges()) {
      if (!adj.has(e.from)) adj.set(e.from, []);
      adj.get(e.from)!.push(e.to);
    }
    const seen = new Set<number>();
    const stack = [toId];
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === fromId) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const next of adj.get(cur) ?? []) stack.push(next);
    }
    return false;
  }

  /* ----- entities (граф знаний) ----- */

  upsertEntity(input: { kind: string; name: string; description?: string; props?: Record<string, unknown> }, now: string): number {
    const existing = this.db.prepare('SELECT id FROM entities WHERE name = ?').get(input.name) as Row | undefined;
    if (existing) return existing.id as number;
    const info = this.db.prepare(
      'INSERT INTO entities (kind, name, description, props, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(input.kind, input.name, input.description ?? '', JSON.stringify(input.props ?? {}), now, now);
    return Number(info.lastInsertRowid);
  }

  getEntity(idOrName: number | string): { id: number; kind: string; name: string; description: string; props: Record<string, unknown> } | undefined {
    const r = typeof idOrName === 'number'
      ? this.db.prepare('SELECT * FROM entities WHERE id = ?').get(idOrName)
      : this.db.prepare('SELECT * FROM entities WHERE name = ?').get(idOrName);
    if (!r) return undefined;
    const row = r as Row;
    return { id: row.id, kind: row.kind, name: row.name, description: row.description, props: JSON.parse(row.props || '{}') };
  }

  listEntities(): { id: number; kind: string; name: string; description: string }[] {
    const rows = this.db.prepare('SELECT id, kind, name, description FROM entities ORDER BY kind, name').all();
    return rows as Row[] as any;
  }

  addEntityEdge(fromId: number, toId: number, relation: string, now: string): void {
    this.db.prepare(
      'INSERT INTO entity_edges (from_entity_id, to_entity_id, relation, created_at) VALUES (?, ?, ?, ?) ' +
      'ON CONFLICT(from_entity_id, to_entity_id, relation) DO NOTHING',
    ).run(fromId, toId, relation, now);
  }

  listEntityEdges(): { from: number; to: number; relation: string }[] {
    const rows = this.db.prepare('SELECT from_entity_id, to_entity_id, relation FROM entity_edges').all();
    return (rows as Row[]).map((r) => ({ from: r.from_entity_id, to: r.to_entity_id, relation: r.relation }));
  }

  linkTaskEntity(taskId: number, entityId: number, relation = 'about'): void {
    this.db.prepare('INSERT INTO task_entities (task_id, entity_id, relation) VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
      .run(taskId, entityId, relation);
  }

  /* ----- memory ----- */

  insertMemory(input: { kind: MemoryEntry['kind']; content: string; source: MemoryEntry['source']; confidence?: number; supersedes?: number | null }, now: string): MemoryEntry {
    const info = this.db.prepare(
      'INSERT INTO memory_entries (kind, content, source, confidence, is_active, supersedes, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)',
    ).run(input.kind, input.content, input.source, input.confidence ?? 0.8, input.supersedes ?? null, now, now);
    const id = Number(info.lastInsertRowid);
    return { ...input, id, confidence: input.confidence ?? 0.8, is_active: true, supersedes: input.supersedes ?? null, created_at: now, updated_at: now } as MemoryEntry;
  }

  setMemoryActive(id: number, active: boolean, now: string): void {
    this.db.prepare('UPDATE memory_entries SET is_active = ?, updated_at = ? WHERE id = ?').run(active ? 1 : 0, now, id);
  }

  listMemory(activeOnly = true): MemoryEntry[] {
    const rows = activeOnly
      ? this.db.prepare('SELECT * FROM memory_entries WHERE is_active = 1 ORDER BY id DESC').all()
      : this.db.prepare('SELECT * FROM memory_entries ORDER BY id DESC').all();
    return (rows as Row[]).map(mapMemory);
  }

  searchMemory(q: string, limit = 5): MemoryEntry[] {
    const match = ftsQuery(q);
    if (!match) return [];
    try {
      const rows = this.db.prepare(
        `SELECT m.* FROM memory_fts f JOIN memory_entries m ON m.id = f.rowid
         WHERE memory_fts MATCH ? AND m.is_active = 1 ORDER BY rank LIMIT ?`,
      ).all(match, limit);
      return (rows as Row[]).map(mapMemory);
    } catch {
      return [];
    }
  }

  /* ----- user states ----- */

  insertState(s: Omit<UserState, 'id' | 'recorded_at'>, now: string): void {
    this.db.prepare(
      'INSERT INTO user_states (recorded_at, energy, mood, available_minutes, focus, intoxication, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(now, s.energy ?? null, s.mood ?? null, s.available_minutes ?? null, s.focus ?? null, s.intoxication ?? null, s.note ?? null);
  }

  latestState(): UserState | null {
    const r = this.db.prepare('SELECT * FROM user_states ORDER BY id DESC LIMIT 1').get();
    if (!r) return null;
    const row = r as Row;
    return {
      id: row.id, recorded_at: row.recorded_at, energy: row.energy ?? null, mood: row.mood ?? null,
      available_minutes: row.available_minutes ?? null, focus: row.focus ?? null,
      intoxication: row.intoxication ?? null, note: row.note ?? null,
    };
  }

  /* ----- events ----- */

  addEvent(type: string, opts: { taskId?: number | null; projectId?: number | null; text?: string | null; payload?: Record<string, unknown> } = {}, ts: string): void {
    this.db.prepare('INSERT INTO events (ts, type, task_id, project_id, text, payload) VALUES (?, ?, ?, ?, ?, ?)')
      .run(ts, type, opts.taskId ?? null, opts.projectId ?? null, opts.text ?? null, JSON.stringify(opts.payload ?? {}));
  }

  listEvents(filter: { type?: string; since?: string; limit?: number; taskId?: number; projectId?: number } = {}): EventRow[] {
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (filter.type) { where.push('type = @type'); params.type = filter.type; }
    if (filter.since) { where.push('ts >= @since'); params.since = filter.since; }
    if (filter.taskId) { where.push('task_id = @tid'); params.tid = filter.taskId; }
    if (filter.projectId) { where.push('project_id = @pid'); params.pid = filter.projectId; }
    const sql = `SELECT * FROM events ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ${filter.limit ?? 100}`;
    return (this.db.prepare(sql).all(params) as Row[]).map(mapEvent);
  }

  /** Последние n сообщений диалога (для промпта), в хронологическом порядке. */
  dialog(n: number): EventRow[] {
    const rows = this.db.prepare(
      "SELECT * FROM events WHERE type IN ('USER_MESSAGE','AGENT_MESSAGE') ORDER BY id DESC LIMIT ?",
    ).all(n) as Row[];
    return rows.reverse().map(mapEvent);
  }

  countTypeSince(type: string, sinceIso: string): number {
    const r = this.db.prepare('SELECT COUNT(*) n FROM events WHERE type = ? AND ts >= ?').get(type, sinceIso) as Row;
    return r.n as number;
  }

  lastUserMessageAt(): string | null {
    const r = this.db.prepare("SELECT MAX(ts) m FROM events WHERE type = 'USER_MESSAGE'").get() as Row;
    return r.m ?? null;
  }

  userMessagesAfter(iso: string): EventRow[] {
    return (this.db.prepare("SELECT * FROM events WHERE type = 'USER_MESSAGE' AND ts > ? ORDER BY id").all(iso) as Row[]).map(mapEvent);
  }

  /** Проекты с завершённой задачей за период (для «momentum»). */
  projectIdsCompletedSince(iso: string): Set<number> {
    const rows = this.db.prepare(
      "SELECT DISTINCT project_id FROM events WHERE type = 'TASK_COMPLETED' AND project_id IS NOT NULL AND ts >= ?",
    ).all(iso) as Row[];
    return new Set(rows.map((r) => r.project_id as number));
  }

  /** Число завершённых задач по проектам за период — градиент «движения». */
  projectCompletionCountsSince(iso: string): Map<number, number> {
    const rows = this.db.prepare(
      "SELECT project_id, COUNT(*) n FROM events WHERE type = 'TASK_COMPLETED' AND project_id IS NOT NULL AND ts >= ? GROUP BY project_id",
    ).all(iso) as Row[];
    return new Map(rows.map((r) => [r.project_id as number, r.n as number]));
  }

  lastCompletedAtForProject(projectId: number): string | null {
    const r = this.db.prepare(
      "SELECT MAX(ts) m FROM events WHERE type = 'TASK_COMPLETED' AND project_id = ?",
    ).get(projectId) as Row;
    return r.m ?? null;
  }

  /** Последняя проактивная отправка за последние N часов — для интервала между сообщениями. */
  lastProactiveSentAt(withinHours = 24): string | null {
    const since = new Date(Date.now() - withinHours * 3_600_000).toISOString();
    const r = this.db.prepare(
      "SELECT MAX(ts) m FROM events WHERE type = 'PROACTIVE_SENT' AND ts >= ?",
    ).get(since) as Row;
    return r.m ?? null;
  }

  /** Статистика проактивных отправок за день (для бюджетов). */
  proactiveStats(todayStartIso: string, workWindow: { start: string; end: string } | null): {
    nonCriticalToday: number; criticalWorkToday: number; lastSentAt: string | null;
    sent: { ts: string; topic: string; critical: boolean }[];
  } {
    const rows = this.db.prepare(
      "SELECT ts, payload FROM events WHERE type = 'PROACTIVE_SENT' AND ts >= ? ORDER BY id DESC",
    ).all(todayStartIso) as Row[];
    const sent = rows.map((r) => {
      const p = JSON.parse(r.payload || '{}');
      return { ts: r.ts as string, topic: String(p.topic ?? ''), critical: !!p.critical };
    });
    const nonCriticalToday = sent.filter((s) => !s.critical).length;
    const criticalWorkToday = workWindow
      ? sent.filter((s) => s.critical && s.ts >= workWindow.start && s.ts < workWindow.end).length
      : 0;
    return { nonCriticalToday, criticalWorkToday, lastSentAt: sent[0]?.ts ?? null, sent };
  }

  /* ----- reminders ----- */

  insertReminder(input: {
    kind: 'simple' | 'conditional'; due_at?: string | null; condition?: ReminderCondition | null;
    message_hint?: string; critical?: boolean; cooldown_hours?: number; max_fires?: number; created_by?: 'user' | 'agent';
  }, now: string): Reminder {
    const info = this.db.prepare(
      `INSERT INTO reminders (kind, due_at, condition, message_hint, critical, cooldown_hours, status, max_fires, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    ).run(input.kind, input.due_at ?? null, input.condition ? JSON.stringify(input.condition) : null,
      input.message_hint ?? '', input.critical ? 1 : 0, input.cooldown_hours ?? 24,
      input.max_fires ?? 1, input.created_by ?? 'agent', now);
    return mapReminder(this.db.prepare('SELECT * FROM reminders WHERE id = ?').get(Number(info.lastInsertRowid)) as Row);
  }

  updateReminder(id: number, patch: Partial<{ status: string; last_fired_at: string | null; fire_count: number; muted_until: string | null }>): void {
    const keys = Object.keys(patch);
    if (!keys.length) return;
    const sets = keys.map((k) => `${k} = @${k}`).join(', ');
    this.db.prepare(`UPDATE reminders SET ${sets} WHERE id = @__id`).run({ ...patch, __id: id } as any);
  }

  pendingReminders(): Reminder[] {
    const rows = this.db.prepare("SELECT * FROM reminders WHERE status = 'pending'").all();
    return (rows as Row[]).map(mapReminder);
  }

  /* ----- sessions ----- */

  insertSession(mode: 'guide' | 'micro', minutes: number, now: string): Session {
    const ends = new Date(new Date(now).getTime() + minutes * 60_000).toISOString();
    const info = this.db.prepare(
      'INSERT INTO sessions (mode, started_at, ends_at, status) VALUES (?, ?, ?, ?)',
    ).run(mode, now, ends, 'active');
    return mapSession(this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(Number(info.lastInsertRowid)) as Row);
  }

  updateSession(id: number, patch: Partial<{ current_task_id: number | null; completed_count: number; status: string }>): void {
    const keys = Object.keys(patch);
    if (!keys.length) return;
    const sets = keys.map((k) => `${k} = @${k}`).join(', ');
    this.db.prepare(`UPDATE sessions SET ${sets} WHERE id = @__id`).run({ ...patch, __id: id } as any);
  }

  activeSession(): Session | null {
    const r = this.db.prepare("SELECT * FROM sessions WHERE status = 'active' ORDER BY id DESC LIMIT 1").get();
    return r ? mapSession(r as Row) : null;
  }

  /* ----- утилиты ----- */

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
}
