import { login, logout, watchAuth } from './auth.js';
import { firebaseIsConfigured } from './firebase.js';
import { createActivitiesModule } from './module.activities.js';
import { createCalendarModule } from './module.calendar.js';
import { createDashboardModule } from './module.dashboard.js';
import { createFinanceModule } from './module.finance.js';
import { createGoalsModule } from './module.goals.js';
import { createNotesModule } from './module.notes.js';
import { createReadingModule } from './module.reading.js';
import { createSearchModule, initGlobalSearch } from './module.search.js';
import { createTrashModule } from './module.trash.js';
import { createStudiesModule } from './module.studies.js?v=estudos-tarefa-fix-20260428';
import { createWorkoutsModule } from './module.workouts.js';
import { ensureUserProfile, startSubscriptions, stopSubscriptions } from './store.js';
import { onStateChange, resetState, setCollection, setCurrentSection, setUser, state } from './state.js';
import {
  bindNavigation,
  confirmLeaveOpenModal,
  hideLoader,
  refreshIcons,
  setActiveSection,
  showAppShell,
  showAuthShell,
  showLoader,
  showToast,
  updateTopbarDate,
  updateUserBadge,
} from './ui.js';
import { formatDate } from './utils.js';

const loginForm = document.getElementById('login-form');
const loginEmail = document.getElementById('login-email');
const loginPassword = document.getElementById('login-password');
const loginFeedback = document.getElementById('login-feedback');
const logoutButtons = [document.getElementById('logout-btn'), document.getElementById('topbar-logout-btn')].filter(Boolean);

const modules = [
  createDashboardModule(),
  createActivitiesModule(),
  createCalendarModule(),
  createGoalsModule(),
  createStudiesModule(),
  createReadingModule(),
  createWorkoutsModule(),
  createFinanceModule(),
  createNotesModule(),
  createSearchModule(),
  createTrashModule(),
];

modules.forEach((module) => {
  const section = document.getElementById(`section-${module.id}`);
  module.init(section);
});

const moduleMap = new Map(modules.map((module) => [module.id, module]));
const COLLECTION_RENDER_TARGETS = {
  activities: ['activities', 'dashboard', 'calendar', 'search'],
  tasks: ['activities', 'dashboard', 'calendar', 'search'],
  habits: ['activities', 'dashboard', 'calendar', 'search'],
  routines: ['activities', 'dashboard', 'calendar', 'search'],
  events: ['calendar', 'dashboard', 'search'],
  goals: ['goals', 'dashboard', 'search'],
  notes: ['notes', 'search'],
  subjects: ['studies', 'dashboard', 'calendar', 'search'],
  studySessions: ['studies', 'dashboard', 'search'],
  studyMaterials: ['studies', 'search'],
  readingItems: ['reading', 'dashboard', 'search'],
  workouts: ['workouts', 'dashboard', 'calendar', 'search'],
  financeCards: ['finance', 'dashboard', 'calendar', 'search'],
  financeEntries: ['finance', 'dashboard', 'calendar', 'search'],
  trash: ['trash', 'search'],
};

initGlobalSearch({
  getState: () => window.__CONTROLY_STATE,
  navigate,
});

window.__CONTROLY_STATE = state;

const silentRenderLocks = new Map();

function lockKey(collectionName, sectionId) {
  return `${collectionName}:${sectionId}`;
}

function isSilentRenderLocked(collectionName, sectionId) {
  const expiresAt = silentRenderLocks.get(lockKey(collectionName, sectionId));
  if (!expiresAt) return false;
  if (expiresAt <= Date.now()) {
    silentRenderLocks.delete(lockKey(collectionName, sectionId));
    return false;
  }
  return true;
}

window.__CONTROLY_SILENT_UPDATE = (collectionName, sectionId = state.currentSection, ttl = 1200) => {
  if (!collectionName || !sectionId) return;
  silentRenderLocks.set(lockKey(collectionName, sectionId), Date.now() + Number(ttl || 1200));
};

function detailIdentity(detail, index) {
  const explicit = detail.dataset.searchId || detail.dataset.goalCard || detail.id || '';
  const summary = detail.querySelector('summary')?.textContent?.replace(/\s+/g, ' ').trim() || '';
  return explicit || `${index}:${summary}`;
}

function captureSectionUiState(section) {
  if (!section) return { details: new Map(), scrollTop: 0 };
  const details = new Map();
  section.querySelectorAll('details').forEach((detail, index) => {
    details.set(detailIdentity(detail, index), detail.open);
  });
  return { details, scrollTop: section.scrollTop || 0 };
}

