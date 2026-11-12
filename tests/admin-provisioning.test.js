import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker-admin/src/index.js?provision-v213';

const origin = 'https://andreirodrigues98.github.io';
const project = 'controly-fixture';
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');

let savedFixture;
async function fixture() {
  if (savedFixture) return savedFixture;
  const tokenKeys = await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const serviceKeys = await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const pkcs8=Buffer.from(await crypto.subtle.exportKey('pkcs8',serviceKeys.privateKey)).toString('base64');
  const pem=`-----BEGIN PRIVATE KEY-----\n${pkcs8.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
  const now=Math.floor(Date.now()/1000);
  const tok=async uid=>{
    const unsigned=[b64({alg:'RS256',kid:'provision-key'}),b64({sub:uid,aud:project,iss:`https://securetoken.google.com/${project}`,iat:now-1,exp:now+300,auth_time:now-1})].join('.');
    const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',tokenKeys.privateKey,new TextEncoder().encode(unsigned));
    return `${unsigned}.${Buffer.from(signature).toString('base64url')}`;
  };
  const env={FIREBASE_PROJECT_ID:project,FIREBASE_WEB_API_KEY:'fixture_key_1234567890123456',ALLOWED_ORIGINS:origin,VORA_ADMIN_UIDS:'administrator123',FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({project_id:project,client_email:'fixture@fixture.iam.gserviceaccount.com',private_key:pem}),ADMIN_READ_LIMIT:{limit:async()=>({success:true})},ADMIN_WRITE_LIMIT:{limit:async()=>({success:true})}};
  return savedFixture = {env, tokenAdmin:await tok('administrator123'), tokenUser:await tok('ordinary123'), tokenNew:await tok('newaccount123'), jwk:await crypto.subtle.exportKey('jwk',tokenKeys.publicKey)};
}

