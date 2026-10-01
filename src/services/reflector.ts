import { LlmClient, LlmMessage, ToolSpec } from '../infra/llm/glm';
import { Repo } from '../infra/db/repos';
import { TaskOps } from './taskops';
import { Settings } from './settings';
import { WriteLock } from '../infra/db/client';
import { Clock } from '../clock';
import { buildTools, ToolCtx, ToolDef } from './agent/tools';
import { REFLECTOR_PROMPT } from './agent/prompts';
import { GlmLimitError, GlmUnavailableError } from '../domain/errors';
import { localParts } from '../domain/time';
import type { Logger } from 'pino';

const MAX_ROUNDS = 4;

/** Инструменты, доступные ночной рефлексии (безопасное подмножество). */
const WHITELIST = new Set([
  'remember', 'forget_memory', 'add_entity', 'add_entity_edge', 'link_task_entity',
  'get_entity', 'search_tasks', 'get_task', 'search_memory', 'recent_events',
  'list_projects', 'update_task',
]);

interface PlannedOp { tool: ToolDef; args: unknown }

/**
 * Ночная рефлексия (настраивается env: REFLECTOR_ENABLED/HOUR/MAX_EVENTS).
 * Смотрит события с прошлого прогона, упаковывает их в память (L2),
 * обогащает граф знаний и чистит устаревшие записи. Сырой журнал остаётся
 * нетронутым — сжимается именно контекст: диалог в промпт идёт только за
 * последние сообщения, а «мысли» живут в памяти и графе.
 */
export class Reflector {
  private tools: ToolDef[];
  private toolMap: Map<string, ToolDef>;
  private toolSpecs: ToolSpec[];

