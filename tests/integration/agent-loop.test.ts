import { describe, expect, it } from 'vitest';
import { AgentLoop } from '../../src/services/agent/loop';
import { LlmClient, LlmMessage, LlmResponse } from '../../src/infra/llm/glm';
import { Settings } from '../../src/services/settings';
import { TaskOps } from '../../src/services/taskops';
import { SessionService } from '../../src/services/session';
import { WriteLock } from '../../src/infra/db/client';
import { systemClock } from '../../src/clock';
import { createSilentLogger } from '../../src/logger';
import { makeTestDb } from '../helpers/testdb';
import { GlmUnavailableError } from '../../src/domain/errors';

type Step = LlmResponse | ((messages: LlmMessage[]) => LlmResponse);

function makeScriptedLlm(script: Step[]) {
  const calls: LlmMessage[][] = [];
  const llm = {
    calls,
    tokensSpentToday: () => 0,
    shortText: async () => null,
    async chat(messages: LlmMessage[]): Promise<LlmResponse> {
      calls.push(JSON.parse(JSON.stringify(messages)));
      const step = script.shift();
      if (!step) throw new Error('script exhausted');
      return typeof step === 'function' ? step(messages) : step;
    },
  };
  return llm as unknown as LlmClient & { calls: LlmMessage[][] };
}

function makeLoop(script: Step[]) {
  const { repo } = makeTestDb();
  const settings = new Settings(repo);
  const ops = new TaskOps(repo, settings, systemClock);
  const sessions = new SessionService(repo, ops, settings, systemClock, async () => undefined);
  const llm = makeScriptedLlm(script);
  const loop = new AgentLoop({ llm, repo, ops, settings, sessions, clock: systemClock, lock: new WriteLock(), log: createSilentLogger() });
  return { loop, repo, llm: llm as unknown as { calls: LlmMessage[][] } };
}

function toolMsg(name: string, args: unknown): LlmResponse {
  return {
    content: null,
    toolCalls: [{ id: `c_${name}_${Math.random().toString(36).slice(2, 6)}`, name, arguments: JSON.stringify(args) }],
    tokens: 10,
  };
}

describe('agent loop', () => {
  it('happy path: чтение → предложение действия с кнопкой, события записаны', async () => {
    const { loop, repo } = makeLoop([
      () => toolMsg('list_next_actions', {}),
      () => toolMsg('reply', { text: 'Действие: помыть ванну.\n~20 мин.', propose_task_id: 1 }),
    ]);
    const task = repo.createTask({ title: 'Помыть ванну', estimated_minutes: 20, energy_required: 2 }, new Date().toISOString());
    expect(task.id).toBe(1);

    const res = await loop.handleUserTurn('что делать?');
    expect(res.fallback).toBe(false);
    expect(res.text).toContain('помыть ванну');
    expect(res.proposeTaskId).toBe(task.id);

    const events = repo.listEvents({ limit: 50 }).map((e) => e.type);
    expect(events).toContain('USER_MESSAGE');
    expect(events).toContain('AGENT_MESSAGE');
  });

  it('create_task применяется транзакционно', async () => {
    const { loop, repo } = makeLoop([
      () => ({
        content: null,
        toolCalls: [
          { id: 'c1', name: 'create_task', arguments: JSON.stringify({ title: 'Поменять масло', estimated_minutes: 30, energy_required: 2 }) },
          { id: 'c2', name: 'reply', arguments: JSON.stringify({ text: 'Добавил: поменять масло.' }) },
        ],
        tokens: 10,
      }),
    ]);

    const res = await loop.handleUserTurn('добавь поменять масло в машине');
    expect(res.text).toContain('масло');
    const created = repo.listTasks({}).find((t) => t.title === 'Поменять масло');
    expect(created).toBeTruthy();
    expect(repo.listEvents({ type: 'TASK_CREATED', limit: 10 }).length).toBe(1);
  });

  it('невалидный tool-call → модель получает ошибку и исправляется', async () => {
    const { loop, repo } = makeLoop([
      () => toolMsg('update_task', { id: 999999, status: 'done' }),
      (messages) => {
        const toolResults = messages.filter((m) => m.role === 'tool');
        const last = toolResults[toolResults.length - 1] as { content: string };
        expect(last.content).toContain('999999');
        return toolMsg('reply', { text: 'Такой задачи нет — уточни.' });
      },
    ]);

    const res = await loop.handleUserTurn('закрой задачу 999999');
    expect(res.text).toContain('нет');
    // задача не менялась — не было валидных write-операций
    expect(repo.listEvents({ type: 'TASK_UPDATED', limit: 10 })).toHaveLength(0);
  });

  it('GLM недоступен → детерминированный fallback с топ-действием', async () => {
    const { repo } = makeTestDb();
    const settings = new Settings(repo);
    const ops = new TaskOps(repo, settings, systemClock);
    const sessions = new SessionService(repo, ops, settings, systemClock, async () => undefined);
    repo.createTask({ title: 'Почистить пылесос', estimated_minutes: 10, energy_required: 1 }, new Date().toISOString());

    const llm = {
      calls: [] as LlmMessage[][], tokensSpentToday: () => 0,
      shortText: async () => null,
      async chat(): Promise<LlmResponse> { throw new GlmUnavailableError('boom'); },
    } as unknown as LlmClient;
    const loop = new AgentLoop({ llm, repo, ops, settings, sessions, clock: systemClock, lock: new WriteLock(), log: createSilentLogger() });

    const res = await loop.handleUserTurn('что делать?');
    expect(res.fallback).toBe(true);
    expect(res.text).toContain('offline');
    expect(res.text).toContain('Почистить пылесос');
    expect(repo.listEvents({ type: 'GLM_UNAVAILABLE', limit: 5 }).length).toBe(1);
  });
});
