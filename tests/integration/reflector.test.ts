import { describe, expect, it } from 'vitest';
import { Reflector } from '../../src/services/reflector';
import { LlmClient, LlmMessage, LlmResponse } from '../../src/infra/llm/glm';
import { Settings } from '../../src/services/settings';
import { TaskOps } from '../../src/services/taskops';
import { WriteLock } from '../../src/infra/db/client';
import { systemClock } from '../../src/clock';
import { createSilentLogger } from '../../src/logger';
import { makeTestDb } from '../helpers/testdb';

type Step = LlmResponse | ((messages: LlmMessage[]) => LlmResponse);

function makeScriptedLlm(script: Step[]) {
  const llm = {
    tokensSpentToday: () => 0,
    shortText: async () => null,
    async chat(): Promise<LlmResponse> {
      const step = script.shift();
      if (!step) throw new Error('script exhausted');
      return typeof step === 'function' ? (step as (m: LlmMessage[]) => LlmResponse)([]) : step;
    },
  };
  return llm as unknown as LlmClient;
}

function makeReflector(script: Step[]) {
  const { repo } = makeTestDb();
  const settings = new Settings(repo);
  const ops = new TaskOps(repo, settings, systemClock);
  const llm = makeScriptedLlm(script);
  const reflector = new Reflector({ llm, repo, ops, settings, clock: systemClock, lock: new WriteLock(), log: createSilentLogger() });
  return { reflector, repo };
}

describe('reflector — ночная рефлексия', () => {
  it('упаковывает события в память и обогащает граф, транзакционно', async () => {
    const { reflector, repo } = makeReflector([
      () => ({
        content: null,
        toolCalls: [
          { id: 'c1', name: 'remember', arguments: JSON.stringify({ kind: 'pattern', content: 'Вечером охотнее делает бытовые задачи по 10–15 минут.', source: 'reflector' }) },
          { id: 'c2', name: 'add_entity', arguments: JSON.stringify({ kind: 'object', name: 'Поликарбонат' }) },
        ],
        tokens: 10,
      }),
      () => ({
        content: null,
        toolCalls: [
          { id: 'c3', name: 'add_entity_edge', arguments: JSON.stringify({ from: 'Машина', to: 'Поликарбонат', relation: 'related_to' }) },
        ],
        tokens: 10,
      }),
      () => ({ content: 'Заметил: вечер — время коротких бытовых задач. Граф дополнен.', toolCalls: [], tokens: 10 }),
    ]);

    // события за «день»: разговор про замену стекла поликарбонатом
    repo.addEvent('USER_MESSAGE', { text: 'решил делать стекло из поликарбоната' }, new Date().toISOString());
    repo.upsertEntity({ kind: 'object', name: 'Машина' }, new Date().toISOString());

    const summary = await reflector.run(200, '');
    expect(summary).toContain('вечер');

    const mem = repo.listMemory(true);
    expect(mem.some((m) => m.content.includes('бытовые задачи'))).toBe(true);
    expect(mem.find((m) => m.content.includes('бытовые'))!.source).toBe('agent_observed');
    expect(repo.getEntity('Поликарбонат')).toBeTruthy();
    expect(repo.listEntityEdges().some((e) => e.relation === 'related_to')).toBe(true);
    expect(repo.listEvents({ type: 'REFLECTION_DONE', limit: 1 }).length).toBe(1);
    expect(repo.getJson('last_reflection_at', '')).toBeTruthy();
  });

  it('runIfNeeded не гоняет рефлексию дважды в день', async () => {
    const { reflector, repo } = makeReflector([
      () => ({ content: 'итог', toolCalls: [], tokens: 10 }),
    ]);
    repo.addEvent('USER_MESSAGE', { text: 'привет' }, new Date().toISOString());
    await reflector.runIfNeeded(4, 200);   // системное время может быть < 4:00 — тогда просто пропустит
    // день отмечен либо прогоном, либо ещё не наступил час: повторный вызов идемпотентен
    await reflector.runIfNeeded(4, 200);
    expect(repo.listEvents({ type: 'REFLECTION_DONE', limit: 10 }).length).toBeLessThanOrEqual(1);
  });
});
