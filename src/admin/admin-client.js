import { app, auth } from '../services/firebase.js';
import { controlyRuntime } from '../../firebase-config.js';

/** Somente o servidor autoriza administradores; o navegador apenas mostra a interface. */
export function isAdminBackendEnabled() {
  return Boolean(app && controlyRuntime.adminBackendEnabled === true && controlyRuntime.adminWorkerUrl);
}
export function isWorkerAdmin() { return isAdminBackendEnabled(); }

export class AdminRequestError extends Error {
  constructor(message, status = 0) { super(message); this.name = 'AdminRequestError'; this.status = status; }
}

export function adminErrorMessage(error) {
  if (error?.status === 403) return 'Esta conta não está autorizada no Admin VORA, ou a origem do site ainda não foi liberada na API.';
  if (error?.status === 401) return 'Sua sessão precisa ser renovada. Saia e entre novamente.';
  if (error?.status === 429) return 'Muitas consultas em sequência. Tente novamente mais tarde.';
  if (error?.status === 503) return 'A API administrativa não conseguiu acessar o serviço. Confira as credenciais e permissões.';
  if (!navigator.onLine) return 'Sem conexão com a internet.';
  return 'Não foi possível conectar à Administração VORA. Verifique se a API está publicada e se este endereço está autorizado.';
}

const routeFor = {
  voraWhoAmI: '/v1/me',
  voraAccountSession: '/v1/session',
  voraListAccounts: '/v1/accounts',
  voraSetAccountAccess: '/v1/accounts/access',
  voraListAudit: '/v1/audit',
};

async function workerCall(name, payload = {}) {
  const user = auth?.currentUser;
  if (!user) throw new AdminRequestError('Entre na sua conta para acessar a administração.', 401);
  const token = await user.getIdToken();
  const params = new URLSearchParams();
  if (name === 'voraListAccounts' && payload.pageToken) params.set('pageToken', String(payload.pageToken));
  const url = `${controlyRuntime.adminWorkerUrl}${routeFor[name]}${params.size ? `?${params}` : ''}`;
  let response;
  try {
    response = await fetch(url, {
      method: name === 'voraSetAccountAccess' ? 'POST' : 'GET',
      headers: {Authorization: `Bearer ${token}`, ...(name === 'voraSetAccountAccess' ? {'Content-Type':'application/json'} : {})},
      ...(name === 'voraSetAccountAccess' ? {body: JSON.stringify({uid:payload.uid,status:payload.status})} : {}),
      cache: 'no-store',
    });
  } catch {
    throw new AdminRequestError('Não foi possível alcançar a API administrativa.');
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new AdminRequestError(result.error || 'A administração não está disponível.', response.status);
  return result;
}
export async function adminCall(name, payload = {}) {
  if (!isAdminBackendEnabled()) throw new AdminRequestError('A administração ainda não está habilitada nesta instalação.');
  if (!Object.hasOwn(routeFor, name)) throw new AdminRequestError('Operação administrativa inválida.', 400);
  return workerCall(name, payload);
}
