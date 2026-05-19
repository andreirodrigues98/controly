import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from './firebase.js';
import { applyLocalPatch, applyLocalRemoval, clearLocalPatch, clearLocalRemoval, rollbackLocalPatch, rollbackLocalRemoval, state } from './state.js';
import { sortByLatest, toDate } from './utils.js';

const activeSubscriptions = [];
const TRASH_RETENTION_DAYS = 7;
const pendingCreateWrites = new Map();
const pendingDeletes = new Map();
const pendingNestedDeletes = new Map();

const COLLECTION_LABELS = {
  activities: 'Atividades',
  tasks: 'Atividades',
  habits: 'Atividades',
  routines: 'Atividades',
  events: 'Calendário',
  goals: 'Metas',
  subjects: 'Estudos',
  studySessions: 'Estudos',
  studyMaterials: 'Estudos',
  readingItems: 'Leitura',
  workouts: 'Treinos',
  financeCards: 'Finanças',
  financeEntries: 'Finanças',
  notes: 'Notas',
};

function normalizeForOperationKey(value) {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value?.toDate === 'function') return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(normalizeForOperationKey);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !['createdAt', 'updatedAt'].includes(key))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, normalizeForOperationKey(item)])
    );
  }
  return value;
}

function operationKey(collectionName, payload = {}, recordId = '') {
  return `${collectionName}:${recordId || 'new'}:${JSON.stringify(normalizeForOperationKey(payload))}`;
}

function rememberPending(map, key, promise, releaseDelay = 900) {
  map.set(key, promise);
  promise.finally(() => globalThis.setTimeout(() => map.delete(key), releaseDelay));
  return promise;
}

function userCollection(name) {
  if (!state.user?.uid) throw new Error('Usuário não autenticado.');
  return collection(db, 'users', state.user.uid, name);
}

function userDoc(collectionName, recordId) {
  if (!state.user?.uid) throw new Error('Usuário não autenticado.');
  return doc(db, 'users', state.user.uid, collectionName, recordId);
}

function addDays(value, amount) {
  const date = value instanceof Date ? new Date(value) : new Date(value || Date.now());
  date.setDate(date.getDate() + amount);
  return date;
}

function serializeForTrash(data = {}) {
  const copy = { ...data };
  delete copy.deletedAt;
  delete copy.deletedFrom;
  delete copy.originalModule;
  delete copy.originalPath;
  delete copy.restoreData;
  delete copy.expiresAt;
  return copy;
}

function titleForTrashItem(collectionName, data = {}) {
  return data.title || data.name || data.subjectName || data.cardName || data.email || COLLECTION_LABELS[collectionName] || 'Item excluído';
}

function trashDocId(collectionName, recordId) {
  return `${collectionName}__${recordId}`.replace(/[^a-zA-Z0-9_-]/g, '_');
}

async function cleanupExpiredTrashItems(items = []) {
  const now = Date.now();
  const expired = items.filter((item) => {
    const expires = toDate(item.expiresAt);
    return expires && expires.getTime() <= now;
  });
  await Promise.allSettled(expired.map((item) => deleteDoc(userDoc('trash', item.id))));
}

export async function ensureUserProfile(user) {
  const ref = doc(db, 'users', user.uid);
  await setDoc(
    ref,
    {
      uid: user.uid,
      email: user.email ?? '',
      displayName: user.displayName || user.email?.split('@')[0] || 'Usuário',
      lastLoginAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export function startSubscriptions(onCollectionUpdate) {
  stopSubscriptions();
  const names = [
    'activities',
    'tasks',
    'events',
    'goals',
    'notes',
    'routines',
    'subjects',
    'studySessions',
    'studyMaterials',
    'readingItems',
    'workouts',
    'financeCards',
    'financeEntries',
    'habits',
    'trash',
  ];

  names.forEach((name) => {
    const unsubscribe = onSnapshot(
      userCollection(name),
      (snapshot) => {
        const sortFields = name === 'trash' ? ['deletedAt', 'updatedAt', 'createdAt'] : undefined;
        const items = sortByLatest(snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() })), sortFields);
        if (name === 'trash') cleanupExpiredTrashItems(items).catch((error) => console.error('Erro ao limpar lixeira:', error));
        onCollectionUpdate(name, items);
      },
      (error) => console.error(`Erro ao sincronizar ${name}:`, error)
    );
    activeSubscriptions.push(unsubscribe);
  });
}

export function stopSubscriptions() {
  while (activeSubscriptions.length) {
    const unsubscribe = activeSubscriptions.pop();
    if (typeof unsubscribe === 'function') unsubscribe();
  }
}

