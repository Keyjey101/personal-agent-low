/* Диспетчер — фронтенд без фреймворков: чистые HTML+CSS+JS. */
'use strict';

/* ============================ утилиты ============================ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const ic = (name, cls = '') =>
  `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-${name}"/></svg>`;

const fmt = {
  time: (iso) => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
  dateTime: (iso) => new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
  dateShort: (iso) => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }),
  dateLong(d) {
    const s = d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  },
  weekdayShort(d) {
    const s = d.toLocaleDateString('ru-RU', { weekday: 'short' });
    return s.replace('.', '');
  },
  dateMedium(d) {
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '');
  },
  relDays(iso) {
    const days = Math.round((Date.now() - new Date(iso).getTime()) / 86400000);
    if (days <= 0) return 'сегодня';
    if (days === 1) return 'вчера';
    if (days < 5) return `${days} дня назад`;
    return `${days} дн назад`;
  },
  /* 'YYYY-MM-DD' → «7 окт»; парсим как локальную дату, чтобы не съезжал день */
  day(iso) {
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    const s = new Date(y, m - 1, d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
    return s.replace(/\./g, '');
  },
  size: (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} МБ` : `${Math.max(1, Math.round(n / 1024))} КБ`),
};

const todayISO = () => new Date().toISOString().slice(0, 10);

/* ============================ словари ============================ */

const TASK_STATUS = {
  idea: { ru: 'Идея', tone: 'dim', dot: '' },
  todo: { ru: 'В плане', tone: 'dim', dot: '' },
  next: { ru: 'Следующее', tone: 'next', dot: 'next' },
  active: { ru: 'В работе', tone: 'warn', dot: 'warn' },
  waiting: { ru: 'Ожидание', tone: 'dim', dot: '' },
  done: { ru: 'Готово', tone: 'ok', dot: 'ok' },
  cancelled: { ru: 'Отменена', tone: 'dim', dot: '' },
};

const PROJECT_STATUS = {
  active: 'Активен', paused: 'Пауза', done: 'Завершён', cancelled: 'Отменён',
};

const MEM_KIND = {
  preference: { ru: 'Предпочтение', spine: 'var(--a-massage)' },
  fact: { ru: 'Факт', spine: 'var(--a-fitness)' },
  insight: { ru: 'Инсайт', spine: 'var(--a-other)' },
  routine: { ru: 'Рутина', spine: 'var(--a-kitchen)' },
  pattern: { ru: 'Паттерн', spine: 'var(--a-car)' },
};

const MEM_SOURCE = {
  user_told: 'рассказано владельцем',
  agent: 'заметка агента',
  reflector: 'вывод вечернего ритуала',
};

const EVENT_CAT = {
  USER_MESSAGE: { cat: 'dialog', ru: 'Диалог', color: 'var(--accent)' },
  AGENT_MESSAGE: { cat: 'dialog', ru: 'Диалог', color: 'var(--accent)' },
  TASK_COMPLETED: { cat: 'task', ru: 'Задача', color: 'var(--ok-fill)' },
  TASK_CREATED: { cat: 'task', ru: 'Задача', color: 'var(--ok-fill)' },
  PROACTIVE_SENT: { cat: 'proactive', ru: 'Проактив', color: 'var(--a-other)' },
  PROACTIVE_SUPPRESSED: { cat: 'proactive', ru: 'Проактив', color: 'var(--a-other)' },
  REMINDER_FIRED: { cat: 'reminder', ru: 'Напоминание', color: 'var(--warn-fill)' },
  STATE_RECORDED: { cat: 'state', ru: 'Состояние', color: 'var(--a-massage)' },
  SESSION_START: { cat: 'session', ru: 'Сессия', color: 'var(--a-fitness)' },
  SESSION_END: { cat: 'session', ru: 'Сессия', color: 'var(--a-fitness)' },
  BACKUP_DONE: { cat: 'system', ru: 'Система', color: 'var(--line-strong)' },
  SYSTEM_ERROR: { cat: 'system', ru: 'Система', color: 'var(--bad-fill)' },
  GLM_UNAVAILABLE: { cat: 'system', ru: 'Система', color: 'var(--bad-fill)' },
};
const EVENT_CATS = [
  ['dialog', 'Диалог'], ['task', 'Задача'], ['proactive', 'Проактив'], ['reminder', 'Напоминание'],
  ['state', 'Состояние'], ['session', 'Сессия'], ['system', 'Система'],
];

/* области жизни: явная таблица (цвет = данные, стабильность по имени области) */
const AREAS = {
  kitchen: { ru: 'дом', color: 'var(--a-kitchen)' },
  fitness: { ru: 'форма', color: 'var(--a-fitness)' },
  car: { ru: 'машина', color: 'var(--a-car)' },
  massage: { ru: 'столы', color: 'var(--a-massage)' },
  other: { ru: 'прочее', color: 'var(--a-other)' },
};
const AREA_COLORS = ['var(--a-kitchen)', 'var(--a-fitness)', 'var(--a-car)', 'var(--a-massage)', 'var(--a-other)'];
function areaOf(area) {
  if (area && AREAS[area]) return AREAS[area];
  if (!area) return AREAS.other;
  let h = 0;
  for (const ch of String(area)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const used = new Set(Object.values(AREAS).map((a) => a.color));
  const pool = AREA_COLORS.filter((c) => !used.has(c));
  return { ru: area, color: pool[h % pool.length] ?? AREA_COLORS[h % 5] };
}

const DAYS = [['mon', 'пн'], ['tue', 'вт'], ['wed', 'ср'], ['thu', 'чт'], ['fri', 'пт'], ['sat', 'сб'], ['sun', 'вс']];
const PA_LEVELS = ['выкл', 'только дедлайны', 'обычный', 'инициативный', 'коуч'];
const DANGER_RU = { tools: 'инструмент', heavy: 'тяжёлая', electricity: 'электрика', height: 'высота' };

/* шкала цвета энергии 1–10: от брусники через янтарь к хвое */
const energyColor = (v) => (
  v <= 2 ? 'var(--a-car)' : v <= 4 ? 'var(--a-kitchen)' : v <= 6 ? 'var(--warn-fill)' : v <= 8 ? 'var(--ok-fill)' : 'var(--ok)'
);

/* ============================ api ============================ */

const DEMO = window.__DISPATCHER_DEMO__ || null;
const demoActive = () => DEMO !== null && new URLSearchParams(location.search).has('demo');

class Unauthorized extends Error { constructor() { super('unauthorized'); } }

async function request(method, path, body) {
  if (demoActive()) return DEMO.handle(method, path, body);
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 401) { showLogin(); throw new Unauthorized(); }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

const apiGet = (p) => request('GET', p);
const apiPost = (p, b) => request('POST', p, b ?? {});
const apiPatch = (p, b) => request('PATCH', p, b);

/* ============================ состояние ============================ */

const S = {
  route: 'today',
  taskFilter: { statuses: new Set(['todo', 'next', 'active', 'waiting']), overdue: false },
  tasksLimit: 30,
  actLimit: 40,
  actCats: new Set(),
  projFilter: 'active',
  projOpen: new Set(),
  memTab: 'all',
  graph: { zoom: 1, kinds: new Set(['place', 'object', 'equipment']), sel: null, pos: new Map(), base: new Map() },
  settings: null,
  settingsPristine: null,
  checkin: null,
  stateCache: null,
};

const ROUTES = ['today', 'projects', 'tasks', 'graph', 'memory', 'activity', 'settings'];

/* ============================ тосты ============================ */

function toast(kind, msg, action, ttl = 3800) {
  const box = $('#toasts');
  while (box.children.length >= 3) box.firstChild.remove();
  const t = document.createElement('div');
  t.className = `toast toast--${kind}`;
  t.innerHTML = `<span>${esc(msg)}</span>`;
  if (action) {
    const b = document.createElement('button');
    b.className = 'btn btn--quiet btn--sm';
    b.textContent = action.label;
    b.onclick = () => { clearTimeout(timer); dismiss(); action.action(); };
    t.append(b);
  }
  const x = document.createElement('button');
  x.className = 'iconbtn toast-x';
  x.setAttribute('aria-label', 'Закрыть');
  x.innerHTML = ic('x');
  x.onclick = () => { clearTimeout(timer); dismiss(); };
  t.append(x);
  box.append(t);
  const timer = setTimeout(dismiss, ttl);
  function dismiss() {
    t.classList.add('leaving');
    setTimeout(() => t.remove(), reducedMotion() ? 0 : 200);
  }
}

/* ============================ каркас ============================ */

function showLogin() {
  $('#app').hidden = true;
  $('#login').hidden = false;
  $('#loginPassword').focus();
}
function showApp() {
  $('#login').hidden = true;
  $('#app').hidden = false;
}

function tickClock() {
  const now = new Date();
  $('#mastClock').innerHTML =
    `<span class="mast-date">${esc(fmt.weekdayShort(now))}, ${esc(fmt.dateMedium(now))}</span>` +
    `<span class="mast-time">${esc(now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }))}</span>`;
}

function renderMastChips(state) {
  const box = $('#mastChips');
  const st = state?.state;
  if (!st) {
    box.innerHTML = `<a class="mast-chip" href="#/today" title="Сообщить состояние">${ic('bolt')}чек-ин</a>`;
    return;
  }
  let html = `<a class="mast-chip" href="#/today" title="Энергия — изменить">${ic('bolt')}${st.energy ?? '?'}/10</a>`;
  if (st.available_minutes != null) {
    html += `<a class="mast-chip" href="#/today" title="Свободное время — изменить">${ic('hourglass')}${st.available_minutes} мин</a>`;
  }
  box.innerHTML = html;
}

function currentRoute() {
  const h = location.hash.replace(/^#\/?/, '').split('?')[0];
  return ROUTES.includes(h) ? h : 'today';
}

function syncNav() {
  const r = S.route;
  const moreRoutes = ['graph', 'memory', 'activity', 'settings'];
  $$('#tabs a, .bottomnav a, .sheet a').forEach((a) => {
    if (a.dataset.route) a.toggleAttribute('aria-current', a.dataset.route === r);
  });
  const moreBtn = $('#moreBtn');
  if (moreBtn) moreBtn.classList.toggle('more-on', moreRoutes.includes(r));
  moveTabsInk();
}

function moveTabsInk() {
  const tabs = $('#tabs');
  const ink = $('.tabs-ink', tabs);
  const active = $('a[aria-current="page"]', tabs) ?? $('a', tabs);
  if (!ink || !active) return;
  ink.style.width = `${active.offsetWidth}px`;
  ink.style.transform = `translateX(${active.offsetLeft}px)`;
}

/* шит «Ещё» */
function openSheet() {
  const sh = $('#sheet');
  sh.hidden = false;
  $('#sheetBackdrop').hidden = false;
  const more = $('#moreBtn');
  more.setAttribute('aria-expanded', 'true');
  requestAnimationFrame(() => {
    sh.classList.add('open');
    $('#sheetBackdrop').classList.add('open');
  });
  sh.querySelector('a, button')?.focus();
}
function closeSheet() {
  const sh = $('#sheet'), bd = $('#sheetBackdrop');
  if (sh.hidden) return;
  sh.classList.remove('open');
  bd.classList.remove('open');
  $('#moreBtn').setAttribute('aria-expanded', 'false');
  $('#moreBtn').focus({ preventScroll: true });
  setTimeout(() => {
    /* гард от гонки: за 240 мс лист могли успеть открыть заново */
    if (sh.classList.contains('open')) return;
    sh.hidden = true;
    bd.hidden = true;
  }, reducedMotion() ? 0 : 240);
}

/* ============================ роутер и рендер ============================ */

function skeletonFor(route) {
  const wrap = document.createElement('div');
  if (route === 'today') {
    wrap.innerHTML = '<div class="skel skel--hero"></div>' + '<div class="skel skel--card"></div>'.repeat(2);
  } else if (route === 'graph') {
    wrap.innerHTML = '<div class="skel" style="height:420px;border-radius:12px"></div>';
  } else if (route === 'settings') {
    wrap.innerHTML = '<div class="skel skel--card"></div>'.repeat(3);
  } else {
    wrap.innerHTML = '<div class="skel skel--card" style="height:76px"></div>' + '<div class="skel skel--strip"></div>'.repeat(5);
  }
  return wrap;
}

function errorState(e) {
  return `<div class="empty"><svg class="e-icon" viewBox="0 0 24 24"><use href="#i-warn"/></svg>
    <div class="e-title">Не получилось загрузить</div>
    <div class="e-sub">${esc(e.message)}</div>
    <button class="btn btn--ghost" data-action="retry">Повторить</button></div>`;
}

const PAGE_TITLES = {
  today: 'Сегодня', projects: 'Проекты', tasks: 'Задачи', graph: 'Граф знаний',
  memory: 'Память', activity: 'Журнал', settings: 'Настройки',
};

async function render() {
  const route = S.route;
  const main = $('#content');
  /* скелетон — только при смене раздела; на том же разделе старый контент живёт до подмены */
  const soft = S.lastRoute === route && main.children.length > 0;
  if (!soft) {
    main.classList.remove('page-enter');
    main.innerHTML = '';
    main.append(skeletonFor(route));
  }
  try {
    const html = await PAGES[route].render();
    if (S.route !== route) return;
    main.innerHTML = html;
    S.lastRoute = route;
    if (!soft) {
      void main.offsetWidth; /* перезапуск анимации входа */
      main.classList.add('page-enter');
    }
    document.title = `${PAGE_TITLES[route] ?? 'Диспетчер'} · Диспетчер`;
    PAGES[route].after?.();
  } catch (e) {
    if (e instanceof Unauthorized) return;
    if (S.route !== route) return;
    /* soft-режим: живой контент не стираем, ошибку показываем тостом */
    if (soft) { toast('bad', `Не получилось обновить: ${e.message}`); return; }
    main.innerHTML = errorState(e);
  }
}

function rerender() { return render(); }

/* ============================ общие компоненты ============================ */

function tallySVG(n) {
  if (n <= 0) return '';
  const groups = Math.ceil(n / 5);
  let lines = '';
  let k = 0;
  for (let g = 0; g < groups; g++) {
    const inGroup = Math.min(5, n - g * 5);
    const x0 = g * 40;
    for (let i = 0; i < Math.min(inGroup, 4); i++) {
      lines += `<line class="tally-line" x1="${x0 + i * 8}" y1="2" x2="${x0 + i * 8}" y2="20" style="animation-delay:${k++ * 60}ms"/>`;
    }
    if (inGroup === 5) {
      lines += `<line class="tally-line" x1="${x0 - 4}" y1="17" x2="${x0 + 28}" y2="4" style="animation-delay:${k++ * 60}ms"/>`;
    }
  }
  return `<span class="tally" title="Сделано сегодня: ${n}">
    <svg width="${groups * 40 - 8}" height="22" viewBox="0 0 ${groups * 40 - 8} 22" aria-hidden="true">${lines}</svg>
    <span class="tally-num">${n}</span></span>`;
}

function scaleDots(level, max, cls = '') {
  let out = `<span class="scale ${cls}" role="img" aria-label="${level} из ${max}">`;
  for (let i = 1; i <= max; i++) out += `<i class="${i <= level ? 'f' : ''}"></i>`;
  return out + '</span>';
}

function areaChip(area) {
  const a = areaOf(area);
  return `<span class="area" style="--edge:${a.color}">${esc(a.ru)}</span>`;
}

function statusBadge(status) {
  const st = TASK_STATUS[status] ?? { ru: status, tone: 'dim' };
  return `<span class="badge badge--${st.tone}">${st.ru}</span>`;
}

const DOG_SVG = `<svg class="empty-dog" viewBox="0 0 120 60" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M96 4 C 88 12, 80 14, 71 17" stroke-dasharray="1 5"/>
  <circle cx="65" cy="20" r="6.5"/>
  <path d="M67.5 14.5 l3.5 -5.5"/>
  <path d="M71.5 20 h5"/><circle cx="78" cy="20" r="1" fill="currentColor" stroke="none"/>
  <circle cx="63.5" cy="18.5" r="0.8" fill="currentColor" stroke="none"/>
  <rect x="32" y="15" width="29" height="12" rx="6"/>
  <path d="M32 19 q-9 1 -8 -9"/>
  <path d="M38 27 v11"/>
  <path d="M45 27 v11"/>
  <path d="M52 27 l2 11"/>
  <path d="M57 27 l3 10"/>
  <path d="M6 52 h14" stroke-dasharray="2 6"/>
  <path d="M38 54 h12" stroke-dasharray="2 6"/>
  <path d="M72 52 h16" stroke-dasharray="2 6"/>
