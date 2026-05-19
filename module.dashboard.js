import { closeModal, createEmptyState, openModal } from './ui.js';
import { buildCreditCardAlerts, buildDashboardSnapshot, getActivityDefinitions, getActivityOccurrences } from './domain.js';
import { addDays, dateKey, escapeHtml, formatCurrency, formatDate, toDate } from './utils.js';

const STORAGE_KEY = 'controly.dashboard.widgets';
const PRIORITY_LABEL = { high: 'alta', medium: 'média', low: 'baixa' };

function loadDashboardPreference() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      activities: stored.activities ?? true,
      goals: stored.goals ?? true,
      studies: stored.studies ?? true,
      finance: stored.finance ?? true,
      reading: stored.reading ?? true,
      calendar: stored.calendar ?? true,
      workouts: stored.workouts ?? true,
    };
  } catch {
    return { activities: true, goals: true, studies: true, finance: true, reading: true, calendar: true, workouts: true };
  }
}

function saveDashboardPreference(preference) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preference));
}

function tomorrowKey(baseDate = new Date()) {
  const date = new Date(baseDate);
  date.setDate(date.getDate() + 1);
  return dateKey(date);
}

function getWorkoutTypeLabel(workout = {}) {
  const type = workout.trainingType || workout.type || 'other';
  if (type === 'gym') return 'Academia';
  if (type === 'running') return 'Corrida';
  if (type === 'cardio') return 'Cardio';
  return workout.type || 'Treino personalizado';
}

function getUpcomingStudyDates(studies, targetKey) {
  return studies.flatMap((subject) => (subject.importantDates || [])
    .filter((item) => dateKey(item.date) === targetKey)
    .map((item) => ({ subject, item })));
}


function getAgendaTimeLabel(item = {}) {
  const start = String(item.time || item.startTime || '').trim();
  const end = String(item.endTime || item.finishTime || '').trim();
  if (start && end && end !== start) return `${start} - ${end}`;
  return start || end || '';
}

function getAgendaMetaLabel(item = {}) {
  const dateLabel = formatDate(item.date, { day: '2-digit', month: 'short' });
  const timeLabel = getAgendaTimeLabel(item);
  return timeLabel ? `${dateLabel} · ${timeLabel}` : dateLabel;
}

function getGoalDeadlineAgendaItems(agenda = [], startKey = '', endKey = '') {
  return (agenda || [])
    .filter((item) => {
      const itemKey = dateKey(item.date);
      if (!itemKey || item.source !== 'goal' || item.completed) return false;
      if (startKey && itemKey < startKey) return false;
      if (endKey && itemKey > endKey) return false;
      return true;
    })
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.title || '').localeCompare(String(b.title || '')));
}

function getGoalDeadlineAttentionItems(goals = [], todayKey = dateKey(new Date())) {
  const todayDate = toDate(todayKey) || new Date();
  const currentYear = todayDate.getFullYear();
  const currentMonth = todayDate.getMonth();

  return (goals || [])
    .map((goal) => {
      const endDate = toDate(goal.cycle?.end || goal.endDate || goal.finishDate || goal.untilDate);
      const endKey = endDate ? dateKey(endDate) : '';
      if (!endDate || !endKey || endKey < todayKey) return null;
      if (endDate.getFullYear() !== currentYear || endDate.getMonth() !== currentMonth) return null;
      if (goal.completed || goal.cycle?.isFinished || Number(goal.cycle?.progress || 0) >= 100) return null;

      return {
        id: `goal-attention:${goal.id || goal.title || endKey}:${endKey}`,
        recordId: goal.id,
        title: `Meta: ${goal.title || 'Sem título'}`,
        date: endKey,
        source: 'goal',
        completed: false,
        time: '',
        type: 'Prazo da meta',
        notes: goal.notes || 'Data final da meta.',
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.title || '').localeCompare(String(b.title || '')));
}

function describeAgendaItem(item = {}) {
  const title = String(item.title || '');
  const timeLabel = getAgendaTimeLabel(item);
  return timeLabel ? `${title} · ${timeLabel}` : title;
}

function getActivityDateKey(item = {}) {
  const date = toDate(item.date || item.startDate || '');
  return date ? dateKey(date) : '';
}

function getActivityOccurrenceForDate(state, item = {}, targetKey = '') {
  if (!targetKey) return null;
  return getActivityOccurrences(state, targetKey)
    .find((entry) => entry.id === item.id && entry.sourceCollection === item.sourceCollection);
}

function getOverdueActivityItems(state, todayKey = dateKey(new Date())) {
  return getActivityDefinitions(state)
    .filter((item) => item.kind === 'one-time')
    .map((item) => {
      const targetKey = getActivityDateKey(item);
      if (!targetKey || targetKey >= todayKey) return null;
      const occurrence = getActivityOccurrenceForDate(state, item, targetKey);
      const completed = Boolean(occurrence?.occurrenceDone ?? item.completed);
      return {
        ...item,
        date: targetKey,
        completed,
        occurrenceDone: completed,
        source: 'activity',
      };
    })
    .filter((item) => item && !item.completed)
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || (a.title || '').localeCompare(b.title || ''));
}

