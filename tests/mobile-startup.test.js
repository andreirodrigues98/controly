import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const root = new URL('../', import.meta.url);
const source = (path) => readFileSync(new URL(path, root), 'utf8');

test('carregamento oferece recuperação mesmo quando o módulo principal não inicia', () => {
  const html = source('index.html');
  const script = html.match(/<script>\s*\/\/ Esta proteção é independente dos módulos:[\s\S]*?<\/script>/)?.[0];
  assert.ok(script, 'Proteção deve executar antes dos scripts externos');
  let scheduled = null;
  let cleared = false;
  let reloaded = false;
  const callbacks = {};
  const names = new Set(['active']);
  const loader = {classList: { contains: name => names.has(name), add: name => names.add(name), remove: name => names.delete(name) }};
  const recovery = { hidden: true };
  const text = { textContent: 'Carregando seu painel pessoal...' };
  const retry = { addEventListener: (name, fn) => { callbacks[name] = fn; } };
  const nodes = { 'app-loader': loader, 'app-loader-recovery': recovery, 'app-loader-text': text, 'app-loader-retry': retry };
  const window = {setTimeout: (fn, delay) => { scheduled = {fn, delay}; return 1; }, clearTimeout: () => {cleared = true;} };
  const location = {reload: () => { reloaded = true; }};
  vm.runInNewContext(script.replace(/^<script>|<\/script>$/g, ''), {document: {getElementById: name => nodes[name]}, window, location, setTimeout: window.setTimeout, clearTimeout: window.clearTimeout});
  assert.equal(scheduled.delay, 18000);
  scheduled.fn();
  assert.equal(recovery.hidden, false);
  assert.equal(names.has('load-failed'), true);
  assert.equal(text.textContent, 'Não conseguimos iniciar o Controly.');
  callbacks.click();
  assert.equal(reloaded, true);
  window.__CONTROLY_LOADING_GUARD__.stop();
  assert.equal(recovery.hidden, true);
  assert.equal(names.has('load-failed'), false);
  assert.equal(cleared, true);
});

test('ícones não bloqueiam o JavaScript principal, e loader é responsivo', () => {
  const html = source('index.html');
  const css = source('src/styles/app.css');
  const ui = source('src/ui/ui.js');
  assert.match(html, /<script async src="https:\/\/unpkg.com\/lucide@latest"><\/script>/);
  assert.match(css, /\.app-loader-inner\s*\{/);
  assert.match(css, /\.app-loader-recovery\[hidden\]/);
  assert.match(ui, /window\.__CONTROLY_LOADING_GUARD__\?\.start\(\)/);
  assert.match(ui, /window\.__CONTROLY_LOADING_GUARD__\?\.stop\(\)/);
});

test('verificação administrativa não espera indefinidamente por rede ou token', () => {
  const client = source('src/admin/admin-client.js');
  assert.match(client, /ADMIN_REQUEST_TIMEOUT_MS\s*=\s*12000/);
  assert.match(client, /limitedWait\(user\.getIdToken\(\)\)/);
  assert.match(client, /signal:\s*controller\.signal/);
  assert.match(client, /clearTimeout\(timer\)/);
});
