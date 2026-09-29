import { z } from 'zod';
import { Repo } from '../../infra/db/repos';
import { TaskOps } from '../taskops';
import { Settings } from '../settings';
import { SessionService } from '../session';
import { ReminderCondition } from '../../domain/types';
import { registerMute } from '../../domain/proactivity';

export interface ToolCtx {
  repo: Repo;
  ops: TaskOps;
  settings: Settings;
  sessions: SessionService;
}

export interface ToolDef {
  name: string;
  description: string;
  kind: 'read' | 'write' | 'reply';
  schema: z.ZodTypeAny;
  jsonSchema: Record<string, unknown>;
  execRead?: (args: any, ctx: ToolCtx) => unknown;
  /** Проверка перед включением в транзакцию: null = ок, строка = ошибка модели. */
  validate?: (args: any, ctx: ToolCtx) => string | null;
  apply?: (args: any, ctx: ToolCtx) => unknown;
}

const obj = (props: Record<string, unknown>, required: string[] = []) => ({
  type: 'object', properties: props, required,
  additionalProperties: false,
});
const str = (description: string) => ({ type: 'string', description });
const num = (description: string) => ({ type: 'number', description });
const arr = (items: unknown, description: string) => ({ type: 'array', items, description });

export function buildTools(): ToolDef[] {
  return [
    /* ---------------- чтение ---------------- */

    {
      name: 'get_state',
      description: 'Текущее время, самоотчёт пользователя (энергия/время/опьянение) и активная сессия.',
      kind: 'read',
      schema: z.object({}).strict(),
      jsonSchema: obj({}),
      execRead: (_a, ctx) => ({
        now_utc: new Date().toISOString(),
        state: ctx.ops.currentState(),
        session: ctx.repo.activeSession(),
      }),
    },
    {
      name: 'list_projects',
      description: 'Список проектов со статусами и числом открытых задач.',
      kind: 'read',
      schema: z.object({ status: z.enum(['active', 'paused', 'done', 'cancelled']).optional() }).strict(),
      jsonSchema: obj({ status: { type: 'string', enum: ['active', 'paused', 'done', 'cancelled'], description: 'фильтр по статусу' } }),
      execRead: (a, ctx) => {
        const counts = ctx.repo.openCounts();
        return ctx.repo.listProjects(a.status).map((p) => ({
          id: p.id, name: p.name, area: p.area, status: p.status, priority: p.priority,
          open_tasks: counts.get(p.id) ?? 0,
        }));
      },
    },
    {
      name: 'get_project',
      description: 'Проект с задачами, зависимостями и кандидатами на следующее действие.',
      kind: 'read',
      schema: z.object({ id: z.number().int() }).strict(),
      jsonSchema: obj({ id: num('ID проекта') }, ['id']),
      execRead: (a, ctx) => {
        const p = ctx.repo.getProject(a.id);
        if (!p) return { error: `Проект ${a.id} не найден` };
        const tasks = ctx.repo.listTasks({ projectId: a.id });
        const blocked = ctx.repo.blockedIds();
        const next = ctx.ops.getRanked().filter((r) => r.task.project_id === a.id).slice(0, 3)
          .map((r) => ({ id: r.task.id, title: r.task.title, score: Math.round(r.score) }));
        return { project: p, tasks, blocked_task_ids: [...blocked].filter((id) => tasks.some((t) => t.id === id)), next_candidates: next };
      },
    },
    {
      name: 'get_task',
      description: 'Задача целиком: подзадачи и зависимости.',
      kind: 'read',
      schema: z.object({ id: z.number().int() }).strict(),
      jsonSchema: obj({ id: num('ID задачи') }, ['id']),
      execRead: (a, ctx) => {
        const t = ctx.repo.getTask(a.id);
        if (!t) return { error: `Задача ${a.id} не найдена` };
        return { task: t, subtasks: ctx.repo.childrenOf(a.id), edges: ctx.repo.edgesForTask(a.id) };
      },
    },
    {
      name: 'search_tasks',
      description: 'Поиск задач: полнотекстовый запрос и/или фильтры. Вернёт до 20 задач.',
      kind: 'read',
      schema: z.object({
        query: z.string().optional(),
        status: z.enum(['idea', 'todo', 'next', 'active', 'waiting', 'done', 'cancelled']).optional(),
        project_id: z.number().int().optional(),
        due_before: z.string().optional(),
        tag: z.string().optional(),
      }).strict(),
      jsonSchema: obj({
        query: str('полнотекстовый запрос'),
        status: { type: 'string', enum: ['idea', 'todo', 'next', 'active', 'waiting', 'done', 'cancelled'] },
        project_id: num('ID проекта'),
        due_before: str('дата YYYY-MM-DD'),
        tag: str('тег'),
      }),
      execRead: (a, ctx) => {
        if (a.query) {
          const found = ctx.repo.searchTasks(a.query);
          const filtered = found.filter((t) =>
            (!a.status || t.status === a.status) &&
            (a.project_id === undefined || t.project_id === a.project_id));
          return filtered;
        }
        return ctx.repo.listTasks({
          status: a.status,
          projectId: a.project_id,
          dueBefore: a.due_before,
          tag: a.tag,
          limit: 20,
        });
      },
    },
    {
      name: 'list_next_actions',
      description: 'Ранжированные кандидаты на следующее действие (учитывает энергию, опьянение, время, блокировки).',
      kind: 'read',
      schema: z.object({}).strict(),
      jsonSchema: obj({}),
      execRead: (_a, ctx) => ctx.ops.getRanked().slice(0, 8).map((r) => ({
        id: r.task.id, title: r.task.title, project: r.task.project_name ?? null,
        est_min: r.task.estimated_minutes ?? null, energy: r.task.energy_required ?? null,
        score: Math.round(r.score), reasons: r.reasons,
      })),
    },
    {
      name: 'search_memory',
      description: 'Поиск по памяти: предпочтения, факты, паттерны.',
      kind: 'read',
      schema: z.object({ query: z.string().min(1) }).strict(),
      jsonSchema: obj({ query: str('запрос') }, ['query']),
      execRead: (a, ctx) => ctx.repo.searchMemory(a.query),
    },
    {
      name: 'get_entity',
      description: 'Сущность графа знаний по имени или ID, с соседями и связанными задачами.',
      kind: 'read',
      schema: z.object({ name_or_id: z.union([z.string(), z.number()]) }).strict(),
      jsonSchema: obj({ name_or_id: { type: 'string', description: 'имя или ID сущности' } }, ['name_or_id']),
      execRead: (a, ctx) => {
        const e = ctx.repo.getEntity(a.name_or_id);
        if (!e) return { error: 'Сущность не найдена' };
        const neighbors = ctx.repo.listEntityEdges()
          .filter((ed) => ed.from === e.id || ed.to === e.id)
          .map((ed) => ({
            relation: ed.relation,
            other_id: ed.from === e.id ? ed.to : ed.from,
            direction: ed.from === e.id ? 'out' : 'in',
          }));
        return { entity: e, neighbors };
      },
    },
    {
      name: 'recent_events',
      description: 'Последние события журнала (что происходило).',
      kind: 'read',
      schema: z.object({
        limit: z.number().int().min(1).max(50).optional(),
        type: z.string().optional(),
        project_id: z.number().int().optional(),
      }).strict(),
      jsonSchema: obj({
        limit: num('сколько (1–50)'), type: str('тип события'), project_id: num('ID проекта'),
      }),
      execRead: (a, ctx) => ctx.repo.listEvents({ type: a.type, projectId: a.project_id, limit: a.limit ?? 15 }),
    },

    /* ---------------- запись (все операции одного хода — одна транзакция) ---------------- */

    {
      name: 'create_task',
      description: 'Создать задачу. project_id NULL = «Входящие».',
      kind: 'write',
      schema: z.object({
        title: z.string().min(1),
        project_id: z.number().int().nullable().optional(),
        parent_task_id: z.number().int().nullable().optional(),
        description: z.string().optional(),
        estimated_minutes: z.number().int().min(1).max(600).nullable().optional(),
        energy_required: z.number().int().min(1).max(5).nullable().optional(),
        focus_required: z.enum(['low', 'normal', 'high']).optional(),
        danger_level: z.enum(['none', 'tools', 'electricity', 'heavy', 'height']).optional(),
        due_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        recurrence: z.enum(['none', 'daily', 'weekly', 'monthly']).optional(),
        tags: z.array(z.string()).optional(),
        status: z.enum(['idea', 'todo', 'next']).optional(),
      }).strict(),
      jsonSchema: obj({
        title: str('что сделать, конкретно'), project_id: num('ID проекта или null'),
        parent_task_id: num('ID родительской задачи'), description: str('пояснение'),
        estimated_minutes: num('оценка в минутах'), energy_required: num('энергия 1–5'),
        focus_required: { type: 'string', enum: ['low', 'normal', 'high'] },
        danger_level: { type: 'string', enum: ['none', 'tools', 'electricity', 'heavy', 'height'] },
        due_at: str('дедлайн YYYY-MM-DD'), recurrence: { type: 'string', enum: ['none', 'daily', 'weekly', 'monthly'] },
        tags: arr({ type: 'string' }, 'теги'), status: { type: 'string', enum: ['idea', 'todo', 'next'] },
      }, ['title']),
      validate: (a, ctx) => {
        if (a.project_id != null && !ctx.repo.getProject(a.project_id)) return `Проект ${a.project_id} не найден`;
        if (a.parent_task_id != null && !ctx.repo.getTask(a.parent_task_id)) return `Родительская задача ${a.parent_task_id} не найдена`;
        return null;
      },
      apply: (a, ctx) => { const t = ctx.ops.createTask(a); return { id: t.id }; },
    },
    {
      name: 'update_task',
      description: 'Изменить поля задачи (статус, оценку, дедлайн, «отложить до» и т.д.).',
      kind: 'write',
      schema: z.object({
        id: z.number().int(),
        title: z.string().min(1).optional(),
        description: z.string().optional(),
        status: z.enum(['idea', 'todo', 'next', 'active', 'waiting', 'done', 'cancelled']).optional(),
        estimated_minutes: z.number().int().min(1).max(600).nullable().optional(),
        energy_required: z.number().int().min(1).max(5).nullable().optional(),
        focus_required: z.enum(['low', 'normal', 'high']).optional(),
        danger_level: z.enum(['none', 'tools', 'electricity', 'heavy', 'height']).optional(),
        due_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        recurrence: z.enum(['none', 'daily', 'weekly', 'monthly']).optional(),
        deferred_until: z.string().nullable().optional(),
        tags: z.array(z.string()).optional(),
      }).strict(),
      jsonSchema: obj({ id: num('ID задачи'), title: str('название'), description: str('пояснение'), status: { type: 'string', enum: ['idea', 'todo', 'next', 'active', 'waiting', 'done', 'cancelled'] }, estimated_minutes: num('минуты'), energy_required: num('энергия 1–5'), focus_required: { type: 'string', enum: ['low', 'normal', 'high'] }, danger_level: { type: 'string', enum: ['none', 'tools', 'electricity', 'heavy', 'height'] }, due_at: str('YYYY-MM-DD'), recurrence: { type: 'string', enum: ['none', 'daily', 'weekly', 'monthly'] }, deferred_until: str('ISO: отложить до этого момента'), tags: arr({ type: 'string' }, 'теги') }, ['id']),
      validate: (a, ctx) => (ctx.repo.getTask(a.id) ? null : `Задача ${a.id} не найдена`),
      apply: (a, ctx) => {
        const { id, ...patch } = a;
        const t = ctx.ops.updateTask(id, patch);
        return { id: t.id, status: t.status };
      },
    },
    {
      name: 'complete_task',
      description: 'Задача выполнена. Для рекуррентных создаст следующий экземпляр автоматически.',
      kind: 'write',
      schema: z.object({ id: z.number().int(), note: z.string().optional() }).strict(),
      jsonSchema: obj({ id: num('ID задачи'), note: str('комментарий') }, ['id']),
      validate: (a, ctx) => (ctx.repo.getTask(a.id) ? null : `Задача ${a.id} не найдена`),
      apply: (a, ctx) => {
        const r = ctx.ops.completeTask(a.id, a.note);
        return { id: a.id, done: true, recurrence_instance_id: r.newInstance?.id ?? null };
      },
    },
    {
      name: 'cancel_task',
      description: 'Отменить задачу (не удаление, история сохраняется).',
      kind: 'write',
      schema: z.object({ id: z.number().int(), reason: z.string().optional() }).strict(),
      jsonSchema: obj({ id: num('ID задачи'), reason: str('причина') }, ['id']),
      validate: (a, ctx) => (ctx.repo.getTask(a.id) ? null : `Задача ${a.id} не найдена`),
      apply: (a, ctx) => { ctx.ops.cancelTask(a.id, a.reason); return { id: a.id, cancelled: true }; },
    },
    {
      name: 'split_task',
      description: 'Разбить задачу на подзадачи. Первая станет «следующим действием». Не глубже одного уровня.',
      kind: 'write',
      schema: z.object({
        id: z.number().int(),
        subtasks: z.array(z.object({
          title: z.string().min(1),
          estimated_minutes: z.number().int().min(1).max(600).optional(),
          energy_required: z.number().int().min(1).max(5).optional(),
        }).strict()).min(1).max(10),
      }).strict(),
      jsonSchema: obj({
        id: num('ID задачи'),
        subtasks: arr(obj({ title: str('что сделать'), estimated_minutes: num('минуты'), energy_required: num('энергия 1–5') }, ['title']), 'список подзадач'),
      }, ['id', 'subtasks']),
      validate: (a, ctx) => (ctx.repo.getTask(a.id) ? null : `Задача ${a.id} не найдена`),
      apply: (a, ctx) => {
        const children = ctx.ops.splitTask(a.id, a.subtasks);
        return { id: a.id, children: children.map((c) => ({ id: c.id, title: c.title })) };
      },
    },
    {
      name: 'add_task_dependency',
      description: 'Зависимость: from_id нельзя делать, пока to_id не закрыта.',
      kind: 'write',
      schema: z.object({
        from_id: z.number().int(),
        to_id: z.number().int(),
        relation: z.enum(['requires', 'blocks', 'related_to']).optional(),
      }).strict(),
      jsonSchema: obj({ from_id: num('ID задачи'), to_id: num('ID задачи-предпосылки'), relation: { type: 'string', enum: ['requires', 'blocks', 'related_to'] } }, ['from_id', 'to_id']),
      validate: (a, ctx) => {
        if (!ctx.repo.getTask(a.from_id)) return `Задача ${a.from_id} не найдена`;
        if (!ctx.repo.getTask(a.to_id)) return `Задача ${a.to_id} не найдена`;
        return null;
      },
      apply: (a, ctx) => { ctx.ops.addDependency(a.from_id, a.to_id, a.relation ?? 'requires'); return { ok: true }; },
    },
    {
      name: 'set_project_status',
      description: 'Изменить статус/приоритет проекта.',
      kind: 'write',
      schema: z.object({
        project_id: z.number().int(),
        status: z.enum(['active', 'paused', 'done', 'cancelled']),
        priority: z.number().int().min(1).max(5).optional(),
      }).strict(),
      jsonSchema: obj({ project_id: num('ID проекта'), status: { type: 'string', enum: ['active', 'paused', 'done', 'cancelled'] }, priority: num('1–5') }, ['project_id', 'status']),
      validate: (a, ctx) => (ctx.repo.getProject(a.project_id) ? null : `Проект ${a.project_id} не найден`),
      apply: (a, ctx) => {
        const p = ctx.repo.updateProject(a.project_id, { status: a.status, ...(a.priority ? { priority: a.priority } : {}) }, new Date().toISOString());
        ctx.repo.addEvent('PROJECT_UPDATED', { projectId: a.project_id, payload: { status: a.status } }, new Date().toISOString());
        return { id: p!.id, status: p!.status };
      },
    },
    {
      name: 'record_state',
      description: 'Записать самоотчёт пользователя (энергия 1–10, время, опьянение).',
      kind: 'write',
      schema: z.object({
        energy: z.number().int().min(1).max(10).optional(),
        mood: z.string().optional(),
        available_minutes: z.number().int().min(1).max(720).optional(),
        focus: z.enum(['low', 'normal', 'high']).optional(),
        intoxication: z.enum(['none', 'mild', 'significant']).optional(),
        note: z.string().optional(),
      }).strict(),
      jsonSchema: obj({
        energy: num('1–10'), mood: str('настроение'), available_minutes: num('сколько есть минут'),
        focus: { type: 'string', enum: ['low', 'normal', 'high'] },
        intoxication: { type: 'string', enum: ['none', 'mild', 'significant'] },
        note: str('заметка'),
      }),
      apply: (a, ctx) => { ctx.ops.recordState(a); return { ok: true }; },
    },
    {
      name: 'remember',
      description: 'Сохранить факт/предпочтение в долговременную память. Одна мысль на вызов.',
      kind: 'write',
      schema: z.object({
        kind: z.enum(['preference', 'fact', 'insight', 'routine', 'pattern']),
        content: z.string().min(3),
        confidence: z.number().min(0).max(1).optional(),
      }).strict(),
      jsonSchema: obj({
        kind: { type: 'string', enum: ['preference', 'fact', 'insight', 'routine', 'pattern'] },
        content: str('мысль по-русски, одна, без markdown'),
        confidence: num('0–1'),
      }, ['kind', 'content']),
      apply: (a, ctx) => {
        const m = ctx.repo.insertMemory({ kind: a.kind, content: a.content, source: 'user_told', confidence: a.confidence }, new Date().toISOString());
        return { id: m.id };
      },
    },
    {
      name: 'set_reminder',
      description: 'Напоминание: простое (due_at, ISO) или условное (condition). Пример условия: {"type":"project_no_progress","project_id":3,"days":10}.',
      kind: 'write',
      schema: z.object({
        due_at: z.string().optional(),
        condition: z.record(z.any()).optional(),
        message_hint: z.string().min(1),
        critical: z.boolean().optional(),
        cooldown_hours: z.number().int().min(1).max(720).optional(),
        max_fires: z.number().int().min(1).max(50).optional(),
      }).strict(),
      jsonSchema: obj({
        due_at: str('ISO, для простого напоминания'),
        condition: { type: 'object', description: 'условие из белого списка типов (см. описание)' },
        message_hint: str('о чём напомнить'),
        critical: { type: 'boolean', description: 'может пройти рабочие часы (только дедлайны)' },
        cooldown_hours: num('повтор не чаще чем, часов'), max_fires: num('максимально срабатываний'),
      }, ['message_hint']),
      validate: (a) => {
        if (!a.due_at && !a.condition) return 'Нужен due_at или condition';
        if (a.due_at && isNaN(Date.parse(a.due_at))) return 'due_at должен быть ISO-датой';
        return null;
      },
      apply: (a, ctx) => {
        const r = ctx.repo.insertReminder({
          kind: a.condition ? 'conditional' : 'simple',
          due_at: a.due_at ? new Date(a.due_at).toISOString() : null,
          condition: (a.condition as ReminderCondition) ?? null,
          message_hint: a.message_hint, critical: !!a.critical,
          cooldown_hours: a.cooldown_hours ?? 24, max_fires: a.max_fires ?? 1, created_by: 'agent',
        }, new Date().toISOString());
        return { id: r.id };
      },
    },
    {
      name: 'cancel_reminder',
      description: 'Отменить напоминание.',
      kind: 'write',
      schema: z.object({ id: z.number().int() }).strict(),
      jsonSchema: obj({ id: num('ID напоминания') }, ['id']),
      validate: (a, ctx) => (ctx.repo.pendingReminders().some((r) => r.id === a.id) ? null : `Напоминание ${a.id} не найдено среди активных`),
      apply: (a, ctx) => {
        ctx.repo.updateReminder(a.id, { status: 'cancelled' });
        ctx.repo.addEvent('REMINDER_CANCELLED', { payload: { id: a.id } }, new Date().toISOString());
        return { ok: true };
      },
    },
    {
      name: 'start_guide_session',
      description: 'Режим «веди меня N минут»: пользователь просит не спрашивать, а вести от действия к действию.',
      kind: 'write',
      schema: z.object({ minutes: z.number().int().min(5).max(180) }).strict(),
      jsonSchema: obj({ minutes: num('длительность в минутах') }, ['minutes']),
      apply: (a, ctx) => {
        const s = ctx.sessions.start(a.minutes);
        return { ok: true, ends_at: s.ends_at };
      },
    },
    {
      name: 'end_guide_session',
      description: 'Завершить режим «веди меня».',
      kind: 'write',
      schema: z.object({}).strict(),
      jsonSchema: obj({}),
      apply: (_a, ctx) => { void ctx.sessions.end('завершено агентом'); return { ok: true }; },
    },
    {
      name: 'mute_topic',
      description: 'Пользователь явно отказался от темы — замутить проактивность по ней на N дней (по умолчанию 7).',
      kind: 'write',
      schema: z.object({ topic: z.string().min(1), days: z.number().int().min(1).max(30).optional() }).strict(),
      jsonSchema: obj({ topic: str('ключ темы, например stale:3 или evening'), days: num('дней') }, ['topic']),
      apply: (a, ctx) => {
        const cfg = ctx.settings.proactiveCfg();
        const cur = ctx.settings.proactiveState()[a.topic];
        const muted = registerMute(cur, new Date(), cfg);
        ctx.settings.setProactiveTopic(a.topic, muted);
        return { ok: true, muted_until: muted.mutedUntil };
      },
    },

    /* ---------------- терминальный вызов ---------------- */

    {
      name: 'reply',
      description: 'Финальный ответ пользователю. Вызывается один раз в конце. propose_task_id добавит кнопки «Сделал/Потом/Другое/Не буду».',
      kind: 'reply',
      schema: z.object({
        text: z.string().min(1),
        propose_task_id: z.number().int().optional(),
        options: z.array(z.string()).max(4).optional(),
      }).strict(),
      jsonSchema: obj({ text: str('текст сообщения'), propose_task_id: num('ID предлагаемой задачи'), options: arr({ type: 'string' }, 'свои подписи кнопок') }, ['text']),
      validate: (a, ctx) => (a.propose_task_id && !ctx.repo.getTask(a.propose_task_id) ? `Задача ${a.propose_task_id} не найдена` : null),
    },
  ];
}
