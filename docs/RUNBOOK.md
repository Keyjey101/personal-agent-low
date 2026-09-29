# RUNBOOK — установка, обновление, восстановление

## Архитектура деплоя

```text
интернет → nginx (TLS, certbot, gmyrya.com) → 127.0.0.1:8080 → контейнер app (Docker)
```

Приложение одно и обслуживает всё: страницы, `/api/*`, `/healthz`. Отдельный `location /api/`
в nginx не нужен. Наружу контейнер не проброшен — порт `8080` слушает только на localhost
(`ports: "127.0.0.1:8080:8080"` в docker-compose).

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
WEB_PASSWORD_HASH=$argon2id$...длинная строка...
SESSION_SECRET=c29tZS1yYW5kb20t...
```

Вставь обе строки в .env как есть. `SESSION_SECRET` — не пароль, просто случайный шум;
после первой установки его не меняй (иначе все сессии слетят — не страшно, просто перелогинишься).

## Установка

```bash
git clone git@github.com:Keyjey101/personal-agent-low.git && cd personal-agent-low
cp .env.example .env
# заполнить .env (см. таблицу выше)
docker compose up -d --build
curl -f http://localhost:8080/healthz        # {"ok":true,"db":true}
```

### nginx

В `/etc/nginx/sites-enabled/gmyrya.com` замени проксирование: блок `location /api/ {...}`
удаляем (он больше никуда не ведёт), `location /` ведём на 8080. Блоки certbot
(ssl_certificate, listen 443 ssl, редирект 80→443) не трогаем. Итоговый server-блок:

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
    ssl_certificate /etc/letsencrypt/live/gmyrya.com/fullchain.pem; # managed by Certbot
    ssl_certificate_key /etc/letsencrypt/live/gmyrya.com/privkey.pem; # managed by Certbot
    include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot
}
```

Применение: `nginx -t && systemctl reload nginx`.

Если на старых портах 3000/3001 жили другие приложения и они ещё нужны — они больше
не доступны через gmyrya.com (весь домен теперь ведёт на Диспетчера); при необходимости
раздай им другие поддомены.

Проверка: `https://gmyrya.com` — страница входа; `/start` боту в Telegram.

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
curl -f http://localhost:8080/healthz
```

Процедуру обязательно прогнать на копии хотя бы раз (критерий приёмки №13 ТЗ).

## Диагностика

| Симптом | Что смотреть |
|---|---|
| 502 на gmyrya.com | `docker compose ps` (app жив?), `curl -f http://localhost:8080/healthz` |
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
