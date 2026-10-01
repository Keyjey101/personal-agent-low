import { describe, expect, it } from 'vitest';
import { SessionService } from '../../src/services/session';
import { Settings } from '../../src/services/settings';
import { TaskOps } from '../../src/services/taskops';
import { systemClock } from '../../src/clock';
import { makeTestDb } from '../helpers/testdb';

function makeService() {
  const { repo } = makeTestDb();
  const settings = new Settings(repo);
  const ops = new TaskOps(repo, settings, systemClock);
  const sent: string[] = [];
  const sessions = new SessionService(repo, ops, settings, systemClock, async (text) => { sent.push(text); });
  return { repo, ops, sessions, sent };
}

describe('SessionService — P0 фиксы', () => {
  it('повторный start() возвращает past-задачу из active в todo (нет утечки)', async () => {
    const { repo, sessions } = makeService();
    const task = repo.createTask({ title: 'Замерить окно', estimated_minutes: 10, energy_required: 1 }, new Date().toISOString());
    repo.updateTask(task.id, { status: 'active' }, new Date().toISOString());

    sessions.start(30);
    const s1 = repo.activeSession()!;
    repo.updateSession(s1.id, { current_task_id: task.id });

    sessions.start(15); // повторный /lead
    const after = repo.getTask(task.id)!;
    expect(after.status).toBe('todo'); // не залипла в active
    expect(repo.activeSession()!.id).not.toBe(s1.id);
  });

  it('doneCurrent идемпотентен: задача уже закрыта снаружи — сессия всё равно продолжает', async () => {
    const { repo, ops, sessions } = makeService();
    const t1 = ops.createTask({ title: 'Шаг один', estimated_minutes: 5, energy_required: 1 });
    const t2 = ops.createTask({ title: 'Шаг два', estimated_minutes: 5, energy_required: 1 });

    sessions.start(30);
    const s = repo.activeSession()!;
    repo.updateTask(t1.id, { status: 'active' }, new Date().toISOString());
    repo.updateSession(s.id, { current_task_id: t1.id });

    ops.completeTask(t1.id); // закрыли кнопкой параллельно
    const ok = await sessions.doneCurrent(); // не должно бросить «уже завершена»
    expect(ok).toBe(true);
    expect(repo.activeSession()!.completed_count).toBe(1);
  });

  it('название задачи с < > экранируется в сообщении сессии', async () => {
    const { ops, sessions, sent } = makeService();
    ops.createTask({ title: 'Заказать <деталь> для люстры & кухни', estimated_minutes: 5, energy_required: 1 });
    sessions.start(30);
    await sessions.proposeNext();
    expect(sent[0]).toContain('&lt;деталь&gt;');
    expect(sent[0]).toContain('&amp;');
    expect(sent[0]).not.toContain('<деталь>');
  });
});
