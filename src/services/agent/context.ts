import { Repo } from '../../infra/db/repos';
import { TaskOps } from '../taskops';
import { Settings } from '../settings';
import { localParts } from '../../domain/time';

const WD_RU: Record<string, string> = {
  mon: 'понедельник', tue: 'вторник', wed: 'среда', thu: 'четверг',
  fri: 'пятница', sat: 'суббота', sun: 'воскресенье',
};

const MAX_CHARS = 6000;

function daypart(hh: number): string {
  if (hh < 5) return 'ночь';
  if (hh < 12) return 'утро';
  if (hh < 18) return 'день';
  return 'вечер';
}

function humanDelta(ms: number): string {
  const min = Math.round(ms / 60_000);
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
}

/**
 * Сборка контекстного блока для промпта (ТЗ 7.2). Время — самым верхом и
 * кричаще: модель обязана каждый ход заново ориентироваться «где мы сейчас»,
 * а не тащить выводы («спит», «на работе») из старых сообщений.
 */
export function buildContext(
  userText: string,
  deps: { repo: Repo; ops: TaskOps; settings: Settings },
  prevUserMessageAt: string | null = null,
): string {
  const { repo, ops, settings } = deps;
  const now = new Date();
  const tz = settings.tz();
  const p = localParts(now, tz);
  const lines: string[] = [];

  lines.push('=== СЕЙЧАС ===');
  lines.push(`Время: ${WD_RU[p.weekday]}, ${p.dateStr} ${String(p.hh).padStart(2, '0')}:${String(p.mm).padStart(2, '0')} (${tz}), ${daypart(p.hh)}.`);
  const work = settings.proactiveCfg().work;
  if (work.days.includes(p.weekday) && p.hm >= hm(work.start) && p.hm < hm(work.end)) {
    lines.push(`Это рабочие часы пользователя (до ${work.end}) — не предлагай домашние дела, кроме критичного.`);
  } else if (!work.days.includes(p.weekday)) {
    lines.push('Это выходной день.');
  }
  if (prevUserMessageAt) {
    const delta = now.getTime() - new Date(prevUserMessageAt).getTime();
    if (delta > 60 * 60_000) {
      lines.push(`С прошлого сообщения пользователя прошло ${humanDelta(delta)} — прежние выводы о его состоянии устарели, оцени время заново.`);
    }
  }

  lines.push('=== СОСТОЯНИЕ ===');
  const state = ops.currentState();
  if (state) {
    const parts: string[] = [];
    if (state.energy != null) parts.push(`энергия ${state.energy}/10`);
    if (state.available_minutes != null) parts.push(`свободно ${state.available_minutes} мин`);
    if (state.intoxication && state.intoxication !== 'none') parts.push(`опьянение: ${state.intoxication}`);
    if (state.focus && state.focus !== 'normal') parts.push(`фокус: ${state.focus}`);
    if (state.note) parts.push(`«${state.note}»`);
    lines.push(`Самоотчёт (${state.recorded_at.slice(11, 16)} UTC): ${parts.join(', ')}`);
  } else {
    lines.push('Самоотчёта нет давно — состояние неизвестно, выведи его из времени суток и не предлагай тяжёлое.');
  }

  const session = repo.activeSession();
  if (session) {
    lines.push(`Активная сессия «веди меня»: до ${session.ends_at.slice(11, 16)} UTC, выполнено ${session.completed_count}, текущая задача #${session.current_task_id ?? '—'}.`);
  }

  lines.push('=== ПАМЯТЬ (выводы о пользователе) ===');
  const coreMem = repo.listMemory(true)
    .filter((m) => ['insight', 'pattern', 'preference', 'routine', 'fact'].includes(m.kind))
    .slice(0, 8);
  for (const m of coreMem) lines.push(`- (${m.kind}) ${m.content}`);
  if (userText.trim()) {
    const fts = repo.searchMemory(userText, 5).filter((m) => !coreMem.some((c) => c.id === m.id));
    for (const m of fts) lines.push(`- (${m.kind}) ${m.content}`);
  }
  if (coreMem.length === 0) lines.push('- пока пусто');

  lines.push('=== КАНДИДАТЫ ===');
  const ranked = ops.getRanked().slice(0, 8);
  if (ranked.length) {
    for (const r of ranked) {
      const bits = [`#${r.task.id}`];
      if (r.task.estimated_minutes != null) bits.push(`~${r.task.estimated_minutes} мин`);
      if (r.task.energy_required != null) bits.push(`e${r.task.energy_required}`);
      if (r.task.due_at) bits.push(`дедлайн ${r.task.due_at}`);
      if (r.reasons.length) bits.push(r.reasons.join(', '));
      lines.push(`- ${r.task.title} (${bits.join('; ')})${r.task.project_name ? ` [${r.task.project_name}]` : ''}`);
    }
  } else {
    lines.push('Кандидатов нет: всё закрыто или всё заблокировано состоянием.');
  }

  const counts = repo.openCounts();
  const projects = repo.listProjects('active').map((pr) => `#${pr.id} ${pr.name} (p${pr.priority}, открытых ${counts.get(pr.id) ?? 0})`);
  if (projects.length) lines.push(`Проекты: ${projects.join('; ')}`);

  const inbox = repo.listTasks({ status: ['todo', 'next', 'idea'], limit: 500 }).filter((t) => t.project_id === null);
  if (inbox.length) lines.push(`Во «Входящих» без проекта: ${inbox.length} задач(и) — можно предложить разложить.`);

  let block = lines.join('\n');
  if (block.length > MAX_CHARS) block = block.slice(0, MAX_CHARS) + '\n…(обрезано)';
  return block;
}

function hm(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
