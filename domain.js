import {
  dateKey,
  endOfWeek,
  formatDate,
  monthKey,
  number,
  percentage,
  startOfWeek,
  toDate,
  getBrazilianHolidays,
  getAdjustedBusinessDateForMonthDay,
  addDays,
  daysBetween,
  formatCurrency,
} from './utils.js';

export const WEEKDAYS = [
  { value: 0, label: 'Dom' },
  { value: 1, label: 'Seg' },
  { value: 2, label: 'Ter' },
  { value: 3, label: 'Qua' },
  { value: 4, label: 'Qui' },
  { value: 5, label: 'Sex' },
  { value: 6, label: 'Sáb' },
];

function normalizeDaysOfWeek(days) {
  if (!Array.isArray(days)) return [];
  return [...new Set(days.map((item) => Number(item)).filter((item) => item >= 0 && item <= 6))].sort((a, b) => a - b);
}

function nthWeekdayDate(year, monthIndex, weekday, nth) {
  const first = new Date(year, monthIndex, 1, 12, 0, 0, 0);
  const offset = (Number(weekday) - first.getDay() + 7) % 7;
  const day = 1 + offset + (Math.max(1, Number(nth) || 1) - 1) * 7;
  const candidate = new Date(year, monthIndex, day, 12, 0, 0, 0);
  return candidate.getMonth() === monthIndex ? candidate : null;
}

function dayDiffFromStart(startDate, targetDate) {
  return Math.max(0, daysBetween(startDate, targetDate));
}

function recurringMatchesDate(activity, targetDate) {
  const date = toDate(targetDate);
  if (!date) return false;
  const startsAt = toDate(activity.startDate || activity.date || activity.createdAt || new Date(2020, 0, 1));
  const safeDate = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
  const safeStart = startsAt ? new Date(startsAt.getFullYear(), startsAt.getMonth(), startsAt.getDate(), 12, 0, 0, 0) : null;
  const endsAt = toDate(activity.endDate || activity.finishDate || activity.untilDate || '');
  const safeEnd = endsAt ? new Date(endsAt.getFullYear(), endsAt.getMonth(), endsAt.getDate(), 12, 0, 0, 0) : null;
  if (safeStart && safeDate < safeStart) return false;
  if (safeEnd && safeDate > safeEnd) return false;

  const frequency = activity.frequency || activity.recurrence || 'daily';
  if (frequency === 'daily') return true;
  if (frequency === 'weekdays') return date.getDay() >= 1 && date.getDay() <= 5;
  if (frequency === 'weekly_days') {
    const days = normalizeDaysOfWeek(activity.daysOfWeek);
    return days.length ? days.includes(date.getDay()) : date.getDay() === (safeStart?.getDay() ?? date.getDay());
  }
  if (frequency === 'interval_days') {
    const interval = Math.max(1, Number(activity.intervalDays || activity.recurrenceIntervalDays || 1));
    return dayDiffFromStart(safeStart || date, date) % interval === 0;
  }
  if (frequency === 'monthly_day' || frequency === 'monthly') {
    const day = Math.max(1, Math.min(31, Number(activity.dayOfMonth || safeStart?.getDate() || 1)));
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    return date.getDate() === Math.min(day, lastDay);
  }
  if (frequency === 'monthly_nth_weekday') {
    const weekday = Number(activity.weekdayOfMonth ?? activity.weekdayForNth ?? safeStart?.getDay() ?? 1);
    const nth = Number(activity.nthWeekday || 1);
    const candidate = nthWeekdayDate(date.getFullYear(), date.getMonth(), weekday, nth);
    return Boolean(candidate && dateKey(candidate) === dateKey(date));
  }
  return true;
}


function normalizeActivityBase(item, fallback = {}) {
  return {
    id: item.id,
    title: item.title || item.name || fallback.title || 'Sem título',
    category: item.category || item.area || item.type || item.period || fallback.category || '',
    notes: item.notes || fallback.notes || '',
    priority: item.priority || fallback.priority || 'medium',
  };
}

