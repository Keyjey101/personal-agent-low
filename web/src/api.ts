export class UnauthorizedError extends Error {
  constructor() { super('unauthorized'); this.name = 'UnauthorizedError'; }
}

export async function api<T = unknown>(path: string, opts?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: opts?.method ?? 'GET',
    headers: { 'content-type': 'application/json' },
    body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as any).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const fmtTime = (iso: string) => new Date(iso).toLocaleString('ru-RU');
export const fmtSize = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} МБ` : `${Math.round(n / 1024)} КБ`);

export interface Task {
  id: number; project_id: number | null; parent_task_id: number | null;
  title: string; description: string; status: string;
  estimated_minutes: number | null; energy_required: number | null;
  focus_required: string; danger_level: string; tags: string[];
  due_at: string | null; recurrence: string; deferred_until: string | null;
  created_at: string; completed_at: string | null;
  project_name?: string | null; project_priority?: number;
}

export interface Project {
  id: number; name: string; description: string; area: string;
  status: string; priority: number; open_tasks?: number;
}
