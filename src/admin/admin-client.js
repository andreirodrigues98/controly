import { app, auth } from '../services/firebase.js';
import { controlyRuntime } from '../../firebase-config.js';

export function isAdminBackendEnabled() {
  return Boolean(app && controlyRuntime.adminBackendEnabled === true && controlyRuntime.adminWorkerUrl);
}
export function isWorkerAdmin() {
  return isAdminBackendEnabled() && Boolean(controlyRuntime.adminWorkerUrl);
}
async function workerCall(name, payload) {
  const user = auth?.currentUser;
  if (!user) throw new Error('Entre na sua conta para acessar a administração.');
  const token = await user.getIdToken();
  const base = controlyRuntime.adminWorkerUrl;
  const route = name === 'voraWhoAmI' ? '/v1/me' : name === 'voraListAccounts' ? '/v1/accounts' : '/v1/accounts/access';
  const listParams = name === 'voraListAccounts' && payload?.pageToken ? `?pageToken=${encodeURIComponent(payload.pageToken)}` : '';
  const response = await fetch(`${base}${route}${listParams}`, {
    method: name === 'voraSetAccountAccess' ? 'POST' : 'GET',
    headers: {Authorization: `Bearer ${token}`, ...(name === 'voraSetAccountAccess' ? {'Content-Type':'application/json'} : {})},
    ...(name === 'voraSetAccountAccess' ? {body: JSON.stringify({uid:payload.uid,status:payload.status})} : {}),
    cache: 'no-store',
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'A administração não está disponível.');
  return result;
}
export async function adminCall(name, payload = {}) {
  if (!isAdminBackendEnabled() || !['voraWhoAmI','voraListAccounts','voraSetAccountAccess'].includes(name)) {
    throw new Error('Administração não está habilitada neste ambiente.');
  }
  return workerCall(name, payload);
}
