import OpenAI from 'openai';
import { GlmLimitError, GlmUnavailableError } from '../../domain/errors';
import type { Logger } from 'pino';

export interface LlmToolCall { id: string; name: string; arguments: string }

export interface LlmResponse {
  content: string | null;
  toolCalls: LlmToolCall[];
  tokens: number;
}

export type LlmMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface ToolSpec { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }

export interface LlmConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  dailyTokenLimit: number;
}

const RETRY_DELAYS_MS = [2000, 4000, 8000];

export class LlmClient {
  private client: OpenAI;
  private tokenDay = '';
  private tokensToday = 0;

  constructor(private cfg: LlmConfig, private log: Logger) {
    this.client = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl, timeout: 60_000, maxRetries: 0 });
  }

  private accountTokens(n: number): void {
    const today = new Date().toISOString().slice(0, 10);
    if (this.tokenDay !== today) { this.tokenDay = today; this.tokensToday = 0; }
    this.tokensToday += n;
    if (this.cfg.dailyTokenLimit > 0 && this.tokensToday > this.cfg.dailyTokenLimit) {
      throw new GlmLimitError();
    }
  }

  tokensSpentToday(): number { return this.tokensToday; }

  /** Основной вызов с ретраями. Бросает GlmUnavailableError после исчерпания попыток. */
  async chat(messages: LlmMessage[], tools?: ToolSpec[]): Promise<LlmResponse> {
    // предохранитель ДО вызова: не платим за запрос, который всё равно не зачтётся
    if (this.cfg.dailyTokenLimit > 0 && this.tokensToday >= this.cfg.dailyTokenLimit) {
      throw new GlmLimitError();
    }
    let lastErr: unknown;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      if (attempt > 0) {
        const delay = RETRY_DELAYS_MS[attempt - 1];
        await new Promise((r) => setTimeout(r, delay));
      }
      try {
        const params: Record<string, unknown> = { model: this.cfg.model, messages, temperature: 0.4 };
        if (tools && tools.length) { params.tools = tools; params.tool_choice = 'auto'; }
        const res = await this.client.chat.completions.create(params as any);
        const msg = res.choices?.[0]?.message as any;
        const tokens = res.usage?.total_tokens ?? 0;
        this.accountTokens(tokens);
        this.log.debug({ model: this.cfg.model, tokens, attempt }, 'glm call ok');
        return {
          content: msg?.content ?? null,
          toolCalls: (msg?.tool_calls ?? []).map((c: any) => ({
            id: c.id, name: c.function.name, arguments: c.function.arguments,
          })),
          tokens,
        };
      } catch (e) {
        lastErr = e;
        if (e instanceof GlmLimitError) throw e;
        const status = (e as any)?.status ?? (e as any)?.cause?.status;
        if (status && status >= 400 && status < 500 && status !== 429 && status !== 408) {
          // 4xx без повторов (кроме 429/408) — ошибка на нашей стороне, ретраи бессмысленны
          break;
        }
        this.log.warn({ err: (e as Error).message, attempt }, 'glm call failed');
      }
    }
    throw new GlmUnavailableError(`GLM недоступен: ${(lastErr as Error)?.message ?? 'unknown'}`);
  }

  /** Короткий текст (проактивные сообщения). Любая ошибка → null (шаблонный fallback). */
  async shortText(system: string, user: string, timeoutMs = 15_000): Promise<string | null> {
    try {
      const res = await Promise.race([
        this.chat([{ role: 'system', content: system }, { role: 'user', content: user }]),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs)),
      ]);
      const text = res.content?.trim();
      return text && text.length ? text : null;
    } catch {
      return null;
    }
  }
}
