import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { horizontalDragScroll } from '../src/ui/touch-kanban.js';

test('arrastar para direita revela colunas da direita, e vice-versa', () => {
  assert.equal(horizontalDragScroll(100, 140), 50);
  assert.equal(horizontalDragScroll(140, 100), -50);
  assert.equal(horizontalDragScroll(100, 100), 0);
});

test('gesto mantém deslocamento contínuo e destino visível', () => {
  const source = readFileSync(new URL('../src/ui/touch-kanban.js', import.meta.url), 'utf8');
  assert.match(source, /board\.scrollLeft \+= horizontalMove/);
  assert.match(source, /requestAnimationFrame\(autoScroll\)/);
  assert.match(source, /is-drag-target/);
  assert.match(source, /canDrop\(g.card, lane\)/);
});

test('cartão financeiro é compacto no celular, mas mantém edição e pagamento', () => {
  const finance = readFileSync(new URL('../src/modules/module.finance.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/styles/app.css', import.meta.url), 'utf8');
  assert.match(finance, /finance-mobile-compact/);
  assert.match(finance, /finance-mobile-extra/);
  assert.match(finance, /data-finance-expand/);
  assert.match(finance, /data-finance-expanded/);
  assert.match(finance, /data-action="toggle-paid"/);
  assert.match(css, /max-width:720px/);
  assert.match(css, /finance-entry-card\[data-finance-expanded="true"\]/);
});