</svg>`;

/* ============================ страница «Сегодня» ============================ */

const PAGES = {};

PAGES.today = {
  async render() {
    const [state, stats] = await Promise.all([
      apiGet('/api/state'), apiGet('/api/stats').catch(() => null),
    ]);
    S.stateCache = state;
    renderMastChips(state);
    S.checkin = { energy: state.state?.energy ?? 5, minutes: state.state?.available_minutes ?? 60, intoxication: state.state?.intoxication ?? 'none', saved: false };

    const top = state.next[0];
    const now = new Date();

    let html = `<div class="page-head"><h2 class="page-title">${esc(fmt.dateLong(now))}</h2>${tallySVG(state.completed_today)}</div>`;

    /* hero */
    html += `<section class="section">`;
    if (top) {
      const area = top.project ? areaOf(guessAreaByName(top.project)) : null;
      html += `<div class="hero hero-enter" id="hero" style="--edge:${area?.color ?? 'var(--line-strong)'}">
        <div class="hero-kicker">Сейчас</div>
        <h3 class="hero-title">${esc(top.title)}</h3>
        <div class="hero-meta">
          <span class="mono">~${top.est_min ?? '?'} мин</span>
          ${area ? `<span class="sep">·</span>${areaChip(guessAreaByName(top.project))}<span>${esc(top.project)}</span>` : ''}
          ${top.reasons.slice(0, 2).map((r) => `<span class="sep">·</span><span>${esc(r)}</span>`).join('')}
        </div>
        ${state.session ? `<div class="hero-meta"><span class="badge badge--warn">${ic('clock')} сессия до ${esc(fmt.time(state.session.ends_at))} · выполнено ${state.session.completed_count}</span></div>` : ''}
        <div class="hero-actions">
          <button class="btn btn--primary" id="heroBtn" data-action="complete-hero" data-id="${top.id}">${ic('check')} Сделал</button>
          <button class="btn btn--ghost" data-action="snooze-hero" data-id="${top.id}">${ic('clock')} Потом</button>
        </div>
      </div>`;
    } else {
      html += `<div class="card empty">
        ${DOG_SVG}
        <div class="e-title">Сейчас ничего не подходит</div>
        <div class="e-sub">Под текущее состояние дел нет. Самое время прогуляться — или сообщить новое состояние.</div>
        <button class="btn btn--ghost" data-action="goto-checkin">Сменить состояние</button>
      </div>`;
    }
    html += `</section>`;

    /* чек-ин */
    html += checkinHTML(state);

    /* кандидаты */
    if (state.next.length > 1) {
      html += `<section class="section"><div class="section-title">Кандидаты</div>`;
      for (const n of state.next.slice(1)) {
        html += taskStripHTML(n, { candidate: true });
      }
      html += `</section>`;
    }

    /* динамика */
    if (stats) {
      const max = Math.max(1, ...stats.last14.map((d) => d.completed));
      const bars = stats.last14.map((d, i) => {
        const isToday = i === stats.last14.length - 1;
        const cls = d.completed === 0 ? 'bar--zero' : isToday ? 'bar--today' : '';
        const h = d.completed === 0 ? 2 : Math.max(8, Math.round((d.completed / max) * 100));
        return `<div class="bar ${cls}" style="--i:${i};height:${h}%" title="${esc(d.date)}: ${d.completed}" aria-label="${esc(d.date)}: ${d.completed}"></div>`;
      }).join('');
      const rej = stats.acceptance7.rejected + stats.acceptance7.snoozed;
      html += `<section class="section">
        <div class="section-title">Динамика · 14 дней</div>
        <div class="bars-wrap mm">
          <div class="bars">${bars}</div>
          <div class="bars-axis"><span>${esc(fmt.day(stats.last14[0].date))}</span><span>сегодня</span></div>
        </div>
        <div class="stats-line">
          <span>за 7 дней: <b>${stats.completed7}</b> задач</span>
          <span>дней с делами: <b>${stats.daysWithProgress7}/7</b></span>
          <span>предложений отклонено: <b>${rej}/${stats.acceptance7.sent}</b></span>
        </div>
      </section>`;
    }

    /* замученные темы */
    if (state.muted_topics?.length) {
      html += `<section class="section"><div class="section-title">Не беспокоить по темам</div><div class="card">`;
      for (const m of state.muted_topics) {
        html += `<div class="row small" style="padding:6px 0">
          <span class="badge badge--dim">${esc(m.topic)}</span>
          <span class="mono dim" style="font-size:12px">до ${esc(fmt.dateShort(m.mutedUntil))}</span>
        </div>`;
      }
      html += `</div></section>`;
    }

    return html;
  },
};

/* угадать область по имени проекта (для задач без area в ответе) */
function guessAreaByName(name) {
  if (!name) return 'other';
  const n = String(name).toLowerCase();
  if (n.includes('кухн') || n.includes('ремонт')) return 'kitchen';
  if (n.includes('стол')) return 'massage';
  if (n.includes('машин') || n.includes('авто')) return 'car';
  if (n.includes('форм') || n.includes('тренир') || n.includes('гиря')) return 'fitness';
  return 'other';
}

function taskStripHTML(n, opts = {}) {
  const area = n.project ? areaOf(guessAreaByName(n.project)) : null;
  const overdue = n.due_at && n.due_at < todayISO() && n.status !== 'done' && n.status !== 'cancelled';
  return `<div class="strip strip--hoverable ${overdue ? 'strip--overdue' : ''}" ${area ? `style="--edge:${area.color}"` : ''}>
    <div class="strip-main">
      <div class="strip-title">${esc(n.title)}</div>
      <div class="strip-meta">
        ${n.est_min != null ? `<span>~${n.est_min} мин</span><span class="sep">·</span>` : ''}
        ${area ? `<span>${areaChip(guessAreaByName(n.project))}<span class="ui">${esc(n.project)}</span></span><span class="sep">·</span>` : ''}
        ${n.reasons?.length ? `<span>${esc(n.reasons[0])}</span>` : ''}
        ${overdue ? `<span class="overdue">просрочено · ${esc(fmt.day(n.due_at))}</span>` : ''}
      </div>
    </div>
    <div class="strip-side">
      ${opts.candidate ? `<span class="badge badge--dim">кандидат</span>` : ''}
      <div class="strip-actions">
        <button class="btn btn--ghost btn--sm" data-action="complete-task" data-id="${n.id}" aria-label="Отметить выполненной">${ic('check')} готово</button>
      </div>
    </div>
  </div>`;
}

function checkinHTML(state) {
  const c = S.checkin;
  if (c.saved) {
    return `<section class="section card"><div class="checkin-done">
      ${ic('check')} <span>Состояние записано: энергия <b>${c.energy}/10</b>, свободно <b>${c.minutes} мин</b></span>
      <span class="mono">в ${esc(fmt.time(c.saved))}</span>
      <button class="btn btn--quiet btn--sm" data-action="edit-checkin">Изменить</button>
    </div></section>`;
  }
  const segs = Array.from({ length: 10 }, (_, i) => {
    const v = i + 1;
    return `<button type="button" class="seg ${v === c.energy ? 'seg--on' : ''}" style="--seg:${energyColor(v)}" data-action="set-energy" data-v="${v}" aria-label="Энергия ${v} из 10" aria-pressed="${v === c.energy}">${v}</button>`;
  }).join('');
  const mins = [15, 30, 60, 120, 300].map((m) =>
    `<button type="button" class="chip ${m === c.minutes ? 'chip--on' : ''}" data-action="set-minutes" data-v="${m}" aria-pressed="${m === c.minutes}">${m === 300 ? 'весь вечер' : `${m} мин`}</button>`
  ).join('');
  const inttx = [['none', 'норма'], ['mild', 'лёгкое'], ['significant', 'сильное']].map(([v, ru]) =>
    `<button type="button" class="chip ${v === c.intoxication ? 'chip--on' : ''}" data-action="set-intox" data-v="${v}" aria-pressed="${v === c.intoxication}">${ru}</button>`
  ).join('');
  return `<section class="section card checkin" id="checkin">
    <div class="section-title">Чек-ин состояния</div>
    <div>
      <div class="checkin-row-label">${ic('bolt')} Энергия сейчас</div>
      <div class="segs">${segs}</div>
    </div>
    <div>
      <div class="checkin-row-label">${ic('hourglass')} Свободно времени</div>
      <div class="row">${mins}</div>
    </div>
    <div>
      <div class="checkin-row-label">${ic('glass')} Состояние</div>
      <div class="row">${inttx}</div>
    </div>
    <div><button class="btn btn--primary" data-action="save-checkin">Записать</button></div>
  </section>`;
}

/* ============================ страница «Проекты» ============================ */

PAGES.projects = {
  async render() {
    const projects = await apiGet('/api/projects');
    S.projProjects = projects;
    const filtered = projects.filter((p) =>
      S.projFilter === 'all' ? true : S.projFilter === 'paused' ? p.status === 'paused' : p.status === 'active'
    );
    const active = projects.filter((p) => p.status === 'active').length;
    const paused = projects.filter((p) => p.status === 'paused').length;

    let html = `<div class="page-head">
      <h2 class="page-title">Проекты</h2>
      <span class="page-sub">активных ${active} · на паузе ${paused}</span>
    </div>
    <section class="section">
      <div class="card add-strip">
        <input type="text" id="newProjName" placeholder="Новый проект — например, «Ремонт ванной»" maxlength="120" />
        <button class="btn btn--primary btn--sm" data-action="add-project">${ic('plus')} Создать</button>
      </div>
    </section>
    <section class="section">
      <div class="filterbar">
        <div class="seg-filter" role="group" aria-label="Фильтр проектов">
          ${[['active', 'Активные'], ['paused', 'Пауза'], ['all', 'Все']].map(([v, ru]) =>
            `<button class="${S.projFilter === v ? 'on' : ''}" data-action="proj-filter" data-v="${v}" aria-pressed="${S.projFilter === v}">${ru}</button>`).join('')}
        </div>
      </div>`;

    if (!filtered.length) {
      html += `<div class="empty">
        <svg class="e-icon" viewBox="0 0 24 24"><use href="#i-box"/></svg>
        <div class="e-title">${projects.length ? 'Под фильтр ничего не попало' : 'Проектов пока нет'}</div>
        <div class="e-sub">${projects.length ? 'Попробуй другой фильтр.' : 'Создай первый проект — диспетчер начнёт строить план.'}</div>
      </div>`;
    }
    for (const p of filtered) {
      const area = areaOf(p.area);
      html += `<div class="strip strip--hoverable" style="--edge:${area.color}">
        <div class="strip-main">
          <div class="proj-head">
            <span class="strip-title">${esc(p.name)}</span>
            ${areaChip(p.area)}
          </div>
          <div class="strip-meta">
            <span title="Приоритет">${scaleDots(p.priority ?? 3, 5, 'scale--prio')}</span><span class="sep">·</span>
            <span class="proj-count">${p.open_tasks} открытых</span>
            ${p.status !== 'active' ? `<span class="sep">·</span><span class="badge ${p.status === 'done' ? 'badge--ok' : 'badge--dim'}">${PROJECT_STATUS[p.status] ?? p.status}</span>` : ''}
          </div>
        </div>
        <div class="strip-side">
          <button class="iconbtn proj-toggle" data-action="toggle-proj" data-id="${p.id}" aria-expanded="${S.projOpen.has(p.id)}" aria-label="Задачи проекта ${esc(p.name)}">${ic('chev')}</button>
        </div>
      </div>
      <div class="proj-panel ${S.projOpen.has(p.id) ? '' : 'hidden'}" data-panel="${p.id}">${S.projOpen.has(p.id) ? '<div class="skel skel--strip"></div>' : ''}</div>`;
    }
    html += `</section>`;
    return html;
  },
  async after() {
    for (const id of S.projOpen) await loadProjectPanel(id);
  },
};

async function loadProjectPanel(id) {
  const panel = $(`[data-panel="${id}"]`);
  if (!panel) return;
  try {
    const d = await apiGet(`/api/projects/${id}`);
    const done = d.tasks.filter((t) => t.status === 'done' || t.status === 'cancelled').length;
    let html = `<div class="proj-progress">${done}/${d.tasks.length} закрыто</div>
      <div class="row" style="margin-bottom:10px">
        <label class="field"><span class="field-label">Статус</span>
          <select data-change="proj-status" data-id="${id}">
            ${Object.entries(PROJECT_STATUS).map(([v, ru]) => `<option value="${v}" ${v === d.project.status ? 'selected' : ''}>${ru}</option>`).join('')}
          </select>
        </label>
      </div>`;
    if (!d.tasks.length) html += `<div class="dim small">Задач нет — добавь первую на странице «Задачи».</div>`;
    for (const t of d.tasks) {
      const blocked = d.blocked_task_ids.includes(t.id);
      html += `<div class="strip ${blocked ? 'strip--blocked' : ''}" style="--edge:${areaOf(d.project.area).color}">
        <div class="strip-main">
          <div class="strip-title">${esc(t.title)}${blocked ? `<span class="lock" title="Заблокировано другой задачей">${ic('lock')}</span>` : ''}</div>
          <div class="strip-meta">
            ${t.estimated_minutes != null ? `<span>~${t.estimated_minutes} мин</span><span class="sep">·</span>` : ''}
            ${t.energy_required != null ? `<span title="Нужна энергия">${scaleDots(t.energy_required, 5)}</span><span class="sep">·</span>` : ''}
            ${t.due_at ? `<span>до ${esc(fmt.day(t.due_at))}</span><span class="sep">·</span>` : ''}
          </div>
        </div>
        <div class="strip-side">${statusBadge(t.status)}</div>
      </div>`;
    }
    panel.innerHTML = html;
  } catch (e) {
    panel.innerHTML = `<div class="field-error">${esc(e.message)}</div>`;
  }
}

/* ============================ страница «Задачи» ============================ */

PAGES.tasks = {
  async render() {
    const [tasks, projects] = await Promise.all([apiGet('/api/tasks'), apiGet('/api/projects')]);
    S.tasksAll = tasks;
    S.taskProjects = projects;
    const { statuses, overdue } = S.taskFilter;
    let filtered = tasks.filter((t) => statuses.size === 0 || statuses.has(t.status));
    if (overdue) filtered = filtered.filter((t) => t.due_at && t.due_at < todayISO() && t.status !== 'done' && t.status !== 'cancelled');
    const shown = filtered.slice(0, S.tasksLimit);

    let html = `<div class="page-head">
      <h2 class="page-title">Задачи</h2>
      <span class="page-sub">показано ${shown.length} из ${filtered.length}</span>
    </div>
    <section class="section">
      <div class="card add-strip">
        <input type="text" id="newTaskTitle" placeholder="Что сделать? Следующее физическое действие" maxlength="200" />
        <select id="newTaskProject" aria-label="Проект">
          <option value="">— входящие —</option>
          ${projects.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}
        </select>
        <input type="number" id="newTaskMin" placeholder="мин" min="1" max="600" style="width:76px" aria-label="Оценка в минутах" />
        <button class="btn btn--primary btn--sm" data-action="add-task">${ic('plus')} Добавить</button>
      </div>
    </section>
    <section class="section">
      <div class="filterbar">
        ${Object.entries(TASK_STATUS).map(([v, st]) =>
          `<button class="chip ${statuses.has(v) ? 'chip--on' : ''}" data-action="toggle-status-filter" data-v="${v}" aria-pressed="${statuses.has(v)}">${st.ru}</button>`).join('')}
        <button class="chip ${overdue ? 'chip--on' : ''}" data-action="toggle-overdue-filter" aria-pressed="${overdue}">${ic('warn')} Просроченные</button>
      </div>`;

    if (!shown.length) {
      html += `<div class="empty">
        <svg class="e-icon" viewBox="0 0 24 24"><use href="#i-checks"/></svg>
        <div class="e-title">${tasks.length ? 'Под фильтр ничего не попало' : 'Задач пока нет'}</div>
        <div class="e-sub">${tasks.length ? 'Смени фильтр или сбрось его.' : 'Добавь первую выше — одну короткую, чтобы началось.'}</div>
        ${tasks.length ? `<button class="btn btn--ghost btn--sm" data-action="reset-task-filter">Сбросить фильтр</button>` : ''}
      </div>`;
    }
    for (const t of shown) {
      const st = TASK_STATUS[t.status] ?? TASK_STATUS.todo;
      const area = t.project_id ? areaOf(projects.find((p) => p.id === t.project_id)?.area ?? guessAreaByName(t.project_name)) : null;
      const od = t.due_at && t.due_at < todayISO() && t.status !== 'done' && t.status !== 'cancelled';
      html += `<div class="strip strip--hoverable ${od ? 'strip--overdue' : ''}" ${area ? `style="--edge:${area.color}"` : ''}>
        <button class="task-status-btn" data-action="status-menu" data-id="${t.id}" aria-haspopup="menu" aria-label="Статус: ${st.ru}">
          <span class="dot ${st.dot ? `dot--${st.dot}` : ''}"></span>${st.ru}${ic('chev')}
        </button>
        <div class="strip-main">
          <div class="strip-title" ${t.status === 'done' ? 'style="text-decoration:line-through;color:var(--ink-3)"' : ''}>${esc(t.title)}</div>
          <div class="strip-meta">
            ${t.estimated_minutes != null ? `<span>~${t.estimated_minutes} мин</span><span class="sep">·</span>` : ''}
            ${t.project_name ? `<span>${areaChip(t.project_id ? projects.find((p) => p.id === t.project_id)?.area ?? guessAreaByName(t.project_name) : guessAreaByName(t.project_name))} ${esc(t.project_name)}</span><span class="sep">·</span>` : ''}
            ${t.energy_required != null ? `<span title="Нужна энергия">${scaleDots(t.energy_required, 5)}</span><span class="sep">·</span>` : ''}
            ${t.due_at ? `<span class="${od ? 'overdue' : ''}">до ${esc(fmt.day(t.due_at))}</span>` : ''}
            ${t.danger_level && DANGER_RU[t.danger_level] ? `<span class="sep">·</span><span class="badge badge--warn">${esc(DANGER_RU[t.danger_level])}</span>` : ''}
          </div>
        </div>
        <div class="strip-side">
          <div class="strip-actions">
            ${t.status === 'done'
              ? `<button class="btn btn--ghost btn--sm" data-action="reopen-task" data-id="${t.id}">${ic('undo')} вернуть</button>`
              : `<button class="btn btn--ghost btn--sm" data-action="complete-task" data-id="${t.id}">${ic('check')} готово</button>`}
          </div>
        </div>
      </div>`;
    }
    if (filtered.length > shown.length) {
      html += `<div class="more-wrap"><button class="btn btn--ghost" data-action="more-tasks">Показать ещё · ${filtered.length - shown.length}</button></div>`;
    }
    html += `</section>`;
    return html;
  },
};

/* меню смены статуса */
function openStatusMenu(btn) {
  closeMenus();
  const id = btn.dataset.id;
  const t = S.tasksAll?.find((x) => x.id === Number(id));
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = Object.entries(TASK_STATUS).map(([v, st]) =>
    `<button role="menuitem" data-menu-status="${v}" class="${t && t.status === v ? 'cur' : ''}">
      ${st.ru}<span class="dot ${st.dot ? `dot--${st.dot}` : ''}"></span>
    </button>`).join('');
  document.body.append(menu);
  const r = btn.getBoundingClientRect();
  const mh = menu.offsetHeight || 300;
  menu.style.top = `${Math.max(12, Math.min(r.bottom + 6 + window.scrollY, document.documentElement.scrollHeight - mh - 12))}px`;
  menu.style.left = `${Math.max(8, Math.min(r.left + window.scrollX, document.documentElement.scrollWidth - 190))}px`;
  menu.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-menu-status]');
    if (!b) return;
    closeMenus();
    try {
      await apiPatch(`/api/tasks/${id}`, { status: b.dataset.menuStatus });
      rerender();
    } catch (err) { toast('bad', err.message); }
  });
}
function closeMenus() { $$('.menu').forEach((m) => m.remove()); }

/* ============================ страница «Граф» ============================ */

const KIND_RU = { place: 'место', object: 'объект', equipment: 'оборудование' };
const KIND_COLOR = { place: 'var(--a-massage)', object: 'var(--a-kitchen)', equipment: 'var(--a-other)' };
const REL_RU = { contains: 'содержит', requires: 'требует' };

PAGES.graph = {
  async render() {
    const d = await apiGet('/api/entities');
    S.graphData = d;
    if (!S.graph.base.size) layoutGraph(d.entities);
    const kinds = new Set(d.entities.map((e) => e.kind));

    let html = `<div class="page-head">
      <h2 class="page-title">Граф знаний</h2>
      <span class="page-sub">${d.entities.length} узлов · ${d.edges.length} связей</span>
    </div>
    <section class="section">
      <div class="card graph-card mm">
        <div class="graph-toolbar">
          ${[...kinds].map((k) =>
            `<button class="chip ${S.graph.kinds.has(k) ? 'chip--on' : ''}" data-action="graph-kind" data-v="${k}" aria-pressed="${S.graph.kinds.has(k)}">
              <span class="dot" style="background:${KIND_COLOR[k]}"></span>${KIND_RU[k] ?? k}
            </button>`).join('')}
          <span class="grow"></span>
          <button class="iconbtn" data-action="graph-zoom" data-v="1" aria-label="Приблизить" title="Приблизить">${ic('zoom-in')}</button>
          <button class="iconbtn" data-action="graph-zoom" data-v="-1" aria-label="Отдалить" title="Отдалить">${ic('zoom-out')}</button>
        </div>
        ${d.entities.length ? `<div id="graphBox"></div>` : `<div class="empty">
          <svg class="e-icon" viewBox="0 0 24 24"><use href="#i-graph"/></svg>
          <div class="e-title">Граф пока пуст</div>
          <div class="e-sub">Узлы появятся, когда агент начнёт связывать задачи с местами и вещами.</div>
        </div>`}
      </div>
    </section>
    <p class="dim small">Узел можно перетащить. Клик подсвечивает соседей и показывает связи.</p>`;
    return html;
  },
  after() { if (S.graphData?.entities?.length) drawGraph(); },
};

function layoutGraph(entities) {
  const G = S.graph;
  G.W = 640; G.H = 560; G.cx = G.W / 2; G.cy = G.H / 2;
  const byKind = { place: [], object: [], equipment: [] };
  entities.forEach((e) => (byKind[e.kind] ??= []).push(e));
  const rings = [
    [byKind.place, 105],
    [byKind.object, 185],
    [byKind.equipment, 235],
  ];
  for (const [list, r] of rings) {
    list.forEach((e, i) => {
      const a = (2 * Math.PI * i) / Math.max(list.length, 1) - Math.PI / 2;
      G.base.set(e.id, { x: G.cx + r * Math.cos(a), y: G.cy + r * Math.sin(a) });
    });
  }
}

function graphPos(id) {
  const b = S.graph.base.get(id) ?? { x: S.graph.cx, y: S.graph.cy };
  const o = S.graph.pos.get(id) ?? { x: 0, y: 0 };
  return { x: b.x + o.x, y: b.y + o.y };
}

function graphViewBox() {
  const G = S.graph;
  const z = G.zoom;
  return `${G.cx - G.cx * z} ${G.cy - G.cy * z} ${G.W * z} ${G.H * z}`;
}

function drawGraph() {
  const box = $('#graphBox');
  if (!box) return;
  const { entities, edges } = S.graphData;
  const G = S.graph;
  const sel = G.sel;
  const neighbors = new Set();
  if (sel != null) {
    for (const ed of edges) {
      if (ed.from === sel) neighbors.add(ed.to);
      if (ed.to === sel) neighbors.add(ed.from);
    }
  }

  let svg = `<svg class="graph-svg" id="graphSvg" viewBox="${graphViewBox()}" role="group" aria-label="Граф знаний">`;
  for (const ed of edges) {
    const a = graphPos(ed.from), b = graphPos(ed.to);
    const c1 = { x: a.x + (G.cx - a.x) * 0.25, y: a.y + (G.cy - a.y) * 0.25 };
    const c2 = { x: b.x + (G.cx - b.x) * 0.25, y: b.y + (G.cy - b.y) * 0.25 };
    const dim = (sel != null && ed.from !== sel && ed.to !== sel) || !G.kinds.has(kindOf(ed.from)) || !G.kinds.has(kindOf(ed.to));
    const hi = sel != null && (ed.from === sel || ed.to === sel);
    svg += `<path class="g-edge ${dim ? 'g-dim' : ''} ${hi ? 'g-hi' : ''}" data-edge="1" data-from="${ed.from}" data-to="${ed.to}" d="M${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}"/>`;
    if (hi) {
      svg += `<text class="g-edge-label" data-edge-label="1" data-from="${ed.from}" data-to="${ed.to}" x="${(a.x + b.x) / 2}" y="${(a.y + b.y) / 2 - 6}" text-anchor="middle">${esc(REL_RU[ed.relation] ?? ed.relation)}</text>`;
    }
  }
  for (const e of entities) {
    const p = graphPos(e.id);
    const dim = !G.kinds.has(e.kind) || (sel != null && e.id !== sel && !neighbors.has(e.id));
    const name = e.name.length > 18 ? e.name.slice(0, 17) + '…' : e.name;
    svg += `<g class="g-node ${dim ? 'g-dim' : ''}" data-node="${e.id}" tabindex="0" role="button" aria-label="${esc(e.name)} — ${esc(KIND_RU[e.kind] ?? e.kind)}">
      <title>${esc(e.name)} · ${esc(KIND_RU[e.kind] ?? e.kind)}</title>
      <circle cx="${p.x}" cy="${p.y}" r="15" style="--edge:${KIND_COLOR[e.kind] ?? 'var(--line-strong)'};--node:${sel === e.id ? 'var(--accent-soft)' : 'var(--card)'}"/>
      <text x="${p.x}" y="${p.y + 28}" text-anchor="middle">${esc(name)}</text>
    </g>`;
  }
  svg += '</svg>';
  box.innerHTML = svg;
  bindGraphEvents();
  /* клавиатурный пользователь не теряет позицию после перерисовки */
  if (G.sel != null) box.querySelector(`[data-node="${G.sel}"]`)?.focus({ preventScroll: true });
}

const kindOf = (id) => S.graphData.entities.find((e) => e.id === id)?.kind;

function bindGraphEvents() {
  const svg = $('#graphSvg');
  if (!svg) return;
  let drag = null; /* { id, startX, startY, moved } */

  /* клик по фону снимает выделение */
  svg.addEventListener('click', (e) => {
    if (e.target.closest('[data-node]')) return;
    if (S.graph.sel != null) { S.graph.sel = null; drawGraph(); }
  });
  svg.addEventListener('pointerdown', (e) => {
    const g = e.target.closest('[data-node]');
    if (!g) return;
    drag = { id: Number(g.dataset.node), startX: e.clientX, startY: e.clientY, moved: false };
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 4) drag.moved = true;
    if (!drag.moved) return;
    const pt = svgPoint(svg, e);
    const base = S.graph.base.get(drag.id) ?? { x: S.graph.cx, y: S.graph.cy };
    S.graph.pos.set(drag.id, { x: pt.x - base.x, y: pt.y - base.y });
    updateGraphPositions();
  });
  svg.addEventListener('pointerup', () => {
    if (!drag) return;
    const wasTap = !drag.moved;
    const id = drag.id;
    drag = null;
    if (wasTap) {
      S.graph.sel = S.graph.sel === id ? null : id;
      drawGraph();
    }
  });
  svg.addEventListener('keydown', (e) => {
    const g = e.target.closest('[data-node]');
    if (!g || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    const id = Number(g.dataset.node);
    S.graph.sel = S.graph.sel === id ? null : id;
    drawGraph();
  });
}

function svgPoint(svg, e) {
  const pt = svg.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

/* живое обновление позиций узлов и рёбер без перерисовки (drag) */
function updateGraphPositions() {
  const svg = $('#graphSvg');
  if (!svg) return;
  for (const g of $$('[data-node]', svg)) {
    const p = graphPos(Number(g.dataset.node));
    const circle = g.querySelector('circle');
    circle.setAttribute('cx', p.x);
    circle.setAttribute('cy', p.y);
    const label = g.querySelector('text');
    label.setAttribute('x', p.x);
    label.setAttribute('y', p.y + 28);
  }
  for (const path of $$('[data-edge]', svg)) {
    const from = graphPos(Number(path.dataset.from));
    const to = graphPos(Number(path.dataset.to));
    const c1 = { x: from.x + (S.graph.cx - from.x) * 0.25, y: from.y + (S.graph.cy - from.y) * 0.25 };
    const c2 = { x: to.x + (S.graph.cx - to.x) * 0.25, y: to.y + (S.graph.cy - to.y) * 0.25 };
    path.setAttribute('d', `M${from.x} ${from.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${to.x} ${to.y}`);
    const lbl = svg.querySelector(`[data-edge-label][data-from="${path.dataset.from}"][data-to="${path.dataset.to}"]`);
    if (lbl) {
      lbl.setAttribute('x', (from.x + to.x) / 2);
      lbl.setAttribute('y', (from.y + to.y) / 2 - 6);
    }
  }
}

/* ============================ страница «Память» ============================ */

PAGES.memory = {
  async render() {
    const items = await apiGet('/api/memory');
    S.memItems = items;
    const filtered = items.filter((m) => S.memTab === 'all' || m.kind === S.memTab);
    const active = filtered.filter((m) => m.is_active);
    const archive = filtered.filter((m) => !m.is_active);

    let html = `<div class="page-head">
      <h2 class="page-title">Память</h2>
      <span class="page-sub">${items.filter((m) => m.is_active).length} активных записей</span>
    </div>
    <section class="section">
      <div class="card add-strip">
        <select id="newMemKind" aria-label="Тип записи">
          ${Object.entries(MEM_KIND).map(([v, k]) => `<option value="${v}">${k.ru}</option>`).join('')}
        </select>
        <input type="text" id="newMemText" class="grow" placeholder="Например: вечером мне проще делать бытовые задачи" maxlength="500" />
        <button class="btn btn--primary btn--sm" data-action="add-memory">Запомнить</button>
      </div>
    </section>
    <section class="section">
      <div class="mem-tabs">
        <button class="chip ${S.memTab === 'all' ? 'chip--on' : ''}" data-action="mem-tab" data-v="all" aria-pressed="${S.memTab === 'all'}">Все</button>
        ${Object.entries(MEM_KIND).map(([v, k]) =>
          `<button class="chip ${S.memTab === v ? 'chip--on' : ''}" data-action="mem-tab" data-v="${v}" aria-pressed="${S.memTab === v}">${k.ru}</button>`).join('')}
      </div>`;

    if (!filtered.length) {
      const hasAny = items.length > 0;
      html += `<div class="empty">
        <svg class="e-icon" viewBox="0 0 24 24"><use href="#i-memory"/></svg>
        <div class="e-title">${hasAny ? 'Под фильтр ничего не попало' : 'Пока пусто'}</div>
        <div class="e-sub">${hasAny ? 'Переключи таб или посмотри все записи.' : 'Расскажи диспетчеру о себе — он будет учитывать это в предложениях.'}</div>
      </div>`;
    }
    html += `<div class="mem-grid">`;
    for (const m of active) {
      const k = MEM_KIND[m.kind] ?? MEM_KIND.fact;
      html += `<div class="mem-card" style="--spine:${k.spine}">
        <div class="mem-head">
          <span class="badge badge--dim">${k.ru}</span>
          <label class="switch" title="${m.is_active ? 'Выключить' : 'Включить'}">
            <input type="checkbox" ${m.is_active ? 'checked' : ''} data-change="mem-toggle" data-id="${m.id}" aria-label="Запись ${m.is_active ? 'активна' : 'в архиве'}">
            <span class="track"></span><span class="knob"></span>
          </label>
        </div>
        <div class="mem-text mt2">${esc(m.content)}</div>
        <div class="mem-meta">${esc(MEM_SOURCE[m.source] ?? m.source)} · ${esc(fmt.relDays(m.created_at))}</div>
      </div>`;
    }
    html += `</div>`;

    if (archive.length) {
      html += `</section><section class="section"><div class="section-title dim">Архив</div><div class="mem-grid">`;
      for (const m of archive) {
        const k = MEM_KIND[m.kind] ?? MEM_KIND.fact;
        html += `<div class="mem-card off" style="--spine:${k.spine}">
          <div class="mem-head">
            <span class="badge badge--dim">${k.ru}</span>
            <label class="switch">
              <input type="checkbox" data-change="mem-toggle" data-id="${m.id}" aria-label="Включить запись">
              <span class="track"></span><span class="knob"></span>
            </label>
          </div>
          <div class="mem-text mt2">${esc(m.content)}</div>
          <div class="mem-meta">${esc(MEM_SOURCE[m.source] ?? m.source)} · ${esc(fmt.relDays(m.created_at))}</div>
        </div>`;
      }
      html += `</div>`;
    }
    html += `</section>`;
    return html;
  },
};

/* ============================ страница «Журнал» ============================ */

PAGES.activity = {
  async render() {
    const events = await apiGet('/api/events?limit=200');
    S.eventsAll = events;
    const filtered = S.actCats.size ? events.filter((e) => S.actCats.has(EVENT_CAT[e.type]?.cat)) : events;
    const shown = filtered.slice(0, S.actLimit);

    let html = `<div class="page-head">
      <h2 class="page-title">Журнал</h2>
      <span class="page-sub">последние ${shown.length} из ${filtered.length}</span>
    </div>
    <section class="section">
      <div class="filterbar">
        ${EVENT_CATS.map(([v, ru]) =>
          `<button class="chip ${S.actCats.has(v) ? 'chip--on' : ''}" data-action="act-cat" data-v="${v}" aria-pressed="${S.actCats.has(v)}">${ru}</button>`).join('')}
      </div>`;
    if (!shown.length) {
      const hasAny = events.length > 0;
      html += `<div class="empty">
        <svg class="e-icon" viewBox="0 0 24 24"><use href="#i-pulse"/></svg>
        <div class="e-title">${hasAny ? 'Под фильтр ничего не попало' : 'Событий пока нет'}</div>
        <div class="e-sub">${hasAny ? 'Сними фильтр категории, чтобы увидеть всю ленту.' : 'Здесь появится история: диалоги, задачи, проактивные сообщения.'}</div>
      </div>`;
    }
    html += `<div class="rail">`;
    for (const e of shown) {
      const cat = EVENT_CAT[e.type] ?? { cat: 'system', ru: e.type, color: 'var(--line-strong)' };
      const body = e.text ?? (e.payload && Object.keys(e.payload).length ? JSON.stringify(e.payload).slice(0, 140) : '');
      html += `<div class="rail-item" style="--cat:${cat.color}">
        <span class="rail-time">${esc(fmt.dateTime(e.ts))}</span>
        <div class="rail-body">
          <span class="badge badge--dim">${cat.ru}</span>
          <div class="rail-text">${esc(body)}</div>
        </div>
      </div>`;
    }
    html += `</div>`;
    if (filtered.length > shown.length) {
      html += `<div class="more-wrap"><button class="btn btn--ghost" data-action="more-events">Показать ещё · ${filtered.length - shown.length}</button></div>`;
    }
    html += `</section>`;
    return html;
  },
};

/* ============================ страница «Настройки» ============================ */

PAGES.settings = {
  async render() {
    const [settings, backups] = await Promise.all([apiGet('/api/settings'), apiGet('/api/backups')]);
    S.settings = JSON.parse(JSON.stringify(settings));
    S.settingsPristine = JSON.stringify(settings);
    const st = S.settings;

    let html = `<div class="page-head">
      <h2 class="page-title">Настройки</h2>
    </div>
    <div class="set-grid">`;

    /* время */
    const ritual = st.evening_ritual ?? { enabled: 1, at: '21:30' };
    html += `<div class="set-card">
      <h3>${ic('moon')} Вечерний ритуал</h3>
      <div class="set-row">
        <label class="switch">
          <input type="checkbox" ${ritual.enabled ? 'checked' : ''} data-change="ritual-enabled" aria-label="Ритуал включён">
          <span class="track"></span><span class="knob"></span>
        </label>
        <label class="field"><span class="field-label">Подводить итоги в</span>
          <input type="time" value="${esc(ritual.at ?? '21:30')}" data-change="ritual-at">
        </label>
        <label class="field grow"><span class="field-label">Таймзона (IANA)</span>
          <input value="${esc(st.tz ?? '')}" placeholder="Asia/Yekaterinburg" data-change="tz">
        </label>
      </div>
    </div>`;

    /* проактивность */
    const lvl = Number(st.proactivity_level ?? 2);
    html += `<div class="set-card">
      <h3>${ic('bolt')} Проактивность</h3>
      <div class="proactivity">
        <span class="pa-num" id="paNum">${lvl}</span>
        <div class="pa-steps" role="group" aria-label="Уровень проактивности">
          ${PA_LEVELS.map((_, i) => `<button class="pa-step ${i <= lvl ? 'on' : ''}" data-action="pa-level" data-v="${i}" aria-label="${PA_LEVELS[i]}"></button>`).join('')}
        </div>
        <span class="pa-label" id="paLabel">${PA_LEVELS[lvl]}</span>
      </div>
    </div>`;

    /* часы */
    const qh = st.quiet_hours ?? { start: '23:00', end: '09:00' };
    const wh = st.work_hours ?? { start: '07:00', end: '18:00', days: ['mon', 'tue', 'wed', 'thu', 'fri'] };
    html += `<div class="set-card">
      <h3>${ic('clock')} Часы</h3>
      <div class="set-row" style="margin-bottom:14px">
        <div class="field"><span class="field-label">Тихие часы</span>
          <div class="row" style="gap:6px">
            <input type="time" value="${esc(qh.start)}" data-change="qh-start" aria-label="Начало тихих часов">
            <span class="dim" aria-hidden="true">—</span>
            <input type="time" value="${esc(qh.end)}" data-change="qh-end" aria-label="Конец тихих часов">
          </div>
        </div>
        <div class="field"><span class="field-label">Рабочие часы</span>
          <div class="row" style="gap:6px">
            <input type="time" value="${esc(wh.start)}" data-change="wh-start" aria-label="Начало рабочих часов">
            <span class="dim" aria-hidden="true">—</span>
            <input type="time" value="${esc(wh.end)}" data-change="wh-end" aria-label="Конец рабочих часов">
          </div>
        </div>
      </div>
      ${dayTrackHTML(qh, wh, ritual)}
      <div class="days" style="margin-top:14px" role="group" aria-label="Рабочие дни">
        ${DAYS.map(([d, ru]) => `<button class="day-tile ${(wh.days ?? []).includes(d) ? 'on' : ''}" data-action="toggle-day" data-v="${d}" aria-pressed="${(wh.days ?? []).includes(d)}">${ru}</button>`).join('')}
      </div>
      <div class="day-track-legend">
        <span><i class="sw-quiet"></i>тихие часы</span>
        <span><i style="border:1.5px solid var(--ok-fill)"></i>рабочие</span>
        <span><i style="background:var(--a-other)"></i>ритуал</span>
        <span><i style="background:var(--bad-fill)"></i>сейчас</span>
      </div>
    </div>`;

    /* бюджеты */
    const pb = st.proactive_budget ?? { max_per_day: 2, min_interval_hours: 4, max_critical_work_per_day: 1 };
    html += `<div class="set-card">
      <h3>${ic('target')} Бюджеты проактивности</h3>
      <div class="set-row">
        <label class="field"><span class="field-label">Макс. сообщений в день</span>
          <input type="number" min="0" max="10" value="${pb.max_per_day}" data-change="pb-max" style="width:90px"></label>
        <label class="field"><span class="field-label">Мин. интервал, ч</span>
          <input type="number" min="1" max="24" value="${pb.min_interval_hours}" data-change="pb-int" style="width:90px"></label>
        <label class="field"><span class="field-label">Критичных в рабочие часы</span>
          <input type="number" min="0" max="5" value="${pb.max_critical_work_per_day}" data-change="pb-crit" style="width:90px"></label>
      </div>
    </div>`;

    /* бэкапы */
    html += `<div class="set-card">
      <h3>${ic('download')} Бэкапы</h3>
      <button class="btn btn--primary" data-action="run-backup">${ic('download')} Сделать бэкап сейчас</button>
      <div class="mt4">
        ${backups.length ? backups.map((b) =>
          `<div class="bak"><a class="grow" href="/api/backups/${encodeURIComponent(b.file)}">${esc(b.file)}</a><span class="bak-size">${fmt.size(b.size)}</span><span class="bak-size">${esc(fmt.dateTime(b.at))}</span></div>`).join('')
        : '<div class="dim small">Пока нет ни одного бэкапа.</div>'}
      </div>
    </div>`;

    html += `</div>
    <div class="savebar" id="savebar">
      <span>Настройки изменились</span>
      <button class="btn btn--primary" data-action="save-settings">Сохранить</button>
    </div>`;
    return html;
  },
};

function pctOfTime(hhmm) {
  const [h, m] = String(hhmm || '0:0').split(':').map(Number);
  return (((h || 0) * 60 + (m || 0)) / 1440) * 100;
}
function dayTrackHTML(qh, wh, ritual) {
  const at = ritual?.at || '21:30';
  const zones = [];
  const qs = pctOfTime(qh.start), qe = pctOfTime(qh.end);
  if (qs < qe) zones.push({ s: qs, e: qe });
  else { /* через полночь */
    zones.push({ s: qs, e: 100 });
    if (qe > 0) zones.push({ s: 0, e: qe });
  }
  const ws = pctOfTime(wh.start), we = pctOfTime(wh.end);
  const nowPct = (new Date().getHours() * 60 + new Date().getMinutes()) / 1440 * 100;
  const rf = pctOfTime(at);
  const hours = [0, 3, 6, 9, 12, 15, 18, 21].map((h) =>
    `<span style="left:${(h / 24) * 100}%">${String(h).padStart(2, '0')}</span>`).join('');
  return `<div class="track-scroll">
    <div class="day-track mm">
      ${zones.map((z) => `<div class="t-zone t-quiet" style="left:${z.s}%;width:${z.e - z.s}%"></div>`).join('')}
      <div class="t-zone t-work" style="left:${ws}%;width:${we - ws}%"></div>
      <div class="t-now" style="left:${nowPct}%" title="Сейчас"></div>
      <div class="t-flag" style="left:${rf}%" title="Вечерний ритуал"><span class="t-flag-time">${esc(ritual.enabled ? `${esc(at)} · итоги` : 'ритуал выключен')}</span>${ic('moon')}</div>
    </div>
    <div class="day-track-hours">${hours}</div>
  </div>`;
}

/* ============================ действия ============================ */

const ACTIONS = {
  'retry': () => rerender(),

  /* --- сегодня --- */
  async 'complete-hero'(btn) {
    const id = btn.dataset.id;
    const hero = $('#hero');
    const hadFocus = hero?.contains(document.activeElement);
    $$('button', hero).forEach((b) => (b.disabled = true));
    const stamp = document.createElement('div');
    stamp.className = 'stamp';
    stamp.innerHTML = '<span>Выполнено</span>';
    hero.append(stamp);
    try {
      await apiPost(`/api/tasks/${id}/complete`);
      await sleep(reducedMotion() ? 50 : 520);
      hero.classList.add('strip-leaving');
      await sleep(reducedMotion() ? 50 : 330);
      await rerender();
      if (hadFocus) $('#heroBtn')?.focus();
      toast('ok', 'Выполнено. Следующее — на месте.', {
        label: 'Отменить',
        action: async () => {
          try { await apiPost(`/api/tasks/${id}/reopen`); rerender(); toast('ok', 'Возвращено в работу'); }
          catch (e) { toast('bad', e.message); }
        },
      }, 5000);
    } catch (e) {
      stamp.remove();
      $$('button', hero).forEach((b) => (b.disabled = false));
      toast('bad', e.message);
    }
  },
  async 'snooze-hero'(btn) {
    const id = btn.dataset.id;
    const hero = $('#hero');
    $$('button', hero).forEach((b) => (b.disabled = true));
    hero.classList.add('strip-leaving');
    try {
      await apiPost(`/api/tasks/${id}/snooze`, { days: 1 });
      await sleep(reducedMotion() ? 50 : 320);
      await rerender();
      toast('ok', 'Отложено на завтра');
    } catch (e) { rerender(); toast('bad', e.message); }
  },
  'goto-checkin'() {
    const el = $('#checkin');
    el?.scrollIntoView({ block: 'center' });
    el.querySelector('.seg')?.focus();
  },
  'set-energy'(btn) {
    S.checkin.energy = Number(btn.dataset.v);
    $$('#checkin .seg').forEach((s) => {
      const on = Number(s.dataset.v) === S.checkin.energy;
      s.classList.toggle('seg--on', on);
      s.setAttribute('aria-pressed', on);
    });
  },
  'set-minutes'(btn) {
    S.checkin.minutes = Number(btn.dataset.v);
    $$('#checkin [data-action="set-minutes"]').forEach((b) => {
      const on = Number(b.dataset.v) === S.checkin.minutes;
      b.classList.toggle('chip--on', on);
      b.setAttribute('aria-pressed', on);
    });
  },
  'set-intox'(btn) {
    S.checkin.intoxication = btn.dataset.v;
    $$('#checkin [data-action="set-intox"]').forEach((b) => {
      const on = b.dataset.v === S.checkin.intoxication;
      b.classList.toggle('chip--on', on);
      b.setAttribute('aria-pressed', on);
    });
  },
  async 'save-checkin'() {
    const c = S.checkin;
    try {
      await apiPost('/api/state', { energy: c.energy, available_minutes: c.minutes, intoxication: c.intoxication });
      c.saved = new Date().toISOString();
      rerender();
      toast('ok', 'Состояние записано');
    } catch (e) { toast('bad', e.message); }
  },
  'edit-checkin'() { S.checkin.saved = false; rerender(); },
  async 'complete-task'(btn) {
    const id = btn.dataset.id;
    try {
      await apiPost(`/api/tasks/${id}/complete`);
      rerender();
      toast('ok', 'Выполнено', {
        label: 'Отменить',
        action: async () => {
          try { await apiPost(`/api/tasks/${id}/reopen`); rerender(); toast('ok', 'Возвращено в работу'); }
          catch (e) { toast('bad', e.message); }
        },
      }, 5000);
    } catch (e) { toast('bad', e.message); }
  },
  async 'reopen-task'(btn) {
    try { await apiPost(`/api/tasks/${btn.dataset.id}/reopen`); rerender(); toast('ok', 'Возвращено в работу'); }
    catch (e) { toast('bad', e.message); }
  },

  /* --- проекты --- */
  async 'add-project'() {
    const input = $('#newProjName');
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    try {
      await apiPost('/api/projects', { name });
      rerender();
      toast('ok', 'Проект создан');
    } catch (e) { toast('bad', e.message); }
  },
  'proj-filter'(btn) { S.projFilter = btn.dataset.v; rerender(); },
  'toggle-proj'(btn) {
    const id = Number(btn.dataset.id);
    if (S.projOpen.has(id)) {
      S.projOpen.delete(id);
      btn.setAttribute('aria-expanded', 'false');
      $(`[data-panel="${id}"]`)?.classList.add('hidden');
    } else {
      S.projOpen.add(id);
      btn.setAttribute('aria-expanded', 'true');
      const panel = $(`[data-panel="${id}"]`);
      panel.classList.remove('hidden');
      panel.innerHTML = '<div class="skel skel--strip"></div>';
      loadProjectPanel(id);
    }
  },

  /* --- задачи --- */
  async 'add-task'() {
    const title = $('#newTaskTitle').value.trim();
    if (!title) { $('#newTaskTitle').focus(); return; }
    const body = {
      title,
      project_id: $('#newTaskProject').value ? Number($('#newTaskProject').value) : null,
      estimated_minutes: $('#newTaskMin').value ? Number($('#newTaskMin').value) : null,
    };
    try {
      await apiPost('/api/tasks', body);
      rerender();
      toast('ok', 'Задача добавлена');
    } catch (e) { toast('bad', e.message); }
  },
  'toggle-status-filter'(btn) {
    const v = btn.dataset.v;
    S.taskFilter.statuses.has(v) ? S.taskFilter.statuses.delete(v) : S.taskFilter.statuses.add(v);
    S.tasksLimit = 30;
    rerender();
  },
  'toggle-overdue-filter'() { S.taskFilter.overdue = !S.taskFilter.overdue; S.tasksLimit = 30; rerender(); },
  'reset-task-filter'() { S.taskFilter = { statuses: new Set(), overdue: false }; rerender(); },
  'status-menu'(btn) { openStatusMenu(btn); },
  'more-tasks'() { S.tasksLimit += 30; rerender(); },

  /* --- граф --- */
  'graph-kind'(btn) {
    const v = btn.dataset.v;
    S.graph.kinds.has(v) ? S.graph.kinds.delete(v) : S.graph.kinds.add(v);
    rerender();
  },
  'graph-zoom'(btn) {
    const d = Number(btn.dataset.v);
    /* z меньше — viewBox уже — крупнее: «приблизить» уменьшает z */
    S.graph.zoom = Math.min(1.8, Math.max(0.7, S.graph.zoom - d * 0.18));
    const svg = $('#graphSvg');
    if (svg) svg.setAttribute('viewBox', graphViewBox());
  },

  /* --- память --- */
  async 'add-memory'() {
    const input = $('#newMemText');
    const content = input.value.trim();
    if (content.length < 3) { input.focus(); return; }
    try {
      await apiPost('/api/memory', { kind: $('#newMemKind').value, content });
      rerender();
      toast('ok', 'Записано в память');
    } catch (e) { toast('bad', e.message); }
  },
  'mem-tab'(btn) { S.memTab = btn.dataset.v; rerender(); },

  /* --- журнал --- */
  'act-cat'(btn) {
    const v = btn.dataset.v;
    S.actCats.has(v) ? S.actCats.delete(v) : S.actCats.add(v);
    S.actLimit = 40;
    rerender();
  },
  'more-events'() { S.actLimit += 40; rerender(); },

  /* --- настройки --- */
  'pa-level'(btn) {
    const v = Number(btn.dataset.v);
    S.settings.proactivity_level = v;
    $('#paNum').textContent = v;
    $('#paLabel').textContent = PA_LEVELS[v];
    $$('.pa-step').forEach((s, i) => s.classList.toggle('on', i <= v));
    touchSettings();
  },
  'toggle-day'(btn) {
    const d = btn.dataset.v;
    const wh = S.settings.work_hours ?? (S.settings.work_hours = { start: '07:00', end: '18:00', days: [] });
    wh.days ??= [];
    const i = wh.days.indexOf(d);
    i >= 0 ? wh.days.splice(i, 1) : wh.days.push(d);
    btn.classList.toggle('on');
    btn.setAttribute('aria-pressed', btn.classList.contains('on'));
    touchSettings();
  },
  async 'save-settings'() {
    try {
      await apiPatch('/api/settings', S.settings);
      S.settingsPristine = JSON.stringify(S.settings);
      toast('ok', 'Настройки сохранены');
      await rerender();
    } catch (e) { toast('bad', e.message); }
  },
  async 'run-backup'() {
    try {
      const r = await apiPost('/api/backup');
      toast('ok', `Бэкап создан: ${r.file} (${fmt.size(r.size)})`);
      rerender();
    } catch (e) { toast('bad', e.message); }
  },

  /* --- прочее --- */
  'logout'() {
    document.cookie = 'sid=; max-age=0; path=/';
    location.hash = '#/today';
    location.reload();
  },
};

function touchSettings() {
  const bar = $('#savebar');
  if (!bar) return;
  bar.classList.toggle('show', JSON.stringify(S.settings) !== S.settingsPristine);
}

/* изменения полей (select/checkbox/time/number/text) */
const CHANGES = {
  'proj-status': async (el) => {
    try { await apiPatch(`/api/projects/${el.dataset.id}`, { status: el.value }); rerender(); toast('ok', 'Статус обновлён'); }
    catch (e) { toast('bad', e.message); }
  },
  'mem-toggle': async (el) => {
    try { await apiPatch(`/api/memory/${el.dataset.id}`, { is_active: el.checked }); rerender(); }
    catch (e) { toast('bad', e.message); }
  },
  'ritual-enabled': (el) => { setNested('evening_ritual', { ...(S.settings.evening_ritual ?? { at: '21:30' }), enabled: el.checked ? 1 : 0 }); },
  'ritual-at': (el) => { setNested('evening_ritual', { ...(S.settings.evening_ritual ?? { enabled: 1 }), at: el.value }); },
  'tz': (el) => { S.settings.tz = el.value; touchSettings(); },
  'qh-start': (el) => { setNested('quiet_hours', { ...(S.settings.quiet_hours ?? { end: '09:00' }), start: el.value }); },
  'qh-end': (el) => { setNested('quiet_hours', { ...(S.settings.quiet_hours ?? { start: '23:00' }), end: el.value }); },
  'wh-start': (el) => { setNested('work_hours', { ...(S.settings.work_hours ?? { end: '18:00', days: [] }), start: el.value }); },
  'wh-end': (el) => { setNested('work_hours', { ...(S.settings.work_hours ?? { start: '07:00', days: [] }), end: el.value }); },
  'pb-max': (el) => { setNested('proactive_budget', { ...(S.settings.proactive_budget ?? {}), max_per_day: Number(el.value) }); },
  'pb-int': (el) => { setNested('proactive_budget', { ...(S.settings.proactive_budget ?? {}), min_interval_hours: Number(el.value) }); },
  'pb-crit': (el) => { setNested('proactive_budget', { ...(S.settings.proactive_budget ?? {}), max_critical_work_per_day: Number(el.value) }); },
};
function setNested(key, val) { S.settings[key] = val; touchSettings(); }

/* ============================ события документа ============================ */

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (el) {
    const fn = ACTIONS[el.dataset.action];
    if (fn) { e.preventDefault(); fn(el, e); return; }
  }
  /* клик мимо меню — закрыть его */
  if (!e.target.closest('.menu')) closeMenus();
});

document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-change]');
  if (el && CHANGES[el.dataset.change]) CHANGES[el.dataset.change](el);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeMenus(); closeSheet(); }
});

/* Enter в полях быстрого создания */
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const map = { newTaskTitle: 'add-task', newProjName: 'add-project', newMemText: 'add-memory' };
  for (const [id, action] of Object.entries(map)) {
    if (e.target.id === id) { e.preventDefault(); ACTIONS[action](); return; }
  }
});

/* Enter в поле логина */
$('#loginForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#loginError');
  const card = $('.login-card');
  err.hidden = true;
  const btn = $('#loginSubmit');
  btn.disabled = true;
  btn.textContent = 'Проверяю…';
  try {
    await apiPost('/api/auth/login', { password: $('#loginPassword').value });
    showApp();
    S.route = currentRoute();
    syncNav();
    render();
  } catch (err2) {
    err.textContent = err2.message;
    err.hidden = false;
    card.classList.remove('shake');
    void card.offsetWidth;
    card.classList.add('shake');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Войти';
  }
});

$('#moreBtn')?.addEventListener('click', openSheet);
$('#sheetBackdrop')?.addEventListener('click', closeSheet);
$$('#sheet a').forEach((a) => a.addEventListener('click', () => closeSheet()));

window.addEventListener('hashchange', () => {
  closeSheet(); closeMenus();
  S.route = currentRoute();
  syncNav();
  render();
  $('#content').focus({ preventScroll: true });
  scrollTo({ top: 0 });
});

window.addEventListener('resize', moveTabsInk);
window.addEventListener('offline', () => toast('bad', 'Нет соединения — изменения могут не сохраниться', null, 2500));
window.addEventListener('online', () => toast('ok', 'Связь восстановлена', null, 2000));

/* ============================ запуск ============================ */

async function boot() {
  tickClock();
  setInterval(tickClock, 30000);

  if (demoActive()) {
    if (location.hash === '#/login') { showLogin(); return; } /* демо-просмотр экрана входа */
    showApp();
    S.route = currentRoute();
    syncNav();
    render();
    return;
  }
  try {
    S.stateCache = await apiGet('/api/state');
    renderMastChips(S.stateCache);
    showApp();
    S.route = currentRoute();
    syncNav();
    render();
  } catch (e) {
    if (e instanceof Unauthorized) return; /* уже показан логин */
    showApp();
    S.route = currentRoute();
    syncNav();
    render();
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

document.fonts?.ready?.then(moveTabsInk);