export function getActivityDefinitions(state) {
  const current = (state.activities || []).map((item) => ({
    ...normalizeActivityBase(item),
    sourceCollection: 'activities',
    sourceType: 'activity',
    kind: item.kind || item.type || 'one-time',
    date: item.date || item.dueDate || '',
    frequency: item.frequency || 'daily',
    daysOfWeek: normalizeDaysOfWeek(item.daysOfWeek),
    intervalDays: Number(item.intervalDays || item.recurrenceIntervalDays || 1),
    dayOfMonth: Number(item.dayOfMonth || 0) || null,
    nthWeekday: Number(item.nthWeekday || 1),
    weekdayOfMonth: Number(item.weekdayOfMonth ?? item.weekdayForNth ?? 1),
    estimatedMinutes: Number(item.estimatedMinutes || 0),
    checklist: Array.isArray(item.checklist) ? item.checklist : [],
    checklistStatusMap: item.checklistStatusMap || {},
    completionMap: item.completionMap || {},
    completionField: 'completionMap',
    completed: Boolean(item.completed),
    completedAt: item.completedAt || null,
    startDate: item.startDate || item.date || '',
    endDate: item.endDate || item.finishDate || item.untilDate || '',
    createdAt: item.createdAt || null,
    legacy: false,
  }));

  const legacyTasks = (state.tasks || []).map((item) => ({
    ...normalizeActivityBase(item),
    sourceCollection: 'tasks',
    sourceType: 'task',
    kind: 'one-time',
    date: item.dueDate || item.date || '',
    checklist: [],
    checklistStatusMap: {},
    completionMap: {},
    completionField: 'completionMap',
    completed: Boolean(item.completed),
    completedAt: item.completedAt || null,
    startDate: item.dueDate || '',
    endDate: '',
    createdAt: item.createdAt || null,
    legacy: true,
  }));

  const legacyHabits = (state.habits || []).map((item) => ({
    id: item.id,
    title: item.name || item.title || 'Hábito',
    category: item.type || '',
    notes: item.notes || '',
    priority: 'medium',
    sourceCollection: 'habits',
    sourceType: 'habit',
    kind: 'recurring',
    frequency: 'daily',
    daysOfWeek: [],
    checklist: [],
    checklistStatusMap: {},
    completionMap: item.completedDates || {},
    completionField: 'completedDates',
    completed: false,
    completedAt: null,
    startDate: item.createdAt || '',
    endDate: '',
    createdAt: item.createdAt || null,
    legacy: true,
  }));

  const legacyRoutines = (state.routines || []).map((item) => ({
    id: item.id,
    title: item.title || 'Rotina',
    category: item.period === 'morning' ? 'Rotina da manhã' : item.period === 'night' ? 'Rotina da noite' : 'Rotina',
    notes: item.notes || '',
    priority: 'medium',
    sourceCollection: 'routines',
    sourceType: 'routine',
    kind: 'recurring',
    frequency: 'daily',
    daysOfWeek: [],
    checklist: [],
    checklistStatusMap: {},
    completionMap: item.completedDates || {},
    completionField: 'completedDates',
    completed: false,
    completedAt: null,
    startDate: item.createdAt || '',
    endDate: '',
    createdAt: item.createdAt || null,
    legacy: true,
  }));

  return [...current, ...legacyTasks, ...legacyHabits, ...legacyRoutines];
}

export function getActivityChecklistProgress(item, targetDateKey = dateKey(new Date())) {
  const checklist = Array.isArray(item?.checklist) ? item.checklist : [];
  const datedStatus = item?.checklistStatusMap?.[targetDateKey] || {};
  const total = checklist.length;
  const done = checklist.filter((task) => {
    const id = task?.id || task?.text || String(task || '');
    return Boolean(datedStatus[id] ?? task?.done);
  }).length;
  return { done, total, progress: percentage(done, total || 1), allDone: total > 0 && done === total };
}

function getActivityOccurrenceDone(item, targetDateKey) {
  const checklist = Array.isArray(item?.checklist) ? item.checklist : [];
  if (checklist.length) return getActivityChecklistProgress(item, targetDateKey).allDone;
  return item.kind === 'recurring' ? Boolean(item.completionMap?.[targetDateKey]) : Boolean(item.completed);
}

export function getActivityOccurrences(state, targetDate = new Date()) {
  const key = dateKey(targetDate);
  return getActivityDefinitions(state)
    .filter((item) => {
      if (item.kind === 'recurring') return recurringMatchesDate(item, targetDate);
      return key === dateKey(item.date);
    })
    .map((item) => ({
      ...item,
      occurrenceDate: key,
      occurrenceDone: getActivityOccurrenceDone(item, key),
      occurrenceId: `${item.sourceCollection}:${item.id}:${key}`,
    }))
    .sort((a, b) => Number(Boolean(a.occurrenceDone)) - Number(Boolean(b.occurrenceDone)) || (a.title || '').localeCompare(b.title || ''));
}

export function getWeeklyActivitySummary(state, baseDate = new Date()) {
  const start = startOfWeek(baseDate);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
  return days.map((day) => {
    const items = getActivityOccurrences(state, day);
    const done = items.filter((item) => item.occurrenceDone).length;
    return { date: day, key: dateKey(day), items, done, total: items.length };
  });
}

function addMonthsClamped(value, amount = 1) {
  const date = toDate(value) || new Date();
  const day = date.getDate();
  const firstOfTargetMonth = new Date(date.getFullYear(), date.getMonth() + Number(amount || 0), 1, 12, 0, 0, 0);
  const lastDay = new Date(firstOfTargetMonth.getFullYear(), firstOfTargetMonth.getMonth() + 1, 0).getDate();
  return new Date(firstOfTargetMonth.getFullYear(), firstOfTargetMonth.getMonth(), Math.min(day, lastDay), 12, 0, 0, 0);
}

function cleanGoalDate(value, fallback = new Date()) {
  const date = toDate(value) || toDate(fallback) || new Date();
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
}

