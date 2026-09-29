export type TaskStatus = 'idea' | 'todo' | 'next' | 'active' | 'waiting' | 'done' | 'cancelled';
export type ProjectStatus = 'active' | 'paused' | 'done' | 'cancelled';
export type Danger = 'none' | 'tools' | 'electricity' | 'heavy' | 'height';
export type Focus = 'low' | 'normal' | 'high';
export type Intox = 'none' | 'mild' | 'significant';
export type Recurrence = 'none' | 'daily' | 'weekly' | 'monthly';
export type Area =
  | 'kitchen' | 'car' | 'fitness' | 'home' | 'massage'
  | 'print' | 'books' | 'finance' | 'server' | 'other';

export interface Task {
  id: number;
  project_id: number | null;
  parent_task_id: number | null;
  title: string;
  description: string;
  status: TaskStatus;
  estimated_minutes: number | null;
  energy_required: number | null;
  focus_required: Focus;
  danger_level: Danger;
  tags: string[];
  due_at: string | null;          // дата 'YYYY-MM-DD' (локальная) или null
  recurrence: Recurrence;
  deferred_until: string | null;  // ISO UTC
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  project_status?: ProjectStatus; // из JOIN при выборках
  project_name?: string | null;
  project_priority?: number;
}

export interface Project {
  id: number;
  name: string;
  description: string;
  area: Area | string;
  status: ProjectStatus;
  priority: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface UserState {
  id: number;
  recorded_at: string;
  energy: number | null;
  mood: string | null;
  available_minutes: number | null;
  focus: Focus | null;
  intoxication: Intox | null;
  note: string | null;
}

export interface EventRow {
  id: number;
  ts: string;
  type: string;
  task_id: number | null;
  project_id: number | null;
  text: string | null;
  payload: Record<string, unknown>;
}

export interface MemoryEntry {
  id: number;
  kind: 'preference' | 'fact' | 'insight' | 'routine' | 'pattern';
  content: string;
  source: 'user_told' | 'agent_observed' | 'system';
  confidence: number;
  is_active: boolean;
  supersedes: number | null;
  created_at: string;
  updated_at: string;
}

export type ReminderCondition =
  | { type: 'task_stale'; task_id: number; days: number }
  | { type: 'project_no_progress'; project_id: number; days: number }
  | { type: 'due_near'; task_id: number; hours: number }
  | { type: 'not_done_by'; task_id: number; by: string }
  | { type: 'and'; conditions: ReminderCondition[] }
  | { type: 'or'; conditions: ReminderCondition[] };

export interface Reminder {
  id: number;
  kind: 'simple' | 'conditional';
  due_at: string | null;
  condition: ReminderCondition | null;
  message_hint: string;
  critical: boolean;
  cooldown_hours: number;
  status: 'pending' | 'fired' | 'cancelled' | 'snoozed';
  last_fired_at: string | null;
  fire_count: number;
  max_fires: number;
  muted_until: string | null;
  created_by: 'user' | 'agent';
  created_at: string;
}

export interface Session {
  id: number;
  mode: 'guide' | 'micro';
  started_at: string;
  ends_at: string;
  current_task_id: number | null;
  completed_count: number;
  status: 'active' | 'finished' | 'aborted';
}

export interface Ranked {
  task: Task;
  score: number;
  reasons: string[];
}

export const OPEN_STATUSES: TaskStatus[] = ['todo', 'next', 'active', 'waiting'];
export const DONE_STATUSES: TaskStatus[] = ['done', 'cancelled'];
