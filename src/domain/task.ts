import { Recurrence, TaskStatus } from './types';

/** Допустимые переходы статусов задач. */
const TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  idea: ['todo', 'next', 'cancelled'],
  todo: ['next', 'active', 'waiting', 'idea', 'done', 'cancelled'],
  next: ['active', 'todo', 'waiting', 'done', 'cancelled'],
  active: ['done', 'todo', 'waiting', 'cancelled'],
  waiting: ['todo', 'next', 'done', 'cancelled'],
  done: ['todo'],
  cancelled: ['todo'],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return from === to || TRANSITIONS[from]?.includes(to) || false;
}

/**
 * Следующая дата рекуррентной задачи. due_at — локальная дата 'YYYY-MM-DD'.
 * Если закрываем раньше срока — следующий экземпляр через период от due.
 * Если закрываем с просрочкой — ближайшая дата периода в будущем.
 */
export function nextRecurrenceDue(prevDue: string | null, recurrence: Recurrence, todayLocal: string): string | null {
  if (recurrence === 'none') return null;
  if (recurrence === 'daily') return shiftDays(maxDate(prevDue ?? todayLocal, todayLocal), 1);
  if (recurrence === 'weekly') return shiftDays(maxDate(prevDue ?? todayLocal, todayLocal), 7);
  // monthly: двигаем по циклу, пока не выйдем за сегодня
  let next = addMonthClamped(prevDue ?? todayLocal);
  while (next <= todayLocal) next = addMonthClamped(next);
  return next;
}

function maxDate(a: string, b: string): string { return a >= b ? a : b; }

function addMonthClamped(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const nm = m === 12 ? 1 : m + 1;
  const ny = m === 12 ? y + 1 : y;
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
}

function shiftDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}
