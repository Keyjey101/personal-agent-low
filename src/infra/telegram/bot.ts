import { Bot, Context, InlineKeyboard } from 'grammy';
import { Repo } from '../../infra/db/repos';
import { TaskOps } from '../../services/taskops';
import { Settings } from '../../services/settings';
import { SessionService } from '../../services/session';
import { AgentLoop } from '../../services/agent/loop';
import { Ranked } from '../../domain/types';
import { localParts, todayStartIso } from '../../domain/time';
import { registerMute } from '../../domain/proactivity';
import type { Logger } from 'pino';

export interface TgBotDeps {
  token: string;
  allowedChatId: number;
  repo: Repo;
  ops: TaskOps;
  settings: Settings;
  getLoop: () => AgentLoop;
  getSessions: () => SessionService;
  log: Logger;
}

export function htmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const HELP = `Я — <b>Диспетчер</b>. Твой внешний исполнительный контур.
Просто пиши как есть:
• «что делать?»
• «у меня полчаса, энергии 3»
• «я покурил, дай что-нибудь простое»
• «сделал» / «готово»
• «добавь поменять масло в машине»
• «отложи это на выходные»
• «напомни вечером про коммуналку»

Команды:
/next — следующее действие
/status — сводка
/done — завершить текущее
/add &lt;текст&gt; — добавить задачу
/why — почему предложено это
/lead 30 — «веди меня 30 минут»
/stop — закончить сессию`;

export class TgBot {
  readonly bot: Bot;

  constructor(private deps: TgBotDeps) {
    this.bot = new Bot(deps.token);
    this.setup();
  }

  /* ---------- запуск ---------- */

  async start(): Promise<void> {
    await this.bot.init();
    // long polling в фоне; не блокируем запуск сервера
    void this.bot.start({
      onStart: () => this.deps.log.info('telegram polling started'),
      drop_pending_updates: true,
    }).catch((e) => this.deps.log.error({ err: e.message }, 'telegram polling crashed'));
  }

  async stop(): Promise<void> {
    await this.bot.stop();
  }

  /* ---------- отправка ---------- */

  async sendToUser(text: string, proposeTaskId?: number | null): Promise<void> {
    const chunks = splitHtml(text, 4000);
    for (let i = 0; i < chunks.length; i++) {
      const kb = i === chunks.length - 1 && proposeTaskId
        ? actionKeyboard(proposeTaskId)
        : undefined;
      await this.bot.api.sendMessage(
        this.deps.allowedChatId,
        chunks[i],
        { parse_mode: 'HTML', ...(kb ? { reply_markup: kb } : {}) },
      );
    }
  }

  /* ---------- обработчики ---------- */

