import { escapeHtml } from '../shared/utils.js';
import { showToast, confirmDialog, refreshIcons } from '../ui/ui.js';
import { adminCall } from './admin-client.js';

export function createAdminModule() {
  let root;
  let accounts = [];
  let nextPageToken = '';
  let pending = false;
  const itemView = (item) => `
    <tr><td><strong>${escapeHtml(item.displayName || item.email || 'Conta')}</strong><small class="admin-user-email">${escapeHtml(item.email || 'Sem e-mail')}</small></td>
      <td><span class="tag">${item.status === 'suspended' ? 'Suspensa' : 'Ativa'}</span></td>
      <td><small>${escapeHtml(item.createdAt || '—')}</small></td>
      <td><button class="btn btn-secondary" type="button" data-admin-uid="${escapeHtml(item.uid)}" data-admin-status="${item.status === 'suspended' ? 'active' : 'suspended'}" ${item.isSelf || item.isSuperAdmin ? 'disabled' : ''}>
        ${item.status === 'suspended' ? 'Ativar' : 'Suspender'}</button></td></tr>`;

  function renderTable() {
    const body = root?.querySelector('[data-admin-accounts]');
    if (body) body.innerHTML = accounts.map(itemView).join('') || '<tr><td colspan="4">Nenhuma conta encontrada.</td></tr>';
    const more = root?.querySelector('[data-admin-more]');
    if (more) more.hidden = !nextPageToken;
    refreshIcons();
  }

  async function fetchPage(reset = false) {
    if (pending) return;
    pending = true;
    const button = root?.querySelector('[data-admin-more]');
    if (button) button.disabled = true;
    try {
      const result = await adminCall('voraListAccounts', { pageToken: reset ? '' : nextPageToken });
      accounts = reset ? result.accounts || [] : [...accounts, ...(result.accounts || [])];
      nextPageToken = result.nextPageToken || '';
      renderTable();
    } catch (error) {
      console.error('Consulta administrativa falhou', error?.code || 'unknown');
      showToast('Não foi possível consultar as contas. Confira a configuração administrativa.', 'error');
    } finally { pending = false; if (button) button.disabled = false; }
  }

  return {
    id: 'admin',
    init(section) {
      root = section;
      root?.addEventListener('click', async (event) => {
        if (event.target.closest('[data-admin-refresh]')) return fetchPage(true);
        if (event.target.closest('[data-admin-more]')) return fetchPage(false);
        const button = event.target.closest('[data-admin-uid]');
        if (!button || pending) return;
        const uid = button.dataset.adminUid;
        const status = button.dataset.adminStatus;
        const account = accounts.find((item) => item.uid === uid);
        if (!account || account.isSelf || account.isSuperAdmin) return;
        if (!await confirmDialog({
          title: status === 'suspended' ? 'Suspender acesso?' : 'Reativar acesso?',
          description: status === 'suspended' ? 'A conta perderá acesso aos dados enquanto estiver suspensa. A ação será registrada para auditoria.' : 'A conta voltará a acessar seus dados.',
          confirmLabel: status === 'suspended' ? 'Suspender conta' : 'Ativar conta',
        })) return;
        pending = true; button.disabled = true;
        try {
          await adminCall('voraSetAccountAccess', { uid, status });
          showToast(status === 'suspended' ? 'Conta suspensa.' : 'Conta reativada.');
          pending = false;
          await fetchPage(true);
        } catch (error) {
          console.error('Ação administrativa falhou', error?.code || 'unknown');
          showToast('Não foi possível alterar o acesso da conta.', 'error');
        } finally { pending = false; button.disabled = false; }
      });
    },
    render() {
      if (!root) return;
      root.innerHTML = `<div class="section-shell admin-shell">
        <div class="section-head"><div><span class="eyebrow">Administração VORA</span><h3>Contas e acessos</h3><p>Gerencie as contas de forma segura. Nenhuma senha é exibida.</p></div>
          <div class="section-actions"><button class="btn btn-secondary" type="button" data-admin-refresh>Atualizar lista</button></div></div>
        <div class="panel admin-panel"><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Conta</th><th>Acesso</th><th>Cadastro</th><th>Ação</th></tr></thead><tbody data-admin-accounts></tbody></table></div>
        <button type="button" class="btn btn-secondary" data-admin-more hidden>Carregar mais contas</button></div></div>`;
      renderTable();
    },
    activate() { return fetchPage(true); },
  };
}