function getOverdueFinanceItems(cardAlerts = []) {
  return cardAlerts
    .filter((alert) => alert.kind === 'overdue')
    .map((alert) => ({
      id: `finance-overdue:${alert.card?.id || alert.card?.name || 'card'}:${alert.monthKey || alert.dueDate}`,
      title: `Fatura atrasada - ${alert.card?.name || 'Cartão'}`,
      date: alert.dueDate || dateKey(new Date()),
      source: 'finance',
      completed: false,
      time: '',
      type: 'Fatura vencida',
    }));
}

export function createDashboardModule() {
  let root;
  let preference = loadDashboardPreference();

  function openWidgetConfig() {
    openModal({
      title: 'Organize seu painel',
      eyebrow: 'Preferências do painel',
      body: `
        <form id="dashboard-preference-form" class="stack-form">
          ${Object.entries({ activities: 'Atividades', goals: 'Metas', studies: 'Estudos', finance: 'Finanças', reading: 'Leitura', calendar: 'Agenda', workouts: 'Treinos' }).map(([key, label]) => `
            <label class="checkbox-line"><input type="checkbox" name="widget" value="${key}" ${preference[key] ? 'checked' : ''} /> <span>${label}</span></label>
          `).join('')}
          <div class="inline-actions"><button type="button" id="dashboard-preference-cancel" class="btn btn-secondary">Cancelar</button><button type="submit" class="btn btn-primary">Salvar painel</button></div>
        </form>
      `,
    });
    document.getElementById('dashboard-preference-cancel')?.addEventListener('click', closeModal);
    document.getElementById('dashboard-preference-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const values = new Set(new FormData(event.currentTarget).getAll('widget'));
      preference = {
        activities: values.has('activities'),
        goals: values.has('goals'),
        studies: values.has('studies'),
        finance: values.has('finance'),
        reading: values.has('reading'),
        calendar: values.has('calendar'),
        workouts: values.has('workouts'),
      };
      saveDashboardPreference(preference);
      closeModal();
      render(window.__CONTROLY_STATE);
    });
  }

  function itemList(items, renderer, emptyTitle, emptyText) {
    return items.length ? `<ul class="agenda-list">${items.map(renderer).join('')}</ul>` : createEmptyState(emptyTitle, emptyText);
  }

  function renderAccordionCard({ eyebrow, title, meta = '', body = '', open = false, size = 'standard' }) {
    return `
      <details class="section-accordion dashboard-accordion dashboard-accordion-${size}" ${open ? 'open' : ''}>
        <summary>
          <div class="section-accordion-head">
            <span class="eyebrow">${escapeHtml(eyebrow)}</span>
            <strong>${escapeHtml(title)}</strong>
            ${meta ? `<div class="section-accordion-meta"><span class="chip">${meta}</span></div>` : ''}
          </div>
        </summary>
        <div class="section-accordion-body">${body}</div>
      </details>
    `;
  }

  function buildDailySummaryItems(state, snapshot, cardAlerts) {
    const today = dateKey(new Date());
    const tomorrow = tomorrowKey(new Date());
    const pendingActivities = snapshot.todayActivities.filter((item) => !item.occurrenceDone);
    const overdueActivities = getOverdueActivityItems(state, today).slice(0, 3);
    const todayEvents = snapshot.todayAgenda.filter((item) => item.source === 'event');
    const todayStudyDates = getUpcomingStudyDates(snapshot.studies, today);
    const tomorrowStudyDates = getUpcomingStudyDates(snapshot.studies, tomorrow);
    const goalDeadlinesToday = getGoalDeadlineAgendaItems(snapshot.agenda, today, today);
    const goalDeadlinesThisWeek = getGoalDeadlineAgendaItems(snapshot.agenda, tomorrow).slice(0, 3);
    const pendingWorkouts = (state.workouts || []).filter((workout) => dateKey(workout.date) === today && !workout.completed);

    const items = [];
    cardAlerts.forEach((alert) => {
      if (alert.kind === 'closing') items.push(`A fatura do cartão ${alert.card.name} fecha hoje. Revise seus gastos para se preparar para o pagamento.`);
      if (alert.kind === 'due') {
        items.push(`A fatura do cartão ${alert.card.name} vence hoje. Confira o valor e marque como pago quando concluir.`);
        if (alert.amount > 0) items.push(`Você tem ${formatCurrency(alert.amount)} em compras nessa fatura.`);
      }
      if (alert.kind === 'overdue') {
        items.push(`A fatura do cartão ${alert.card.name} está atrasada. Priorize esse pagamento para evitar novos encargos.`);
        if (alert.amount > 0) items.push(`Ainda há ${formatCurrency(alert.amount)} em aberto nessa fatura.`);
      }
    });
    if (overdueActivities.length) items.push(`Você tem ${overdueActivities.length} atividade(s) atrasada(s).`);
    if (pendingActivities.length) items.push(`Você tem ${pendingActivities.length} atividade(s) para concluir hoje.`);
    todayEvents.slice(0, 2).forEach((item) => items.push(`Compromisso de hoje: ${describeAgendaItem(item)}`));
    todayStudyDates.slice(0, 2).forEach(({ subject, item }) => items.push(`Estudos de hoje: ${item.type || 'Entrega'} de ${subject.name}`));
    goalDeadlinesToday.slice(0, 2).forEach((item) => items.push(`Meta com prazo hoje: ${item.title.replace(/^Meta:\s*/i, '')}`));
    goalDeadlinesThisWeek.slice(0, 2).forEach((item) => items.push(`Meta com prazo nesta semana: ${item.title.replace(/^Meta:\s*/i, '')} (${formatDate(item.date, { day: '2-digit', month: 'short' })})`));
    tomorrowStudyDates.slice(0, 2).forEach(({ subject, item }) => items.push(`Prepare-se para amanhã: ${item.type || 'Entrega'} de ${subject.name}`));
    if (pendingWorkouts.length) items.push(`${pendingWorkouts.length === 1 ? 'Você tem 1 treino para concluir hoje.' : `Você tem ${pendingWorkouts.length} treinos para concluir hoje.`}`);

    return items.slice(0, 8);
  }

  function buildNextAction(state, snapshot, cardAlerts) {
    const today = dateKey(new Date());
    const pendingTodayActivity = snapshot.todayActivities.find((item) => !item.occurrenceDone);
    const overdueActivity = getOverdueActivityItems(state, today)[0];
    const urgentFinance = (snapshot.todayAgenda || []).find((item) => item.source === 'finance' && !item.completed);
    const todayEvent = (snapshot.todayAgenda || []).find((item) => item.source === 'event' && !item.completed);
    const overdueGoal = (snapshot.goals || []).find((goal) => goal.cycle.progress < 100 && toDate(goal.cycle.end) < toDate(today));

    if (urgentFinance) return { label: 'Conferir pagamento de hoje', text: urgentFinance.title, section: 'finance' };
    if (cardAlerts.some((alert) => alert.kind === 'due')) return { label: 'Revisar fatura que vence hoje', text: 'Confira seus cartões e marque o pagamento assim que concluir.', section: 'finance' };
    if (pendingTodayActivity) return { label: 'Concluir a próxima atividade de hoje', text: pendingTodayActivity.title, section: 'activities' };
    if (todayEvent) return { label: 'Preparar o próximo item de hoje', text: describeAgendaItem(todayEvent), section: 'calendar' };
    if (cardAlerts.some((alert) => alert.kind === 'overdue')) return { label: 'Regularizar fatura atrasada', text: 'Existe uma fatura vencida com valor em aberto. Confira os detalhes e marque o pagamento quando resolver.', section: 'finance' };
    if (overdueActivity) return { label: 'Resolver atividade atrasada', text: overdueActivity.title, section: 'activities' };
    if (overdueGoal) return { label: 'Retomar uma meta em atraso', text: overdueGoal.title, section: 'goals' };
    return { label: 'Tudo certo para hoje', text: 'Nenhuma ação urgente apareceu para o dia atual.', section: 'dashboard' };
  }

  function buildAgendaBuckets(state, snapshot, cardAlerts) {
    const today = dateKey(new Date());
    const weekEnd = dateKey(addDays(new Date(), 6));
    const normalized = (snapshot.agenda || []).filter((item) => !item.completed);
    const overdueItems = [
      ...getOverdueActivityItems(state, today),
      ...getOverdueFinanceItems(cardAlerts),
    ].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || (a.title || '').localeCompare(b.title || ''));
    const monthlyGoalDeadlines = getGoalDeadlineAttentionItems(snapshot.goals, today);
    const attentionBase = normalized.filter((item) => {
      const itemDate = toDate(item.date);
      const itemKey = itemDate ? dateKey(itemDate) : '';
      const todayDate = toDate(today) || new Date();
      if (!itemKey || itemKey < today) return false;
      if (item.source === 'workout') return !item.completed && itemKey <= weekEnd;
      if (item.source === 'goal') return itemDate.getFullYear() === todayDate.getFullYear() && itemDate.getMonth() === todayDate.getMonth();
      return item.source === 'finance' || (item.source === 'activity' && item.priority === 'high');
    });
    const attentionMap = new Map();
    [...attentionBase, ...monthlyGoalDeadlines].forEach((item) => {
      const key = item.recordId ? `${item.source}:${item.recordId}` : `${item.source}:${item.id || item.title}:${dateKey(item.date)}`;
      if (!attentionMap.has(key)) attentionMap.set(key, item);
    });
    const attention = [...attentionMap.values()]
      .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.title || '').localeCompare(String(b.title || '')))
      .slice(0, 6);
    const todayItems = normalized.filter((item) => dateKey(item.date) === today).slice(0, 4);
    const weekItems = normalized.filter((item) => dateKey(item.date) > today && dateKey(item.date) <= weekEnd).slice(0, 4);
    return { attention, todayItems, weekItems, overdueItems: overdueItems.slice(0, 4) };
  }

  function renderBucket(title, items, emptyText) {
    return `
      <article class="dashboard-action-bucket">
        <strong>${escapeHtml(title)}</strong>
        <ul>
          ${items.map((item) => `<li><span>${escapeHtml(item.title)}</span><small>${escapeHtml(getAgendaMetaLabel(item))}</small></li>`).join('') || `<li><span>${escapeHtml(emptyText)}</span></li>`}
        </ul>
      </article>
    `;
  }

  function render(state) {
    if (!root) return;
    const snapshot = buildDashboardSnapshot(state);
    const cardAlerts = buildCreditCardAlerts(state);
    const doneToday = snapshot.todayActivities.filter((item) => item.occurrenceDone).length;
    const totalToday = snapshot.todayActivities.length;
    const completionToday = totalToday ? Math.round((doneToday / totalToday) * 100) : 0;
    const readingNow = snapshot.reading.filter((book) => book.status === 'Lendo');
    const nextBook = readingNow[0] || snapshot.reading[0] || null;
    const nextSubject = snapshot.studies[0] || null;
    const pendingTodos = nextSubject ? nextSubject.todos.filter((item) => !item.done).length : 0;
    const today = dateKey(new Date());
    const todayAgenda = snapshot.todayAgenda || [];
    const weekAgenda = snapshot.agenda || [];
    const visibleWeekAgenda = weekAgenda.filter((item) => {
      const itemDate = toDate(item.date);
      const itemKey = itemDate ? dateKey(itemDate) : '';
      if (!itemKey || itemKey < today) return false;
      if (item.source === 'workout' && item.completed) return false;
      return true;
    });
    const agendaCount = todayAgenda.length;
    const activeGoals = snapshot.goals.filter((goal) => goal.cycle.progress < 100).length;
    const nextGoal = snapshot.goals[0] || null;
    const todayWorkouts = (state.workouts || []).filter((workout) => dateKey(workout.date) === dateKey(new Date()));
    const pendingTodayWorkouts = todayWorkouts.filter((workout) => !workout.completed);
    const dailySummaryItems = buildDailySummaryItems(state, snapshot, cardAlerts);
    const nextAction = buildNextAction(state, snapshot, cardAlerts);
    const agendaBuckets = buildAgendaBuckets(state, snapshot, cardAlerts);
    const cards = [];

    const heroCard = renderAccordionCard({
      eyebrow: 'Seu dia de hoje',
      title: 'O que merece sua atenção agora',
      meta: dailySummaryItems.length ? `${dailySummaryItems.length} aviso(s)` : 'Sem pendências importantes',
      open: true,
      size: 'hero',
      body: `
        <ul class="dashboard-day-summary-list">
          ${dailySummaryItems.map((item) => `<li>${escapeHtml(item)}</li>`).join('') || '<li>Nenhum aviso importante para hoje.</li>'}
        </ul>
        <div class="dashboard-next-action-card">
          <div>
            <span class="eyebrow">Próximo passo sugerido</span>
            <strong>${escapeHtml(nextAction.label)}</strong>
            <p>${escapeHtml(nextAction.text)}</p>
          </div>
          ${nextAction.section !== 'dashboard' ? `<button type="button" class="btn btn-primary" data-go-section="${nextAction.section}">Ver agora</button>` : ''}
        </div>
        <div class="dashboard-action-buckets">
          ${renderBucket('Hoje', agendaBuckets.todayItems, 'Nada pendente para hoje.')}
          ${renderBucket('Esta semana', agendaBuckets.weekItems, 'Nenhum item pendente nos próximos dias.')}
          ${renderBucket('Atrasadas', agendaBuckets.overdueItems, 'Nenhum item atrasado.')}
          ${renderBucket('Precisa de atenção', agendaBuckets.attention, 'Nenhum item importante no momento.')}
        </div>
        <div class="summary-quick-grid">
          <article class="summary-line-card"><span class="label">Atividades</span><strong>${doneToday}/${totalToday}</strong><small>${completionToday}% concluído hoje</small></article>
          <article class="summary-line-card"><span class="label">Estudos</span><strong>${nextSubject ? escapeHtml(nextSubject.name) : 'Nenhuma matéria'}</strong><small>${nextSubject ? `${pendingTodos} tarefa(s) pendente(s)` : 'Cadastre matérias para acompanhar tarefas e prazos.'}</small></article>
          <article class="summary-line-card"><span class="label">Treinos</span><strong>${todayWorkouts.length ? (pendingTodayWorkouts.length ? `${pendingTodayWorkouts.length} pendente(s)` : 'Em dia') : 'Nenhum treino'}</strong><small>${todayWorkouts.length ? todayWorkouts.map((workout) => escapeHtml(workout.title)).slice(0, 2).join(' · ') : 'Crie um treino de hoje para acompanhar pelo painel.'}</small></article>
          <article class="summary-line-card"><span class="label">Cartões</span><strong>${cardAlerts.length ? `${cardAlerts.length} aviso(s)` : 'Sem avisos'}</strong><small>${cardAlerts.length ? cardAlerts.map((alert) => escapeHtml(alert.card.name)).slice(0, 2).join(' · ') : 'Aqui aparecem lembretes dos seus cartões de crédito ativos.'}</small></article>
        </div>
      `,
    });

    if (preference.activities && snapshot.todayActivities.length) cards.push(renderAccordionCard({
      eyebrow: 'Atividades',
      title: 'Suas atividades de hoje',
      meta: `${doneToday}/${totalToday} concluída(s)`,
      body: `
        <div class="metric-card"><span class="label">Andamento de hoje</span><strong>${doneToday}/${totalToday}</strong></div>
        <div class="progress"><span style="width:${completionToday}%"></span></div>
        ${itemList(snapshot.todayActivities.slice(0, 5), (item) => `
          <li class="agenda-item">
            <div class="item-meta"><span class="tag ${(item.priority || 'medium')}">Prioridade ${PRIORITY_LABEL[item.priority || 'medium']}</span>${item.category ? `<span class="chip">${escapeHtml(item.category)}</span>` : ''}</div>
            <strong>${escapeHtml(item.title)}</strong>
            <div class="item-meta"><span class="tag ${item.occurrenceDone ? 'success' : 'medium'}">${item.occurrenceDone ? 'Concluída' : 'Pendente'}</span></div>
          </li>
        `, 'Nenhuma atividade cadastrada para hoje', 'Quando você cadastrar atividades para hoje, elas aparecerão aqui para acompanhar o que já foi concluído e o que ainda falta fazer.')}
      `,
    }));

    if (preference.goals && snapshot.goals.length) cards.push(renderAccordionCard({
      eyebrow: 'Metas',
      title: 'Metas que você está acompanhando',
      meta: `${activeGoals} ativa(s)`,
      body: itemList(snapshot.goals.slice(0, 4), (goal) => `
        <li class="agenda-item">
          <strong>${escapeHtml(goal.title)}</strong>
          <div class="item-meta"><span class="chip">${goal.period === 'monthly' ? 'Mensal' : 'Semanal'}</span><span class="tag">${goal.cycle.progress}%</span></div>
          <div class="progress"><span style="width:${goal.cycle.progress}%"></span></div>
        </li>
      `, 'Nenhuma meta ativa no momento', 'Crie metas semanais ou mensais para acompanhar sua evolução passo a passo.')
    }));

    if (preference.studies && snapshot.studies.length) cards.push(renderAccordionCard({
      eyebrow: 'Estudos',
      title: 'Matérias e tarefas de estudo',
      meta: `${snapshot.studies.length} matéria(s)`,
      body: itemList(snapshot.studies.slice(0, 4), (subject) => `
        <li class="agenda-item">
          <strong>${escapeHtml(subject.name)}</strong>
          <div class="item-meta">${subject.area ? `<span class="chip">${escapeHtml(subject.area)}</span>` : ''}<span class="chip">${subject.todos.filter((todo) => !todo.done).length} pendente(s)</span><span class="tag">${subject.progress}%</span></div>
          <div class="progress"><span style="width:${subject.progress}%"></span></div>
        </li>
      `, 'Nenhuma matéria cadastrada ainda', 'Cadastre suas matérias para organizar tarefas, prazos, anotações e acompanhar sua evolução nos estudos.')
    }));

    if (preference.finance && (snapshot.finance.length || cardAlerts.length)) {
      const financeTotals = snapshot.finance.reduce((acc, entry) => {
        const amount = Number(entry.amount) || 0;
        const rawFlow = String(entry.flowType || entry.entryType || entry.type || '').toLowerCase();
        const rawStatus = String(entry.status || '').toLowerCase();
        const isIncome = ['income', 'receita', 'entrada', 'receivable', 'receive', 'a receber'].includes(rawFlow);
        const isDone = rawStatus === 'paid' || rawStatus === 'pago' || rawStatus === 'received' || rawStatus === 'recebido' || entry.paid === true || entry.received === true;
        if (isIncome) {
          if (isDone) acc.received += amount;
          else acc.toReceive += amount;
        } else {
          acc.totalSpent += amount;
          if (isDone) acc.paid += amount;
          else acc.toPay += amount;
        }
        return acc;
      }, { totalSpent: 0, paid: 0, toPay: 0, received: 0, toReceive: 0 });
      cards.push(renderAccordionCard({
        eyebrow: 'Finanças',
        title: 'Resumo das suas finanças no mês',
        meta: `${snapshot.finance.length} lançamento(s)`,
        body: `
          <div class="dashboard-finance-summary">
            <article class="dashboard-finance-total"><span>Gastos do mês</span><strong>${formatCurrency(financeTotals.totalSpent)}</strong></article>
            <article><span>Valor já pago</span><strong>${formatCurrency(financeTotals.paid)}</strong></article>
            <article><span>Valor a pagar</span><strong>${formatCurrency(financeTotals.toPay)}</strong></article>
            ${financeTotals.toReceive > 0 ? `<article><span>Valor a receber</span><strong>${formatCurrency(financeTotals.toReceive)}</strong></article>` : ''}
            ${financeTotals.received > 0 ? `<article><span>Valor recebido</span><strong>${formatCurrency(financeTotals.received)}</strong></article>` : ''}
          </div>
          ${cardAlerts.length ? `<ul class="dashboard-mini-alerts">${cardAlerts.map((alert) => {
              if (alert.kind === 'closing') return `<li>A fatura do cartão ${escapeHtml(alert.card.name)} fecha hoje. Revise seus gastos para se planejar.</li>`;
              if (alert.kind === 'overdue') return `<li>A fatura do cartão ${escapeHtml(alert.card.name)} está atrasada${alert.amount > 0 ? ` e ainda tem ${formatCurrency(alert.amount)} em aberto.` : '.'}</li>`;
              return `<li>A fatura do cartão ${escapeHtml(alert.card.name)} vence hoje${alert.amount > 0 ? ` com ${formatCurrency(alert.amount)} em compras.` : '.'}</li>`;
            }).join('')}</ul>` : '<p class="module-subtitle">Nenhum lembrete de cartão para hoje.</p>'}
        `,
      }));
    }

    if (preference.workouts) cards.push(renderAccordionCard({
      eyebrow: 'Treinos',
      title: 'Treinos de hoje',
      meta: todayWorkouts.length ? `${pendingTodayWorkouts.length} pendente(s)` : 'Nenhum treino cadastrado',
      body: todayWorkouts.length ? itemList(todayWorkouts.slice(0, 5), (workout) => `
        <li class="agenda-item">
          <strong>${escapeHtml(workout.title || 'Treino sem nome')}</strong>
          <div class="item-meta"><span class="chip">${escapeHtml(getWorkoutTypeLabel(workout))}</span><span class="tag ${workout.completed ? 'success' : 'medium'}">${workout.completed ? 'Concluído' : 'Pendente'}</span></div>
        </li>
      `, 'Nenhum treino planejado para hoje', 'Os treinos planejados para hoje aparecem aqui para você acompanhar e marcar como concluídos.') : createEmptyState('Nenhum treino para hoje', 'Você ainda não cadastrou um treino para hoje. Crie agora para ele aparecer no painel e na área de Treinos.', { label: 'Criar treino agora', action: 'new-workout-from-dashboard', section: 'workouts' })
    }));

    if (preference.reading && readingNow.length) cards.push(renderAccordionCard({
      eyebrow: 'Leitura',
      title: 'Livros que você está lendo',
      meta: `${readingNow.length || snapshot.reading.length} livro(s)`,
      body: itemList(readingNow.slice(0, 4), (book) => `
        <li class="agenda-item">
          <strong>${escapeHtml(book.title)}</strong>
          <div class="item-meta"><span class="chip">${escapeHtml(book.author)}</span><span class="tag medium">${book.pagesRead}/${book.totalPages} páginas</span></div>
          <div class="progress"><span style="width:${book.progress}%"></span></div>
        </li>
      `, 'Nenhuma leitura em andamento', 'Os livros marcados como “Lendo” aparecem aqui com o avanço das páginas lidas.')
    }));

    if (preference.calendar && visibleWeekAgenda.length) cards.push(renderAccordionCard({
      eyebrow: 'Agenda',
      title: 'Compromissos da semana',
      meta: `${visibleWeekAgenda.length} item(ns)`,
      body: itemList(visibleWeekAgenda.slice(0, 6), (item) => `
        <li class="agenda-item">
          <strong>${escapeHtml(item.title)}</strong>
          <div class="item-meta"><span class="chip">${formatDate(item.date, { weekday: 'short', day: '2-digit', month: 'short' })}</span>${getAgendaTimeLabel(item) ? `<span class="chip">${escapeHtml(getAgendaTimeLabel(item))}</span>` : ''}<span class="chip">${escapeHtml(item.type || item.source)}</span></div>
        </li>
      `, 'Nenhum item na agenda', 'Eventos, atividades e datas importantes dos estudos aparecem aqui para ajudar você a planejar a semana.')
    }));

    const cardColumns = cards.length
      ? cards.reduce((columns, card) => {
        const targetIndex = columns[0].length <= columns[1].length ? 0 : 1;
        columns[targetIndex].push(card);
        return columns;
      }, [[], []])
      : [];

    root.innerHTML = `
      <div class="section-shell">
        <div class="section-head">
          <div><span class="eyebrow">Visão geral</span><h3>Painel inicial</h3><p class="module-subtitle">Veja em um só lugar suas tarefas, itens da agenda, metas e lembretes importantes do dia.</p></div>
          <div class="section-actions"><button class="btn btn-secondary" type="button" data-action="customize-dashboard">Escolher blocos do painel</button><button class="btn btn-primary" type="button" data-go-section="activities">Ver minhas atividades</button></div>
        </div>
        <div class="compact-stat-grid mobile-rail mobile-rail-cards">
          <article class="stat-card"><span class="label">Hoje</span><strong>${snapshot.todayLabel}</strong></article>
          <article class="stat-card"><span class="label">Atividades de hoje</span><strong>${doneToday}/${totalToday}</strong><div class="progress"><span style="width:${completionToday}%"></span></div></article>
          <article class="stat-card"><span class="label">Lembretes dos cartões</span><strong>${cardAlerts.length}</strong></article>
          <article class="stat-card"><span class="label">Treinos pendentes</span><strong>${pendingTodayWorkouts.length}</strong></article>
        </div>
        <div class="dashboard-focus-wrap">${heroCard}</div>
        ${cards.length ? `
          <div class="dashboard-card-columns">
            ${cardColumns.map((column) => `<div class="dashboard-card-column">${column.join('')}</div>`).join('')}
          </div>
        ` : createEmptyState('Seu painel está limpo agora', 'Quando houver atividades, metas, estudos, vencimentos ou compromissos, eles aparecerão aqui.', { label: 'Criar atividade', section: 'activities' })}
      </div>
    `;
  }

  function init(element) {
    root = element;
    root.addEventListener('click', (event) => {
      const workoutButton = event.target.closest('[data-action="new-workout-from-dashboard"]');
      if (workoutButton) {
        const opened = window.__CONTROLY_OPENERS?.workouts?.({ action: 'new-workout' });
        if (opened) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }
      const button = event.target.closest('[data-action="customize-dashboard"]');
      if (button) openWidgetConfig();
    });
  }

  return { id: 'dashboard', init, render };
}

