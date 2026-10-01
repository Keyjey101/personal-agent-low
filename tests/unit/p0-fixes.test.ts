import { describe, expect, it } from 'vitest';
import { WriteLock } from '../../src/infra/db/client';
import { sessionIntent } from '../../src/infra/telegram/session-words';

describe('WriteLock — реентерабельность (фикс дедлока планировщик→рефлектор)', () => {
  it('вложенный run() из того же контекста не дедлочится', async () => {
    const lock = new WriteLock();
    const order: string[] = [];
    await lock.run(async () => {
      order.push('outer-start');
      await lock.run(async () => { order.push('inner'); });
      order.push('outer-end');
    });
    expect(order).toEqual(['outer-start', 'inner', 'outer-end']);
  });

  it('разные контексты по-прежнему сериализуются', async () => {
    const lock = new WriteLock();
    const log: number[] = [];
    let release1!: () => void;
    const p1 = lock.run(() => new Promise<void>((r) => { release1 = r; }).then(() => { log.push(1); }));
    const p2 = lock.run(async () => { log.push(2); });
    await new Promise((r) => setTimeout(r, 20));
    expect(log).toEqual([]); // второй ждёт первого
    release1();
    await Promise.all([p1, p2]);
    expect(log).toEqual([1, 2]);
  });
});

describe('sessionIntent — кириллица (фикс \\b)', () => {
  it('распознаёт слова сессии с пунктуацией и без', () => {
    expect(sessionIntent('готово')).toBe('done');
    expect(sessionIntent('Готово!')).toBe('done');
    expect(sessionIntent('сделал.')).toBe('done');
    expect(sessionIntent('СДЕЛАЛ')).toBe('done');
    expect(sessionIntent('всё')).toBe('done');
    expect(sessionIntent('done')).toBe('done');
    expect(sessionIntent('другое давай')).toBe('skip');
    expect(sessionIntent('Дальше!')).toBe('skip');
    expect(sessionIntent('стоп')).toBe('stop');
    expect(sessionIntent('Хватит.')).toBe('stop');
  });
  it('не реагирует на похожие слова и обычную речь', () => {
    expect(sessionIntent('готовности')).toBeNull();
    expect(sessionIntent('сделать')).toBeNull();
    expect(sessionIntent('стопкран')).toBeNull();
    expect(sessionIntent('что делать?')).toBeNull();
    expect(sessionIntent('я сделал домашку, но потом передумал')).toBeNull();
  });
});
