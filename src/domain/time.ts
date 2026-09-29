export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface LocalParts {
  y: number; m: number; d: number; hh: number; mm: number;
  weekday: Weekday; hm: number; dateStr: string; // 'YYYY-MM-DD'
}

const cache = new Map<string, Intl.DateTimeFormat>();

function fmt(tz: string): Intl.DateTimeFormat {
  let f = cache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, weekday: 'short', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    });
    cache.set(tz, f);
  }
  return f;
}

const WD: Record<string, Weekday> = {
  Mon: 'mon', Tue: 'tue', Wed: 'wed', Thu: 'thu', Fri: 'fri', Sat: 'sat', Sun: 'sun',
};

export function localParts(date: Date, tz: string): LocalParts {
  const parts = fmt(tz).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const y = parseInt(get('year'), 10);
  const m = parseInt(get('month'), 10);
  const d = parseInt(get('day'), 10);
  let hh = parseInt(get('hour'), 10);
  if (hh === 24) hh = 0;
  const mm = parseInt(get('minute'), 10);
  return {
    y, m, d, hh, mm,
    weekday: WD[get('weekday')] ?? 'mon',
    hm: hh * 60 + mm,
    dateStr: `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
  };
}

export function parseHM(s: string): number {
  const [h, m] = s.split(':').map((x) => parseInt(x, 10));
  return (h || 0) * 60 + (m || 0);
}

/** Локальное время tz → UTC-момент (устойчиво к смещениям и DST). */
export function tzToUtc(tz: string, y: number, mo: number, d: number, h = 0, mi = 0, s = 0): Date {
  let ts = Date.UTC(y, mo - 1, d, h, mi, s);
  for (let i = 0; i < 2; i++) {
    const p = localParts(new Date(ts), tz);
    const cur = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm);
    const want = Date.UTC(y, mo - 1, d, h, mi);
    if (cur === want) break;
    ts += want - cur;
  }
  return new Date(ts);
}

/** Начало текущих локальных суток в UTC (ISO). */
export function todayStartIso(now: Date, tz: string): string {
  const p = localParts(now, tz);
  return tzToUtc(tz, p.y, p.m, p.d, 0, 0).toISOString();
}

/** Окно рабочих часов сегодня в UTC (ISO). */
export function workWindowIso(now: Date, tz: string, startHM: string, endHM: string): { start: string; end: string } {
  const p = localParts(now, tz);
  const [sh, sm] = startHM.split(':').map(Number);
  const [eh, em] = endHM.split(':').map(Number);
  return {
    start: tzToUtc(tz, p.y, p.m, p.d, sh, sm).toISOString(),
    end: tzToUtc(tz, p.y, p.m, p.d, eh, em).toISOString(),
  };
}

export function daysBetween(fromIso: string, toNow: Date): number {
  return Math.floor((toNow.getTime() - new Date(fromIso).getTime()) / 86_400_000);
}

export function isWorkday(weekday: Weekday, days: string[]): boolean {
  return days.includes(weekday);
}
