import { closeModal, confirmDialog, icon, openModal, showToast, showUndoToast, createEmptyState } from './ui.js';
import { deleteRecord, patchRecord, restoreDeletedRecord, saveRecord } from './store.js';
import { getGoalViews } from './domain.js';
import { state as appState } from './state.js';
import { addDays, cleanObjectForWrite, dateKey, daysBetween, escapeHtml, formatDate, formatMonthLabel, monthKey, toDate, toInputDateValue } from './utils.js';

function groupByMonth(goals) {
  const groups = new Map();
  goals.forEach((goal) => {
    const scheduleType = normalizeGoalScheduleType(goal);
    if (!['deadline', 'duration', 'legacy'].includes(scheduleType)) return;
    const referenceDate = goal.endDate || goal.finishDate || goal.untilDate || goal.cycle?.end || goal.startDate || new Date();
    const key = monthKey(referenceDate);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(goal);
  });
  return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

function formatGoalAmount(value = 0) {
  const parsed = Number(value) || 0;
  return parsed.toLocaleString('pt-BR', { maximumFractionDigits: Number.isInteger(parsed) ? 0 : 2 });
}

function normalizeGoalType(goal = {}) {
  return goal.targetType === 'linked' ? 'quantity' : (goal.targetType || 'habit');
}

function goalUnit(goal = {}) {
  const type = normalizeGoalType(goal);
  if (type === 'money') return 'reais';
  return goal.unit || 'unidades';
}

function goalTypeChip(goal = {}) {
  const type = normalizeGoalType(goal);
  if (type === 'quantity') return 'Quantidade';
  if (type === 'money') return 'Valor';
  if (type === 'deadline') return 'Prazo';
  return 'Marcar dias';
}

function normalizeGoalScheduleType(goal = {}) {
  const rawType = goal.scheduleType || goal.durationType || '';
  if (rawType === 'recurring' || goal.fixed || (!rawType && (goal.recurrenceCycle || goal.cycleType))) return 'recurring';
  if (rawType === 'open' || goal.noDeadline || goal.openEnded) return 'open';
  if (rawType === 'duration') return 'duration';
  if (rawType === 'deadline') return 'deadline';
  if (goal.endDate || goal.finishDate || goal.untilDate) return 'deadline';
  return 'deadline';
}

function goalScheduleChip(goal = {}) {
  const scheduleType = normalizeGoalScheduleType(goal);
  if (scheduleType === 'open') return 'Sem prazo';
  if (scheduleType === 'recurring') return 'Repete';
  if (scheduleType === 'duration') return 'Prazo em dias';
  return 'Data final';
}

function goalCycleLabel(goal = {}) {
  const cycle = goal.cycle || {};
  const scheduleType = normalizeGoalScheduleType(goal);
  const start = formatDate(cycle.start, { day: '2-digit', month: 'short' });
  const end = formatDate(cycle.end, { day: '2-digit', month: 'short' });
  if (scheduleType === 'open') return `Ativa desde ${start}`;
  if (scheduleType === 'recurring') return `Período atual: ${start} → ${end}`;
  return `Prazo: ${start} → ${end}`;
}

function isGoalFinishedForStats(goal = {}) {
  const scheduleType = normalizeGoalScheduleType(goal);
  return scheduleType !== 'open' && scheduleType !== 'recurring' && Boolean(goal.cycle?.isFinished);
}

function goalTargetText(goal = {}) {
  const type = normalizeGoalType(goal);
  const cycle = goal.cycle || {};
  const target = Number(goal.targetValue || 0) || 0;
  const current = Number(cycle.currentValue || 0) || 0;
  const unit = goalUnit(goal);

  if (type === 'quantity') return `${formatGoalAmount(current)} de ${formatGoalAmount(target)} ${unit}`;
  if (type === 'money') return `R$ ${formatGoalAmount(current)} de R$ ${formatGoalAmount(target)}`;
  if (type === 'deadline') return cycle.isFinished ? 'Concluída' : 'Pendente';
  return `${formatGoalAmount(cycle.done || 0)} de ${formatGoalAmount(cycle.total || 0)} dias`;
}

function goalTargetOnlyText(goal = {}) {
  const type = normalizeGoalType(goal);
  const target = Number(goal.targetValue || 0) || 0;
  const unit = goalUnit(goal);
  if (type === 'quantity') return `${formatGoalAmount(target)} ${unit}`;
  if (type === 'money') return `R$ ${formatGoalAmount(target)}`;
  if (type === 'deadline') return 'Prazo definido';
  return `${formatGoalAmount(goal.cycle?.total || 0)} dias`;
}

function goalProgressText(goal = {}) {
  const type = normalizeGoalType(goal);
  if (type === 'habit' || type === 'quantity' || type === 'money') return goalTargetText(goal);
  return goal.cycle?.isFinished ? 'Concluída' : 'Pendente';
}

function goalProgressMessage(goal = {}) {
  const cycle = goal.cycle || {};
  const type = normalizeGoalType(goal);

  if (type === 'habit') {
    if (cycle.isFinished) return 'Todos os dias deste período foram marcados.';
    return `Você marcou ${formatGoalAmount(cycle.done || 0)} de ${formatGoalAmount(cycle.total || 0)} dias deste período.`;
  }

  if (type === 'quantity') {
    if (cycle.isFinished) return 'Objetivo alcançado neste período.';
    return 'Atualize o total já feito neste período.';
  }

  if (type === 'money') {
    if (cycle.isFinished) return 'Valor alcançado neste período.';
    return 'Atualize o valor já alcançado neste período.';
  }

  if (cycle.isFinished) return 'Meta concluída.';
  return 'Quando terminar, marque esta meta como concluída.';
}

function valueInputStep(goal = {}) {
  return normalizeGoalType(goal) === 'money' ? '0.01' : '1';
}

function valueInputPlaceholder(goal = {}) {
  return normalizeGoalType(goal) === 'money' ? 'Ex.: 500' : 'Ex.: 28';
}

function valueInputLabel(goal = {}) {
  return normalizeGoalType(goal) === 'money' ? 'Valor alcançado neste período' : 'Quantidade feita neste período';
}

export function createGoalsModule() {
  let root;
  const optimisticDailyStatus = new Map();
  const dailyStatusSaveTimers = new Map();

  function requestSilentGoalsUpdate(ttl = 3000) {
    window.__CONTROLY_SILENT_UPDATE?.('goals', 'goals', ttl);
  }

  function cleanDailyStatusMap(status = {}) {
    return Object.fromEntries(Object.entries(status || {}).filter(([key, value]) => /^\d{4}-\d{2}-\d{2}$/.test(key) && Boolean(value)));
  }

  function getRawGoal(goalId) {
    return (appState.goals || []).find((item) => item.id === goalId) || (window.__CONTROLY_STATE?.goals || []).find((item) => item.id === goalId);
  }

  function getGoalWithOptimisticStatus(goalId) {
    const raw = getRawGoal(goalId);
    if (!raw) return null;
    return { ...raw, dailyStatus: optimisticDailyStatus.get(goalId) || raw.dailyStatus || {} };
  }

  function getGoalViewById(goalId) {
    const raw = getGoalWithOptimisticStatus(goalId);
    if (!raw) return null;
    return getGoalViews({ ...(window.__CONTROLY_STATE || appState), goals: [raw] }).find((item) => item.id === goalId) || null;
  }

  function setLocalDailyStatus(goalId, status) {
    const clean = cleanDailyStatusMap(status);
    optimisticDailyStatus.set(goalId, clean);
    const raw = getRawGoal(goalId);
    if (raw) raw.dailyStatus = clean;
    return clean;
  }

  function updateGoalDayDom(goalId, dayKey, done) {
    root?.querySelectorAll(`.goal-day[data-id="${CSS.escape(goalId)}"][data-day="${CSS.escape(dayKey)}"]`).forEach((button) => {
      button.classList.toggle('done', done);
      button.dataset.done = done ? 'true' : 'false';
      button.setAttribute('aria-pressed', done ? 'true' : 'false');
      const checkbox = button.querySelector('.svg-checkbox');
      checkbox?.classList.toggle('is-checked', done);
      const label = button.querySelector('.date-block-check span:last-child');
      if (label) label.textContent = done ? 'Concluído' : 'Pendente';
    });
  }

  function updateGoalSummaryDom(goalId) {
    const view = getGoalViewById(goalId);
    if (!view) return;
    const cycle = view.cycle || {};
    root?.querySelectorAll(`[data-goal-card="${CSS.escape(goalId)}"]`).forEach((card) => {
      const progressText = card.querySelector('[data-goal-progress-text]');
      if (progressText) progressText.textContent = goalProgressText(view);
      const progressTag = card.querySelector('[data-goal-progress-tag]');
      if (progressTag) {
        progressTag.textContent = `${cycle.progress}% concluído`;
        progressTag.classList.toggle('success', Boolean(cycle.isFinished));
        progressTag.classList.toggle('medium', !cycle.isFinished);
      }
      const progressBar = card.querySelector('[data-goal-progress-bar]');
      if (progressBar) progressBar.style.width = `${cycle.progress}%`;
      const message = card.querySelector('[data-goal-message]');
      if (message) message.textContent = goalProgressMessage(view);
    });
  }

  function scheduleGoalDailyStatusSave(goalId) {
    requestSilentGoalsUpdate(3500);
    if (dailyStatusSaveTimers.has(goalId)) clearTimeout(dailyStatusSaveTimers.get(goalId));
    dailyStatusSaveTimers.set(goalId, setTimeout(async () => {
      dailyStatusSaveTimers.delete(goalId);
      const status = optimisticDailyStatus.get(goalId) || getRawGoal(goalId)?.dailyStatus || {};
      try {
        requestSilentGoalsUpdate(3500);
        await patchRecord('goals', goalId, { dailyStatus: cleanDailyStatusMap(status) });
        setTimeout(() => optimisticDailyStatus.delete(goalId), 3500);
      } catch (error) {
        console.error(error);
        showToast('Não foi possível salvar essa marcação. Confira sua conexão e tente novamente.', 'error');
      }
    }, 250));
  }

  function openGoalForm(goal = null) {
    const goalType = normalizeGoalType(goal || {});
    const scheduleType = normalizeGoalScheduleType(goal || {});
    const startValue = toInputDateValue(goal?.startDate || new Date());
    const cycleEndValue = toInputDateValue(goal?.endDate || goal?.cycle?.end || addDays(startValue || new Date(), 30));
    const durationValue = Number(goal?.durationDays || (goal?.startDate && goal?.endDate ? Math.max(1, daysBetween(goal.startDate, goal.endDate)) : 30));
    const recurrenceCycleValue = goal?.recurrenceCycle || goal?.cycleType || (goal?.period === 'weekly' ? 'weekly' : goal?.period === 'custom' ? 'custom' : 'monthly');
    openModal({
      title: goal ? 'Editar meta' : 'Criar nova meta',
      eyebrow: 'Planejamento das suas metas',
      body: `
        <form id="goal-form" class="stack-form">
          <div class="goal-help-box">
            <strong>Antes de salvar</strong>
            <p>Defina o que será acompanhado e quando a meta termina. Metas com prazo aparecem no mês final e também no calendário da data final.</p>
          </div>
          <label class="field"><span>Nome da meta</span><input class="input" name="title" value="${escapeHtml(goal?.title || '')}" placeholder="Ex.: Ler todos os dias até o fim de maio" required /></label>
          <div class="inline-fields">
            <label class="field"><span>Categoria</span><input class="input" name="category" value="${escapeHtml(goal?.category || '')}" placeholder="Ex.: Saúde, Estudos, Leitura" /></label>
            <label class="field"><span>Data de início</span><input class="input" type="date" name="startDate" id="goal-start-date" value="${escapeHtml(startValue)}" required /></label>
          </div>
          <details class="section-accordion compact-advanced-options" open>
            <summary><div class="section-accordion-head"><strong>Como acompanhar</strong><div class="section-accordion-meta"><span class="chip">Configuração</span></div></div></summary>
            <div class="section-accordion-body">
              <div class="inline-fields">
                <label class="field"><span>Tipo de acompanhamento</span><select class="select" name="targetType" id="goal-target-type">
                  ${[
                    ['habit','Marcar os dias em que fiz'],
                    ['quantity','Acompanhar uma quantidade'],
                    ['money','Acompanhar um valor'],
                    ['deadline','Marcar quando terminar'],
                  ].map(([value,label]) => `<option value="${value}" ${goalType === value ? 'selected' : ''}>${label}</option>`).join('')}
                </select></label>
                <label class="field" id="goal-target-field"><span id="goal-target-label">Objetivo</span><input class="input" type="number" step="0.01" min="0" name="targetValue" value="${goal?.targetValue || ''}" placeholder="Ex.: 30" /></label>
              </div>
              <div class="inline-fields">
                <label class="field" id="goal-unit-field"><span>O que será contado?</span><input class="input" name="unit" value="${escapeHtml(goal?.unit || '')}" placeholder="Ex.: páginas, horas, treinos" /></label>
                <div class="muted-box" id="goal-type-help"></div>
              </div>
            </div>
          </details>
          <details class="section-accordion compact-advanced-options" open>
            <summary><div class="section-accordion-head"><strong>Prazo da meta</strong><div class="section-accordion-meta"><span class="chip" id="goal-schedule-summary">${escapeHtml(goalScheduleChip(goal || {}))}</span></div></div></summary>
            <div class="section-accordion-body">
              <div class="inline-fields">
                <label class="field"><span>Prazo da meta</span><select class="select" name="scheduleType" id="goal-schedule-type">
                  <option value="deadline" ${scheduleType === 'deadline' ? 'selected' : ''}>Termina em uma data</option>
                  <option value="duration" ${scheduleType === 'duration' ? 'selected' : ''}>Termina após uma quantidade de dias</option>
                  <option value="recurring" ${scheduleType === 'recurring' ? 'selected' : ''}>Repetir sem data final</option>
                  <option value="open" ${scheduleType === 'open' ? 'selected' : ''}>Sem prazo definido</option>
                </select></label>
                <label class="field goal-schedule-field" data-schedule-field="deadline"><span>Data final</span><input class="input" type="date" name="endDate" id="goal-end-date" value="${escapeHtml(cycleEndValue)}" /></label>
                <label class="field goal-schedule-field" data-schedule-field="duration"><span>Prazo em dias</span><input class="input" type="number" min="1" step="1" name="durationDays" id="goal-duration-days" value="${durationValue}" placeholder="Ex.: 30" /></label>
              </div>
              <div class="inline-fields goal-schedule-field" data-schedule-field="recurring">
                <label class="field"><span>Cada período dura</span><select class="select" name="recurrenceCycle" id="goal-recurrence-cycle">
                  <option value="weekly" ${recurrenceCycleValue === 'weekly' ? 'selected' : ''}>1 semana</option>
                  <option value="monthly" ${recurrenceCycleValue === 'monthly' ? 'selected' : ''}>1 mês</option>
                  <option value="custom" ${recurrenceCycleValue === 'custom' ? 'selected' : ''}>Uma quantidade de dias</option>
                </select></label>
                <label class="field" id="goal-cycle-days-field"><span>Dias por período</span><input class="input" type="number" min="1" step="1" name="cycleDays" value="${Number(goal?.cycleDays || goal?.durationDays || 30)}" placeholder="Ex.: 30" /></label>
              </div>
              <div class="goal-schedule-preview muted-box" id="goal-schedule-help"></div>
            </div>
          </details>
          <label class="field"><span>Observações</span><textarea class="textarea" name="notes" placeholder="Registre informações importantes sobre esta meta.">${escapeHtml(goal?.notes || '')}</textarea></label>
          <div class="inline-actions">
            <button type="button" id="goal-form-cancel" class="btn btn-secondary">Cancelar</button>
            <button type="submit" class="btn btn-primary">${goal ? 'Salvar meta' : 'Criar meta'}</button>
          </div>
        </form>
      `,
    });
    const targetTypeSelect = document.getElementById('goal-target-type');
    const targetField = document.getElementById('goal-target-field');
    const targetLabel = document.getElementById('goal-target-label');
    const unitField = document.getElementById('goal-unit-field');
    const helpBox = document.getElementById('goal-type-help');
    const scheduleTypeSelect = document.getElementById('goal-schedule-type');
    const scheduleSummary = document.getElementById('goal-schedule-summary');
    const scheduleHelp = document.getElementById('goal-schedule-help');
    const startInput = document.getElementById('goal-start-date');
    const endInput = document.getElementById('goal-end-date');
    const durationInput = document.getElementById('goal-duration-days');
    const recurrenceCycleSelect = document.getElementById('goal-recurrence-cycle');
    const cycleDaysField = document.getElementById('goal-cycle-days-field');

    const addDaysToInputDate = (value, amount) => {
      const date = toDate(value) || new Date();
      return dateKey(addDays(date, Number(amount || 0)));
    };

    const syncGoalTypeFields = () => {
      const type = targetTypeSelect?.value || 'habit';
      const needsTarget = type === 'quantity' || type === 'money';
      targetField?.classList.toggle('hidden', !needsTarget);
      unitField?.classList.toggle('hidden', type !== 'quantity');
      if (targetLabel) targetLabel.textContent = type === 'money' ? 'Valor que deseja alcançar' : 'Quantidade desejada';
      const targetInput = targetField?.querySelector('input[name="targetValue"]');
      if (targetInput) targetInput.placeholder = type === 'money' ? 'Ex.: 500' : 'Ex.: 30';
      if (helpBox) {
        helpBox.textContent = type === 'habit'
          ? 'Marque os dias em que a meta foi cumprida. Ex.: leitura, treino ou estudo.'
          : type === 'quantity'
            ? 'Acompanhe um número até chegar ao objetivo. Ex.: páginas lidas, horas estudadas ou questões resolvidas.'
            : type === 'money'
              ? 'Acompanhe valores recebidos, guardados ou pagos até atingir o objetivo.'
              : 'Registre quando a meta for concluída. Ex.: entregar um trabalho ou concluir uma inscrição.';
      }
    };

    const syncScheduleFields = () => {
      const type = scheduleTypeSelect?.value || 'deadline';
      document.querySelectorAll('.goal-schedule-field').forEach((field) => {
        const modes = String(field.dataset.scheduleField || '').split(' ');
        field.classList.toggle('hidden', !modes.includes(type));
      });
      cycleDaysField?.classList.toggle('hidden', recurrenceCycleSelect?.value !== 'custom');
      if (scheduleSummary) {
        scheduleSummary.textContent = type === 'open' ? 'Sem prazo definido' : type === 'recurring' ? 'Repetição contínua' : type === 'duration' ? 'Prazo em dias' : 'Data final';
      }
      if (scheduleHelp) {
        const start = startInput?.value || dateKey(new Date());
        const days = Number(durationInput?.value || 0);
        const calculatedEnd = days > 0 ? addDaysToInputDate(start, days) : '';
        scheduleHelp.textContent = type === 'open'
          ? 'A meta permanece ativa sem data de encerramento.'
          : type === 'recurring'
            ? 'A meta cria um novo período automaticamente e não tem data final.'
            : type === 'duration'
              ? `A data final será calculada pela data de início. Ex.: começando em ${start || 'hoje'} por ${days || 'X'} dias, termina em ${calculatedEnd || 'uma data calculada'}.`
              : 'A meta fica registrada no mês do prazo e aparece no calendário nesse dia.';
      }
    };

    targetTypeSelect?.addEventListener('change', syncGoalTypeFields);
    scheduleTypeSelect?.addEventListener('change', syncScheduleFields);
    recurrenceCycleSelect?.addEventListener('change', syncScheduleFields);
    startInput?.addEventListener('change', syncScheduleFields);
    durationInput?.addEventListener('input', syncScheduleFields);
    syncGoalTypeFields();
    syncScheduleFields();

    document.getElementById('goal-form-cancel').addEventListener('click', closeModal);
    document.getElementById('goal-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const targetType = data.get('targetType') || 'habit';
      const targetValue = Number(data.get('targetValue')) || 0;
      const unit = data.get('unit')?.trim();
      const scheduleType = data.get('scheduleType') || 'deadline';
      const startDate = data.get('startDate');
      const durationDays = Math.max(0, Number(data.get('durationDays') || 0));
      const recurrenceCycle = data.get('recurrenceCycle') || 'monthly';
      const cycleDays = Math.max(0, Number(data.get('cycleDays') || 0));
      let endDate = data.get('endDate') || '';
      let period = 'custom';

      if (!data.get('title')?.trim()) {
        showToast('Informe um nome para a meta antes de salvar.', 'error');
        return;
      }
      if (!startDate) {
        showToast('Escolha a data de início da meta.', 'error');
        return;
      }
      if ((targetType === 'quantity' || targetType === 'money') && targetValue <= 0) {
        showToast('Informe o objetivo da meta antes de salvar.', 'error');
        return;
      }

      if (scheduleType === 'deadline') {
        if (!endDate) {
          showToast('Escolha a data final da meta.', 'error');
          return;
        }
        if (toDate(endDate) < toDate(startDate)) {
          showToast('A data final precisa ser igual ou depois da data de início.', 'error');
          return;
        }
      }

      if (scheduleType === 'duration') {
        if (durationDays <= 0) {
          showToast('Informe depois de quantos dias esta meta deve terminar.', 'error');
          return;
        }
        endDate = addDaysToInputDate(startDate, durationDays);
      }

      if (scheduleType === 'recurring') {
        if (recurrenceCycle === 'custom' && cycleDays <= 0) {
          showToast('Informe quantos dias cada período deve durar.', 'error');
          return;
        }
        endDate = '';
        period = recurrenceCycle === 'weekly' ? 'weekly' : recurrenceCycle === 'monthly' ? 'monthly' : 'custom';
      }

      if (scheduleType === 'open') {
        endDate = '';
        period = 'open';
      }

      const normalizedTargetValue = (targetType === 'quantity' || targetType === 'money') ? targetValue : 0;
      const payload = {
        title: data.get('title')?.trim(),
        category: data.get('category')?.trim(),
        targetType,
        targetValue: normalizedTargetValue,
        currentValue: Number(goal?.currentValue || 0),
        cycleValues: goal?.cycleValues || {},
        unit: targetType === 'money' ? (unit || 'reais') : (targetType === 'quantity' ? unit : ''),
        linkedModule: '',
        linkedArea: '',
        period,
        scheduleType,
        startDate,
        endDate,
        durationDays: scheduleType === 'duration' ? durationDays : 0,
        recurrenceCycle: scheduleType === 'recurring' ? recurrenceCycle : '',
        cycleDays: scheduleType === 'recurring' && recurrenceCycle === 'custom' ? cycleDays : 0,
        recurrenceEndDate: '',
        repeatUntil: '',
        fixed: scheduleType === 'recurring',
        noDeadline: scheduleType === 'open',
        notes: data.get('notes')?.trim(),
        dailyStatus: goal?.dailyStatus || {},
        completedCycles: goal?.completedCycles || {},
      };

      try {
        const previous = goal ? cleanObjectForWrite(goal) : null;
        await saveRecord('goals', payload, goal?.id || null);
        closeModal();
        if (goal && previous) showUndoToast('Meta atualizada. Você pode desfazer esta alteração.', () => saveRecord('goals', previous, goal.id));
        else showToast(payload.deadline ? 'Meta criada. O prazo também aparecerá no calendário.' : 'Meta criada. Você pode acompanhar seu progresso com mais clareza.');
      } catch (error) {
        console.error(error);
        showToast('Não foi possível salvar a meta. Confira as informações e tente novamente.', 'error');
      }
    });
  }

  async function toggleDay(goal, day) {
    const currentGoal = getGoalWithOptimisticStatus(goal.id) || goal;
    const previousStatus = cleanDailyStatusMap(currentGoal.dailyStatus || {});
    const nextStatus = { ...previousStatus };
    const nextDone = !Boolean(nextStatus[day.key]);
    if (nextDone) nextStatus[day.key] = true;
    else delete nextStatus[day.key];

    setLocalDailyStatus(goal.id, nextStatus);
    updateGoalDayDom(goal.id, day.key, nextDone);
    updateGoalSummaryDom(goal.id);
    scheduleGoalDailyStatusSave(goal.id);

    showUndoToast(nextDone ? 'Dia marcado como concluído.' : 'Dia voltou para pendente.', () => {
      setLocalDailyStatus(goal.id, previousStatus);
      updateGoalDayDom(goal.id, day.key, Boolean(previousStatus[day.key]));
      updateGoalSummaryDom(goal.id);
      return patchRecord('goals', goal.id, { dailyStatus: previousStatus });
    });
  }

  async function updateGoalProgress(goal, rawValue) {
    const cycleKey = goal.cycle?.key;
    if (!cycleKey) {
      showToast('Não foi possível identificar o período desta meta. Tente novamente.', 'error');
      return;
    }

    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed) || parsed < 0) {
      showToast('Informe um valor válido para atualizar a meta.', 'error');
      return;
    }

    const previousCycleValues = goal.cycleValues || {};
    const previousCurrentValue = Number(goal.currentValue || 0);

    try {
      await patchRecord('goals', goal.id, {
        [`cycleValues.${cycleKey}`]: parsed,
        currentValue: parsed,
      });
      showUndoToast('Progresso atualizado.', () => patchRecord('goals', goal.id, {
        cycleValues: previousCycleValues,
        currentValue: previousCurrentValue,
      }));
    } catch (error) {
      console.error(error);
      showToast('Não foi possível atualizar esta meta. Tente novamente.', 'error');
    }
  }

  async function toggleGoalCompletion(goal) {
    const cycleKey = goal.cycle?.key;
    if (!cycleKey) {
      showToast('Não foi possível identificar o período desta meta. Tente novamente.', 'error');
      return;
    }

    const completed = Boolean(goal.cycle?.isFinished);
    const nextCompleted = !completed;
    const previousCycles = goal.completedCycles || {};
    const payload = {
      [`completedCycles.${cycleKey}`]: nextCompleted,
    };

    try {
      await patchRecord('goals', goal.id, payload);
      showUndoToast(nextCompleted ? 'Meta concluída.' : 'Meta reaberta.', () => patchRecord('goals', goal.id, {
        completedCycles: previousCycles,
      }));
    } catch (error) {
      console.error(error);
      showToast('Não foi possível atualizar esta meta. Tente novamente.', 'error');
    }
  }

  async function handleDelete(goalId) {
    const confirmed = await confirmDialog({ title: 'Excluir meta', description: 'Esta meta será enviada para a lixeira e poderá ser restaurada por 7 dias antes de ser apagada definitivamente.', confirmLabel: 'Enviar para a lixeira' });
    if (!confirmed) return;
    try {
      const result = await deleteRecord('goals', goalId);
      showUndoToast('Meta enviada para a lixeira. Você pode restaurar se precisar.', () => result?.trashId ? restoreDeletedRecord(result.trashId) : Promise.resolve());
    } catch (error) {
      console.error(error);
      showToast('Não foi possível excluir a meta. Tente novamente.', 'error');
    }
  }

  function goalProgressControls(goal) {
    const type = normalizeGoalType(goal);
    const cycle = goal.cycle || {};

    if (type === 'quantity' || type === 'money') {
      return `
        <form class="goal-progress-form stack-form" data-action="update-goal-progress" data-id="${goal.id}">
          <div class="inline-fields">
            <label class="field"><span>${valueInputLabel(goal)}</span><input class="input" type="number" min="0" step="${valueInputStep(goal)}" name="currentValue" value="${Number(cycle.currentValue || 0)}" placeholder="${valueInputPlaceholder(goal)}" /></label>
            <label class="field"><span>Objetivo</span><input class="input" value="${escapeHtml(goalTargetOnlyText(goal))}" disabled /></label>
          </div>
          <div class="inline-actions">
            <button type="submit" class="btn btn-primary">Salvar progresso</button>
          </div>
        </form>
      `;
    }

    if (type === 'deadline') {
      const completed = Boolean(cycle.isFinished);
      return `
        <div class="inline-actions">
          <button type="button" class="btn ${completed ? 'btn-secondary' : 'btn-primary'}" data-action="toggle-goal-complete" data-id="${goal.id}">${icon(completed ? 'rotate-ccw' : 'check-circle-2', completed ? 'Reabrir meta' : 'Concluir meta')}${completed ? 'Reabrir meta' : 'Concluir meta'}</button>
        </div>
      `;
    }

    return `
      <details class="goal-days-accordion">
        <summary><strong>${normalizeGoalScheduleType(goal) === 'recurring' ? 'Dias do período atual' : normalizeGoalScheduleType(goal) === 'open' ? 'Dias marcados' : 'Dias da meta'}</strong><span class="chip">Marcar dias feitos</span></summary>
        <div class="goal-days-grid">
          ${cycle.days.map((day, index) => `
            <button type="button" class="goal-day date-block-card ${day.done ? 'done' : ''}" title="Marcar ou desmarcar este dia" aria-label="Marcar ou desmarcar este dia" aria-pressed="${day.done ? 'true' : 'false'}" data-action="toggle-goal-day" data-id="${goal.id}" data-day="${day.key}" data-done="${day.done ? 'true' : 'false'}">
              <span class="date-block-title">${icon('calendar-days', 'Data da meta')}<span>Data</span></span>
              <span class="date-block-value">
                <strong>${formatDate(day.date, { day: '2-digit', month: '2-digit' })}</strong>
                <small>Dia ${index + 1}</small>
              </span>
              <span class="date-block-check"><span class="svg-checkbox ${day.done ? 'is-checked' : ''}"></span><span>${day.done ? 'Concluído' : 'Pendente'}</span></span>
            </button>
          `).join('')}
        </div>
      </details>
    `;
  }

  function goalCard(goal, open = false) {
    const cycle = goal.cycle || {};
    const type = normalizeGoalType(goal);
    const canReset = type === 'habit';
    return `
      <details class="section-accordion ${open ? 'month-goal-open' : ''}" ${open ? 'open' : ''} data-search-id="goals:${goal.id}" data-goal-card="${goal.id}">
        <summary>
          <div class="section-accordion-head">
            <div class="goal-card-summary">
              <div>
                <strong>${escapeHtml(goal.title)}</strong>
                <div class="section-accordion-meta">
                  <span class="chip">${escapeHtml(goalTypeChip(goal))}</span>
                  ${goal.category ? `<span class="chip">${escapeHtml(goal.category)}</span>` : ''}
                  <span class="tag ${normalizeGoalScheduleType(goal) === 'recurring' ? 'success' : 'medium'}">${escapeHtml(goalScheduleChip(goal))}</span>
                  <span class="tag" data-goal-progress-text>${escapeHtml(goalProgressText(goal))}</span>
                </div>
              </div>
            </div>
          </div>
        </summary>
        <div class="section-accordion-body">
          <div class="item-top">
            <div class="task-meta">
              <span class="chip">${escapeHtml(goalCycleLabel(goal))}</span>
              <span class="tag ${cycle.isFinished ? 'success' : 'medium'}" data-goal-progress-tag>${cycle.progress}% concluído</span>
            </div>
            <div class="goal-card-actions inline-actions">
              <button type="button" class="icon-btn small" title="Editar meta" aria-label="Editar meta" data-action="edit-goal" data-id="${goal.id}">${icon('pencil-line', 'Editar meta')}</button>
              ${canReset ? `<button type="button" class="icon-btn small" title="Zerar dias marcados" aria-label="Zerar dias marcados" data-action="reset-goal" data-id="${goal.id}">${icon('rotate-ccw', 'Zerar dias marcados')}</button>` : ''}
              <button type="button" class="icon-btn small" title="Excluir meta" aria-label="Excluir meta" data-action="delete-goal" data-id="${goal.id}">${icon('trash-2', 'Excluir meta')}</button>
            </div>
          </div>
          <div class="progress"><span data-goal-progress-bar style="width:${cycle.progress}%"></span></div>
          <p class="module-subtitle" data-goal-message>${escapeHtml(goalProgressMessage(goal))}</p>
          ${goal.notes ? `<p class="module-subtitle">${escapeHtml(goal.notes)}</p>` : ''}
          ${goalProgressControls(goal)}
        </div>
      </details>
    `;
  }

  function renderGoalListGroup(title, description, items, open = true) {
    if (!items.length) return '';
    return `
      <details class="section-accordion month-accordion" ${open ? 'open' : ''}>
        <summary>
          <div class="section-accordion-head">
            <div>
              <strong>${escapeHtml(title)}</strong>
              ${description ? `<p class="module-subtitle">${escapeHtml(description)}</p>` : ''}
            </div>
            <div class="section-accordion-meta"><span class="chip">${items.length} ${items.length === 1 ? 'meta' : 'metas'}</span></div>
          </div>
        </summary>
        <div class="section-accordion-body">
          <div class="kanban-stack">${items.map((goal) => goalCard(goal, open)).join('')}</div>
        </div>
      </details>
    `;
  }

  function renderMonthGroup(title, groups, currentMonthValue) {
    return groups.map(([key, items]) => {
      const open = key === currentMonthValue;
      return `
        <details class="section-accordion month-accordion" ${open ? 'open' : ''}>
          <summary>
            <div class="section-accordion-head">
              <strong>${title} · ${escapeHtml(formatMonthLabel(toDate(`${key}-01`)))}</strong>
              <div class="section-accordion-meta"><span class="chip">${items.length} ${items.length === 1 ? 'meta' : 'metas'}</span></div>
            </div>
          </summary>
          <div class="section-accordion-body">
            <div class="kanban-stack">${items.map((goal) => goalCard(goal, open)).join('')}</div>
          </div>
        </details>
      `;
    }).join('');
  }

  function render(state) {
    if (!root) return;
    const goals = getGoalViews(state);
    const activeGoals = goals.filter((item) => !isGoalFinishedForStats(item));
    const finishedGoals = goals.filter((item) => isGoalFinishedForStats(item));
    const recurringGoals = goals.filter((item) => normalizeGoalScheduleType(item) === 'recurring');
    const openGoals = goals.filter((item) => normalizeGoalScheduleType(item) === 'open');
    const goalsWithDeadline = goals.filter((item) => ['deadline', 'duration', 'legacy'].includes(normalizeGoalScheduleType(item)));
    const averageProgress = goals.length ? Math.round(goals.reduce((acc, item) => acc + item.cycle.progress, 0) / goals.length) : 0;
    const currentMonthValue = monthKey(new Date());
    const groupedDeadlineGoals = groupByMonth(goalsWithDeadline);
    const renderedGroups = [
      renderGoalListGroup('Metas que repetem', 'Criam um novo período automaticamente e não entram no mês de prazo.', recurringGoals, true),
      renderGoalListGroup('Metas sem prazo', 'Ficam ativas sem data de encerramento.', openGoals, false),
      renderMonthGroup('Metas com prazo em', groupedDeadlineGoals, currentMonthValue),
    ].filter(Boolean).join('');

    root.innerHTML = `
      <div class="section-shell">
        <div class="section-head">
          <div>
            <span class="eyebrow">Minha evolução</span>
            <h3>Metas</h3>
            <p class="module-subtitle">Metas com prazo aparecem no calendário da data final. Metas que repetem criam um novo período automaticamente.</p>
          </div>
          <div class="section-actions"><button type="button" class="btn btn-primary" data-action="new-goal">Criar meta</button></div>
        </div>
        <div class="compact-stat-grid mobile-rail mobile-rail-cards">
          <article class="stat-card"><span class="label">Metas ativas</span><strong>${activeGoals.length}</strong><div class="progress"><span style="width:${averageProgress}%"></span></div></article>
          <article class="stat-card"><span class="label">Avanço médio</span><strong>${averageProgress}%</strong></article>
          <article class="stat-card"><span class="label">Metas que repetem</span><strong>${recurringGoals.length}</strong></article>
          <article class="stat-card"><span class="label">Sem prazo</span><strong>${openGoals.length}</strong></article>
        </div>
        <div class="section-accordion-stack">
          ${renderedGroups || createEmptyState('Você ainda não criou nenhuma meta', 'Crie uma meta para acompanhar seu progresso com mais clareza.', { label: 'Criar primeira meta', action: 'new-goal' })}
        </div>
      </div>
    `;
  }

  function init(element) {
    root = element;
    window.__CONTROLY_OPENERS = window.__CONTROLY_OPENERS || {};
    window.__CONTROLY_OPENERS.goals = ({ id } = {}) => {
      const goal = getGoalViews(window.__CONTROLY_STATE || {}).find((item) => item.id === id);
      if (goal) {
        openGoalForm(goal);
        return true;
      }
      return false;
    };
    root.addEventListener('submit', async (event) => {
      const form = event.target.closest('form[data-action="update-goal-progress"]');
      if (!form) return;
      event.preventDefault();
      const goal = getGoalViews(window.__CONTROLY_STATE).find((item) => item.id === form.dataset.id);
      if (!goal) return;
      await updateGoalProgress(goal, new FormData(form).get('currentValue'));
    });

    root.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      const goal = button.dataset.id ? getGoalViewById(button.dataset.id) : null;
      if (button.dataset.action === 'new-goal') openGoalForm();
      if (button.dataset.action === 'edit-goal' && goal) openGoalForm(goal);
      if (button.dataset.action === 'delete-goal' && goal) await handleDelete(goal.id);
      if (button.dataset.action === 'toggle-goal-complete' && goal) await toggleGoalCompletion(goal);
      if (button.dataset.action === 'toggle-goal-day' && goal) {
        if (normalizeGoalType(goal) !== 'habit') return;
        const day = goal.cycle.days.find((item) => item.key === button.dataset.day);
        if (day) await toggleDay(goal, day);
      }
      if (button.dataset.action === 'reset-goal' && goal) {
        try {
          const previousStatus = goal.dailyStatus || {};
          await patchRecord('goals', goal.id, { dailyStatus: {} });
          showUndoToast('Dias marcados foram zerados. Se precisar, você pode desfazer essa ação.', () => patchRecord('goals', goal.id, { dailyStatus: previousStatus }));
        } catch (error) {
          console.error(error);
          showToast('Não foi possível zerar esta meta. Tente novamente.', 'error');
        }
      }
    });
  }

  return { id: 'goals', init, render };
}
