import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const studies = read('src/modules/module.studies.js');
const store = read('src/services/store.js');
const css = read('src/styles/app.css');
const ui = read('src/ui/ui.js');

test('registrar tempo ativo salva uma única vez e fecha o modal após confirmação', () => {
  assert.match(studies, /async function registerAndCloseFocusSession\(\)/);
  const register = studies.match(/async function registerAndCloseFocusSession\(\) \{([\s\S]*?)\n  \}\n\n  function buildFocusPanel/)[1];
  assert.match(register, /await pauseMode\(mode\)/);
  assert.match(register, /persisted === false\) return false/);
  assert.match(register, /await closeModal\(\{ force: true \}\)/);
  assert.doesNotMatch(register, /persistActiveStudyTime\(/);
  assert.match(studies, /data-focus-action="save"[^\n]*>Registrar tempo/);
  assert.doesNotMatch(studies, /if \(saveButton\) saveButton\.disabled = isRunning/);
});

test('faixa de sessão usa horário real, nome da matéria e é acessível fora da seção Estudos', () => {
  assert.match(studies, /document\.body\.appendChild\(focusBar\)/);
  assert.match(studies, /bar\.querySelector\('\.focus-bar-subject'\)\.textContent/);
  assert.match(studies, /onStateChange\(\(changeKey\)/);
  assert.match(studies, /if \(changeKey === 'subjects' \|\| changeKey === 'currentSection'\)/);
  assert.match(studies, /syncFocusBar\(\)/);
  assert.match(studies, /Pode fechar esta janela ou mudar de seção/);
  assert.match(css, /\.controly-focus-bar\[hidden\]/);
});

test('exclusão do tempo é atômica e não subtrai o total duas vezes', () => {
  const nested = store.match(/export async function deleteNestedArrayItem\([\s\S]*?\n\}\n\nexport async function restoreDeletedRecord/)[0];
  assert.match(nested, /nextValues\.studyTotalMs = Math\.max\(0/);
  assert.match(nested, /transaction\.delete\(userDoc\('studySessions', itemId, userId\)\)/);
  const handler = studies.match(/if \(button\.dataset\.action === 'delete-session'[\s\S]*?\n        return;\n      \}/)[0];
  assert.doesNotMatch(handler, /patchRecord\('subjects', subject\.id, \{ studyTotalMs/);
  assert.match(store, /if \(fieldName === 'studySessions' && !alreadyRestored\)/);
});

test('iPhone: datas não ultrapassam modal e botões de ícone não mostram texto vertical', () => {
  assert.match(css, /-webkit-date-and-time-value/);
  assert.match(css, /grid-template-columns: minmax\(0,1fr\) !important/);
  assert.match(css, /var\(--app-visual-height/);
  assert.match(ui, /!compactAction\) button\.textContent/);
  assert.match(css, /\.is-busy\.icon-btn::after/);
});

test('cache da versão deve mudar em HTML, CSS e package.json', () => {
  const version = JSON.parse(read('package.json')).version;
  assert.equal(version, '2.0.15');
  assert.match(read('index.html'), /app\.js\?v=2\.0\.15/);
  assert.match(read('styles.css'), /app\.css\?v=2\.0\.15/);
});