function normalizeGoalScheduleType(goal = {}) {
  const rawType = goal.scheduleType || goal.durationType || '';
  if (rawType === 'recurring' || goal.fixed || (!rawType && (goal.recurrenceCycle || goal.cycleType))) return 'recurring';
  if (rawType === 'open' || goal.noDeadline || goal.openEnded) return 'open';
  if (rawType === 'duration') return 'duration';
  if (rawType === 'deadline') return 'deadline';
  if (goal.endDate || goal.finishDate || goal.untilDate) return 'deadline';
  return 'legacy';
}

function resolveGoalCycleEnd(goal = {}, start) {
  const explicitEnd = toDate(goal.endDate || goal.finishDate || goal.untilDate);
  if (explicitEnd) {
    const end = cleanGoalDate(explicitEnd);
    return end < start ? start : end;
  }

  const durationDays = Math.max(0, Number(goal.durationDays || 0));
  if (durationDays > 0) return addDays(start, durationDays);

  const period = goal.period || goal.type || 'weekly';
  if (period === 'monthly') return new Date(start.getFullYear(), start.getMonth() + 1, 0, 12, 0, 0, 0);
  return addDays(start, 6);
}

function recurringGoalCycleEnd(goal = {}, start) {
  const cycle = goal.recurrenceCycle || goal.cycleType || goal.period || 'monthly';
  if (cycle === 'weekly') return addDays(start, 6);
  if (cycle === 'custom') return addDays(start, Math.max(1, Number(goal.cycleDays || goal.durationDays || 30)) - 1);

  // Meta recorrente mensal: o ciclo termina no dia anterior ao próximo ciclo.
  // Ex.: início em 01/05 -> ciclo até 31/05; início em 26/04 -> ciclo até 25/05.
  return addDays(addMonthsClamped(start, 1), -1);
}

function buildGoalCalendarCycle(goal, baseDate = new Date()) {
  const scheduleType = normalizeGoalScheduleType(goal);
  const period = goal.period || goal.type || 'weekly';
  const start = cleanGoalDate(goal.startDate || goal.createdAt || new Date());
  const now = cleanGoalDate(baseDate);

  if (scheduleType === 'open') {
    const end = now < start ? start : now;
    return buildCycleByDates(start, end, goal.dailyStatus || {});
  }

  if (scheduleType === 'recurring') {
    let cursor = new Date(start);
    let end = recurringGoalCycleEnd(goal, cursor);
    let safety = 0;

    // Metas recorrentes não têm data final. Quando um ciclo passa, o app
    // avança para o próximo ciclo automaticamente e mantém o histórico salvo.
    while (now > end && safety < 1200) {
      cursor = addDays(end, 1);
      end = recurringGoalCycleEnd(goal, cursor);
      safety += 1;
    }

    return buildCycleByDates(cursor, end < cursor ? cursor : end, goal.dailyStatus || {});
  }

  if (scheduleType === 'deadline' || scheduleType === 'duration') {
    return buildCycleByDates(start, resolveGoalCycleEnd(goal, start), goal.dailyStatus || {});
  }

  if (period === 'monthly') {
    const monthBase = Boolean(goal.fixed) ? now : start;
    const monthStart = new Date(monthBase.getFullYear(), monthBase.getMonth(), 1, 12, 0, 0, 0);
    const monthEnd = new Date(monthBase.getFullYear(), monthBase.getMonth() + 1, 0, 12, 0, 0, 0);
    return buildCycleByDates(monthStart, monthEnd, goal.dailyStatus || {});
  }

  return buildCycle(start, 7, goal.dailyStatus || {});
}

function normalizeGoalText(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function cycleDateRange(cycle = {}) {
  const start = toDate(cycle.start);
  const end = toDate(cycle.end);
  if (!start || !end) return null;
  return {
    start: new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0, 0),
    end: new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999),
  };
}

function dateInsideCycle(value, cycle = {}) {
  const range = cycleDateRange(cycle);
  const date = toDate(value);
  if (!range || !date) return false;
  return date >= range.start && date <= range.end;
}

function goalCategoryMatches(goal = {}, item = {}) {
  const category = normalizeGoalText(goal.category || goal.area || '');
  if (!category) return true;
  const text = normalizeGoalText([
    item.title,
    item.name,
    item.category,
    item.genre,
    item.area,
    item.type,
    item.notes,
    item.subjectName,
    item.cardName,
  ].filter(Boolean).join(' '));
  return text.includes(category);
}

function goalUnit(goal = {}) {
  return normalizeGoalText(goal.unit || goal.targetUnit || '');
}

