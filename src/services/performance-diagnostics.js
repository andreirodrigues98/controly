/** Diagnóstico local de frequência de snapshots e renderizações.
 * Conta documentos entregues pelo SDK (NÃO equivale à cobrança do Firestore).
 * Nunca coleta conteúdo dos documentos, e-mails ou outros dados pessoais.
 */
const counters = { snapshots: {}, documentChanges: {}, renders: {} };
const local = typeof window !== 'undefined' && ['localhost','127.0.0.1'].includes(window.location.hostname);
export function observeCollectionSnapshot(name, snapshot) {
  if (!local) return;
  const key = String(name);
  counters.snapshots[key] = (counters.snapshots[key] || 0) + 1;
  counters.documentChanges[key] = (counters.documentChanges[key] || 0) + (snapshot.docChanges?.().length ?? 0);
}
export function observeSectionRender(name, elapsedMs) {
  if (!local) return;
  const key = String(name);
  const current = counters.renders[key] || { count: 0, totalMs: 0, maxMs: 0 };
  counters.renders[key] = {
    count: current.count + 1,
    totalMs: Number((current.totalMs + elapsedMs).toFixed(2)),
    maxMs: Math.max(current.maxMs, Number(elapsedMs.toFixed(2))),
  };
}
export function readPerformanceDiagnostics() {
  return structuredClone(counters);
}
if (local) {
  // Inspecione pelo console do navegador somente durante o desenvolvimento.
  Object.defineProperty(window, '__CONTROLY_DIAGNOSTICS__', {value:readPerformanceDiagnostics, configurable:false});
}
