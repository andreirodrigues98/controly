import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readAdminJson } from '../worker-admin/src/index.js';

const source = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('Painel protege preferências pessoais por UID e oferece atalhos funcionais', () => {
  const dashboard = source('src/modules/module.dashboard.js');
  const app = source('src/app.js');
  assert.match(dashboard, /scopedKey\(STORAGE_KEY\)/);
  assert.match(dashboard, /uid !== preferenceOwnerUid/);
  for (const area of ['activities','goals','notes','finance']) {
    assert.match(dashboard, new RegExp(`data-dashboard-create="${area}"`));
    assert.match(app, new RegExp(`${area}: '\\[data-action=`));
  }
  assert.match(app, /controly:create-quick/);
  assert.match(app, /confirmLeaveOpenModal\(\)/);
});

test('API administrativa rejeita JSON inválido, formato incorreto e excesso de bytes sem confiar no Content-Length', async () => {
  const create = (body, headers={'content-type':'application/json'}) => new Request('https://api.example.test/v1/accounts/access',{ method:'POST', headers, body });
  const valid = await readAdminJson(create(JSON.stringify({uid:'user',status:'active'})));
  assert.deepEqual(valid, {uid:'user',status:'active'});
  await assert.rejects(readAdminJson(create('{invalido')), e=>e.status===400);
  await assert.rejects(readAdminJson(create('[]')), e=>e.status===400);
  await assert.rejects(readAdminJson(create('{"a":1}',{'content-type':'text/plain'})), e=>e.status===415);
  const large = create(JSON.stringify({value:'x'.repeat(9000)}));
  assert.ok(!large.headers.has('content-length'), 'Teste deve usar um corpo sem Content-Length');
  await assert.rejects(readAdminJson(large), e=>e.status===413);
});

test('Deploy público executa testes e Worker valida status de administrador', () => {
  const actions=source('.github/workflows/deploy-pages.yml');
  const worker=source('worker-admin/src/index.js');
  assert.match(actions,/run: npm test/);
  assert.match(worker,/await accountSession\(env, payload\.sub\)/);
  assert.match(worker,/readAdminJson\(request\)/);
  assert.match(worker,/referrer-policy/);
});
