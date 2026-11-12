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
  const itemView = item => {
    const protectedAccount = item.isSelf || item.isSuperAdmin;
    const stateLabel = {active:'Ativa',suspended:'Suspensa',pending:'Aguardando primeiro acesso',removed:'Acesso removido'}[item.status] || 'Ativa';
    const actions = protectedAccount ? '<small>Conta administrativa protegida</small>'
      : item.status === 'pending' ? `<button class="btn btn-secondary" type="button" data-admin-invite="${escapeHtml(item.uid)}">Reenviar acesso</button>`
      : item.status === 'removed' ? `<button class="btn btn-secondary" type="button" data-admin-uid="${escapeHtml(item.uid)}" data-admin-status="active">Restaurar acesso</button>`
      : `<button class="btn btn-secondary" type="button" data-admin-uid="${escapeHtml(item.uid)}" data-admin-status="${item.status === 'suspended' ? 'active' : 'suspended'}">${item.status === 'suspended' ? 'Reativar' : 'Suspender'}</button>
         <button class="btn btn-secondary admin-remove-access" type="button" data-admin-uid="${escapeHtml(item.uid)}" data-admin-status="removed">Remover acesso</button>`;
    return `<tr>
      <td><strong>${escapeHtml(item.displayName || item.email || 'Conta')}</strong><small class="admin-user-email">${escapeHtml(item.email || 'Sem e-mail')}</small></td>
      <td><span class="admin-state is-${escapeHtml(item.status)}">${escapeHtml(stateLabel)}</span></td>
      <td><small>${escapeHtml(formatDate(item.createdAt))}</small></td>
      <td><div class="admin-row-actions">${actions}</div></td>
    </tr>`;
  };
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
    if (blocked) blocked.textContent = String(accounts.filter(a => a.status !== 'active').length);
    refreshIcons();
  }
  function renderAudit() {
    const element = root?.querySelector('[data-admin-audit]');
    if (!element) return;
    element.innerHTML = audit.length ? audit.map(item => {
      const account = accounts.find(a => a.uid === item.targetUid);
      const label = account?.email || `Conta ${String(item.targetUid || '').slice(0, 8)}…`;
      return `<li><span><strong>${escapeHtml(({suspend:'Conta suspensa',activate:'Conta reativada',remove:'Acesso removido',create:'Conta cadastrada',invite:'Convite enviado'})[item.action] || 'Ação administrativa')}</strong><small>${escapeHtml(label)}</small></span><small>${escapeHtml(formatDate(item.at))}</small></li>`;
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
      root?.addEventListener('submit', async event => {
        const form = event.target.closest('[data-admin-create-form]');
        if (!form) return;
        event.preventDefault();
        if (pending) return;
        const email = form.elements.namedItem('email')?.value?.trim() || '';
        const displayName = form.elements.namedItem('displayName')?.value?.trim() || '';
        if (!email || !displayName) {setError('Informe nome e e-mail para cadastrar.');return;}
        if (!await confirmDialog({title:'Cadastrar nova conta?',description:`O Controly criará uma conta para ${email} e enviará um e-mail para que a pessoa defina sua senha.`,confirmLabel:'Cadastrar e enviar acesso'})) return;
        pending = true;
        const submitButton = form.querySelector('[type=submit]');
        submitButton.disabled = true;
        setError();
        try {
          const result = await adminCall('voraCreateAccount',{email,displayName});
          form.reset();
          showToast(result.invited ? 'Conta criada. O e-mail de acesso foi enviado.' : 'Conta criada, mas o convite precisa ser reenviado.');
          pending = false;
          await fetchPage(true);
          await fetchAudit();
          if (result.notice) setError(result.notice);
        } catch (error) {setError(error?.message || adminErrorMessage(error));}
        finally {pending=false; if (submitButton.isConnected) submitButton.disabled=false;}
      });
      root?.addEventListener('input', event => {
        if (!event.target.matches('[data-admin-filter]')) return;
        filter = event.target.value.trim().toLocaleLowerCase('pt-BR');
        renderTable();
      });
      root?.addEventListener('click', async event => {
        if (event.target.closest('[data-admin-refresh]')) { await fetchPage(true); await fetchAudit(); return; }
        if (event.target.closest('[data-admin-more]')) return fetchPage(false);
        const invite = event.target.closest('[data-admin-invite]');
        if (invite) {
          if (pending) return;
          const uid = invite.dataset.adminInvite;
          const account = accounts.find(a=>a.uid === uid);
          if (!account || account.status !== 'pending' || account.isSelf || account.isSuperAdmin) return;
          if (!await confirmDialog({title:'Reenviar e-mail de acesso?',description:`Enviaremos um novo link de definição de senha para ${account.email}.`,confirmLabel:'Reenviar acesso'})) return;
          pending=true;invite.disabled=true;setError();
          try {await adminCall('voraResendInvite',{uid}); showToast('E-mail de acesso solicitado.');pending=false;await fetchPage(true);await fetchAudit();}
          catch(error) {setError(error?.message || adminErrorMessage(error));}
          finally {pending=false;if(invite.isConnected)invite.disabled=false;}
          return;
        }
        const button = event.target.closest('[data-admin-uid]');
        if (!button || pending) return;
        const uid = button.dataset.adminUid;
        const status = button.dataset.adminStatus;
        const account = accounts.find(item => item.uid === uid);
        if (!account || account.isSelf || account.isSuperAdmin) return;
        if (!await confirmDialog({
          title: status === 'removed' ? 'Remover acesso desta conta?' : status === 'suspended' ? 'Suspender acesso?' : 'Reativar acesso?',
          description: status === 'removed' ? 'O acesso será revogado e a conta arquivada. Os dados e o registro de autenticação serão preservados; isto não é exclusão definitiva.' : status === 'suspended' ? 'Essa conta deixará de acessar os próprios dados enquanto estiver suspensa. Os registros não serão apagados.' : 'A conta poderá voltar a utilizar o Controly e acessar seus dados preservados.',
          confirmLabel: status === 'removed' ? 'Remover acesso' : status === 'suspended' ? 'Suspender conta' : 'Reativar conta',
        })) return;
        pending = true;
        button.disabled = true;
        setError();
        try {
          await adminCall('voraSetAccountAccess', {uid, status});
          showToast(status === 'removed' ? 'Acesso removido. Dados preservados.' : status === 'suspended' ? 'Conta suspensa.' : 'Conta reativada.');
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
        <div class="section-head"><div><span class="eyebrow">Administração VORA</span><h3>Contas e acessos</h3><p>Cadastre usuários, envie acesso e gerencie contas com segurança.</p></div>
        <button class="btn btn-secondary" type="button" data-admin-refresh><i data-lucide="refresh-cw"></i> Atualizar</button></div>
        <div class="admin-summary">
          <div class="panel admin-stat"><small>Contas carregadas</small><strong data-admin-count>0 conta(s)</strong></div>
          <div class="panel admin-stat"><small>Ativas</small><strong data-admin-active>0</strong></div>
          <div class="panel admin-stat"><small>Sem acesso</small><strong data-admin-suspended>0</strong></div>
        </div>
        <section class="panel admin-panel admin-create-panel" aria-labelledby="admin-create-title">
          <h4 id="admin-create-title">Adicionar usuário</h4>
          <p class="settings-description">Cadastre uma pessoa com nome e e-mail. A senha será definida pelo próprio usuário no link enviado pelo Firebase.</p>
          <form data-admin-create-form class="admin-create-form">
            <label>Nome completo<input required name="displayName" type="text" maxlength="100" autocomplete="off" placeholder="Nome do usuário"></label>
            <label>E-mail<input required name="email" type="email" maxlength="254" autocomplete="off" placeholder="pessoa@empresa.com"></label>
            <button type="submit" class="btn btn-primary">Cadastrar e enviar acesso</button>
          </form>
          <p class="admin-create-note">Se o envio falhar, a conta permanecerá sem acesso até o convite ser reenviado.</p>
        </section>
        <div class="panel admin-panel">
          <label class="admin-search-label for="admin-filter-input">Buscar entre as contas carregadas</label>
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
