import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { openDatabase, SqliteDb } from './driver';

export type DB = SqliteDb;

export function openDb(dataDir: string): DB {
  fs.mkdirSync(dataDir, { recursive: true });
  return openDatabase(path.join(dataDir, 'app.db'));
}

/**
 * Сериализация write-операций. Реентерабельная: вложенный run() из того же
 * асинхронного контекста проходит без постановки в очередь (иначе планировщик,
 * держащий лок, дедлочился на вложенном захвате — например, рефлектор внутри тика).
 */
export class WriteLock {
  private chain: Promise<unknown> = Promise.resolve();
  private als = new AsyncLocalStorage<{ owner: true }>();

  run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.als.getStore()) return fn(); // уже держим лок в этом контексте
    const next = this.chain.then(() => this.als.run({ owner: true }, fn));
    this.chain = next.then(() => undefined, () => undefined);
    return next;
  }
}
