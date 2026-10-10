// Сборка фронта без сборщика: web/ статикой копируется в web-dist/.
// Запускается из `npm run build` (после tsc). Node >=20.
import { cpSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'web');
const dst = path.join(root, 'web-dist');

if (!existsSync(src)) throw new Error('нет каталога web/');
rmSync(dst, { recursive: true, force: true });
cpSync(src, dst, { recursive: true });
console.log(`web-dist обновлён: ${src} → ${dst}`);
