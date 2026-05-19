import { closeModal, confirmDialog, createEmptyState, icon, openModal, refreshIcons, runButtonAction, showToast, showUndoToast } from './ui.js';
import { deleteNestedArrayItem, deleteRecord, patchRecord, restoreDeletedRecord, saveRecord } from './store.js';
import { getStudySubjectViews } from './domain.js';
import { cleanObjectForWrite, escapeHtml, formatDate, formatMonthLabel, monthKey, toDate, toInputDateValue } from './utils.js';

function getSubjectSessions(subject) {
  return Array.isArray(subject?.studySessions) ? subject.studySessions : [];
}

function getStartOfDay(baseDate = new Date()) {
  const value = new Date(baseDate);
  value.setHours(0, 0, 0, 0);
  return value;
}

const FOCUS_STORAGE_KEY = 'controly.studies.focusState';

function getStartOfWeek(baseDate = new Date()) {
  const value = getStartOfDay(baseDate);
  const day = value.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  value.setDate(value.getDate() + diff);
  return value;
}

function formatStudyDuration(totalMs) {
  const safe = Math.max(0, Math.floor(totalMs / 60000));
  const hours = Math.floor(safe / 60);
  const minutes = safe % 60;
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}min`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}min`;
}

function getStudySummary(subject, baseDate = new Date()) {
  const sessions = getSubjectSessions(subject);
  const startOfDay = getStartOfDay(baseDate).getTime();
  const startOfWeek = getStartOfWeek(baseDate).getTime();
  const startOfMonth = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1, 0, 0, 0, 0).getTime();
  let totalMs = Number(subject?.studyTotalMs || 0);
  if (!Number.isFinite(totalMs) || totalMs < 0) {
    totalMs = sessions.reduce((sum, session) => sum + Math.max(0, Number(session?.durationMs || 0)), 0);
  }
  let todayMs = 0;
  let weekMs = 0;
  let monthMs = 0;
  sessions.forEach((session) => {
    const durationMs = Math.max(0, Number(session?.durationMs || 0));
    const endedAt = new Date(session?.endedAt || session?.createdAt || 0).getTime();
    if (endedAt >= startOfDay) todayMs += durationMs;
    if (endedAt >= startOfWeek) weekMs += durationMs;
    if (endedAt >= startOfMonth) monthMs += durationMs;
  });
  return {
    totalMs,
    todayMs,
    weekMs,
    monthMs,
    sessionsCount: sessions.length,
    lastSession: sessions[0] || null,
  };
}

function subjectDeadlineDate(subject = {}) {
  return toDate(subject.endDate || subject.deadline || subject.finishDate || '');
}

function isSubjectFinished(subject = {}, baseDate = new Date()) {
  const deadline = subjectDeadlineDate(subject);
  if (!deadline) return false;
  const today = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 0, 0, 0, 0);
  const limit = new Date(deadline.getFullYear(), deadline.getMonth(), deadline.getDate(), 23, 59, 59, 999);
  return limit < today;
}

function groupSubjectsByMonth(subjects) {
  const groups = new Map();
  subjects.forEach((subject) => {
    const base = subjectDeadlineDate(subject) || subject.updatedAt || subject.createdAt || new Date();
    const key = monthKey(base);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(subject);
  });
  return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

function clampMinutes(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.round(parsed), 999);
}

function clampCycles(value, fallback = 4) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.round(parsed), 12);
}

function formatClock(totalMs) {
  const safe = Math.max(0, Math.floor(totalMs / 1000));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
  return [minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
}

function countLabel(count, singular, plural) {
  const safe = Math.max(0, Number(count || 0));
  return `${safe} ${safe === 1 ? singular : plural}`;
}

function getTodoNote(todo = {}) {
  if (!todo || typeof todo !== 'object') return '';
  return String(todo.note || todo.notes || todo.observation || '').trim();
}

function getSubjectTodos(subject = {}) {
  return Array.isArray(subject?.todos) ? subject.todos.filter(Boolean) : [];
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}

function cleanNestedForWrite(value) {
  if (value === undefined || typeof value === 'function') return undefined;
  if (Array.isArray(value)) return value.map(cleanNestedForWrite).filter((item) => item !== undefined);
  if (value instanceof Date || typeof value?.toDate === 'function') return value;
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [key, cleanNestedForWrite(item)])
      .filter(([, item]) => item !== undefined)
  );
}

function normalizeTodoForWrite(todo = {}) {
  const id = normalizeId(todo.id) || createLocalId('study-todo');
  const text = String(todo.text || todo.title || todo.name || '').trim();
  const note = getTodoNote(todo);
  const normalized = cleanNestedForWrite({
    ...todo,
    id,
    text,
    note,
    done: Boolean(todo.done),
  });
  if (!note) delete normalized.note;
  return normalized;
}

function prepareTodosForWrite(todos = []) {
  return (Array.isArray(todos) ? todos : [])
    .map(normalizeTodoForWrite)
    .filter((todo) => String(todo.text || '').trim());
}

function isTodoCreateAction(action = '') {
  return ['new-todo', 'add-todo', 'create-todo'].includes(action);
}

function getEventElement(event) {
  const target = event?.target;
  if (!target) return null;
  if (target.nodeType === 1) return target;
  return target.parentElement || null;
}

function normalizeId(value = '') {
  return String(value || '').trim();
}

