import path from 'node:path';
import { migrate } from '../../src/infra/db/migrate';
import { Repo } from '../../src/infra/db/repos';
import { openMemory } from '../../src/infra/db/driver';
import type { DB } from '../../src/infra/db/client';

export const MIGRATIONS_DIR = path.resolve(__dirname, '../../migrations');

export function makeTestDb(): { db: DB; repo: Repo } {
  const db = openMemory();
  migrate(db, MIGRATIONS_DIR);
  return { db, repo: new Repo(db) };
}