function restoreSectionUiState(section, snapshot) {
  if (!section || !snapshot) return;
  section.querySelectorAll('details').forEach((detail, index) => {
    const key = detailIdentity(detail, index);
    if (snapshot.details.has(key)) detail.open = snapshot.details.get(key);
  });
  if (snapshot.scrollTop) section.scrollTop = snapshot.scrollTop;
}

function renderModules(moduleIds) {
  window.__CONTROLY_STATE = state;
  [...new Set(moduleIds)].forEach((id) => {
    const section = document.getElementById(`section-${id}`);
    const uiSnapshot = captureSectionUiState(section);
    moduleMap.get(id)?.render(state);
    restoreSectionUiState(section, uiSnapshot);
  });
  refreshIcons();
}

function renderAll() {
  renderModules(modules.map((module) => module.id));
}

function renderForChange(changeKey) {
  if (!changeKey || changeKey === 'reset' || changeKey === 'user') {
    renderAll();
    return;
  }
  if (changeKey === 'currentSection') {
    renderModules([state.currentSection || 'dashboard']);
    return;
  }

  const current = state.currentSection || 'dashboard';
  const targets = COLLECTION_RENDER_TARGETS[changeKey] || [current, 'dashboard'];
  const visibleTargets = targets.filter((id) => !(id === current && isSilentRenderLocked(changeKey, id)));
  renderModules(visibleTargets);
}

function renderTimeSensitiveViews() {
  if (!state.user) return;
  const current = state.currentSection || 'dashboard';
  renderModules(['dashboard', 'activities', 'calendar', 'goals', 'trash', current]);
}

function navigate(section) {
  setCurrentSection(section);
  setActiveSection(section);
}

function setupDateLabel() {
  const refresh = () => {
    updateTopbarDate(formatDate(new Date(), { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }));
  };
  refresh();
  setInterval(refresh, 60000);
}

function friendlyAuthMessage(error) {
  const map = {
    'auth/invalid-credential': 'Credenciais inválidas. Confira e-mail e senha.',
    'auth/user-not-found': 'Usuário não encontrado.',
    'auth/wrong-password': 'Senha incorreta.',
    'auth/invalid-email': 'E-mail inválido.',
    'auth/too-many-requests': 'Muitas tentativas. Aguarde um pouco e tente novamente.',
  };
  return map[error?.code] || 'Não foi possível entrar. Confira e-mail e senha e tente novamente.';
}

async function handleLogout() {
  try {
    showLoader('Saindo...');
    await logout();
  } catch (error) {
    console.error(error);
    showToast('Não foi possível sair da conta.', 'error');
    hideLoader();
  }
}

bindNavigation(navigate);
setupDateLabel();
window.addEventListener('focus', renderTimeSensitiveViews);
document.addEventListener('visibilitychange', () => { if (!document.hidden) renderTimeSensitiveViews(); });
setInterval(renderTimeSensitiveViews, 30000);
logoutButtons.forEach((button) => button.addEventListener('click', handleLogout));

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!firebaseIsConfigured) {
    loginFeedback.textContent = 'Acesso indisponível no momento.';
    return;
  }
  loginFeedback.textContent = '';
  try {
    showLoader('Entrando no Controly...');
    await login(loginEmail.value.trim(), loginPassword.value);
  } catch (error) {
    console.error(error);
    loginFeedback.textContent = friendlyAuthMessage(error);
    hideLoader();
  }
});

onStateChange((changeKey) => {
  renderForChange(changeKey);
  updateUserBadge(state.user);
});

document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-go-section]');
  if (!button) return;
  if (!(await confirmLeaveOpenModal())) return;
  navigate(button.dataset.goSection);
});

if (!firebaseIsConfigured) {
  showAuthShell();
  loginFeedback.textContent = 'Acesso indisponível no momento.';
  renderAll();
  hideLoader();
} else {
  showLoader('Validando autenticação...');
  watchAuth(async (user) => {
    try {
      if (user) {
        setUser(user);
        await ensureUserProfile(user);
        showAppShell();
        updateUserBadge(state.user);
        startSubscriptions((collectionName, items) => setCollection(collectionName, items));
        navigate(state.currentSection || 'dashboard');
      } else {
        stopSubscriptions();
        resetState();
        showAuthShell();
      }
    } catch (error) {
      console.error(error);
      showToast('Houve um problema ao carregar seus dados.', 'error');
      showAuthShell();
    } finally {
      renderAll();
      hideLoader();
    }
  });
}
