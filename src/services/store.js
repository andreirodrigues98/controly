import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  writeBatch,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from './firebase.js';
import { applyLocalPatch, applyLocalRemoval, clearLocalPatch, clearLocalRemoval, rollbackLocalPatch, rollbackLocalRemoval, state } from '../state/state.js';
import { sortByLatest, toDate } from '../shared/utils.js';
import { collectionsForSection } from './subscription-policy.js';
import { observeCollectionSnapshot } from './performance-diagnostics.js';

const activeSubscriptions = new Map();
let subscriptionUserId = null;
let subscriptionCallback = null;
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
  promise.then(
    () => globalThis.setTimeout(() => map.delete(key), releaseDelay),
    () => globalThis.setTimeout(() => map.delete(key), releaseDelay)
  );
  return promise;
}

function currentUserId() {
  if (!state.user?.uid) throw new Error('Usuário não autenticado.');
  return state.user.uid;
}

function assertUnchangedUser(userId) {
  if (currentUserId() !== userId) throw new Error('A conta mudou durante a operação. Tente novamente.');
}

function userCollection(name, userId = currentUserId()) {
  return collection(db, 'users', userId, name);
}

function userDoc(collectionName, recordId, userId = currentUserId()) {
  return doc(db, 'users', userId, collectionName, recordId);
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

async function cleanupExpiredTrashItems(items = [], userId = currentUserId()) {
  if (state.user?.uid !== userId) return;
  const now = Date.now();
  const expired = items.filter((item) => {
    const expires = toDate(item.expiresAt);
    return expires && expires.getTime() <= now;
  });
  await Promise.allSettled(expired.map((item) => deleteDoc(userDoc('trash', item.id, userId))));
}

export async function ensureUserProfile(user) {
  const ref = doc(db, 'users', user.uid);
  const current = await getDoc(ref);
  const basicProfile = {
    uid: user.uid,
    email: user.email ?? '',
    displayName: user.displayName || user.email?.split('@')[0] || 'Usuário',
    lastLoginAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (current.exists()) {
    // A data de criacao permanece intacta, assim como quaisquer campos legados.
    await updateDoc(ref, { ...basicProfile, displayName: current.data().displayName || basicProfile.displayName });
    return { ...current.data(), lastLoginAt: new Date() };
  } else {
    const created = { ...basicProfile, createdAt: serverTimestamp() };
    await setDoc(ref, created);
    return { uid: user.uid, email: user.email || '', displayName: basicProfile.displayName, avatarDataUrl: '' };
  }
}

/** Miniatura segura da foto, salva somente no perfil privado do usuário. */
export async function saveProfileAvatar(avatarDataUrl) {
  const userId = currentUserId();
  const avatar = String(avatarDataUrl || '');
  if (avatar && (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(avatar) || avatar.length > 75000)) {
    throw new Error('A imagem não atende aos limites permitidos.');
  }
  const profileRef = doc(db, 'users', userId);
  try {
    await updateDoc(profileRef, { avatarDataUrl: avatar, updatedAt: serverTimestamp() });
  } catch (error) {
    // Uma instalação nova pode ter Authentication ativo mas perfil ainda não criado.
    // Não ignoramos falhas de permissão: regras de segurança precisam ser verificadas.
    if (error?.code !== 'not-found') throw error;
    assertUnchangedUser(userId);
    const authUser = state.user;
    await ensureUserProfile(authUser);
    assertUnchangedUser(userId);
    await updateDoc(profileRef, { avatarDataUrl: avatar, updatedAt: serverTimestamp() });
  }
  assertUnchangedUser(userId);
  return avatar;
}

/** Inscreve somente as coleções úteis à tela aberta. Não duplica listeners. */
export function startSubscriptions(onCollectionUpdate, section = 'dashboard') {
  stopSubscriptions();
  subscriptionUserId = currentUserId();
  subscriptionCallback = onCollectionUpdate;
  setSubscriptionScope(section);
}

export function setSubscriptionScope(section = 'dashboard') {
  if (!subscriptionCallback || !state.user?.uid || state.user.uid !== subscriptionUserId) return;
  const allowed = new Set(collectionsForSection(section));
  for (const [name, unsubscribe] of activeSubscriptions) {
    if (!allowed.has(name)) {
      unsubscribe();
      activeSubscriptions.delete(name);
    }
  }
  for (const name of allowed) {
    if (activeSubscriptions.has(name)) continue;
    const userId = subscriptionUserId;
    const unsubscribe = onSnapshot(
      userCollection(name, userId),
      (snapshot) => {
        if (state.user?.uid !== userId || !activeSubscriptions.has(name)) return;
        observeCollectionSnapshot(name, snapshot);
        const sortFields = name === 'trash' ? ['deletedAt', 'updatedAt', 'createdAt'] : undefined;
        const items = sortByLatest(snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() })), sortFields);
        if (name === 'trash') cleanupExpiredTrashItems(items, userId).catch((error) => console.error('Erro ao limpar lixeira:', error));
        subscriptionCallback?.(name, items);
      },
      (error) => console.error(`Erro ao sincronizar ${name}:`, error)
    );
    activeSubscriptions.set(name, unsubscribe);
  }
}

