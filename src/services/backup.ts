import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import type { DB } from '../infra/db/client';
import { Repo } from '../infra/db/repos';
import { Clock } from '../clock';
import { localParts } from '../domain/time';
import type { Logger } from 'pino';

const KEEP_DAILY = 7;
const KEEP_WEEKLY_MONDAYS = 4;

/** Бэкапы (ТЗ 13): VACUUM INTO + gzip, retention 7 дневных + 4 понедельника, хук-скрипт. */
export class BackupService {
  constructor(private db: DB, private repo: Repo, private dataDir: string,
              private tz: () => string, private clock: Clock, private log: Logger) {}

  private dir(): string {
    const dir = path.join(this.dataDir, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  async run(): Promise<{ file: string; size: number }> {
    const day = localParts(this.clock.now(), this.tz()).dateStr;
    const dir = this.dir();
    const raw = path.join(dir, `app-${day}.db`);
    const gz = raw + '.gz';
    if (fs.existsSync(raw)) fs.unlinkSync(raw);
    if (fs.existsSync(gz)) fs.unlinkSync(gz);

    this.db.exec(`VACUUM INTO '${raw.replace(/'/g, "''")}'`);
    await pipeline(
      fs.createReadStream(raw),
      zlib.createGzip({ level: 6 }),
      fs.createWriteStream(gz),
    );
    fs.unlinkSync(raw);

    this.retention(dir);
    const size = fs.statSync(gz).size;
    this.repo.addEvent('BACKUP_DONE', { payload: { file: path.basename(gz), size } }, this.clock.now().toISOString());
    this.log.info({ file: path.basename(gz), size }, 'backup done');
    this.runHook(gz);
    return { file: path.basename(gz), size };
  }

  private retention(dir: string): void {
    const files = fs.readdirSync(dir)
      .filter((f) => /^app-\d{4}-\d{2}-\d{2}\.db\.gz$/.test(f))
      .sort()
      .reverse();
    const keep = new Set<string>();
    let days = 0;
    let mondays = 0;
    for (const f of files) {
      const date = f.slice(4, 14);
      const isMonday = new Date(`${date}T12:00:00Z`).getUTCDay() === 1;
      if (days < KEEP_DAILY) { keep.add(f); days++; continue; }
      if (isMonday && mondays < KEEP_WEEKLY_MONDAYS) { keep.add(f); mondays++; continue; }
    }
    for (const f of files) {
      if (!keep.has(f)) {
        try { fs.unlinkSync(path.join(dir, f)); } catch { /* noop */ }
      }
    }
  }

  private runHook(gzPath: string): void {
    const hook = path.join(this.dir(), 'post-backup.sh');
    if (!fs.existsSync(hook)) return;
    try {
      const child = spawn('sh', [hook, gzPath], { detached: true, stdio: 'ignore' });
      child.unref();
    } catch (e) {
      this.log.warn({ err: (e as Error).message }, 'backup hook failed');
    }
  }

  list(): { file: string; size: number; at: string }[] {
    try {
      const dir = this.dir();
      return fs.readdirSync(dir)
        .filter((f) => f.endsWith('.db.gz'))
        .map((f) => ({ file: f, size: fs.statSync(path.join(dir, f)).size, at: fs.statSync(path.join(dir, f)).mtime.toISOString() }))
        .sort((a, b) => b.file.localeCompare(a.file));
    } catch {
      return [];
    }
  }

  filePath(file: string): string | null {
    if (!/^app-\d{4}-\d{2}-\d{2}\.db\.gz$/.test(file)) return null; // без обхода пути
    const p = path.join(this.dir(), file);
    return fs.existsSync(p) ? p : null;
  }
}