function createLocalId(prefix = 'id') {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createStudiesModule() {
  let root;
  let focusTicker = null;
  let studyFilters = { status: 'all', dateType: 'all', query: '' };
  let studySaveQueue = Promise.resolve();
  let lastRenderedSubjects = [];

  let focusHydrated = false;

  const focusState = {
    mode: 'pomodoro',
    subjectId: '',
    pomodoro: {
      focusMinutes: 25,
      breakMinutes: 5,
      cycles: 4,
      cycleIndex: 1,
      phase: 'focus',
      isRunning: false,
      baseRemainingMs: 25 * 60 * 1000,
      startedAt: null,
      segmentInitialRemainingMs: 25 * 60 * 1000,
    },
    timer: {
      minutes: 30,
      isRunning: false,
      baseRemainingMs: 30 * 60 * 1000,
      startedAt: null,
      segmentInitialRemainingMs: 30 * 60 * 1000,
    },
    stopwatch: {
      isRunning: false,
      baseElapsedMs: 0,
      startedAt: null,
    },
  };

  function persistFocusState() {
    try {
      localStorage.setItem(FOCUS_STORAGE_KEY, JSON.stringify(focusState));
    } catch {}
  }

  function hydrateFocusState() {
    if (focusHydrated) return;
    focusHydrated = true;
    try {
      const stored = JSON.parse(localStorage.getItem(FOCUS_STORAGE_KEY) || 'null');
      if (!stored || typeof stored !== 'object') return;
      focusState.mode = stored.mode || focusState.mode;
      focusState.subjectId = stored.subjectId || focusState.subjectId;
      Object.assign(focusState.pomodoro, stored.pomodoro || {});
      Object.assign(focusState.timer, stored.timer || {});
      Object.assign(focusState.stopwatch, stored.stopwatch || {});
      if (focusState.pomodoro.isRunning || focusState.timer.isRunning || focusState.stopwatch.isRunning) startTicker();
    } catch {}
  }

  function getModeState(mode = focusState.mode) {
    if (mode === 'pomodoro') return focusState.pomodoro;
    if (mode === 'timer') return focusState.timer;
    return focusState.stopwatch;
  }

  function getCurrentRemainingMs(mode = focusState.mode) {
    const current = getModeState(mode);
    if (mode === 'stopwatch') return 0;
    if (!current.isRunning || !current.startedAt) return current.baseRemainingMs;
    return Math.max(0, current.baseRemainingMs - (Date.now() - current.startedAt));
  }

  function getCurrentElapsedMs() {
    const current = focusState.stopwatch;
    if (!current.isRunning || !current.startedAt) return current.baseElapsedMs;
    return current.baseElapsedMs + (Date.now() - current.startedAt);
  }

  function stopTicker() {
    if (!focusTicker) return;
    window.clearInterval(focusTicker);
    focusTicker = null;
  }

  function ensureSelectedSubject(subjects) {
    if (!subjects.length) {
      focusState.subjectId = '';
      return;
    }
    if (!subjects.some((subject) => subject.id === focusState.subjectId)) {
      focusState.subjectId = subjects[0].id;
    }
  }

  function getSelectedSubject(subjects = getStudySubjectViews(window.__CONTROLY_STATE || {})) {
    return subjects.find((subject) => subject.id === focusState.subjectId) || null;
  }

  async function recordStudyTime(subjectId, mode, durationMs, startedAt, endedAt = Date.now()) {
    if (!subjectId || !Number.isFinite(durationMs) || durationMs < 1000) return;
    const session = {
      id: crypto.randomUUID(),
      mode,
      durationMs: Math.max(1000, Math.round(durationMs)),
      startedAt: new Date(startedAt || endedAt).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
      createdAt: new Date().toISOString(),
    };

    studySaveQueue = studySaveQueue.then(async () => {
      const subjects = getStudySubjectViews(window.__CONTROLY_STATE || {});
      const subject = subjects.find((item) => item.id === subjectId);
      if (!subject) return;
      await saveRecord('studySessions', { ...session, subjectId, subjectName: subject.name || '' });
      const sessions = [session, ...getSubjectSessions(subject)].slice(0, 120);
      const totalMs = Math.max(0, Number(subject.studyTotalMs || 0)) + session.durationMs;
      await patchRecord('subjects', subjectId, { studySessions: sessions, studyTotalMs: totalMs });
    }).catch((error) => {
      console.error(error);
      showToast('Não foi possível registrar o tempo de estudo. Tente novamente.', 'error');
    });

    await studySaveQueue;
  }

  function getStudySubjectsFromState() {
    const stateSubjects = getStudySubjectViews(window.__CONTROLY_STATE || {});
    const source = stateSubjects.length ? stateSubjects : lastRenderedSubjects;
    return Array.isArray(source) ? source : [];
  }

  function findSubjectById(subjectId) {
    const targetId = normalizeId(subjectId);
    if (!targetId) return null;
    return getStudySubjectsFromState().find((item) => normalizeId(item.id) === targetId) || null;
  }

  function fallbackSubjectFromTrigger(trigger, subjectId) {
    const targetId = normalizeId(subjectId);
    if (!targetId) return null;
    const card = trigger?.closest?.('[data-subject-id], [data-search-id^="studies:"]');
    return {
      id: targetId,
      name: card?.dataset?.subjectName || 'Matéria',
      area: card?.dataset?.subjectArea || '',
      todos: [],
      importantDates: [],
      studySessions: [],
      studyTotalMs: 0,
    };
  }

  function findSubjectFromTrigger(trigger) {
    const explicitId = normalizeId(trigger?.dataset?.id);
    const cardId = normalizeId(trigger?.closest?.('[data-subject-id]')?.dataset?.subjectId);
    const searchId = normalizeId(trigger?.closest?.('[data-search-id^="studies:"]')?.dataset?.searchId).replace(/^studies:/, '');
    const subjectId = explicitId || cardId || searchId;
    if (!subjectId) return null;
    return findSubjectById(subjectId) || fallbackSubjectFromTrigger(trigger, subjectId);
  }

  function openStudiesModal(options) {
    try {
      openModal(options);
      const modalRoot = document.getElementById('modal-root');
      const modalBody = document.getElementById('modal-body');
      if (!modalRoot?.classList?.contains('open') || !modalBody?.querySelector?.('#subject-todo-form')) {
        throw new Error('O modal de tarefa não ficou aberto após a chamada padrão.');
      }
      return true;
    } catch (error) {
      console.error('Falha ao abrir o modal padrão de Estudos:', error);
      const modalRoot = document.getElementById('modal-root');
      const modalTitle = document.getElementById('modal-title');
      const modalEyebrow = document.getElementById('modal-eyebrow');
      const modalBody = document.getElementById('modal-body');
      if (!modalRoot || !modalTitle || !modalEyebrow || !modalBody) return false;

      modalTitle.textContent = options?.title || 'Detalhes';
      modalEyebrow.textContent = options?.eyebrow || '';
      modalEyebrow.classList.toggle('hidden', !options?.eyebrow);
      modalBody.innerHTML = options?.body || options?.content || '';
      modalRoot.classList.add('open');
      modalRoot.setAttribute('aria-hidden', 'false');
      document.body.classList.add('modal-open');
      try { refreshIcons(modalRoot); } catch (iconError) { console.error('Falha ao atualizar ícones do modal:', iconError); }
      return true;
    }
  }

  async function closeStudiesModal(options = {}) {
    try {
      const closed = await closeModal(options);
      if (closed !== false) return true;
    } catch (error) {
      console.error('Falha ao fechar o modal padrão de Estudos:', error);
    }

    const modalRoot = document.getElementById('modal-root');
    const modalBody = document.getElementById('modal-body');
    modalRoot?.classList.remove('open');
    modalRoot?.setAttribute('aria-hidden', 'true');
    if (modalBody) modalBody.innerHTML = '';
    document.body.classList.remove('modal-open');
    document.body.style.top = '';
    return true;
  }

  function openTodoFormFromTrigger(trigger) {
    const subject = findSubjectFromTrigger(trigger);
    if (!subject) {
      showToast('Não foi possível identificar a matéria desta tarefa. Atualize a página e tente novamente.', 'error');
      return false;
    }
    return openTodoForm(subject);
  }

  function handleTodoCreateClick(event, trigger) {
    if (!trigger || !isTodoCreateAction(trigger.dataset.action)) return false;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    event?.stopImmediatePropagation?.();
    try {
      return openTodoFormFromTrigger(trigger);
    } catch (error) {
      console.error('Falha ao abrir o formulário de nova tarefa de estudo:', error);
      showToast('Não foi possível abrir o formulário da tarefa. Atualize a página e tente novamente.', 'error');
      return false;
    }
  }

  function bindTodoCreateButtons() {
    if (!root) return;
    root.querySelectorAll('[data-action="new-todo"], [data-action="add-todo"], [data-action="create-todo"]').forEach((button) => {
      if (button.dataset.todoCreateBound === 'true') return;
      button.dataset.todoCreateBound = 'true';
      button.addEventListener('click', (event) => handleTodoCreateClick(event, button));
    });
  }

  async function persistActiveStudyTime(mode = focusState.mode) {
    const subjectId = focusState.subjectId;
    if (!subjectId) return;
    const now = Date.now();

    if (mode === 'pomodoro') {
      const current = focusState.pomodoro;
      if (!current.isRunning || current.phase !== 'focus' || !current.startedAt) return;
      const durationMs = Math.max(0, current.segmentInitialRemainingMs - getCurrentRemainingMs('pomodoro'));
      await recordStudyTime(subjectId, 'pomodoro', durationMs, now - durationMs, now);
      return;
    }

    if (mode === 'timer') {
      const current = focusState.timer;
      if (!current.isRunning || !current.startedAt) return;
      const durationMs = Math.max(0, current.segmentInitialRemainingMs - getCurrentRemainingMs('timer'));
      await recordStudyTime(subjectId, 'timer', durationMs, now - durationMs, now);
      return;
    }

    const current = focusState.stopwatch;
    if (!current.isRunning || !current.startedAt) return;
    const durationMs = Math.max(0, now - current.startedAt);
    await recordStudyTime(subjectId, 'stopwatch', durationMs, now - durationMs, now);
  }

  async function pauseMode(mode = focusState.mode) {
    const current = getModeState(mode);
    if (!current.isRunning) return;
    const currentRemainingMs = mode === 'stopwatch' ? 0 : getCurrentRemainingMs(mode);
    const currentElapsedMs = mode === 'stopwatch' ? getCurrentElapsedMs() : 0;
    await persistActiveStudyTime(mode);
    if (mode === 'stopwatch') {
      current.baseElapsedMs = currentElapsedMs;
    } else {
      current.baseRemainingMs = currentRemainingMs;
      if (mode === 'pomodoro' || mode === 'timer') current.segmentInitialRemainingMs = currentRemainingMs;
    }
    current.isRunning = false;
    current.startedAt = null;
    if (!focusState.pomodoro.isRunning && !focusState.timer.isRunning && !focusState.stopwatch.isRunning) stopTicker();
    persistFocusState();
    syncFocusDisplay();
  }

  async function pauseAllModes() {
    for (const mode of ['pomodoro', 'timer', 'stopwatch']) {
      await pauseMode(mode);
    }
    stopTicker();
  }

  function resetPomodoro(options = {}) {
    focusState.pomodoro.isRunning = false;
    focusState.pomodoro.startedAt = null;
    focusState.pomodoro.phase = options.phase || 'focus';
    focusState.pomodoro.cycleIndex = options.cycleIndex || 1;
    focusState.pomodoro.baseRemainingMs = focusState.pomodoro.focusMinutes * 60 * 1000;
    focusState.pomodoro.segmentInitialRemainingMs = focusState.pomodoro.baseRemainingMs;
  }

  function resetTimer() {
    focusState.timer.isRunning = false;
    focusState.timer.startedAt = null;
    focusState.timer.baseRemainingMs = focusState.timer.minutes * 60 * 1000;
    focusState.timer.segmentInitialRemainingMs = focusState.timer.baseRemainingMs;
  }

  function resetStopwatch() {
    focusState.stopwatch.isRunning = false;
    focusState.stopwatch.startedAt = null;
    focusState.stopwatch.baseElapsedMs = 0;
  }

  function startTicker() {
    if (focusTicker) return;
    focusTicker = window.setInterval(() => {
      if (focusState.mode === 'pomodoro') {
        const current = focusState.pomodoro;
        if (current.isRunning && getCurrentRemainingMs('pomodoro') <= 0) {
          if (current.phase === 'focus') {
            void recordStudyTime(focusState.subjectId, 'pomodoro', current.segmentInitialRemainingMs, Date.now() - current.segmentInitialRemainingMs, Date.now());
            if (current.cycleIndex >= current.cycles) {
              current.isRunning = false;
              current.startedAt = null;
              current.baseRemainingMs = 0;
              current.segmentInitialRemainingMs = 0;
              stopTicker();
              syncFocusDisplay();
              showToast('Sessão de foco concluída. Seu tempo de estudo foi registrado.');
              return;
            }
            current.phase = 'break';
            current.isRunning = true;
            current.baseRemainingMs = current.breakMinutes * 60 * 1000;
            current.startedAt = Date.now();
            current.segmentInitialRemainingMs = current.baseRemainingMs;
            syncFocusDisplay();
            showToast('Hora da pausa. Descanse antes da próxima rodada de foco.');
            return;
          }
          current.phase = 'focus';
          current.cycleIndex += 1;
          current.isRunning = true;
          current.baseRemainingMs = current.focusMinutes * 60 * 1000;
          current.startedAt = Date.now();
          current.segmentInitialRemainingMs = current.baseRemainingMs;
          syncFocusDisplay();
          showToast(`Rodada ${current.cycleIndex} iniciada. Volte ao foco.`);
          return;
        }
      }

      if (focusState.mode === 'timer') {
        const current = focusState.timer;
        if (current.isRunning && getCurrentRemainingMs('timer') <= 0) {
          void recordStudyTime(focusState.subjectId, 'timer', current.segmentInitialRemainingMs, Date.now() - current.segmentInitialRemainingMs, Date.now());
          current.isRunning = false;
          current.startedAt = null;
          current.baseRemainingMs = 0;
          current.segmentInitialRemainingMs = 0;
          stopTicker();
          syncFocusDisplay();
          showToast('Tempo de estudo finalizado e registrado.');
          return;
        }
      }

      syncFocusDisplay();
    }, 250);
  }

  async function startMode(mode = focusState.mode) {
    if (mode !== focusState.mode) focusState.mode = mode;
    for (const otherMode of ['pomodoro', 'timer', 'stopwatch']) {
      if (otherMode !== mode) await pauseMode(otherMode);
    }
    const current = getModeState(mode);
    if (mode === 'stopwatch') {
      current.startedAt = Date.now();
      current.isRunning = true;
    } else {
      if (current.baseRemainingMs <= 0) {
        if (mode === 'pomodoro') resetPomodoro();
        if (mode === 'timer') resetTimer();
      }
      current.startedAt = Date.now();
      current.isRunning = true;
      if (mode === 'pomodoro') current.segmentInitialRemainingMs = current.baseRemainingMs;
      if (mode === 'timer') current.segmentInitialRemainingMs = current.baseRemainingMs;
    }
    persistFocusState();
    syncFocusDisplay();
    startTicker();
  }

  async function resetMode(mode = focusState.mode) {
    await pauseAllModes();
    if (mode === 'pomodoro') resetPomodoro();
    if (mode === 'timer') resetTimer();
    if (mode === 'stopwatch') resetStopwatch();
    persistFocusState();
    syncFocusDisplay();
  }

  function buildFocusPanel(subjects) {
    ensureSelectedSubject(subjects);
    const selectedSubject = getSelectedSubject(subjects);
    const selectedSummary = getStudySummary(selectedSubject);
    const pomodoroRunning = focusState.mode === 'pomodoro' && focusState.pomodoro.isRunning;
    const timerRunning = focusState.mode === 'timer' && focusState.timer.isRunning;
    const stopwatchRunning = focusState.mode === 'stopwatch' && focusState.stopwatch.isRunning;

    let title = 'Pomodoro';
    let subtitle = 'Estude em ciclos de foco com pausas automáticas para manter a concentração.';
    let display = formatClock(getCurrentRemainingMs('pomodoro'));
    let status = focusState.pomodoro.phase === 'focus' ? 'Foco' : 'Pausa';
    let meta = `Rodada ${focusState.pomodoro.cycleIndex} de ${focusState.pomodoro.cycles}`;
    let isRunning = pomodoroRunning;
    let startLabel = focusState.pomodoro.baseRemainingMs < focusState.pomodoro.focusMinutes * 60 * 1000 || focusState.pomodoro.phase === 'break' ? 'Continuar' : 'Iniciar';
    let configHtml = `
      <div class="focus-config-grid">
        <label class="field"><span>Minutos de foco</span><input class="input" type="number" min="1" max="180" value="${focusState.pomodoro.focusMinutes}" data-focus-input="pomodoro-focus" /></label>
        <label class="field"><span>Minutos de pausa</span><input class="input" type="number" min="1" max="60" value="${focusState.pomodoro.breakMinutes}" data-focus-input="pomodoro-break" /></label>
        <label class="field"><span>Quantidade de rodadas</span><input class="input" type="number" min="1" max="12" value="${focusState.pomodoro.cycles}" data-focus-input="pomodoro-cycles" /></label>
      </div>
    `;

    if (focusState.mode === 'timer') {
      title = 'Temporizador';
      subtitle = 'Defina um tempo de estudo e acompanhe a contagem regressiva na matéria escolhida.';
      display = formatClock(getCurrentRemainingMs('timer'));
      status = timerRunning ? 'Em andamento' : 'Pronto para começar';
      meta = `${focusState.timer.minutes} min de estudo`;
      isRunning = timerRunning;
      startLabel = focusState.timer.baseRemainingMs < focusState.timer.minutes * 60 * 1000 ? 'Continuar' : 'Iniciar';
      configHtml = `
        <div class="focus-config-grid single">
          <label class="field"><span>Duração do estudo em minutos</span><input class="input" type="number" min="1" max="999" value="${focusState.timer.minutes}" data-focus-input="timer-minutes" /></label>
        </div>
      `;
    }

    if (focusState.mode === 'stopwatch') {
      title = 'Cronômetro';
      subtitle = 'Estude livremente e registre o tempo dedicado à matéria selecionada.';
      display = formatClock(getCurrentElapsedMs());
      status = stopwatchRunning ? 'Em andamento' : 'Pronto para começar';
      meta = 'O tempo será registrado na matéria selecionada';
      isRunning = stopwatchRunning;
      startLabel = focusState.stopwatch.baseElapsedMs > 0 ? 'Continuar' : 'Iniciar';
      configHtml = '';
    }

    return `
      <details class="section-accordion focus-study-panel" data-focus-panel>
        <summary>
          <div class="section-accordion-head">
            <strong>Área de foco para estudar</strong>
            <div class="section-accordion-meta"><span class="chip">${title}</span><span class="chip">${escapeHtml(status)}</span></div>
          </div>
        </summary>
        <div class="section-accordion-body focus-study-body">
          <div class="item-top focus-panel-head">
          <div>
            <span class="eyebrow">Tempo de estudo</span>
            <h4>${title}</h4>
            <p class="module-subtitle">Selecione uma matéria e registre o tempo de estudo com Pomodoro, temporizador ou cronômetro. O tempo só é salvo ao clicar em Registrar tempo.</p>
          </div>
          <label class="field focus-subject-select">
            <span>Matéria que você vai estudar</span>
            <select class="input" data-focus-input="subject-id">
              <option value="">Escolha uma matéria</option>
              ${subjects.map((subject) => `<option value="${subject.id}" ${subject.id === focusState.subjectId ? 'selected' : ''}>${escapeHtml(subject.name)}</option>`).join('')}
            </select>
          </label>
        </div>

        <div class="timer-mode-tabs">
          <button type="button" class="tab-btn ${focusState.mode === 'pomodoro' ? 'active' : ''}" data-focus-mode="pomodoro">Pomodoro</button>
          <button type="button" class="tab-btn ${focusState.mode === 'timer' ? 'active' : ''}" data-focus-mode="timer">Temporizador</button>
          <button type="button" class="tab-btn ${focusState.mode === 'stopwatch' ? 'active' : ''}" data-focus-mode="stopwatch">Cronômetro</button>
        </div>

        ${configHtml}

        <div class="timer-display" data-focus-display>
          <span class="eyebrow">${escapeHtml(title)}</span>
          <strong data-focus-time>${display}</strong>
          <div class="item-meta focus-status-row">
            <span class="chip" data-focus-status>${escapeHtml(status)}</span>
            <span class="chip" data-focus-meta>${escapeHtml(meta)}</span>
            ${selectedSubject ? `<span class="chip">${escapeHtml(selectedSubject.name)}</span>` : ''}
          </div>
          <small class="module-subtitle" data-focus-subtitle>${escapeHtml(subtitle)}</small>
        </div>

        <div class="focus-study-summary">
          <article class="focus-summary-card">
            <span class="label">Estudado hoje</span>
            <strong>${selectedSubject ? formatStudyDuration(selectedSummary.todayMs) : '0min'}</strong>
          </article>
          <article class="focus-summary-card">
            <span class="label">Estudado nesta semana</span>
            <strong>${selectedSubject ? formatStudyDuration(selectedSummary.weekMs) : '0min'}</strong>
          </article>
          <article class="focus-summary-card">
            <span class="label">Total registrado</span>
            <strong>${selectedSubject ? formatStudyDuration(selectedSummary.totalMs) : '0min'}</strong>
          </article>
        </div>

        <div class="inline-actions timer-actions">
          <button type="button" class="btn btn-primary" data-focus-action="start" ${isRunning ? 'disabled' : ''}>${isRunning ? 'Em andamento' : startLabel}</button>
          <button type="button" class="btn btn-secondary" data-focus-action="pause" ${isRunning ? '' : 'disabled'}>Pausar</button>
          <button type="button" class="btn btn-secondary" data-focus-action="save" ${isRunning ? 'disabled' : ''}>Registrar tempo</button>
          <button type="button" class="btn btn-secondary" data-focus-action="reset">Reiniciar</button>
        </div>
        </div>
      </details>
    `;
  }

  function syncFocusDisplay() {
    if (!root) return;
    const panel = root.querySelector('[data-focus-panel]');
    if (!panel) return;

    const timeNode = panel.querySelector('[data-focus-time]');
    const statusNode = panel.querySelector('[data-focus-status]');
    const metaNode = panel.querySelector('[data-focus-meta]');
    const subtitleNode = panel.querySelector('[data-focus-subtitle]');
    const startButton = panel.querySelector('[data-focus-action="start"]');
    const pauseButton = panel.querySelector('[data-focus-action="pause"]');
    const saveButton = panel.querySelector('[data-focus-action="save"]');

    let isRunning = false;
    let startLabel = 'Iniciar';

    if (focusState.mode === 'pomodoro') {
      const partiallyUsed = focusState.pomodoro.baseRemainingMs < focusState.pomodoro.focusMinutes * 60 * 1000 || focusState.pomodoro.phase === 'break';
      isRunning = focusState.pomodoro.isRunning;
      startLabel = partiallyUsed ? 'Continuar' : 'Iniciar';
      if (timeNode) timeNode.textContent = formatClock(getCurrentRemainingMs('pomodoro'));
      if (statusNode) statusNode.textContent = focusState.pomodoro.isRunning ? 'Em andamento' : (focusState.pomodoro.phase === 'focus' ? 'Pronto para começar' : 'Pausa');
      if (metaNode) metaNode.textContent = `Rodada ${focusState.pomodoro.cycleIndex} de ${focusState.pomodoro.cycles}`;
      if (subtitleNode) subtitleNode.textContent = 'Estude em ciclos de foco com pausas automáticas para manter a concentração.';
    }

    if (focusState.mode === 'timer') {
      isRunning = focusState.timer.isRunning;
      startLabel = focusState.timer.baseRemainingMs < focusState.timer.minutes * 60 * 1000 ? 'Continuar' : 'Iniciar';
      if (timeNode) timeNode.textContent = formatClock(getCurrentRemainingMs('timer'));
      if (statusNode) statusNode.textContent = focusState.timer.isRunning ? 'Em andamento' : 'Pronto para começar';
      if (metaNode) metaNode.textContent = `${focusState.timer.minutes} min de estudo`;
      if (subtitleNode) subtitleNode.textContent = 'Defina um tempo de estudo e acompanhe a contagem regressiva na matéria escolhida.';
    }

    if (focusState.mode === 'stopwatch') {
      isRunning = focusState.stopwatch.isRunning;
      startLabel = focusState.stopwatch.baseElapsedMs > 0 ? 'Continuar' : 'Iniciar';
      if (timeNode) timeNode.textContent = formatClock(getCurrentElapsedMs());
      if (statusNode) statusNode.textContent = focusState.stopwatch.isRunning ? 'Em andamento' : 'Pronto para começar';
      if (metaNode) metaNode.textContent = 'O tempo será registrado na matéria selecionada';
      if (subtitleNode) subtitleNode.textContent = 'Estude livremente e registre o tempo dedicado à matéria selecionada.';
    }

    if (startButton) {
      startButton.disabled = isRunning;
      startButton.textContent = isRunning ? 'Em andamento' : startLabel;
    }
    if (pauseButton) pauseButton.disabled = !isRunning;
    if (saveButton) saveButton.disabled = isRunning;
  }

  function openSubjectForm(subject = null) {
    openModal({
      title: subject ? 'Editar matéria' : 'Criar nova matéria',
      eyebrow: 'Organização dos estudos',
      body: `
        <form id="subject-form" class="stack-form">
          <label class="field"><span>Nome da matéria</span><input class="input" name="name" value="${escapeHtml(subject?.name || '')}" placeholder="Ex.: Matemática, Direito Civil, Inglês" required /></label>
          <label class="field"><span>Área ou categoria</span><input class="input" name="area" value="${escapeHtml(subject?.area || '')}" placeholder="Ex.: Faculdade, curso, concurso ou estudo pessoal" /></label>
          <div class="inline-fields">
            <label class="field"><span>Por quanto tempo você pretende estudar?</span><select class="select" name="studyPeriod">
              <option value="continuous" ${!subject?.studyPeriod || subject?.studyPeriod === 'continuous' ? 'selected' : ''}>Estudo contínuo, sem data final definida</option>
              <option value="year" ${subject?.studyPeriod === 'year' ? 'selected' : ''}>Durante o ano todo</option>
              <option value="deadline" ${subject?.studyPeriod === 'deadline' ? 'selected' : ''}>Até uma data específica</option>
            </select></label>
            <label class="field"><span>Data final (opcional)</span><input class="input" type="date" name="endDate" value="${escapeHtml(toInputDateValue(subject?.endDate || ''))}" /></label>
          </div>
          <label class="field"><span>Anotações gerais</span><textarea class="textarea" name="notes" placeholder="Registre objetivos, conteúdos ou informações importantes sobre esta matéria.">${escapeHtml(subject?.notes || '')}</textarea></label>
          <div class="inline-actions"><button type="button" id="subject-form-cancel" class="btn btn-secondary">Cancelar</button><button type="submit" class="btn btn-primary">${subject ? 'Salvar matéria' : 'Criar matéria'}</button></div>
        </form>
      `,
    });
    document.getElementById('subject-form-cancel').addEventListener('click', closeModal);
    document.getElementById('subject-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const name = String(data.get('name') || '').trim();
      const studyPeriod = data.get('studyPeriod') || 'continuous';
      const endDate = data.get('endDate') || '';
      if (!name) {
        showToast('Informe o nome da matéria antes de salvar.', 'error');
        return;
      }
      if (studyPeriod === 'deadline' && !endDate) {
        showToast('Escolha a data final para acompanhar esta matéria.', 'error');
        return;
      }
      if (event.currentTarget.dataset.submitting === 'true') return;
      event.currentTarget.dataset.submitting = 'true';
      const submitButton = event.currentTarget.querySelector('button[type="submit"]');
      if (submitButton) { submitButton.disabled = true; submitButton.setAttribute('aria-busy', 'true'); }
      try {
        const previous = subject ? cleanObjectForWrite(subject) : null;
        await saveRecord('subjects', {
          name,
          area: data.get('area')?.trim(),
          studyPeriod,
          endDate,
          notes: data.get('notes')?.trim(),
          todos: subject?.todos || [],
          importantDates: subject?.importantDates || [],
          studySessions: subject?.studySessions || [],
          studyTotalMs: subject?.studyTotalMs || 0,
        }, subject?.id || null);
        closeModal();
        if (subject && previous) showUndoToast('Matéria atualizada. Se precisar, você pode desfazer essa alteração.', () => saveRecord('subjects', previous, subject.id));
        else showToast(endDate ? 'Matéria criada. O prazo também aparecerá no calendário.' : 'Matéria criada. Agora você pode adicionar tarefas, datas e anotações.');
      } catch (error) {
        console.error(error);
        event.currentTarget.dataset.submitting = 'false';
        if (submitButton) { submitButton.disabled = false; submitButton.removeAttribute('aria-busy'); }
        showToast('Não foi possível salvar a matéria. Confira as informações e tente novamente.', 'error');
      }
    });
  }

  function openTodoForm(subject, todo = null) {
    const subjectId = normalizeId(subject?.id);
    if (!subjectId) {
      showToast('Não foi possível identificar a matéria desta tarefa. Atualize a página e tente novamente.', 'error');
      return false;
    }

    const getCurrentSubject = () => findSubjectById(subjectId) || subject;
    const subjectName = getCurrentSubject()?.name || subject?.name || 'Matéria';

    const modalOpened = openStudiesModal({
      title: todo ? 'Editar tarefa de estudo' : 'Criar tarefa de estudo',
      eyebrow: subjectName,
      body: `
        <form id="subject-todo-form" class="stack-form" data-skip-unsaved-guard="true">
          <label class="field"><span>O que você precisa fazer?</span><input class="input" name="text" value="${escapeHtml(todo?.text || '')}" placeholder="Ex.: Estudar capítulo 2" required /></label>
          <details class="section-accordion compact-advanced-options"><summary><div class="section-accordion-head"><strong>Mais opções</strong><div class="section-accordion-meta"><span class="chip">Opcional</span></div></div></summary><div class="section-accordion-body"><label class="field"><span>Observação da tarefa</span><textarea class="textarea" name="note" placeholder="Ex.: pontos de atenção, dúvidas, links, páginas ou detalhes para lembrar.">${escapeHtml(getTodoNote(todo))}</textarea></label></div></details>
          <div class="inline-actions"><button type="button" id="subject-todo-cancel" class="btn btn-secondary">Cancelar</button><button type="submit" class="btn btn-primary">${todo ? 'Salvar tarefa' : 'Criar tarefa'}</button></div>
        </form>
      `,
    });

    if (!modalOpened) {
      showToast('Não foi possível abrir o formulário da tarefa. Atualize a página e tente novamente.', 'error');
      return false;
    }

    document.getElementById('subject-todo-cancel')?.addEventListener('click', () => closeStudiesModal());
    document.getElementById('subject-todo-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = new FormData(form);
      const textValue = String(data.get('text') || '').trim();
      const noteValue = String(data.get('note') || '').trim();
      if (!textValue) {
        showToast('Escreva o nome da tarefa de estudo antes de salvar.', 'error');
        return;
      }
      if (form.dataset.submitting === 'true') return;
      form.dataset.submitting = 'true';
      const submitButton = form.querySelector('button[type="submit"]');
      if (submitButton) { submitButton.disabled = true; submitButton.setAttribute('aria-busy', 'true'); }

      const currentSubject = getCurrentSubject();
      const previousTodos = prepareTodosForWrite(getSubjectTodos(currentSubject));
      const todos = [...previousTodos];
      if (todo) {
        const index = todos.findIndex((item) => normalizeId(item.id) === normalizeId(todo.id));
        if (index >= 0) {
          todos[index] = normalizeTodoForWrite({ ...todos[index], text: textValue, note: noteValue });
        } else {
          todos.push(normalizeTodoForWrite({ ...todo, text: textValue, note: noteValue }));
        }
      } else {
        todos.push(normalizeTodoForWrite({ id: createLocalId('study-todo'), text: textValue, note: noteValue, done: false, createdAt: new Date().toISOString() }));
      }

      try {
        const todosForWrite = prepareTodosForWrite(todos);
        await patchRecord('subjects', subjectId, { todos: todosForWrite });
        lastRenderedSubjects = getStudySubjectsFromState().map((item) => normalizeId(item.id) === subjectId ? { ...item, todos: todosForWrite } : item);
        await closeStudiesModal({ force: true });
        showUndoToast(todo ? 'Tarefa de estudo atualizada.' : 'Tarefa criada. Ela fica organizada dentro desta matéria.', () => patchRecord('subjects', subjectId, { todos: previousTodos }));
      } catch (error) {
        console.error(error);
        form.dataset.submitting = 'false';
        if (submitButton) { submitButton.disabled = false; submitButton.removeAttribute('aria-busy'); }
        showToast('Não foi possível salvar a tarefa. Confira as informações e tente novamente.', 'error');
      }
    });

    return true;
  }

  function openImportantDateForm(subject, item = null) {
    openModal({
      title: item ? 'Editar data importante' : 'Criar data importante',
      eyebrow: subject.name,
      body: `
        <form id="subject-date-form" class="stack-form">
          <label class="field"><span>Nome da data importante</span><input class="input" name="title" value="${escapeHtml(item?.title || '')}" placeholder="Ex.: Prova 1" required /></label>
          <div class="inline-fields">
            <label class="field"><span>Tipo</span><input class="input" name="type" value="${escapeHtml(item?.type || '')}" placeholder="Ex.: Prova, entrega, trabalho ou avaliação" /></label>
            <label class="field"><span>Data</span><input class="input" type="date" name="date" value="${escapeHtml(toInputDateValue(item?.date || new Date()))}" required /></label>
          </div>
          <div class="inline-actions"><button type="button" id="subject-date-cancel" class="btn btn-secondary">Cancelar</button><button type="submit" class="btn btn-primary">Salvar data</button></div>
        </form>
      `,
    });
    document.getElementById('subject-date-cancel').addEventListener('click', closeModal);
    document.getElementById('subject-date-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const title = String(data.get('title') || '').trim();
      const date = data.get('date');
      if (!title) {
        showToast('Informe o nome da data importante antes de salvar.', 'error');
        return;
      }
      if (!date) {
        showToast('Escolha a data que deseja acompanhar.', 'error');
        return;
      }
      const importantDates = [...(subject.importantDates || [])];
      if (item) {
        const index = importantDates.findIndex((entry) => entry.id === item.id);
        if (index >= 0) importantDates[index] = { ...importantDates[index], title, type: data.get('type')?.trim(), date };
      } else {
        importantDates.push({ id: crypto.randomUUID(), title, type: data.get('type')?.trim(), date });
      }
      try {
        const previousDates = subject.importantDates || [];
        await patchRecord('subjects', subject.id, { importantDates });
        closeModal();
        showUndoToast('Data importante salva com sucesso.', () => patchRecord('subjects', subject.id, { importantDates: previousDates }));
      } catch (error) {
        console.error(error);
        showToast('Não foi possível salvar a data. Confira as informações e tente novamente.', 'error');
      }
    });
  }


  async function removeTodo(subject, todo) {
    const confirmed = await confirmDialog({
      title: 'Excluir tarefa de estudo',
      description: 'Esta tarefa será enviada para a lixeira e poderá ser restaurada por 7 dias.',
      confirmLabel: 'Enviar para a lixeira',
    });
    if (!confirmed) return;
    try {
      const result = await deleteNestedArrayItem('subjects', subject.id, 'todos', todo.id, {
        title: todo.text ? 'Tarefa de estudo - ' + todo.text : 'Tarefa de estudo',
        moduleLabel: 'Estudos',
        itemType: 'tarefa de estudo',
      });
      showUndoToast('Tarefa enviada para a lixeira.', () => result?.trashId ? restoreDeletedRecord(result.trashId) : Promise.resolve());
    } catch (error) {
      console.error(error);
      showToast('Não foi possível enviar a tarefa para a lixeira. Tente novamente.', 'error');
    }
  }

  async function removeImportantDate(subject, item) {
    const confirmed = await confirmDialog({
      title: 'Excluir data importante',
      description: 'Esta data será enviada para a lixeira e deixará de aparecer no calendário.',
      confirmLabel: 'Enviar para a lixeira',
    });
    if (!confirmed) return;
    try {
      const result = await deleteNestedArrayItem('subjects', subject.id, 'importantDates', item.id, {
        title: item.title ? 'Data importante - ' + item.title : 'Data importante',
        moduleLabel: 'Estudos',
        itemType: 'data importante',
      });
      showUndoToast('Data enviada para a lixeira.', () => result?.trashId ? restoreDeletedRecord(result.trashId) : Promise.resolve());
    } catch (error) {
      console.error(error);
      showToast('Não foi possível enviar a data para a lixeira. Tente novamente.', 'error');
    }
  }

  function applyStudyFilters(subjects = []) {
    const query = studyFilters.query.trim().toLowerCase();
    return subjects.filter((subject) => {
      const todos = getSubjectTodos(subject);
      const pendingTodos = todos.filter((todo) => !todo.done).length;
      const completedTodos = todos.filter((todo) => todo.done).length;
      if (studyFilters.status === 'pending' && pendingTodos === 0) return false;
      if (studyFilters.status === 'completed' && (todos.length === 0 || completedTodos < todos.length)) return false;
      if (studyFilters.dateType !== 'all') {
        const hasDateType = (subject.importantDates || []).some((item) => String(item.type || item.title || '').toLowerCase().includes(studyFilters.dateType));
        if (!hasDateType) return false;
      }
      if (query) {
        const text = [
          subject.name || '',
          subject.area || '',
          subject.notes || '',
          ...getSubjectTodos(subject).map((item) => item.text || ''),
          ...(subject.importantDates || []).map((item) => [item.title || '', item.type || ''].join(' ')),
        ].join(' ').toLowerCase();
        if (!text.includes(query)) return false;
      }
      return true;
    });
  }

  async function removeSubject(subjectId) {
    const confirmed = await confirmDialog({ title: 'Excluir matéria', description: 'Esta matéria será enviada para a lixeira e poderá ser restaurada por 7 dias antes de ser apagada definitivamente.', confirmLabel: 'Enviar para a lixeira' });
    if (!confirmed) return;
    try {
      const result = await deleteRecord('subjects', subjectId);
      showUndoToast('Matéria enviada para a lixeira. Você pode restaurar se precisar.', () => result?.trashId ? restoreDeletedRecord(result.trashId) : Promise.resolve());
    } catch (error) {
      console.error(error);
      showToast('Não foi possível excluir a matéria. Tente novamente.', 'error');
    }
  }

  function subjectCard(subject, open = false) {
    const summary = getStudySummary(subject);
    const finished = isSubjectFinished(subject);
    const todos = getSubjectTodos(subject);
    const importantDates = Array.isArray(subject.importantDates) ? subject.importantDates : [];
    const sessions = getSubjectSessions(subject);
    const notes = subject.notes || '';
    const periodLabel = finished
      ? `Finalizada em ${formatDate(subject.endDate, { day: '2-digit', month: 'short' })}`
      : subject.studyPeriod === 'year' ? 'Ano todo' : subject.studyPeriod === 'deadline' && subject.endDate ? `Até ${formatDate(subject.endDate, { day: '2-digit', month: 'short' })}` : 'Estudo contínuo';
    const todoTotal = todos.length;
    const todoDone = todos.filter((item) => item.done).length;
    const pendingTodos = Math.max(0, todoTotal - todoDone);
    const notesLabel = notes.trim() ? 'Com anotação' : 'Sem anotação';
    return `
      <details class="section-accordion ${finished ? 'is-archived-period' : ''}" ${open ? 'open' : ''} data-search-id="studies:${escapeHtml(subject.id)}" data-subject-id="${escapeHtml(subject.id)}" data-subject-name="${escapeHtml(subject.name || 'Matéria')}" data-subject-area="${escapeHtml(subject.area || '')}">
        <summary>
          <div class="section-accordion-head">
            <strong>${escapeHtml(subject.name)}</strong>
            <div class="section-accordion-meta">
              ${subject.area ? `<span class="chip">${escapeHtml(subject.area)}</span>` : ''}
              <span class="chip">${escapeHtml(periodLabel)}</span>
              <span class="chip">${todoDone}/${todoTotal} tarefa(s) concluída(s)</span>
              <span class="tag">${subject.progress}% concluído</span>
            </div>
          </div>
        </summary>
        <div class="section-accordion-body">
          <div class="item-top">
            <div class="module-subtitle">Acompanhe tarefas, datas importantes, tempo de estudo e anotações desta matéria.</div>
            <div class="inline-actions">
              <button type="button" class="icon-btn small" data-action="edit-subject" data-id="${escapeHtml(subject.id)}">${icon('pencil-line', 'Editar matéria')}</button>
              <button type="button" class="icon-btn small" data-action="delete-subject" data-id="${escapeHtml(subject.id)}">${icon('trash-2', 'Excluir matéria')}</button>
            </div>
          </div>
          <div class="progress"><span style="width:${subject.progress}%"></span></div>
          <div class="focus-study-summary subject-study-summary">
            <article class="focus-summary-card"><span class="label">Estudado hoje</span><strong>${formatStudyDuration(summary.todayMs)}</strong></article>
            <article class="focus-summary-card"><span class="label">Estudado nesta semana</span><strong>${formatStudyDuration(summary.weekMs)}</strong></article>
            <article class="focus-summary-card"><span class="label">Estudado no mês</span><strong>${formatStudyDuration(summary.monthMs)}</strong></article>
            <article class="focus-summary-card"><span class="label">Total registrado</span><strong>${formatStudyDuration(summary.totalMs)}</strong></article>
          </div>
          <div class="subject-content-grid subject-topic-grid">
            <details class="subject-block subject-topic-accordion">
              <summary class="subject-topic-summary">
                <div class="subject-topic-title">
                  <h4>Tarefas de estudo</h4>
                  <span class="module-subtitle">Abra para revisar e concluir suas tarefas.</span>
                </div>
                <div class="section-accordion-meta subject-topic-meta">
                  <span class="chip">${countLabel(todoTotal, 'tarefa', 'tarefas')}</span>
                  <span class="chip">${countLabel(pendingTodos, 'pendente', 'pendentes')}</span>
                </div>
              </summary>
              <div class="subject-topic-body">
                <div class="topic-action-row"><button type="button" class="btn btn-secondary" data-action="new-todo" data-id="${escapeHtml(subject.id)}">Adicionar tarefa</button></div>
                <ul class="task-list">
                  ${todos.map((todo) => `
                    <li class="task-item ${todo.done ? 'is-complete' : ''}">
                      <div class="task-top">
                        <div class="checkbox-row"><input type="checkbox" data-action="toggle-todo" data-id="${escapeHtml(subject.id)}" data-todo="${escapeHtml(todo.id)}" ${todo.done ? 'checked' : ''} /><strong>${escapeHtml(todo.text)}</strong></div>
                        <div class="inline-actions"><button type="button" class="icon-btn small" data-action="edit-todo" data-id="${escapeHtml(subject.id)}" data-todo="${escapeHtml(todo.id)}">${icon('pencil-line', 'Editar tarefa')}</button><button type="button" class="icon-btn small" data-action="delete-todo" data-id="${escapeHtml(subject.id)}" data-todo="${escapeHtml(todo.id)}">${icon('trash-2', 'Excluir tarefa')}</button></div>
                      </div>
                      ${getTodoNote(todo) ? `<p class="task-note">${escapeHtml(getTodoNote(todo)).replaceAll('\n', '<br />')}</p>` : ''}
                    </li>
                  `).join('') || '<li class="agenda-item"><span class="module-subtitle">Nenhuma tarefa cadastrada.</span></li>'}
                </ul>
              </div>
            </details>
            <details class="subject-block subject-topic-accordion">
              <summary class="subject-topic-summary">
                <div class="subject-topic-title">
                  <h4>Datas importantes</h4>
                  <span class="module-subtitle">Abra para acompanhar provas, entregas e prazos.</span>
                </div>
                <div class="section-accordion-meta subject-topic-meta">
                  <span class="chip">${countLabel(importantDates.length, 'data', 'datas')}</span>
                </div>
              </summary>
              <div class="subject-topic-body">
                <div class="topic-action-row"><button type="button" class="btn btn-secondary" data-action="new-important-date" data-id="${escapeHtml(subject.id)}">Adicionar data</button></div>
                <ul class="agenda-list">
                  ${importantDates.map((item) => `
                    <li class="agenda-item">
                      <div class="item-top">
                        <div>
                          <strong>${escapeHtml(item.title)}</strong>
                          <div class="item-meta">${item.type ? `<span class="chip">${escapeHtml(item.type)}</span>` : ""}<span class="chip">${formatDate(item.date, { day: '2-digit', month: 'short' })}</span></div>
                        </div>
                        <div class="inline-actions"><button type="button" class="icon-btn small" data-action="edit-important-date" data-id="${escapeHtml(subject.id)}" data-entry="${escapeHtml(item.id)}">${icon('pencil-line', 'Editar data')}</button><button type="button" class="icon-btn small" data-action="delete-important-date" data-id="${escapeHtml(subject.id)}" data-entry="${escapeHtml(item.id)}">${icon('trash-2', 'Excluir data')}</button></div>
                      </div>
                    </li>
                  `).join('') || '<li class="agenda-item"><span class="module-subtitle">Nenhuma data cadastrada.</span></li>'}
                </ul>
              </div>
            </details>
            <details class="subject-block subject-topic-accordion">
              <summary class="subject-topic-summary">
                <div class="subject-topic-title">
                  <h4>Tempo de estudo</h4>
                  <span class="module-subtitle">Abra para ver os últimos registros de tempo.</span>
                </div>
                <div class="section-accordion-meta subject-topic-meta">
                  <span class="chip">${countLabel(sessions.length, 'registro', 'registros')}</span>
                  <span class="chip">${formatStudyDuration(summary.totalMs)} no total</span>
                </div>
              </summary>
              <div class="subject-topic-body">
                <ul class="agenda-list">
                  ${sessions.slice(0, 6).map((session) => `
                    <li class="agenda-item">
                      <div class="item-top">
                        <div>
                          <strong>${session.mode === 'pomodoro' ? 'Pomodoro' : session.mode === 'timer' ? 'Temporizador' : 'Cronômetro'}</strong>
                          <div class="item-meta"><span class="chip">${formatStudyDuration(session.durationMs)}</span><span class="chip">${formatDate(session.endedAt, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></div>
                        </div>
                        <button type="button" class="icon-btn small" data-action="delete-session" data-id="${escapeHtml(subject.id)}" data-session="${escapeHtml(session.id)}">${icon('trash-2', 'Excluir registro')}</button>
                      </div>
                    </li>
                  `).join('') || '<li class="agenda-item"><span class="module-subtitle">Nenhum tempo registrado.</span></li>'}
                </ul>
              </div>
            </details>
            <details class="subject-block subject-block-notes subject-topic-accordion">
              <summary class="subject-topic-summary">
                <div class="subject-topic-title">
                  <h4>Anotações da matéria</h4>
                  <span class="module-subtitle">Abra para consultar as anotações gerais desta matéria.</span>
                </div>
                <div class="section-accordion-meta subject-topic-meta">
                  <span class="chip">${notesLabel}</span>
                </div>
              </summary>
              <div class="subject-topic-body">
                <div class="subject-notes-box compact-note-box subject-topic-note-box">
                  <div class="rich-preview">${notes.includes('<') ? notes : escapeHtml(notes || 'Nenhuma anotação cadastrada.').replaceAll('\n', '<br />')}</div>
                </div>
              </div>
            </details>
          </div>
        </div>
      </details>
    `;
  }

  function render(state) {
    if (!root) return;
    hydrateFocusState();
    const allSubjects = getStudySubjectViews(state || {});
    lastRenderedSubjects = allSubjects;
    const subjects = applyStudyFilters(allSubjects);
    const ongoingSubjects = subjects.filter((subject) => !isSubjectFinished(subject));
    const finishedGroups = groupSubjectsByMonth(subjects.filter((subject) => isSubjectFinished(subject)));

    root.innerHTML = `
      <div class="section-shell">
        <div class="section-head">
          <div><span class="eyebrow">Minha organização de estudos</span><h3>Estudos</h3><p class="module-subtitle">Organize matérias, acompanhe tarefas, registre datas importantes e controle seu tempo de estudo em um só lugar.</p></div>
          <div class="section-actions"><button type="button" class="btn btn-primary" data-action="new-subject">Criar matéria</button></div>
        </div>
        ${buildFocusPanel(allSubjects)}
        <article class="panel studies-filter-panel">
          <div class="filter-row filter-row-search-top">
            <label class="field search-field-grow"><span>Buscar matéria, prazo ou anotação</span><input class="input" id="studies-filter-query" value="${escapeHtml(studyFilters.query)}" placeholder="Ex.: Matemática, prova, entrega" /></label>
            <label class="field"><span>Status das tarefas</span><select class="select" id="studies-filter-status"><option value="all">Todas</option><option value="pending" ${studyFilters.status === 'pending' ? 'selected' : ''}>Com tarefas pendentes</option><option value="completed" ${studyFilters.status === 'completed' ? 'selected' : ''}>Todas concluídas</option></select></label>
            <label class="field"><span>Tipo de data importante</span><select class="select" id="studies-filter-date-type"><option value="all">Todas</option><option value="prova" ${studyFilters.dateType === 'prova' ? 'selected' : ''}>Provas</option><option value="entrega" ${studyFilters.dateType === 'entrega' ? 'selected' : ''}>Entregas</option><option value="trabalho" ${studyFilters.dateType === 'trabalho' ? 'selected' : ''}>Trabalhos</option><option value="seminário" ${studyFilters.dateType === 'seminário' ? 'selected' : ''}>Seminários</option></select></label>
          </div>
          <div class="muted-box">As datas cadastradas aqui também aparecem no Calendário.</div>
        </article>
        <div class="section-accordion-stack">
          ${subjects.length ? `
            <details class="section-accordion month-accordion" open>
              <summary>
                <div class="section-accordion-head">
                  <strong>Matérias em andamento</strong>
                  <div class="section-accordion-meta"><span class="chip">${ongoingSubjects.length} ${ongoingSubjects.length === 1 ? 'matéria ativa' : 'matérias ativas'}</span><span class="chip">acompanhe sem recriar todo mês</span></div>
                </div>
              </summary>
              <div class="section-accordion-body">
                ${ongoingSubjects.length ? `<div class="section-accordion-stack">${ongoingSubjects.map((subject) => subjectCard(subject, true)).join('')}</div>` : createEmptyState('Nenhuma matéria em andamento', 'Matérias finalizadas ficam organizadas pelo mês de término.')}
              </div>
            </details>
            ${finishedGroups.length ? `
              <details class="section-accordion month-accordion studies-month-history" open>
                <summary>
                  <div class="section-accordion-head">
                    <strong>Matérias finalizadas por mês</strong>
                    <div class="section-accordion-meta"><span class="chip">${finishedGroups.reduce((sum, [, list]) => sum + list.length, 0)} finalizada(s)</span></div>
                  </div>
                </summary>
                <div class="section-accordion-body">
                  <div class="section-accordion-stack">
                    ${finishedGroups.map(([key, list]) => `
                      <details class="section-accordion month-accordion">
                        <summary>
                          <div class="section-accordion-head">
                            <strong>${formatMonthLabel(toDate(`${key}-01`))}</strong>
                            <div class="section-accordion-meta"><span class="chip">${list.length} ${list.length === 1 ? 'matéria' : 'matérias'}</span></div>
                          </div>
                        </summary>
                        <div class="section-accordion-body"><div class="section-accordion-stack">${list.map((subject) => subjectCard(subject, false)).join('')}</div></div>
                      </details>
                    `).join('')}
                  </div>
                </div>
              </details>
            ` : ''}
          ` : createEmptyState('Nenhuma matéria cadastrada ainda', 'Comece adicionando uma matéria para organizar suas tarefas, provas e anotações.', { label: 'Criar matéria', action: 'new-subject' })}
        </div>
      </div>
    `;

    syncFocusDisplay();
    refreshIcons(root);
    bindTodoCreateButtons();
  }

  function init(element) {
    root = element;
    window.__CONTROLY_OPENERS = window.__CONTROLY_OPENERS || {};
    window.__CONTROLY_OPENERS.studies = ({ id, action } = {}) => {
      const subjects = getStudySubjectsFromState();
      const subject = subjects.find((item) => normalizeId(item.id) === normalizeId(id));
      if (action === 'new-todo' && subject) { openTodoForm(subject); return true; }
      if (subject) { openSubjectForm(subject); return true; }
      return false;
    };
    root.addEventListener('input', (event) => {
      if (event.target.id === 'studies-filter-query') {
        studyFilters.query = event.target.value;
        render(window.__CONTROLY_STATE);
      }
    });
    root.addEventListener('click', (event) => {
      const eventElement = getEventElement(event);
      const button = eventElement?.closest?.('[data-action="new-todo"], [data-action="add-todo"], [data-action="create-todo"]');
      if (button) handleTodoCreateClick(event, button);
    }, true);

    root.addEventListener('click', async (event) => {
      const eventElement = getEventElement(event);
      const button = eventElement?.closest?.('[data-action], [data-focus-mode], [data-focus-action]');
      if (!button) return;
      if (button.matches('input[type="checkbox"]') || button.dataset.action === 'toggle-todo') return;
      event.preventDefault();
      event.stopPropagation();
      if (button.disabled || button.getAttribute('aria-busy') === 'true') return;

      if (button.dataset.focusMode) {
        await pauseAllModes();
        focusState.mode = button.dataset.focusMode;
        render(window.__CONTROLY_STATE);
        return;
      }

      if (button.dataset.focusAction) {
        if (button.dataset.focusAction === 'start') await startMode();
        if (button.dataset.focusAction === 'pause') await pauseMode();
        if (button.dataset.focusAction === 'save') { await persistActiveStudyTime(); await resetMode(); }
        if (button.dataset.focusAction === 'reset') await resetMode();
        return;
      }

      const subject = findSubjectFromTrigger(button);
      const todo = getSubjectTodos(subject).find((item) => normalizeId(item.id) === normalizeId(button.dataset.todo));
      const importantDate = subject?.importantDates?.find((item) => normalizeId(item.id) === normalizeId(button.dataset.entry));
      const session = subject?.studySessions?.find((item) => normalizeId(item.id) === normalizeId(button.dataset.session));
      if (button.dataset.action === 'new-subject') { openSubjectForm(); return; }
      if (isTodoCreateAction(button.dataset.action) && !subject) {
        openTodoFormFromTrigger(button);
        return;
      }
      if (button.dataset.action === 'edit-subject' && subject) { openSubjectForm(subject); return; }
      if (button.dataset.action === 'delete-subject' && subject) { await runButtonAction('studies:delete-subject:' + subject.id, button, () => removeSubject(subject.id), { busyText: 'Enviando...' }); return; }
      if (isTodoCreateAction(button.dataset.action) && subject) { openTodoFormFromTrigger(button); return; }
      if (button.dataset.action === 'edit-todo' && subject && todo) { openTodoForm(subject, todo); return; }
      if (button.dataset.action === 'delete-todo' && subject && todo) { await runButtonAction('studies:delete-todo:' + subject.id + ':' + todo.id, button, () => removeTodo(subject, todo), { busyText: 'Enviando...' }); return; }
      if (button.dataset.action === 'new-important-date' && subject) { openImportantDateForm(subject); return; }
      if (button.dataset.action === 'edit-important-date' && subject && importantDate) { openImportantDateForm(subject, importantDate); return; }
      if (button.dataset.action === 'delete-important-date' && subject && importantDate) { await runButtonAction('studies:delete-date:' + subject.id + ':' + importantDate.id, button, () => removeImportantDate(subject, importantDate), { busyText: 'Enviando...' }); return; }
      if (button.dataset.action === 'delete-session' && subject && session) {
        await runButtonAction('studies:delete-session:' + subject.id + ':' + session.id, button, async () => {
          try {
            const result = await deleteNestedArrayItem('subjects', subject.id, 'studySessions', session.id, {
              title: 'Registro de tempo - ' + (subject.name || 'Estudos'),
              moduleLabel: 'Estudos',
              itemType: 'registro de tempo',
            });
            const previousTotal = Number(subject.studyTotalMs || 0);
            const totalMs = Math.max(0, previousTotal - Number(session.durationMs || 0));
            await patchRecord('subjects', subject.id, { studyTotalMs: totalMs });
            showUndoToast('Registro de tempo enviado para a lixeira.', async () => {
              if (result?.trashId) await restoreDeletedRecord(result.trashId);
              await patchRecord('subjects', subject.id, { studyTotalMs: previousTotal });
            });
          } catch (error) {
            console.error(error);
            showToast('Não foi possível enviar o registro para a lixeira. Tente novamente.', 'error');
          }
        }, { busyText: 'Enviando...' });
        return;
      }
    });

    root.addEventListener('change', async (event) => {
      if (event.target.id === 'studies-filter-status') { studyFilters.status = event.target.value; render(window.__CONTROLY_STATE); return; }
      if (event.target.id === 'studies-filter-date-type') { studyFilters.dateType = event.target.value; render(window.__CONTROLY_STATE); return; }
      const changeElement = getEventElement(event);
      const focusInput = changeElement?.closest?.('[data-focus-input]');
      if (focusInput) {
        const inputType = focusInput.dataset.focusInput;
        if (inputType === 'subject-id') {
          await pauseAllModes();
          focusState.subjectId = focusInput.value;
        }
        if (inputType === 'pomodoro-focus') focusState.pomodoro.focusMinutes = clampMinutes(focusInput.value, 25);
        if (inputType === 'pomodoro-break') focusState.pomodoro.breakMinutes = clampMinutes(focusInput.value, 5);
        if (inputType === 'pomodoro-cycles') focusState.pomodoro.cycles = clampCycles(focusInput.value, 4);
        if (inputType === 'timer-minutes') focusState.timer.minutes = clampMinutes(focusInput.value, 30);
        if (['pomodoro-focus', 'pomodoro-break', 'pomodoro-cycles'].includes(inputType)) resetPomodoro();
        if (inputType === 'timer-minutes') resetTimer();
        if (inputType === 'subject-id' && focusState.mode === 'stopwatch') syncFocusDisplay();
        persistFocusState();
        render(window.__CONTROLY_STATE);
        return;
      }

      const checkbox = changeElement?.closest?.('[data-action="toggle-todo"]');
      if (!checkbox) return;
      const subject = findSubjectFromTrigger(checkbox);
      if (!subject) return;
      const previousTodos = prepareTodosForWrite(getSubjectTodos(subject));
      const todos = prepareTodosForWrite(previousTodos.map((item) => normalizeId(item.id) === normalizeId(checkbox.dataset.todo) ? { ...item, done: checkbox.checked } : item));
      try {
        await patchRecord('subjects', subject.id, { todos });
        lastRenderedSubjects = getStudySubjectsFromState().map((item) => normalizeId(item.id) === normalizeId(subject.id) ? { ...item, todos } : item);
        showUndoToast(checkbox.checked ? 'Tarefa de estudo concluída.' : 'Tarefa de estudo reaberta para acompanhamento.', () => patchRecord('subjects', subject.id, { todos: previousTodos }));
      } catch (error) {
        console.error(error);
        showToast('Não foi possível atualizar a tarefa. Tente novamente.', 'error');
      }
    });
  }

  return { id: 'studies', init, render };
}
