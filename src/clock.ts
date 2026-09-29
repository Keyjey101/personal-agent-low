export interface Clock { now(): Date }

export const systemClock: Clock = { now: () => new Date() };

/** Фейковые часы для тестов. */
export class FakeClock implements Clock {
  constructor(private date: Date) {}
  now(): Date { return this.date; }
  advance(ms: number): void { this.date = new Date(this.date.getTime() + ms); }
  set(date: Date): void { this.date = date; }
}