export function stopSubscriptions() {
  for (const unsubscribe of activeSubscriptions.values()) unsubscribe();
  activeSubscriptions.clear();
  subscriptionCallback = null;
  subscriptionUserId = null;
}

export async function saveRecord(collectionName, payload, recordId = null) {
  const userId = currentUserId();
  const body = { ...payload, updatedAt: serverTimestamp() };
  if (!recordId) {
    const key = `${userId}:${operationKey(collectionName, payload)}`;
    if (pendingCreateWrites.has(key)) return pendingCreateWrites.get(key);
    body.createdAt = serverTimestamp();
    return rememberPending(pendingCreateWrites, key, addDoc(userCollection(collectionName, userId), body));
  }
  return setDoc(userDoc(collectionName, recordId, userId), body, { merge: true });
}

/** Salva um conjunto de lançamentos de forma atômica no Firestore.
 * Limite deliberado abaixo do máximo de 500 gravações por batch.
 */
export async function saveRecordBatch(collectionName, records = []) {
  const userId = currentUserId();
  if (!Array.isArray(records) || records.length === 0 || records.length > 400) {
    throw new Error('Quantidade de registros inválida para salvar em conjunto.');
  }
  const batch = writeBatch(db);
  const refs = records.map(({ id = null, data = {} }) => {
    const ref = id ? userDoc(collectionName, id, userId) : doc(userCollection(collectionName, userId));
    const value = { ...data, updatedAt: serverTimestamp() };
    if (!id) value.createdAt = serverTimestamp();
    batch.set(ref, value, { merge: Boolean(id) });
    return ref;
  });
  assertUnchangedUser(userId);
  await batch.commit();
  return refs;
}

/** Move todos os registros de um parcelamento à lixeira em uma transação única.
 * Uma falha cancela o grupo inteiro, sem excluir só algumas parcelas.
 */
export async function moveRecordsToTrashBatch(collectionName, ids = []) {
  const userId = currentUserId();
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100 || new Set(ids).size !== ids.length) {
    throw new Error('Seleção inválida de registros.');
  }
  const refs = ids.map((id) => userDoc(collectionName, id, userId));
  return runTransaction(db, async (transaction) => {
    const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));
    if (snapshots.some((snapshot) => !snapshot.exists())) throw new Error('Algum registro foi alterado. Atualize os dados e tente novamente.');
    assertUnchangedUser(userId);
    return snapshots.map((snapshot, index) => {
      const data = serializeForTrash(snapshot.data());
      const deletedAt = new Date();
      const expiresAt = addDays(deletedAt, TRASH_RETENTION_DAYS);
      const trashId = trashDocId(collectionName, ids[index]);
      transaction.set(userDoc('trash', trashId, userId), {
        title: titleForTrashItem(collectionName, data),
        originalModule: COLLECTION_LABELS[collectionName] || 'Outros',
        originalCollection: collectionName,
        originalId: ids[index],
        originalPath: `users/${userId}/${collectionName}/${ids[index]}`,
        deletedFrom: collectionName, deletedAt, expiresAt,
        restoreData: data,
        itemType: data.type || data.kind || data.flowType || data.status || '',
        updatedAt: serverTimestamp(), createdAt: serverTimestamp(),
      });
      transaction.delete(refs[index]);
      return { trashId, expiresAt };
    });
  });
}

/** Restaura um grupo de documentos simples ou não restaura nenhum. */
export async function restoreRecordsBatch(trashIds = []) {
  const userId = currentUserId();
  if (!Array.isArray(trashIds) || trashIds.length === 0 || trashIds.length > 100 || new Set(trashIds).size !== trashIds.length) {
    throw new Error('Seleção inválida de registros.');
  }
  const refs = trashIds.map((id) => userDoc('trash', id, userId));
  return runTransaction(db, async (transaction) => {
    const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));
    if (snapshots.some((snapshot) => !snapshot.exists())) throw new Error('Algum item da lixeira não está mais disponível.');
    assertUnchangedUser(userId);
    return snapshots.map((snapshot, index) => {
      const trash = snapshot.data();
      if (trash.restoreKind === 'nested-array-item' || !trash.originalCollection || !trash.originalId) {
        throw new Error('Este item requer restauração individual.');
      }
      const data = { ...(trash.restoreData || {}) };
      delete data.id;
      transaction.set(userDoc(trash.originalCollection, trash.originalId, userId), {
        ...data, restoredAt: serverTimestamp(), updatedAt: serverTimestamp(),
      }, { merge: true });
      transaction.delete(refs[index]);
      return { collectionName: trash.originalCollection, originalId: trash.originalId };
    });
  });
}