  constructor(private deps: {
    llm: LlmClient; repo: Repo; ops: TaskOps; settings: Settings;
    clock: Clock; lock: WriteLock; log: Logger;
  }) {
    this.tools = buildTools().filter((t) => WHITELIST.has(t.name));
    this.toolMap = new Map(this.tools.map((t) => [t.name, t]));
    this.toolSpecs = this.tools.map((t) => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: t.jsonSchema },
    }));
  }

  /** Вызывается планировщиком раз в сутки после REFLECTOR_HOUR. */
  async runIfNeeded(hour: number, maxEvents: number): Promise<void> {
    const { repo, clock, settings } = this.deps;
    const now = clock.now();
    const p = localParts(now, settings.tz());
    if (p.hm < hour * 60) return;
    if (repo.getJson<string>('last_reflection_day', '') === p.dateStr) return;
    // cooldown после сбоя: не дёргаем API каждые 30 секунд тика планировщика
    if (Date.now() - this.lastAttemptAt < 30 * 60_000) return;
    this.lastAttemptAt = Date.now();

    const since = repo.getJson<string>('last_reflection_at', '');
    if (since) {
      const fresh = repo.listEvents({ since, limit: 1 });
      if (!fresh.length) { repo.setJson('last_reflection_day', p.dateStr); return; }
    }

    try {
      await this.run(maxEvents, since);
    } catch (e) {
      if (e instanceof GlmLimitError) {
        // лимит исчерпан — в этот день больше не пытаемся (иначе бомба расходов)
        this.deps.log.warn('reflector skipped: daily token limit');
        repo.setJson('last_reflection_day', p.dateStr);
        return;
      }
      if (e instanceof GlmUnavailableError) {
        this.deps.log.warn({ err: (e as Error).message }, 'reflector skipped: glm unavailable, cooldown 30 min');
        return; // повторим через cooldown
      }
      throw e;
    }
    repo.setJson('last_reflection_day', p.dateStr);
  }

  private lastAttemptAt = 0;

  async run(maxEvents: number, since: string): Promise<string> {
    const { repo, llm, clock } = this.deps;
    const nowIso = clock.now().toISOString();
    const sinceIso = since || new Date(0).toISOString();
    // берём СТАРЫЕ события вперёд: всё, что не влезло в cap, вернётся следующим прогоном
    const fetched = repo.listEvents({ since: sinceIso, limit: maxEvents }).reverse(); // новые→старые → разворот = старые вперёд
    if (!fetched.length) { repo.setJson('last_reflection_at', nowIso); return 'нет событий'; }

    // кап по символам: срезаем новые, чтобы промпт не разросся
    const MAX_PROMPT_CHARS = 60_000;
    const events: { ts: string; type: string; task_id: number | null; project_id: number | null; text: string }[] = [];
    let used = 0;
    for (const e of fetched) {
      const item = { ts: e.ts, type: e.type, task_id: e.task_id, project_id: e.project_id, text: (e.text ?? '').slice(0, 200) };
      const size = JSON.stringify(item).length;
      if (used + size > MAX_PROMPT_CHARS && events.length > 0) break;
      events.push(item);
      used += size;
    }
    // маркер — последнее включённое событие: необработанные вернутся завтра
    const lastIncludedTs = events[events.length - 1].ts;

    const memory = repo.listMemory(true).slice(0, 50).map((m) => ({ id: m.id, kind: m.kind, content: m.content }));
    const projects = repo.listProjects('active').map((p) => ({ id: p.id, name: p.name }));

    const messages: LlmMessage[] = [
      { role: 'system', content: REFLECTOR_PROMPT },
      {
        role: 'user',
        content: JSON.stringify({ период: { с: sinceIso, по: nowIso }, проекты: projects, память: memory, события: events }),
      },
    ];

    const ctx: ToolCtx = { repo, ops: this.deps.ops, settings: this.deps.settings, sessions: null as any };
    const planned: PlannedOp[] = [];
    let summary = '';

    for (let round = 1; round <= MAX_ROUNDS; round++) {
      const res = await llm.chat(messages, this.toolSpecs);
      messages.push({
        role: 'assistant', content: res.content,
        ...(res.toolCalls.length ? { tool_calls: res.toolCalls.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: c.arguments } })) } : {}),
      });
      if (!res.toolCalls.length) { summary = res.content?.trim() ?? ''; break; }

      let hadError = false;
      const roundPlanned: PlannedOp[] = [];
      for (const call of res.toolCalls) {
        const tool = this.toolMap.get(call.name);
        if (!tool) {
          hadError = true;
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: `Неизвестный инструмент ${call.name}` }) });
          continue;
        }
        let args: unknown;
        try { args = JSON.parse(call.arguments || '{}'); } catch {
          hadError = true;
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: 'не валидный JSON' }) });
          continue;
        }
        const parsed = tool.schema.safeParse(args);
        if (!parsed.success) {
          hadError = true;
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: parsed.error.issues[0].message }) });
          continue;
        }
        if (tool.kind === 'read' && tool.execRead) {
          let out: unknown;
          try { out = tool.execRead(parsed.data, ctx); } catch (e) { out = { error: (e as Error).message }; }
          const s = JSON.stringify(out);
          messages.push({ role: 'tool', tool_call_id: call.id, content: s.length > 2000 ? s.slice(0, 2000) + '…' : s });
        } else {
          const err = tool.validate ? tool.validate(parsed.data, ctx) : null;
          if (err) {
            hadError = true;
            messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: err }) });
          } else {
            roundPlanned.push({ tool, args: parsed.data });
            messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: true }) });
          }
        }
      }
      if (!hadError && !res.toolCalls.length) break;

      // применяем раунд сразу: следующие раунды видят изменения (цепочки add_entity → edge)
      if (roundPlanned.length) {
        await this.deps.lock.run(async () => {
          try {
            repo.transaction(() => {
              for (const op of roundPlanned) op.tool.apply!(op.args, ctx);
            });
            planned.push(...roundPlanned);
          } catch (e) {
            this.deps.log.error({ err: (e as Error).stack }, 'reflector apply failed (round rolled back)');
          }
        });
      }
    }

    repo.setJson('last_reflection_at', lastIncludedTs);
    const text = summary || 'рефлексия завершена без итогового текста';
    repo.addEvent('REFLECTION_DONE', { text, payload: { events: events.length, ops: planned.map((p) => p.tool.name) } }, nowIso);
    this.deps.log.info({ events: events.length, ops: planned.length }, 'reflection done');
    return text;
  }
}
