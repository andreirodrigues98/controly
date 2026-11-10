/** Exportação em demanda: lê somente paths privados da conta autenticada.
 * Consultas paginadas evitam carregar coleções inteiras num único snapshot.
 */
import { collection, doc, documentId, getDoc, getDocs, limit, orderBy, query, startAfter } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from './firebase.js';
import { state } from '../state/state.js';
import { createUserExport, exportFileName, USER_EXPORT_COLLECTIONS } from './data-export-core.js';
import { renderReadableUserReport } from './readable-export.js';
const PAGE_SIZE = 150;

async function readUserCollection(uid, name) {
  const output = [];
  const ref = collection(db, 'users', uid, name);
  let last = null;
  while (true) {
    if (state.user?.uid !== uid) throw new Error('A conta mudou durante a exportação.');
    const constraints = [orderBy(documentId()), limit(PAGE_SIZE)];
    if (last) constraints.push(startAfter(last));
    const snapshot = await getDocs(query(ref, ...constraints));
    output.push(...snapshot.docs.map(entry => ({ id: entry.id, data: entry.data() })));
    if (snapshot.size < PAGE_SIZE) break;
    last = snapshot.docs.at(-1);
  }
  return output;
}

export async function downloadOwnDataExport() {
  const user = state.user;
  if (!user?.uid) throw new Error('Entre na sua conta para exportar seus dados.');
  const uid = user.uid;
  const profileSnapshot = await getDoc(doc(db, 'users', uid));
  if (state.user?.uid !== uid) throw new Error('A conta mudou durante a exportação.');
  const collections = {};
  // Sequencial para evitar picos desnecessários de leituras simultâneas.
  for (const name of USER_EXPORT_COLLECTIONS) collections[name] = await readUserCollection(uid, name);
  const result = createUserExport({ uid, email: user.email || '', profile: profileSnapshot.data() || {}, collections });
  const blob = new Blob(['\ufeff', renderReadableUserReport(result)], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = exportFileName();
  anchor.style.display = 'none';
  document.body.append(anchor);
  try { anchor.click(); } finally { anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 10_000); }
  return Object.values(collections).reduce((sum, items) => sum + items.length, 0);
}
