import { closeModal, confirmDialog, createEmptyState, icon, openModal, refreshIcons, showToast, showUndoToast } from './ui.js';
import { deleteRecord, patchRecord, restoreDeletedRecord, saveRecord } from './store.js';
import { getFinanceEntriesForMonth } from './domain.js';
import { cleanObjectForWrite, createIdPrefix, dateKey, escapeHtml, formatCurrency, formatDate, formatMonthLabel, getAdjustedBusinessDateForMonthDay, monthKey, number, sumBy, toDate } from './utils.js';

function addMonthsToMonthKey(baseMonth, offset = 0) {
  const [year, month] = String(baseMonth || monthKey(new Date())).split('-').map(Number);
  const date = new Date(year, (month - 1) + offset, 1, 12, 0, 0, 0);
  return monthKey(date);
}

function monthsBetweenMonthAndDate(baseMonth, endDate) {
  const end = toDate(endDate);
  if (!end) return 0;
  const [startYear, startMonth] = String(baseMonth || monthKey(new Date())).split('-').map(Number);
  if (!Number.isFinite(startYear) || !Number.isFinite(startMonth)) return 0;
  return ((end.getFullYear() - startYear) * 12) + (end.getMonth() - (startMonth - 1)) + 1;
}

function paymentDateForInstallment(basePaymentDate, fallbackPaymentDate, targetMonth) {
  const sourceDate = basePaymentDate || fallbackPaymentDate;
  return sourceDate ? rollEntryDueDate(sourceDate, targetMonth) : '';
}

function formatShortDateLabel(value) {
  const date = toDate(value);
  return date ? formatDate(date, { day: '2-digit', month: 'short' }) : '';
}