  private setup(): void {
    const { bot, deps } = this;
    const { repo, ops, settings, log } = deps;

    bot.use(async (_ctx, next) => {
      if (_ctx.chat?.id === deps.allowedChatId) return next();
      log.warn({ chatId: _ctx.chat?.id }, 'ignoring message from stranger');
    });

    bot.catch((err) => log.error({ err: (err.error as Error | undefined)?.stack ?? String(err.error) }, 'bot error'));

    bot.command('start', (ctx) => ctx.reply(HELP, { parse_mode: 'HTML' }));
    bot.command('help', (ctx) => ctx.reply(HELP, { parse_mode: 'HTML' }));

    bot.command('status', (ctx) => {
      const t = new Date();
      const tz = settings.tz();
      const p = localParts(t, tz);
      const completedToday = repo.countTypeSince('TASK_COMPLETED', todayStartIso(t, tz));
      const counts = repo.openCounts();
      const projects = repo.listProjects('active')
        .map((pr) => `• ${htmlEscape(pr.name)} — ${counts.get(pr.id) ?? 0} откр.`)
        .join('\n') || '—';
      const state = ops.currentState();
      const stateStr = state
        ? `энергия ${state.energy ?? '?'}/10${state.available_minutes != null ? `, свободно ${state.available_minutes} мин` : ''}${state.intoxication && state.intoxication !== 'none' ? `, опьянение: ${state.intoxication}` : ''}`
        : 'не сообщал';
      const session = repo.activeSession();
      ctx.reply(
        `<b>${p.dateStr} ${String(p.hh).padStart(2, '0')}:${String(p.mm).padStart(2, '0')}</b>\n` +
        `Сегодня сделано: ${completedToday}\nСостояние: ${htmlEscape(stateStr)}\n` +
        (session ? `Сессия «веди меня» до ${session.ends_at.slice(11, 16)} UTC\n` : '') +
        `\n<b>Проекты:</b>\n${projects}`,
        { parse_mode: 'HTML' },
      );
    });

    bot.command('next', (ctx) => {
      const top = ops.topAction();
      if (!top) {
        ctx.reply('Подходящих задач под текущее состояние нет. Можешь сообщить состояние: «энергия 7, есть час».');
        return;
      }
      ctx.reply(formatProposal(top), { parse_mode: 'HTML', reply_markup: actionKeyboard(top.task.id) });
    });

    bot.command('done', (ctx) => {
      const arg = ctx.match?.trim();
      const session = repo.activeSession();
      const id = arg ? parseInt(arg, 10) : session?.current_task_id ?? currentActiveTaskId(repo);
      if (!id || Number.isNaN(id)) {
        ctx.reply('Не понял, что именно завершено. Укажи ID: /done 12 — или ответь кнопкой ✅.');
        return;
      }
      try {
        const r = ops.completeTask(id);
        const extra = r.newInstance ? `\n(создан следующий экземпляр: ${r.newInstance.title}, до ${r.newInstance.due_at})` : '';
        const next = ops.topAction();
        const nextStr = next ? `\n\nДальше:\n${formatProposal(next)}` : '\n\nЭто было последнее подходящее действие. Красава.';
        void ctx.reply(`✅ ${htmlEscape(r.task.title)} — закрыто.${extra}${nextStr}`, {
          parse_mode: 'HTML',
          ...(next ? { reply_markup: actionKeyboard(next.task.id) } : {}),
        });
      } catch (e) {
        ctx.reply(`Не вышло: ${(e as Error).message}`);
      }
    });

    bot.command('add', (ctx) => {
      const text = ctx.match?.trim();
      if (!text) { ctx.reply('Что добавить? /add поменять масло в машине'); return; }
      void this.handleTurn(ctx, text);
    });

    bot.command('why', (ctx) => {
      const top = ops.topAction();
      if (!top) { ctx.reply('Кандидатов нет.'); return; }
      const why = top.reasons.length ? top.reasons.join(', ') : 'самый приоритетный из доступных';
      ctx.reply(
        `${formatProposal(top)}\n\nПочему: ${htmlEscape(why)} (скор ${Math.round(top.score)}).`,
        { parse_mode: 'HTML', reply_markup: actionKeyboard(top.task.id) },
      );
    });

    bot.command('lead', async (ctx) => {
      const minutes = parseInt(ctx.match?.trim() || '30', 10);
      if (!(minutes >= 5 && minutes <= 180)) { ctx.reply('Дай от 5 до 180 минут: /lead 30'); return; }
      deps.getSessions().start(minutes);
      await deps.getSessions().proposeNext();
    });

    bot.command('stop', async (ctx) => {
      const s = repo.activeSession();
      if (!s) { ctx.reply('Активной сессии нет.'); return; }
      await deps.getSessions().end('по команде /stop');
    });

    bot.on('callback_query:data', (ctx) => {
      void this.handleCallback(ctx);
    });

    bot.on('message:text', (ctx) => {
      const text = ctx.message.text.trim();
      const s = repo.activeSession();

      if (s && /^(готово|сделал|сделал\.|done|закончил|всё|все)\b/i.test(text)) {
        void deps.getSessions().doneCurrent().then((ok) => { if (!ok) void this.handleTurn(ctx, text); });
        return;
      }
      if (s && /^(другое|дальше|skip|следующее)\b/i.test(text)) {
        void deps.getSessions().skipCurrent();
        return;
      }
      if (s && /^(стоп|хватит|останови)\b/i.test(text)) {
        void deps.getSessions().end('по слову «стоп»');
        return;
      }
      if (/^\/\w+/.test(text)) { ctx.reply('Не знаю такую команду. /help'); return; }
      void this.handleTurn(ctx, text);
    });
  }

