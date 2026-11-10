import { escapeHtml } from '../shared/utils.js';
import { compressAvatarFile, avatarUploadErrorMessage } from '../features/profile-photo.js';
import { saveProfileAvatar } from '../services/store.js';
import { showToast, updateUserBadge } from '../ui/ui.js';
import { logout } from '../services/auth.js';
import { downloadOwnDataExport } from '../services/account-export.js';
import { adminCall, adminErrorMessage, isAdminBackendEnabled } from '../admin/admin-client.js';

/** Configurações de conta: sem intervenções automáticas na senha. */
export function createSettingsModule() {
  let root;
  return {
    id: 'settings',
    init(section) {
      root = section;
      root.addEventListener('change', async (event) => {
        if (event.target.id !== 'settings-avatar-input') return;
        const file = event.target.files?.[0];
        if (!file) return;
        const button = root.querySelector('#settings-avatar-upload');
        if (button) button.disabled = true;
        try {
          const avatar = await compressAvatarFile(file);
          await saveProfileAvatar(avatar);
          const state = window.__CONTROLY_STATE;
          if (state?.user) {
            state.profile = { ...(state.profile || {}), avatarDataUrl: avatar };
            updateUserBadge(state.user, state.profile);
            this.render(state);
          }
          showToast('Foto de perfil atualizada.');
        } catch (error) {
          // O código de erro fica apenas no console de desenvolvimento.
          console.error('Falha ao salvar foto de perfil:', error?.code || error?.name || 'unknown', error);
          showToast(avatarUploadErrorMessage(error), 'error');
        } finally {
          // Permite escolher novamente a mesma imagem depois de uma falha.
          if (event.target?.isConnected) event.target.value = '';
          if (button?.isConnected) button.disabled = false;
        }
      });
      root.addEventListener('click', async (event) => {
        if (event.target.closest('[data-admin-verify]')) {
          const button = root.querySelector('[data-admin-verify]');
          const message = root.querySelector('[data-admin-verification-result]');
          if (!button || !message || button.disabled) return;
          button.disabled = true;
          message.textContent = 'Verificando seu acesso...';
          try {
            if (!isAdminBackendEnabled()) throw new Error('A administração ainda não está habilitada nesta instalação. Ative a integração e atualize a página.');
            const result = await adminCall('voraWhoAmI');
            if (!result?.admin) throw new Error('A conta não tem acesso administrativo.');
            message.textContent = 'Sua conta está autorizada para a Administração VORA.';
            window.dispatchEvent(new CustomEvent('controly:admin-verified', {detail: {authorized:true}}));
            const open = root.querySelector('[data-admin-open]');
            if (open) open.hidden = false;
          } catch (error) {
            message.textContent = error?.status ? adminErrorMessage(error) : error?.message || adminErrorMessage(error);
          } finally { if (button.isConnected) button.disabled = false; }
          return;
        }
        if (event.target.closest('[data-admin-copy-uid]')) {
          const value = window.__CONTROLY_STATE?.user?.uid || '';
          if (!value) return;
          try { await navigator.clipboard.writeText(value); showToast('Identificador da conta copiado.'); }
          catch {showToast('Selecione e copie o identificador exibido.', 'error');}
          return;
        }
        if (event.target.closest('#settings-data-export')) {
          const button = root.querySelector('#settings-data-export');
          if (button?.disabled) return;
          button.disabled = true;
          button.setAttribute('aria-busy', 'true');
          try {
            await downloadOwnDataExport();
            showToast('Relatório pronto! Abra o arquivo no navegador para ler ou salvar em PDF.');
          } catch (error) {
            console.error('Falha na exportação dos dados:', error?.code || error?.message || 'unknown');
            showToast('Não foi possível exportar todos os dados. Confira a conexão e as permissões e tente novamente.', 'error');
          } finally {
            if (button?.isConnected) { button.disabled = false; button.removeAttribute('aria-busy'); }
          }
          return;
        }
        if (event.target.closest('#settings-logout')) {
          try { await logout(); } catch (error) { showToast('Não foi possível sair agora. Tente novamente.', 'error'); }
          return;
        }
        if (event.target.closest('#settings-avatar-upload')) {
          root.querySelector('#settings-avatar-input')?.click();
          return;
        }
        if (!event.target.closest('#settings-avatar-remove')) return;
        try {
          await saveProfileAvatar('');
          const state = window.__CONTROLY_STATE;
          if (state?.user) {
            state.profile = { ...(state.profile || {}), avatarDataUrl: '' };
            updateUserBadge(state.user, state.profile);
            this.render(state);
          }
          showToast('Foto removida.');
        } catch (error) {
          console.error('Falha ao remover foto de perfil:', error?.code || error?.name || 'unknown', error);
          showToast(avatarUploadErrorMessage(error), 'error');
        }
      });
    },
    render(state) {
      if (!root) return;
      const email = escapeHtml(state.user?.email || 'E-mail indisponível');
      const photo = state.profile?.avatarDataUrl || '';
      const hasPhoto = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(photo) && photo.length <= 75000;
      const name = escapeHtml(state.profile?.displayName || state.user?.displayName || state.user?.email?.split('@')[0] || 'Minha conta');
      root.innerHTML = `
        <div class="section-shell settings-shell">
          <header class="section-head">
            <div><span class="eyebrow">MINHA CONTA</span><h3>Configurações</h3><p>Gerencie seus dados de acesso com tranquilidade.</p></div>
          </header>
          <div class="settings-profile-hero panel">
            <span class="user-avatar settings-avatar">${hasPhoto ? `<img src="${photo}" alt="Sua foto de perfil" />` : `<span>${name.slice(0, 1).toUpperCase()}</span>`}</span>
            <div class="settings-profile-copy"><h4>${name}</h4><p>${email}</p><small>A foto aparece no cabeçalho e na sua conta.</small></div>
            <div class="settings-avatar-actions">
              <input type="file" id="settings-avatar-input" accept="image/jpeg,image/png,image/webp" hidden />
              <button type="button" class="btn btn-primary" id="settings-avatar-upload">Alterar foto</button>
              ${hasPhoto ? '<button type="button" class="btn btn-secondary" id="settings-avatar-remove">Remover</button>' : ''}
            </div>
          </div>
          <div class="settings-grid">
            <section class="panel settings-card">
              <div class="settings-card-title"><i data-lucide="user-round" aria-hidden="true"></i><h4>Informações da conta</h4></div>
              <p class="settings-description">E-mail utilizado para entrar no Controly.</p>
              <div class="settings-account-email">${email}</div>
            </section>
            <section class="panel settings-card">
              <div class="settings-card-title"><i data-lucide="lock-keyhole" aria-hidden="true"></i><h4>Senha e segurança</h4></div>
              <p class="settings-description">Você pode mudar sua senha quando quiser. Ela não precisa ser redefinida a cada acesso.</p>
              <button id="settings-change-password" type="button" class="btn btn-primary">Alterar minha senha</button>
            </section>
          </div>
          <div class="settings-grid settings-commercial-grid">
            <section class="panel settings-card">
              <div class="settings-card-title"><i data-lucide="download" aria-hidden="true"></i><h4>Minha cópia de dados</h4></div>
              <p class="settings-description">Baixe um relatório organizado por áreas, com suas atividades, metas, leituras, treinos, finanças e notas. Abra no navegador ou imprima em PDF.</p>
              <p class="settings-card-help">O arquivo é criado somente quando você solicita. Pode conter informações pessoais e financeiras; guarde-o em local privado.</p>
              <button id="settings-data-export" class="btn btn-primary" type="button">Baixar relatório dos meus dados</button>
            </section>
            <section class="panel settings-card">
              <div class="settings-card-title"><i data-lucide="compass" aria-hidden="true"></i><h4>Comece por aqui</h4></div>
              <p class="settings-description">Organize sua rotina no seu ritmo. Você pode começar com uma atividade e acrescentar outros detalhes depois.</p>
              <div class="settings-onboarding-list">
                <button type="button" data-go-section="activities">Criar uma atividade <i data-lucide="arrow-right" aria-hidden="true"></i></button>
                <button type="button" data-go-section="goals">Definir uma meta <i data-lucide="arrow-right" aria-hidden="true"></i></button>
                <button type="button" data-go-section="reading">Organizar meus livros <i data-lucide="arrow-right" aria-hidden="true"></i></button>
              </div>
            </section>
          </div>
          ${new URLSearchParams(window.location.search).get('admin') === '1' ? `
          <section class="panel settings-card settings-admin-check" aria-label="Verificar acesso administrativo">
            <div class="settings-card-title"><i data-lucide="shield-check" aria-hidden="true"></i><h4>Acesso à Administração VORA</h4></div>
            <p class="settings-description">Verifique se esta conta tem permissão para gerenciar os usuários do Controly.</p>
            <p class="settings-card-help">Identificador da conta conectada (UID):</p>
            <div class="admin-uid-row"><code>${escapeHtml(state.user?.uid || '')}</code><button type="button" class="btn btn-secondary" data-admin-copy-uid>Copiar</button></div>
            <p class="settings-description" data-admin-verification-result role="status">Use Verificar meu acesso para consultar a autorização da conta.</p>
            <div class="settings-legal-links"><button type="button" class="btn btn-primary" data-admin-verify>Verificar meu acesso</button>
              <button type="button" class="btn btn-secondary" data-admin-open data-go-section="admin" hidden>Abrir Administração VORA</button></div>
          </section>` : ''}
          <section class="panel settings-card settings-legal-card" aria-label="Documentos e privacidade">
            <div class="settings-card-title"><i data-lucide="file-check-2" aria-hidden="true"></i><h4>Documentos e privacidade</h4></div>
            <p class="settings-description">Consulte como o Controly funciona e como seus dados pessoais são tratados.</p>
            <div class="settings-legal-links">
              <a class="btn btn-secondary" href="./termos.html" target="_blank" rel="noopener noreferrer">Termos de Uso <i data-lucide="external-link" aria-hidden="true"></i></a>
              <a class="btn btn-secondary" href="./privacidade.html" target="_blank" rel="noopener noreferrer">Política de Privacidade <i data-lucide="external-link" aria-hidden="true"></i></a>
            </div>
          </section>
          <div class="settings-session-actions"><button id="settings-logout" type="button" class="btn btn-secondary">Sair da conta</button></div>
        </div>`;
    },
  };
}
