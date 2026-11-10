/* VORA Controly — API administrativa para Cloudflare Workers Free.
 * Nada privilegiado deve ser enviado ao navegador. Default: acesso NEGADO.
 */
const CERTS_JWK = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/datastore';
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
function json(data, status=200, origin='') {return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...(origin?corsHeaders(origin):{})}});}
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
      status: firestoreValue(access?.fields?.status) === 'suspended' ? 'suspended' : 'active',
      isSuperAdmin: isAdminUid(uid,env),isSelf: uid === actorUid };
  }));
  return {accounts,nextPageToken:result?.nextPageToken || ''};
}
async function changeAccess(env, uid, status, operatorUid) {
  cleanUid(uid);
  if (!['active','suspended'].includes(status)) invalid(400,'Situação inválida.');
  if (uid === operatorUid || isAdminUid(uid,env)) invalid(403,'Não é permitido alterar uma conta administradora.');
  const userProfile = await firestoreRequest(env,'GET',`/users/${uid}`);
  if (!userProfile) invalid(404,'Conta não encontrada.');
  const path = `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
  const auditId = crypto.randomUUID();
  const now = new Date().toISOString();
  await firestoreRequest(env,'POST',':commit',{writes:[
    {update:{name:`${path}/accountAccess/${uid}`,fields:{status:{stringValue:status},updatedAt:{timestampValue:now},updatedBy:{stringValue:operatorUid}}},updateMask:{fieldPaths:['status','updatedAt','updatedBy']}},
    {update:{name:`${path}/adminAudit/${auditId}`,fields:{actorUid:{stringValue:operatorUid},targetUid:{stringValue:uid},action:{stringValue:status==='suspended'?'suspend':'activate'},at:{timestampValue:now}}},currentDocument:{exists:false}}
  ]});
  return {success:true,status};
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
      if (!isAdminUid(payload.sub,env)) invalid(403,'Acesso administrativo não autorizado.');
      const action = request.method === 'GET' && url.pathname === '/v1/me' ? 'me'
        : request.method === 'GET' && url.pathname === '/v1/accounts' ? 'list'
        : request.method === 'POST' && url.pathname === '/v1/accounts/access' ? 'change' : null;
      if (!action) invalid(404,'Operação não encontrada.');
      const binding = action === 'change' ? env.ADMIN_WRITE_LIMIT : env.ADMIN_READ_LIMIT;
      // Falha fechada: nunca operar sem proteção ativa contra abuso.
      if (!binding || !(await binding.limit({key:payload.sub})).success) invalid(429,'Limite de consultas atingido ou proteção indisponível.');
      if (action === 'me') return json({admin:true},200,origin);
      if (action === 'list') return json(await listAccounts(env,url.searchParams.get('pageToken') || '',payload.sub),200,origin);
      if (Number(request.headers.get('content-length') || 0) > 8192) invalid(413,'Requisição muito grande.');
      let body;
      try { body = await request.json(); } catch { invalid(400,'Dados inválidos.'); }
      if (!body || typeof body !== 'object') invalid(400,'Dados inválidos.');
      return json(await changeAccess(env,body.uid,body.status,payload.sub),200,origin);
    } catch(error) {
      return json({error:error instanceof AdminError ? error.message : 'Operação indisponível.'},error instanceof AdminError ? error.status : 503,origin);
    }
  }
};