export async function saveRecord(collectionName, payload, recordId = null) {
  const body = { ...payload, updatedAt: serverTimestamp() };
  if (!recordId) {
    const key = operationKey(collectionName, payload);
    if (pendingCreateWrites.has(key)) return pendingCreateWrites.get(key);
    body.createdAt = serverTimestamp();
    return rememberPending(pendingCreateWrites, key, addDoc(userCollection(collectionName), body));
  }
  return setDoc(doc(db, 'users', state.user.uid, collectionName, recordId), body, { merge: true });
}

export async function deleteRecord(collectionName, recordId, options = {}) {
  const key = `${collectionName}:${recordId}:${options.permanent === true || collectionName === 'trash' ? 'permanent' : 'trash'}`;
  if (pendingDeletes.has(key)) return pendingDeletes.get(key);

  const task = (async () => {
    const permanent = options.permanent === true || collectionName === 'trash';
    const sourceRef = userDoc(collectionName, recordId);

    if (permanent) {
      await deleteDoc(sourceRef);
      return { permanent: true };
    }

    const snapshot = await getDoc(sourceRef);
    if (!snapshot.exists()) {
      clearLocalRemoval(collectionName, recordId);
      return { missing: true };
    }

    const data = serializeForTrash(snapshot.data());
    const previous = applyLocalRemoval(collectionName, recordId, { ttl: 15000 });
    const deletedAt = new Date();
    const expiresAt = addDays(deletedAt, TRASH_RETENTION_DAYS);
    const trashId = trashDocId(collectionName, recordId);
    const trashRef = userDoc('trash', trashId);

    try {
      await setDoc(trashRef, {
        title: titleForTrashItem(collectionName, data),
        originalModule: COLLECTION_LABELS[collectionName] || 'Outros',
        originalCollection: collectionName,
        originalId: recordId,
        originalPath: `users/${state.user.uid}/${collectionName}/${recordId}`,
        deletedFrom: collectionName,
        deletedAt,
        expiresAt,
        restoreData: data,
        itemType: data.type || data.kind || data.flowType || data.status || '',
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      }, { merge: true });

      const trashSnapshot = await getDoc(trashRef);
      if (!trashSnapshot.exists() || trashSnapshot.data()?.originalCollection !== collectionName || trashSnapshot.data()?.originalId !== recordId) {
        throw new Error('Não foi possível preparar este item na lixeira. Nada foi removido da área original.');
      }

      await deleteDoc(sourceRef);
      clearLocalRemoval(collectionName, recordId, { delay: 5000 });
      return { trashId, expiresAt };
    } catch (error) {
      rollbackLocalRemoval(collectionName, recordId, previous);
      throw error;
    }
  })();

  return rememberPending(pendingDeletes, key, task, 1200);
}

export async function deleteNestedArrayItem(collectionName, recordId, fieldName, itemId, options = {}) {
  const key = `${collectionName}:${recordId}:${fieldName}:${itemId}`;
  if (pendingNestedDeletes.has(key)) return pendingNestedDeletes.get(key);

  const task = (async () => {
    const parentRef = userDoc(collectionName, recordId);
    const parentSnapshot = await getDoc(parentRef);
    if (!parentSnapshot.exists()) throw new Error('Item principal não encontrado.');
    const parentData = parentSnapshot.data() || {};
    const currentItems = Array.isArray(parentData[fieldName]) ? parentData[fieldName] : [];
    const nestedItem = currentItems.find((item) => item?.id === itemId);
    if (!nestedItem) return { missing: true };

    const nextItems = currentItems.filter((item) => item?.id !== itemId);
    const deletedAt = new Date();
    const expiresAt = addDays(deletedAt, TRASH_RETENTION_DAYS);
    const trashId = trashDocId(`${collectionName}_${recordId}_${fieldName}`, itemId);
    const trashRef = userDoc('trash', trashId);
    const restoreData = serializeForTrash(nestedItem);
    const parentTitle = parentData.title || parentData.name || '';

    await setDoc(trashRef, {
      title: options.title || nestedItem.title || nestedItem.text || nestedItem.name || titleForTrashItem(collectionName, nestedItem),
      originalModule: options.moduleLabel || COLLECTION_LABELS[collectionName] || 'Outros',
      originalCollection: collectionName,
      originalId: recordId,
      originalPath: `users/${state.user.uid}/${collectionName}/${recordId}.${fieldName}.${itemId}`,
      deletedFrom: collectionName,
      deletedAt,
      expiresAt,
      restoreKind: 'nested-array-item',
      parentCollection: collectionName,
      parentId: recordId,
      parentTitle,
      nestedField: fieldName,
      nestedId: itemId,
      restoreData,
      itemType: options.itemType || nestedItem.type || nestedItem.kind || fieldName,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    }, { merge: true });

    const trashSnapshot = await getDoc(trashRef);
    if (!trashSnapshot.exists() || trashSnapshot.data()?.nestedId !== itemId) {
      throw new Error('Não foi possível preparar este item na lixeira. Nada foi removido da área original.');
    }

    const previous = applyLocalPatch(collectionName, recordId, { [fieldName]: nextItems }, { ttl: 15000 });
    try {
      await updateDoc(parentRef, { [fieldName]: nextItems, updatedAt: serverTimestamp() });
      clearLocalPatch(collectionName, recordId, { delay: 5000 });
      return { trashId, expiresAt };
    } catch (error) {
      rollbackLocalPatch(collectionName, recordId, previous);
      try { await deleteDoc(trashRef); } catch {}
      throw error;
    }
  })();

  return rememberPending(pendingNestedDeletes, key, task, 1200);
}

