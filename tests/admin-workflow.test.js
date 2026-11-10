import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createConfig} from '../scripts/config-core.js';

const source = name => readFileSync(new URL('../'+name, import.meta.url),'utf8');
test('Admin VORA exige token autenticado e UID autorizado no Worker', () => {
  const code=source('worker-admin/src/index.js');
  assert.match(code,/verifyFirebaseToken\(token,project\)/);
  assert.match(code,/isAdminUid\(payload.sub,env\)/);
  assert.match(code,/ADMIN_READ_LIMIT/);
  assert.match(code,/ADMIN_WRITE_LIMIT/);
  assert.match(code,/currentDocument:\{exists:false\}/);
  assert.match(code,/\/v1\/audit/);
});
test('UI nunca mostra contas de outros usuários por acesso direto ao Firestore', () => {
  const rules=source('firestore.rules');
  assert.match(rules,/allow list: if false/);
  assert.match(rules,/match \/adminAudit/);
  assert.match(rules,/allow read, write: if false/);
  const client=source('src/admin/admin-client.js');
  assert.match(client,/getIdToken\(\)/);
  assert.match(client,/Bearer/);
});
test('Configuração de produção pode habilitar o Worker sem incluir chaves privadas', () => {
  const sourceEnv = {
    FIREBASE_API_KEY: 'a',FIREBASE_AUTH_DOMAIN:'b',FIREBASE_PROJECT_ID:'controly-ec636',
    FIREBASE_STORAGE_BUCKET:'c',FIREBASE_MESSAGING_SENDER_ID:'d',FIREBASE_APP_ID:'e',
    CONTROLY_ADMIN_BACKEND_ENABLED:'true',
    CONTROLY_ADMIN_WORKER_URL:'https://controly-vora-admin.andreirodrigues1510.workers.dev',
  };
  const result=createConfig({environment:'production',projectRoot:'.',processEnvironment:sourceEnv});
  assert.equal(result.controlyRuntime.adminBackendEnabled,true);
  assert.ok(result.controlyRuntime.adminWorkerUrl.endsWith('.workers.dev'));
  assert.equal(JSON.stringify(result).includes('FIREBASE_SERVICE_ACCOUNT_JSON'),false);
});
test('GitHub Pages e Live Server são origens do Worker e as Secrets não são versionadas',()=>{
  const workerConfig=source('worker-admin/wrangler.jsonc');
  assert.match(workerConfig,/https:\/\/andreirodrigues98.github.io/);
  assert.match(workerConfig,/http:\/\/127.0.0.1:5500/);
  const ignore=source('.gitignore');
  assert.match(ignore,/firebase-adminsdk/);
  assert.match(ignore,/firebase-config\.js/);
  const workflow=source('.github/workflows/deploy-pages.yml');
  assert.match(workflow,/CONTROLY_ADMIN_BACKEND_ENABLED/);
  assert.match(workflow,/CONTROLY_ADMIN_WORKER_URL/);
});
