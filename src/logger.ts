import fs from 'node:fs';
import path from 'node:path';
import { Writable } from 'node:stream';
import pino from 'pino';

/**
 * pino в файл с дневной ротацией и хранением 14 дней (без внешних зависимостей).
 */
export function createLogger(dataDir: string, level: string): pino.Logger {
  const dir = path.join(dataDir, 'logs');
  fs.mkdirSync(dir, { recursive: true });
  let day = new Date().toISOString().slice(0, 10);
  let stream = fs.createWriteStream(path.join(dir, `app-${day}.log`), { flags: 'a' });

  const cleanup = () => {
    try {
      const files = fs.readdirSync(dir).filter((f) => /^app-\d{4}-\d{2}-\d{2}\.log$/.test(f)).sort();
      for (const f of files.slice(0, Math.max(0, files.length - 14))) {
        fs.unlinkSync(path.join(dir, f));
      }
    } catch { /* noop */ }
  };

  const sink = new Writable({
    write(chunk: Buffer, _enc, cb) {
      const today = new Date().toISOString().slice(0, 10);
      if (today !== day) {
        day = today;
        stream.end();
        stream = fs.createWriteStream(path.join(dir, `app-${day}.log`), { flags: 'a' });
        cleanup();
      }
      stream.write(chunk);
      cb();
    },
  });

  return pino({ level, timestamp: pino.stdTimeFunctions.isoTime }, sink);
}

export function createSilentLogger(): pino.Logger {
  return pino({ enabled: false });
}
