import { LlmClient, LlmMessage, ToolSpec } from '../../infra/llm/glm';
import { Repo } from '../../infra/db/repos';
import { TaskOps } from '../taskops';
import { Settings } from '../settings';
import { SessionService } from '../session';
import { WriteLock } from '../../infra/db/client';
import { Clock } from '../../clock';
import { buildTools, ToolCtx, ToolDef } from './tools';
import { buildContext } from './context';
import { FORCE_REPLY_NUDGE, REPAIR_NUDGE, SYSTEM_PROMPT } from './prompts';
import { GlmLimitError, GlmUnavailableError } from '../../domain/errors';
import { shortLocal } from '../../domain/time';
import { htmlEscape } from '../../infra/telegram/escape';
import type { Logger } from 'pino';

const MAX_ROUNDS = 3;

export interface TurnResult { text: string; proposeTaskId: number | null; fallback: boolean }

/**
 * Цикл агента (ТЗ 7.1): контекст → GLM → валидация tools → единая
 * транзакция → ответ. Все write-операции хода атомарны.
 */
export class AgentLoop {
  private tools: ToolDef[];
  private toolMap: Map<string, ToolDef>;
  private toolSpecs: ToolSpec[];

  constructor(private deps: {
    llm: LlmClient; repo: Repo; ops: TaskOps; settings: Settings; sessions: SessionService;
    clock: Clock; lock: WriteLock; log: Logger;
  }) {
    this.tools = buildTools();
    this.toolMap = new Map(this.tools.map((t) => [t.name, t]));
    this.toolSpecs = this.tools.map((t) => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: t.jsonSchema },
    }));
  }

  private ctx(): ToolCtx {
    return { repo: this.deps.repo, ops: this.deps.ops, settings: this.deps.settings, sessions: this.deps.sessions };
  }

  async handleUserTurn(userText: string): Promise<TurnResult> {
    // время прошлого сообщения считаем ДО записи нового — для «сколько прошло»
    const prevUserMessageAt = this.deps.repo.lastUserMessageAt();
    const nowIso = this.deps.clock.now().toISOString();
    this.deps.repo.addEvent('USER_MESSAGE', { text: userText }, nowIso);

    const tz = this.deps.settings.tz();
    const history = this.deps.repo.dialog(12);
    const messages: LlmMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT + '\n\n' + buildContext(userText, this.deps, prevUserMessageAt) },
      ...history.slice(0, -1).map((e) => ({
        role: e.type === 'USER_MESSAGE' ? 'user' as const : 'assistant' as const,
        // метка времени у каждого сообщения — модель видит, когда что было
        content: `[${shortLocal(e.ts, tz)}] ${e.text ?? ''}`,
      })),
      { role: 'user', content: userText },
    ];

    try {
      return await this.runRounds(messages);
    } catch (e) {
      if (e instanceof GlmUnavailableError || e instanceof GlmLimitError) {
        this.deps.repo.addEvent('GLM_UNAVAILABLE', { text: e.message }, this.deps.clock.now().toISOString());
        return this.deterministicFallback(e instanceof GlmLimitError ? 'дневной лимит токенов' : 'мозг offline');
      }
      this.deps.log.error({ err: (e as Error).stack }, 'agent turn failed');
      this.deps.repo.addEvent('SYSTEM_ERROR', { text: (e as Error).message }, this.deps.clock.now().toISOString());
      return this.deterministicFallback('ошибка');
    }
  }

  private async runRounds(messages: LlmMessage[]): Promise<TurnResult> {
    const ctx = this.ctx();
    const allOps: string[] = [];
    let replyPlan: { text: string; propose_task_id?: number } | null = null;
    let finalText: string | null = null;

    for (let round = 1; round <= MAX_ROUNDS; round++) {
      const res = await this.deps.llm.chat(messages, this.toolSpecs);
      const toolCalls = res.toolCalls;
      messages.push({
        role: 'assistant', content: res.content,
        ...(toolCalls.length ? { tool_calls: toolCalls.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: c.arguments } })) } : {}),
      });

      if (!toolCalls.length) {
        finalText = res.content?.trim() || null;
        break;
      }

      let hadError = false;
      const roundPlanned: { tool: ToolDef; args: unknown }[] = [];
      for (const call of toolCalls) {
        const tool = this.toolMap.get(call.name);
        if (!tool) {
          hadError = true;
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: `Неизвестный инструмент ${call.name}` }) });
          continue;
        }
        let args: unknown;
        try {
          args = JSON.parse(call.arguments || '{}');
        } catch {
          hadError = true;
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: 'Аргументы — не валидный JSON' }) });
          continue;
        }
        const parsed = tool.schema.safeParse(args);
        if (!parsed.success) {
          hadError = true;
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }) });
          continue;
        }

        if (tool.kind === 'read' && tool.execRead) {
          const out = safeExec(() => tool.execRead!(parsed.data, ctx));
          messages.push({ role: 'tool', tool_call_id: call.id, content: truncate(JSON.stringify(out)) });
        } else if (tool.kind === 'reply') {
          const err = tool.validate ? tool.validate(parsed.data, ctx) : null;
          if (err) {
            hadError = true;
            messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: err }) });
          } else {
            replyPlan = parsed.data as { text: string; propose_task_id?: number };
            messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: true }) });
          }
        } else {
          const err = tool.validate ? tool.validate(parsed.data, ctx) : null;
          if (err) {
            hadError = true;
            messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: err }) });
          } else {
            roundPlanned.push({ tool, args: parsed.data });
            messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: true, queued: 'применю после твоего финального ответа' }) });
          }
        }
      }

      // валидные write-операции раунда применяем сразу, транзакционно:
      // следующие раунды (и валидация цепочек create→link) видят результат
      if (roundPlanned.length) {
        const applied = await this.applyOps(roundPlanned, ctx);
        if (applied === null) {
          replyPlan = replyPlan
            ? { ...replyPlan, text: replyPlan.text + '\n\n⚠️ Не всё удалось сохранить — изменения раунда откачены.' }
            : { text: '⚠️ Не удалось сохранить изменения. Попробуй ещё раз.' };
        } else {
          allOps.push(...applied);
        }
      }

      if (replyPlan && !hadError) break;

      if (hadError && round === MAX_ROUNDS) {
        messages.push({ role: 'user', content: REPAIR_NUDGE });
      }
      if (round === MAX_ROUNDS && !replyPlan) {
        // последний шанс: принудительный ответ без инструментов
        const forced = await this.deps.llm.chat([...messages, { role: 'user', content: FORCE_REPLY_NUDGE }]);
        finalText = forced.content?.trim() || null;
        if (!replyPlan && finalText) replyPlan = { text: finalText };
        finalText = null;
      }
    }

    const outText = replyPlan?.text ?? finalText ?? '';
    if (!outText) return this.deterministicFallback('пустой ответ модели');

    this.deps.repo.addEvent('AGENT_MESSAGE', {
      text: outText,
      payload: { propose_task_id: replyPlan?.propose_task_id ?? null, planned_ops: allOps },
    }, this.deps.clock.now().toISOString());
    // текст модели — обычная проза, экранируем: форматирование добавляют только шаблоны
    return { text: htmlEscape(outText), proposeTaskId: replyPlan?.propose_task_id ?? null, fallback: false };
  }

  /** Применить пакет write-операций одной транзакцией; null = откат с ошибкой. */
  private async applyOps(ops: { tool: ToolDef; args: unknown }[], ctx: ToolCtx): Promise<string[] | null> {
    const names: string[] = [];
    const failed = await this.deps.lock.run(async () => {
      try {
        this.deps.repo.transaction(() => {
          for (const op of ops) {
            this.deps.repo.addEvent('TOOL_CALL', { payload: { tool: op.tool.name } }, this.deps.clock.now().toISOString());
            op.tool.apply!(op.args, ctx);
            names.push(op.tool.name);
          }
        });
        return false;
      } catch (e) {
        this.deps.log.error({ err: (e as Error).stack }, 'apply ops failed (rolled back)');
        this.deps.repo.addEvent('SYSTEM_ERROR', { text: `Транзакция раунда откачена: ${(e as Error).message}` }, this.deps.clock.now().toISOString());
        return true;
      }
    });
    return failed ? null : names;
  }

  /** GLM недоступен — детерминированный ответ по скорингу (ТЗ 7.6). */
  private deterministicFallback(reason: string): TurnResult {
    const top = this.deps.ops.topAction();
    const head = `⚠️ Мозг offline (${htmlEscape(reason)}), действую по алгоритму.`;
    const text = top
      ? `${head}\n\nДействие: <b>${htmlEscape(top.task.title)}</b>.\n~${top.task.estimated_minutes ?? 30} мин.`
      : `${head}\n\nПодходящих задач под текущее состояние не нашлось.`;
    this.deps.repo.addEvent('AGENT_MESSAGE', { text, payload: { fallback: true, reason } }, this.deps.clock.now().toISOString());
    return { text, proposeTaskId: top?.task.id ?? null, fallback: true };
  }
}

function safeExec(fn: () => unknown): unknown {
  try { return fn(); } catch (e) { return { error: (e as Error).message }; }
}

function truncate(s: string, max = 2500): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}
