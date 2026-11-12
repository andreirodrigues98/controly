import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

test('GitHub Pages publica o build e verifica a config antes do deploy', () => {
  const build = read('scripts/build-pages.js');
  const workflow = read('.github/workflows/deploy-pages.yml');
  assert.match(build, /destination, 'firebase-config\.js'/);
  assert.match(workflow, /npm run verify:pages/);
  assert.match(workflow, /path: dist/);
  assert.ok(workflow.indexOf('npm run verify:pages') < workflow.indexOf('actions\/upload-pages-artifact@v4'));
});

test('Falha de importacao tem recuperação imediata e nao atribui erro a conexão', () => {
  const html = read('index.html');
  assert.match(html, /import\('\.\/src\/app\.js\?v=2\.0\.12'\)\.catch/);
  assert.match(html, /recovery\.hidden = false/);
  assert.doesNotMatch(html, /Confira sua conexão/);
});

test('Build público não depende de regras privadas do Firestore', () => {
  const check = read('scripts/check-project.js');
  const build = read('scripts/build-pages.js');
  const workflow = read('.github/workflows/deploy-pages.yml');
  const ignore = read('.gitignore');
  assert.doesNotMatch(check, /readFileSync\(resolve\(root,\s*['"]firestore\.rules/);
  assert.doesNotMatch(build, /firestore\.rules/);
  assert.doesNotMatch(workflow, /firestore\.rules/);
  assert.match(ignore, /^\*\.rules$/m);
});
