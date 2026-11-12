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
  if (error?.status === 409) return error.message || 'Esta conta já existe ou não pode ser alterada nesta situação.';
  if (error?.status === 400) return error.message || 'Confira os dados informados.';
  if (error?.status === 429) return 'Muitas consultas em sequência. Tente novamente mais tarde.';
  if (error?.status === 503) return 'A API administrativa não conseguiu acessar o serviço. Confira as credenciais e permissões.';
  if (!navigator.onLine) return 'Sem conexão com a internet.';
  return 'Não foi possível conectar à Administração VORA. Verifique se a API está publicada e se este endereço está autorizado.';
}

const ADMIN_REQUEST_TIMEOUT_MS = 12000;

async function limitedWait(promise, timeoutMs = ADMIN_REQUEST_TIMEOUT_MS) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new AdminRequestError('A verificação demorou além do esperado. Tente novamente.')), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const routeFor = {
  voraWhoAmI: '/v1/me',
  voraAccountSession: '/v1/session',
  voraListAccounts: '/v1/accounts',
  voraSetAccountAccess: '/v1/accounts/access',
  voraCreateAccount: '/v1/accounts/create',
  voraResendInvite: '/v1/accounts/invite',
  voraListAudit: '/v1/audit',
};

async function workerCall(name, payload = {}) {
  const user = auth?.currentUser;
  if (!user) throw new AdminRequestError('Entre na sua conta para acessar a administração.', 401);
  const token = await limitedWait(user.getIdToken());
  const params = new URLSearchParams();
  if (name === 'voraListAccounts' && payload.pageToken) params.set('pageToken', String(payload.pageToken));
  const url = `${controlyRuntime.adminWorkerUrl}${routeFor[name]}${params.size ? `?${params}` : ''}`;
  const isWrite = ['voraSetAccountAccess','voraCreateAccount','voraResendInvite'].includes(name);
  const body = name === 'voraSetAccountAccess' ? {uid:payload.uid,status:payload.status}
    : name === 'voraCreateAccount' ? {email:payload.email,displayName:payload.displayName}
    : name === 'voraResendInvite' ? {uid:payload.uid} : undefined;
  let response;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ADMIN_REQUEST_TIMEOUT_MS);
  try {
    response = await fetch(url, {
      signal: controller.signal,
      method: isWrite ? 'POST' : 'GET',
      headers: {Authorization: `Bearer ${token}`, ...(isWrite ? {'Content-Type':'application/json'} : {})},
      ...(isWrite ? {body: JSON.stringify(body)} : {}),
      cache: 'no-store',
    });
  } catch {
    throw new AdminRequestError('Não foi possível alcançar a API administrativa.');
  } finally {
    clearTimeout(timer);
  }
  const result = await limitedWait(response.json().catch(() => ({})));
  if (!response.ok) throw new AdminRequestError(result.error || 'A administração não está disponível.', response.status);
  return result;
}
export async function adminCall(name, payload = {}) {
  if (!isAdminBackendEnabled()) throw new AdminRequestError('A administração ainda não está habilitada nesta instalação.');
  if (!Object.hasOwn(routeFor, name)) throw new AdminRequestError('Operação administrativa inválida.', 400);
  return workerCall(name, payload);
}