export async function deleteRecord(collectionName, recordId, options = {}) {
  const userId = currentUserId();
  const key = `${userId}:${collectionName}:${recordId}:${options.permanent === true || collectionName === 'trash' ? 'permanent' : 'trash'}`;
  if (pendingDeletes.has(key)) return pendingDeletes.get(key);

  const task = (async () => {
    const permanent = options.permanent === true || collectionName === 'trash';
    const sourceRef = userDoc(collectionName, recordId, userId);

    if (permanent) {
      await deleteDoc(sourceRef);
      return { permanent: true };
    }

    const previous = applyLocalRemoval(collectionName, recordId, { ttl: 15000 });
    try {
      const result = await runTransaction(db, async (transaction) => {
        const snapshot = await transaction.get(sourceRef);
        if (!snapshot.exists()) return { missing: true };
        const data = serializeForTrash(snapshot.data());
        const deletedAt = new Date();
        const expiresAt = addDays(deletedAt, TRASH_RETENTION_DAYS);
        const trashId = trashDocId(collectionName, recordId);
        const trashRef = userDoc('trash', trashId, userId);
        transaction.set(trashRef, {
          title: titleForTrashItem(collectionName, data),
          originalModule: COLLECTION_LABELS[collectionName] || 'Outros',
          originalCollection: collectionName,
          originalId: recordId,
          originalPath: `users/${userId}/${collectionName}/${recordId}`,
          deletedFrom: collectionName,
          deletedAt,
          expiresAt,
          restoreData: data,
          itemType: data.type || data.kind || data.flowType || data.status || '',
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        });
        transaction.delete(sourceRef);
        return { trashId, expiresAt };
      });
      assertUnchangedUser(userId);
      clearLocalRemoval(collectionName, recordId, { delay: 5000 });
      return result;
    } catch (error) {
      if (state.user?.uid === userId) rollbackLocalRemoval(collectionName, recordId, previous);
      throw error;
    }
  })();

  return rememberPending(pendingDeletes, key, task, 1200);
}

export async function deleteNestedArrayItem(collectionName, recordId, fieldName, itemId, options = {}) {
  const userId = currentUserId();
  const key = `${userId}:${collectionName}:${recordId}:${fieldName}:${itemId}`;
  if (pendingNestedDeletes.has(key)) return pendingNestedDeletes.get(key);

  const task = (async () => {
    const parentRef = userDoc(collectionName, recordId, userId);
    const parentSnapshot = await getDoc(parentRef);
    assertUnchangedUser(userId);
    if (!parentSnapshot.exists()) throw new Error('Item principal não encontrado.');
    const parentData = parentSnapshot.data() || {};
    const currentItems = Array.isArray(parentData[fieldName]) ? parentData[fieldName] : [];
    const nestedItem = currentItems.find((item) => item?.id === itemId);
    if (!nestedItem) return { missing: true };

    const nextItems = currentItems.filter((item) => item?.id !== itemId);
    const deletedAt = new Date();
    const expiresAt = addDays(deletedAt, TRASH_RETENTION_DAYS);
    const trashId = trashDocId(`${collectionName}_${recordId}_${fieldName}`, itemId);
    const trashRef = userDoc('trash', trashId, userId);
    const restoreData = serializeForTrash(nestedItem);
    const parentTitle = parentData.title || parentData.name || '';

    const previous = applyLocalPatch(collectionName, recordId, { [fieldName]: nextItems }, { ttl: 15000 });
    try {
      const moved = await runTransaction(db, async (transaction) => {
        const freshParent = await transaction.get(parentRef);
        if (!freshParent.exists()) throw new Error('Item principal não encontrado.');
        const freshItems = Array.isArray(freshParent.data()?.[fieldName]) ? freshParent.data()[fieldName] : [];
        const freshNested = freshItems.find((item) => item?.id === itemId);
        if (!freshNested) return false;
        transaction.set(trashRef, {
      title: options.title || freshNested.title || freshNested.text || freshNested.name || titleForTrashItem(collectionName, freshNested),
      originalModule: options.moduleLabel || COLLECTION_LABELS[collectionName] || 'Outros',
      originalCollection: collectionName,
      originalId: recordId,
      originalPath: `users/${userId}/${collectionName}/${recordId}.${fieldName}.${itemId}`,
      deletedFrom: collectionName,
      deletedAt,
      expiresAt,
      restoreKind: 'nested-array-item',
      parentCollection: collectionName,
      parentId: recordId,
      parentTitle,
      nestedField: fieldName,
      nestedId: itemId,
      restoreData: serializeForTrash(freshNested),
      itemType: options.itemType || freshNested.type || freshNested.kind || fieldName,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    });
        const nextValues = {
          [fieldName]: freshItems.filter((item) => item?.id !== itemId),
          updatedAt: serverTimestamp(),
        };
        if (fieldName === 'studySessions') {
          // O total acompanha a exclusão NA MESMA transação, evitando atualização
          // parcial ou valor errado em caso de rede lenta / concorrência.
          nextValues.studyTotalMs = Math.max(0, Number(freshParent.data()?.studyTotalMs || 0) - Math.max(0, Number(freshNested.durationMs || 0)));
          transaction.delete(userDoc('studySessions', itemId, userId));
        }
        transaction.update(parentRef, nextValues);
        return true;
      });
      assertUnchangedUser(userId);
      if (!moved) { clearLocalPatch(collectionName, recordId); return { missing: true }; }
      clearLocalPatch(collectionName, recordId, { delay: 5000 });
      return { trashId, expiresAt };
    } catch (error) {
      if (state.user?.uid === userId) rollbackLocalPatch(collectionName, recordId, previous);
      throw error;
    }
  })();

  return rememberPending(pendingNestedDeletes, key, task, 1200);
}

