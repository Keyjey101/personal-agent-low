# Диспетчер — персональный операционный помощник

Один пользователь, Telegram как основной интерфейс, GLM как мозг, SQLite как память.
Полное техническое задание — в [docs/TZ.md](docs/TZ.md), эксплуатация — в [docs/RUNBOOK.md](docs/RUNBOOK.md).

## Что это

Система хранит все дела как **проекты → задачи → следующее физическое действие**, знает зависимости,
учитывает твоё состояние (энергия, время, опьянение) и на каждое «что делать?» отвечает **одним
конкретным действием**. Плюс проактивность со строгими бюджетами: не беспокоит в рабочие часы
и на ночь, за дедлайны предупреждает, застоявшиеся проекты поднимает.

```text
Telegram (основной) ─┐
                     ├─→ Fastify (один Node-процесс) ─→ GLM API
Web (администрирование) ┘        │
                                 └─→ SQLite (WAL): задачи, граф знаний, память, события
```

## Быстрый старт (VPS с Docker)

```bash
git clone git@github.com:Keyjey101/personal-agent-low.git && cd personal-agent-low
cp .env.example .env
npm run gen-secrets          # сгенерирует WEB_PASSWORD_HASH и SESSION_SECRET → в .env
# заполни TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_CHAT_ID, GLM_API_KEY, DOMAIN
docker compose up -d --build
```

Открой `https://<домен>` — там веб-панель; напиши боту `/start` в Telegram.
При первом старте применятся миграции и зальются начальные данные (проекты из ТЗ).

## Разработка

```bash
npm install
npm test        # unit + integration
npm run dev     # локальный запуск (tsx watch), нужен .env
npm run build   # tsc + vite build → dist/ + web-dist/
npm start       # запуск собранного
```

## Стек

TypeScript · Node 22 · Fastify · grammY · better-sqlite3 (WAL + FTS5) · Zod · GLM (OpenAI-совместимый API) · React + Vite · Docker Compose + Caddy.

## Отклонения от ТЗ (сознательные)

- **Без Drizzle ORM** — тонкий слой репозиториев поверх better-sqlite3 и обычные SQL-миграции
  (`migrations/*.sql`, `PRAGMA user_version`). Меньше зависимостей, всё явно.
- Добавлен инструмент агента `mute_topic` (явное «не надо» от пользователя мутит тему
  проактивности) — прямо следует из ТЗ 8.3.5, но не был в списке 7.4.
- Web: добавлены `POST /api/state` и `POST /api/tasks/:id/snooze` — нужны страницам Today.

## Ресурсы

Целевой профиль: приложение ≤ 400 MB RAM (mem_limit 450m в compose), БД + логи + бэкапы ≪ 1 GB SSD
(retention: логи 14 дней, бэкапы 7 дневных + 4 понедельника).
