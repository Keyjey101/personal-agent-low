import fs from 'node:fs';
import path from 'node:path';
import { openDatabase, SqliteDb } from './driver';

export type DB = SqliteDb;

export function openDb(dataDir: string): DB {
  fs.mkdirSync(dataDir, { recursive: true });
  return openDatabase(path.join(dataDir, 'app.db'));
}

/** Все записи идут через этот lock: агент держит транзакцию открытой между раундами GLM. */
export class WriteLock {
  private chain: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => undefined);
    return next;
  }
}