test('admin pode cadastrar e convidar sem jamais devolver ou registrar senha, e remover acesso sem excluir dados', async () => {
  const {env,tokenAdmin,tokenUser,tokenNew,jwk}=await fixture();
  const oldFetch=globalThis.fetch;
  const requests=[];
  const statuses=new Map();
  globalThis.fetch=async(url,opts={})=>{
    const u=String(url); requests.push({url:u,opts});
    if(u.includes('/v1/jwk/'))return Response.json({keys:[{...jwk,kid:'provision-key'}]});
    if(u.endsWith('/token'))return Response.json({access_token:'mock-oauth-token',expires_in:3600});
    if(u.includes('/documents/accountAccess/')) {
      const uid=u.split('/').at(-1);
      const status=statuses.get(uid);
      return status?Response.json({fields:{status:{stringValue:status}}}):new Response('',{status:404});
    }
    if(u.includes('identitytoolkit.googleapis.com')&&u.includes('/projects/')&&u.includes('/accounts?')) return Response.json({localId:'newaccount123',email:'new@example.test'});
    if(u.includes('identitytoolkit.googleapis.com')&&u.includes('accounts:sendOobCode')) return Response.json({email:'new@example.test'});
    if(u.endsWith('/documents:commit')) {
      const {writes}=JSON.parse(opts.body);
      for(const write of writes) if(write.update?.name.includes('/accountAccess/')) statuses.set(write.update.name.split('/').at(-1),write.update.fields.status.stringValue);
      return Response.json({writeResults:writes.map(()=>({}))});
    }
    if(u.endsWith('/documents/users/newaccount123')) return Response.json({fields:{email:{stringValue:'new@example.test'}}});
    throw new Error('URL inesperada: '+u);
  };
  const call=(path,token,body)=>worker.fetch(new Request(`https://fixture.workers.dev${path}`,{method:body?'POST':'GET',headers:{origin,authorization:`Bearer ${token}`,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined}),env);
  try {
    const common=await call('/v1/accounts/create',tokenUser,{email:'new@example.test',displayName:'Nova Conta'});
    assert.equal(common.status,403);
    const created=await call('/v1/accounts/create',tokenAdmin,{email:'NEW@example.test',displayName:'Nova Conta'});
    assert.equal(created.status,201);
    const body=await created.json();
    assert.deepEqual(body,{success:true,uid:'newaccount123',invited:true});
    assert.equal(statuses.get('newaccount123'),'active');
    assert.ok(!JSON.stringify(body).toLowerCase().includes('password'));
    const createdIdentity=requests.find(r=>r.url.includes('/projects/')&&r.url.includes('/accounts?'));
    const credential=JSON.parse(createdIdentity.opts.body).password;
    assert.ok(typeof credential === 'string' && credential.length >= 40);
    assert.equal(JSON.parse(createdIdentity.opts.body).email,'new@example.test');
    const commits=requests.filter(r=>r.url.endsWith('/documents:commit'));
    assert.equal(commits.length,2);
    assert.equal(JSON.parse(commits[0].opts.body).writes.find(x=>x.update?.name.includes('/accountAccess/')).update.fields.status.stringValue,'pending');
    const removed=await call('/v1/accounts/access',tokenAdmin,{uid:'newaccount123',status:'removed'});
    assert.equal(removed.status,200);
    assert.equal(statuses.get('newaccount123'),'removed');
    const archivedSession=await call('/v1/session',tokenNew);
    assert.equal(archivedSession.status,200);
    assert.equal((await archivedSession.json()).status,'suspended','Remoção de acesso deve negar a sessão de dados');
    const self=await call('/v1/accounts/access',tokenAdmin,{uid:'administrator123',status:'removed'});
    assert.equal(self.status,403);
    assert.ok(!requests.some(r=>r.url.includes('/accounts:delete')),'Remover acesso não apaga identidade do Authentication');
  } finally {globalThis.fetch=oldFetch;}
});

test('sem permissões de administrador ou dados válidos, cadastramento falha fechado',async()=>{
  const {env,tokenAdmin,jwk}=await fixture();
  const oldFetch=globalThis.fetch;
  const requests=[];
  globalThis.fetch=async(url,opts={})=>{
    const u=String(url);requests.push(u);
    if(u.includes('/v1/jwk/'))return Response.json({keys:[{...jwk,kid:'provision-key'}]});
    if(u.endsWith('/documents/accountAccess/administrator123'))return new Response('',{status:404});
    if(u.endsWith('/token'))return Response.json({access_token:'mock-token',expires_in:3600});
    if(u.includes('/projects/')&&u.includes('/accounts?'))return Response.json({error:{message:'PERMISSION_DENIED'}},{status:403});
    throw new Error('URL inesperada: '+u);
  };
  const call=body=>worker.fetch(new Request('https://fixture.workers.dev/v1/accounts/create',{method:'POST',headers:{origin,authorization:`Bearer ${tokenAdmin}`,'content-type':'application/json'},body:JSON.stringify(body)}),env);
  try {
    let response=await call({email:'not_an_email',displayName:'Nome'});
    assert.equal(response.status,400);
    response=await call({email:'user@example.test',displayName:'<img>'});
    assert.equal(response.status,400);
    response=await call({email:'user@example.test',displayName:'Nome Seguro'});
    assert.equal(response.status,503);
    assert.match((await response.json()).error,/Firebase Authentication Admin/);
  } finally {globalThis.fetch=oldFetch;}
});

test('interface expõe as ações somente pela API e não solicita senhas no formulário administrativo',async()=>{
  const fs=await import('node:fs');
  const module=fs.readFileSync(new URL('../src/admin/admin-module.js',import.meta.url),'utf8');
  const client=fs.readFileSync(new URL('../src/admin/admin-client.js',import.meta.url),'utf8');
  assert.match(module,/data-admin-create-form/);
  assert.match(module,/data-admin-status="removed"/);
  assert.match(module,/data-admin-invite/);
  assert.doesNotMatch(module,/<input[^>]+type="password"/i);
  assert.match(client,/voraCreateAccount/);
  assert.match(client,/voraResendInvite/);
  assert.doesNotMatch(client,/FIREBASE_SERVICE_ACCOUNT_JSON/);
});

test('falha no envio mantém cadastro pendente e permite reenviar acesso',async()=>{
  const {env,tokenAdmin,jwk}=await fixture();
  const oldFetch=globalThis.fetch;
  const statuses=new Map();
  let mailFailed=true;
  let created=0;
  globalThis.fetch=async(url,opts={})=>{
    const u=String(url);
    if(u.includes('/v1/jwk/'))return Response.json({keys:[{...jwk,kid:'provision-key'}]});
    if(u.endsWith('/token'))return Response.json({access_token:'mock',expires_in:3600});
    if(u.includes('/documents/accountAccess/')) {
      const status=statuses.get(u.split('/').at(-1));
      return status?Response.json({fields:{status:{stringValue:status}}}):new Response('',{status:404});
    }
    if(u.includes('identitytoolkit.googleapis.com')&&u.includes('/projects/')&&u.includes('/accounts?')){created++;return Response.json({localId:'pendinguser123'});}
    if(u.includes('identitytoolkit.googleapis.com')&&u.includes('accounts:sendOobCode'))return mailFailed?Response.json({error:{message:'EMAIL_SEND_FAILURE'}},{status:500}):Response.json({email:'pending@example.test'});
    if(u.endsWith('/documents/users/pendinguser123'))return Response.json({fields:{email:{stringValue:'pending@example.test'}}});
    if(u.endsWith('/documents:commit')) {
      const {writes}=JSON.parse(opts.body);
      for(const write of writes) if(write.update?.name.includes('/accountAccess/')) statuses.set(write.update.name.split('/').at(-1),write.update.fields.status.stringValue);
      return Response.json({writeResults:writes.map(()=>({}))});
    }
    throw new Error('URL inesperada: '+u);
  };
  const call=(path,body)=>worker.fetch(new Request('https://fixture.workers.dev'+path,{method:'POST',headers:{origin,authorization:`Bearer ${tokenAdmin}`,'content-type':'application/json'},body:JSON.stringify(body)}),env);
  try{
    let response=await call('/v1/accounts/create',{email:'pending@example.test',displayName:'Pessoa Pendente'});
    assert.equal(response.status,201);
    assert.equal((await response.json()).invited,false);
    assert.equal(statuses.get('pendinguser123'),'pending');
    mailFailed=false;
    response=await call('/v1/accounts/invite',{uid:'pendinguser123'});
    assert.equal(response.status,200);
    assert.equal(statuses.get('pendinguser123'),'active');
    assert.equal(created,1,'Reenvio não deve criar uma segunda conta');
  }finally{globalThis.fetch=oldFetch;}
});
