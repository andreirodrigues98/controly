import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = name => readFileSync(new URL(`../${name}`, import.meta.url),'utf8');
const css = read('src/styles/app.css');
const ui = read('src/ui/ui.js');
test('Avisos móveis deixam de sobrepor a sessão do rodapé e têm contraste',()=>{
  assert.match(css,/\.toast-stack \{[\s\S]*?top: max\(70px/);
  assert.match(css,/\.toast-stack \.toast \{[\s\S]*?background: #17243a !important/);
  assert.match(css,/\.toast-stack \.toast p \{[\s\S]*?color: #e1eaf7 !important/);
  assert.match(ui,/function displayToast\(toast, timeoutMs\)/);
  assert.match(ui,/while \(toastStack\.children\.length > 2\)/);
  assert.match(ui,/\.toast:not\(\.toast-actionable\)/);
});
test('Campo nativo de data é delimitado dentro dos formulários no Safari',()=>{
  assert.match(css,/-webkit-appearance: none/);
  assert.match(css,/min-inline-size: 0 !important/);
  assert.match(css,/inline-size: 100% !important/);
  assert.match(css,/::-webkit-date-and-time-value/);
});
test('Treinos têm rodapé sem sobreposição absoluta no mobile',()=>{
  assert.match(css,/\.modal-root\.workout-form-modal\.open #workout-form \.sticky-modal-actions \{[\s\S]*?position: sticky !important/);
  assert.match(css,/\.modal-root\.workout-form-modal\.open \.modal-body \{[\s\S]*?padding-bottom: 10px !important/);
});

test('Opções de recorrência escondidas continuam escondidas com layout mobile',()=>{
 assert.match(css,/\.modal-root\.open \.modal-body \.hidden,[\s\S]*?display: none !important/);
});
