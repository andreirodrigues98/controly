import { escapeHtml } from '../shared/utils.js';
import { showToast, confirmDialog, refreshIcons } from '../ui/ui.js';
import { adminCall, adminErrorMessage } from './admin-client.js';

/** Interface administrativa. Toda decisão de autorização é feita pelo Worker. */
export function createAdminModule() {
  let root;
  let accounts = [];
  let nextPageToken = '';
  let pending = false;
  let filter = '';
  let audit = [];

  const formatDate = value => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('pt-BR', {dateStyle:'short',timeStyle:'short'}).format(date);
  };
  const itemView = item => `<tr>
    <td><strong>${escapeHtml(item.displayName || item.email || 'Conta')}</strong><small class="admin-user-email">${escapeHtml(item.email || 'Sem e-mail')}</small></td>
    <td><span class="admin-state ${item.status === 'suspended' ? 'is-suspended' : 'is-active'}">${item.status === 'suspended' ? 'Suspensa' : 'Ativa'}</span></td>
    <td><small>${escapeHtml(formatDate(item.createdAt))}</small></td>
    <td><button class="btn btn-secondary" type="button" data-admin-uid="${escapeHtml(item.uid)}" data-admin-status="${item.status === 'suspended' ? 'active' : 'suspended'}" ${item.isSelf || item.isSuperAdmin ? 'disabled title="Conta administrativa protegida"' : ''}>${item.status === 'suspended' ? 'Reativar' : 'Suspender'}</button></td>
  </tr>`;
  function setError(message = '') {
    const holder = root?.querySelector('[data-admin-error]');
    if (holder) {holder.textContent = message; holder.hidden = !message;}
  }
  function renderTable() {
    const visible = accounts.filter(item => `${item.displayName || ''} ${item.email || ''}`.toLocaleLowerCase('pt-BR').includes(filter));
    const body = root?.querySelector('[data-admin-accounts]');
    if (body) body.innerHTML = visible.map(itemView).join('') || `<tr><td colspan="4">${filter ? 'Nenhuma conta carregada corresponde à busca.' : 'Nenhuma conta encontrada.'}</td></tr>`;
    const more = root?.querySelector('[data-admin-more]');
    if (more) more.hidden = !nextPageToken;
    const count = root?.querySelector('[data-admin-count]');
    if (count) count.textContent = `${accounts.length} conta(s) carregada(s)`;
    const active = root?.querySelector('[data-admin-active]');
    if (active) active.textContent = String(accounts.filter(a => a.status === 'active').length);
    const blocked = root?.querySelector('[data-admin-suspended]');
    if (blocked) blocked.textContent = String(accounts.filter(a => a.status === 'suspended').length);
    refreshIcons();
  }
  function renderAudit() {
    const element = root?.querySelector('[data-admin-audit]');
    if (!element) return;
    element.innerHTML = audit.length ? audit.map(item => {
      const account = accounts.find(a => a.uid === item.targetUid);
      const label = account?.email || `Conta ${String(item.targetUid || '').slice(0, 8)}…`;
      return `<li><span><strong>${escapeHtml(item.action === 'suspend' ? 'Conta suspensa' : 'Conta reativada')}</strong><small>${escapeHtml(label)}</small></span><small>${escapeHtml(formatDate(item.at))}</small></li>`;
    }).join('') : '<li><span>Nenhuma alteração administrativa recente.</span></li>';
  }
  async function fetchAudit() {
    try {audit = (await adminCall('voraListAudit')).events || []; renderAudit();}
    catch (error) {
      const holder = root?.querySelector('[data-admin-audit]');
      if (holder) holder.innerHTML = '<li>Não foi possível consultar o histórico agora.</li>';
    }
  }
  async function fetchPage(reset = false) {
    if (pending) return;
    pending = true;
    const button = root?.querySelector('[data-admin-more]');
    if (button) button.disabled = true;
    setError();
    try {
      const result = await adminCall('voraListAccounts', { pageToken: reset ? '' : nextPageToken });
      accounts = reset ? result.accounts || [] : [...accounts, ...(result.accounts || [])];
      nextPageToken = result.nextPageToken || '';
      renderTable();
    } catch (error) {
      setError(adminErrorMessage(error));
    } finally { pending = false; if (button) button.disabled = false; }
  }

  return {
    id: 'admin',
    // Evita que dados administrativos de uma conta fiquem no DOM ou na memória após sair.
    clear() { accounts = []; audit = []; nextPageToken = ''; filter = ''; pending = false; if (root) root.replaceChildren(); },
    init(section) {
      root = section;
      root?.addEventListener('input', event => {
        if (!event.target.matches('[data-admin-filter]')) return;
        filter = event.target.value.trim().toLocaleLowerCase('pt-BR');
        renderTable();
      });
      root?.addEventListener('click', async event => {
        if (event.target.closest('[data-admin-refresh]')) { await fetchPage(true); await fetchAudit(); return; }
        if (event.target.closest('[data-admin-more]')) return fetchPage(false);
        const button = event.target.closest('[data-admin-uid]');
        if (!button || pending) return;
        const uid = button.dataset.adminUid;
        const status = button.dataset.adminStatus;
        const account = accounts.find(item => item.uid === uid);
        if (!account || account.isSelf || account.isSuperAdmin) return;
        if (!await confirmDialog({
          title: status === 'suspended' ? 'Suspender acesso?' : 'Reativar acesso?',
          description: status === 'suspended' ? 'Essa conta deixará de acessar os próprios dados enquanto estiver suspensa. Os registros não serão apagados.' : 'A conta poderá voltar a utilizar o Controly e acessar seus dados preservados.',
          confirmLabel: status === 'suspended' ? 'Suspender conta' : 'Reativar conta',
        })) return;
        pending = true;
        button.disabled = true;
        setError();
        try {
          await adminCall('voraSetAccountAccess', {uid, status});
          showToast(status === 'suspended' ? 'Conta suspensa.' : 'Conta reativada.');
          pending = false;
          await fetchPage(true);
          await fetchAudit();
        } catch (error) {
          setError(adminErrorMessage(error));
          showToast('Não foi possível atualizar esta conta.', 'error');
        } finally {pending = false; if (button.isConnected) button.disabled = false;}
      });
    },
    render() {
      if (!root) return;
      root.innerHTML = `<div class="section-shell admin-shell">
        <div class="section-head"><div><span class="eyebrow">Administração VORA</span><h3>Contas e acessos</h3><p>Consulte perfis que já acessaram o Controly e controle o acesso sem excluir dados.</p></div>
        <button class="btn btn-secondary" type="button" data-admin-refresh><i data-lucide="refresh-cw"></i> Atualizar</button></div>
        <div class="admin-summary">
          <div class="panel admin-stat"><small>Contas carregadas</small><strong data-admin-count>0 conta(s)</strong></div>
          <div class="panel admin-stat"><small>Ativas</small><strong data-admin-active>0</strong></div>
          <div class="panel admin-stat"><small>Suspensas</small><strong data-admin-suspended>0</strong></div>
        </div>
        <div class="panel admin-panel">
          <label class="admin-search-label" for="admin-filter-input">Buscar entre as contas carregadas</label>
          <input class="admin-search-input" id="admin-filter-input" data-admin-filter type="search" placeholder="Nome ou e-mail" autocomplete="off" />
          <p class="admin-error" role="alert" data-admin-error hidden></p>
          <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Conta</th><th>Situação</th><th>Cadastro</th><th>Ação</th></tr></thead><tbody data-admin-accounts><tr><td colspan="4">Carregando contas...</td></tr></tbody></table></div>
          <button type="button" class="btn btn-secondary" data-admin-more hidden>Carregar mais contas</button>
        </div>
        <section class="panel admin-panel admin-audit-panel"><h4>Últimas alterações de acesso</h4><ul data-admin-audit><li>Carregando histórico...</li></ul></section>
      </div>`;
      renderTable();
    },
    async activate() {await fetchPage(true); await fetchAudit();},
  };
}
