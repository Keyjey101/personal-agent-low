/** Экранирование для parse_mode: HTML. Обязательно для всех сырых текстов. */
export function htmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
