# RUNBOOK — установка, обновление, восстановление

## Архитектура деплоя

```text
интернет → nginx (TLS, certbot, gmyrya.com) → 127.0.0.1:3000 (страницы) и :3001 (/api)
                                                → оба порта → один контейнер app (Docker)
```

Приложение одно и обслуживает всё: страницы, `/api/*`, `/healthz`. Хост-порты **3000 и 3001**
замаплены в один контейнер (`ports` в docker-compose) — это под существующий конфиг nginx
(`location /` → 3000, `location /api/` → 3001), **nginx менять не нужно**. Наружу контейнер
не проброшен: порты слушают только на localhost.

## Предпосылки

- VPS: Docker + docker compose, nginx с сертификатом Let's Encrypt для домена.
- Токен бота у @BotFather.
- Свой chat_id у @userinfobot.
- API-ключ GLM (платформа z.ai или bigmodel.cn — подписка на чат ≠ API).

## Заполнение .env

`cp .env.example .env`, затем:

| Переменная | Что это | Где взять |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | токен бота | @BotFather → /newbot |
| `TELEGRAM_ALLOWED_CHAT_ID` | твой chat_id, бот отвечает только тебе | @userinfobot |
| `GLM_API_KEY` | ключ API | консоль z.ai / bigmodel.cn |
| `GLM_BASE_URL` | endpoint API | `https://api.z.ai/api/paas/v4` (или `https://open.bigmodel.cn/api/paas/v4`) |
| `GLM_MODEL` | модель с tool calling | docs платформы, напр. `glm-4.7` |
| `WEB_PASSWORD_HASH` | **хеш** пароля для сайта (не сам пароль!) | gen-secrets, см. ниже |
| `SESSION_SECRET` | случайная строка для подписи cookie | gen-secrets, см. ниже |
| `TZ` | таймзона для часов/расписаний | по умолчанию Europe/Moscow |

### Пароль для веб-интерфейса (gen-secrets)

Придумай пароль (это пароль, который ты будешь вводить на странице входа на gmyrya.com).
Скрипт спросит его и напечатает две строки для .env:

```bash
# если на хосте есть Node:
npm run gen-secrets

# если Node нет — через docker (после docker compose build app):
docker compose run --rm app node dist/scripts/gen-secrets.js
```

Вывод вида:

```text
WEB_PASSWORD_HASH='$argon2id$...длинная строка...'
SESSION_SECRET='c29tZS1yYW5kb20t...'
```

Вставь обе строки в .env **вместе с одинарными кавычками**. Это не украшение: в argon2-хеше
есть символы `$`, и docker compose в .env без кавычек подставляет их как переменные
(в логе это видно как `WARN ... The "argon2id" variable is not set`), хеж приезжает в
контейнер испорченным. `SESSION_SECRET` — не пароль, просто случайный шум;
после первой установки его не меняй (иначе все сессии слетят — не страшно, просто перелогинишься).

## Установка

Порты 3000/3001 на хосте должны быть свободны. Если там висит старое приложение:

```bash
ss -tlnp | grep -E ':3000|:3001'    # кто занимает
docker stop <имя> 2>/dev/null || systemctl stop <сервис>
```

Дальше:

```bash
git clone git@github.com:Keyjey101/personal-agent-low.git && cd personal-agent-low
cp .env.example .env
# заполнить .env (см. таблицу выше)
docker compose up -d --build
curl -f http://localhost:3000/healthz        # {"ok":true,"db":true}
```

### nginx

**Ничего менять не нужно**: текущий конфиг gmyrya.com уже ведёт `location /` на 3000,
`location /api/` на 3001, а оба порта обслуживает Диспетчер. Сертификаты и certbot
не трогаем.

## Обновление

```bash
git pull
docker compose up -d --build     # миграции применяются автоматически при старте
```

## Бэкапы

- Автоматически каждый день в 03:30 (локальное время): `/data/backups/app-YYYY-MM-DD.db.gz`
  (внутри контейнера; на хосте — `./data/backups/`).
- Retention: 7 дневных + 4 понедельника.
- Вручную: Web → Настройки → «Сделать бэкап сейчас», или `POST /api/backup`.
- Выгрузка вовне (опционально): `./data/backups/post-backup.sh` — скрипт получит путь
  к файлу первым аргументом (например, rclone в своё облако). Сделай исполняемым (`chmod +x`).

## Восстановление из бэкапа

```bash
docker compose stop app
gunzip -c ./data/backups/app-2026-09-29.db.gz > ./data/app.db
rm -f ./data/app.db-wal ./data/app.db-shm
docker compose start app
curl -f http://localhost:3000/healthz
```

Процедуру обязательно прогнать на копии хотя бы раз (критерий приёмки №13 ТЗ).

## Часовые пояса — проверь при первом запуске!

Тихие часы, рабочие часы и вся проактивность считаются по настройке `tz`
(Web → Настройки, по умолчанию Europe/Moscow). Если ты живёшь в другом поясе —
**обязательно поправь**, иначе бот будет писать «вечером» в твою полночь.
Проверка: `/status` у бота показывает серверное время и tz — сверь с телефоном.

## Ночная рефлексия

После `REFLECTOR_HOUR` (по умолчанию 4:00) раз в сутки агент сам пересматривает
события дня: упаковывает их в память («мысли»), обогащает граф знаний, чистит
устаревшее. Итог виден в Web → Активность → `REFLECTION_DONE`. Настройки в `.env`:
`REFLECTOR_ENABLED` (1/0), `REFLECTOR_HOUR`, `REFLECTOR_MAX_EVENTS` (бюджет токенов).

## Диагностика

| Симптом | Что смотреть |
|---|---|
| 502 на gmyrya.com | `docker compose ps` (app жив?), `curl -f http://localhost:3000/healthz`, свободны ли порты: `ss -tlnp | grep -E ':3000|:3001'` |
| WARN `The "argon2id" variable is not set` при `up` | Значения с `$` в .env не закавычены — оберни `WEB_PASSWORD_HASH` (и остальное с `$`) в одинарные кавычки и сделай `docker compose up -d` заново |
| Контейнер стартует и сразу падает | `docker compose logs app --tail 30`. Если там `EACCES ... /data` — папка создана от root: `sudo chown -R 1000:1000 ./data` и `docker compose up -d` |
| Бот молчит | `docker compose logs app`; проверь TELEGRAM_ALLOWED_CHAT_ID (чужие chat_id игнорируются с warn) |
| «Мозг offline» в ответах | GLM_API_KEY / GLM_BASE_URL / GLM_MODEL; событие GLM_UNAVAILABLE в Web → Активность |
| Бэкапы не появляются | Web → Активность → BACKUP_DONE; `df -h` |
| Сертификат | certbot как обычно: `certbot renew` (крон certbot не менялся) |

## Часовые пояса

Все времена в БД — UTC; отображение и «рабочие/тихие часы» — по `TZ` из .env
(или настройке `tz` в Web → Настройки). По умолчанию Europe/Moscow.

## Смена пароля веба

```bash
npm run gen-secrets        # или docker-вариант выше; введи НОВЫЙ пароль
# вставь новый WEB_PASSWORD_HASH в .env
docker compose up -d
```
