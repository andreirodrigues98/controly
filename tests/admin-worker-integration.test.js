import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker-admin/src/index.js?integration-fixture';

const origin='http://127.0.0.1:5500';
const project='controly-test-project';
const b64=object=>Buffer.from(JSON.stringify(object)).toString('base64url');
async function tokenFor(keyPair,uid,kid) {
  const now=Math.floor(Date.now()/1000);
  const unsigned=[b64({alg:'RS256',kid}),b64({sub:uid,aud:project,iss:`https://securetoken.google.com/${project}`,iat:now-3,exp:now+300,auth_time:now-3})].join('.');
  const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keyPair.privateKey,new TextEncoder().encode(unsigned));
  return `${unsigned}.${Buffer.from(signature).toString('base64url')}`;
}
const pair=()=>crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);

test('API Worker permite lista e suspensão autenticadas e nega conta sem permissão',async()=>{
  const tokenKeys=await pair();
  const serviceKeys=await pair();
  const pkcs8=Buffer.from(await crypto.subtle.exportKey('pkcs8',serviceKeys.privateKey)).toString('base64');
  const pem=`-----BEGIN PRIVATE KEY-----\n${pkcs8.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
  const calls=[];
  let suspendRegularUser = false;
  let suspendAdmin = false;
  const oldFetch=globalThis.fetch;
  globalThis.fetch=async (url,opts={})=>{
    const name=String(url);calls.push({name,opts});
    if (name.includes('/v1/jwk/')) {
      const jwk=await crypto.subtle.exportKey('jwk',tokenKeys.publicKey);
      return Response.json({keys:[{...jwk,kid:'fixture-kid'}]},{headers:{'cache-control':'max-age=300'}});
    }
    if (name.endsWith('/token')) return Response.json({access_token:'mock-google-oauth',expires_in:3600});
    if (name.endsWith('/documents/users?pageSize=30')) return Response.json({documents:[{name:`projects/${project}/databases/(default)/documents/users/normaluser123`,fields:{email:{stringValue:'cliente@example.test'},displayName:{stringValue:'Cliente'}}}]});
    if (name.endsWith('/documents/accountAccess/normaluser123')) return suspendRegularUser ? Response.json({fields:{status:{stringValue:'suspended'}}}) : new Response('',{status:404});
    if (name.endsWith('/documents/accountAccess/administrator123')) return suspendAdmin ? Response.json({fields:{status:{stringValue:'suspended'}}}) : new Response('',{status:404});
    if (name.includes('/documents/adminAudit?')) return Response.json({documents:[{fields:{action:{stringValue:'suspend'},at:{timestampValue:'2026-11-10T10:00:00Z'},actorUid:{stringValue:'administrator123'},targetUid:{stringValue:'normaluser123'}}}]});
    if (name.endsWith('/documents/users/normaluser123')) return Response.json({fields:{email:{stringValue:'cliente@example.test'}}});
    if (name.endsWith('/documents:commit')) return Response.json({writeResults:[{},{}]});
    throw new Error(`Endpoint inesperado: ${name}`);
  };
  try {
    const env={FIREBASE_PROJECT_ID:project,ALLOWED_ORIGINS:origin,VORA_ADMIN_UIDS:'administrator123',FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({project_id:project,client_email:'worker-fixture@fixture.iam.gserviceaccount.com',private_key:pem}),ADMIN_READ_LIMIT:{limit:async()=>({success:true})},ADMIN_WRITE_LIMIT:{limit:async()=>({success:true})}};
    const authed=await tokenFor(tokenKeys,'administrator123','fixture-kid');
    const regular=await tokenFor(tokenKeys,'normaluser123','fixture-kid');
    const make=(path,token,method='GET',body)=>worker.fetch(new Request('https://admin-fixture.workers.dev'+path,{method,headers:{origin,authorization:`Bearer ${token}`,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined}),env);
    const regularSession=await make('/v1/session',regular);
    assert.equal(regularSession.status,200,'Conta comum pode consultar apenas o próprio status');
    assert.deepEqual(await regularSession.json(),{status:'active',admin:false});
    const adminSession=await make('/v1/session',authed);
    assert.deepEqual(await adminSession.json(),{status:'active',admin:true});
    suspendRegularUser=true;
    const suspended=await make('/v1/session',regular);
    assert.equal((await suspended.json()).status,'suspended');
    suspendRegularUser=false;
    const forbidden=await make('/v1/me',regular);
    assert.equal(forbidden.status,403);
    const who=await make('/v1/me',authed);
    assert.equal(who.status,200);
    assert.equal((await who.json()).admin,true);
    const audit=await make('/v1/audit',authed);
    assert.equal(audit.status,200);
    assert.equal((await audit.json()).events[0].action,'suspend');
    const list=await make('/v1/accounts',authed);
    assert.equal(list.status,200);
    const accounts=(await list.json()).accounts;
    assert.deepEqual(accounts.map(a=>a.status),['active']);
    assert.equal(accounts[0].email,'cliente@example.test');
    const edit=await make('/v1/accounts/access',authed,'POST',{uid:'normaluser123',status:'suspended'});
    assert.equal(edit.status,200);
    assert.equal((await edit.json()).status,'suspended');
    const commit=calls.find(c=>c.name.endsWith('/documents:commit'));
    assert.equal(commit.opts.method,'POST');
    const writes=JSON.parse(commit.opts.body).writes;
    assert.equal(writes[0].update.fields.status.stringValue,'suspended');
    assert.equal(writes[1].update.fields.action.stringValue,'suspend');
    assert.equal(writes[1].currentDocument.exists,false);
    const self=await make('/v1/accounts/access',authed,'POST',{uid:'administrator123',status:'suspended'});
    assert.equal(self.status,403);
    suspendAdmin = true;
    const suspendedAdmin = await make('/v1/me', authed);
    assert.equal(suspendedAdmin.status,403,'Admin suspenso não pode usar endpoints administrativos');
  } finally {globalThis.fetch=oldFetch;}
});
