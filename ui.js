import { escapeHtml } from "./utils.js";

const ICON_SPRITE = {
  dashboard: 'layout-dashboard',
  activities: 'layers-3',
  calendar: 'calendar-days',
  goals: 'target',
  studies: 'graduation-cap',
  reading: 'book-open',
  workouts: 'dumbbell',
  finance: 'wallet',
  notes: 'sticky-note',
  search: 'search',
  trash: 'trash-2',
};

const DESKTOP_BREAKPOINT = 980;
const desktopMediaQuery = window.matchMedia ? window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT + 1}px)`) : null;
const SIDEBAR_PREF_KEY = "controly.sidebarCollapsed";
const THEME_PREF_KEY = "controly.theme";
const FORM_DRAFT_PREFIX = "controly.formDraft.";

const modalRoot = document.getElementById("modal-root");
const modalTitle = document.getElementById("modal-title");
const modalEyebrow = document.getElementById("modal-eyebrow");
const modalBody = document.getElementById("modal-body");
const modalClose = document.getElementById("modal-close");
let modalScrollY = 0;
let modalUnsavedGuard = null;
let modalSubmitBypass = false;
let discardChangesDialogPromise = null;

function serializeFormForGuard(form) {
  if (!form) return '';
  const pairs = [];
  const data = new FormData(form);
  for (const [key, value] of data.entries()) pairs.push([key, String(value)]);
  form.querySelectorAll('[contenteditable="true"]').forEach((node, index) => {
    pairs.push([`contenteditable:${node.id || index}`, node.innerHTML || '']);
  });
  form.querySelectorAll('input[type="checkbox"], input[type="radio"]').forEach((node) => {
    pairs.push([`checked:${node.name || node.id || node.value}`, node.checked ? '1' : '0']);
  });
  return JSON.stringify(pairs.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1])));
}

function safeAttributeValue(value = '') {
  return String(value).replaceAll('\\', '\\\\').replaceAll('\"', '\\\"');
}

function draftKeyForForm(form) {
  const title = modalTitle?.textContent?.trim() || 'formulario';
  const explicit = form?.dataset?.draftKey;
  const formId = form?.id || form?.getAttribute('name') || 'formulario';
  return FORM_DRAFT_PREFIX + (explicit || ('modal:' + title + ':' + formId));
}

function fieldIdentity(field, index) {
  const base = field.name || field.id || ('campo-' + index);
  if (field.type === 'checkbox' || field.type === 'radio') return base + ':' + (field.value || index);
  return base;
}

function collectFormDraft(form) {
  if (!form) return null;
  const fields = [...form.querySelectorAll('input, textarea, select')]
    .filter((field) => field.type !== 'file' && field.type !== 'password')
    .map((field, index) => {
      const value = field.tagName === 'SELECT' && field.multiple
        ? [...field.selectedOptions].map((option) => option.value)
        : (field.type === 'checkbox' || field.type === 'radio' ? field.checked : field.value);
      return {
        identity: fieldIdentity(field, index),
        name: field.name || '',
        id: field.id || '',
        type: field.type || field.tagName.toLowerCase(),
        value: field.value || '',
        draftValue: value,
      };
    });
  const editable = [...form.querySelectorAll('[contenteditable="true"]')].map((node, index) => ({
    id: node.id || '',
    index,
    html: node.innerHTML || '',
  }));
  return { savedAt: new Date().toISOString(), title: modalTitle?.textContent?.trim() || '', fields, editable };
}

function findFieldForDraft(form, item) {
  if (!form || !item) return null;
  const safeId = item.id ? (globalThis.CSS?.escape ? CSS.escape(item.id) : safeAttributeValue(item.id)) : '';
  const byId = safeId ? form.querySelector('#' + safeId) : null;
  if (byId) return byId;
  const candidates = item.name ? [...form.querySelectorAll('[name="' + safeAttributeValue(item.name) + '"]')] : [];
  return candidates.find((field, index) => fieldIdentity(field, index) === item.identity || field.value === item.value || field.type === item.type) || candidates[0] || null;
}

function saveFormDraft(form) {
  if (!form || form.dataset.skipDraft === 'true') return false;
  try {
    const draft = collectFormDraft(form);
    if (!draft) return false;
    localStorage.setItem(draftKeyForForm(form), JSON.stringify(draft));
    return true;
  } catch (error) {
    console.error('Não foi possível salvar o rascunho:', error);
    return false;
  }
}

function clearFormDraft(form) {
  if (!form) return;
  try { localStorage.removeItem(draftKeyForForm(form)); } catch {}
}

function restoreFormDraft(form) {
  if (!form || form.dataset.skipDraft === 'true') return false;
  let draft = null;
  try { draft = JSON.parse(localStorage.getItem(draftKeyForForm(form)) || 'null'); } catch { draft = null; }
  if (!draft?.fields?.length && !draft?.editable?.length) return false;

  draft.fields?.forEach((item) => {
    const field = findFieldForDraft(form, item);
    if (!field || field.disabled || field.readOnly) return;
    if (field.type === 'checkbox' || field.type === 'radio') {
      field.checked = Boolean(item.draftValue);
    } else if (field.tagName === 'SELECT' && field.multiple && Array.isArray(item.draftValue)) {
      [...field.options].forEach((option) => { option.selected = item.draftValue.includes(option.value); });
    } else {
      field.value = item.draftValue ?? '';
    }
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  });

  draft.editable?.forEach((item) => {
    const safeId = item.id ? (globalThis.CSS?.escape ? CSS.escape(item.id) : safeAttributeValue(item.id)) : '';
    const node = safeId ? form.querySelector('#' + safeId) : form.querySelectorAll('[contenteditable="true"]')[item.index];
    if (node) node.innerHTML = item.html || '';
  });

  showToast('Rascunho recuperado. Você pode continuar de onde parou.');
  return true;
}

function armUnsavedChangesGuard() {
  modalUnsavedGuard = null;
  modalSubmitBypass = false;
  const form = modalBody?.querySelector('form');
  if (!form || form.dataset.skipUnsavedGuard === 'true') return;
  restoreFormDraft(form);
  const getSnapshot = () => serializeFormForGuard(form);
  let initialSnapshot = getSnapshot();
  window.setTimeout(() => { initialSnapshot = getSnapshot(); }, 0);
  modalUnsavedGuard = () => getSnapshot() !== initialSnapshot;
  form.addEventListener('submit', () => {
    modalSubmitBypass = true;
    clearFormDraft(form);
  }, true);
}

function requestDiscardChangesDialog() {
  if (discardChangesDialogPromise) return discardChangesDialogPromise;

  discardChangesDialogPromise = new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'discard-changes-overlay';
    overlay.setAttribute('role', 'presentation');
    overlay.innerHTML = `
      <section class="discard-changes-dialog" role="dialog" aria-modal="true" aria-labelledby="discard-changes-title">
        <span class="eyebrow">Antes de sair</span>
        <h3 id="discard-changes-title">Deseja salvar um rascunho?</h3>
        <p>Você preencheu informações que ainda não foram salvas. Salve um rascunho para continuar depois neste formulário.</p>
        <div class="inline-actions discard-changes-actions">
          <button type="button" class="btn btn-primary" data-draft-save>Salvar rascunho</button>
          <button type="button" class="btn btn-secondary" data-discard-cancel>Continuar preenchendo</button>
          <button type="button" class="btn btn-secondary" data-discard-accept>Sair sem salvar</button>
        </div>
      </section>
    `;

    const finish = (value) => {
      overlay.remove();
      discardChangesDialogPromise = null;
      resolve(value);
    };

    overlay.querySelector('[data-discard-cancel]')?.addEventListener('click', () => finish('cancel'));
    overlay.querySelector('[data-discard-accept]')?.addEventListener('click', () => finish('discard'));
    overlay.querySelector('[data-draft-save]')?.addEventListener('click', () => finish('save'));
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) finish('cancel');
    });
    document.body.appendChild(overlay);
    overlay.querySelector('[data-draft-save]')?.focus();
  });

  return discardChangesDialogPromise;
}

async function shouldDiscardModalChanges() {
  if (!modalUnsavedGuard || modalSubmitBypass) return true;
  let dirty = false;
  try { dirty = Boolean(modalUnsavedGuard()); } catch { dirty = false; }
  if (!dirty) return true;
  const activeForm = modalBody?.querySelector('form');
  const choice = await requestDiscardChangesDialog();
  if (choice === 'save') {
    if (saveFormDraft(activeForm)) showToast('Rascunho salvo. Ao voltar a este formulário, os dados estarão disponíveis.');
    return true;
  }
  if (choice === 'discard') {
    clearFormDraft(activeForm);
    return true;
  }
  return false;
}

function updateViewportHeightVariable() {
  const height = window.visualViewport?.height || window.innerHeight || document.documentElement.clientHeight;
  document.documentElement.style.setProperty("--app-visual-height", `${height}px`);
}
const loader = document.getElementById("app-loader");
const loaderText = document.getElementById("app-loader-text");
const toastStack = document.getElementById("toast-stack");
const authScreen = document.getElementById("auth-screen");
const appShell = document.getElementById("app-shell");
const sectionTitle = document.getElementById("section-title");
const sidebarUserName = document.getElementById("sidebar-user-name");
const sidebarUserEmail = document.getElementById("sidebar-user-email");
const topbarUserName = document.getElementById("topbar-user-name");
const topbarUserEmail = document.getElementById("topbar-user-email");
const currentDateLabel = document.getElementById("current-date-label");
const sidebar = document.getElementById("sidebar");
const sidebarBackdrop = document.getElementById("sidebar-backdrop");
const sidebarToggleButton = document.getElementById("sidebar-toggle");

let desktopSidebarCollapsed = readSidebarPreference();

export function icon(name, label = "", extraClass = "") {
  const cls = ["ui-icon", extraClass].filter(Boolean).join(" ");
  return `<i data-lucide="${escapeHtml(name)}" class="${escapeHtml(cls)}" aria-hidden="true"></i>${label ? `<span class="sr-only">${escapeHtml(label)}</span>` : ""}`;
}

const accordionUserState = new Map();
const accordionRestoring = new WeakSet();

function getAccordionChevronSvg(isOpen) {
  const path = isOpen ? "M6 9l6 6 6-6" : "M9 18l6-6-6-6";
  return `
    <svg class="accordion-chevron-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path d="${path}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>
  `;
}

function normalizeAccordionLabel(value = "") {
  return value.replace(/\s+/g, " ").trim().slice(0, 90);
}

function getAccordionSummaryLabel(summary) {
  if (!summary) return "accordion";

  const preferredLabel = summary.querySelector(
    ".finance-lane-title, .section-accordion-head strong, .goal-title, .workout-title, h2, h3, h4, strong"
  );

  if (preferredLabel?.textContent) {
    const label = normalizeAccordionLabel(preferredLabel.textContent);
    if (label) return label;
  }

  const clone = summary.cloneNode(true);
  clone.querySelectorAll(".accordion-chevron, .finance-lane-chevron, .ui-icon, svg, i, button, .chip, .tag").forEach((node) => node.remove());
  const fallback = normalizeAccordionLabel(clone.textContent || "");
  return fallback || "accordion";
}

function getAccordionIndexPath(detailsElement) {
  const indexes = [];
  let current = detailsElement;

  while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
    const parent = current.parentElement;
    if (!parent) break;

    const siblings = [...parent.children].filter((child) => child.tagName === current.tagName);
    indexes.unshift(Math.max(0, siblings.indexOf(current)));
    current = parent.closest?.("details");
  }

  return indexes.join(".");
}

function getAccordionStateKey(detailsElement) {
  if (!detailsElement) return "accordion";

  const section = detailsElement.closest("[id^='section-'], section[id], #modal-root")?.id || "app";
  const explicitKey = detailsElement.dataset.searchId || detailsElement.id;
  if (explicitKey) return `${section}|${explicitKey}`;

  const labels = [];
  let current = detailsElement;
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    if (current.tagName === "DETAILS") {
      labels.unshift(getAccordionSummaryLabel(current.querySelector(":scope > summary")));
    }
    current = current.parentElement?.closest?.("details");
  }

  const classKey = [...detailsElement.classList]
    .filter((className) => /accordion|finance|goal|study|workout|calendar|dashboard|month|lane|card|column/.test(className))
    .slice(0, 5)
    .join(".");

  return `${section}|${labels.join(" > ")}|${classKey}|${getAccordionIndexPath(detailsElement)}`;
}

function removeLegacyAccordionIcons(summary) {
  if (!summary) return;
  summary
    .querySelectorAll(":scope > .finance-lane-chevron, :scope > .section-accordion-chevron, :scope > .details-chevron, :scope > .accordion-icon")
    .forEach((node) => node.remove());
}

function applySavedAccordionState(detailsElement) {
  const stateKey = getAccordionStateKey(detailsElement);
  detailsElement.dataset.accordionStateKey = stateKey;

  if (!accordionUserState.has(stateKey)) return;

  const savedOpen = accordionUserState.get(stateKey) === true;
  if (detailsElement.open === savedOpen) return;

  accordionRestoring.add(detailsElement);
  detailsElement.open = savedOpen;
  window.setTimeout(() => accordionRestoring.delete(detailsElement), 0);
}

function updateAccordionChevron(detailsElement) {
  if (!detailsElement || detailsElement.tagName !== "DETAILS") return;

  const summary = detailsElement.querySelector(":scope > summary");
  if (!summary) return;

  removeLegacyAccordionIcons(summary);
  detailsElement.classList.add("accordion-standardized");
  summary.classList.add("accordion-summary-standard");

  let chevron = summary.querySelector(":scope > .accordion-chevron");
  if (!chevron) {
    chevron = document.createElement("span");
    chevron.className = "accordion-chevron";
    chevron.setAttribute("aria-hidden", "true");
    summary.appendChild(chevron);
  }

  chevron.innerHTML = getAccordionChevronSvg(detailsElement.open);
  chevron.dataset.state = detailsElement.open ? "open" : "closed";
}

function standardizeAccordions(root = document) {
  const scope = root || document;
  const detailsElements = [];

  if (scope.nodeType === Node.ELEMENT_NODE && scope.matches?.("details")) {
    detailsElements.push(scope);
  }

  detailsElements.push(...(scope.querySelectorAll?.("details") || []));

  detailsElements.forEach((detailsElement) => {
    applySavedAccordionState(detailsElement);
    updateAccordionChevron(detailsElement);

    if (detailsElement.dataset.accordionChevronBound === "true") return;
    detailsElement.dataset.accordionChevronBound = "true";
    detailsElement.addEventListener("toggle", () => {
      updateAccordionChevron(detailsElement);
      if (accordionRestoring.has(detailsElement)) return;

      const stateKey = detailsElement.dataset.accordionStateKey || getAccordionStateKey(detailsElement);
      detailsElement.dataset.accordionStateKey = stateKey;
      accordionUserState.set(stateKey, detailsElement.open);
    });
  });
}

export function refreshIcons(root = document) {
  if (window.lucide?.createIcons) {
    window.lucide.createIcons({
      icons: window.lucide.icons,
      nameAttr: "data-lucide",
      attrs: {
        strokeWidth: 1.85,
      },
    });
  }

  standardizeAccordions(root);
}

function isDesktop() {
  return window.innerWidth > DESKTOP_BREAKPOINT;
}


function readThemePreference() {
  try {
    return localStorage.getItem(THEME_PREF_KEY) || "dark";
  } catch {
    return "dark";
  }
}

function applyTheme(theme = readThemePreference()) {
  document.documentElement.setAttribute("data-theme", theme === "light" ? "light" : "dark");
  document.body.dataset.theme = theme === "light" ? "light" : "dark";
  const toggle = document.getElementById("theme-toggle");
  if (toggle) {
    toggle.innerHTML = `<i data-lucide="${theme === "light" ? "moon" : "sun-medium"}" aria-hidden="true"></i>`;
    toggle.setAttribute("aria-label", theme === "light" ? "Ativar modo escuro" : "Ativar modo claro");
    refreshIcons(toggle);
  }
}

export function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  const next = current === "light" ? "dark" : "light";
  try {
    localStorage.setItem(THEME_PREF_KEY, next);
  } catch {}
  applyTheme(next);
}

function readSidebarPreference() {
  try {
    return localStorage.getItem(SIDEBAR_PREF_KEY) === "true";
  } catch {
    return false;
  }
}

function writeSidebarPreference(value) {
  try {
    localStorage.setItem(SIDEBAR_PREF_KEY, String(Boolean(value)));
  } catch {
    // ignore
  }
}

function updateSidebarToggleIcon() {
  if (!sidebarToggleButton) return;

  const mobileOpen = !isDesktop() && sidebar.classList.contains("open");
  const desktopCollapsed = isDesktop() && appShell.classList.contains("sidebar-collapsed");
  const iconName = mobileOpen || desktopCollapsed ? "panel-left-open" : "panel-left-close";

  sidebarToggleButton.innerHTML = `<i data-lucide="${iconName}" aria-hidden="true"></i>`;
  sidebarToggleButton.setAttribute(
    "aria-label",
    mobileOpen ? "Fechar menu" : desktopCollapsed ? "Expandir lateral" : "Recolher lateral"
  );
  refreshIcons(sidebarToggleButton);
}

function syncBodySidebarState() {
  document.body.classList.toggle("sidebar-mobile-open", !isDesktop() && sidebar.classList.contains("open"));
}

function applySidebarState() {
  const desktop = isDesktop();

  if (desktop) {
    sidebar.classList.remove("open");
    sidebarBackdrop.classList.remove("open");
    appShell.classList.toggle("sidebar-collapsed", desktopSidebarCollapsed);
  } else {
    appShell.classList.remove("sidebar-collapsed");
    sidebar.classList.remove("collapsed");
  }

  syncBodySidebarState();
  updateSidebarToggleIcon();
}

function openMobileSidebar() {
  if (isDesktop()) return;
  appShell.classList.remove("sidebar-collapsed");
  sidebar.classList.remove("collapsed");
  sidebar.classList.add("open");
  sidebarBackdrop.classList.add("open");
  syncBodySidebarState();
  updateSidebarToggleIcon();
}

export function toggleSidebar() {
  appShell.classList.remove("sidebar-transition-lock");

  if (isDesktop()) {
    desktopSidebarCollapsed = !desktopSidebarCollapsed;
    writeSidebarPreference(desktopSidebarCollapsed);
    applySidebarState();
    refreshIcons();
    return;
  }

  if (sidebar.classList.contains("open")) {
    closeSidebar();
    return;
  }

  openMobileSidebar();
}

export function closeSidebar() {
  if (isDesktop()) return;
  appShell.classList.remove("sidebar-collapsed");
  sidebar.classList.remove("collapsed");
  sidebar.classList.remove("open");
  sidebarBackdrop.classList.remove("open");
  syncBodySidebarState();
  updateSidebarToggleIcon();
}

export function showLoader(message = "Carregando...") {
  loaderText.textContent = message;
  loader.classList.add("active");
}

export function hideLoader() {
  loader.classList.remove("active");
}

export function showAuthShell() {
  authScreen.classList.remove("hidden");
  appShell.classList.add("hidden");
}

export function showAppShell() {
  authScreen.classList.add("hidden");
  appShell.classList.remove("hidden");
  applySidebarState();
  applyTheme();
  refreshIcons();
}

export function updateTopbarDate(text) {
  currentDateLabel.textContent = text;
}

export function updateUserBadge(user) {
  const name = user?.displayName || "Usuário";
  const email = user?.email || "";
  sidebarUserName.textContent = name;
  sidebarUserEmail.textContent = email;
  if (topbarUserName) topbarUserName.textContent = name;
  if (topbarUserEmail) topbarUserEmail.textContent = email;
}

function lockPageBehindModal() {
  updateViewportHeightVariable();
  modalScrollY = window.scrollY || document.documentElement.scrollTop || 0;
  document.body.classList.add("modal-open");
  document.body.style.top = `-${modalScrollY}px`;
  appShell?.setAttribute("inert", "");
  authScreen?.setAttribute("inert", "");
}

function unlockPageBehindModal() {
  document.body.classList.remove("modal-open");
  document.body.style.top = "";
  appShell?.removeAttribute("inert");
  authScreen?.removeAttribute("inert");
  window.scrollTo(0, modalScrollY);
}

export function openModal({ title, eyebrow = "", body = "", content = "" }) {
  const alreadyOpen = modalRoot.classList.contains("open");
  modalTitle.textContent = title;
  modalEyebrow.textContent = eyebrow;
  modalEyebrow.classList.toggle("hidden", !eyebrow);
  modalBody.innerHTML = body || content;
  modalRoot.classList.toggle("finance-entry-modal", Boolean(modalBody.querySelector("#finance-form")));
  modalRoot.classList.toggle("note-form-modal", Boolean(modalBody.querySelector("#note-form")));
  modalRoot.classList.toggle("workout-form-modal", Boolean(modalBody.querySelector("#workout-form")));
  refreshIcons(modalRoot);
  armUnsavedChangesGuard();
  if (!alreadyOpen) lockPageBehindModal();
  updateViewportHeightVariable();
  modalRoot.classList.add("open");
  modalRoot.setAttribute("aria-hidden", "false");
}

export async function closeModal(options = {}) {
  if (!modalRoot.classList.contains("open")) return false;
  if (!options.force && !(await shouldDiscardModalChanges())) return false;
  modalRoot.classList.remove("open");
  modalRoot.classList.remove("finance-entry-modal", "note-form-modal", "workout-form-modal");
  modalRoot.setAttribute("aria-hidden", "true");
  modalBody.innerHTML = "";
  modalUnsavedGuard = null;
  modalSubmitBypass = false;
  unlockPageBehindModal();
  return true;
}

export function showToast(message, type = "success") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  const title = type === "error" ? "Atenção" : type === "info" ? "Aviso" : "Pronto";
  toast.innerHTML = `<strong>${title}</strong><p>${escapeHtml(message)}</p>`;
  toastStack.appendChild(toast);
  refreshIcons(toast);
  setTimeout(() => toast.remove(), 3600);
}

export function showUndoToast(message, undoHandler, options = {}) {
  const { type = "success", actionLabel = "Desfazer", timeout = 7000 } = options;
  const toast = document.createElement("div");
  toast.className = `toast ${type} toast-actionable`;
  toast.innerHTML = `
    <div class="toast-action-content">
      <strong>${type === "error" ? "Erro" : "Atualizado"}</strong>
      <p>${escapeHtml(message)}</p>
    </div>
    <button type="button" class="toast-action-btn">${escapeHtml(actionLabel)}</button>
  `;

  let closed = false;
  const closeToast = () => {
    if (closed) return;
    closed = true;
    toast.remove();
  };

  toast.querySelector(".toast-action-btn")?.addEventListener("click", async () => {
    try {
      await undoHandler?.();
      closeToast();
      showToast("Ação desfeita com sucesso.");
    } catch (error) {
      console.error(error);
      showToast("Não foi possível desfazer esta ação.", "error");
    }
  });

  toastStack.appendChild(toast);
  refreshIcons(toast);
  setTimeout(closeToast, timeout);
}

export function setActiveSection(sectionId) {
  document.querySelectorAll(".view-section").forEach((section) => {
    section.classList.toggle("active", section.id === `section-${sectionId}`);
  });

  document.querySelectorAll(".nav-btn").forEach((button) => {
    button.classList.toggle("active", button.dataset.section === sectionId);
  });

  const activeButton = document.querySelector(`.nav-btn[data-section="${sectionId}"]`);
  sectionTitle.textContent = activeButton?.querySelector(".nav-label")?.textContent?.trim() || activeButton?.textContent?.trim() || "Controly";
  closeSidebar();
}

export async function confirmLeaveOpenModal() {
  if (!modalRoot.classList.contains("open")) return true;
  return closeModal();
}

export function bindNavigation(onNavigate) {
  document.querySelectorAll(".nav-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!(await confirmLeaveOpenModal())) return;
      onNavigate(button.dataset.section);
    });
  });
  document.getElementById("theme-toggle")?.addEventListener("click", toggleTheme);
  applyTheme();
}

export function createEmptyState(title, description, action = null) {
  const actionHtml = action?.label && (action.action || action.section)
    ? '<button type="button" class="btn btn-primary empty-state-action" '
      + (action.action ? 'data-action="' + escapeHtml(action.action) + '" ' : '')
      + (action.section ? 'data-go-section="' + escapeHtml(action.section) + '" ' : '')
      + '>' + escapeHtml(action.label) + '</button>'
    : '';
  return `
    <div class="empty-state glass-card">
      <div class="empty-state-icon"></div>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(description)}</p>
      ${actionHtml}
    </div>
  `;
}

const runningActionKeys = new Set();

export async function runButtonAction(actionKey, button, handler, options = {}) {
  const key = String(actionKey || button?.dataset?.action || 'action');
  if (runningActionKeys.has(key)) return null;
  runningActionKeys.add(key);

  const previousText = button?.textContent;
  const action = button?.dataset?.action || '';
  const id = button?.dataset?.id || '';
  const escapeSelector = (value) => globalThis.CSS?.escape ? CSS.escape(value) : String(value).replaceAll('"', '\\"');
  const relatedButtons = action ? [...document.querySelectorAll('[data-action="' + escapeSelector(action) + '"][data-id="' + escapeSelector(id) + '"]')] : [];
  [...relatedButtons, button].filter(Boolean).forEach((item) => {
    item.disabled = true;
    item.setAttribute('aria-busy', 'true');
    item.classList.add('is-busy');
  });
  if (button && options.busyText) button.textContent = options.busyText;

  try {
    return await handler();
  } finally {
    window.setTimeout(() => {
      [...relatedButtons, button].filter(Boolean).forEach((item) => {
        item.disabled = false;
        item.removeAttribute('aria-busy');
        item.classList.remove('is-busy');
      });
      if (button && options.busyText && previousText != null) button.textContent = previousText;
      runningActionKeys.delete(key);
    }, Number(options.releaseDelay || 500));
  }
}

export function confirmDialog({ title, description, confirmLabel = "Confirmar" }) {
  return new Promise((resolve) => {
    openModal({
      title,
      eyebrow: "Confirmação",
      body: `
        <div class="stack-form" data-skip-unsaved-guard="true">
          <p class="module-subtitle">${escapeHtml(description)}</p>
          <div class="inline-actions">
            <button type="button" class="btn btn-secondary" id="confirm-cancel">Cancelar</button>
            <button type="button" class="btn btn-danger" id="confirm-accept">${escapeHtml(confirmLabel)}</button>
          </div>
        </div>
      `,
    });

    document.getElementById("confirm-cancel")?.addEventListener("click", () => {
      closeModal({ force: true });
      resolve(false);
    });

    document.getElementById("confirm-accept")?.addEventListener("click", (event) => {
      const button = event.currentTarget;
      if (button?.disabled) return;
      if (button) {
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
      }
      closeModal({ force: true });
      resolve(true);
    });
  });
}

window.addEventListener('beforeunload', (event) => {
  const activeForm = modalRoot.classList.contains('open') ? modalBody?.querySelector('form') : null;
  if (!activeForm || !modalUnsavedGuard || modalSubmitBypass) return;
  let dirty = false;
  try { dirty = Boolean(modalUnsavedGuard()); } catch { dirty = false; }
  if (!dirty) return;
  saveFormDraft(activeForm);
  event.preventDefault();
  event.returnValue = '';
});

window.visualViewport?.addEventListener("resize", updateViewportHeightVariable);
window.visualViewport?.addEventListener("scroll", updateViewportHeightVariable);
window.addEventListener("resize", updateViewportHeightVariable);
updateViewportHeightVariable();

modalClose.addEventListener("click", closeModal);
modalRoot.addEventListener("click", (event) => {
  if (event.target?.dataset?.closeModal === "true") closeModal();
});
sidebarBackdrop.addEventListener("click", closeSidebar);
sidebarToggleButton?.addEventListener("click", toggleSidebar);
window.addEventListener("resize", () => {
  applySidebarState();
  refreshIcons();
});
window.addEventListener("orientationchange", () => {
  applySidebarState();
  refreshIcons();
});
desktopMediaQuery?.addEventListener?.("change", () => {
  applySidebarState();
  refreshIcons();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeModal();
    closeSidebar();
  }
});
applySidebarState();
refreshIcons();
