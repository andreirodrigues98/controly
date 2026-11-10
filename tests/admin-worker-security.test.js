import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker, { verifyFirebaseToken } from '../worker-admin/src/index.js';
const raw = p => readFileSync(new URL('../' + p,import.meta.url),'utf8');

const fakeBindings = {
  FIREBASE_PROJECT_ID:'fixture-project',
  ALLOWED_ORIGINS:'http://127.0.0.1:5500',
  VORA_ADMIN_UIDS:'adminUser123',
  FIREBASE_SERVICE_ACCOUNT_JSON:'{}',
  ADMIN_READ_LIMIT:{limit:async()=>({success:true})},
  ADMIN_WRITE_LIMIT:{limit:async()=>({success:true})},
};
const call = (path, method='GET',headers={}) => worker.fetch(new Request('https://admin-fixture.workers.dev'+path,{method, headers}),fakeBindings);

test('API administrativa rejeita origens não autorizadas antes de consultar qualquer conta',async()=>{
  const response=await call('/v1/accounts','GET',{Origin:'https://atacante.example'});
  assert.equal(response.status,403);
  assert.equal(response.headers.get('access-control-allow-origin'),null);
});
test('API responde preflight apenas à origem configurada',async()=>{
  const response=await call('/v1/accounts','OPTIONS',{Origin:'http://127.0.0.1:5500'});
  assert.equal(response.status,204);
  assert.equal(response.headers.get('access-control-allow-origin'),'http://127.0.0.1:5500');
});
test('Não aceita chamadas sem token mesmo que origem seja autorizada',async()=>{
  const response=await call('/v1/accounts','GET',{Origin:'http://127.0.0.1:5500'});
  assert.equal(response.status,401);
});
test('Não aceita token sem assinatura',async()=>{
  const response=await call('/v1/me','GET',{Origin:'http://127.0.0.1:5500',Authorization:'Bearer aaa.bbb.ccc'});
  assert.equal(response.status,401);
});
test('Token com aud/issuer errado rejeitado antes da consulta à API',async()=>{
  const now=Math.floor(Date.now()/1000);
  const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
  const fake=[b64({alg:'RS256',kid:'123'}),b64({sub:'adminUser123',aud:'outro-projeto',iss:'https://securetoken.google.com/outro-projeto',iat:now-5,exp:now+200,auth_time:now-10}),Buffer.from('garbage').toString('base64url')].join('.');
  await assert.rejects(verifyFirebaseToken(fake,'fixture-project'), e=>e.status===401);
});
test('Acesso suspenso exige regra aplicada no banco; usuário não pode mudar status',()=>{
  const rules=raw('firestore.rules');
  assert.match(rules,/function canUseAccount/);
  assert.match(rules,/data.status == 'active'/);
  assert.match(rules,/match \/accountAccess/);
  assert.match(rules,/allow list, create, update, delete: if false/);
});
test('Backend usa uid como autorização secreta e não deixa de proteger alterações',()=>{
  const source=raw('worker-admin/src/index.js');
  assert.match(source,/isAdminUid\(payload.sub,env\)/);
  assert.match(source,/ADMIN_WRITE_LIMIT/);
  assert.match(source,/currentDocument:\{exists:false\}/);
  assert.doesNotMatch(source,/customClaims\s*=\s*true/);
  assert.doesNotMatch(raw('src/admin/admin-client.js'),/secret.*firebase/i);
});
test('Não publica o código administrativo nem suas credenciais no build web',()=>{
  const build=raw('scripts/build-pages.js');
  assert.ok(!build.includes('worker-admin'));
  assert.ok(!build.includes('FIREBASE_SERVICE_ACCOUNT_JSON'));
});
test('Pagamento recebe atualização otimista e recuo em caso de falha',()=>{
  const finance=raw('src/modules/module.finance.js');
  assert.match(finance,/applyLocalPatch\('financeEntries'/);
  assert.match(finance,/rollbackLocalPatch\('financeEntries'/);
  const state=raw('src/state/state.js');
  assert.match(state,/snapshot confirmado|Snapshot confirmado/);
});

test('Tokens assinados corretamente são aceitos e assinaturas adulteradas rejeitadas', async () => {
  const savedFetch = globalThis.fetch;
  const keypair = await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const jwk = await crypto.subtle.exportKey('jwk',keypair.publicKey);
  globalThis.fetch = async (url) => {
    assert.match(String(url),/service_accounts\/v1\/jwk/);
    return new Response(JSON.stringify({keys:[{...jwk,kid:'key_fixture',alg:'RS256',use:'sig'}]}),{status:200,headers:{'Cache-Control':'public,max-age=60'}});
  };
  try {
    const now = Math.floor(Date.now()/1000);
    const head=Buffer.from(JSON.stringify({alg:'RS256',kid:'key_fixture'})).toString('base64url');
    const body=Buffer.from(JSON.stringify({sub:'adminUser123',aud:'fixture-project',iss:'https://securetoken.google.com/fixture-project',iat:now-2,exp:now+300,auth_time:now-2})).toString('base64url');
    const signingInput=`${head}.${body}`;
    const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keypair.privateKey,new TextEncoder().encode(signingInput));
    const signed=`${signingInput}.${Buffer.from(signature).toString('base64url')}`;
    const payload=await verifyFirebaseToken(signed,'fixture-project');
    assert.equal(payload.sub,'adminUser123');
    await assert.rejects(verifyFirebaseToken(signed.slice(0,-8)+'12345678','fixture-project'),e=>e.status===401);
  } finally {globalThis.fetch=savedFetch;}
});

test('Finanças mantém atualização local até receber confirmação do snapshot',async()=>{
  const {setCollection,applyLocalPatch,state,resetState,rollbackLocalPatch}=await import('../src/state/state.js');
  resetState();
  setCollection('financeEntries',[{id:'entry-1',status:'pending',paid:false}]);
  const previous=applyLocalPatch('financeEntries','entry-1',{status:'paid',paid:true});
  assert.equal(state.financeEntries[0].status,'paid');
  setCollection('financeEntries',[{id:'entry-1',status:'pending',paid:false}]);
  assert.equal(state.financeEntries[0].status,'paid','snapshot antigo não deve reverter a ação');
  setCollection('financeEntries',[{id:'entry-1',status:'paid',paid:true}]);
  assert.equal(state.financeEntries[0].status,'paid');
  const prior=applyLocalPatch('financeEntries','entry-1',{status:'pending',paid:false});
  rollbackLocalPatch('financeEntries','entry-1',prior);
  assert.equal(state.financeEntries[0].status,'paid','falha restaura status anterior');
  assert.equal(previous.status,'pending');
  resetState();
});
