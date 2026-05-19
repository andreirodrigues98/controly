const baseState = {
  user: null,
  currentSection: 'dashboard',
  activities: [],
  tasks: [],
  events: [],
  goals: [],
  notes: [],
  routines: [],
  subjects: [],
  studySessions: [],
  studyMaterials: [],
  readingItems: [],
  workouts: [],
  financeCards: [],
  financeEntries: [],
  habits: [],
  trash: [],
};

export const state = structuredClone(baseState);
const listeners = new Set();
const pendingLocalPatches = new Map();
const pendingLocalRemovals = new Map();

function cloneLocalValue(value) {
  if (value instanceof Date) return new Date(value.getTime());
  if (value && typeof value?.toDate === 'function') return value;
  if (Array.isArray(value)) return value.map(cloneLocalValue);
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) !== Object.prototype) return value;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneLocalValue(item)]));
  }
  return value;
}

function setPath(target, path, value) {
  const parts = String(path || '').split('.').filter(Boolean);
  if (!parts.length) return;
  let cursor = target;
  parts.slice(0, -1).forEach((part) => {
    if (!cursor[part] || typeof cursor[part] !== 'object' || Array.isArray(cursor[part])) cursor[part] = {};
    cursor = cursor[part];
  });
  cursor[parts.at(-1)] = cloneLocalValue(value);
}

function applyPayload(record = {}, payload = {}) {
  const next = cloneLocalValue(record);
  Object.entries(payload || {}).forEach(([key, value]) => {
    if (String(key).includes('.')) setPath(next, key, value);
    else next[key] = cloneLocalValue(value);
  });
  return next;
}

function getPatchBucket(collectionName) {
  if (!pendingLocalPatches.has(collectionName)) pendingLocalPatches.set(collectionName, new Map());
  return pendingLocalPatches.get(collectionName);
}

function pruneExpiredLocalPatches(collectionName) {
  const bucket = pendingLocalPatches.get(collectionName);
  if (!bucket) return;
  const now = Date.now();
  [...bucket.entries()].forEach(([id, patch]) => {
    if ((patch.expiresAt || 0) <= now) bucket.delete(id);
  });
  if (!bucket.size) pendingLocalPatches.delete(collectionName);
}

function pruneExpiredLocalRemovals(collectionName) {
  const bucket = pendingLocalRemovals.get(collectionName);
  if (!bucket) return;
  const now = Date.now();
  [...bucket.entries()].forEach(([id, removal]) => {
    if ((removal.expiresAt || 0) <= now) bucket.delete(id);
  });
  if (!bucket.size) pendingLocalRemovals.delete(collectionName);
}

function applyPendingLocalRemovals(collectionName, items = []) {
  pruneExpiredLocalRemovals(collectionName);
  const bucket = pendingLocalRemovals.get(collectionName);
  if (!bucket?.size) return items;
  return items.filter((item) => !bucket.has(item.id));
}

function applyPendingLocalPatches(collectionName, items = []) {
  pruneExpiredLocalPatches(collectionName);
  const bucket = pendingLocalPatches.get(collectionName);
  if (!bucket?.size) return items;
  return items.map((item) => {
    const patch = bucket.get(item.id);
    return patch ? applyPayload(item, patch.payload) : item;
  });
}

export function onStateChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(changeKey) {
  listeners.forEach((listener) => listener(changeKey, state));
}

export function applyLocalPatch(collectionName, recordId, payload = {}, options = {}) {
  if (!collectionName || !recordId || !Array.isArray(state[collectionName])) return null;
  const index = state[collectionName].findIndex((item) => item.id === recordId);
  const previous = index >= 0 ? cloneLocalValue(state[collectionName][index]) : null;

  if (index >= 0) {
    state[collectionName] = state[collectionName].map((item) => (item.id === recordId ? applyPayload(item, payload) : item));
  }

  const bucket = getPatchBucket(collectionName);
  const current = bucket.get(recordId) || { payload: {}, expiresAt: 0 };
  bucket.set(recordId, {
    payload: { ...current.payload, ...cloneLocalValue(payload) },
    expiresAt: Date.now() + Number(options.ttl || 12000),
  });

  if (options.emitChange !== false) emit(collectionName);
  return previous;
}

export function applyLocalRemoval(collectionName, recordId, options = {}) {
  if (!collectionName || !recordId || !Array.isArray(state[collectionName])) return null;
  const previous = state[collectionName].find((item) => item.id === recordId);
  state[collectionName] = state[collectionName].filter((item) => item.id !== recordId);

  if (!pendingLocalRemovals.has(collectionName)) pendingLocalRemovals.set(collectionName, new Map());
  pendingLocalRemovals.get(collectionName).set(recordId, {
    expiresAt: Date.now() + Number(options.ttl || 15000),
  });

  if (options.emitChange !== false) emit(collectionName);
  return previous ? cloneLocalValue(previous) : null;
}

export function clearLocalRemoval(collectionName, recordId, options = {}) {
  const delay = Number(options.delay || 0);
  const clearBefore = Date.now() + Number(options.ttl || 15000);
  const run = () => {
    const bucket = pendingLocalRemovals.get(collectionName);
    if (!bucket) return;
    const removal = bucket.get(recordId);
    if (!removal) return;
    if (delay > 0 && (removal.expiresAt || 0) > clearBefore) return;
    bucket.delete(recordId);
    if (!bucket.size) pendingLocalRemovals.delete(collectionName);
  };
  if (delay > 0) globalThis.setTimeout(run, delay);
  else run();
}

export function rollbackLocalRemoval(collectionName, recordId, previous) {
  clearLocalRemoval(collectionName, recordId);
  if (!Array.isArray(state[collectionName]) || !previous) return;
  if (!state[collectionName].some((item) => item.id === recordId)) {
    state[collectionName] = [cloneLocalValue(previous), ...state[collectionName]];
  }
  emit(collectionName);
}

export function clearLocalPatch(collectionName, recordId, options = {}) {
  const delay = Number(options.delay || 0);
  const clearBefore = Date.now() + Number(options.ttl || 12000);
  const run = () => {
    const bucket = pendingLocalPatches.get(collectionName);
    if (!bucket) return;
    const patch = bucket.get(recordId);
    if (!patch) return;
    if (delay > 0 && (patch.expiresAt || 0) > clearBefore) return;
    bucket.delete(recordId);
    if (!bucket.size) pendingLocalPatches.delete(collectionName);
  };
  if (delay > 0) globalThis.setTimeout(run, delay);
  else run();
}

export function rollbackLocalPatch(collectionName, recordId, previous) {
  clearLocalPatch(collectionName, recordId);
  if (!Array.isArray(state[collectionName]) || !previous) return;
  state[collectionName] = state[collectionName].map((item) => (item.id === recordId ? cloneLocalValue(previous) : item));
  emit(collectionName);
}

export function setUser(user) {
  state.user = user
    ? {
        uid: user.uid,
        email: user.email ?? '',
        displayName: user.displayName || user.email?.split('@')[0] || 'Usuário',
      }
    : null;
  emit('user');
}

export function setCurrentSection(section) {
  state.currentSection = section;
  emit('currentSection');
}

export function setCollection(name, value) {
  const items = Array.isArray(value) ? value : [];
  state[name] = applyPendingLocalPatches(name, applyPendingLocalRemovals(name, items));
  emit(name);
}

export function resetState() {
  pendingLocalPatches.clear();
  pendingLocalRemovals.clear();
  Object.assign(state, structuredClone(baseState));
  emit('reset');
}
