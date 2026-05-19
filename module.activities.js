import { closeModal, confirmDialog, createEmptyState, icon, openModal, showToast, showUndoToast } from './ui.js';
import { deleteRecord, patchRecord, restoreDeletedRecord, saveRecord, toggleDateMapField } from './store.js';
import { getActivityChecklistProgress, getActivityOccurrences, getWeeklyActivitySummary, WEEKDAYS } from './domain.js';
import { addDays, cleanObjectForWrite, dateKey, escapeHtml, formatDate, isOverdue, monthKey, toDate, toInputDateValue } from './utils.js';

function priorityWeight(value = 'medium') {
  return value === 'high' ? 0 : value === 'medium' ? 1 : 2;
}

function groupWeekByMonth(weekSummary) {
  const groups = new Map();
  weekSummary.forEach((day) => {
    const key = monthKey(day.date);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(day);
  });
  return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

function getMonthActivitySummary(state, baseDateValue) {
  const base = toDate(baseDateValue) || new Date();
  const first = new Date(base.getFullYear(), base.getMonth(), 1, 12, 0, 0, 0);
  const lastDay = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  return Array.from({ length: lastDay }, (_, index) => {
    const date = new Date(first);
    date.setDate(index + 1);
    const items = getActivityOccurrences(state, date);
    const done = items.filter((item) => item.occurrenceDone).length;
    return { date, key: dateKey(date), items, done, total: items.length };
  });
}

export function createActivitiesModule() {
  let root;

  function requestSilentActivityUpdate(collectionName = 'activities') {
    window.__CONTROLY_SILENT_UPDATE?.(collectionName, 'activities', 900);
  }
  let selectedDate = dateKey(new Date());
  const filters = { mode: 'all', search: '' };

  function openActivityForm(activity = null) {
    const isRecurring = activity ? (activity?.kind || activity?.type) === 'recurring' : true;
    const selectedDays = new Set(
      (Array.isArray(activity?.daysOfWeek) ? activity.daysOfWeek : [])
        .map(Number)
        .filter((day) => day >= 0 && day <= 6)
    );
    const initialChecklist = (Array.isArray(activity?.checklist) ? activity.checklist : []).map((item) => ({ id: item.id || crypto.randomUUID(), text: item.text || String(item || ''), done: Boolean(item.done) })).filter((item) => item.text);
    openModal({
      title: activity ? 'Editar atividade' : 'Criar nova atividade',
      eyebrow: 'Planejamento da rotina',
      body: `
        <form id="activity-form" class="stack-form">
          <label class="field">
            <span>Nome da atividade</span>
            <input class="input" name="title" value="${escapeHtml(activity?.title || activity?.name || '')}" placeholder="Ex.: Ler 15 páginas" required />
          </label>
          <div class="inline-fields">
            <label class="field">
              <span>Essa atividade se repete?</span>
              <select class="select" name="kind" id="activity-kind">
                <option value="recurring" ${isRecurring ? 'selected' : ''}>Sim, faz parte da minha rotina</option>
                <option value="one-time" ${!isRecurring ? 'selected' : ''}>Não, acontece apenas uma vez</option>
              </select>
            </label>
            <label class="field">
              <span>Categoria</span>
              <input class="input" name="category" value="${escapeHtml(activity?.category || '')}" placeholder="Ex.: Saúde, Faculdade, Trabalho" />
            </label>
          </div>
          <div class="inline-fields">
            <label class="field recurring-only">
              <span>Com que frequência repetir?</span>
              <select class="select" name="frequency" id="activity-frequency">
                <option value="daily" ${(activity?.frequency || 'daily') === 'daily' ? 'selected' : ''}>Todos os dias</option>
                <option value="weekly_days" ${activity?.frequency === 'weekly_days' ? 'selected' : ''}>Em dias específicos da semana</option>
                <option value="interval_days" ${activity?.frequency === 'interval_days' ? 'selected' : ''}>A cada quantidade de dias</option>
                <option value="monthly_day" ${activity?.frequency === 'monthly_day' || activity?.frequency === 'monthly' ? 'selected' : ''}>Todo mês, no mesmo dia</option>
                <option value="monthly_nth_weekday" ${activity?.frequency === 'monthly_nth_weekday' ? 'selected' : ''}>Todo mês, em uma semana específica</option>
              </select>
            </label>
            <label class="field point-only">
              <span>Data para realizar</span>
              <input class="input" type="date" name="date" value="${escapeHtml(toInputDateValue(activity?.date || selectedDate))}" />
            </label>
            <label class="field recurring-only">
              <span>Começar a partir de</span>
              <input class="input" type="date" name="startDate" value="${escapeHtml(toInputDateValue(activity?.startDate || selectedDate))}" />
            </label>
            <label class="field recurring-only">
              <span>Terminar em (opcional)</span>
              <input class="input" type="date" name="endDate" value="${escapeHtml(toInputDateValue(activity?.endDate || ''))}" />
            </label>
          </div>
          <div id="activity-weekdays" class="weekday-picker recurring-only" aria-label="Dias da semana da atividade">
            ${WEEKDAYS.map((day) => {
              const checked = selectedDays.has(day.value);
              return `<label class="weekday-chip ${checked ? 'is-selected' : ''}"><input type="checkbox" name="daysOfWeek" value="${day.value}" aria-label="${day.label}" ${checked ? 'checked' : ''} /><span>${day.label}</span></label>`;
            }).join('')}
          </div>
          <div class="inline-fields recurring-only" id="activity-interval-fields">
            <label class="field"><span>Repetir a cada quantos dias?</span><input class="input" type="number" min="1" max="365" name="intervalDays" value="${activity?.intervalDays || activity?.recurrenceIntervalDays || 2}" /></label>
          </div>
          <div class="inline-fields recurring-only" id="activity-month-day-fields">
            <label class="field"><span>Dia do mês para repetir</span><input class="input" type="number" min="1" max="31" name="dayOfMonth" value="${activity?.dayOfMonth || toDate(activity?.startDate || selectedDate)?.getDate() || 1}" /></label>
          </div>
          <div class="inline-fields recurring-only" id="activity-nth-weekday-fields">
            <label class="field"><span>Qual ocorrência no mês?</span><select class="select" name="nthWeekday">${[1,2,3,4,5].map((value) => `<option value="${value}" ${Number(activity?.nthWeekday || 1) === value ? 'selected' : ''}>${value}ª vez no mês</option>`).join('')}</select></label>
            <label class="field"><span>Dia da semana</span><select class="select" name="weekdayOfMonth">${WEEKDAYS.map((day) => `<option value="${day.value}" ${Number(activity?.weekdayOfMonth ?? activity?.weekdayForNth ?? 1) === day.value ? 'selected' : ''}>${day.label}</option>`).join('')}</select></label>
          </div>
          <div class="inline-fields">
            <label class="field">
              <span>Prioridade</span>
              <select class="select" name="priority">
                <option value="low" ${activity?.priority === 'low' ? 'selected' : ''}>Baixa</option>
                <option value="medium" ${!activity?.priority || activity?.priority === 'medium' ? 'selected' : ''}>Média</option>
                <option value="high" ${activity?.priority === 'high' ? 'selected' : ''}>Alta</option>
              </select>
            </label>
            <label class="field"><span>Tempo estimado (opcional)</span><input class="input" type="number" min="0" max="1440" name="estimatedMinutes" value="${activity?.estimatedMinutes || ''}" placeholder="Ex.: 30" /></label>
          </div>
          <details class="section-accordion compact-advanced-options">
            <summary><div class="section-accordion-head"><strong>Subtarefas e observações</strong><div class="section-accordion-meta"><span class="chip">Opcional</span></div></div></summary>
            <div class="section-accordion-body">
              <div class="field">
                <span>Subtarefas</span>
                <div class="subtask-builder">
                  <input class="input" id="activity-subtask-input" placeholder="Digite uma subtarefa e pressione Enter" />
                  <button class="btn btn-secondary" type="button" id="activity-subtask-add">Adicionar</button>
                </div>
                <input type="hidden" name="checklistJson" id="activity-checklist-json" value="${escapeHtml(JSON.stringify(initialChecklist))}" />
                <div class="subtask-chip-list" id="activity-subtask-list"></div>
                <small class="module-subtitle">Divida a atividade em etapas menores. Ela só fica concluída quando todas as subtarefas forem marcadas.</small>
              </div>
              <label class="field"><span>Observações</span><textarea class="textarea" name="notes" placeholder="Registre informações importantes sobre esta atividade.">${escapeHtml(activity?.notes || '')}</textarea></label>
            </div>
          </details>
          <div class="inline-actions">
            <button type="button" id="activity-form-cancel" class="btn btn-secondary">Cancelar</button>
            <button type="submit" class="btn btn-primary">${activity ? 'Salvar atividade' : 'Criar atividade'}</button>
          </div>
        </form>
      `,
    });

    const form = document.getElementById('activity-form');
    const kindSelect = document.getElementById('activity-kind');
    const frequencySelect = document.getElementById('activity-frequency');
    const weekdays = document.getElementById('activity-weekdays');
    const intervalFields = document.getElementById('activity-interval-fields');
    const monthDayFields = document.getElementById('activity-month-day-fields');
    const nthWeekdayFields = document.getElementById('activity-nth-weekday-fields');

    const syncWeekdayChips = () => {
      weekdays?.querySelectorAll('.weekday-chip').forEach((chip) => {
        const checkbox = chip.querySelector('input[name="daysOfWeek"]');
        const checked = Boolean(checkbox?.checked);
        chip.classList.toggle('is-selected', checked);
        chip.dataset.checked = checked ? 'true' : 'false';
      });
    };

    weekdays?.addEventListener('click', (event) => {
      const chip = event.target.closest('.weekday-chip');
      if (!chip || !weekdays.contains(chip)) return;
      const checkbox = chip.querySelector('input[name="daysOfWeek"]');
      if (!checkbox) return;

      if (event.target === checkbox) {
        window.setTimeout(syncWeekdayChips, 0);
        return;
      }

      event.preventDefault();
      checkbox.checked = !checkbox.checked;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    });

    weekdays?.addEventListener('change', (event) => {
      if (event.target.matches('input[name="daysOfWeek"]')) syncWeekdayChips();
    });

    const updateVisibility = () => {
      const recurring = kindSelect.value === 'recurring';
      const frequency = frequencySelect.value;
      document.querySelectorAll('.recurring-only').forEach((el) => el.classList.toggle('hidden', !recurring));
      document.querySelectorAll('.point-only').forEach((el) => el.classList.toggle('hidden', recurring));
      weekdays.classList.toggle('hidden', !recurring || frequency !== 'weekly_days');
      intervalFields.classList.toggle('hidden', !recurring || frequency !== 'interval_days');
      monthDayFields.classList.toggle('hidden', !recurring || frequency !== 'monthly_day');
      nthWeekdayFields.classList.toggle('hidden', !recurring || frequency !== 'monthly_nth_weekday');
    };

    kindSelect.addEventListener('change', updateVisibility);
    frequencySelect.addEventListener('change', updateVisibility);
    updateVisibility();
    syncWeekdayChips();

    const checklistHidden = document.getElementById('activity-checklist-json');
    const subtaskInput = document.getElementById('activity-subtask-input');
    const subtaskList = document.getElementById('activity-subtask-list');
    const subtaskAdd = document.getElementById('activity-subtask-add');
    let checklistDraft = [...initialChecklist];

    const syncChecklistDraft = () => {
      if (checklistHidden) checklistHidden.value = JSON.stringify(checklistDraft);
      if (subtaskList) {
        subtaskList.innerHTML = checklistDraft.length
          ? checklistDraft.map((item) => `<span class="subtask-chip">${escapeHtml(item.text)}<button type="button" data-remove-subtask="${item.id}" aria-label="Remover subtarefa">×</button></span>`).join('')
          : '<span class="module-subtitle">Nenhuma subtarefa cadastrada.</span>';
      }
    };
    const addSubtaskDraft = () => {
      const text = subtaskInput?.value.trim();
      if (!text) return;
      checklistDraft.push({ id: crypto.randomUUID(), text, done: false });
      if (subtaskInput) subtaskInput.value = '';
      syncChecklistDraft();
    };
    subtaskAdd?.addEventListener('click', addSubtaskDraft);
    subtaskInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        addSubtaskDraft();
      }
    });
    subtaskList?.addEventListener('click', (event) => {
      const removeButton = event.target.closest('[data-remove-subtask]');
      if (!removeButton) return;
      checklistDraft = checklistDraft.filter((item) => item.id !== removeButton.dataset.removeSubtask);
      syncChecklistDraft();
    });
    syncChecklistDraft();

    document.getElementById('activity-form-cancel').addEventListener('click', closeModal);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      const kind = formData.get('kind') || 'one-time';
      let checklist = [];
      try {
        checklist = JSON.parse(String(formData.get('checklistJson') || '[]'));
      } catch {
        checklist = [];
      }
      checklist = checklist
        .map((item) => {
          const text = String(item?.text || '').trim();
          if (!text) return null;
          const previous = (activity?.checklist || []).find((oldItem) => oldItem.id === item.id || oldItem.text === text || oldItem === text);
          return { id: item?.id || previous?.id || crypto.randomUUID(), text, done: Boolean(previous?.done || item?.done) };
        })
        .filter(Boolean);
      const payload = {
        title: formData.get('title')?.trim(),
        category: formData.get('category')?.trim(),
        kind,
        notes: formData.get('notes')?.trim(),
        priority: formData.get('priority') || 'medium',
        estimatedMinutes: Number(formData.get('estimatedMinutes')) || 0,
        checklist,
        checklistStatusMap: activity?.checklistStatusMap || {},
      };

      if (!payload.title) {
        showToast('Informe o nome da atividade antes de salvar.', 'error');
        return;
      }

      if (kind === 'recurring') {
        const daysOfWeek = formData.getAll('daysOfWeek').map(Number);
        payload.frequency = formData.get('frequency') || 'daily';
        if (payload.frequency === 'weekly_days' && !daysOfWeek.length) {
          showToast('Escolha pelo menos um dia da semana para essa atividade se repetir.', 'error');
          return;
        }
        payload.daysOfWeek = payload.frequency === 'weekly_days' ? daysOfWeek : [];
        payload.intervalDays = Math.max(1, Number(formData.get('intervalDays')) || 1);
        payload.dayOfMonth = Math.max(1, Math.min(31, Number(formData.get('dayOfMonth')) || 1));
        payload.nthWeekday = Math.max(1, Math.min(5, Number(formData.get('nthWeekday')) || 1));
        payload.weekdayOfMonth = Number(formData.get('weekdayOfMonth')) || 1;
        payload.startDate = formData.get('startDate') || selectedDate;
        payload.endDate = formData.get('endDate') || '';
        if (payload.endDate && payload.endDate < payload.startDate) {
          showToast('A data final precisa ser igual ou posterior ao início da atividade.', 'error');
          return;
        }
        payload.completionMap = activity?.completionMap || {};
      } else {
        payload.date = formData.get('date') || selectedDate;
        payload.completed = activity?.completed || false;
        payload.completedAt = activity?.completedAt || null;
      }

      try {
        const previous = activity ? cleanObjectForWrite(activity) : null;
        await saveRecord('activities', payload, activity?.id || null);
        closeModal();
        if (activity && previous) {
          showUndoToast('Atividade atualizada. Você pode desfazer esta alteração.', () => saveRecord('activities', previous, activity.id));
        } else {
          showToast(kind === 'recurring' ? 'Atividade criada. Ela aparecerá automaticamente nos dias escolhidos.' : 'Atividade criada. Ela também aparecerá no calendário no dia selecionado.');
        }
      } catch (error) {
        console.error(error);
        showToast('Não foi possível salvar a atividade. Confira as informações e tente novamente.', 'error');
      }
    });
  }


  async function handleDelete(activity) {
    const confirmed = await confirmDialog({
      title: 'Excluir atividade',
      description: activity.legacy ? 'Esta atividade será enviada para a lixeira da área onde foi criada originalmente.' : 'Esta atividade irá para a lixeira e poderá ser restaurada por 7 dias antes de ser apagada definitivamente.',
      confirmLabel: 'Enviar para a lixeira',
    });
    if (!confirmed) return;
    try {
      const collectionName = activity.sourceCollection || 'activities';
      const result = await deleteRecord(collectionName, activity.id);
      showUndoToast('Atividade enviada para a lixeira. Você ainda pode restaurar se precisar.', () => result?.trashId ? restoreDeletedRecord(result.trashId) : Promise.resolve());
    } catch (error) {
      console.error(error);
      showToast('Não foi possível excluir a atividade. Tente novamente.', 'error');
    }
  }

  async function toggleOccurrence(item) {
    try {
      const collectionName = item.sourceCollection || 'activities';
      requestSilentActivityUpdate(collectionName);
      const checklist = Array.isArray(item.checklist) ? item.checklist : [];
      if (checklist.length) {
        const previousMap = { ...(item.checklistStatusMap?.[item.occurrenceDate] || {}) };
        const previousDone = getActivityChecklistProgress(item, item.occurrenceDate).allDone;
        const previousCompletion = { completed: previousDone, completedAt: item.completedAt || null };
        const nextDone = !previousDone;
        const nextMap = {};
        checklist.forEach((task) => { nextMap[task.id || task.text || String(task)] = nextDone; });
        const payload = { [`checklistStatusMap.${item.occurrenceDate}`]: nextMap };
        if (item.kind !== 'recurring') {
          payload.completed = nextDone;
          payload.completedAt = nextDone ? new Date() : null;
        }
        await patchRecord(collectionName, item.id, payload);
        showUndoToast(nextDone ? 'Todas as subtarefas foram concluídas.' : 'As subtarefas foram reabertas para acompanhamento.', () => {
          const undoPayload = { [`checklistStatusMap.${item.occurrenceDate}`]: previousMap };
          if (item.kind !== 'recurring') Object.assign(undoPayload, previousCompletion);
          return patchRecord(collectionName, item.id, undoPayload);
        });
        return;
      }
      if (item.kind === 'recurring') {
        await toggleDateMapField(collectionName, item.id, item.completionField || 'completionMap', item.occurrenceDate, !item.occurrenceDone);
        showUndoToast(!item.occurrenceDone ? 'Atividade marcada como concluída.' : 'Atividade reaberta para acompanhamento.', () => toggleDateMapField(collectionName, item.id, item.completionField || 'completionMap', item.occurrenceDate, item.occurrenceDone));
      } else {
        const previous = { completed: item.occurrenceDone, completedAt: item.completedAt || null };
        await patchRecord(collectionName, item.id, {
          completed: !item.occurrenceDone,
          completedAt: !item.occurrenceDone ? new Date() : null,
        });
        showUndoToast(!item.occurrenceDone ? 'Atividade marcada como concluída.' : 'Atividade reaberta para acompanhamento.', () => patchRecord(collectionName, item.id, previous));
      }
    } catch (error) {
      console.error(error);
      showToast('Não foi possível atualizar a atividade. Tente novamente.', 'error');
    }
  }

  async function toggleSubtask(item, taskId) {
    if (!item || !taskId) return;
    const collectionName = item.sourceCollection || 'activities';
    requestSilentActivityUpdate(collectionName);
    const previousMap = { ...(item.checklistStatusMap?.[item.occurrenceDate] || {}) };
    const previousDone = getActivityChecklistProgress(item, item.occurrenceDate).allDone;
    const previousCompletion = { completed: previousDone, completedAt: item.completedAt || null };
    const currentTask = (item.checklist || []).find((task) => (task.id || task.text || String(task)) === taskId);
    const currentDone = Boolean(previousMap[taskId] ?? currentTask?.done);
    const nextMap = { ...previousMap, [taskId]: !currentDone };
    try {
      const nextDone = getActivityChecklistProgress({ ...item, checklistStatusMap: { ...(item.checklistStatusMap || {}), [item.occurrenceDate]: nextMap } }, item.occurrenceDate).allDone;
      const payload = { [`checklistStatusMap.${item.occurrenceDate}`]: nextMap };
      if (item.kind !== 'recurring') {
        payload.completed = nextDone;
        payload.completedAt = nextDone ? new Date() : null;
      }
      await patchRecord(collectionName, item.id, payload);
      showUndoToast(nextDone ? 'Atividade concluída com todas as subtarefas.' : 'Subtarefa atualizada.', () => {
        const undoPayload = { [`checklistStatusMap.${item.occurrenceDate}`]: previousMap };
        if (item.kind !== 'recurring') Object.assign(undoPayload, previousCompletion);
        return patchRecord(collectionName, item.id, undoPayload);
      });
    } catch (error) {
      console.error(error);
      showToast('Não foi possível atualizar a subtarefa. Tente novamente.', 'error');
    }
  }

  async function postponeActivity(item, amount = 1) {
    if (!item || item.kind !== 'one-time') return;
    const collectionName = item.sourceCollection || 'activities';
    const previousDate = item.date || item.occurrenceDate || selectedDate;
    const nextDate = dateKey(addDays(previousDate, amount));
    try {
      await patchRecord(collectionName, item.id, { date: nextDate, completed: false, completedAt: null });
      showUndoToast(`Atividade adiada para ${formatDate(nextDate, { day: '2-digit', month: 'long' })}.`, () => patchRecord(collectionName, item.id, { date: previousDate, completed: item.completed || false, completedAt: item.completedAt || null }));
    } catch (error) {
      console.error(error);
      showToast('Não foi possível adiar a atividade. Tente novamente.', 'error');
    }
  }

  function renderSubtasks(item) {
    const checklist = Array.isArray(item.checklist) ? item.checklist : [];
    if (!checklist.length) return '';
    const progress = getActivityChecklistProgress(item, item.occurrenceDate);
    const statusMap = item.checklistStatusMap?.[item.occurrenceDate] || {};
    return `
      <details class="section-accordion activity-subtask-accordion">
        <summary>
          <div class="section-accordion-head">
            <strong>Subtarefas</strong>
            <div class="section-accordion-meta"><span class="chip">${progress.done}/${progress.total} concluída(s)</span></div>
          </div>
        </summary>
        <div class="section-accordion-body">
          <div class="activity-subtask-checklist">
            <p class="module-subtitle">Marque cada etapa quando terminar. A atividade fica concluída quando todas forem marcadas.</p>
            <div class="activity-subtask-grid">
              ${checklist.map((task) => {
                const id = task.id || task.text || String(task);
                const done = Boolean(statusMap[id] ?? task.done);
                return `<label class="activity-subtask-item ${done ? 'is-done' : ''}"><input type="checkbox" data-action="toggle-subtask" data-id="${item.id}" data-source="${item.sourceCollection}" data-task-id="${escapeHtml(id)}" ${done ? 'checked' : ''} /><span>${escapeHtml(task.text || task)}</span></label>`;
              }).join('')}
            </div>
          </div>
        </div>
      </details>
    `;
  }

  function renderHistoryAccordion(weekSummary, currentDateValue) {
    const monthGroups = groupWeekByMonth(weekSummary);
    return monthGroups.map(([key, days]) => `
      <details class="section-accordion month-accordion" ${key === monthKey(currentDateValue) ? 'open' : ''}>
        <summary>
          <div class="section-accordion-head">
            <strong>${escapeHtml(formatDate(toDate(`${key}-01`), { month: 'long', year: 'numeric' }))}</strong>
            <div class="section-accordion-meta"><span class="chip">${days.length} dia(s) acompanhados</span></div>
          </div>
        </summary>
        <div class="section-accordion-body">
          <div class="week-summary-grid">
            ${days.map((day) => `
              <article class="mini-stat history-day-card ${day.key === selectedDate ? 'is-highlighted' : ''}">
                <span>${formatDate(day.date, { weekday: 'short' })}</span>
                <strong>${day.done}/${day.total}</strong>
                <button class="btn btn-secondary btn-block" type="button" data-action="pick-day" data-date="${day.key}">${formatDate(day.date, { day: '2-digit', month: '2-digit' })}</button>
                <div class="history-day-list">
                  ${(day.items || []).slice(0, 4).map((item) => `<div class="history-day-row"><strong>${escapeHtml(item.title)}</strong><span class="tag ${item.occurrenceDone ? 'success' : 'medium'}">${item.occurrenceDone ? 'Concluída' : 'Pendente'}</span></div>`).join('') || '<div class="module-subtitle">Nenhuma atividade registrada</div>'}
                </div>
              </article>
            `).join('')}
          </div>
        </div>
      </details>
    `).join('');
  }

  function render(state) {
    if (!root) return;
    const allItems = getActivityOccurrences(state, selectedDate)
      .filter((item) => {
        const searchText = `${item.title} ${item.category || ''} ${item.notes || ''}`.toLowerCase();
        const searchOk = !filters.search || searchText.includes(filters.search.toLowerCase());
        const modeOk = filters.mode === 'all' || (filters.mode === 'recurring' ? item.kind === 'recurring' : item.kind === 'one-time');
        return searchOk && modeOk;
      })
      .sort((a, b) => priorityWeight(a.priority) - priorityWeight(b.priority)
        || Number(Boolean(a.occurrenceDone)) - Number(Boolean(b.occurrenceDone))
        || (a.title || '').localeCompare(b.title || ''));
    const weekSummary = getWeeklyActivitySummary(state, selectedDate);
    const monthSummary = getMonthActivitySummary(state, selectedDate);
    const totalWeek = weekSummary.reduce((acc, item) => acc + item.total, 0);
    const doneWeek = weekSummary.reduce((acc, item) => acc + item.done, 0);
    const recurringCount = allItems.filter((item) => item.kind === 'recurring').length;
    const pointCount = allItems.filter((item) => item.kind === 'one-time').length;
    const dayDone = allItems.filter((item) => item.occurrenceDone).length;
    const dayTotal = allItems.length;
    const progressPct = dayTotal ? Math.round((dayDone / dayTotal) * 100) : 0;

    root.innerHTML = `
      <div class="section-shell">
        <div class="section-head">
          <div>
            <span class="eyebrow">Minha rotina</span>
            <h3>Atividades</h3>
            <p class="module-subtitle">Cadastre atividades, acompanhe o que precisa ser feito e veja seu progresso ao longo dos dias.</p>
          </div>
          <div class="section-actions"><button class="btn btn-primary" type="button" data-action="new-activity">Criar atividade</button></div>
        </div>

        <div class="compact-stat-grid mobile-rail mobile-rail-cards">
          <article class="stat-card"><span class="label">Dia selecionado</span><strong>${formatDate(selectedDate, { day: '2-digit', month: 'long' })}</strong></article>
          <article class="stat-card"><span class="label">Atividades da rotina</span><strong>${recurringCount}</strong></article>
          <article class="stat-card"><span class="label">Atividades únicas</span><strong>${pointCount}</strong></article>
          <article class="stat-card"><span class="label">Progresso da semana</span><strong>${doneWeek}/${totalWeek}</strong><div class="progress"><span style="width:${totalWeek ? Math.round((doneWeek / totalWeek) * 100) : 0}%"></span></div></article>
        </div>

        <article class="panel">
          <div class="filter-row">
            <input class="input" id="activities-date" type="date" value="${selectedDate}" />
            <select class="select" id="activities-mode">
              <option value="all" ${filters.mode === 'all' ? 'selected' : ''}>Todas as atividades</option>
              <option value="recurring" ${filters.mode === 'recurring' ? 'selected' : ''}>Atividades da rotina</option>
              <option value="one-time" ${filters.mode === 'one-time' ? 'selected' : ''}>Atividades únicas</option>
            </select>
            <input class="input" id="activities-search" value="${escapeHtml(filters.search)}" placeholder="Buscar por nome, categoria ou observação" />
          </div>
        </article>

        <div class="activity-board mobile-rail-group">
          <article class="panel activity-day-board">
            <div class="activity-day-header">
              <div>
                <span class="eyebrow">Lista do dia</span>
                <h4>${formatDate(selectedDate, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}</h4>
              </div>
              <div class="activity-progress-badge"><strong>${dayDone}/${dayTotal}</strong><span>${progressPct}% concluído</span></div>
            </div>
            <div class="progress"><span style="width:${progressPct}%"></span></div>
            <details class="section-accordion" open>
              <summary>
                <div class="section-accordion-head">
                  <strong>Atividades para este dia</strong>
                  <div class="section-accordion-meta"><span class="chip">Acompanhe e marque o que concluir</span></div>
                </div>
              </summary>
              <div class="section-accordion-body">
                <div class="activity-notion-table">
                  ${allItems.map((item) => `
                    <article class="activity-table-row ${item.occurrenceDone ? 'is-complete' : ''} ${item.kind === 'one-time' && !item.occurrenceDone && isOverdue(item.date) ? 'overdue' : ''}" data-search-id="activities:${item.id}">
                      <div class="activity-row-top">
                        <label class="activity-title-line">
                          <input class="activity-table-check" type="checkbox" data-action="toggle-activity" data-id="${item.id}" data-source="${item.sourceCollection}" data-date="${item.occurrenceDate}" ${item.occurrenceDone ? 'checked' : ''} />
                          <strong>${escapeHtml(item.title)}</strong>
                        </label>
                        <div class="inline-actions activity-row-actions">
                          ${item.kind === 'one-time' && !item.occurrenceDone ? `<button type="button" class="icon-btn small" data-action="postpone-activity" data-id="${item.id}" data-source="${item.sourceCollection}">${icon('calendar-clock', 'Adiar para amanhã')}</button>` : ''}
                          ${!item.legacy ? `<button type="button" class="icon-btn small" data-action="edit-activity" data-id="${item.id}" data-source="${item.sourceCollection}">${icon('pencil-line', 'Editar atividade')}</button>` : ''}
                          <button type="button" class="icon-btn small" data-action="delete-activity" data-id="${item.id}" data-source="${item.sourceCollection}">${icon('trash-2', 'Excluir atividade')}</button>
                        </div>
                      </div>
                      <div class="activity-row-meta">
                        <span class="tag ${escapeHtml(item.priority || 'medium')}">Prioridade ${item.priority === 'high' ? 'alta' : item.priority === 'low' ? 'baixa' : 'média'}</span>
                        <span class="chip">${escapeHtml(item.category || 'Sem categoria')}</span>
                        <span class="tag ${item.kind === 'recurring' ? 'success' : 'medium'}">${item.kind === 'recurring' ? 'Rotina' : 'Única'}</span>
                        <span class="tag ${item.occurrenceDone ? 'success' : 'medium'}">${item.occurrenceDone ? 'Concluída' : 'Pendente'}</span>
                        ${item.estimatedMinutes ? `<span class="chip">${item.estimatedMinutes} min previstos</span>` : ''}
                      </div>
                      ${renderSubtasks(item)}
                      ${item.notes ? `<p class="module-subtitle activity-row-note">${escapeHtml(item.notes)}</p>` : ''}
                    </article>
                  `).join('') || createEmptyState('Nenhuma atividade para hoje', 'Adicione uma tarefa para organizar melhor seu dia.', { label: 'Criar atividade', action: 'new-activity' })}
                </div>
              </div>
            </details>
          </article>

          <article class="panel">
            <span class="eyebrow">Histórico</span>
            <h4>Acompanhe seus dias por mês</h4>
            <div class="section-accordion-stack">${renderHistoryAccordion(monthSummary, selectedDate)}</div>
            <p class="module-subtitle">Cadastre atividades únicas ou recorrentes. O histórico ajuda a acompanhar sua rotina com clareza.</p>
          </article>
        </div>
      </div>
    `;
  }

  function init(element) {
    root = element;
    window.__CONTROLY_OPENERS = window.__CONTROLY_OPENERS || {};
    window.__CONTROLY_OPENERS.activities = ({ id, date } = {}) => {
      const state = window.__CONTROLY_STATE || {};
      const activity = (state.activities || []).find((entry) => entry.id === id);
      if (date) selectedDate = date;
      if (activity) {
        openActivityForm(activity);
        return true;
      }
      render(state);
      return false;
    };
    root.addEventListener('input', (event) => {
      if (event.target.id === 'activities-date') selectedDate = event.target.value;
      if (event.target.id === 'activities-search') filters.search = event.target.value;
      if (event.target.id === 'activities-mode') filters.mode = event.target.value;
      render(window.__CONTROLY_STATE);
    });
    root.addEventListener('change', (event) => {
      if (event.target.id === 'activities-mode') {
        filters.mode = event.target.value;
        render(window.__CONTROLY_STATE);
      }
    });
    root.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      const action = button.dataset.action;
      const currentState = window.__CONTROLY_STATE;
      const item = getActivityOccurrences(currentState, selectedDate).find((entry) => entry.id === button.dataset.id && (!button.dataset.source || entry.sourceCollection === button.dataset.source));
      const storedActivity = currentState.activities.find((entry) => entry.id === button.dataset.id);

      if (action === 'new-activity') openActivityForm();
      if (action === 'edit-activity' && storedActivity) openActivityForm(storedActivity);
      if (action === 'pick-day') {
        selectedDate = button.dataset.date;
        render(currentState);
      }
      if (action === 'toggle-activity' && item) await toggleOccurrence(item);
      if (action === 'toggle-subtask' && item) await toggleSubtask(item, button.dataset.taskId);
      if (action === 'postpone-activity' && item) await postponeActivity(item, 1);
      if (action === 'delete-activity' && item) await handleDelete(item);
    });
  }

  return { id: 'activities', init, render };
}