  private async handleTurn(ctx: Context, text: string): Promise<void> {
    try {
      const res = await this.deps.getLoop().handleUserTurn(text);
      await this.sendToUser(res.text, res.proposeTaskId);
    } catch (e) {
      this.deps.log.error({ err: (e as Error).stack }, 'turn failed');
      await this.sendToUser('⚠️ Что-то сломалось. Попробуй ещё раз.');
    }
  }

  private async handleCallback(ctx: Context & { callbackQuery?: { data: string; message?: { message_id: number } } }): Promise<void> {
    const data = ctx.callbackQuery?.data ?? '';
    const m = data.match(/^a:(done|later|other|no):(\d+)$/);
    if (!m) return;
    const action = m[1];
    const taskId = parseInt(m[2], 10);
    const { repo, ops, settings } = this.deps;
    const task = repo.getTask(taskId);
    try {
      if (action === 'done') {
        const session = repo.activeSession();
        try {
          ops.completeTask(taskId);
        } catch { /* уже закрыта — не страшно */ }
        if (session && session.current_task_id === taskId) {
          await this.deps.getSessions().doneExternal(taskId);
          return;
        }
        const next = ops.topAction();
        await ctx.answerCallbackQuery({ text: 'Закрыто ✅' });
        await this.sendToUser(
          next ? `Следующее:\n${formatProposal(next)}` : 'Отлично. Больше подходящих задач нет.',
          next?.task.id ?? null,
        );
      } else if (action === 'later') {
        ops.snoozeSuggestion(taskId, 1);
        await ctx.answerCallbackQuery({ text: 'Отложил на день' });
        const alt = ops.topAction([taskId]);
        if (alt && alt.task.id !== taskId) {
          await this.sendToUser(`Тогда другое:\n${formatProposal(alt)}`, alt.task.id);
        } else {
          await this.sendToUser('Ок, вернусь к этому завтра.');
        }
      } else if (action === 'other') {
        await ctx.answerCallbackQuery({});
        const alt = ops.topAction([taskId]);
        if (alt && alt.task.id !== taskId) {
          await this.sendToUser(`Другое:\n${formatProposal(alt)}`, alt.task.id);
        } else {
          await this.sendToUser('Других подходящих вариантов нет под текущее состояние.');
        }
      } else if (action === 'no') {
        ops.rejectSuggestion(taskId);
        // мут тем этой задачи, чтобы не доставать
        const cfg = settings.proactiveCfg();
        const state = settings.proactiveState();
        for (const topic of ['evening', ...(task?.project_id ? [`stale:${task.project_id}`] : [])]) {
          settings.setProactiveTopic(topic, registerMute(state[topic], new Date(), cfg));
        }
        await ctx.answerCallbackQuery({ text: 'Понял, не беспокою' });
        await this.sendToUser('Ок. Эту линию заморозил на неделю.');
      }
    } catch (e) {
      this.deps.log.error({ err: (e as Error).stack }, 'callback failed');
      await ctx.answerCallbackQuery({ text: 'Ошибка' }).catch(() => undefined);
    }
  }
}

/* ---------- форматирование ---------- */

export function formatProposal(r: Ranked): string {
  const est = r.task.estimated_minutes ?? 30;
  const lines = [`Действие: <b>${htmlEscape(r.task.title)}</b>.`, `~${est} мин.`];
  if (r.reasons.length) lines.push(htmlEscape(r.reasons.join(', ')));
  return lines.join('\n');
}

function actionKeyboard(taskId: number) {
  return new InlineKeyboard()
    .text('✅ Сделал', `a:done:${taskId}`)
    .text('⏸ Потом', `a:later:${taskId}`)
    .row()
    .text('🔀 Другое', `a:other:${taskId}`)
    .text('❌ Не буду', `a:no:${taskId}`);
}

function currentActiveTaskId(repo: Repo): number | null {
  const active = repo.listTasks({ status: ['active'], limit: 1 });
  return active[0]?.id ?? null;
}

function splitHtml(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max * 0.5) cut = max;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.trim()) out.push(rest);
  return out;
}
