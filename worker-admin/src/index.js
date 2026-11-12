/* VORA Controly — API administrativa para Cloudflare Workers Free.
 * Nada privilegiado deve ser enviado ao navegador. Default: acesso NEGADO.
 */
const CERTS_JWK = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit';
let publicKeys = null;
let keysExpireAt = 0;
let oauth = null;
let oauthExpiresAt = 0;
const enc = new TextEncoder();

export class AdminError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function invalid(status, message) { throw new AdminError(status, message); }
function encoded(bytes) {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let b64 = '';
  for (const byte of source) b64 += String.fromCharCode(byte);
  return btoa(b64).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function decode(text) {
  if (!/^[A-Za-z0-9_-]+$/.test(text || '')) invalid(401, 'Token inválido.');
  const str = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(str, c => c.charCodeAt(0));
}
const base64 = obj => encoded(enc.encode(JSON.stringify(obj)));
function parseJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || token.length > 10000) invalid(401, 'Token inválido.');
  try { return { head: JSON.parse(new TextDecoder().decode(decode(parts[0]))), payload: JSON.parse(new TextDecoder().decode(decode(parts[1]))), parts }; }
  catch { invalid(401, 'Token inválido.'); }
}
async function getKeys() {
  if (publicKeys && Date.now() < keysExpireAt) return publicKeys;
  const response = await fetch(CERTS_JWK, { headers: { accept: 'application/json' } });
  if (!response.ok) invalid(503, 'Não foi possível validar a sessão.');
  const result = await response.json();
  if (!Array.isArray(result.keys)) invalid(503, 'Chaves de autenticação indisponíveis.');
  const maxAge = /max-age=(\d+)/.exec(response.headers.get('cache-control') || '');
  keysExpireAt = Date.now() + Math.min(Number(maxAge?.[1] || 300), 3600) * 1000;
  publicKeys = result.keys;
  return publicKeys;
}
export async function verifyFirebaseToken(token, projectId) {
  const { head, payload, parts } = parseJwt(token);
  const now = Math.floor(Date.now() / 1000);
  if (head.alg !== 'RS256' || !head.kid || payload.aud !== projectId ||
      payload.iss !== `https://securetoken.google.com/${projectId}` ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(payload.sub || '') ||
      !Number.isFinite(payload.exp) || payload.exp <= now ||
      !Number.isFinite(payload.iat) || payload.iat > now ||
      !Number.isFinite(payload.auth_time) || payload.auth_time > now ||
      payload.iat > payload.exp) invalid(401, 'Sessão inválida ou expirada.');
  const jwk = (await getKeys()).find(k => k.kid === head.kid && k.kty === 'RSA' && k.n && k.e);
  if (!jwk) invalid(401, 'Assinatura não reconhecida.');
  const key = await crypto.subtle.importKey('jwk', jwk, { name:'RSASSA-PKCS1-v1_5', hash:'SHA-256' }, false, ['verify']);
  const verified = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decode(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`));
  if (!verified) invalid(401, 'Assinatura inválida.');
  return payload;
}
function rsaKeyPem(pem) {
  const raw = String(pem || '').replace(/\\n/g, '\n').replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  if (!raw) invalid(503, 'Credencial de servidor não configurada.');
  return Uint8Array.from(atob(raw), c=>c.charCodeAt(0));
}
async function getGoogleToken(env) {
  if (oauth && Date.now() < oauthExpiresAt - 60000) return oauth;
  let account;
  try { account = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON); }
  catch { invalid(503, 'Credencial privada não configurada.'); }
  if (account.project_id !== env.FIREBASE_PROJECT_ID || !account.client_email || !account.private_key) invalid(503, 'Credencial não corresponde ao projeto.');
  const now = Math.floor(Date.now()/1000);
  const header = base64({alg:'RS256',typ:'JWT'});
  const claims = base64({iss:account.client_email,scope:SCOPE,aud:TOKEN_ENDPOINT,iat:now,exp:now+3300});
  const data = `${header}.${claims}`;
  const privateKey = await crypto.subtle.importKey('pkcs8', rsaKeyPem(account.private_key), {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'}, false, ['sign']);
  const signature = encoded(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, enc.encode(data)));
  const response = await fetch(TOKEN_ENDPOINT, {method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:`${data}.${signature}`}).toString()});
  if (!response.ok) invalid(503, 'Não foi possível autenticar a API administrativa.');
  const result = await response.json();
  if (!result.access_token) invalid(503, 'Credencial de API indisponível.');
  oauth = result.access_token;
  oauthExpiresAt = Date.now() + (Number(result.expires_in) || 3600)*1000;
  return oauth;
}
function identityApiKey(env) {
  const key = String(env.FIREBASE_WEB_API_KEY || '').trim();
  if (!/^[A-Za-z0-9_-]{20,160}$/.test(key)) invalid(503, 'Configure FIREBASE_WEB_API_KEY como segredo no Worker para cadastrar contas.');
  return key;
}
async function identityRequest(env, endpoint, body, errorStatus = 503) {
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/${endpoint}?key=${encodeURIComponent(identityApiKey(env))}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${await getGoogleToken(env)}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    let errorCode = '';
    try {errorCode = (await response.json())?.error?.message || '';} catch {}
    if (/EMAIL_EXISTS|EMAIL_ALREADY_EXISTS/.test(errorCode)) invalid(409, 'Este e-mail já possui uma conta.');
    if (response.status === 403) invalid(503, 'A conta de serviço precisa da permissão Firebase Authentication Admin para cadastrar usuários.');
    if (/OPERATION_NOT_ALLOWED/.test(errorCode)) invalid(503, 'Habilite o provedor E-mail/senha no Firebase Authentication.');
    invalid(errorStatus, 'Não foi possível concluir esta ação no Firebase Authentication.');
  }
  return response.json();
}
function cleanEmail(value) {
  if (typeof value !== 'string' || value.length > 254) invalid(400, 'Informe um e-mail válido.');
  const email = value.trim().toLowerCase();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) invalid(400, 'Informe um e-mail válido.');
  return email;
}
function cleanName(value) {
  if (typeof value !== 'string' || value.trim().length < 2 || value.trim().length > 100 || /[<>\x00-\x1f]/.test(value)) invalid(400, 'Informe um nome com 2 a 100 caracteres.');
  return value.trim().replace(/\s+/g, ' ');
}
function docValue(value) {return {stringValue: String(value)};}
function docTime(value) {return {timestampValue: value};}
function documentPath(env, resource, id) {return `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${resource}/${id}`;}
async function commitWrites(env, writes) {return firestoreRequest(env, 'POST', ':commit', {writes});}
async function markInviteDelivered(env, uid, actorUid, action) {
  const now = new Date().toISOString();
  const auditId = crypto.randomUUID();
  await commitWrites(env, [
    {update:{name:documentPath(env,'accountAccess',uid),fields:{status:docValue('active'),updatedAt:docTime(now),updatedBy:docValue(actorUid)}},updateMask:{fieldPaths:['status','updatedAt','updatedBy']}},
    {update:{name:documentPath(env,'adminAudit',auditId),fields:{actorUid:docValue(actorUid),targetUid:docValue(uid),action:docValue(action),at:docTime(now)}},currentDocument:{exists:false}},
  ]);
}
async function sendPasswordSetup(env, email) {
  // O link é enviado pelo Firebase; senhas jamais passam pelo navegador do administrador.
  return identityRequest(env, 'accounts:sendOobCode', {requestType:'PASSWORD_RESET',email}, 503);
}
async function createAccount(env, body, actorUid) {
  identityApiKey(env); // Evita criar identidade sem poder enviar o convite.
  const email = cleanEmail(body.email);
  const displayName = cleanName(body.displayName);
  // A senha aleatória não é transmitida, armazenada pelo app nem exibida ao administrador.
  const password = encoded(crypto.getRandomValues(new Uint8Array(36)));
  const created = await identityRequest(env, `projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/accounts`, { email, displayName, password, emailVerified:false, disabled:false });
  const uid = cleanUid(created.localId);
  const now = new Date().toISOString();
  try {
    await commitWrites(env, [
      {update:{name:documentPath(env,'users',uid),fields:{uid:docValue(uid),email:docValue(email),displayName:docValue(displayName),createdAt:docTime(now),updatedAt:docTime(now),avatarDataUrl:docValue('')}},currentDocument:{exists:false}},
      {update:{name:documentPath(env,'accountAccess',uid),fields:{status:docValue('pending'),updatedAt:docTime(now),updatedBy:docValue(actorUid)}},currentDocument:{exists:false}},
      {update:{name:documentPath(env,'adminAudit',crypto.randomUUID()),fields:{actorUid:docValue(actorUid),targetUid:docValue(uid),action:docValue('create'),at:docTime(now)}},currentDocument:{exists:false}},
    ]);
  } catch (error) {
    // Um perfil órfão nunca deve permanecer ativo se a persistência falhar.
    try { await identityRequest(env, `projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/accounts:delete`, {localId:uid}); } catch {}
    throw error;
  }
  try {
    await sendPasswordSetup(env,email);
    await markInviteDelivered(env,uid,actorUid,'invite');
    return {success:true,uid,invited:true};
  } catch {
    // A conta permanece pending e sem acesso; a operação de reenvio conclui a ativação.
    return {success:true,uid,invited:false,notice:'Conta criada, mas o e-mail de acesso não foi confirmado. Use Reenviar acesso.'};
  }
}
async function resendInvite(env, uid, actorUid) {
  cleanUid(uid);
  if (isAdminUid(uid,env)) invalid(403,'Conta administrativa protegida.');
  const profile = await firestoreRequest(env,'GET',`/users/${uid}`);
  if (!profile) invalid(404,'Conta não encontrada.');
  const access = await firestoreRequest(env,'GET',`/accountAccess/${uid}`);
  if (firestoreValue(access?.fields?.status) !== 'pending') invalid(409,'Este acesso não está aguardando convite.');
  await sendPasswordSetup(env,cleanEmail(firestoreValue(profile.fields?.email)));
  await markInviteDelivered(env,uid,actorUid,'invite');
  return {success:true};
}
function firestoreBase(env) { return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/databases/(default)/documents`; }
async function firestoreRequest(env, method, path, data) {
  const response = await fetch(firestoreBase(env)+path, {method,headers:{authorization:`Bearer ${await getGoogleToken(env)}`,'content-type':'application/json'},body: data === undefined ? undefined : JSON.stringify(data)});
  if (response.status === 404) return null;
  if (!response.ok) invalid(503, 'Banco administrativo indisponível. Confira as permissões do serviço.');
  return response.json();
}
function firestoreValue(field) {
  if (!field) return null;
  if ('stringValue' in field) return field.stringValue;
  if ('timestampValue' in field) return field.timestampValue;
  if ('booleanValue' in field) return field.booleanValue;
  if ('integerValue' in field) return Number(field.integerValue);
  return null;
}
function cleanUid(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) invalid(400, 'Conta inválida.');
  return value;
}
function isAdminUid(uid, env) {
  return String(env.VORA_ADMIN_UIDS || '').split(',').map(v=>v.trim()).filter(Boolean).includes(uid);
}
function corsHeaders(origin) { return {'access-control-allow-origin':origin,'vary':'Origin','access-control-allow-headers':'Authorization, Content-Type','access-control-allow-methods':'GET, POST, OPTIONS','access-control-max-age':'600'}; }
function json(data, status=200, origin='') {return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-frame-options':'DENY',...(origin?corsHeaders(origin):{})}});}
async function accountSession(env, uid) {
  cleanUid(uid);
  const record = await firestoreRequest(env, 'GET', `/accountAccess/${uid}`);
  const status = firestoreValue(record?.fields?.status);
  // Compatibilidade de migração: contas ainda sem accountAccess estão ativas.
  // Só o backend autenticado pode responder sobre o estado da sessão.
  return { status: status && status !== 'active' ? 'suspended' : 'active', admin: isAdminUid(uid, env) };
}
async function listAccounts(env, pageToken='', actorUid='') {
  if (pageToken.length > 512) invalid(400,'Página inválida.');
  const params = new URLSearchParams({pageSize:'30'});
  if (pageToken) params.set('pageToken',pageToken);
  const result = await firestoreRequest(env,'GET',`/users?${params}`);
  const users = result?.documents || [];
  const accounts = await Promise.all(users.map(async user => {
    const uid = cleanUid(user.name.split('/').at(-1));
    const access = await firestoreRequest(env,'GET',`/accountAccess/${uid}`);
    return { uid, email: firestoreValue(user.fields?.email) || '', displayName: firestoreValue(user.fields?.displayName) || '',
      createdAt: firestoreValue(user.fields?.createdAt) || user.createTime || '',
      status: ['suspended','removed','pending'].includes(firestoreValue(access?.fields?.status)) ? firestoreValue(access.fields.status) : 'active',
      isSuperAdmin: isAdminUid(uid,env),isSelf: uid === actorUid };
  }));
  return {accounts,nextPageToken:result?.nextPageToken || ''};
}
async function listAudit(env) {
  // Dados de auditoria são acessíveis somente à API com UID administrativo autorizado.
  const params = new URLSearchParams({pageSize:'30', orderBy:'at desc'});
  const result = await firestoreRequest(env,'GET',`/adminAudit?${params}`);
  const events = (result?.documents || []).map(item => ({
    actorUid: firestoreValue(item.fields?.actorUid) || '',
    targetUid: firestoreValue(item.fields?.targetUid) || '',
    action: firestoreValue(item.fields?.action) || '',
    at: firestoreValue(item.fields?.at) || item.createTime || '',
  }));
  return {events};
}
async function changeAccess(env, uid, status, operatorUid) {
  cleanUid(uid);
  if (!['active','suspended','removed'].includes(status)) invalid(400,'Situação inválida.');
  if (uid === operatorUid || isAdminUid(uid,env)) invalid(403,'Não é permitido alterar uma conta administradora.');
  const userProfile = await firestoreRequest(env,'GET',`/users/${uid}`);
  if (!userProfile) invalid(404,'Conta não encontrada.');
  const path = `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
  const auditId = crypto.randomUUID();
  const now = new Date().toISOString();
  await firestoreRequest(env,'POST',':commit',{writes:[
    {update:{name:`${path}/accountAccess/${uid}`,fields:{status:{stringValue:status},updatedAt:{timestampValue:now},updatedBy:{stringValue:operatorUid}}},updateMask:{fieldPaths:['status','updatedAt','updatedBy']}},
    {update:{name:`${path}/adminAudit/${auditId}`,fields:{actorUid:{stringValue:operatorUid},targetUid:{stringValue:uid},action:{stringValue:status==='suspended'?'suspend':status==='removed'?'remove':'activate'},at:{timestampValue:now}}},currentDocument:{exists:false}}
  ]});
  return {success:true,status};
}

export async function readAdminJson(request, maxBytes = 8192) {
  if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get('content-type') || '')) invalid(415, 'Envie dados no formato JSON.');
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > maxBytes) invalid(413, 'Requisição muito grande.');
  const reader = request.body?.getReader();
  if (!reader) invalid(400, 'Dados inválidos.');
  let total = 0;
  const chunks = [];
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel(); invalid(413, 'Requisição muito grande.'); }
      chunks.push(value);
    }
    const combined = new Uint8Array(total);
    let offset = 0;
    chunks.forEach(chunk => { combined.set(chunk, offset); offset += chunk.byteLength; });
    const parsed = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(combined));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) invalid(400, 'Dados inválidos.');
    return parsed;
  } catch (error) {
    if (error instanceof AdminError) throw error;
    invalid(400, 'Dados inválidos.');
  } finally { try { reader.releaseLock(); } catch {} }
}

export default {
  async fetch(request,env) {
    const origin = request.headers.get('origin') || '';
    const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(v=>v.trim()).filter(Boolean);
    if (!origin || !allowed.includes(origin)) return json({error:'Origem não autorizada.'},403);
    if (request.method === 'OPTIONS') return new Response(null,{status:204,headers:corsHeaders(origin)});
    try {
      const project = String(env.FIREBASE_PROJECT_ID || '');
      if (!project || project.includes('SUBSTITUA') || !env.VORA_ADMIN_UIDS || !env.FIREBASE_SERVICE_ACCOUNT_JSON) invalid(503,'Administração não configurada.');
      const url = new URL(request.url);
      if (!['GET','POST'].includes(request.method)) invalid(405,'Método inválido.');
      const token = /^Bearer (\S+)$/.exec(request.headers.get('authorization') || '')?.[1];
      if (!token) invalid(401,'Faça login no Controly.');
      const payload = await verifyFirebaseToken(token,project);
      // Esta rota é acessível a qualquer conta autenticada. Não concede poderes administrativos.
      if (request.method === 'GET' && url.pathname === '/v1/session') {
        if (!env.ADMIN_READ_LIMIT || !(await env.ADMIN_READ_LIMIT.limit({key:payload.sub})).success) invalid(429,'Limite de consultas atingido.');
        return json(await accountSession(env, payload.sub),200,origin);
      }
      if (!isAdminUid(payload.sub,env)) invalid(403,'Acesso administrativo não autorizado.');
      if ((await accountSession(env, payload.sub)).status !== 'active') invalid(403, 'A conta está suspensa.');
      const action = request.method === 'GET' && url.pathname === '/v1/me' ? 'me'
        : request.method === 'GET' && url.pathname === '/v1/audit' ? 'audit'
        : request.method === 'GET' && url.pathname === '/v1/accounts' ? 'list'
        : request.method === 'POST' && url.pathname === '/v1/accounts/access' ? 'change'
        : request.method === 'POST' && url.pathname === '/v1/accounts/create' ? 'create'
        : request.method === 'POST' && url.pathname === '/v1/accounts/invite' ? 'invite' : null;
      if (!action) invalid(404,'Operação não encontrada.');
      const binding = ['change','create','invite'].includes(action) ? env.ADMIN_WRITE_LIMIT : env.ADMIN_READ_LIMIT;
      // Falha fechada: nunca operar sem proteção ativa contra abuso.
      if (!binding || !(await binding.limit({key:payload.sub})).success) invalid(429,'Limite de consultas atingido ou proteção indisponível.');
      if (action === 'me') return json({admin:true},200,origin);
      if (action === 'list') return json(await listAccounts(env,url.searchParams.get('pageToken') || '',payload.sub),200,origin);
      if (action === 'audit') return json(await listAudit(env),200,origin);
      const body = await readAdminJson(request);
      if (action === 'create') return json(await createAccount(env,body,payload.sub),201,origin);
      if (action === 'invite') return json(await resendInvite(env,body.uid,payload.sub),200,origin);
      return json(await changeAccess(env,body.uid,body.status,payload.sub),200,origin);
    } catch(error) {
      return json({error:error instanceof AdminError ? error.message : 'Operação indisponível.'},error instanceof AdminError ? error.status : 503,origin);
    }
  }
};
