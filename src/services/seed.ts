import { Repo } from '../infra/db/repos';

/**
 * Начальные данные (ТЗ 19): все проекты/задачи/связи/память пользователя.
 * Идемпотентно:guarded флагом settings.seeded.
 */
export function ensureSeed(repo: Repo): boolean {
  if (repo.getJson<number>('seeded', 0) === 1) return false;
  const now = new Date().toISOString();

  /* ---------- проекты ---------- */
  const kitchen = repo.createProject({ name: 'Ремонт кухни', area: 'kitchen', priority: 4, description: 'Замер → гарнитур и плита → перестановка → пол → установка.' }, now);
  const sellTable = repo.createProject({ name: 'Продать старый массажный стол', area: 'massage', priority: 3 }, now);
  const buyTable = repo.createProject({ name: 'Купить новый массажный стол', area: 'massage', priority: 2 }, now);
  const car = repo.createProject({ name: 'Машина', area: 'car', priority: 3 }, now);
  const fitness = repo.createProject({ name: 'Физическая форма', area: 'fitness', priority: 3 }, now);

  /* ---------- задачи ---------- */
  const T = (input: Parameters<Repo['createTask']>[0]) => repo.createTask(input, now);

  // Кухня
  const kMeasure = T({ project_id: kitchen.id, title: 'Замерить кухню (3 стены, окно, трубы)', estimated_minutes: 15, energy_required: 1, status: 'next' });
  const kUnits = T({ project_id: kitchen.id, title: 'Определиться с гарнитуром (бюджет, стиль)', estimated_minutes: 40, energy_required: 2 });
  const kStove = T({ project_id: kitchen.id, title: 'Выбрать и заказать плиту', estimated_minutes: 40, energy_required: 2 });
  const kBuyUnits = T({ project_id: kitchen.id, title: 'Купить гарнитур', estimated_minutes: 120, energy_required: 2 });
  T({ project_id: kitchen.id, title: 'Освободить кухню (переместить вещи)', estimated_minutes: 40, energy_required: 3 });
  const kPlan = T({ project_id: kitchen.id, title: 'Перестановка: спланировать расстановку', estimated_minutes: 20, energy_required: 2 });
  const kDemontage = T({ project_id: kitchen.id, title: 'Демонтаж старого гарнитура и пола', estimated_minutes: 120, energy_required: 4, danger_level: 'tools' });
  const kFloor = T({ project_id: kitchen.id, title: 'Заменить пол на кухне', estimated_minutes: 180, energy_required: 4, danger_level: 'tools' });
  const kInstall = T({ project_id: kitchen.id, title: 'Установить гарнитур и плиту', estimated_minutes: 180, energy_required: 4, danger_level: 'heavy' });
  for (const [from, to] of [
    [kUnits, kMeasure], [kStove, kMeasure], [kBuyUnits, kUnits], [kPlan, kMeasure],
    [kFloor, kDemontage], [kFloor, kPlan], [kInstall, kFloor], [kInstall, kBuyUnits],
  ] as const) {
    repo.addTaskEdge(from.id, to.id, 'requires', now);
  }

  // Продажа стола
  const stPhoto = T({ project_id: sellTable.id, title: 'Сфотографировать массажный стол', estimated_minutes: 15, energy_required: 1, status: 'next' });
  const stPrice = T({ project_id: sellTable.id, title: 'Определить цену (посмотреть 5–10 объявлений)', estimated_minutes: 20, energy_required: 2 });
  const stAd = T({ project_id: sellTable.id, title: 'Написать и выложить объявление на Авито', estimated_minutes: 20, energy_required: 2 });
  const stAnswer = T({ project_id: sellTable.id, title: 'Отвечать покупателям', estimated_minutes: 10, energy_required: 1 });
  repo.addTaskEdge(stPrice.id, stPhoto.id, 'requires', now);
  repo.addTaskEdge(stAd.id, stPrice.id, 'requires', now);
  repo.addTaskEdge(stAnswer.id, stAd.id, 'requires', now); // до публикации объявления рано отвечать покупателям

  // Покупка стола
  const ntReq = T({ project_id: buyTable.id, title: 'Сформулировать требования (размер, вес, бюджет)', estimated_minutes: 10, energy_required: 1, status: 'next' });
  const ntBuy = T({ project_id: buyTable.id, title: 'Выбрать и купить новый стол', estimated_minutes: 60, energy_required: 2 });
  repo.addTaskEdge(ntBuy.id, ntReq.id, 'requires', now);

  // Машина
  T({ project_id: car.id, title: 'Установить магнитолу', estimated_minutes: 90, energy_required: 3, danger_level: 'tools' });
  const cVin = T({ project_id: car.id, title: 'Заменить стекло: найти VIN машины', estimated_minutes: 5, energy_required: 1, status: 'next' });
  const cGlassFind = T({ project_id: car.id, title: 'Заменить стекло: найти 3 варианта по VIN', estimated_minutes: 30, energy_required: 2 });
  const cGlassOrder = T({ project_id: car.id, title: 'Заменить стекло: заказать замену', estimated_minutes: 20, energy_required: 2 });
  repo.addTaskEdge(cGlassFind.id, cVin.id, 'requires', now);
  repo.addTaskEdge(cGlassOrder.id, cGlassFind.id, 'requires', now);

  // Физическая форма — без планов-для-прокрастинации
  T({ project_id: fitness.id, title: 'Первая тренировка с гирей 10 минут', estimated_minutes: 10, energy_required: 2, status: 'next' });
  T({ project_id: fitness.id, title: 'Первые 5 минут на баланс-борде', estimated_minutes: 5, energy_required: 2 });

  // Быт (без проекта)
  T({ title: 'Помыть холодильник', estimated_minutes: 25, energy_required: 2 });
  T({ title: 'Почистить пылесос', estimated_minutes: 10, energy_required: 1 });
  T({ title: 'Починить лючок в туалете', estimated_minutes: 30, energy_required: 3, danger_level: 'tools' });
  T({ title: 'Помыть ванну', estimated_minutes: 20, energy_required: 2 });
  T({ title: 'Разобрать стойку с вещами', estimated_minutes: 30, energy_required: 2 });

  // Прочее
  T({ title: 'Распечатать шахматы', estimated_minutes: 20, energy_required: 1 });
  T({ title: 'Распечатать призму', estimated_minutes: 10, energy_required: 1 });
  T({ title: 'Заменить аккумулятор у электронной книги', estimated_minutes: 30, energy_required: 2, danger_level: 'tools' });
  T({ title: 'Почистить сервер', estimated_minutes: 60, energy_required: 3 });
  const dueDay = new Date();
  dueDay.setUTCDate(10);
  if (dueDay.getTime() < Date.now()) dueDay.setUTCMonth(dueDay.getUTCMonth() + 1);
  const commDue = `${dueDay.getUTCFullYear()}-${String(dueDay.getUTCMonth() + 1).padStart(2, '0')}-10`;
  T({ title: 'Оплатить коммуналку', estimated_minutes: 10, energy_required: 1, due_at: commDue, recurrence: 'monthly', status: 'next' });

  /* ---------- граф знаний ---------- */
  const E = (kind: string, name: string) => repo.upsertEntity({ kind, name }, now);
  const apartment = E('place', 'Квартира');
  const kitchenE = E('place', 'Кухня');
  const bath = E('place', 'Ванная');
  const wc = E('place', 'Туалет');
  const stoveE = E('object', 'Плита');
  const fridge = E('object', 'Холодильник');
  const units = E('object', 'Кухонный гарнитур');
  const floor = E('object', 'Пол кухни');
  const carE = E('object', 'Машина');
  E('object', 'Массажный стол (старый)');
  E('object', 'Массажный стол (новый)');
  E('equipment', 'Гиря');
  E('equipment', 'Баланс-борд');
  E('equipment', 'Сервер');
  for (const [from, to] of [
    [apartment, kitchenE], [apartment, bath], [apartment, wc],
    [kitchenE, stoveE], [kitchenE, fridge], [kitchenE, units], [kitchenE, floor],
  ] as const) {
    repo.addEntityEdge(from, to, 'contains', now);
  }
  for (const t of [kMeasure, kUnits, kStove, kBuyUnits, kFloor, kInstall]) repo.linkTaskEntity(t.id, kitchenE);
  for (const t of [cVin, cGlassFind, cGlassOrder]) repo.linkTaskEntity(t.id, carE);

  /* ---------- память ---------- */
  repo.insertMemory({ kind: 'preference', source: 'user_told', content: 'Пользователь не любит жёсткое расписание и длинные списки — предлагать по одному действию.' }, now);
  repo.insertMemory({ kind: 'preference', source: 'user_told', content: 'Пользователю легче начинать короткие действия (до 15 минут).' }, now);
  repo.insertMemory({ kind: 'fact', source: 'user_told', content: 'В некоторые дни пользователь курит траву; в такие дни давать простые безопасные задачи без инструмента.' }, now);
  repo.insertMemory({ kind: 'routine', source: 'user_told', content: 'Рабочие часы пн–пт 07:00–18:00 — проактивность по домашним делам запрещена.' }, now);

  repo.setJson('seeded', 1);
  repo.addEvent('SEEDED', { payload: { tasks: 30, projects: 5 } }, now);
  return true;
}
