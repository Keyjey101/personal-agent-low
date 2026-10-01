import { Repo } from '../infra/db/repos';
import { TaskOps } from './taskops';
import { Settings } from './settings';
import { Clock } from '../clock';
import { Session, Task } from '../domain/types';
import { htmlEscape } from '../infra/telegram/escape';

/**
 * Режим «веди меня N минут» (ТЗ 10.1 /lead): агент выдаёт действия
 * одно за другим, «готово» завершает текущее и даёт следующее.
 */
export class SessionService {
  constructor(private repo: Repo, private ops: TaskOps, private settings: Settings,
              private clock: Clock, private sender: (text: string, proposeTaskId?: number | null) => Promise<void>) {}

  active(): Session | null { return this.repo.activeSession(); }

  start(minutes: number, mode: 'guide' | 'micro' = 'guide'): Session {
    const existing = this.active();
    if (existing) {
      // не оставляем «залипшую» active-задачу от прошлой сессии
      if (existing.current_task_id) {
        const prev = this.repo.getTask(existing.current_task_id);
        if (prev && prev.status === 'active') {
          this.repo.updateTask(prev.id, { status: 'todo' }, this.clock.now().toISOString());
        }
      }
      this.repo.updateSession(existing.id, { status: 'aborted' });
    }
    const s = this.repo.insertSession(mode, minutes, this.clock.now().toISOString());
    this.repo.addEvent('SESSION_START', { payload: { minutes, sessionId: s.id } }, this.clock.now().toISOString());
    return s;
  }

  /** Предложить первое/следующее действие сессии. */
  async proposeNext(): Promise<void> {
    const s = this.active();
    if (!s) return;
    const top = this.ops.topAction();
    if (!top) {
      await this.sender('Свободных действий под твоё состояние нет. Сессия завершена.', null);
      await this.end('нет кандидатов');
      return;
    }
    // прошлую текущую задачу возвращаем в очередь, если не закрыта
    if (s.current_task_id) {
      const prev = this.repo.getTask(s.current_task_id);
      if (prev && prev.status === 'active') {
        this.repo.updateTask(prev.id, { status: 'next' }, this.clock.now().toISOString());
      }
    }
    this.repo.updateTask(top.task.id, { status: 'active' }, this.clock.now().toISOString());
    this.repo.updateSession(s.id, { current_task_id: top.task.id });
    await this.sender(
      `Веду.\n\nДействие: <b>${htmlEscape(top.task.title)}</b>.\n~${top.task.estimated_minutes ?? 30} мин.\n\nНапиши «готово», когда закончишь.`,
      top.task.id,
    );
  }

  /** Пользователь завершил текущее действие сессии. Идемпотентно: задача уже closed — считаем успехом. */
  async doneCurrent(note?: string): Promise<boolean> {
    const s = this.active();
    if (!s || !s.current_task_id) return false;
    const cur = this.repo.getTask(s.current_task_id);
    if (cur && cur.status !== 'done' && cur.status !== 'cancelled') {
      this.ops.completeTask(s.current_task_id, note);
    }
    this.repo.updateSession(s.id, { completed_count: s.completed_count + 1, current_task_id: null });
    await this.proposeNext();
    return true;
  }

  /** Задача завершена снаружи (кнопка/команда), но она была текущей в сессии. */
  async doneExternal(taskId: number): Promise<boolean> {
    const s = this.active();
    if (!s || s.current_task_id !== taskId) return false;
    this.repo.updateSession(s.id, { completed_count: s.completed_count + 1, current_task_id: null });
    await this.proposeNext();
    return true;
  }

  /** Смена действия в сессии («другое»). */
  async skipCurrent(): Promise<boolean> {
    const s = this.active();
    if (!s) return false;
    if (s.current_task_id) {
      const prev = this.repo.getTask(s.current_task_id);
      if (prev && prev.status === 'active') {
        this.repo.updateTask(prev.id, { status: 'todo' }, this.clock.now().toISOString());
      }
      this.ops.snoozeSuggestion(s.current_task_id, 1);
    }
    await this.proposeNext();
    return true;
  }

  async end(reason: string): Promise<void> {
    const s = this.active();
    if (!s) return;
    if (s.current_task_id) {
      const cur = this.repo.getTask(s.current_task_id);
      if (cur && cur.status === 'active') this.repo.updateTask(cur.id, { status: 'todo' }, this.clock.now().toISOString());
    }
    this.repo.updateSession(s.id, { status: 'finished', current_task_id: null });
    this.repo.addEvent('SESSION_END', { payload: { sessionId: s.id, completed: s.completed_count, reason } }, this.clock.now().toISOString());
    await this.sender(`Сессия завершена. Выполнено: ${s.completed_count}. Хорошо.`,
      null);
  }

  /** Вызывается планировщиком: закрыть сессии, у которых вышло время. */
  async expireOverdue(): Promise<void> {
    const s = this.active();
    if (s && s.ends_at <= this.clock.now().toISOString()) {
      await this.end('время вышло');
    }
  }

  currentTask(): Task | null {
    const s = this.active();
    return s?.current_task_id ? this.repo.getTask(s.current_task_id) ?? null : null;
  }
}
