/** Relatório humano: somente informações compreensíveis; nenhuma chave interna do banco. */
import { USER_EXPORT_COLLECTIONS } from './data-export-core.js';

export const EXPORT_AREA_LABELS = Object.freeze({
  activities: 'Minhas atividades', tasks: 'Tarefas', habits: 'Hábitos', routines: 'Rotinas',
  events: 'Compromissos', goals: 'Metas', subjects: 'Matérias de estudo',
  studySessions: 'Tempo de estudo', studyMaterials: 'Materiais de estudo',
  readingItems: 'Livros e leituras', workouts: 'Treinos', financeCards: 'Cartões cadastrados',
  financeEntries: 'Receitas e despesas', notes: 'Notas', trash: 'Lixeira',
});
export function escapeReportText(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
const money = value => new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' }).format(Number(value) || 0);
const safe = value => escapeReportText(value == null || value === '' ? '—' : value);
function formatDate(value) {
  if (value && typeof value === 'object' && typeof value.$timestamp === 'string') value = value.$timestamp;
  if (!value) return '';
  const str = String(value);
  if (/^\d{4}-\d{2}$/.test(str)) return `${str.slice(5,7)}/${str.slice(0,4)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return new Intl.DateTimeFormat('pt-BR', {day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(`${str}T12:00:00Z`));
  }
  const date = new Date(str);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle:'medium', ...(str.includes('T') ? { timeStyle:'short' } : {}), timeZone:'America/Sao_Paulo' }).format(date);
}
function duration(value) {
  const secs = Math.round(Math.max(0, Number(value) || 0) / 1000);
  const h = Math.floor(secs / 3600), m = Math.floor(secs % 3600 / 60), s = secs % 60;
  return [h ? `${h} h` : '', m ? `${m} min` : '', (!h && !m) || s ? `${s} s` : ''].filter(Boolean).join(' ');
}
function plainText(html) {
  return String(html || '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/(?:p|li|div|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&').trim();
}
const statusLabels = { pending:'Pendente', paid:'Pago', received:'Recebido', completed:'Concluído',
  done:'Concluído', 'Concluído':'Concluído', 'Lendo':'Lendo', 'Pausado':'Pausado', 'Quero ler':'Quero ler',
  'Abandonado':'Arquivado', reading:'Lendo', active:'Em andamento', paused:'Pausado' };
function status(value) { return statusLabels[value] || (value ? String(value) : ''); }
function entryTitle(item, type, index) {
  if (type === 'studySessions') return item.subjectName || 'Sessão de estudo';
  if (type === 'financeEntries') return item.title || 'Movimentação';
  return item.title || item.name || item.text || item.description || `Registro ${index+1}`;
}
function friendlyDetails(item, type) {
  const fields = [];
  const add = (label, value) => { if (value !== null && value !== undefined && value !== '') fields.push([label,String(value)]); };
  const date = (label, value) => add(label, formatDate(value));
  switch(type) {
    case 'activities':
    case 'tasks':
    case 'habits':
    case 'routines': {
      const freq = { daily:'Todos os dias', weekly:'Toda semana', monthly:'Todo mês', none:'Uma vez' };
      add('Tipo', item.kind === 'recurring' || item.repeat ? 'Atividade recorrente' : 'Atividade');
      add('Frequência', freq[item.frequency] || (item.frequency && !['custom','none'].includes(item.frequency) ? 'Personalizada' : ''));
      add('Prioridade', {high:'Alta',medium:'Média',low:'Baixa'}[item.priority] || '');
      add('Categoria', item.category);
      date('Começa em', item.startDate || item.date);
      date('Prazo', item.endDate || item.dueDate);
      const dates = Object.entries(item.completionMap || {}).filter(([,v])=>v===true).map(([k])=>formatDate(k)).filter(Boolean);
      if (dates.length) add('Dias concluídos', dates.sort().slice(-12).join(' · '));
      if (item.notes) add('Observações', plainText(item.notes));
      break;
    }
    case 'subjects':
      add('Tempo total estudado', duration(item.studyTotalMs));
      add('Sessões registradas', Array.isArray(item.studySessions) ? item.studySessions.length : '');
      if (Array.isArray(item.todos) && item.todos.length) add('Tarefas cadastradas', item.todos.length);
      if (item.notes) add('Observações', plainText(item.notes));
      break;
    case 'studySessions':
      date('Quando', item.endedAt || item.startedAt);
      add('Duração', duration(item.durationMs));
      add('Método', ({pomodoro:'Pomodoro',timer:'Temporizador',stopwatch:'Cronômetro'})[item.mode] || 'Estudo');
      break;
    case 'readingItems': {
      const read = Math.max(0, Number(item.pagesRead)||0), total = Math.max(0, Number(item.totalPages)||0);
      add('Autor', item.author);
      add('Situação', total && read >= total ? 'Concluído' : status(item.status));
      add('Progresso', total ? `${read} de ${total} páginas` : `${read} páginas lidas`);
      add('Gênero', item.genre);
      if (item.notes) add('Anotações', plainText(item.notes));
      break;
    }
    case 'financeEntries': {
      const income = item.flowType === 'income' || item.flowType === 'receita';
      const paid = income ? (item.received === true || item.status === 'received') : (item.paid === true || item.status === 'paid');
      add('Tipo', income ? 'Entrada' : 'Despesa');
      add('Valor', money(item.amount));
      add('Situação', paid ? (income ? 'Recebido' : 'Pago') : (income ? 'A receber' : 'A pagar'));
      add('Mês de referência', formatDate(item.monthKey));
      date('Vencimento', item.dueDate || item.paymentDate);
      add('Categoria', item.category);
      add('Cartão', item.cardName);
      if (item.installmentEnabled && Number(item.totalInstallments)>1) add('Parcela', `${item.installmentNumber||1} de ${item.totalInstallments}`);
      if (item.fixed) add('Recorrência', 'Repete todo mês');
      if (item.notes) add('Observações', plainText(item.notes));
      break;
    }
    case 'workouts':
      date('Data', item.date);
      add('Modalidade', item.trainingType || item.type);
      add('Situação', item.completed === true || item.done === true ? 'Concluído' : 'Planejado');
      if (Array.isArray(item.exercises) && item.exercises.length) add('Exercícios', item.exercises.map(exercise => exercise.name || exercise.title).filter(Boolean).join(', ') || item.exercises.length);
      add('Concluído', item.completed === true || item.done === true ? 'Sim' : 'Não');
      if (item.notes) add('Observações', plainText(item.notes));
      break;
    case 'goals':
      add('Objetivo', item.targetAmount ? money(item.targetAmount) : item.target || item.targetCount);
      date('Prazo', item.deadline || item.endDate);
      add('Situação', status(item.status));
      if (item.notes) add('Observações', plainText(item.notes));
      break;
    case 'financeCards':
      add('Tipo', item.type === 'credit' ? 'Crédito' : item.type === 'debit' ? 'Débito' : 'Cartão');
      add('Limite', item.limit ? money(item.limit) : '');
      break;
    case 'notes':
      add('Conteúdo', plainText(item.content || item.text));
      break;
    default:
      date('Data', item.date || item.startDate || item.dueDate);
      add('Categoria', item.category);
      add('Situação', status(item.status));
      if (item.notes || item.content) add('Observações', plainText(item.notes || item.content));
  }
  return fields;
}
function recordCard(item, i, type) {
  const fields = friendlyDetails(item,type);
  const details = fields.map(([label, value]) => `<div class="detail"><dt>${safe(label)}</dt><dd>${safe(value)}</dd></div>`).join('');
  return `<article class="record"><h3>${safe(entryTitle(item,type,i))}</h3>${details ? `<dl>${details}</dl>` : '<p class="muted">Registro salvo na sua conta.</p>'}</article>`;
}
export function renderReadableUserReport(data) {
  const { account={}, collections={}, exportedAt=new Date().toISOString() } = data || {};
  const name = account.profile?.displayName || (account.email || '').split('@')[0] || 'Minha conta';
  const groups = USER_EXPORT_COLLECTIONS.filter(type => Array.isArray(collections[type]) && collections[type].length)
    .map(type => ({ type, title:EXPORT_AREA_LABELS[type], items:collections[type] }));
  const total = groups.reduce((sum, group) => sum + group.items.length, 0);
  const sections = groups.map(group => `<section class="area" id="area-${group.type}">
    <div class="area-heading"><h2>${safe(group.title)}</h2><span>${group.items.length} ${group.items.length===1?'registro':'registros'}</span></div>
    <div class="records">${group.items.map((item,i) => recordCard(item,i,group.type)).join('')}</div></section>`).join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Meus dados — Controly</title><style>
:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#f6f7fb;color:#1b2638;font:15px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}
.page{max-width:1000px;padding:24px;margin:auto}.cover{padding:30px;border-radius:17px;background:#203251;color:#fff}
.cover small{letter-spacing:.12em;text-transform:uppercase;opacity:.8}.cover h1{font-size:clamp(1.6rem,5vw,2.3rem);margin:5px 0}
.cover p{margin:7px 0;color:#e3e9f5}.summary{display:flex;gap:8px;flex-wrap:wrap;margin:22px 0}.summary a{border:1px solid #dae0ea;background:#fff;color:#25456b;padding:8px 12px;text-decoration:none;border-radius:8px}
.area{margin:28px 0}.area-heading{display:flex;justify-content:space-between;align-items:center;gap:10px;border-bottom:2px solid #d8deea;padding-bottom:10px;margin-bottom:15px}
.area-heading h2{margin:0;font-size:1.35rem}.area-heading span{color:#64748b}.records{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,360px),1fr));gap:12px}
.record{background:#fff;border:1px solid #dde3ee;border-radius:13px;padding:18px;min-width:0;break-inside:avoid}.record h3{font-size:1.07rem;margin:0 0 10px;overflow-wrap:anywhere}
.record dl{margin:0}.detail{display:grid;grid-template-columns:minmax(110px,140px) minmax(0,1fr);border-top:1px solid #eef0f4;padding:8px 0;gap:9px}
.detail dt{color:#687589}.detail dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.muted{color:#657286}.notice{background:#edf1f7;padding:15px;border-radius:10px;margin:20px 0}.footer{margin:36px 0 10px;color:#687589;border-top:1px solid #dce2eb;padding-top:16px}
@media(max-width:600px){.page{padding:12px}.cover{padding:20px}.records{grid-template-columns:1fr}.detail{grid-template-columns:1fr;gap:1px}}
@media print{body{background:#fff}.page{max-width:none;padding:0}.cover{print-color-adjust:exact;-webkit-print-color-adjust:exact}.summary{display:none}.record{border-color:#cfd6e2}.area{break-inside:auto}}
</style></head><body><main class="page"><header class="cover"><small>Controly · Relatório pessoal</small><h1>Meus dados</h1>
<p>${safe(name)} · ${safe(formatDate(exportedAt))}</p><p>${total} ${total===1?'registro':'registros'} em ${groups.length} ${groups.length===1?'área':'áreas'}</p></header>
<p class="notice">Este relatório é uma cópia para consultar ou imprimir. Para salvar em PDF, abra o arquivo e use a opção Imprimir do navegador. Guarde-o em local privado.</p>
<nav class="summary" aria-label="Ir para uma área">${groups.map(group=>`<a href="#area-${group.type}">${safe(group.title)} (${group.items.length})</a>`).join('')}</nav>
${sections || '<p class="notice">Nenhum registro encontrado nas áreas consultadas.</p>'}
<footer class="footer">Relatório pessoal gerado pelo Controly. Não substitui um backup para restauração.</footer></main></body></html>`;
}
