/**
 * Распознавание коротких команд внутри сессии «веди меня».
 * ВАЖНО: \b в JS не работает после кириллицы (\w = [A-Za-z0-9_]),
 * поэтому граница слова — явная: пробел, конец строки или пунктуация.
 */
const DONE_RE = /^(?:готово|сделал|сделала|done|закончил|закончила|всё|все)(?:\s|$|[.,!?])/i;
const SKIP_RE = /^(?:другое|дальше|skip|следующее)(?:\s|$|[.,!?])/i;
const STOP_RE = /^(?:стоп|хватит|останови|stop)(?:\s|$|[.,!?])/i;

export type SessionIntent = 'done' | 'skip' | 'stop' | null;

export function sessionIntent(text: string): SessionIntent {
  const t = text.trim();
  if (DONE_RE.test(t)) return 'done';
  if (SKIP_RE.test(t)) return 'skip';
  if (STOP_RE.test(t)) return 'stop';
  return null;
}
