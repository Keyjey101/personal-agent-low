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

## Быстрый старт (VPS с nginx + Docker)

На сервере уже есть nginx с TLS для `gmyrya.com` — приложение просто садится на `127.0.0.1:8080`,
а nginx проксирует на него весь трафик (и интерфейс, и `/api` — это один сервис на одном порту).

```bash
git clone git@github.com:Keyjey101/personal-agent-low.git && cd personal-agent-low
cp .env.example .env
# ключи для .env:
#   docker compose build app
#   docker compose run --rm app node dist/scripts/gen-secrets.js   # спросит пароль для сайта
#   → вставь напечатанные WEB_PASSWORD_HASH и SESSION_SECRET в .env
#   + заполни TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_CHAT_ID, GLM_API_KEY
docker compose up -d
```

nginx-конфиг для `/etc/nginx/sites-enabled/gmyrya.com` — блок `location /api/` не нужен,
остальное меняешь на один location (сертификаты certbot не трогаем):

```nginx
server {
    server_name gmyrya.com www.gmyrya.com;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
        proxy_buffering off;
    }

    listen 443 ssl; # managed by Certbot
    # ...остальные строки certbot (ssl_certificate и т.д.) остаются как были
}
```

Проверка и применение: `nginx -t && systemctl reload nginx`.
Открой `https://gmyrya.com` — там веб-панель; напиши боту `/start` в Telegram.
При первом старте применятся миграции и зальются начальные данные (проекты из ТЗ).

## Разработка

```bash
npm install
npm test        # unit + integration
npm run dev     # локальный запуск (tsx watch), нужен .env (кроме токенов — они нужны только для живого Telegram/GLM)
npm run build   # tsc + vite build → dist/ + web-dist/
npm start       # запуск собранного
```

## Стек

TypeScript · Node 24 · Fastify · grammY · node:sqlite (WAL + FTS5) · Zod · GLM (OpenAI-совместимый API) · React + Vite · Docker Compose за nginx.

## Отклонения от ТЗ (сознательные)

- **Без Drizzle ORM** — тонкий слой репозиториев поверх better-sqlite3 и обычные SQL-миграции
  (`migrations/*.sql`, `PRAGMA user_version`). Меньше зависимостей, всё явно.
- Добавлен инструмент агента `mute_topic` (явное «не надо» от пользователя мутит тему
  проактивности) — прямо следует из ТЗ 8.3.5, но не был в списке 7.4.
- Web: добавлены `POST /api/state` и `POST /api/tasks/:id/snooze` — нужны страницам Today.

## Ресурсы

Целевой профиль: приложение ≤ 400 MB RAM (mem_limit 450m в compose), БД + логи + бэкапы ≪ 1 GB SSD
(retention: логи 14 дней, бэкапы 7 дневных + 4 понедельника).