export async function restoreDeletedRecord(trashId) {
  const userId = currentUserId();
  const trashRef = userDoc('trash', trashId, userId);
  const snapshot = await getDoc(trashRef);
  assertUnchangedUser(userId);
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
    const parentRef = userDoc(parentCollection, parentId, userId);
    return runTransaction(db, async (transaction) => {
      const currentTrash = await transaction.get(trashRef);
      const parentSnapshot = await transaction.get(parentRef);
      if (!currentTrash.exists()) throw new Error('Este item já foi restaurado ou removido.');
      if (!parentSnapshot.exists()) throw new Error('O item original não foi encontrado para restaurar este registro.');
      const parentData = parentSnapshot.data() || {};
      const currentItems = Array.isArray(parentData[fieldName]) ? parentData[fieldName] : [];
      const itemToRestore = { ...restoreData, id: nestedId };
      const alreadyRestored = currentItems.some((item) => item?.id === nestedId);
      const nextItems = alreadyRestored ? currentItems : [...currentItems, itemToRestore];
      const restorePatch = { [fieldName]: nextItems, updatedAt: serverTimestamp() };
      if (!alreadyRestored && fieldName === 'studySessions') {
        restorePatch.studyTotalMs = Math.max(0, Number(parentData.studyTotalMs || 0)) + Math.max(0, Number(itemToRestore.durationMs || 0));
      }
      transaction.update(parentRef, restorePatch);
      if (fieldName === 'studySessions' && !alreadyRestored) {
        transaction.set(userDoc('studySessions', nestedId, userId), {
          ...itemToRestore,
          subjectId: parentId,
          subjectName: parentData.name || '',
          updatedAt: serverTimestamp(),
        }, { merge: true });
      }
      transaction.delete(trashRef);
      return { collectionName: parentCollection, originalId: parentId };
    });
  }

  delete restoreData.id;
  assertUnchangedUser(userId);
  return runTransaction(db, async (transaction) => {
    const currentTrash = await transaction.get(trashRef);
    if (!currentTrash.exists()) throw new Error('Este item já foi restaurado ou removido.');
    transaction.set(userDoc(collectionName, originalId, userId), {
      ...restoreData,
      restoredAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
    transaction.delete(trashRef);
    return { collectionName, originalId };
  });
}

export async function deleteTrashItem(trashId) {
  return deleteDoc(userDoc('trash', trashId, currentUserId()));
}

export async function emptyExpiredTrashNow() {
  await cleanupExpiredTrashItems(state.trash || []);
}

export async function patchRecord(collectionName, recordId, payload) {
  const userId = currentUserId();
  const writePayload = {
    ...payload,
    updatedAt: serverTimestamp(),
  };
  // A atualização otimista deve aparecer imediatamente na tela ativa.
  // Bloqueios globais de renderização escondiam o resultado até 12s após salvar.
  const previous = applyLocalPatch(collectionName, recordId, payload, { ttl: 12000 });

  try {
    const result = await updateDoc(userDoc(collectionName, recordId, userId), writePayload);
    clearLocalPatch(collectionName, recordId, { delay: 5000 });
    return result;
  } catch (error) {
    if (state.user?.uid === userId) rollbackLocalPatch(collectionName, recordId, previous);
    throw error;
  }
}

export async function toggleDateMapField(collectionName, recordId, fieldName, targetDateKey, enabled) {
  const key = `${fieldName}.${targetDateKey}`;
  return patchRecord(collectionName, recordId, { [key]: enabled });
}