function uniqueById(items = []) {
  const seen = new Set();
  return items.filter((item) => {
    const id = item?.id || `${item?.subjectId || ''}:${item?.createdAt || item?.endedAt || Math.random()}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function readingGoalValue(state = {}, goal = {}, cycle = {}) {
  const unit = goalUnit(goal);
  const books = (state.readingItems || []).filter((item) => goalCategoryMatches(goal, item));
  if (unit.includes('livro')) {
    return books.filter((item) => {
      const status = normalizeGoalText(item.status || item.readingStatus || '');
      return ['concluido', 'done', 'completed'].includes(status) && dateInsideCycle(item.updatedAt || item.completedAt || item.createdAt || new Date(), cycle);
    }).length;
  }

  const loggedPages = books.reduce((sum, book) => {
    const entries = Array.isArray(book.readingLog) ? book.readingLog : [];
    return sum + entries
      .filter((log) => dateInsideCycle(log.date || log.createdAt, cycle))
      .reduce((total, log) => total + Math.max(0, number(log.delta ?? log.pages ?? log.pagesRead ?? 0, 0)), 0);
  }, 0);
  if (loggedPages > 0) return loggedPages;
  return books.reduce((sum, book) => sum + Math.max(0, number(book.pagesRead, 0)), 0);
}

function workoutDurationMinutes(workout = {}) {
  const fromSegments = Array.isArray(workout.segments)
    ? workout.segments.reduce((sum, segment) => sum + Math.max(0, number(segment.durationMinutes, 0)), 0)
    : 0;
  return fromSegments || Math.max(0, number(workout.durationMinutes || workout.duration || 0, 0));
}

function workoutGoalValue(state = {}, goal = {}, cycle = {}) {
  const unit = goalUnit(goal);
  const workouts = (state.workouts || [])
    .filter((item) => goalCategoryMatches(goal, item))
    .filter((item) => dateInsideCycle(item.date || item.completedAt || item.createdAt, cycle))
    .filter((item) => Boolean(item.completed || item.status === 'done'));
  if (unit.includes('hora')) return workouts.reduce((sum, item) => sum + workoutDurationMinutes(item), 0) / 60;
  if (unit.includes('min')) return workouts.reduce((sum, item) => sum + workoutDurationMinutes(item), 0);
  return workouts.length;
}

function studyGoalValue(state = {}, goal = {}, cycle = {}) {
  const unit = goalUnit(goal);
  const subjects = getStudySubjectViews(state).filter((subject) => goalCategoryMatches(goal, subject));
  const subjectIds = new Set(subjects.map((subject) => subject.id));
  const embeddedSessions = subjects.flatMap((subject) => (subject.studySessions || []).map((session) => ({ ...session, subjectId: subject.id, subjectName: subject.name })));
  const rootSessions = (state.studySessions || []).filter((session) => !subjectIds.size || subjectIds.has(session.subjectId) || goalCategoryMatches(goal, session));
  const sessions = uniqueById([...rootSessions, ...embeddedSessions]).filter((session) => dateInsideCycle(session.endedAt || session.createdAt || session.startedAt, cycle));

  if (unit.includes('hora')) return sessions.reduce((sum, session) => sum + Math.max(0, number(session.durationMs, 0)), 0) / 3600000;
  if (unit.includes('min')) return sessions.reduce((sum, session) => sum + Math.max(0, number(session.durationMs, 0)), 0) / 60000;
  if (unit.includes('tarefa') || unit.includes('atividade')) {
    return subjects.reduce((sum, subject) => sum + (subject.todos || []).filter((todo) => todo.done).length, 0);
  }
  return sessions.length || subjects.reduce((sum, subject) => sum + (subject.todos || []).filter((todo) => todo.done).length, 0);
}

function financeGoalValue(state = {}, goal = {}, cycle = {}) {
  return (state.financeEntries || [])
    .filter((entry) => !entry.virtual)
    .filter((entry) => goalCategoryMatches(goal, entry))
    .filter((entry) => dateInsideCycle(entry.dueDate || `${entry.monthKey || monthKey(entry.createdAt || new Date())}-01`, cycle))
    .filter((entry) => {
      const status = normalizeGoalText(entry.status || '');
      return entry.paid === true || entry.received === true || ['paid', 'pago', 'received', 'recebido'].includes(status);
    })
    .reduce((sum, entry) => sum + Math.max(0, number(entry.amount, 0)), 0);
}

function getLinkedGoalProgress(state = {}, goal = {}, cycle = {}) {
  const linkedModule = goal.linkedModule || (goal.targetType === 'linked' ? goal.linkedArea : '');
  if (!linkedModule) return null;

  const sources = {
    reading: { label: 'Leitura', value: readingGoalValue(state, goal, cycle) },
    workouts: { label: 'Treinos', value: workoutGoalValue(state, goal, cycle) },
    studies: { label: 'Estudos', value: studyGoalValue(state, goal, cycle) },
    finance: { label: 'Finanças', value: financeGoalValue(state, goal, cycle) },
  };
  const source = sources[linkedModule];
  if (!source) return null;
  return { sourceLabel: source.label, currentValue: Math.max(0, number(source.value, 0)) };
}

export function getGoalCycle(goal, baseDate = new Date(), appState = null) {
  const baseCycle = buildGoalCalendarCycle(goal, baseDate);
  const targetType = goal.targetType === 'linked' ? 'quantity' : (goal.targetType || 'habit');

  if (targetType === 'quantity' || targetType === 'money') {
    const target = Math.max(0, number(goal.targetValue, 0));
    const cycleValues = goal.cycleValues || {};
    const hasCycleValue = Object.prototype.hasOwnProperty.call(cycleValues, baseCycle.key);
    const legacyValue = goal.fixed ? 0 : number(goal.currentValue ?? goal.progressValue ?? goal.amountDone ?? 0, 0);
    const currentValue = Math.max(0, number(hasCycleValue ? cycleValues[baseCycle.key] : legacyValue, 0));
    const done = target > 0 ? Math.min(currentValue, target) : currentValue;

    return {
      ...baseCycle,
      trackerType: 'value',
      targetType,
      currentValue,
      done,
      total: target || 1,
      progress: target > 0 ? percentage(done, target) : 0,
      isFinished: target > 0 && currentValue >= target,
    };
  }

  if (targetType === 'deadline') {
    const range = cycleDateRange(baseCycle);
    const today = toDate(baseDate) || new Date();
    const todayClean = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12, 0, 0, 0);
    let elapsedDays = 0;
    let remainingDays = baseCycle.total;

    if (range) {
      const start = new Date(range.start.getFullYear(), range.start.getMonth(), range.start.getDate(), 12, 0, 0, 0);
      const end = new Date(range.end.getFullYear(), range.end.getMonth(), range.end.getDate(), 12, 0, 0, 0);
      elapsedDays = todayClean < start ? 0 : Math.min(baseCycle.total, daysBetween(start, todayClean) + 1);
      remainingDays = Math.max(0, daysBetween(todayClean, end));
    }

    const isFinished = Boolean(goal.completedCycles?.[baseCycle.key]);

    return {
      ...baseCycle,
      trackerType: 'deadline',
      targetType,
      done: isFinished ? baseCycle.total : elapsedDays,
      total: baseCycle.total,
      elapsedDays,
      remainingDays,
      progress: isFinished ? 100 : percentage(elapsedDays, baseCycle.total || 1),
      isFinished,
    };
  }

  return {
    ...baseCycle,
    trackerType: 'habit',
    targetType: 'habit',
  };
}

function buildCycleByDates(start, end, dailyStatus) {
  const duration = Math.max(1, daysBetween(start, end) + 1);
  return buildCycle(start, duration, dailyStatus);
}

function buildCycle(start, duration, dailyStatus) {
  const days = Array.from({ length: duration }, (_, index) => {
    const date = addDays(start, index);
    const key = dateKey(date);
    return { date, key, done: Boolean(dailyStatus?.[key]) };
  });
  const done = days.filter((item) => item.done).length;
  const end = days[days.length - 1]?.date;
  return {
    key: `${dateKey(start)}_${dateKey(end)}`,
    start,
    end,
    days,
    done,
    total: days.length,
    progress: percentage(done, days.length),
    isFinished: done === days.length,
  };
}


export function getGoalViews(state, baseDate = new Date()) {
  return (state.goals || []).map((goal) => ({
    ...goal,
    period: goal.period || goal.type || 'weekly',
    cycle: getGoalCycle(goal, baseDate, state),
  }));
}

export function getStudySubjectViews(state) {
  return (state.subjects || []).map((subject) => {
    const todos = Array.isArray(subject.todos) ? subject.todos : [];
    const importantDates = Array.isArray(subject.importantDates) ? subject.importantDates : [];
    const done = todos.filter((item) => item.done).length;
    return {
      ...subject,
      todos,
      importantDates,
      progress: percentage(done, todos.length || 1),
      todoDone: done,
      todoTotal: todos.length,
    };
  });
}

export function getReadingViews(state) {
  const statusMap = {
    want: 'Quero ler',
    want_to_read: 'Quero ler',
    to_read: 'Quero ler',
    'quero ler': 'Quero ler',
    reading: 'Lendo',
    lendo: 'Lendo',
    paused: 'Pausado',
    pausado: 'Pausado',
    done: 'Concluído',
    completed: 'Concluído',
    concluido: 'Concluído',
    concluído: 'Concluído',
    abandoned: 'Abandonado',
    abandonado: 'Abandonado',
    abondonado: 'Abandonado',
  };

  const partialStatuses = ['Lendo', 'Pausado', 'Abandonado'];

  function normalizeReadingStatus(status, pagesRead, totalPages) {
    if (pagesRead <= 0) return 'Quero ler';
    if (totalPages > 0 && pagesRead >= totalPages) return 'Concluído';
    if (partialStatuses.includes(status)) return status;
    return 'Lendo';
  }

  return (state.readingItems || []).map((item) => {
    const totalPages = Math.max(0, number(item.totalPages, 0));
    const pagesRead = Math.max(0, Math.min(totalPages || Number.MAX_SAFE_INTEGER, number(item.pagesRead, 0)));
    const rawStatus = String(item.status || item.readingStatus || '').trim().toLowerCase();
    const mappedStatus = statusMap[rawStatus] || item.status || item.readingStatus || '';
    const status = normalizeReadingStatus(mappedStatus, pagesRead, totalPages);
    const dailyGoal = Math.max(0, number(item.dailyGoal || item.pagesPerDay || 0));
    const remainingPages = Math.max(0, totalPages - pagesRead);
    const estimatedDays = dailyGoal > 0 && remainingPages > 0 ? Math.ceil(remainingPages / dailyGoal) : null;
    return {
      ...item,
      totalPages,
      pagesRead,
      status,
      dailyGoal,
      remainingPages,
      estimatedDays,
      progress: percentage(pagesRead, totalPages || 1),
    };
  });
}

function rollDueDateToMonth(dueDate, targetMonth = monthKey(new Date())) {
  if (!dueDate) return '';
  const original = toDate(dueDate);
  if (!original) return '';
  const [year, month] = String(targetMonth).split('-').map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  const day = Math.min(original.getDate(), lastDay);
  return `${targetMonth}-${String(day).padStart(2, '0')}`;
}

export function getFinanceEntriesForMonth(state, targetMonth = new Date()) {
  const month = typeof targetMonth === 'string' ? targetMonth : monthKey(targetMonth);
  const explicit = (state.financeEntries || []).filter((item) => (item.monthKey || monthKey(item.createdAt || new Date())) === month);
  const templates = (state.financeEntries || []).filter((item) => Boolean(item.fixed));

  const missing = templates
    .filter((template) => {
      const templateMonth = template.monthKey || monthKey(template.createdAt || new Date());
      return templateMonth <= month && !explicit.some((entry) => entry.templateId === template.id && (entry.monthKey || '') === month && entry.id !== template.id) && !(templateMonth === month && explicit.some((entry) => entry.id === template.id));
    })
    .map((template) => ({
      ...template,
      id: `virtual-${template.id}-${month}`,
      templateId: template.id,
      monthKey: month,
      paymentDate: template.paymentDate ? rollDueDateToMonth(template.paymentDate, month) : '',
      paymentEndDate: template.paymentEndDate || '',
      dueDate: '',
      virtual: true,
      status: 'pending',
      paid: false,
      received: false,
    }));

  return [...explicit, ...missing].sort((a, b) => (a.title || '').localeCompare(b.title || ''));
}

export function saveDashboardPreference(preference) {
  localStorage.setItem('controly.dashboard.widgets', JSON.stringify(preference));
}

function buildHolidayAgendaItems(targetDate) {
  const date = toDate(targetDate) || new Date();
  const key = dateKey(date);
  return getBrazilianHolidays(date.getFullYear())
    .filter((item) => item.date === key)
    .map((item) => ({
      id: `holiday:${item.id}`,
      title: item.title,
      date: key,
      source: 'holiday',
      completed: false,
      time: '',
      type: item.type || 'Feriado nacional',
      notes: '',
    }));
}

function buildStudyAgendaItems(state, targetDate) {
  const key = dateKey(targetDate);
  return getStudySubjectViews(state).flatMap((subject) => (subject.importantDates || [])
    .filter((item) => dateKey(item.date) === key)
    .map((item) => {
      const kind = item.type || item.title || 'Data importante';
      return {
        id: `study:${subject.id}:${item.id}`,
        subjectId: subject.id,
        title: `${kind} - ${subject.name || 'Matéria'}`,
        originalTitle: item.title || '',
        date: key,
        source: 'studies',
        completed: false,
        time: item.startTime || item.time || '',
        endTime: item.endTime || '',
        type: kind,
        notes: item.title && item.title !== kind ? item.title : '',
      };
    }));
}

function workoutAgendaLabel(item = {}) {
  const selected = Array.isArray(item.trainingTypes) && item.trainingTypes.length ? item.trainingTypes : [item.trainingType || item.type || 'Treino'];
  const labels = selected.map((type) => {
    const raw = String(type || '').toLowerCase();
    if (raw === 'gym' || raw.includes('academia') || raw.includes('muscul')) return 'Academia';
    if (raw === 'running' || raw.includes('corrida')) return 'Corrida';
    if (raw === 'cardio' || raw.includes('aer')) return 'Aeróbico';
    return item.modality || item.type || 'Treino';
  });
  return [...new Set(labels)].join(' + ');
}

function buildWorkoutAgendaItems(state, targetDate) {
  const key = dateKey(targetDate);
  return (state.workouts || [])
    .filter((item) => dateKey(item.date) === key)
    .map((item) => ({
      ...item,
      id: `workout:${item.id}`,
      title: `Treino - ${workoutAgendaLabel(item)}`,
      date: key,
      source: 'workout',
      completed: Boolean(item.completed || item.status === 'done'),
      time: item.time || item.startTime || '',
      type: 'Treino',
      notes: item.notes || '',
    }));
}


function buildGoalAgendaItems(state, targetDate) {
  const key = dateKey(targetDate);
  return getGoalViews(state, targetDate)
    .filter((goal) => {
      const scheduleType = normalizeGoalScheduleType(goal);
      if (!['deadline', 'duration', 'legacy'].includes(scheduleType)) return false;
      const hasDefinedDeadline = Boolean(goal.endDate || goal.finishDate || goal.untilDate || Number(goal.durationDays || 0) > 0 || ['deadline', 'duration'].includes(scheduleType));
      if (!hasDefinedDeadline) return false;
      return dateKey(goal.cycle?.end) === key;
    })
    .map((goal) => ({
      id: `goal:${goal.id}:${key}`,
      recordId: goal.id,
      title: `Meta: ${goal.title || 'Sem título'}`,
      date: key,
      source: 'goal',
      completed: Boolean(goal.cycle?.isFinished),
      time: '',
      type: 'Prazo da meta',
      notes: goal.notes || 'Data final da meta.',
    }));
}

function buildFinanceAgendaItems(state, targetDate) {
  const key = dateKey(targetDate);
  const cardItems = buildCreditCardAlerts(state, targetDate)
    .filter((alert) => alert.kind === 'due' || alert.kind === 'closing')
    .map((alert) => ({
      id: `finance-card:${alert.kind}:${alert.card.id}:${alert.monthKey || key}`,
      title: `${alert.kind === 'closing' ? 'Fechamento' : 'Vencimento'} - ${alert.card.name || 'Cartão'}`,
      date: key,
      source: 'finance',
      completed: false,
      time: '',
      type: 'Cartão de crédito',
      notes: alert.kind === 'due'
        ? `A fatura vence hoje${alert.amount > 0 ? ` · ${formatCurrency(alert.amount)} em aberto` : ''}`
        : 'A fatura fecha hoje',
    }));

  const financeEntriesForCalendar = uniqueById([
    ...(state.financeEntries || []),
    ...getFinanceEntriesForMonth(state, monthKey(targetDate)),
  ]);

  const entryItems = financeEntriesForCalendar
    .filter((entry) => entry.paymentDate && dateKey(entry.paymentDate) === key)
    .map((entry) => {
      const isIncome = ['income', 'receita', 'entrada', 'receivable', 'receive', 'a receber'].includes(String(entry.flowType || entry.entryType || '').toLowerCase());
      const rawStatus = String(entry.status || '').toLowerCase();
      const completed = isIncome
        ? Boolean(entry.received || rawStatus === 'received' || rawStatus === 'recebido')
        : Boolean(entry.paid || rawStatus === 'paid' || rawStatus === 'pago');
      const installmentText = entry.installmentEnabled && entry.totalInstallments > 1
        ? ` · parcela ${entry.installmentNumber || 1}/${entry.totalInstallments}`
        : '';
      const cardText = entry.cardName ? ` · ${entry.cardName}` : '';
      return {
        id: `finance-entry:${entry.id}:${key}`,
        recordId: entry.id,
        title: `${isIncome ? 'Receber' : 'Pagar'} - ${entry.title || 'lançamento financeiro'}`,
        date: key,
        source: 'finance',
        completed,
        time: '',
        type: isIncome ? 'Recebimento financeiro' : 'Pagamento financeiro',
        notes: `${formatCurrency(entry.amount || 0)}${installmentText}${cardText}`,
      };
    });

  return [...cardItems, ...entryItems];
}

function normalizeEventRecurrenceType(event = {}) {
  return event.recurrenceType || event.repeat || event.frequency || 'none';
}

function eventMatchesDate(event = {}, targetDate = new Date()) {
  const recurrenceType = normalizeEventRecurrenceType(event);
  if (recurrenceType && recurrenceType !== 'none') {
    return recurringMatchesDate({
      ...event,
      frequency: recurrenceType,
      startDate: event.startDate || event.date,
      endDate: event.recurrenceEndDate || event.repeatUntil || '',
      intervalDays: event.intervalDays || event.recurrenceIntervalDays || 1,
      dayOfMonth: event.dayOfMonth || toDate(event.date)?.getDate(),
    }, targetDate);
  }
  return dateKey(event.date) === dateKey(targetDate);
}

function buildEventAgendaItem(event = {}, targetKey) {
  const recurrenceType = normalizeEventRecurrenceType(event);
  const recurring = recurrenceType !== 'none';
  return {
    ...event,
    id: recurring ? event.id + ':' + targetKey : event.id,
    recordId: event.id,
    source: 'event',
    date: targetKey,
    recurrenceType,
    recurring,
    completed: recurring ? Boolean(event.completionMap?.[targetKey]) : Boolean(event.completed),
  };
}

export function buildAgendaItems(state, targetDate) {
  const key = dateKey(targetDate);
  const activityItems = getActivityOccurrences(state, targetDate).map((item) => ({
    ...item,
    recordId: item.id,
    occurrenceId: item.occurrenceId,
    id: item.occurrenceId,
    title: item.title,
    date: key,
    source: 'activity',
    completed: item.occurrenceDone,
    time: '',
    type: item.kind === 'recurring' ? 'Atividade da rotina' : 'Atividade única',
  }));

  const events = (state.events || [])
    .filter((item) => eventMatchesDate(item, targetDate))
    .map((item) => buildEventAgendaItem(item, key));

  const studyItems = buildStudyAgendaItems(state, targetDate);
  const holidayItems = buildHolidayAgendaItems(targetDate);
  const workoutItems = buildWorkoutAgendaItems(state, targetDate);
  const financeItems = buildFinanceAgendaItems(state, targetDate);
  const goalItems = buildGoalAgendaItems(state, targetDate);

  return [...holidayItems, ...activityItems, ...events, ...goalItems, ...studyItems, ...workoutItems, ...financeItems].sort((a, b) => (a.time || a.startTime || '').localeCompare(b.time || b.startTime || '') || (a.title || '').localeCompare(b.title || ''));
}

export function buildCreditCardAlerts(state, baseDate = new Date()) {
  const today = toDate(baseDate) || new Date();
  const todayKey = dateKey(today);
  const day = today.getDate();
  const currentMonth = monthKey(today);
  const previousMonth = monthKey(new Date(today.getFullYear(), today.getMonth() - 1, 1, 12, 0, 0, 0));
  const cards = (state.financeCards || [])
    .filter((card) => (card.active ?? true) !== false)
    .filter((card) => !['debit', 'debito', 'débito'].includes(String(card.type || 'credit').toLowerCase()));

  const openAmountForCard = (card, targetMonth) => {
    const entries = getFinanceEntriesForMonth(state, targetMonth);
    const normalizeCardName = (value = '') => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
    const cardName = normalizeCardName(card.name || card.cardName || '');
    const openEntries = entries
      .filter((entry) => entry.cardId === card.id || (cardName && normalizeCardName(entry.cardName || entry.card || entry.paymentMethod || '') === cardName))
      .filter((entry) => !['income', 'receita', 'entrada', 'receivable', 'receive', 'a receber'].includes(String(entry.flowType || entry.entryType || '').toLowerCase()))
      .filter((entry) => {
        const rawStatus = String(entry.status || '').toLowerCase();
        return !(entry.paid === true || rawStatus === 'paid' || rawStatus === 'pago');
      });
    return openEntries.reduce((sum, entry) => sum + number(entry.amount, 0), 0);
  };

  return cards.flatMap((card) => {
    const alerts = [];
    const closingDay = number(card.closingDay, 0);
    const dueDay = number(card.dueDay, 0);
    if (closingDay === day) alerts.push({ kind: 'closing', card, amount: 0, dueDate: todayKey });

    const dueMonths = [...new Set([currentMonth, previousMonth])]
      .map((targetMonth) => {
        const adjustedDueDate = dueDay ? getAdjustedBusinessDateForMonthDay(targetMonth, dueDay) : '';
        const [year, month] = targetMonth.split('-').map(Number);
        const lastDay = new Date(year, month, 0).getDate();
        const rawDueDate = dueDay ? `${targetMonth}-${String(Math.min(dueDay, lastDay)).padStart(2, '0')}` : '';
        const dueDate = adjustedDueDate || rawDueDate;
        return { targetMonth, adjustedDueDate, rawDueDate, dueDate };
      })
      .filter((item) => item.dueDate);

    dueMonths.forEach(({ targetMonth, adjustedDueDate, rawDueDate, dueDate }) => {
      const amount = openAmountForCard(card, targetMonth);
      if (amount <= 0) return;
      const due = toDate(dueDate);
      const todayBase = toDate(todayKey);
      const dueBase = due ? toDate(dateKey(due)) : null;
      const daysLate = dueBase && todayBase ? Math.floor((todayBase.getTime() - dueBase.getTime()) / 86400000) : 0;
      if (adjustedDueDate === todayKey || rawDueDate === todayKey) {
        alerts.push({ kind: 'due', card, amount, dueDate, originalDueDay: dueDay, monthKey: targetMonth });
      } else if (dueDate < todayKey && daysLate >= 0 && daysLate <= 30) {
        alerts.push({ kind: 'overdue', card, amount, dueDate, originalDueDay: dueDay, monthKey: targetMonth, daysLate });
      }
    });

    return alerts.sort((a, b) => {
      const rank = { overdue: 0, due: 1, closing: 2 };
      return (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9) || String(a.card?.name || '').localeCompare(String(b.card?.name || ''));
    });
  });
}

export function buildDashboardSnapshot(state, baseDate = new Date()) {
  const todayActivities = getActivityOccurrences(state, baseDate);
  const weekly = getWeeklyActivitySummary(state, baseDate);
  const goals = getGoalViews(state, baseDate);
  const studies = getStudySubjectViews(state);
  const reading = getReadingViews(state);
  const finance = getFinanceEntriesForMonth(state, baseDate);
  const todayAgenda = buildAgendaItems(state, baseDate);
  const weekAgenda = [];
  for (let date = startOfWeek(baseDate); date <= endOfWeek(baseDate); date = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)) {
    weekAgenda.push(...buildAgendaItems(state, date));
  }

  return {
    todayActivities,
    weekly,
    goals,
    studies,
    reading,
    finance,
    todayAgenda,
    agenda: weekAgenda,
    todayLabel: formatDate(baseDate, { weekday: 'long', day: '2-digit', month: 'long' }),
  };
}
