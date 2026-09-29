import { DatabaseSync } from 'node:sqlite';

/**
 * Тонкая адаптация node:sqlite (встроен в Node ≥ 23.4, без нативных зависимостей).
 * Используется подмножество API, совместимое по смыслу с better-sqlite3.
 */
export interface Stmt {
  run(...args: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...args: unknown[]): unknown;
  all(...args: unknown[]): unknown[];
}

export interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): Stmt;
  close(): void;
}

export function openDatabase(path: string): SqliteDb {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  return db as unknown as SqliteDb;
}

export function openMemory(): SqliteDb {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  return db as unknown as SqliteDb;
}
