/** Schema público do backup pessoal. Leitura explícita, nunca automática. */
export const USER_EXPORT_COLLECTIONS = Object.freeze([
  'activities', 'tasks', 'habits', 'routines', 'events', 'goals',
  'subjects', 'studySessions', 'studyMaterials', 'readingItems',
  'workouts', 'financeCards', 'financeEntries', 'notes', 'trash',
]);

function isTimestampLike(value) {
  return Boolean(value && typeof value.toDate === 'function' && typeof value.seconds === 'number');
}

/** Apenas dados, sem instâncias do SDK, sem informações do navegador e sem segredos. */
export function serializableUserValue(value, depth = 0) {
  if (depth > 40) throw new Error('O registro tem uma estrutura muito profunda para exportação.');
  if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (isTimestampLike(value)) return { $timestamp: value.toDate().toISOString() };
  if (value instanceof Date) return { $timestamp: value.toISOString() };
  if (Array.isArray(value)) return value.map(item => serializableUserValue(item, depth + 1));
  if (typeof value === 'object') {
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      if (typeof item !== 'function' && typeof item !== 'undefined') output[key] = serializableUserValue(item, depth + 1);
    }
    return output;
  }
  return null;
}

export function createUserExport({ uid, email = '', profile = {}, collections = {}, createdAt = new Date() }) {
  if (!uid || typeof uid !== 'string') throw new Error('Conta não identificada.');
  const result = { format: 'controly-user-export', version: 1, exportedAt: createdAt.toISOString(),
    account: { uid, email: String(email), profile: serializableUserValue(profile) }, collections: {} };
  for (const name of USER_EXPORT_COLLECTIONS) {
    result.collections[name] = (collections[name] || []).map(item => ({ id: String(item.id), ...serializableUserValue(item.data || {}) }));
  }
  return result;
}

export function exportFileName(date = new Date()) {
  return `controly-meus-dados-${date.toISOString().slice(0, 10)}.html`;
}
