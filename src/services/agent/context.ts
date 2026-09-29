import { Repo } from '../../infra/db/repos';
import { TaskOps } from '../taskops';
import { Settings } from '../settings';
import { localParts } from '../../domain/time';

const WD_RU: Record<string, string> = {
  mon: 'понедельник', tue: 'вторник', wed: 'среда', thu: 'четверг',
  fri: 'пятница', sat: 'суббота', sun: 'воскресенье',
};

const MAX_CHARS = 6000;

/**
 * Сборка контекстного блока для промпта (ТЗ 7.2): состояние, кандидаты,
 * проекты, память — строго в пределах бюджета.
 */
export function buildContext(userText: string, deps: { repo: Repo; ops: TaskOps; settings: Settings }): string {
  const { repo, ops, settings } = deps;
  const now = new Date();
  const p = localParts(now, settings.tz());
  const lines: string[] = [];

  lines.push(`=== КОНТЕКСТ ===`);
  lines.push(`Время: ${WD_RU[p.weekday]}, ${p.dateStr} ${String(p.hh).padStart(2, '0')}:${String(p.mm).padStart(2, '0')} (${settings.tz()})`);

  const state = ops.currentState();
  if (state) {
    const parts: string[] = [];
    if (state.energy != null) parts.push(`энергия ${state.energy}/10`);
    if (state.available_minutes != null) parts.push(`свободно ${state.available_minutes} мин`);
    if (state.intoxication && state.intoxication !== 'none') parts.push(`опьянение: ${state.intoxication}`);
    if (state.focus && state.focus !== 'normal') parts.push(`фокус: ${state.focus}`);
    if (state.note) parts.push(`«${state.note}»`);
    lines.push(`Состояние пользователя (${state.recorded_at.slice(11, 16)} UTC): ${parts.join(', ')}`);
  } else {
    lines.push(`Состояние пользователя: не сообщал недавно — считай средним (энергия ~5, время не ограничено).`);
  }

  const session = repo.activeSession();
  if (session) {
    lines.push(`Активная сессия «веди меня»: до ${session.ends_at.slice(11, 16)} UTC, выполнено ${session.completed_count}, текущая задача #${session.current_task_id ?? '—'}.`);
  }

  const ranked = ops.getRanked().slice(0, 8);
  if (ranked.length) {
    lines.push(`Кандидаты (топ-${ranked.length}):`);
    for (const r of ranked) {
      const bits = [`#${r.task.id}`];
      if (r.task.estimated_minutes != null) bits.push(`~${r.task.estimated_minutes} мин`);
      if (r.task.energy_required != null) bits.push(`e${r.task.energy_required}`);
      if (r.task.due_at) bits.push(`дедлайн ${r.task.due_at}`);
      if (r.reasons.length) bits.push(r.reasons.join(', '));
      lines.push(`- ${r.task.title} (${bits.join('; ')})${r.task.project_name ? ` [${r.task.project_name}]` : ''}`);
    }
  } else {
    lines.push(`Кандидатов нет: всё закрыто или всё заблокировано состоянием.`);
  }

  const counts = repo.openCounts();
  const projects = repo.listProjects('active').map((pr) => `#${pr.id} ${pr.name} (p${pr.priority}, открытых ${counts.get(pr.id) ?? 0})`);
  if (projects.length) lines.push(`Активные проекты: ${projects.join('; ')}`);

  const inbox = repo.listTasks({ status: ['todo', 'next', 'idea'], limit: 500 }).filter((t) => t.project_id === null);
  if (inbox.length) lines.push(`Во «Входящих» без проекта: ${inbox.length} задач(и) — можно предложить разложить.`);

  if (userText.trim()) {
    const mem = repo.searchMemory(userText, 5);
    if (mem.length) lines.push(`Память по теме:\n${mem.map((m) => `- (${m.kind}) ${m.content}`).join('\n')}`);
  }

  let block = lines.join('\n');
  if (block.length > MAX_CHARS) block = block.slice(0, MAX_CHARS) + '\n…(обрезано)';
  return block;
}