function groupExplicitByMonth(entries) {
  const map = new Map();
  entries.forEach((entry) => {
    const key = entry.monthKey || monthKey(entry.createdAt || new Date());
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(entry);
  });
  return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

function normalizeCard(card = {}) {
  return {
    ...card,
    name: card.name || 'Cartão sem identificação',
    type: card.type || 'credit',
    closingDay: card.closingDay ? number(card.closingDay, 0) : '',
    dueDay: card.dueDay ? number(card.dueDay, 0) : '',
    limit: card.limit === null || card.limit === undefined || card.limit === '' ? '' : number(card.limit, 0),
    active: (card.active ?? true) !== false,
  };
}

function normalizeFinanceEntry(entry, cards = []) {
  const rawFlowType = String(entry.flowType || entry.entryType || '').toLowerCase();
  const flowType = ['income', 'receita', 'entrada', 'receivable', 'receive', 'a receber'].includes(rawFlowType) ? 'income' : 'expense';
  const rawStatus = String(entry.status || '').toLowerCase();
  const legacyIncomeReceived = flowType === 'income' && (entry.received === true || entry.paid === true || rawStatus === 'paid' || rawStatus === 'pago');
  const status = flowType === 'income'
    ? (rawStatus === 'received' || rawStatus === 'recebido' || legacyIncomeReceived ? 'received' : 'pending')
    : (rawStatus === 'paid' || rawStatus === 'pago' || entry.paid === true ? 'paid' : 'pending');
  const card = cards.map(normalizeCard).find((item) => item.id === entry.cardId) || null;
  const totalInstallments = Math.max(1, number(entry.totalInstallments, 1));
  const installmentEnabled = Boolean(entry.installmentEnabled || totalInstallments > 1);
  const resolvedMonth = entry.monthKey || monthKey(entry.createdAt || new Date());
  return {
    ...entry,
    flowType,
    status,
    paid: flowType === 'expense' && status === 'paid',
    received: flowType === 'income' && status === 'received',
    amount: number(entry.amount, 0),
    monthKey: resolvedMonth,
    paymentDate: entry.paymentDate || '',
    paymentEndDate: entry.paymentEndDate || entry.installmentEndDate || '',
    dueDate: '',
    fixed: installmentEnabled ? false : Boolean(entry.fixed),
    cardId: entry.cardId || null,
    cardName: entry.cardName || card?.name || '',
    installmentEnabled,
    installmentNumber: number(entry.installmentNumber, 1),
    totalInstallments,
    installmentGroupId: entry.installmentGroupId || null,
  };
}

function isInstallmentPurchase(entry) {
  return Boolean(entry?.installmentEnabled && entry?.totalInstallments > 1 && entry?.installmentGroupId);
}

function getEntryColumn(entry) {
  if (entry.flowType === 'income') return entry.status === 'received' ? 'received' : 'receivable';
  return entry.status === 'paid' ? 'paid' : 'spent';
}

function getColumnLabel(column) {
  if (column === 'received') return 'Valores recebidos';
  if (column === 'paid') return 'Contas pagas';
  if (column === 'receivable') return 'Valores a receber';
  return 'Contas a pagar';
}

function getColumnSubtitle(column) {
  if (column === 'received') return 'Entradas que já foram recebidas neste mês';
  if (column === 'paid') return 'Despesas que já foram pagas neste mês';
  if (column === 'receivable') return 'Valores previstos que ainda precisam entrar';
  return 'Contas, compras e despesas ainda pendentes';
}

function getColumnIcon(column) {
  if (column === 'received') return 'arrow-down-left';
  if (column === 'paid') return 'check-circle-2';
  if (column === 'receivable') return 'clock';
  return 'arrow-up-right';
}

function getColumnTone(column) {
  if (column === 'received') return 'income';
  if (column === 'paid') return 'paid';
  if (column === 'receivable') return 'waiting-income';
  return 'waiting-expense';
}

function getStatusLabel(entry) {
  if (entry.flowType === 'income') return entry.status === 'received' ? 'Recebido' : 'A receber';
  return entry.status === 'paid' ? 'Pago' : 'A pagar';
}

function countLaunchText(count) {
  return `${count} ${count === 1 ? 'lançamento' : 'lançamentos'}`;
}

function optionDayList(selected) {
  return Array.from({ length: 31 }, (_, index) => {
    const day = index + 1;
    return `<option value="${day}" ${Number(selected) === day ? 'selected' : ''}>Dia ${day}</option>`;
  }).join('');
}

function resolveEntryDueDate(targetMonth, card = null) {
  if (card?.type === 'credit' && card.dueDay) return getAdjustedBusinessDateForMonthDay(targetMonth, card.dueDay);
  return '';
}

function rollEntryDueDate(dueDate, targetMonth) {
  if (!dueDate) return '';
  const original = toDate(dueDate);
  if (!original) return '';
  const [year, month] = String(targetMonth || monthKey(new Date())).split('-').map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  const day = Math.min(original.getDate(), lastDay);
  return `${targetMonth}-${String(day).padStart(2, '0')}`;
}

function monthDayDate(targetMonth, day) {
  const [year, month] = String(targetMonth || monthKey(new Date())).split('-').map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return new Date(year, month - 1, Math.min(Math.max(Number(day) || 1, 1), lastDay), 12, 0, 0, 0);
}

function getStatementInfo(card, targetMonth, entries = []) {
  const cardEntries = entries.filter((entry) => entry.cardId === card.id && entry.flowType === 'expense');
  const total = sumBy(cardEntries, (item) => item.amount);
  const paid = sumBy(cardEntries.filter((item) => item.status === 'paid'), (item) => item.amount);
  const openAmount = Math.max(0, total - paid);
  const closingDate = card.closingDay ? monthDayDate(targetMonth, card.closingDay) : null;
  const dueDate = card.dueDay ? monthDayDate(targetMonth, card.dueDay) : null;
  const today = new Date();
  let status = 'aberta';
  if (total > 0 && openAmount <= 0) status = 'paga';
  else if (dueDate && dueDate < today && openAmount > 0) status = 'vencida';
  else if (closingDate && today > closingDate) status = 'fechada';
  return {
    total,
    paid,
    openAmount,
    status,
    limitAvailable: card.limit !== '' && card.limit !== null && card.limit !== undefined ? Math.max(0, number(card.limit, 0) - total) : null,
  };
}

function restoreDeletedRecords(trashIds = []) {
  return Promise.all(trashIds.filter(Boolean).map((trashId) => restoreDeletedRecord(trashId)));
}

export function createFinanceModule() {
  let root;

  function requestSilentFinanceUpdate() {
    window.__CONTROLY_SILENT_UPDATE?.('financeEntries', 'finance', 900);
  }
  let selectedMonth = monthKey(new Date());
  let filters = {
    flowType: 'all',
    status: 'all',
    cardId: 'all',
    recurrence: 'all',
    category: '',
  };

  function getCards() {
    return [...(window.__CONTROLY_STATE?.financeCards || [])].map(normalizeCard).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }

  function getNormalizedEntriesForMonth(state, targetMonth = selectedMonth) {
    return getFinanceEntriesForMonth(state, targetMonth).map((entry) => normalizeFinanceEntry(entry, state.financeCards || []));
  }

  function getEntryById(id) {
    const state = window.__CONTROLY_STATE;
    return getNormalizedEntriesForMonth(state, selectedMonth).find((item) => item.id === id)
      || (state.financeEntries || []).map((item) => normalizeFinanceEntry(item, state.financeCards || [])).find((item) => item.id === id);
  }

  function getInstallmentGroupEntries(entry) {
    if (!entry?.installmentGroupId) return [];
    return (window.__CONTROLY_STATE?.financeEntries || [])
      .map((item) => normalizeFinanceEntry(item, window.__CONTROLY_STATE?.financeCards || []))
      .filter((item) => item.installmentGroupId === entry.installmentGroupId && !item.virtual)
      .sort((a, b) => (a.installmentNumber || 0) - (b.installmentNumber || 0));
  }

  function applyFinanceFilters(entries) {
    const category = filters.category.trim().toLowerCase();
    return entries.filter((entry) => {
      if (filters.flowType !== 'all' && entry.flowType !== filters.flowType) return false;
      if (filters.status !== 'all' && entry.status !== filters.status) return false;
      if (filters.cardId !== 'all') {
        if (filters.cardId === 'none' && entry.cardId) return false;
        if (filters.cardId !== 'none' && entry.cardId !== filters.cardId) return false;
      }
      if (filters.recurrence === 'fixed' && !entry.fixed) return false;
      if (filters.recurrence === 'installment' && !entry.installmentEnabled) return false;
      if (filters.recurrence === 'single' && (entry.fixed || entry.installmentEnabled)) return false;
      if (category) {
        const text = `${entry.title || ''} ${entry.category || ''} ${entry.cardName || ''}`.toLowerCase();
        if (!text.includes(category)) return false;
      }
      return true;
    });
  }

  function openCardsManager(editCard = null) {
    const cards = getCards();
    const editing = editCard ? normalizeCard(editCard) : null;
    openModal({
      title: editing ? 'Editar cartão' : 'Gerenciar cartões',
      eyebrow: 'Cartões e faturas',
      body: `
        <div class="stack-form modal-scroll-form">
          <form id="finance-card-form" class="stack-form">
            <label class="field">
              <span>Nome do cartão</span>
              <input class="input" name="name" value="${escapeHtml(editing?.name || '')}" placeholder="Ex.: Nubank, Inter, Itaú" required />
            </label>
            <div class="inline-fields finance-form-grid">
              <label class="field">
                <span>Tipo de cartão</span>
                <select class="select" name="type" id="finance-card-type">
                  <option value="credit" ${editing?.type !== 'debit' ? 'selected' : ''}>Crédito</option>
                  <option value="debit" ${editing?.type === 'debit' ? 'selected' : ''}>Débito</option>
                </select>
              </label>
              <label class="field">
                <span>Situação do cartão</span>
                <select class="select" name="active">
                  <option value="true" ${editing?.active === false ? '' : 'selected'}>Ativo</option>
                  <option value="false" ${editing?.active === false ? 'selected' : ''}>Inativo</option>
                </select>
              </label>
            </div>
            <div class="inline-fields finance-form-grid finance-credit-card-fields" id="finance-credit-card-fields">
              <label class="field">
                <span>Dia de fechamento da fatura</span>
                <select class="select" name="closingDay"><option value="">Selecione o dia</option>${optionDayList(editing?.closingDay)}</select>
              </label>
              <label class="field">
                <span>Dia de vencimento da fatura</span>
                <select class="select" name="dueDay"><option value="">Selecione o dia</option>${optionDayList(editing?.dueDay)}</select>
              </label>
              <label class="field">
                <span>Limite do cartão (opcional)</span>
                <input class="input" type="number" step="0.01" min="0" name="limit" value="${editing?.limit !== '' && editing?.limit !== undefined ? editing.limit : ''}" placeholder="Ex.: 1500" />
              </label>
              <div class="field finance-form-help">
                <span>Como o Controly usa essas informações</span>
                <div class="muted-box">O fechamento e o vencimento ajudam a organizar compras, faturas e lembretes no painel financeiro.</div>
              </div>
            </div>
            <div class="inline-actions sticky-modal-actions">
              <button type="button" class="btn btn-secondary" id="finance-card-close">Fechar</button>
              ${editing ? '<button type="button" class="btn btn-secondary" id="finance-card-new">Cadastrar outro cartão</button>' : ''}
              <button type="submit" class="btn btn-primary">${editing ? 'Salvar cartão' : 'Cadastrar cartão'}</button>
            </div>
          </form>
          <div class="section-accordion-stack finance-card-manager-list">
            ${cards.length ? cards.map((card) => `
              <article class="finance-card-manager-item ${card.active ? '' : 'is-muted'}">
                <div>
                  <strong>${escapeHtml(card.name || 'Cartão sem identificação')}</strong>
                  <div class="module-subtitle">
                    ${card.type === 'credit' ? 'Crédito' : 'Débito'} · ${card.active ? 'Ativo' : 'Inativo'}
                    ${card.type === 'credit' && card.closingDay ? ` · fecha dia ${card.closingDay}` : ''}
                    ${card.type === 'credit' && card.dueDay ? ` · vence dia ${card.dueDay}` : ''}
                    ${card.type === 'credit' && card.limit !== '' ? ` · limite ${formatCurrency(card.limit)}` : ''}
                  </div>
                </div>
                <div class="inline-actions">
                  <button type="button" class="icon-btn small" data-action="edit-card" data-id="${card.id}">${icon('pencil-line', 'Editar cartão')}</button>
                  <button type="button" class="icon-btn small" data-action="delete-card" data-id="${card.id}">${icon('trash-2', 'Excluir cartão')}</button>
                </div>
              </article>
            `).join('') : createEmptyState('Nenhum cartão cadastrado', 'Cadastre um cartão para organizar compras, faturas e lembretes.', { label: 'Adicionar cartão', action: 'new-card' })}
          </div>
        </div>
      `,
    });

    const typeSelect = document.getElementById('finance-card-type');
    const creditFields = document.getElementById('finance-credit-card-fields');
    const syncCardFields = () => creditFields?.classList.toggle('hidden', typeSelect?.value !== 'credit');
    typeSelect?.addEventListener('change', syncCardFields);
    syncCardFields();

    document.getElementById('finance-card-close')?.addEventListener('click', closeModal);
    document.getElementById('finance-card-new')?.addEventListener('click', () => openCardsManager());
    document.querySelector('[data-action="new-card"]')?.addEventListener('click', () => openCardsManager());
    document.getElementById('finance-card-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const type = formData.get('type') || 'credit';
      const limitValue = formData.get('limit');
      const payload = {
        name: String(formData.get('name') || '').trim(),
        type,
        active: formData.get('active') === 'true',
        closingDay: type === 'credit' ? number(formData.get('closingDay'), 0) || null : null,
        dueDay: type === 'credit' ? number(formData.get('dueDay'), 0) || null : null,
        limit: type === 'credit' && limitValue !== '' ? number(limitValue, 0) : null,
      };
      if (!payload.name) {
        showToast('Informe o nome do cartão antes de salvar.', 'error');
        return;
      }
      if (payload.type === 'credit' && (!payload.closingDay || !payload.dueDay)) {
        showToast('Informe o fechamento e o vencimento da fatura para cadastrar o cartão de crédito.', 'error');
        return;
      }
      if (payload.type === 'credit' && payload.limit !== null && payload.limit < 0) {
        showToast('Informe um limite válido para o cartão.', 'error');
        return;
      }
      try {
        const previous = editing ? cleanObjectForWrite(editing) : null;
        const saved = await saveRecord('financeCards', payload, editing?.id || null);
        if (editing && previous) {
          showUndoToast('Cartão atualizado. Se precisar, você pode desfazer essa alteração.', () => saveRecord('financeCards', previous, editing.id));
        } else {
          showUndoToast('Cartão cadastrado com sucesso.', () => deleteRecord('financeCards', saved.id));
        }
        openCardsManager();
      } catch (error) {
        console.error(error);
        showToast('Não foi possível salvar o cartão. Confira as informações e tente novamente.', 'error');
      }
    });

    document.querySelectorAll('[data-action="edit-card"]').forEach((button) => {
      button.addEventListener('click', () => {
        const card = getCards().find((item) => item.id === button.dataset.id);
        if (card) openCardsManager(card);
      });
    });

    document.querySelectorAll('[data-action="delete-card"]').forEach((button) => {
      button.addEventListener('click', async () => {
        const id = button.dataset.id;
        const card = getCards().find((item) => item.id === id);
        if (!card) return;
        const confirmed = await confirmDialog({
          title: 'Excluir cartão',
          description: 'Este cartão será enviado para a lixeira por 7 dias. Seus lançamentos financeiros continuarão salvos.',
          confirmLabel: 'Enviar para a lixeira',
        });
        if (!confirmed) return;
        try {
          const result = await deleteRecord('financeCards', id);
          showUndoToast('Cartão enviado para a lixeira. Você pode restaurar se precisar.', () => result?.trashId ? restoreDeletedRecord(result.trashId) : Promise.resolve());
          openCardsManager();
        } catch (error) {
          console.error(error);
          showToast('Não foi possível excluir o cartão. Tente novamente.', 'error');
        }
      });
    });
    refreshIcons();
  }

  function openInstallmentEditChoice(entry) {
    openModal({
      title: 'Editar parcelamento',
      eyebrow: 'Finanças',
      body: `
        <div class="stack-form">
          <div class="muted-box">Escolha se a alteração deve valer apenas para esta parcela, para esta e as próximas parcelas ou para todo o parcelamento.</div>
          <button type="button" class="btn btn-secondary justify-start" id="edit-installment-single">Editar somente esta parcela</button>
          <button type="button" class="btn btn-secondary justify-start" id="edit-installment-next">Editar esta e as próximas parcelas</button>
          <button type="button" class="btn btn-primary justify-start" id="edit-installment-all">Editar todas as parcelas</button>
        </div>
      `,
    });
    document.getElementById('edit-installment-single')?.addEventListener('click', () => openFinanceForm(entry, { editScope: 'single' }));
    document.getElementById('edit-installment-next')?.addEventListener('click', () => openFinanceForm(entry, { editScope: 'next' }));
    document.getElementById('edit-installment-all')?.addEventListener('click', () => openFinanceForm(entry, { editScope: 'group' }));
  }

  function openFinanceForm(entry = null, options = {}) {
    const cards = getCards();
    const normalized = entry ? normalizeFinanceEntry(entry, cards) : null;
    const defaultFlowType = normalized?.flowType || 'expense';
    const defaultStatus = normalized?.status || 'pending';
    const defaultInstallments = Math.max(1, normalized?.totalInstallments || 1);
    const selectableCards = cards.filter((card) => card.active || card.id === normalized?.cardId);
    const isExistingInstallment = isInstallmentPurchase(normalized);
    openModal({
      title: entry ? (options.editScope === 'group' ? 'Editar todas as parcelas' : (options.editScope === 'next' ? 'Editar esta e próximas parcelas' : 'Editar lançamento')) : 'Criar lançamento',
      eyebrow: 'Finanças',
      body: `
        <form id="finance-form" class="stack-form modal-scroll-form">
          <label class="field"><span>Nome do lançamento</span><input class="input" name="title" value="${escapeHtml(normalized?.title || '')}" placeholder="Ex.: Aluguel, mercado, salário" required /></label>
          <div class="inline-fields finance-form-grid">
            <label class="field"><span>Categoria</span><input class="input" name="category" value="${escapeHtml(normalized?.category || '')}" placeholder="Ex.: Moradia, mercado, salário" /></label>
            <label class="field"><span>Valor</span><input class="input" type="number" step="0.01" min="0" name="amount" value="${normalized?.amount ?? ''}" required /></label>
          </div>
          <div class="inline-fields finance-form-grid">
            <label class="field"><span>Mês do lançamento</span><input class="input" type="month" name="monthKey" value="${normalized?.monthKey || selectedMonth}" required /></label>
            <label class="field">
              <span>Tipo de movimentação</span>
              <select class="select" name="flowType" id="finance-flow-type">
                <option value="expense" ${defaultFlowType === 'expense' ? 'selected' : ''}>Despesa ou pagamento</option>
                <option value="income" ${defaultFlowType === 'income' ? 'selected' : ''}>Entrada ou valor a receber</option>
              </select>
            </label>
          </div>
          <div class="inline-fields finance-form-grid">
            <label class="field"><span id="finance-payment-date-label">Data de pagamento (opcional)</span><input class="input" type="date" name="paymentDate" value="${normalized?.paymentDate ? dateKey(normalized.paymentDate) : ''}" /></label>
            <div class="field finance-form-help">
              <span>Como aparece no calendário</span>
              <div class="muted-box" id="finance-payment-calendar-help">Se preencher esta data, o lançamento também aparece no calendário para lembrar você no dia certo.</div>
            </div>
          </div>
          <div class="inline-fields finance-form-grid">
            <label class="field"><span>Situação</span><select class="select" name="status" id="finance-status"></select></label>
            <label class="field" id="finance-card-field">
              <span>Cartão usado</span>
              <select class="select" name="cardId" id="finance-card-id">
                <option value="">Não usei cartão</option>
                ${selectableCards.map((card) => `<option value="${card.id}" ${normalized?.cardId === card.id ? 'selected' : ''}>${escapeHtml(card.name)}${card.active ? '' : ' (inativo)'}</option>`).join('')}
              </select>
            </label>
          </div>
          <div class="muted-box">O mês organiza compras, contas e valores a receber. Datas de pagamento ou recebimento aparecem no calendário.</div>
          <div class="inline-fields finance-form-grid finance-choice-row">
            <label class="field finance-installment-toggle" id="finance-installment-toggle-field">
              <span id="finance-installment-label">Foi parcelado?</span>
              <select class="select" name="installmentEnabled" id="finance-installment-enabled">
                <option value="false" ${defaultInstallments > 1 ? '' : 'selected'}>Não</option>
                <option value="true" ${defaultInstallments > 1 ? 'selected' : ''}>Sim</option>
              </select>
            </label>
            <label class="field" id="finance-recurring-field">
              <span>Repete todo mês?</span>
              <select class="select" name="fixed" id="finance-fixed">
                <option value="false" ${normalized?.fixed ? '' : 'selected'}>Não</option>
                <option value="true" ${normalized?.fixed ? 'selected' : ''}>Sim</option>
              </select>
            </label>
          </div>
          <div class="inline-fields finance-form-grid finance-installment-fields" id="finance-installment-fields">
            <label class="field">
              <span>Número de parcelas</span>
              <input class="input" type="number" min="2" max="48" name="totalInstallments" value="${defaultInstallments > 1 ? defaultInstallments : 2}" ${isExistingInstallment && options.editScope === 'single' ? 'readonly' : ''} />
            </label>
            <div class="field finance-form-help">
              <span id="finance-installment-help-title">Como funciona o parcelamento</span>
              <div class="muted-box" id="finance-installment-help-text">Informe em quantas vezes o lançamento foi dividido. O Controly cria cada parcela no mês correspondente.</div>
            </div>
          </div>
          ${isExistingInstallment && options.editScope === 'single' ? '<div class="muted-box">Você está editando apenas esta parcela. Para mudar o parcelamento inteiro, escolha a opção de editar todas as parcelas.</div>' : ''}
          ${isExistingInstallment && options.editScope === 'next' ? '<div class="muted-box">As alterações serão aplicadas nesta parcela e nas próximas parcelas deste parcelamento.</div>' : ''}
          ${isExistingInstallment && options.editScope === 'group' ? '<div class="muted-box">As alterações serão aplicadas em todas as parcelas cadastradas deste parcelamento.</div>' : ''}
          <label class="field"><span>Observações</span><textarea class="textarea" name="notes" placeholder="Registre informações importantes sobre este lançamento.">${escapeHtml(normalized?.notes || '')}</textarea></label>
          <div class="inline-actions sticky-modal-actions">
            <button type="button" id="finance-form-cancel" class="btn btn-secondary">Cancelar</button>
            <button type="button" id="finance-open-cards" class="btn btn-secondary">Gerenciar cartões</button>
            <button type="submit" class="btn btn-primary">${entry ? 'Salvar lançamento' : 'Criar lançamento'}</button>
          </div>
        </form>
      `,
    });

    const form = document.getElementById('finance-form');
    const flowTypeSelect = document.getElementById('finance-flow-type');
    const statusSelect = document.getElementById('finance-status');
    const fixedSelect = document.getElementById('finance-fixed');
    const fixedField = document.getElementById('finance-recurring-field');
    const cardSelect = document.getElementById('finance-card-id');
    const cardField = document.getElementById('finance-card-field');
    const paymentDateLabel = document.getElementById('finance-payment-date-label');
    const paymentCalendarHelp = document.getElementById('finance-payment-calendar-help');
    const installmentToggle = document.getElementById('finance-installment-enabled');
    const installmentToggleField = document.getElementById('finance-installment-toggle-field');
    const installmentLabel = document.getElementById('finance-installment-label');
    const installmentHelpTitle = document.getElementById('finance-installment-help-title');
    const installmentHelpText = document.getElementById('finance-installment-help-text');
    const installmentFields = document.getElementById('finance-installment-fields');

    const getSelectedCard = () => cards.find((item) => item.id === cardSelect?.value) || null;

    function syncStatusAndConditionalFields() {
      const flowType = flowTypeSelect.value;
      const optionsList = flowType === 'income'
        ? [{ value: 'pending', label: 'A receber' }, { value: 'received', label: 'Recebido' }]
        : [{ value: 'pending', label: 'A pagar' }, { value: 'paid', label: 'Pago' }];
      const current = statusSelect.value || defaultStatus;
      statusSelect.innerHTML = optionsList.map((option) => `<option value="${option.value}" ${option.value === current ? 'selected' : ''}>${option.label}</option>`).join('');
      if (!optionsList.some((option) => option.value === current)) statusSelect.value = optionsList[0].value;

      const setInstallmentFieldsVisible = (visible) => {
        installmentFields.classList.toggle('hidden', !visible);
        installmentFields.hidden = !visible;
        if (visible) {
          installmentFields.style.removeProperty('display');
        } else {
          installmentFields.style.setProperty('display', 'none', 'important');
        }
      };

      const isIncome = flowType === 'income';
      if (paymentDateLabel) paymentDateLabel.textContent = isIncome ? 'Data de recebimento (opcional)' : 'Data de pagamento (opcional)';
      if (paymentCalendarHelp) paymentCalendarHelp.textContent = isIncome
        ? 'Se preencher esta data, o valor a receber também aparece no calendário para lembrar você no dia certo.'
        : 'Se preencher esta data, o pagamento também aparece no calendário para lembrar você no dia certo.';
      if (installmentLabel) installmentLabel.textContent = isIncome ? 'Recebimento parcelado?' : 'Foi parcelado?';
      if (installmentHelpTitle) installmentHelpTitle.textContent = isIncome ? 'Como funciona o recebimento parcelado' : 'Como funciona o parcelamento';
      if (installmentHelpText) installmentHelpText.textContent = isIncome
        ? 'Informe em quantas vezes esse valor será recebido. O Controly cria uma parcela em cada mês para você acompanhar.'
        : 'Informe em quantas vezes o lançamento foi dividido. O Controly cria cada parcela no mês correspondente.';
      if (cardField) {
        cardField.classList.toggle('hidden', isIncome);
        if (isIncome && cardSelect) cardSelect.value = '';
      }

      if (fixedSelect.value === 'true') {
        installmentToggle.value = 'false';
      }

      if (installmentToggle.value === 'true') {
        fixedSelect.value = 'false';
      }

      const isFixed = fixedSelect.value === 'true';
      const canUseInstallments = !isFixed;
      const shouldShowInstallments = canUseInstallments && installmentToggle.value === 'true';

      installmentToggleField.classList.toggle('hidden', !canUseInstallments);
      fixedField.classList.toggle('hidden', shouldShowInstallments);
      setInstallmentFieldsVisible(shouldShowInstallments);
    }

    flowTypeSelect.addEventListener('change', syncStatusAndConditionalFields);
    cardSelect?.addEventListener('change', syncStatusAndConditionalFields);
    fixedSelect.addEventListener('change', syncStatusAndConditionalFields);
    installmentToggle.addEventListener('change', syncStatusAndConditionalFields);
    syncStatusAndConditionalFields();

    document.getElementById('finance-form-cancel')?.addEventListener('click', closeModal);
    document.getElementById('finance-open-cards')?.addEventListener('click', async () => {
      if (await closeModal()) openCardsManager();
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const flowType = data.get('flowType') || 'expense';
      const cardId = String(data.get('cardId') || '').trim() || null;
      const card = cards.find((item) => item.id === cardId) || null;
      const selectedMonthKey = data.get('monthKey') || selectedMonth;
      const paymentDate = String(data.get('paymentDate') || '').trim();
      const installmentEnabled = data.get('installmentEnabled') === 'true';
      const totalInstallments = installmentEnabled ? Math.max(2, Math.min(48, number(data.get('totalInstallments'), 2))) : 1;
      const basePayload = {
        title: String(data.get('title') || '').trim(),
        category: String(data.get('category') || '').trim(),
        amount: number(data.get('amount'), 0),
        monthKey: selectedMonthKey,
        paymentDate,
        paymentEndDate: '',
        fixed: installmentEnabled ? false : data.get('fixed') === 'true',
        notes: String(data.get('notes') || '').trim(),
        flowType,
        status: data.get('status') || 'pending',
        paid: flowType === 'expense' && data.get('status') === 'paid',
        received: flowType === 'income' && data.get('status') === 'received',
        cardId,
        cardName: card?.name || '',
        installmentEnabled,
        installmentNumber: normalized?.installmentNumber || 1,
        totalInstallments,
        installmentGroupId: installmentEnabled ? (normalized?.installmentGroupId || null) : null,
        templateId: normalized?.templateId || null,
        dueDate: '',
      };

      if (!basePayload.title) {
        showToast('Informe o nome do lançamento antes de salvar.', 'error');
        return;
      }
      if (basePayload.amount <= 0) {
        showToast('Informe um valor maior que zero para o lançamento.', 'error');
        return;
      }
      if (!basePayload.monthKey) {
        showToast('Escolha o mês do lançamento.', 'error');
        return;
      }
      if (installmentEnabled && totalInstallments < 2) {
        showToast('Informe pelo menos 2 parcelas para o parcelamento.', 'error');
        return;
      }

      try {
        if (!entry && installmentEnabled && totalInstallments > 1) {
          const groupId = createIdPrefix('installment');
          const saves = [];
          for (let index = 0; index < totalInstallments; index += 1) {
            const entryMonth = addMonthsToMonthKey(basePayload.monthKey, index);
            saves.push(saveRecord('financeEntries', {
              ...basePayload,
              monthKey: entryMonth,
              paymentDate: paymentDateForInstallment(basePayload.paymentDate, '', entryMonth),
              paymentEndDate: basePayload.paymentEndDate || '',
              dueDate: '',
              fixed: false,
              installmentEnabled: true,
              installmentNumber: index + 1,
              totalInstallments,
              installmentGroupId: groupId,
              status: index === 0 ? basePayload.status : 'pending',
              paid: index === 0 ? basePayload.paid : false,
              received: index === 0 ? basePayload.received : false,
            }));
          }
          const refs = await Promise.all(saves);
          showUndoToast('Parcelamento criado. As parcelas aparecerão no calendário financeiro.', () => Promise.all(refs.map((ref) => deleteRecord('financeEntries', ref.id))));
        } else if (options.editScope === 'group' && isInstallmentPurchase(normalized)) {
          const groupEntries = getInstallmentGroupEntries(normalized);
          const backups = groupEntries.map((item) => ({ id: item.id, data: cleanObjectForWrite(item) }));
          await Promise.all(groupEntries.map((groupEntry, index) => {
            const entryMonth = addMonthsToMonthKey(basePayload.monthKey, index);
            return patchRecord('financeEntries', groupEntry.id, {
              ...basePayload,
              monthKey: entryMonth,
              paymentDate: paymentDateForInstallment(basePayload.paymentDate, '', entryMonth),
              paymentEndDate: basePayload.paymentEndDate || '',
              dueDate: '',
              fixed: false,
              installmentEnabled: true,
              installmentNumber: index + 1,
              totalInstallments: groupEntries.length,
              installmentGroupId: normalized.installmentGroupId,
              status: basePayload.flowType === 'income' ? ((groupEntry.received || groupEntry.status === 'received') ? 'received' : 'pending') : ((groupEntry.paid || groupEntry.status === 'paid') ? 'paid' : 'pending'),
              paid: basePayload.flowType === 'expense' && Boolean(groupEntry.paid || groupEntry.status === 'paid'),
              received: basePayload.flowType === 'income' && Boolean(groupEntry.received || groupEntry.status === 'received'),
            });
          }));
          showUndoToast('Parcelamento atualizado. Se precisar, você pode desfazer essa alteração.', () => Promise.all(backups.map((item) => saveRecord('financeEntries', item.data, item.id))));
        } else if (options.editScope === 'next' && isInstallmentPurchase(normalized)) {
          const groupEntries = getInstallmentGroupEntries(normalized).filter((item) => number(item.installmentNumber, 0) >= number(normalized.installmentNumber, 0));
          const backups = groupEntries.map((item) => ({ id: item.id, data: cleanObjectForWrite(item) }));
          await Promise.all(groupEntries.map((groupEntry, index) => {
            const entryMonth = addMonthsToMonthKey(basePayload.monthKey, index);
            return patchRecord('financeEntries', groupEntry.id, {
              ...basePayload,
              monthKey: entryMonth,
              paymentDate: paymentDateForInstallment(basePayload.paymentDate, '', entryMonth),
              paymentEndDate: basePayload.paymentEndDate || '',
              dueDate: '',
              fixed: false,
              installmentEnabled: true,
              installmentNumber: groupEntry.installmentNumber,
              totalInstallments: groupEntry.totalInstallments || normalized.totalInstallments,
              installmentGroupId: normalized.installmentGroupId,
              status: basePayload.flowType === 'income' ? ((groupEntry.received || groupEntry.status === 'received') ? 'received' : 'pending') : ((groupEntry.paid || groupEntry.status === 'paid') ? 'paid' : 'pending'),
              paid: basePayload.flowType === 'expense' && Boolean(groupEntry.paid || groupEntry.status === 'paid'),
              received: basePayload.flowType === 'income' && Boolean(groupEntry.received || groupEntry.status === 'received'),
            });
          }));
          showUndoToast('Esta parcela e as próximas foram atualizadas.', () => Promise.all(backups.map((item) => saveRecord('financeEntries', item.data, item.id))));
        } else if (normalized?.virtual) {
          const created = await saveRecord('financeEntries', {
            ...basePayload,
            templateId: normalized.templateId || normalized.id.replace(/^virtual-/, '').replace(`-${selectedMonth}`, ''),
            dueDate: '',
          });
          showUndoToast('Previsão confirmada como lançamento do mês.', () => deleteRecord('financeEntries', created.id));
        } else {
          const previous = normalized?.id ? cleanObjectForWrite(normalized) : null;
          const saved = await saveRecord('financeEntries', {
            ...basePayload,
            fixed: isInstallmentPurchase(normalized) ? false : basePayload.fixed,
            installmentEnabled: isInstallmentPurchase(normalized) ? true : basePayload.installmentEnabled,
            installmentGroupId: isInstallmentPurchase(normalized) ? normalized.installmentGroupId : basePayload.installmentGroupId,
            installmentNumber: isInstallmentPurchase(normalized) ? normalized.installmentNumber : basePayload.installmentNumber,
            totalInstallments: isInstallmentPurchase(normalized) ? normalized.totalInstallments : basePayload.totalInstallments,
            dueDate: '',
          }, normalized?.id || null);
          if (previous && normalized?.id) {
            showUndoToast('Lançamento atualizado. Se precisar, você pode desfazer essa alteração.', () => saveRecord('financeEntries', previous, normalized.id));
          } else {
            showUndoToast(basePayload.paymentDate ? 'Lançamento criado. Você verá esse vencimento no calendário.' : 'Lançamento criado.', () => deleteRecord('financeEntries', saved.id));
          }
        }
        closeModal();
      } catch (error) {
        console.error(error);
        showToast('Não foi possível salvar o lançamento. Confira as informações e tente novamente.', 'error');
      }
    });

    refreshIcons();
  }

  async function toggleStatus(entry) {
    const card = getCards().find((item) => item.id === entry.cardId) || null;
    const nextStatus = entry.flowType === 'income'
      ? (entry.status === 'received' ? 'pending' : 'received')
      : (entry.status === 'paid' ? 'pending' : 'paid');
    const patch = {
      status: nextStatus,
      paid: entry.flowType === 'expense' && nextStatus === 'paid',
      received: entry.flowType === 'income' && nextStatus === 'received',
    };

    try {
      requestSilentFinanceUpdate();
      if (entry.virtual) {
        const created = await saveRecord('financeEntries', {
          title: entry.title,
          category: entry.category,
          amount: entry.amount,
          monthKey: selectedMonth,
          fixed: entry.fixed && !entry.installmentEnabled,
          notes: entry.notes || '',
          flowType: entry.flowType,
          status: patch.status,
          paid: patch.paid,
          received: patch.received,
          templateId: entry.templateId || entry.id.replace(/^virtual-/, '').replace(`-${selectedMonth}`, ''),
          cardId: entry.cardId || null,
          cardName: entry.cardName || '',
          paymentDate: entry.paymentDate || '',
          paymentEndDate: entry.paymentEndDate || '',
          installmentEnabled: entry.installmentEnabled,
          installmentNumber: entry.installmentNumber,
          totalInstallments: entry.totalInstallments,
          installmentGroupId: entry.installmentGroupId || null,
          dueDate: '',
        });
        showUndoToast(nextStatus === 'paid' || nextStatus === 'received' ? 'Previsão marcada como concluída.' : 'Previsão voltou para pendente.', () => deleteRecord('financeEntries', created.id));
      } else {
        const previous = { status: entry.status, paid: entry.paid || false, received: entry.received || false };
        await patchRecord('financeEntries', entry.id, patch);
        showUndoToast(nextStatus === 'paid' || nextStatus === 'received' ? 'Lançamento marcado como concluído.' : 'Lançamento voltou para pendente.', () => patchRecord('financeEntries', entry.id, previous));
      }
    } catch (error) {
      console.error(error);
      showToast('Não foi possível atualizar o lançamento. Tente novamente.', 'error');
    }
  }

  async function deleteSingleEntry(entry) {
    if (!entry.virtual) return deleteRecord('financeEntries', entry.id);
    return null;
  }

  async function deleteInstallmentGroup(entry) {
    const groupEntries = getInstallmentGroupEntries(entry);
    const results = await Promise.all(groupEntries.map((item) => deleteRecord('financeEntries', item.id)));
    return groupEntries.map((item, index) => ({ item, trashId: results[index]?.trashId }));
  }

  function openInstallmentDeleteChoice(entry) {
    openModal({
      title: 'Excluir parcelamento',
      eyebrow: 'Finanças',
      body: `
        <div class="stack-form">
          <div class="muted-box">Escolha se deseja excluir apenas esta parcela ou remover todas as parcelas deste parcelamento.</div>
          <button type="button" class="btn btn-secondary justify-start" id="delete-installment-single">Excluir somente esta parcela</button>
          <button type="button" class="btn btn-danger justify-start" id="delete-installment-all">Excluir todas as parcelas</button>
        </div>
      `,
    });
    document.getElementById('delete-installment-single')?.addEventListener('click', async () => {
      try {
        const result = await deleteSingleEntry(entry);
        closeModal();
        showUndoToast('Parcela enviada para a lixeira. Você pode restaurar se precisar.', () => result?.trashId ? restoreDeletedRecord(result.trashId) : Promise.resolve());
      } catch (error) {
        console.error(error);
        showToast('Não foi possível excluir a parcela. Tente novamente.', 'error');
      }
    });
    document.getElementById('delete-installment-all')?.addEventListener('click', async () => {
      try {
        const removed = await deleteInstallmentGroup(entry);
        const trashIds = removed.map((entry) => entry.trashId);
        closeModal();
        showUndoToast('Parcelamento enviado para a lixeira. Você pode restaurar se precisar.', () => restoreDeletedRecords(trashIds));
      } catch (error) {
        console.error(error);
        showToast('Não foi possível excluir o parcelamento. Tente novamente.', 'error');
      }
    });
  }

  async function handleDelete(entry) {
    if (isInstallmentPurchase(entry)) {
      openInstallmentDeleteChoice(entry);
      return;
    }
    if (entry.virtual) {
      const templateId = entry.templateId || entry.id.replace(/^virtual-/, '').replace(`-${selectedMonth}`, '');
      const template = (window.__CONTROLY_STATE?.financeEntries || []).find((item) => item.id === templateId);
      const confirmed = await confirmDialog({
        title: 'Encerrar recorrência',
        description: 'Este item é uma previsão automática. Para removê-lo dos próximos meses, encerre a recorrência que gera essa previsão.',
        confirmLabel: 'Encerrar recorrência',
      });
      if (!confirmed || !template) return;
      try {
        await patchRecord('financeEntries', template.id, { fixed: false });
        showUndoToast('Recorrência encerrada. Você pode reativar se precisar.', () => patchRecord('financeEntries', template.id, { fixed: true }));
      } catch (error) {
        console.error(error);
        showToast('Não foi possível encerrar a recorrência. Tente novamente.', 'error');
      }
      return;
    }
    const confirmed = await confirmDialog({
      title: 'Excluir lançamento',
      description: 'Este lançamento será enviado para a lixeira e poderá ser restaurado por 7 dias antes de ser apagado definitivamente.',
      confirmLabel: 'Enviar para a lixeira',
    });
    if (!confirmed) return;
    try {
      const result = await deleteSingleEntry(entry);
      showUndoToast('Lançamento enviado para a lixeira. Você pode restaurar se precisar.', () => result?.trashId ? restoreDeletedRecord(result.trashId) : Promise.resolve());
    } catch (error) {
      console.error(error);
      showToast('Não foi possível excluir o lançamento. Tente novamente.', 'error');
    }
  }

  function renderEntry(entry) {
    const done = entry.status === 'paid' || entry.status === 'received';
    const metaItems = [
      entry.category,
      entry.installmentEnabled ? `Parcela ${entry.installmentNumber}/${entry.totalInstallments}` : (entry.fixed ? 'Repete todo mês' : 'Lançamento único'),
      entry.virtual ? 'Previsão automática' : '',
      entry.templateId ? 'Gerado por recorrência' : '',
      entry.cardName,
      entry.paymentDate ? `${entry.flowType === 'income' ? 'Recebimento' : 'Pagamento'}: ${formatShortDateLabel(entry.paymentDate)}` : '',
    ].filter(Boolean);
    return `
      <article class="finance-entry-card ${done ? 'is-complete' : ''}" data-search-id="finance:${entry.id}">
        <div class="finance-entry-topline">
          <div class="finance-entry-title-group">
            <strong class="finance-entry-title">${escapeHtml(entry.title)}</strong>
            <span class="finance-status-pill finance-status-${getEntryColumn(entry)}">${getStatusLabel(entry)}</span>
          </div>
          <strong class="finance-entry-value">${formatCurrency(entry.amount)}</strong>
        </div>
        ${metaItems.length ? `<div class="finance-entry-details">${metaItems.map((item) => `<span class="finance-entry-mini-chip">${escapeHtml(item)}</span>`).join('')}</div>` : ''}
        ${entry.installmentEnabled ? '<div class="finance-entry-hint">As parcelas aparecem automaticamente nos meses correspondentes.</div>' : ''}
        ${entry.paymentDate ? '<div class="finance-entry-hint">Este lançamento também aparece no calendário na data informada.</div>' : ''}
        ${entry.virtual ? '<div class="finance-entry-hint">Previsão automática: confirme, edite ou encerre a recorrência quando necessário.</div>' : ''}
        ${entry.notes ? `<p class="finance-entry-notes">${escapeHtml(entry.notes)}</p>` : ''}
        <div class="finance-entry-footer">
          <label class="finance-check-wrap">
            <input class="finance-check" type="checkbox" data-action="toggle-paid" data-id="${entry.id}" ${done ? 'checked' : ''} />
            <span>${entry.flowType === 'income' ? 'Recebido' : 'Pago'}</span>
          </label>
          <div class="inline-actions finance-entry-buttons">
            <button type="button" class="icon-btn small" data-action="duplicate-entry" data-id="${entry.id}">${icon('copy-plus', 'Duplicar lançamento')}</button><button type="button" class="icon-btn small" data-action="edit-entry" data-id="${entry.id}">${icon('pencil-line', 'Editar lançamento')}</button>
            <button type="button" class="icon-btn small" data-action="delete-entry" data-id="${entry.id}">${icon('trash-2', 'Excluir lançamento')}</button>
          </div>
        </div>
      </article>
    `;
  }

  function renderColumn(entries, column) {
    const filtered = entries.filter((entry) => getEntryColumn(entry) === column);
    const total = sumBy(filtered, (item) => item.amount);
    return `
      <details class="section-accordion finance-column finance-column-${column} finance-column-accordion finance-lane finance-tone-${getColumnTone(column)}" open>
        <summary class="finance-lane-summary">
          <div class="finance-lane-summary-main">
            <span class="finance-lane-icon">${icon(getColumnIcon(column), getColumnLabel(column))}</span>
            <div class="finance-lane-copy"><strong class="finance-lane-title">${getColumnLabel(column)}</strong><small>${getColumnSubtitle(column)}</small></div>
          </div>
          <div class="finance-lane-summary-side"><strong class="finance-lane-total">${formatCurrency(total)}</strong><span class="finance-lane-count">${countLaunchText(filtered.length)}</span></div>
        </summary>
        <div class="section-accordion-body finance-column-body">
          <div class="finance-column-list">${filtered.map(renderEntry).join('') || createEmptyState('Nenhum lançamento financeiro encontrado', 'Registre uma entrada ou despesa para acompanhar melhor seu dinheiro.', { label: 'Adicionar lançamento', action: 'new-entry' })}</div>
        </div>
      </details>
    `;
  }

  function renderCardGroups(entries, cards) {
    const entriesWithCard = entries.filter((entry) => entry.cardId);
    if (!cards.length || !entriesWithCard.length) return '<div class="module-subtitle">Nenhum lançamento com cartão neste mês.</div>';
    return cards.map((card) => {
      const cardEntries = entriesWithCard.filter((entry) => entry.cardId === card.id);
      if (!cardEntries.length) return '';
      const statement = getStatementInfo(card, selectedMonth, entries);
      return `
        <details class="section-accordion finance-card-accordion">
          <summary>
            <div class="section-accordion-head">
              <strong>${escapeHtml(card.name)}</strong>
              <div class="section-accordion-meta">
                <span class="chip">${card.type === 'credit' ? 'Crédito' : 'Débito'}</span>
                <span class="chip">Fatura ${statement.status}</span>
                <span class="chip">${countLaunchText(cardEntries.length)}</span>
              </div>
            </div>
          </summary>
          <div class="section-accordion-body">
            <div class="finance-statement-strip">
              <span>Total da fatura: <strong>${formatCurrency(statement.total)}</strong></span>
              <span>Em aberto: <strong>${formatCurrency(statement.openAmount)}</strong></span>
              ${statement.limitAvailable !== null ? `<span>Limite disponível: <strong>${formatCurrency(statement.limitAvailable)}</strong></span>` : ''}
            </div>
            <div class="finance-columns-grid">${renderColumn(cardEntries, 'received')}${renderColumn(cardEntries, 'paid')}${renderColumn(cardEntries, 'receivable')}${renderColumn(cardEntries, 'spent')}</div>
          </div>
        </details>
      `;
    }).join('');
  }

  function renderMonthBlock(title, entries, options = {}) {
    const { open = false, meta = '' } = options;
    return `
      <details class="section-accordion month-accordion" ${open ? 'open' : ''}>
        <summary>
          <div class="section-accordion-head">
            <strong>${escapeHtml(title)}</strong>
            <div class="section-accordion-meta">${meta ? `<span class="chip">${escapeHtml(meta)}</span>` : ''}<span class="chip">${countLaunchText(entries.length)}</span></div>
          </div>
        </summary>
        <div class="section-accordion-body finance-month-body">
          <div class="finance-columns-grid">${renderColumn(entries, 'received')}${renderColumn(entries, 'paid')}${renderColumn(entries, 'receivable')}${renderColumn(entries, 'spent')}</div>
          <div class="finance-card-groups">
            <div class="item-top finance-card-groups-head"><div><span class="eyebrow">Cartões</span><h4>Lançamentos por cartão</h4></div></div>
            <div class="section-accordion-stack">${renderCardGroups(entries, getCards())}</div>
          </div>
        </div>
      </details>
    `;
  }

  function render(state) {
    if (!root) return;
    const rawCurrentEntries = getNormalizedEntriesForMonth(state, selectedMonth);
    const currentEntries = applyFinanceFilters(rawCurrentEntries);
    const totals = {
      received: sumBy(currentEntries.filter((item) => getEntryColumn(item) === 'received'), (item) => item.amount),
      paid: sumBy(currentEntries.filter((item) => getEntryColumn(item) === 'paid'), (item) => item.amount),
      receivable: sumBy(currentEntries.filter((item) => getEntryColumn(item) === 'receivable'), (item) => item.amount),
      spent: sumBy(currentEntries.filter((item) => getEntryColumn(item) === 'spent'), (item) => item.amount),
    };
    const cards = getCards();
    const projectedBalance = totals.received + totals.receivable - totals.paid - totals.spent;
    const expensesByCategory = currentEntries
      .filter((entry) => entry.flowType === 'expense')
      .reduce((acc, entry) => {
        const key = entry.category || 'Sem categoria';
        acc[key] = (acc[key] || 0) + entry.amount;
        return acc;
      }, {});
    const topExpense = Object.entries(expensesByCategory).sort((a, b) => b[1] - a[1])[0];
    const pendingExpenses = currentEntries.filter((entry) => entry.flowType === 'expense' && entry.status !== 'paid');
    const openStatements = cards.filter((card) => card.type === 'credit').filter((card) => getStatementInfo(card, selectedMonth, rawCurrentEntries).openAmount > 0);
    const archiveGroups = groupExplicitByMonth(state.financeEntries || []).filter(([key]) => key !== selectedMonth);
    const categoryOptions = [...new Set(rawCurrentEntries.map((entry) => entry.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));

    root.innerHTML = `
      <div class="section-shell finance-shell">
        <div class="section-head">
          <div>
            <span class="eyebrow">Controle financeiro do mês</span>
            <h3>Finanças</h3>
            <p class="module-subtitle">Organize entradas, contas pagas, contas a pagar, valores a receber, cartões e parcelamentos mês a mês.</p>
          </div>
          <div class="section-actions"><button class="btn btn-secondary" type="button" data-action="manage-cards">Gerenciar cartões</button><button class="btn btn-primary" type="button" data-action="new-entry">Criar lançamento</button></div>
        </div>

        <div class="compact-stat-grid mobile-rail mobile-rail-cards">
          <article class="stat-card"><span class="label">Recebido</span><strong>${formatCurrency(totals.received)}</strong></article>
          <article class="stat-card"><span class="label">Pago</span><strong>${formatCurrency(totals.paid)}</strong></article>
          <article class="stat-card"><span class="label">A receber</span><strong>${formatCurrency(totals.receivable)}</strong></article>
          <article class="stat-card"><span class="label">A pagar</span><strong>${formatCurrency(totals.spent)}</strong></article>
          <article class="stat-card"><span class="label">Cartões ativos</span><strong>${cards.filter((card) => card.active).length}</strong></article>
        </div>

        <div class="finance-insight-grid">
          <article class="finance-insight-card"><span>Saldo previsto</span><strong>${formatCurrency(projectedBalance)}</strong><small>considerando recebidos, a receber, pagos e a pagar do filtro atual</small></article>
          <article class="finance-insight-card"><span>Compras pendentes</span><strong>${formatCurrency(sumBy(pendingExpenses, (item) => item.amount))}</strong><small>${countLaunchText(pendingExpenses.length)} ainda a pagar no mês</small></article>
          <article class="finance-insight-card"><span>Maior gasto</span><strong>${topExpense ? escapeHtml(topExpense[0]) : 'Sem gastos'}</strong><small>${topExpense ? formatCurrency(topExpense[1]) : 'Nada para destacar neste mês'}</small></article>
          <article class="finance-insight-card"><span>Faturas em aberto</span><strong>${openStatements.length}</strong><small>cartões de crédito com valor em aberto neste mês</small></article>
        </div>

        <article class="panel">
          <div class="filter-row filter-row-search-top finance-toolbar-row">
            <label class="field search-field-grow"><span>Mês em análise</span><input class="input" type="month" id="finance-month" value="${selectedMonth}" /></label>
            <label class="field"><span>Tipo</span><select class="select" id="finance-filter-flow"><option value="all">Todos</option><option value="expense" ${filters.flowType === 'expense' ? 'selected' : ''}>Despesas</option><option value="income" ${filters.flowType === 'income' ? 'selected' : ''}>Entradas</option></select></label>
            <label class="field"><span>Situação</span><select class="select" id="finance-filter-status"><option value="all">Todas</option><option value="pending" ${filters.status === 'pending' ? 'selected' : ''}>Pendentes</option><option value="paid" ${filters.status === 'paid' ? 'selected' : ''}>Pagas</option><option value="received" ${filters.status === 'received' ? 'selected' : ''}>Recebidas</option></select></label>
            <label class="field"><span>Cartão</span><select class="select" id="finance-filter-card"><option value="all">Todos</option><option value="none" ${filters.cardId === 'none' ? 'selected' : ''}>Sem cartão</option>${cards.map((card) => `<option value="${card.id}" ${filters.cardId === card.id ? 'selected' : ''}>${escapeHtml(card.name)}</option>`).join('')}</select></label>
            <label class="field"><span>Recorrência</span><select class="select" id="finance-filter-recurrence"><option value="all">Todos</option><option value="single" ${filters.recurrence === 'single' ? 'selected' : ''}>Único</option><option value="fixed" ${filters.recurrence === 'fixed' ? 'selected' : ''}>Repete todo mês</option><option value="installment" ${filters.recurrence === 'installment' ? 'selected' : ''}>Parcelado</option></select></label>
            <label class="field"><span>Categoria ou busca</span><input class="input" list="finance-category-options" id="finance-filter-category" value="${escapeHtml(filters.category)}" placeholder="Ex.: mercado" /><datalist id="finance-category-options">${categoryOptions.map((item) => `<option value="${escapeHtml(item)}"></option>`).join('')}</datalist></label>
          </div>
          <div class="muted-box finance-filter-hint">Parcelas aparecem automaticamente nos próximos meses. Use “repete todo mês” para contas fixas, como aluguel, assinatura ou mensalidade.</div>
        </article>

        <div class="section-accordion-stack finance-month-stack">
          ${renderMonthBlock(formatMonthLabel(toDate(`${selectedMonth}-01`)), currentEntries, { open: true, meta: 'mês selecionado' })}
          ${archiveGroups.map(([key]) => renderMonthBlock(formatMonthLabel(toDate(`${key}-01`)), applyFinanceFilters(getNormalizedEntriesForMonth(state, key)), { open: false, meta: 'mês anterior' })).join('')}
        </div>
      </div>
    `;
    refreshIcons(root);
  }

  function init(element) {
    root = element;
    window.__CONTROLY_OPENERS = window.__CONTROLY_OPENERS || {};
    window.__CONTROLY_OPENERS.finance = ({ id } = {}) => {
      const state = window.__CONTROLY_STATE || {};
      const entry = (state.financeEntries || []).map((item) => normalizeFinanceEntry(item, state.financeCards || [])).find((item) => item.id === id);
      if (entry) {
        selectedMonth = entry.monthKey || selectedMonth;
        openFinanceForm(entry);
        return true;
      }
      const card = (state.financeCards || []).find((item) => item.id === id);
      if (card) { openCardsManager(card); return true; }
      return false;
    };
    root.addEventListener('input', (event) => {
      if (event.target.id === 'finance-month') selectedMonth = event.target.value;
      if (event.target.id === 'finance-filter-category') filters.category = event.target.value;
      if (event.target.id === 'finance-month' || event.target.id === 'finance-filter-category') render(window.__CONTROLY_STATE);
    });
    root.addEventListener('change', (event) => {
      if (event.target.id === 'finance-filter-flow') filters.flowType = event.target.value;
      if (event.target.id === 'finance-filter-status') filters.status = event.target.value;
      if (event.target.id === 'finance-filter-card') filters.cardId = event.target.value;
      if (event.target.id === 'finance-filter-recurrence') filters.recurrence = event.target.value;
      if (event.target.id?.startsWith('finance-filter-')) render(window.__CONTROLY_STATE);
    });
    root.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      const action = button.dataset.action;
      const entry = button.dataset.id ? getEntryById(button.dataset.id) : null;
      if (action === 'new-entry') openFinanceForm();
      if (action === 'manage-cards') openCardsManager();
      if (action === 'edit-entry' && entry) {
        if (isInstallmentPurchase(entry)) openInstallmentEditChoice(entry);
        else openFinanceForm(entry);
      }
      if (action === 'toggle-paid' && entry) await toggleStatus(entry);
      if (action === 'duplicate-entry' && entry) {
        try {
          const copy = cleanObjectForWrite({ ...entry, title: entry.title, status: 'pending', paid: false, received: false, virtual: false, templateId: null, installmentGroupId: null, installmentEnabled: false, installmentNumber: 1, totalInstallments: 1 });
          delete copy.id;
          const saved = await saveRecord('financeEntries', copy);
          showUndoToast('Lançamento duplicado. Revise os detalhes se precisar.', () => deleteRecord('financeEntries', saved.id));
        } catch (error) {
          console.error(error);
          showToast('Não foi possível duplicar o lançamento. Tente novamente.', 'error');
        }
      }
      if (action === 'delete-entry' && entry) await handleDelete(entry);
    });
  }

  return { id: 'finance', init, render };
}