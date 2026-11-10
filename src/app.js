import { login, logout, watchAuth, requestPasswordReset, changeOwnPassword } from './services/auth.js';
import { ClientThrottle, AUTH_ACTION_POLICIES } from './security/client-throttle.js';
import { firebaseIsConfigured, db } from './services/firebase.js';
import { doc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { createAdminModule } from './admin/admin-module.js';
import { isAdminBackendEnabled, isWorkerAdmin, adminCall } from './admin/admin-client.js';
import { observeSectionRender } from './services/performance-diagnostics.js';
import { controlyRuntime } from '../firebase-config.js';
import { createActivitiesModule } from './modules/module.activities.js';
import { createCalendarModule } from './modules/module.calendar.js';
import { createDashboardModule } from './modules/module.dashboard.js';
import { createFinanceModule } from './modules/module.finance.js';
import { createGoalsModule } from './modules/module.goals.js';
import { createNotesModule } from './modules/module.notes.js';
import { createReadingModule } from './modules/module.reading.js';
import { createSearchModule, initGlobalSearch } from './modules/module.search.js';
import { createTrashModule } from './modules/module.trash.js';
import { createSettingsModule } from './modules/module.settings.js';
import { createStudiesModule } from './modules/module.studies.js';
import { createWorkoutsModule } from './modules/module.workouts.js';
import { ensureUserProfile, startSubscriptions, stopSubscriptions, setSubscriptionScope } from './services/store.js';
import { onStateChange, resetState, setCollection, setCurrentSection, setUser, state } from './state/state.js';
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
} from './ui/ui.js';
import { formatDate } from './shared/utils.js';

const loginForm = document.getElementById('login-form');
const loginEmail = document.getElementById('login-email');
const loginPassword = document.getElementById('login-password');
const loginFeedback = document.getElementById('login-feedback');
const loginSubmitButton = loginForm.querySelector('[type=submit]');
const throttle = new ClientThrottle({ storage: window.sessionStorage,
  namespace: `controly.${controlyRuntime.environment}.${controlyRuntime.environment === 'local' ? 'demo' : 'remote'}.auth.v1` });
const resetDialog = document.getElementById('reset-password-dialog');
const changeDialog = document.getElementById('change-password-dialog');
const resetForm = document.getElementById('reset-password-form');
const changeForm = document.getElementById('change-password-form');
let isPasswordActionPending = false;
function throttleNotice(action) {
  const result = throttle.status(action, AUTH_ACTION_POLICIES[action]);
  return result.allowed ? '' : `Limite temporário neste navegador. Tente novamente em ${Math.max(1, Math.ceil(result.retryAfterMs / 1000))} segundos.`;
}
function closeAccountDialogs() {
  if (resetDialog?.open) resetDialog.close();
  if (changeDialog?.open) changeDialog.close();
  resetForm?.reset();
  changeForm?.reset();
}

let isAuthenticating = false;
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
  createSettingsModule(),
  createAdminModule(),
];

modules.forEach((module) => {
  const section = document.getElementById(`section-${module.id}`);
  module.init(section);
});

const moduleMap = new Map(modules.map((module) => [module.id, module]));
let adminAllowed = false;
let unsubscribeAccess = null;
const adminNavButton = document.getElementById('nav-vora-admin');
window.addEventListener('controly:admin-verified', (event) => {
  if (!state.user || event.detail?.authorized !== true) return;
  // O controle real permanece no Worker; esta ação só torna o menu visível.
  adminAllowed = true;
  if (adminNavButton) adminNavButton.hidden = false;
});

function hideAdminArea() {
  adminAllowed = false;
  if (adminNavButton) adminNavButton.hidden = true;
  moduleMap.get('admin')?.clear();
  if (state.currentSection === 'admin') navigate('dashboard');
}

async function validateAccountAccess(user) {
  if (unsubscribeAccess) { unsubscribeAccess(); unsubscribeAccess = null; }
  hideAdminArea();
  if (!isAdminBackendEnabled()) return;
  // A sessão é verificada pelo Worker, inclusive quando as regras antigas ainda não
  // permitem ler accountAccess no cliente. Assim o Admin pode ser implantado sem
  // bloquear acidentalmente todas as contas durante a migração.
  const session = await adminCall('voraAccountSession');
  if (session.status !== 'active') throw new Error('Acesso suspenso.');
  adminAllowed = session.admin === true;
  if (adminNavButton) adminNavButton.hidden = !adminAllowed;
  // Com as regras atualizadas, o listener oferece bloqueio quase imediato.
  // Caso as regras antigas não exponham accountAccess, o Worker ainda valida
  // a sessão no login e nos retornos à aplicação.
  const ref = doc(db, 'accountAccess', user.uid);
  unsubscribeAccess = onSnapshot(ref, (snapshot) => {
    if (snapshot.exists() && snapshot.data()?.status !== 'active') {
      stopSubscriptions();
      logout().catch(console.error);
      showToast('Seu acesso foi encerrado. Consulte o suporte.', 'error');
    }
  }, (error) => console.warn('Sincronização do acesso indisponível:', error?.code || 'erro'));
}
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
  if (!section) return { details: new Map(), scrollTop: 0, kanbanScroll: [] };
  const kanbanScroll = [...section.querySelectorAll('.kanban-board')].map((board) => board.scrollLeft);
  const details = new Map();
  section.querySelectorAll('details').forEach((detail, index) => {
    details.set(detailIdentity(detail, index), detail.open);
  });
  return { details, scrollTop: section.scrollTop || 0, kanbanScroll };
}