export async function restoreDeletedRecord(trashId) {
  const trashRef = userDoc('trash', trashId);
  const snapshot = await getDoc(trashRef);
  if (!snapshot.exists()) throw new Error('Item não encontrado na lixeira.');
  const trashItem = snapshot.data();
  const collectionName = trashItem.originalCollection || trashItem.deletedFrom;
  const originalId = trashItem.originalId;
  const restoreData = { ...(trashItem.restoreData || {}) };
  if (!collectionName || !originalId) throw new Error('Dados de restauração incompletos.');

  if (trashItem.restoreKind === 'nested-array-item') {
    const parentCollection = trashItem.parentCollection || collectionName;
    const parentId = trashItem.parentId || originalId;
    const fieldName = trashItem.nestedField;
    const nestedId = trashItem.nestedId || restoreData.id;
    if (!parentCollection || !parentId || !fieldName || !nestedId) throw new Error('Dados de restauração incompletos.');
    const parentRef = userDoc(parentCollection, parentId);
    const parentSnapshot = await getDoc(parentRef);
    if (!parentSnapshot.exists()) throw new Error('A matéria original não foi encontrada para restaurar este item.');
    const parentData = parentSnapshot.data() || {};
    const currentItems = Array.isArray(parentData[fieldName]) ? parentData[fieldName] : [];
    const itemToRestore = { ...restoreData, id: nestedId };
    const alreadyRestored = currentItems.some((item) => item?.id === nestedId);
    const nextItems = alreadyRestored ? currentItems : [...currentItems, itemToRestore];
    const restorePatch = { [fieldName]: nextItems, updatedAt: serverTimestamp() };
    if (!alreadyRestored && fieldName === 'studySessions') {
      restorePatch.studyTotalMs = Math.max(0, Number(parentData.studyTotalMs || 0)) + Math.max(0, Number(itemToRestore.durationMs || 0));
    }
    await updateDoc(parentRef, restorePatch);
    await deleteDoc(trashRef);
    return { collectionName: parentCollection, originalId: parentId };
  }

  delete restoreData.id;
  await setDoc(userDoc(collectionName, originalId), {
    ...restoreData,
    restoredAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
  await deleteDoc(trashRef);
  return { collectionName, originalId };
}

export async function deleteTrashItem(trashId) {
  return deleteDoc(userDoc('trash', trashId));
}

export async function emptyExpiredTrashNow() {
  await cleanupExpiredTrashItems(state.trash || []);
}

export async function patchRecord(collectionName, recordId, payload) {
  const writePayload = {
    ...payload,
    updatedAt: serverTimestamp(),
  };
  window.__CONTROLY_SILENT_UPDATE?.(collectionName, state.currentSection, 12000);
  const previous = applyLocalPatch(collectionName, recordId, payload, { ttl: 12000 });

  try {
    const result = await updateDoc(doc(db, 'users', state.user.uid, collectionName, recordId), writePayload);
    clearLocalPatch(collectionName, recordId, { delay: 5000 });
    return result;
  } catch (error) {
    rollbackLocalPatch(collectionName, recordId, previous);
    throw error;
  }
}

export async function toggleDateMapField(collectionName, recordId, fieldName, targetDateKey, enabled) {
  const key = `${fieldName}.${targetDateKey}`;
  return patchRecord(collectionName, recordId, { [key]: enabled });
}
