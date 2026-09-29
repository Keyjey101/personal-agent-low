# RUNBOOK — установка, обновление, восстановление

## Предпосылки

- VPS: Docker + docker compose, 1 GB RAM, ~7 GB свободного SSD, домен с A-записью на VPS.
- Токен бота у @BotFather.
- Свой chat_id у @userinfobot.
- API-ключ GLM (платформа z.ai или bigmodel.cn — подписка на чат ≠ API).

## Установка

```bash
git clone git@github.com:Keyjey101/personal-agent-low.git && cd personal-agent-low
cp .env.example .env
npm run gen-secrets     # вставь вывод в .env (WEB_PASSWORD_HASH, SESSION_SECRET)
nano .env               # токены, ключ, DOMAIN
docker compose up -d --build
```

Проверка:

```bash
curl -f http://localhost:8080/healthz        # {"ok":true,"db":true}
docker compose logs app | tail -20
```

`/start` боту в Telegram. Веб: `https://<домен>`.

## Обновление

```bash
git pull
docker compose up -d --build     # миграции применяются автоматически при старте
```

## Бэкапы

- Автоматически каждый день в 03:30 (локальное время): `/data/backups/app-YYYY-MM-DD.db.gz`.
- Retention: 7 дневных + 4 понедельника.
- Вручную: Web → Настройки → «Сделать бэкап сейчас», или `POST /api/backup`.
- Выгрузка вовне (опционально): положи скрипт `/data/backups/post-backup.sh` — он получит
  путь к файлу первым аргументом (например, rclone в своё облако). Сделай его исполняемым.

## Восстановление из бэкапа

```bash
docker compose stop app
gunzip -c ./data/backups/app-2026-09-29.db.gz > ./data/app.db
rm -f ./data/app.db-wal ./data/app.db-shm
docker compose start app
curl -f http://localhost:8080/healthz
```

Процедуру обязательно прогнать на копии хотя бы раз (критерий приёмки №13 ТЗ).

## Диагностика

| Симптом | Что смотреть |
|---|---|
| Бот молчит | `docker compose logs app`; проверь TELEGRAM_ALLOWED_CHAT_ID (сообщения от других chat_id игнорируются с warn) |
| «Мозг offline» в ответах | GLM_API_KEY / GLM_BASE_URL / GLM_MODEL в .env; событие GLM_UNAVAILABLE в Web → Активность |
| Бэкапы не появляются | Web → Активность → BACKUP_DONE; логи; свободное место `df -h` |
| Веб не открывается | Caddy: `docker compose logs caddy`, DNS, порт 443 |
| Долгие ответы GLM | логи app-*.log, поле tokens/latency у записей glm call |

## Часовые пояса

Все времена в БД — UTC; отображение и «рабочие/тихие часы» — по `TZ` из .env
(или настройке `tz` в Web → Настройки). По умолчанию Europe/Moscow.

## Смена пароля веба

```bash
npm run gen-secrets   # где угодно, введи новый пароль
# вставь новый WEB_PASSWORD_HASH в .env на сервере
docker compose up -d
```
