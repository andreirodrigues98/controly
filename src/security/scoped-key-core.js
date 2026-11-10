export function makeScopedKey({ environment, projectId, uid, feature }) {
  if (!environment || !projectId || !uid || !feature) return null;
  return ['controly', environment, projectId, uid, feature].map(encodeURIComponent).join('.');
}
