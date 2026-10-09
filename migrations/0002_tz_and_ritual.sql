-- Личные настройки пользователя: таймзона Екатеринбург (UTC+5).
-- Системная зона VPS (CEST) и env TZ на логику не влияют — всё по этой настройке.
UPDATE settings SET value = '"Asia/Yekaterinburg"' WHERE key = 'tz';

-- Вечерний ритуал «закрытие дня» (~21:30, окно до тихих часов).
-- Заменяет старое правило evening_window (18:05): одно вечернее касание
-- вместо двух, в реальном окне активности пользователя (лог: 21:54–23:20).
INSERT INTO settings (key, value) VALUES ('evening_ritual', '{"enabled":1,"at":"21:30"}')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;
