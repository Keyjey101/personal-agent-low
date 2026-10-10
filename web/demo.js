/* Демо-режим: открой фронт с ?demo — данные из фикстур, мутации работают в памяти.
   Используется для портфолио-кастов и локальной проверки вёрстки без бэкенда. */
'use strict';

window.__DISPATCHER_DEMO__ = (() => {
  const now = new Date();
  const iso = (d) => d.toISOString();
  const shift = (days, h = 10, m = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  };
  const dateStr = (days) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  };
  let seq = 100;
  const nid = () => ++seq;

  /* ---------- данные (по мотивам реального сида) ---------- */

  const projects = [
    { id: 1, name: 'Ремонт кухни', description: 'Замер → гарнитур и плита → перестановка → пол → установка.', area: 'kitchen', status: 'active', priority: 4, open_tasks: 8 },
    { id: 2, name: 'Продать старый массажный стол', description: '', area: 'massage', status: 'active', priority: 3, open_tasks: 4 },
    { id: 3, name: 'Купить новый массажный стол', description: '', area: 'massage', status: 'paused', priority: 2, open_tasks: 2 },
    { id: 4, name: 'Машина', description: '', area: 'car', status: 'active', priority: 3, open_tasks: 4 },
    { id: 5, name: 'Физическая форма', description: 'Без планов-для-прокрастинации.', area: 'fitness', status: 'active', priority: 3, open_tasks: 2 },
  ];

  const T = (id, project_id, title, o = {}) => ({
    id, project_id, parent_task_id: null, title, description: '',
    status: o.s ?? 'todo', estimated_minutes: o.min ?? null, energy_required: o.e ?? null,
    focus_required: 'normal', danger_level: o.d ?? 'none', tags: [],
    due_at: o.due ?? null, recurrence: o.rec ?? 'none', deferred_until: null,
    created_at: shift(-20, 12), completed_at: o.done ? shift(o.done, 12) : null,
    project_name: project_id ? projects.find((p) => p.id === project_id)?.name ?? null : null,
  });

  const tasks = [
    T(1, 1, 'Замерить кухню (3 стены, окно, трубы)', { s: 'next', min: 15, e: 1 }),
    T(2, 1, 'Определиться с гарнитуром (бюджет, стиль)', { min: 40, e: 2 }),
    T(3, 1, 'Выбрать и заказать плиту', { min: 40, e: 2 }),
    T(4, 1, 'Купить гарнитур', { min: 120, e: 2 }),
    T(5, 1, 'Освободить кухню (переместить вещи)', { min: 40, e: 3 }),
    T(6, 1, 'Перестановка: спланировать расстановку', { min: 20, e: 2 }),
    T(7, 1, 'Демонтаж старого гарнитура и пола', { s: 'waiting', min: 120, e: 4, d: 'tools' }),
    T(8, 1, 'Заменить пол на кухне', { min: 180, e: 4, d: 'tools' }),
    T(9, 1, 'Установить гарнитур и плиту', { min: 180, e: 4, d: 'heavy' }),
    T(10, 2, 'Сфотографировать массажный стол', { s: 'next', min: 15, e: 1 }),
    T(11, 2, 'Определить цену (посмотреть 5–10 объявлений)', { min: 20, e: 2 }),
    T(12, 2, 'Написать и выложить объявление на Авито', { min: 20, e: 2 }),
    T(13, 2, 'Отвечать покупателям', { min: 10, e: 1 }),
    T(14, 3, 'Сформулировать требования (размер, вес, бюджет)', { s: 'next', min: 10, e: 1 }),
    T(15, 3, 'Выбрать и купить новый стол', { min: 60, e: 2 }),
    T(16, 4, 'Установить магнитолу', { min: 90, e: 3, d: 'tools' }),
    T(17, 4, 'Заменить стекло: найти VIN машины', { s: 'next', min: 5, e: 1 }),
    T(18, 4, 'Заменить стекло: найти 3 варианта по VIN', { min: 30, e: 2 }),
    T(19, 4, 'Заменить стекло: заказать замену', { min: 20, e: 2 }),
    T(20, 5, 'Первая тренировка с гирей 10 минут', { s: 'next', min: 10, e: 2 }),
    T(21, 5, 'Первые 5 минут на баланс-борде', { min: 5, e: 2 }),
    T(22, null, 'Помыть холодильник', { min: 25, e: 2 }),
    T(23, null, 'Почистить пылесос', { min: 10, e: 1 }),
    T(24, null, 'Починить лючок в туалете', { min: 30, e: 3, d: 'tools' }),
    T(25, null, 'Помыть ванну', { s: 'done', min: 20, e: 2, done: -1 }),
    T(26, null, 'Разобрать стойку с вещами', { min: 30, e: 2 }),
    T(27, null, 'Распечатать шахматы', { min: 20, e: 1 }),
    T(28, null, 'Распечатать призму', { min: 10, e: 1 }),
    T(29, null, 'Заменить аккумулятор у электронной книги', { min: 30, e: 2, d: 'tools' }),
    T(30, null, 'Почистить сервер', { min: 60, e: 3 }),
    T(31, null, 'Оплатить коммуналку', { s: 'next', min: 10, e: 1, due: dateStr(0), rec: 'monthly' }),
    T(32, null, 'Вынести мусор', { s: 'done', min: 5, e: 1, done: 0 }),
    T(33, null, 'Полить цветы', { s: 'done', min: 5, e: 1, done: 0 }),
    T(34, null, 'Разобрать одну полку в ванной', { s: 'done', min: 15, e: 2, done: 0 }),
    T(35, null, 'Продлить полис ОСАГО', { min: 20, e: 2, due: dateStr(-3) }),
  ];
  tasks.find((t) => t.id === 32).completed_at = shift(0, 10, 12);
  tasks.find((t) => t.id === 33).completed_at = shift(0, 11, 40);
  tasks.find((t) => t.id === 34).completed_at = shift(0, 13, 5);

  const memory = [
    { id: 1, kind: 'preference', content: 'Пользователь не любит жёсткое расписание и длинные списки — предлагать по одному действию.', source: 'user_told', is_active: true, created_at: shift(-20) },
    { id: 2, kind: 'preference', content: 'Пользователю легче начинать короткие действия (до 15 минут).', source: 'user_told', is_active: true, created_at: shift(-20) },
    { id: 3, kind: 'fact', content: 'В некоторые дни пользователь курит траву; в такие дни давать простые безопасные задачи без инструмента.', source: 'user_told', is_active: true, created_at: shift(-18) },
    { id: 4, kind: 'routine', content: 'Рабочие часы пн–пт 07:00–18:00 — проактивность по домашним делам запрещена.', source: 'user_told', is_active: true, created_at: shift(-18) },
    { id: 5, kind: 'insight', content: 'Вечером охотнее делается быт: с 20:00 до 22:00 закрывается больше всего домашних задач.', source: 'reflector', is_active: true, created_at: shift(-2, 21, 35) },
    { id: 6, kind: 'pattern', content: 'После тренировок пользователь пропускает бытовые задачи — не предлагать их в тот же вечер.', source: 'reflector', is_active: false, created_at: shift(-9, 21, 35) },
  ];

  const E = (id, kind, name) => ({ id, kind, name, description: '' });
  const entities = [
    E(1, 'place', 'Квартира'), E(2, 'place', 'Кухня'), E(3, 'place', 'Ванная'), E(4, 'place', 'Туалет'),
    E(5, 'object', 'Плита'), E(6, 'object', 'Холодильник'), E(7, 'object', 'Кухонный гарнитур'), E(8, 'object', 'Пол кухни'),
    E(9, 'object', 'Машина'), E(10, 'object', 'Массажный стол (старый)'), E(11, 'object', 'Массажный стол (новый)'),
    E(12, 'equipment', 'Гиря'), E(13, 'equipment', 'Баланс-борд'), E(14, 'equipment', 'Сервер'),
  ];
  const edges = [
    { from: 1, to: 2, relation: 'contains' }, { from: 1, to: 3, relation: 'contains' }, { from: 1, to: 4, relation: 'contains' },
    { from: 2, to: 5, relation: 'contains' }, { from: 2, to: 6, relation: 'contains' }, { from: 2, to: 7, relation: 'contains' }, { from: 2, to: 8, relation: 'contains' },
    { from: 7, to: 2, relation: 'requires' },
    { from: 11, to: 10, relation: 'requires' },
    { from: 13, to: 12, relation: 'requires' },
  ];

  const ev = (id, days, h, m, type, text, payload) => ({ id, ts: shift(days, h, m), type, task_id: null, text, payload: payload ?? {} });
  const events = [
    ev(1, 0, 13, 5, 'TASK_COMPLETED', 'Разобрать одну полку в ванной'),
    ev(2, 0, 12, 0, 'REMINDER_FIRED', 'Оплатить коммуналку — дедлайн сегодня'),
    ev(3, 0, 11, 40, 'TASK_COMPLETED', 'Полить цветы'),
    ev(4, 0, 11, 0, 'PROACTIVE_SENT', 'Дедлайн по коммуналке сегодня: 10 минут, оплатить можно за минуту.'),
    ev(5, 0, 10, 12, 'TASK_COMPLETED', 'Вынести мусор'),
    ev(6, 0, 9, 15, 'SESSION_START', 'Сессия фокуса начата'),
    ev(7, 0, 9, 12, 'AGENT_MESSAGE', 'Начни с замера кухни: 15 минут, а разблокирует четыре задачи.'),
    ev(8, 0, 9, 12, 'USER_MESSAGE', 'что делать?'),
    ev(9, 0, 9, 5, 'STATE_RECORDED', 'энергия 6/10, свободно 60 мин'),
    ev(10, -1, 21, 30, 'PROACTIVE_SENT', 'Ритуал: вчера закрыто 3 дела. Кухня всё ещё ждёт замера.'),
    ev(11, -1, 21, 20, 'SESSION_END', 'Сессия 52 минуты, выполнено 2'),
    ev(12, -1, 20, 44, 'TASK_COMPLETED', 'Почистить пылесос'),
    ev(13, -1, 19, 2, 'TASK_COMPLETED', 'Помыть ванну'),
    ev(14, -1, 18, 30, 'TASK_CREATED', 'Продлить полис ОСАГО (просрочено 3 дня)', { via: 'web' }),
    ev(15, -1, 21, 0, 'STATE_RECORDED', 'энергия 4/10, лёгкое опьянение'),
    ev(16, -1, 23, 4, 'PROACTIVE_SUPPRESSED', 'Тихие часы — предложение перенесено'),
    ev(17, -2, 21, 30, 'PROACTIVE_SENT', 'Ритуал: подведены итоги дня.'),
    ev(18, -2, 16, 40, 'GLM_UNAVAILABLE', 'Таймаут 30 с, повтор через 5 минут'),
    ev(19, -3, 3, 0, 'BACKUP_DONE', 'Резервная копия создана', { file: 'dispatcher-2026-10-07.db' }),
    ev(20, -3, 14, 22, 'AGENT_MESSAGE', 'Стол: цена по 7 объявлениям — 8–11 тыс. Предлагаю 10,5.'),
    ev(21, -3, 14, 20, 'USER_MESSAGE', 'посмотри цены на столы'),
    ev(22, -4, 10, 1, 'TASK_COMPLETED', 'Сфотографировать стол для объявления (черновик)'),
    ev(23, -5, 21, 31, 'PROACTIVE_SENT', 'Ритуал: тихий день. Предложить одно короткое дело?'),
    ev(24, -6, 9, 0, 'STATE_RECORDED', 'энергия 7/10, свободно 120 мин'),
  ];

  const settings = {
    tz: 'Asia/Yekaterinburg',
    proactivity_level: 3,
    quiet_hours: { start: '23:00', end: '09:00' },
    work_hours: { start: '07:00', end: '18:00', days: ['mon', 'tue', 'wed', 'thu', 'fri'] },
    proactive_budget: { max_per_day: 2, min_interval_hours: 4, max_critical_work_per_day: 1 },
    evening_ritual: { enabled: 1, at: '21:30' },
  };

  const backups = [
    { file: 'dispatcher-2026-10-09.db', size: 245760, at: shift(-1, 3, 0) },
    { file: 'dispatcher-2026-10-02.db', size: 231424, at: shift(-8, 3, 0) },
  ];

  const lastState = { energy: 6, available_minutes: 60, intoxication: 'none', recorded_at: shift(0, 9, 5) };
  let session = { ends_at: shift(0, Math.min(23, new Date().getHours() + 1), 30), completed_count: 1 };
  const muted = [{ topic: 'покупка нового стола', mutedUntil: shift(4, 12) }];

  /* ---------- «ранкер» кандидатов ---------- */

  const REASONS = {
    1: ['короткая', 'разблокирует 4 задачи'],
    10: ['короткая', 'подходит под энергию'],
    17: ['займёт 5 минут'],
    20: ['короткая', 'подходит под энергию'],
    31: ['дедлайн сегодня'],
  };
  function buildState() {
    const todayStart = dateStr(0);
    const ranked = [1, 10, 17, 20, 31]
      .map((id) => tasks.find((t) => t.id === id))
      .filter((t) => t && t.status !== 'done' && t.status !== 'cancelled')
      .map((t) => ({ id: t.id, title: t.title, project: t.project_name, est_min: t.estimated_minutes, reasons: REASONS[t.id] ?? [] }));
    const extra = tasks
      .filter((t) => !ranked.some((r) => r.id === t.id) && ['next', 'todo'].includes(t.status) && t.estimated_minutes <= 15)
      .slice(0, 5 - ranked.length)
      .map((t) => ({ id: t.id, title: t.title, project: t.project_name, est_min: t.estimated_minutes, reasons: ['короткая'] }));
    return {
      time: { dateStr: now.toISOString() },
      state: lastState,
      completed_today: tasks.filter((t) => t.completed_at && t.completed_at.slice(0, 10) === todayStart).length,
      next: [...ranked, ...extra].slice(0, 5),
      session,
      muted_topics: muted,
    };
  }

  const stats = {
    today: { completed: 3, proactiveSent: 1, rejected: 0, snoozed: 0 },
    last14: Array.from({ length: 14 }, (_, i) => ({ date: dateStr(i - 13), completed: [0, 1, 0, 2, 3, 1, 0, 4, 2, 1, 3, 2, 0, 3][i] })),
    daysWithProgress7: 6,
    completed7: 15,
    acceptance7: { sent: 9, rejected: 2, snoozed: 1 },
  };

  function recountProjects() {
    const counts = new Map();
    for (const t of tasks) {
      if (t.project_id && !['done', 'cancelled'].includes(t.status)) counts.set(t.project_id, (counts.get(t.project_id) ?? 0) + 1);
    }
    for (const p of projects) p.open_tasks = counts.get(p.id) ?? 0;
  }
  recountProjects();

  function addEvent(type, text, payload) {
    events.unshift({ id: nid(), ts: new Date().toISOString(), type, task_id: null, text, payload: payload ?? {} });
  }

  /* ---------- роутер демо-api ---------- */

  async function handle(method, path, body) {
    await new Promise((r) => setTimeout(r, 180 + Math.random() * 240));
    const p = path.replace(/\?.*$/, '');
    const m = (re) => p.match(re);

    if (p === '/api/auth/login' && method === 'POST') return { ok: true };
    if (p === '/api/state' && method === 'GET') return buildState();
    if (p === '/api/state' && method === 'POST') {
      Object.assign(lastState, body);
      lastState.recorded_at = new Date().toISOString();
      addEvent('STATE_RECORDED', `энергия ${body.energy ?? '?'}/10, свободно ${body.available_minutes ?? '?'} мин`);
      return { ok: true };
    }
    if (p === '/api/stats') return stats;

    if (p === '/api/projects' && method === 'GET') return projects;
    if (p === '/api/projects' && method === 'POST') {
      const proj = { id: nid(), name: body.name, description: body.description ?? '', area: body.area ?? 'other', status: 'active', priority: body.priority ?? 3, open_tasks: 0 };
      projects.push(proj);
      addEvent('PROJECT_UPDATED', `Создан проект «${proj.name}»`, { via: 'web' });
      return proj;
    }
    let q = m(/^\/api\/projects\/(\d+)$/);
    if (q) {
      const id = Number(q[1]);
      const proj = projects.find((x) => x.id === id);
      if (!proj) throw new Error('не найден');
      if (method === 'GET') {
        const tsks = tasks.filter((t) => t.project_id === id);
        return { project: proj, tasks: tsks, blocked_task_ids: tsks.filter((t) => t.status === 'waiting').map((t) => t.id) };
      }
      if (method === 'PATCH') { Object.assign(proj, body); addEvent('PROJECT_UPDATED', `Проект «${proj.name}» → ${proj.status}`, { via: 'web' }); return proj; }
    }

    if (p === '/api/tasks' && method === 'GET') return tasks;
    if (p === '/api/tasks' && method === 'POST') {
      const t = T(nid(), body.project_id ?? null, body.title, { min: body.estimated_minutes ?? null, s: body.status ?? 'todo' });
      tasks.unshift(t);
      addEvent('TASK_CREATED', t.title, { via: 'web' });
      recountProjects();
      return t;
    }
    q = m(/^\/api\/tasks\/(\d+)(\/complete|\/snooze|\/reopen)?$/);
    if (q) {
      const t = tasks.find((x) => x.id === Number(q[1]));
      if (!t) throw new Error('задача не найдена');
      const act = q[2];
      if (method === 'PATCH' && !act) { Object.assign(t, body); return t; }
      if (method === 'POST' && act === '/complete') {
        t.status = 'done';
        t.completed_at = new Date().toISOString();
        addEvent('TASK_COMPLETED', t.title);
        if (session) session.completed_count++;
        recountProjects();
        return { ok: true, task: t, recurrence_instance_id: null };
      }
      if (method === 'POST' && act === '/reopen') {
        t.status = 'todo';
        t.completed_at = null;
        recountProjects();
        return t;
      }
      if (method === 'POST' && act === '/snooze') {
        t.deferred_until = shift(body?.days ?? 1);
        return { ok: true };
      }
    }

    if (p === '/api/memory' && method === 'GET') return memory;
    if (p === '/api/memory' && method === 'POST') {
      const item = { id: nid(), kind: body.kind, content: body.content, source: 'user_told', is_active: true, created_at: new Date().toISOString() };
      memory.unshift(item);
      return item;
    }
    q = m(/^\/api\/memory\/(\d+)$/);
    if (q && method === 'PATCH') {
      const item = memory.find((x) => x.id === Number(q[1]));
      if (item) item.is_active = body.is_active;
      return { ok: true };
    }

    if (p === '/api/events') return events.slice(0, 200);
    if (p === '/api/entities') return { entities, edges };

    if (p === '/api/settings' && method === 'GET') return JSON.parse(JSON.stringify(settings));
    if (p === '/api/settings' && method === 'PATCH') { Object.assign(settings, body); return { ok: true }; }

    if (p === '/api/backup' && method === 'POST') {
      const b = { file: `dispatcher-${dateStr(0)}.db`, size: 236000 + Math.floor(Math.random() * 9000), at: new Date().toISOString() };
      backups.unshift(b);
      addEvent('BACKUP_DONE', `Резервная копия создана (${b.file})`);
      return b;
    }
    if (p === '/api/backups') return backups;

    throw new Error(`демо: нет обработчика ${method} ${p}`);
  }

  return { handle };
})();
