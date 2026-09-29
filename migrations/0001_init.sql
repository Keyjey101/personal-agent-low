-- Схема «Диспетчера» (ТЗ раздел 4). Времена — ISO 8601 UTC в TEXT.

CREATE TABLE projects (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  area         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active',
  priority     INTEGER NOT NULL DEFAULT 3,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE tasks (
  id                 INTEGER PRIMARY KEY,
  project_id         INTEGER REFERENCES projects(id),
  parent_task_id     INTEGER REFERENCES tasks(id),
  title              TEXT NOT NULL,
  description        TEXT NOT NULL DEFAULT '',
  status             TEXT NOT NULL DEFAULT 'todo',
  estimated_minutes  INTEGER,
  energy_required    INTEGER,
  focus_required     TEXT NOT NULL DEFAULT 'normal',
  danger_level       TEXT NOT NULL DEFAULT 'none',
  tags               TEXT NOT NULL DEFAULT '[]',
  due_at             TEXT,
  recurrence         TEXT NOT NULL DEFAULT 'none',
  deferred_until     TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  started_at         TEXT,
  completed_at       TEXT
);
CREATE INDEX idx_tasks_status  ON tasks(status);
CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_due     ON tasks(due_at);

CREATE TABLE task_edges (
  id           INTEGER PRIMARY KEY,
  from_task_id INTEGER NOT NULL REFERENCES tasks(id),
  to_task_id   INTEGER NOT NULL REFERENCES tasks(id),
  relation     TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  UNIQUE (from_task_id, to_task_id, relation)
);

CREATE TABLE entities (
  id          INTEGER PRIMARY KEY,
  kind        TEXT NOT NULL,
  name        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  props       TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE entity_edges (
  id             INTEGER PRIMARY KEY,
  from_entity_id INTEGER NOT NULL REFERENCES entities(id),
  to_entity_id   INTEGER NOT NULL REFERENCES entities(id),
  relation       TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  UNIQUE (from_entity_id, to_entity_id, relation)
);

CREATE TABLE task_entities (
  task_id   INTEGER NOT NULL REFERENCES tasks(id),
  entity_id INTEGER NOT NULL REFERENCES entities(id),
  relation  TEXT NOT NULL DEFAULT 'about',
  PRIMARY KEY (task_id, entity_id)
);

CREATE TABLE memory_entries (
  id         INTEGER PRIMARY KEY,
  kind       TEXT NOT NULL,
  content    TEXT NOT NULL,
  source     TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.8,
  is_active  INTEGER NOT NULL DEFAULT 1,
  supersedes INTEGER REFERENCES memory_entries(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE memory_fts USING fts5(
  content, content='memory_entries', content_rowid='id'
);
CREATE TRIGGER memory_ai AFTER INSERT ON memory_entries BEGIN
  INSERT INTO memory_fts(rowid, content) VALUES (new.id, new.content);
END;
CREATE TRIGGER memory_ad AFTER DELETE ON memory_entries BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, content) VALUES ('delete', old.id, old.content);
END;
CREATE TRIGGER memory_au AFTER UPDATE ON memory_entries BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, content) VALUES ('delete', old.id, old.content);
  INSERT INTO memory_fts(rowid, content) VALUES (new.id, new.content);
END;

CREATE TABLE user_states (
  id                INTEGER PRIMARY KEY,
  recorded_at       TEXT NOT NULL,
  energy            INTEGER,
  mood              TEXT,
  available_minutes INTEGER,
  focus             TEXT,
  intoxication      TEXT,
  note              TEXT
);

CREATE TABLE events (
  id         INTEGER PRIMARY KEY,
  ts         TEXT NOT NULL,
  type       TEXT NOT NULL,
  task_id    INTEGER,
  project_id INTEGER,
  text       TEXT,
  payload    TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_events_ts ON events(ts);
CREATE INDEX idx_events_type_ts ON events(type, ts);

CREATE VIRTUAL TABLE tasks_fts USING fts5(
  title, description, content='tasks', content_rowid='id'
);
CREATE TRIGGER tasks_ai AFTER INSERT ON tasks BEGIN
  INSERT INTO tasks_fts(rowid, title, description) VALUES (new.id, new.title, new.description);
END;
CREATE TRIGGER tasks_ad AFTER DELETE ON tasks BEGIN
  INSERT INTO tasks_fts(tasks_fts, rowid, title, description) VALUES ('delete', old.id, old.title, old.description);
END;
CREATE TRIGGER tasks_au AFTER UPDATE OF title, description ON tasks BEGIN
  INSERT INTO tasks_fts(tasks_fts, rowid, title, description) VALUES ('delete', old.id, old.title, old.description);
  INSERT INTO tasks_fts(rowid, title, description) VALUES (new.id, new.title, new.description);
END;

CREATE TABLE reminders (
  id             INTEGER PRIMARY KEY,
  kind           TEXT NOT NULL,
  due_at         TEXT,
  condition      TEXT,
  message_hint   TEXT NOT NULL DEFAULT '',
  critical       INTEGER NOT NULL DEFAULT 0,
  cooldown_hours INTEGER NOT NULL DEFAULT 24,
  status         TEXT NOT NULL DEFAULT 'pending',
  last_fired_at  TEXT,
  fire_count     INTEGER NOT NULL DEFAULT 0,
  max_fires      INTEGER NOT NULL DEFAULT 1,
  muted_until    TEXT,
  created_by     TEXT NOT NULL DEFAULT 'agent',
  created_at     TEXT NOT NULL
);

CREATE TABLE sessions (
  id              INTEGER PRIMARY KEY,
  mode            TEXT NOT NULL,
  started_at      TEXT NOT NULL,
  ends_at         TEXT NOT NULL,
  current_task_id INTEGER,
  completed_count INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO settings (key, value) VALUES
  ('tz', '"Europe/Moscow"'),
  ('proactivity_level', '2'),
  ('quiet_hours', '{"start":"23:00","end":"09:00"}'),
  ('work_hours', '{"start":"07:00","end":"18:00","days":["mon","tue","wed","thu","fri"]}'),
  ('proactive_budget', '{"max_per_day":2,"min_interval_hours":4,"max_critical_work_per_day":1}'),
  ('backoff', '{"base_days":1,"max_days":7}'),
  ('mute_days_after_explicit_no', '7'),
  ('scoring_weights', '{"priority":10,"staleness_per_day":1,"staleness_cap":14,"due_3d":15,"overdue":25,"momentum_7d":5,"quick_win_low_energy":8,"status_next":5}'),
  ('stale_project_days', '10'),
  ('seeded', '0'),
  ('suggestion_snooze', '{}'),
  ('proactive_state', '{}');
