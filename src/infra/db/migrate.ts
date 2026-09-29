import fs from 'node:fs';
import path from 'node:path';
import type { DB } from './client';

/**
 * Раннер миграций: файлы migrations/NNNN_*.sql по порядку,
 * применённая версия — в служебной таблице _meta.
 */
export function migrate(db: DB, migrationsDir: string): void {
  db.exec('CREATE TABLE IF NOT EXISTS _meta (version INTEGER NOT NULL)');
  const currentRow = db.prepare('SELECT version FROM _meta').get() as { version: number } | undefined;
  const current = currentRow?.version ?? 0;
  let version = current;

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const v = parseInt(file.split('_')[0], 10);
    if (!Number.isFinite(v)) throw new Error(`Bad migration name: ${file}`);
    if (v <= current) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(sql);
      db.exec(`INSERT INTO _meta (version) VALUES (${v})`);
      db.exec('COMMIT');
      version = v;
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${(e as Error).message}`);
    }
  }
  if (version !== current) {
    // eslint-disable-next-line no-console
    console.log(`[db] applied migrations up to version ${version}`);
  }
}
