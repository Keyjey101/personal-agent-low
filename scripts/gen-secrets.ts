import { hash } from '@node-rs/argon2';
import crypto from 'node:crypto';
import readline from 'node:readline/promises';

async function main(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const password = await rl.question('Пароль для веб-интерфейса: ');
  await rl.close();
  if (password.length < 6) {
    console.error('Минимум 6 символов.');
    process.exit(1);
  }
  const passwordHash = await hash(password, {});
  const sessionSecret = crypto.randomBytes(32).toString('base64');
  console.log('\nДобавь в .env (кавычки обязательны: внутри хеша есть $,\n' +
    'которые docker compose без кавычек подставляет как переменные):\n');
  console.log(`WEB_PASSWORD_HASH='${passwordHash}'`);
  console.log(`SESSION_SECRET='${sessionSecret}'`);
}

void main();
