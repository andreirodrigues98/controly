import { closeModal, confirmDialog, createEmptyState, icon, openModal, refreshIcons, showToast, showUndoToast } from './ui.js';
import { deleteRecord, patchRecord, restoreDeletedRecord, saveRecord } from './store.js';
import { cleanObjectForWrite, dateKey, escapeHtml, formatDate, formatMonthLabel, monthKey, number, toDate, toInputDateValue } from './utils.js';

const TRAINING_TYPES = {
  gym: 'Academia / Musculação',
  running: 'Corrida',
  cardio: 'Aeróbico / Cardio',
  other: 'Outro treino',
};

function groupByMonth(entries = []) {
  const map = new Map();
  entries.forEach((item) => {
    const key = monthKey(item.date || item.createdAt || new Date());
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  });
  return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

function sortWorkouts(list = []) {
  return [...list].sort((a, b) => (toDate(a.date)?.getTime() || 0) - (toDate(b.date)?.getTime() || 0));
}

function inferTrainingType(workout = {}) {
  if (workout.trainingType) return workout.trainingType;
  const raw = String(workout.type || workout.title || '').toLowerCase();
  if (raw.includes('corrida') || raw.includes('run')) return 'running';
  if (raw.includes('cardio') || raw.includes('aeróbico') || raw.includes('aerobico') || raw.includes('bicicleta')) return 'cardio';
  if (raw.includes('academia') || raw.includes('muscul') || raw.includes('gym')) return 'gym';
  return 'other';
}

function normalizeWorkout(workout = {}) {
  const trainingType = inferTrainingType(workout);
  return {
    ...workout,
    trainingType,
    trainingTypes: Array.isArray(workout.trainingTypes) && workout.trainingTypes.length ? workout.trainingTypes : [trainingType],
    type: workout.type || TRAINING_TYPES[trainingType] || 'Outro treino',
    title: workout.title || (trainingType === 'running' ? 'Corrida' : trainingType === 'gym' ? 'Treino de academia' : trainingType === 'cardio' ? 'Cardio' : 'Treino personalizado'),
    date: workout.date || dateKey(new Date()),
    completed: Boolean(workout.completed || workout.status === 'done' || workout.status === 'completed'),
    status: workout.completed || workout.status === 'done' || workout.status === 'completed' ? 'done' : 'pending',
    exercises: Array.isArray(workout.exercises) ? workout.exercises : [],
  };
}

function getWorkoutSegment(workout = {}, type = '') {
  const segments = Array.isArray(workout.segments) ? workout.segments : [];
  return segments.find((segment) => segment.type === type) || {};
}

function calculatePace(distanceKm, durationMinutes) {
  const distance = number(distanceKm, 0);
  const duration = number(durationMinutes, 0);
  if (distance <= 0 || duration <= 0) return '';
  const minutesPerKm = duration / distance;
  const min = Math.floor(minutesPerKm);
  const sec = Math.round((minutesPerKm - min) * 60);
  return `${min}:${String(sec).padStart(2, '0')}`;
}

function displayWorkoutTitle(title = '') {
  const clean = String(title || 'Treino')
    .replace(/\s*\(reutilizado\)\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean || 'Treino';
}

function exerciseRowTemplate(exercise = {}, index = 0, open = false) {
  const title = exercise.name || `Exercício ${index + 1}`;
  return `
    <details class="section-accordion workout-exercise-row workout-exercise-accordion" data-exercise-row ${open ? 'open' : ''}>
      <summary>
        <div class="section-accordion-head workout-exercise-summary">
          <strong class="truncate-line" data-exercise-title title="${escapeHtml(title)}">${escapeHtml(title)}</strong>
          <div class="section-accordion-meta"><span class="chip">${exercise.sets ? `${exercise.sets} série(s)` : 'Sem detalhes cadastrados'}</span></div>
        </div>
        <button type="button" class="icon-btn small" data-action="remove-exercise-row" aria-label="Remover exercício" title="Remover exercício">${icon('trash-2', 'Remover exercício')}</button>
      </summary>
      <div class="section-accordion-body workout-exercise-body">
        <label class="field"><span>Nome do exercício</span><input class="input" name="exerciseName" value="${escapeHtml(exercise.name || '')}" placeholder="Ex.: Supino reto" /></label>
        <label class="field"><span>Quantidade de séries</span><input class="input" type="number" min="0" name="exerciseSets" value="${exercise.sets ?? ''}" /></label>
        <label class="field"><span>Repetições</span><input class="input" name="exerciseReps" value="${escapeHtml(exercise.reps || '')}" placeholder="Ex.: 8-10" /></label>
        <label class="field"><span>Carga usada</span><input class="input" type="number" step="0.5" min="0" name="exerciseWeight" value="${exercise.weight ?? ''}" /></label>
        <label class="field"><span>Descanso entre séries (segundos)</span><input class="input" type="number" min="0" name="exerciseRest" value="${exercise.restSeconds ?? ''}" /></label>
        <label class="field workout-exercise-notes"><span>Observações do exercício</span><input class="input" name="exerciseNotes" value="${escapeHtml(exercise.notes || '')}" placeholder="Ex.: aumentar carga na próxima semana" /></label>
      </div>
    </details>
  `;
}

function trainingDetails(workout = {}) {
  const item = normalizeWorkout(workout);
  const selectedTypes = Array.isArray(item.trainingTypes) && item.trainingTypes.length ? item.trainingTypes : [item.trainingType];
  if (selectedTypes.length > 1 || Array.isArray(item.segments)) {
    const labels = selectedTypes.map((type) => TRAINING_TYPES[type] || type).join(' + ');
    const segmentDetails = (item.segments || []).map((segment) => {
      const label = TRAINING_TYPES[segment.type] || segment.type || 'Treino';
      const bits = [label];
      if (segment.type === 'running' && segment.distanceKm) bits.push(`${segment.distanceKm} km`);
      if ((segment.type === 'running' || segment.type === 'cardio' || segment.type === 'other') && segment.durationMinutes) bits.push(`${segment.durationMinutes} min`);
      if (segment.type === 'cardio' && segment.modality) bits.push(segment.modality);
      if (segment.type === 'gym' && item.exercises?.length) bits.push(`${item.exercises.length} exercício(s)`);
      return bits.join(' · ');
    });
    return `<details class="section-accordion workout-combined-details"><summary><div class="section-accordion-head workout-combined-summary"><strong class="truncate-line">Resumo do treino combinado</strong><div class="section-accordion-meta workout-combined-meta"><span class="chip truncate-chip" title="${escapeHtml(labels)}">${escapeHtml(labels)}</span><span class="chip">${segmentDetails.length} parte(s) do treino</span></div></div></summary><div class="section-accordion-body"><div class="workout-detail-list">${segmentDetails.map((detail) => `<span title="${escapeHtml(detail)}">${escapeHtml(detail)}</span>`).join('') || '<span>Nenhum detalhe informado.</span>'}</div></div></details>`;
  }
  if (item.trainingType === 'gym') {
    const total = item.exercises.length;
    const names = item.exercises.slice(0, 3).map((exercise) => exercise.name).filter(Boolean).join(' · ');
    return `<div class="workout-detail-list"><span>${total} exercício(s)</span>${names ? `<span>${escapeHtml(names)}</span>` : ''}</div>`;
  }
  if (item.trainingType === 'running') {
    return `<div class="workout-detail-list">${item.distanceKm ? `<span>${item.distanceKm} km</span>` : ''}${item.durationMinutes ? `<span>${item.durationMinutes} min</span>` : ''}${item.pace ? `<span>Pace ${escapeHtml(item.pace)}</span>` : ''}${item.location ? `<span>${escapeHtml(item.location)}</span>` : ''}</div>`;
  }
  if (item.trainingType === 'cardio') {
    return `<div class="workout-detail-list">${item.modality ? `<span>${escapeHtml(item.modality)}</span>` : ''}${item.durationMinutes ? `<span>${item.durationMinutes} min</span>` : ''}${item.intensity ? `<span>Intensidade ${escapeHtml(item.intensity)}</span>` : ''}${item.calories ? `<span>${item.calories} kcal</span>` : ''}</div>`;
  }
  return `<div class="workout-detail-list">${item.modality ? `<span>${escapeHtml(item.modality)}</span>` : ''}${item.durationMinutes ? `<span>${item.durationMinutes} min</span>` : ''}${item.intensity ? `<span>Intensidade ${escapeHtml(item.intensity)}</span>` : ''}${item.location ? `<span>${escapeHtml(item.location)}</span>` : ''}</div>`;
}

export function createWorkoutsModule() {
  let root;
  let filters = { type: 'all', status: 'all', period: 'all', modality: '' };

  function openWorkoutForm(workout = null) {
    const normalized = workout ? normalizeWorkout(workout) : normalizeWorkout({ trainingType: 'gym', date: dateKey(new Date()) });
    const selectedTypes = Array.isArray(normalized.trainingTypes) && normalized.trainingTypes.length ? normalized.trainingTypes : [normalized.trainingType];
    const runningSegment = getWorkoutSegment(normalized, 'running');
    const cardioSegment = getWorkoutSegment(normalized, 'cardio');
    const otherSegment = getWorkoutSegment(normalized, 'other');
    const exercises = normalized.exercises.length ? normalized.exercises : [{}];
    openModal({
      title: workout ? 'Editar treino' : 'Registrar novo treino',
      eyebrow: 'Organização dos treinos',
      body: `
        <form id="workout-form" class="stack-form modal-scroll-form">
          <div class="inline-fields workout-form-grid">
            <label class="field">
              <span>Tipo principal do treino</span>
              <select class="select" name="trainingType" id="workout-training-type">
                ${Object.entries(TRAINING_TYPES).map(([value, label]) => `<option value="${value}" ${normalized.trainingType === value ? 'selected' : ''}>${label}</option>`).join('')}
              </select>
            </label>
            <label class="field">
              <span>Data do treino</span>
              <input class="input" type="date" name="date" value="${escapeHtml(toInputDateValue(normalized.date || dateKey(new Date())))}" required />
            </label>
          </div>
          <div class="field workout-combo-field">
            <span>O que você fez neste treino?</span>
            <div class="workout-combo-types">
              ${Object.entries(TRAINING_TYPES).map(([value, label]) => `<label class="checkbox-line"><input type="checkbox" name="trainingTypes" value="${value}" ${selectedTypes.includes(value) ? 'checked' : ''} /><span>${label}</span></label>`).join('')}
            </div>
            <small class="module-subtitle">Marque mais de uma opção quando fizer, por exemplo, musculação e cardio no mesmo dia.</small>
          </div>
          <label class="field">
            <span>Nome do treino</span>
            <input class="input" name="title" value="${escapeHtml(normalized.title || '')}" placeholder="Ex.: Superior, Corrida leve ou Alongamento" />
          </label>

          <details class="section-accordion workout-type-fields workout-type-accordion" data-workout-fields="gym" ${selectedTypes.includes('gym') ? 'open' : ''}>
            <summary>
              <div class="section-accordion-head">
                <span class="eyebrow">Academia / Musculação</span>
                <strong>Exercícios do treino</strong>
                <div class="section-accordion-meta"><span class="chip">${exercises.filter((exercise) => exercise.name || exercise.sets || exercise.reps || exercise.weight).length || 1} exercício(s)</span></div>
              </div>
            </summary>
            <div class="section-accordion-body workout-type-body">
              <div class="item-top"><div><span class="eyebrow">Detalhes da musculação</span><h4>Exercícios</h4></div><button type="button" class="btn btn-secondary" data-action="add-exercise-row">Adicionar exercício</button></div>
              <div class="workout-exercises-list" id="workout-exercises-list">${exercises.map((exercise, index) => exerciseRowTemplate(exercise, index, !workout && index === 0)).join('')}</div>
            </div>
          </details>

          <details class="section-accordion workout-type-fields workout-type-accordion" data-workout-fields="running" ${selectedTypes.includes('running') ? 'open' : ''}>
            <summary>
              <div class="section-accordion-head">
                <span class="eyebrow">Corrida</span>
                <strong>Distância, tempo e ritmo</strong>
                <div class="section-accordion-meta"><span class="chip">Opcional</span></div>
              </div>
            </summary>
            <div class="section-accordion-body workout-type-body">
              <div class="inline-fields workout-form-grid">
                <label class="field"><span>Distância percorrida (km)</span><input class="input" type="number" step="0.01" min="0" name="distanceKm" id="running-distance" value="${runningSegment.distanceKm ?? normalized.distanceKm ?? ''}" /></label>
                <label class="field"><span>Tempo da corrida (minutos)</span><input class="input" type="number" step="1" min="0" name="durationMinutesRunning" id="running-duration" value="${runningSegment.durationMinutes ?? (normalized.trainingType === 'running' ? (normalized.durationMinutes ?? '') : '')}" /></label>
                <label class="field"><span>Ritmo por km</span><input class="input" name="pace" id="running-pace" value="${escapeHtml(runningSegment.pace || normalized.pace || '')}" placeholder="Preenchido pela distância e pelo tempo" /></label>
                <label class="field"><span>Local da corrida</span><input class="input" name="location" value="${escapeHtml(runningSegment.location || normalized.location || '')}" placeholder="Rua, esteira, parque..." /></label>
                <label class="field"><span>Esforço percebido (1 a 10)</span><input class="input" type="number" min="1" max="10" name="effortLevel" value="${runningSegment.effortLevel ?? normalized.effortLevel ?? ''}" /></label>
              </div>
            </div>
          </details>

          <details class="section-accordion workout-type-fields workout-type-accordion" data-workout-fields="cardio" ${selectedTypes.includes('cardio') ? 'open' : ''}>
            <summary>
              <div class="section-accordion-head">
                <span class="eyebrow">Aeróbico / Cardio</span>
                <strong>Modalidade, tempo e intensidade</strong>
                <div class="section-accordion-meta"><span class="chip">Opcional</span></div>
              </div>
            </summary>
            <div class="section-accordion-body workout-type-body">
              <div class="inline-fields workout-form-grid">
                <label class="field"><span>Modalidade do cardio</span><input class="input" name="modality" value="${escapeHtml(cardioSegment.modality || normalized.modality || '')}" placeholder="Ex.: Bicicleta, elíptico, escada" /></label>
                <label class="field"><span>Tempo do cardio (minutos)</span><input class="input" type="number" min="0" name="durationMinutesCardio" value="${cardioSegment.durationMinutes ?? (normalized.trainingType === 'cardio' ? (normalized.durationMinutes ?? '') : '')}" /></label>
                <label class="field"><span>Intensidade</span><select class="select" name="intensity"><option value="">Selecione</option>${['leve','moderada','alta'].map((value) => `<option value="${value}" ${(cardioSegment.intensity || normalized.intensity) === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
                <label class="field"><span>Calorias gastas (opcional)</span><input class="input" type="number" min="0" name="calories" value="${cardioSegment.calories ?? normalized.calories ?? ''}" /></label>
                <label class="field"><span>Frequência cardíaca (opcional)</span><input class="input" type="number" min="0" name="heartRate" value="${cardioSegment.heartRate ?? normalized.heartRate ?? ''}" /></label>
              </div>
            </div>
          </details>

          <details class="section-accordion workout-type-fields workout-type-accordion" data-workout-fields="other" ${selectedTypes.includes('other') ? 'open' : ''}>
            <summary>
              <div class="section-accordion-head">
                <span class="eyebrow">Outros treinos</span>
                <strong>Modalidade e duração</strong>
                <div class="section-accordion-meta"><span class="chip">Opcional</span></div>
              </div>
            </summary>
            <div class="section-accordion-body workout-type-body">
              <div class="inline-fields workout-form-grid">
                <label class="field"><span>Modalidade do treino</span><select class="select" name="otherModality"><option value="">Escolha uma opção</option>${['Alongamento','Esporte','Fisioterapia','Mobilidade','Yoga / Pilates','Outro'].map((value) => `<option value="${value}" ${(otherSegment.modality || normalized.modality) === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
                <label class="field"><span>Duração do treino (minutos)</span><input class="input" type="number" min="0" name="durationMinutesOther" value="${otherSegment.durationMinutes ?? (normalized.trainingType === 'other' ? (normalized.durationMinutes ?? '') : '')}" placeholder="Ex.: 30" /></label>
                <label class="field"><span>Intensidade</span><select class="select" name="intensityOther"><option value="">Selecione</option>${['leve','moderada','alta'].map((value) => `<option value="${value}" ${(otherSegment.intensity || normalized.intensity) === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
                <label class="field"><span>Local ou referência</span><input class="input" name="locationOther" value="${escapeHtml(otherSegment.location || (normalized.trainingType === 'other' ? (normalized.location || '') : ''))}" placeholder="Ex.: casa, quadra, clínica" /></label>
              </div>
            </div>
          </details>

          <div class="inline-fields workout-form-grid">
            <label class="field"><span>Situação do treino</span><select class="select" name="completed"><option value="false" ${normalized.completed ? '' : 'selected'}>Ainda vou fazer</option><option value="true" ${normalized.completed ? 'selected' : ''}>Já concluí</option></select></label>
          </div>
          <label class="field"><span>Observações sobre o treino</span><textarea class="textarea" name="notes" placeholder="Registre ajustes, desempenho ou pontos para o próximo treino.">${escapeHtml(normalized.notes || '')}</textarea></label>
          <div class="inline-actions sticky-modal-actions">
            <button type="button" id="workout-form-cancel" class="btn btn-secondary">Cancelar</button>
            <button type="submit" class="btn btn-primary">${workout ? 'Salvar treino' : 'Registrar treino'}</button>
          </div>
        </form>
      `,
    });

    const form = document.getElementById('workout-form');
    const typeSelect = document.getElementById('workout-training-type');
    const getCheckedTypes = () => [...document.querySelectorAll('[name="trainingTypes"]:checked')].map((input) => input.value);
    const syncTypeFields = () => {
      let selected = getCheckedTypes();
      if (!selected.length) {
        const fallback = typeSelect.value || 'gym';
        const fallbackInput = document.querySelector(`[name="trainingTypes"][value="${fallback}"]`);
        if (fallbackInput) fallbackInput.checked = true;
        selected = [fallback];
      }
      if (!selected.includes(typeSelect.value)) typeSelect.value = selected[0];
      document.querySelectorAll('[data-workout-fields]').forEach((section) => {
        const visible = selected.includes(section.dataset.workoutFields);
        section.classList.toggle('hidden', !visible);
        if (visible && section.tagName === 'DETAILS' && !section.open) section.open = true;
      });
    };
    const syncPace = () => {
      const paceInput = document.getElementById('running-pace');
      const pace = calculatePace(document.getElementById('running-distance')?.value, document.getElementById('running-duration')?.value);
      if (paceInput && pace) paceInput.value = pace;
    };

    typeSelect?.addEventListener('change', () => {
      const checkbox = document.querySelector(`[name="trainingTypes"][value="${typeSelect.value}"]`);
      if (checkbox) checkbox.checked = true;
      syncTypeFields();
    });
    document.querySelectorAll('[name="trainingTypes"]').forEach((input) => input.addEventListener('change', syncTypeFields));
    document.getElementById('running-distance')?.addEventListener('input', syncPace);
    document.getElementById('running-duration')?.addEventListener('input', syncPace);
    syncTypeFields();

    document.getElementById('workout-form-cancel')?.addEventListener('click', closeModal);
    form?.addEventListener('click', (event) => {
      const actionButton = event.target.closest('[data-action]');
      if (!actionButton) return;
      if (actionButton.dataset.action === 'add-exercise-row') {
        const list = document.getElementById('workout-exercises-list');
        const nextIndex = document.querySelectorAll('[data-exercise-row]').length;
        document.querySelectorAll('[data-exercise-row]').forEach((row) => row.open = false);
        list?.insertAdjacentHTML('beforeend', exerciseRowTemplate({}, nextIndex, true));
        const rows = document.querySelectorAll('[data-exercise-row]');
        rows[rows.length - 1]?.setAttribute('open', '');
        refreshIcons(form);
      }
      if (actionButton.dataset.action === 'remove-exercise-row') {
        const rows = [...document.querySelectorAll('[data-exercise-row]')];
        if (rows.length > 1) {
          actionButton.closest('[data-exercise-row]')?.remove();
          const remaining = [...document.querySelectorAll('[data-exercise-row]')];
          if (!remaining.some((row) => row.open)) remaining[0]?.setAttribute('open', '');
        }
      }
    });

    form?.addEventListener('input', (event) => {
      if (event.target?.name === 'exerciseName') {
        const row = event.target.closest('[data-exercise-row]');
        const titleNode = row?.querySelector('[data-exercise-title]');
        const value = event.target.value.trim();
        if (titleNode) titleNode.textContent = value || 'Exercício ainda sem nome';
      }
    });

    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const selectedTypes = [...document.querySelectorAll('[name="trainingTypes"]:checked')].map((input) => input.value);
      const trainingTypes = selectedTypes.length ? selectedTypes : [formData.get('trainingType') || 'other'];
      const trainingType = trainingTypes[0] || 'other';
      const combined = trainingTypes.length > 1;
      const defaultTitle = combined
        ? `Treino combinado: ${trainingTypes.map((type) => TRAINING_TYPES[type] || type).join(' + ')}`
        : (trainingType === 'running' ? 'Corrida' : trainingType === 'gym' ? 'Treino de academia' : trainingType === 'cardio' ? (String(formData.get('modality') || '').trim() || 'Cardio') : (String(formData.get('otherModality') || '').trim() || 'Treino'));
      const title = String(formData.get('title') || '').trim() || defaultTitle;
      const payload = {
        title,
        trainingType,
        trainingTypes,
        type: combined ? trainingTypes.map((type) => TRAINING_TYPES[type] || type).join(' + ') : (TRAINING_TYPES[trainingType] || 'Outro treino'),
        date: formData.get('date') || dateKey(new Date()),
        notes: String(formData.get('notes') || '').trim(),
        completed: formData.get('completed') === 'true',
        status: formData.get('completed') === 'true' ? 'done' : 'pending',
        segments: trainingTypes.map((type) => ({ type, label: TRAINING_TYPES[type] || type })),
      };

      if (trainingTypes.includes('gym')) {
        payload.exercises = [...document.querySelectorAll('[data-exercise-row]')].map((row) => ({
          name: row.querySelector('[name="exerciseName"]')?.value?.trim() || '',
          sets: number(row.querySelector('[name="exerciseSets"]')?.value, 0),
          reps: row.querySelector('[name="exerciseReps"]')?.value?.trim() || '',
          weight: number(row.querySelector('[name="exerciseWeight"]')?.value, 0),
          restSeconds: number(row.querySelector('[name="exerciseRest"]')?.value, 0),
          notes: row.querySelector('[name="exerciseNotes"]')?.value?.trim() || '',
        })).filter((exercise) => exercise.name || exercise.sets || exercise.reps || exercise.weight || exercise.notes);
        payload.segments = payload.segments.map((segment) => segment.type === 'gym' ? { ...segment, exercisesCount: payload.exercises.length } : segment);
      }

      if (trainingTypes.includes('running')) {
        const running = {
          distanceKm: number(formData.get('distanceKm'), 0),
          durationMinutes: number(formData.get('durationMinutesRunning'), 0),
          pace: String(formData.get('pace') || calculatePace(formData.get('distanceKm'), formData.get('durationMinutesRunning')) || '').trim(),
          location: String(formData.get('location') || '').trim(),
          effortLevel: number(formData.get('effortLevel'), 0),
        };
        Object.assign(payload, combined ? {} : running);
        payload.segments = payload.segments.map((segment) => segment.type === 'running' ? { ...segment, ...running } : segment);
      }

      if (trainingTypes.includes('cardio')) {
        const cardio = {
          modality: String(formData.get('modality') || '').trim(),
          durationMinutes: number(formData.get('durationMinutesCardio'), 0),
          intensity: String(formData.get('intensity') || '').trim(),
          calories: number(formData.get('calories'), 0),
          heartRate: number(formData.get('heartRate'), 0),
        };
        Object.assign(payload, combined ? {} : cardio);
        payload.segments = payload.segments.map((segment) => segment.type === 'cardio' ? { ...segment, ...cardio } : segment);
      }

      if (trainingTypes.includes('other')) {
        const other = {
          modality: String(formData.get('otherModality') || '').trim(),
          durationMinutes: number(formData.get('durationMinutesOther'), 0),
          intensity: String(formData.get('intensityOther') || '').trim(),
          location: String(formData.get('locationOther') || '').trim(),
        };
        Object.assign(payload, combined ? {} : other);
        payload.segments = payload.segments.map((segment) => segment.type === 'other' ? { ...segment, ...other } : segment);
      }

      try {
        const previous = workout ? cleanObjectForWrite(workout) : null;
        await saveRecord('workouts', payload, workout?.id || null);
        closeModal();
        if (workout && previous) showUndoToast('Treino atualizado. Você pode desfazer esta alteração.', () => saveRecord('workouts', previous, workout.id));
        else showToast('Treino registrado com sucesso.');
      } catch (error) {
        console.error(error);
        showToast('Não foi possível salvar o treino. Confira as informações e tente novamente.', 'error');
      }
    });
  }

  async function handleDelete(workout) {
    const confirmed = await confirmDialog({ title: 'Excluir treino', description: 'Este treino será enviado para a lixeira e poderá ser restaurado por 7 dias antes de ser apagado definitivamente.', confirmLabel: 'Enviar para a lixeira' });
    if (!confirmed) return;
    try {
      const result = await deleteRecord('workouts', workout.id);
      showUndoToast('Treino enviado para a lixeira. Você pode restaurar se precisar.', () => result?.trashId ? restoreDeletedRecord(result.trashId) : Promise.resolve());
    } catch (error) {
      console.error(error);
      showToast('Não foi possível excluir o treino. Tente novamente.', 'error');
    }
  }

  function applyWorkoutFilters(list = []) {
    const currentMonth = monthKey(new Date());
    const term = filters.modality.trim().toLowerCase();
    return list.map(normalizeWorkout).filter((workout) => {
      const workoutTypes = Array.isArray(workout.trainingTypes) && workout.trainingTypes.length ? workout.trainingTypes : [workout.trainingType].filter(Boolean);
      if (filters.type !== 'all' && !workoutTypes.includes(filters.type)) return false;
      if (filters.status === 'done' && !workout.completed) return false;
      if (filters.status === 'pending' && workout.completed) return false;
      if (filters.period === 'current' && monthKey(workout.date) !== currentMonth) return false;
      if (term) {
        const text = `${workout.title || ''} ${workout.type || ''} ${workout.modality || ''} ${(workout.trainingTypes || []).join(' ')} ${(workout.segments || []).map((segment) => `${segment.label || ''} ${segment.summary || ''}`).join(' ')} ${(workout.exercises || []).map((exercise) => exercise.name).join(' ')}`.toLowerCase();
        if (!text.includes(term)) return false;
      }
      return true;
    });
  }

  function renderWorkoutCard(workoutRaw) {
    const workout = normalizeWorkout(workoutRaw);
    const workoutTypes = Array.isArray(workout.trainingTypes) && workout.trainingTypes.length ? workout.trainingTypes : [workout.trainingType].filter(Boolean);
    const workoutTypesLabel = workoutTypes.map((type) => TRAINING_TYPES[type] || type).filter(Boolean).join(' + ') || workout.type || 'Outro treino';
    const displayTitle = displayWorkoutTitle(workout.title);
    return `
      <article class="workout-compact-card ${workout.completed ? 'is-complete' : ''}" data-search-id="workouts:${workout.id}">
        <div class="workout-date-panel">
          <div class="workout-date-head">${icon('calendar-days', 'Data do treino')}<span>Data</span></div>
          <div class="workout-date-card"><strong>${formatDate(workout.date, { day: '2-digit', month: '2-digit' })}</strong><small>${formatDate(workout.date, { weekday: 'short' })}</small></div>
          <label class="workout-check-row"><input class="workout-check" type="checkbox" data-action="toggle-workout-check" data-id="${workout.id}" ${workout.completed ? 'checked' : ''} /><span>${workout.completed ? 'Concluído' : 'Marcar como concluído'}</span></label>
        </div>
        <div class="workout-main-panel">
          <div class="workout-top-row">
            <div>
              <strong class="workout-card-title" title="${escapeHtml(displayTitle)}">${escapeHtml(displayTitle)}</strong>
              <div class="item-meta workout-card-meta"><span class="chip truncate-chip" title="${escapeHtml(workoutTypesLabel)}">${escapeHtml(workoutTypesLabel)}</span><span class="tag ${workout.completed ? 'success' : 'medium'}">${workout.completed ? 'Concluído' : 'Pendente'}</span></div>
            </div>
            <div class="inline-actions"><button type="button" class="icon-btn small" data-action="duplicate-workout" data-id="${workout.id}">${icon('copy-plus', 'Repetir este treino hoje')}</button><button type="button" class="icon-btn small" data-action="edit-workout" data-id="${workout.id}">${icon('pencil-line', 'Editar treino')}</button><button type="button" class="icon-btn small" data-action="delete-workout" data-id="${workout.id}">${icon('trash-2', 'Excluir treino')}</button></div>
          </div>
          ${trainingDetails(workout)}
          ${workout.notes ? `<p class="module-subtitle">${escapeHtml(workout.notes)}</p>` : '<p class="module-subtitle">Registre observações sobre ajustes, desempenho ou detalhes deste treino.</p>'}
        </div>
      </article>
    `;
  }

  function renderMonthSection(label, workouts, open = false, isCurrentMonth = false) {
    const completed = workouts.filter((item) => normalizeWorkout(item).completed).length;
    return `
      <details class="section-accordion month-accordion" ${open ? 'open' : ''}>
        <summary>
          <div class="section-accordion-head">
            <strong>${escapeHtml(label)}</strong>
            <div class="section-accordion-meta">${isCurrentMonth ? '<span class="chip">mês atual</span>' : '<span class="chip">mês anterior</span>'}<span class="chip">${completed} de ${workouts.length} concluído(s)</span></div>
          </div>
        </summary>
        <div class="section-accordion-body"><div class="workout-month-grid">${workouts.map(renderWorkoutCard).join('')}</div></div>
      </details>
    `;
  }

  function render(state) {
    if (!root) return;
    const normalizedWorkouts = state.workouts.map(normalizeWorkout);
    const filtered = applyWorkoutFilters(normalizedWorkouts);
    const ordered = sortWorkouts(filtered);
    const completedCount = filtered.filter((workout) => workout.completed).length;
    const monthGroups = groupByMonth(ordered);
    const currentMonthValue = monthKey(new Date());
    const currentMonthEntries = monthGroups.find(([key]) => key === currentMonthValue)?.[1] || [];
    const archiveEntries = monthGroups.filter(([key]) => key !== currentMonthValue);

    root.innerHTML = `
      <div class="section-shell">
        <div class="section-head">
          <div><span class="eyebrow">Minha rotina de treinos</span><h3>Treinos</h3><p class="module-subtitle">Registre academia, corrida, cardio ou outros treinos e acompanhe sua frequência ao longo do mês.</p></div>
          <div class="section-actions"><button class="btn btn-primary" type="button" data-action="new-workout">Registrar treino</button></div>
        </div>

        <div class="stat-grid compact-stats mobile-rail mobile-rail-cards">
          <article class="stat-card"><span class="label">Treinos encontrados</span><strong>${filtered.length}</strong></article>
          <article class="stat-card"><span class="label">Concluídos</span><strong>${completedCount}</strong></article>
          <article class="stat-card"><span class="label">Pendentes</span><strong>${filtered.length - completedCount}</strong></article>
          <article class="stat-card"><span class="label">Neste mês</span><strong>${currentMonthEntries.length}</strong></article>
        </div>

        <article class="panel">
          <div class="filter-row filter-row-search-top workout-filter-row">
            <label class="field"><span>Tipo de treino</span><select class="select" id="workout-filter-type"><option value="all">Todos os tipos</option>${Object.entries(TRAINING_TYPES).map(([value, label]) => `<option value="${value}" ${filters.type === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
            <label class="field"><span>Situação</span><select class="select" id="workout-filter-status"><option value="all">Todos</option><option value="pending" ${filters.status === 'pending' ? 'selected' : ''}>Pendentes</option><option value="done" ${filters.status === 'done' ? 'selected' : ''}>Concluídos</option></select></label>
            <label class="field"><span>Período</span><select class="select" id="workout-filter-period"><option value="all">Todos os períodos</option><option value="current" ${filters.period === 'current' ? 'selected' : ''}>Apenas mês atual</option></select></label>
            <label class="field search-field-grow"><span>Buscar por modalidade, exercício ou treino</span><input class="input" id="workout-filter-modality" value="${escapeHtml(filters.modality)}" placeholder="Ex.: supino, corrida, bicicleta" /></label>
          </div>
        </article>

        <div class="section-accordion-stack">
          ${currentMonthEntries.length ? renderMonthSection(formatMonthLabel(toDate(`${currentMonthValue}-01`)), currentMonthEntries, true, true) : `<article class="panel">${createEmptyState('Nenhum treino registrado neste mês', 'Registre um treino para acompanhar sua evolução.', { label: 'Registrar treino', action: 'new-workout' })}</article>`}
          ${archiveEntries.map(([key, workouts]) => renderMonthSection(formatMonthLabel(toDate(`${key}-01`)), workouts, false, false)).join('')}
        </div>
      </div>
    `;
    refreshIcons(root);
  }

  function init(element) {
    root = element;
    window.__CONTROLY_OPENERS = window.__CONTROLY_OPENERS || {};
    window.__CONTROLY_OPENERS.workouts = ({ id, action } = {}) => {
      if (action === 'new-workout') { openWorkoutForm(); return true; }
      const workout = (window.__CONTROLY_STATE?.workouts || []).find((item) => String(item.id || '') === String(id || ''));
      if (workout) { openWorkoutForm(workout); return true; }
      return false;
    };
    root.addEventListener('input', (event) => {
      if (event.target.id === 'workout-filter-modality') {
        filters.modality = event.target.value;
        render(window.__CONTROLY_STATE);
      }
    });
    root.addEventListener('change', (event) => {
      if (event.target.id === 'workout-filter-type') filters.type = event.target.value;
      if (event.target.id === 'workout-filter-status') filters.status = event.target.value;
      if (event.target.id === 'workout-filter-period') filters.period = event.target.value;
      if (event.target.id?.startsWith('workout-filter-')) render(window.__CONTROLY_STATE);
    });
    root.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      const action = button.dataset.action;
      const id = button.dataset.id;
      const workout = id ? window.__CONTROLY_STATE.workouts.find((item) => item.id === id) : null;
      if (action === 'new-workout') openWorkoutForm();
      if (action === 'edit-workout' && workout) openWorkoutForm(workout);
      if (action === 'delete-workout' && workout) await handleDelete(workout);
      if (action === 'duplicate-workout' && workout) {
        const normalized = normalizeWorkout(workout);
        const reuseNote = `Treino repetido com base no registro de ${formatDate(normalized.date, { day: '2-digit', month: 'long', year: 'numeric' })}.`;
        const copy = cleanObjectForWrite({ ...workout, date: dateKey(new Date()), completed: false, status: 'pending', title: displayWorkoutTitle(normalized.title), notes: [reuseNote, workout.notes || ''].filter(Boolean).join(' ') });
        try {
          const saved = await saveRecord('workouts', copy);
          showUndoToast('Treino repetido para hoje. Você pode editar os detalhes.', async () => {
            if (saved?.id) await deleteRecord('workouts', saved.id);
          });
        } catch (error) {
          console.error(error);
          showToast('Não foi possível repetir este treino. Tente novamente.', 'error');
        }
      }
      if (action === 'toggle-workout-check' && workout) {
        try {
          window.__CONTROLY_SILENT_UPDATE?.('workouts', 'workouts', 900);
          const normalized = normalizeWorkout(workout);
          await patchRecord('workouts', workout.id, { completed: !normalized.completed, status: !normalized.completed ? 'done' : 'pending' });
          showUndoToast(!normalized.completed ? 'Treino marcado como concluído.' : 'Treino reaberto como pendente.', () => patchRecord('workouts', workout.id, { completed: normalized.completed, status: normalized.status }));
        } catch (error) {
          console.error(error);
          showToast('Não foi possível atualizar o treino. Tente novamente.', 'error');
        }
      }
    });
  }

  return { id: 'workouts', init, render };
}