function restoreSectionUiState(section, snapshot) {
  if (!section || !snapshot) return;
  section.querySelectorAll('details').forEach((detail, index) => {
    const key = detailIdentity(detail, index);
    if (snapshot.details.has(key)) detail.open = snapshot.details.get(key);
  });
  if (snapshot.scrollTop) section.scrollTop = snapshot.scrollTop;
  section.querySelectorAll('.kanban-board').forEach((board, index) => {
    if (snapshot.kanbanScroll?.[index]) board.scrollLeft = snapshot.kanbanScroll[index];
  });
}

function renderModules(moduleIds) {
  window.__CONTROLY_STATE = state;
  [...new Set(moduleIds)].forEach((id) => {
    const section = document.getElementById(`section-${id}`);
    const uiSnapshot = captureSectionUiState(section);
    const started = performance.now();
    moduleMap.get(id)?.render(state);
    observeSectionRender(id, performance.now() - started);
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
  // O conteúdo das seções ocultas será reconstruído quando a pessoa navegar até elas.
  // Evita destruir formulários ou recriar dezenas de cartões em cada snapshot do Firestore.
  if (targets.includes(current) && !isSilentRenderLocked(changeKey, current)) {
    renderModules([current]);
  }
}

function renderTimeSensitiveViews() {
  if (!state.user) return;
  const current = state.currentSection || 'dashboard';
  if (['dashboard', 'activities', 'calendar', 'goals', 'trash'].includes(current)) {
    renderModules([current]);
  }
}

function navigate(section) {
  if (section === 'admin' && !adminAllowed) return;
  setCurrentSection(section);
  setActiveSection(section);
  // Navegar para uma nova área revalida apenas os dados necessários nessa seção.
  if (state.user) setSubscriptionScope(section);
  if (section === 'admin') moduleMap.get('admin')?.activate();
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
    'auth/invalid-credential': 'Não foi possível entrar. Confira e-mail e senha.',
    'auth/user-not-found': 'Não foi possível entrar. Confira e-mail e senha.',
    'auth/wrong-password': 'Não foi possível autenticar. Confira e-mail e senha.',
    'auth/invalid-email': 'Digite um e-mail válido.',
    'auth/weak-password': 'A senha precisa ter pelo menos 6 caracteres.',
    'auth/too-many-requests': 'O serviço de autenticação limitou as tentativas. Aguarde antes de tentar novamente.',
    'auth/requires-recent-login': 'Por segurança, confirme novamente sua senha atual.',
    'auth/invalid-verification-code': 'Código de verificação inválido.',
    'auth/unauthorized-domain': 'Este acesso não está disponível no momento.',
    'auth/invalid-action-code': 'O link expirou ou já foi usado. Solicite outro e-mail.',
    'auth/operation-not-allowed': 'Não foi possível entrar nesta conta. Tente novamente mais tarde.',
    'auth/network-request-failed': 'Não foi possível conectar neste momento. Verifique sua conexão e tente novamente.',
  };
  return map[error?.code] || 'Não foi possível entrar. Tente novamente.';
}

async function submitAuthentication() {
  if (!firebaseIsConfigured || isAuthenticating) return;
  const blocked = throttleNotice('login');
  if (blocked) { loginFeedback.textContent = blocked; return; }
  isAuthenticating = true;
  if (loginSubmitButton) loginSubmitButton.disabled = true;
  loginFeedback.textContent = '';
  try {
    showLoader('Entrando no Controly...');
    await login(loginEmail.value.trim(), loginPassword.value);
    throttle.clear('login');
    loginPassword.value = '';
  } catch (error) {
    console.error('Falha de autenticação:', error?.code || error?.message);
    if (error?.code !== 'auth/network-request-failed') throttle.record('login', AUTH_ACTION_POLICIES.login);
    loginFeedback.textContent = friendlyAuthMessage(error);
    hideLoader();
  } finally {
    isAuthenticating = false;
    if (loginSubmitButton) loginSubmitButton.disabled = false;
  }
}

async function handleLogout() {
  closeAccountDialogs();
  try {
    showLoader('Saindo...');
    await logout();
  } catch (error) {
    console.error(error);
    showToast('Não foi possível sair da conta.', 'error');
    hideLoader();
  }
}

// E-mail de recuperação: nunca divulga se determinada conta existe.
document.getElementById('forgot-password-btn')?.addEventListener('click', () => {
  resetForm.reset();
  document.getElementById('reset-email').value = loginEmail.value.trim();
  document.getElementById('reset-password-feedback').textContent = '';
  resetDialog.showModal();
});
document.addEventListener('click', (event) => {
  if (!event.target.closest('#settings-change-password')) return;
  changeForm.reset();
  document.getElementById('change-password-feedback').textContent = '';
  changeDialog.showModal();
});
document.querySelectorAll('[data-close-account-dialog]').forEach((button) => {
  button.addEventListener('click', closeAccountDialogs);
});
for (const dialog of [resetDialog, changeDialog]) {
  dialog?.addEventListener('close', () => {
    // Limpa senhas mesmo se fechado por ESC.
    dialog.querySelector('form')?.reset();
  });
}

resetForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (isPasswordActionPending) return;
  const info = document.getElementById('reset-password-feedback');
  const blocked = throttleNotice('reset');
  if (blocked) { info.textContent = blocked; return; }
  const submit = resetForm.querySelector('[type=submit]');
  isPasswordActionPending = true;
  submit.disabled = true;
  try {
    throttle.record('reset', AUTH_ACTION_POLICIES.reset);
    await requestPasswordReset(document.getElementById('reset-email').value);
    info.textContent = 'Se houver uma conta vinculada a esse e-mail, as instruções de recuperação serão enviadas.';
  } catch (error) {
    // Em versões sem proteção contra enumeração, resposta pública deve ser genérica.
    info.textContent = error?.code === 'auth/user-not-found'
      ? 'Se houver uma conta vinculada a esse e-mail, as instruções de recuperação serão enviadas.'
      : friendlyAuthMessage(error);
  } finally { isPasswordActionPending = false; submit.disabled = false; }
});

changeForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (isPasswordActionPending) return;
  const info = document.getElementById('change-password-feedback');
  const blocked = throttleNotice('password');
  if (blocked) { info.textContent = blocked; return; }
  const current = document.getElementById('current-password').value;
  const next = document.getElementById('new-password').value;
  const confirm = document.getElementById('confirm-new-password').value;
  if (next !== confirm) { info.textContent = 'As novas senhas não coincidem.'; return; }
  if (current === next) { info.textContent = 'Escolha uma senha diferente da atual.'; return; }
  const submit = changeForm.querySelector('[type=submit]');
  submit.disabled = true;
  isPasswordActionPending = true;
  try {
    throttle.record('password', AUTH_ACTION_POLICIES.password);
    await changeOwnPassword(current, next);
    throttle.clear('password');
    closeAccountDialogs();
    showToast('Senha alterada com sucesso.', 'success');
  } catch (error) {
    info.textContent = friendlyAuthMessage(error);
  } finally { isPasswordActionPending = false; submit.disabled = false; }
});

bindNavigation(navigate);
setupDateLabel();
let lastAccessReviewAt = 0;
async function revalidateSessionInBackground() {
  if (!state.user || !isWorkerAdmin()) return;
  if (Date.now() - lastAccessReviewAt < 60000) return;
  lastAccessReviewAt = Date.now();
  const uid = state.user.uid;
  try {
    const access = await adminCall('voraAccountSession');
    if (state.user?.uid !== uid) return;
    if (access.status !== 'active') {
      stopSubscriptions();
      await logout();
      showToast('Sua sessão foi encerrada. Consulte o suporte.', 'error');
      return;
    }
    adminAllowed = access.admin === true;
    if (adminNavButton) adminNavButton.hidden = !adminAllowed;
  } catch (error) {
    console.warn('Não foi possível revalidar o acesso neste momento:', error?.status || 'rede');
  }
}
window.addEventListener('focus', () => {renderTimeSensitiveViews(); void revalidateSessionInBackground();});
document.addEventListener('visibilitychange', () => { if (!document.hidden) {renderTimeSensitiveViews(); void revalidateSessionInBackground();} });
setInterval(() => {renderTimeSensitiveViews(); void revalidateSessionInBackground();}, 60000);
logoutButtons.forEach((button) => button.addEventListener('click', handleLogout));

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await submitAuthentication();
});

onStateChange((changeKey) => {
  renderForChange(changeKey);
  updateUserBadge(state.user, state.profile);
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
        await validateAccountAccess(user);
        lastAccessReviewAt = Date.now();
        setUser(user);
        state.profile = await ensureUserProfile(user);
        showAppShell();
        updateUserBadge(state.user, state.profile);
        startSubscriptions((collectionName, items) => setCollection(collectionName, items), state.currentSection || 'dashboard');
        navigate(state.currentSection || 'dashboard');
      } else {
        if (unsubscribeAccess) { unsubscribeAccess(); unsubscribeAccess = null; }
        hideAdminArea();
        closeAccountDialogs();
        stopSubscriptions();
        resetState();
        showAuthShell();
      }
    } catch (error) {
      console.error('Falha na inicialização da conta:', error?.code || error?.message || 'unknown');
      showToast(isAdminBackendEnabled() ? 'Não foi possível validar o acesso desta conta.' : 'Houve um problema ao carregar seus dados.', 'error');
      if (isAdminBackendEnabled()) await logout().catch(console.error);
      showAuthShell();
    } finally {
      renderAll();
      hideLoader();
    }
  });
}
