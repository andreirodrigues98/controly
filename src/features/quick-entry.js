// Criadores puros dos cadastros rápidos. Mantêm o mesmo formato de documentos
// do Controly para não exigir migração do Firestore.
export function normalizeQuickTitle(input, label = 'registro') {
  const value = String(input ?? '').trim().replace(/\s+/g, ' ');
  if (!value) throw new Error(`Escreva um nome para ${label}.`);
  if (value.length > 160) throw new Error('Use um nome de até 160 caracteres.');
  return value;
}

export function quickActivityRecord(title, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) throw new Error('Selecione uma data válida.');
  return {
    title: normalizeQuickTitle(title, 'a atividade'), kind: 'one-time',
    date, category: '', notes: '', priority: 'medium', estimatedMinutes: 0,
    checklist: [], checklistStatusMap: {}, completed: false, completedAt: null,
  };
}

export function quickGoalRecord(title, startDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(startDate || ''))) throw new Error('Selecione uma data válida.');
  return {
    title: normalizeQuickTitle(title, 'a meta'), category: '',
    targetType: 'deadline', targetValue: 0, currentValue: 0, cycleValues: {}, unit: '',
    linkedModule: '', linkedArea: '', period: 'open', scheduleType: 'open',
    startDate, endDate: '', durationDays: 0, recurrenceCycle: '', cycleDays: 0,
    recurrenceEndDate: '', repeatUntil: '', fixed: false, noDeadline: true,
    notes: '', dailyStatus: {}, completedCycles: {},
  };
}

export function stableOpenGoalCycleKey(goal) {
  const start = String(goal?.startDate || '').slice(0, 10);
  return `open:${start}`;
}
