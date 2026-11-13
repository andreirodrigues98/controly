# Controly 2.0.14

Aplicação de organização pessoal com Firebase Authentication, Firestore, interface Glass e administração VORA por API gratuita em Cloudflare Workers. **Este repositório não contém credenciais privadas.**

## Ajustes de experiência 2.0.14

- A sessão de estudos iniciada em uma matéria aparece em uma faixa discreta no rodapé, inclusive ao navegar para outras seções. O cronômetro usa o relógio do aparelho para recalcular a duração ao voltar ao aplicativo; a execução contínua em segundo plano pelo iOS não é garantida.
- Ao registrar o tempo durante uma sessão, o aplicativo salva a duração, encerra a sessão e fecha o modal. Pausar uma sessão também registra o trecho já estudado; o botão de registro não duplica esse trecho.
- A exclusão/restauração de registros de estudo atualiza os totais no mesmo processo transacional, reduzindo inconsistências.
- Formulários, campos de data e botões compactos foram ajustados para telas de 320–414 px. No Safari real, confira especialmente a abertura do teclado e o seletor de data.


## Regras do Firestore não ficam no GitHub

O arquivo `firestore.rules` foi removido do projeto público; `.gitignore` ignora arquivos `*.rules` e `*.rules.txt`. `npm run check` e `npm test` **não dependem de regras privadas**. A cópia das regras fornecida separadamente deve permanecer **fora da pasta CONTROLY e fora de qualquer repositório Git**. Não inclua a cópia privada no ZIP que vai para o GitHub.

Para conferir segurança, abra **Firebase Console → Firestore Database → Regras** e faça backup das regras atuais. Teste as regras com o Firebase Emulator Suite em ambiente separado, cobrindo acesso entre usuários, contas suspensas e gravações indevidas. A publicação do frontend não atualiza nem valida essas regras. A remoção das regras da branch principal **não apaga o histórico antigo do GitHub** e **não aumenta a segurança de regras permissivas**.

Se `firestore.rules` já foi enviado em algum commit, o `.gitignore` sozinho não o remove dos arquivos rastreados. Na raiz do projeto, use `git rm --cached --ignore-unmatch firestore.rules` para deixar de rastreá-lo **sem apagar a sua cópia local**. Depois execute `git status --short` e confira a exclusão antes de fazer commit. Guarde a cópia fora da pasta do projeto. **Não rode `git add -f` para regras ou credenciais**.

## Executar com Live Server

1. Faça uma cópia do arquivo `.env.development.example` com o nome `.env.development` e preencha os seis dados **Web** do projeto Firebase. Se já tinha esse arquivo, reutilize sua cópia anterior, fora do Git.
2. Execute na raiz:

```powershell
npm run config:development
npm run check
npm test
```

3. Abra `index.html` por **Open with Live Server**. O app normalmente usa `http://127.0.0.1:5500`.

Nunca copie a chave de conta de serviço (`firebase-admin.json`, `FIREBASE_SERVICE_ACCOUNT_JSON`) para `.env.development` ou `src/`. O arquivo `firebase-config.js` é gerado localmente e ignorado pelo Git.

## Administração VORA — ordem para ativar

O painel só aparece quando a API autentica a conta por **UID** (não por e-mail). Para testar a conta `voracontroly` no site publicado, configure também `CONTROLY_ADMIN_BACKEND_ENABLED=true` em **GitHub → Settings → Secrets and variables → Actions → Variables** e faça um novo deploy. O `.env.development` não altera o GitHub Pages. O Worker publicado anteriormente precisa ser atualizado com o código desta versão antes de habilitar o admin no site.

1. Faça backup das regras atuais no Firebase e confira o ID do projeto (`controly-ec636`).
2. Entre em `worker-admin/wrangler.jsonc`: confirme `FIREBASE_PROJECT_ID` e `ALLOWED_ORIGINS`. Já estão incluídos os dois endereços do Live Server e `https://andreirodrigues98.github.io`. Nunca use `*` como origem.
3. Confirme no Cloudflare que existem os segredos `VORA_ADMIN_UIDS` e `FIREBASE_SERVICE_ACCOUNT_JSON`. Não compartilhe seus valores. O primeiro deve conter o UID **exato** do usuário atualmente conectado, ou uma lista separada por vírgulas de UIDs autorizados.
**Cadastro de usuários (2.0.14):** além desses dois segredos, cadastre uma vez `FIREBASE_WEB_API_KEY` na Cloudflare usando `npx wrangler secret put FIREBASE_WEB_API_KEY` dentro de `worker-admin`. O valor é o `apiKey` da configuração Web do projeto Firebase (não é a chave privada da conta de serviço). No Google Cloud IAM, conceda à **mesma conta de serviço utilizada pelo Worker** o papel `Firebase Authentication Admin` (`roles/firebaseauth.admin`), além do acesso ao Firestore já existente. Essa permissão permite criar identidades; conceda-a somente à conta de serviço restrita a essa API. Não salve a chave no repositório. Confira também que o provedor E-mail/senha está habilitado no Firebase Authentication.

Ao clicar em **Cadastrar e enviar acesso**, o Worker cria a identidade com senha aleatória e envia um e-mail para a pessoa definir a própria senha. A senha não aparece para o administrador. Se o e-mail não for confirmado, a conta ficará em **Aguardando acesso**, sem acesso aos dados, até o envio ser refeito. O botão **Remover acesso** arquiva e bloqueia a conta, **sem excluir seus dados ou sua identidade no Firebase Authentication**; isso permite restaurar o acesso depois. Exclusão definitiva exige um processo separado de retenção, direitos do titular e remoção dos registros relacionados.

4. Atualize a API Cloudflare pelo terminal na raiz do projeto:

```powershell
npm install --prefix worker-admin
npm run admin:deploy
```

5. Faça um teste inicial da API (sem token, resposta **401** é esperada):

```powershell
curl.exe -i -H "Origin: http://127.0.0.1:5500" "https://controly-vora-admin.andreirodrigues1510.workers.dev/v1/me"
```

6. Em `.env.development`, depois que o Worker estiver atualizado, coloque:

```dotenv
CONTROLY_ADMIN_BACKEND_ENABLED=true
CONTROLY_ADMIN_WORKER_URL=https://controly-vora-admin.andreirodrigues1510.workers.dev
```

7. Rode `npm run config:development`. Abra o Live Server, entre novamente na conta autorizada e acesse **Administração VORA** pelo menu. Se não aparecer, abra `http://127.0.0.1:5500/index.html?admin=1`, entre em **Configurações** e pressione **Verificar meu acesso**. Essa tela permite copiar o UID da conta conectada. Se o UID não estiver no segredo `VORA_ADMIN_UIDS`, atualize o segredo com `cd worker-admin` e `npx wrangler secret put VORA_ADMIN_UIDS` (não exponha o valor).
8. Antes de testar suspensão, confira as regras **atualmente publicadas no Firebase Console → Firestore Database → Regras**. Mantenha uma cópia privada fora do repositório e teste com contas diferentes no emulador. A API verifica a situação da conta; as regras efetivamente publicadas protegem o acesso direto ao Firestore.

**Importante:** o painel lista contas que já possuem perfil na coleção `users` do Firestore. Contas criadas no Authentication que nunca acessaram o Controly podem não aparecer até o primeiro login. A API permite cadastrar usuários, enviar e reenviar um e-mail para definição da senha, consultar contas, suspender, reativar, remover o acesso (arquivamento reversível) e registrar auditoria. Não existe exclusão permanente automática, cobrança nem gestão de assinaturas nesta versão.

## Publicação no GitHub Pages

O workflow `.github/workflows/deploy-pages.yml` gera `dist/` e publica apenas os arquivos públicos. Adicione no GitHub **Settings → Secrets and variables → Actions → Secrets** os seis valores Web: `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`, `FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_APP_ID`.

Depois de atualizar o Worker e as regras, crie as **Variables** do repositório:

| Variable | Valor |
|---|---|
| `CONTROLY_ADMIN_BACKEND_ENABLED` | `true` |
| `CONTROLY_ADMIN_WORKER_URL` | `https://controly-vora-admin.andreirodrigues1510.workers.dev` |

Para continuar sem admin no site publicado, deixe `CONTROLY_ADMIN_BACKEND_ENABLED=false` (padrão seguro). O Pages usa a origem `https://andreirodrigues98.github.io`, que precisa estar incluída no Worker publicado.

No GitHub: **Settings → Pages → Source: GitHub Actions**. Depois faça `git push origin main` e confira a execução em **Actions**. O endereço previsto é `https://andreirodrigues98.github.io/controly/`.

## Testes de aceitação antes do lançamento

- Conta administradora autorizada enxerga o painel; conta comum não consegue acessar os endpoints `/v1/accounts` e `/v1/audit`.
- Suspender uma **conta fictícia de teste** bloqueia as próximas leituras/gravações, sem apagar seus dados; reativá-la restitui o acesso. Confirme inclusive em outra aba com sessão aberta.
- A própria conta administradora não pode ser suspensa; cada alteração gera registro de auditoria.
- Confirme gravação de foto de perfil, atividades, metas, leitura, pagamentos, notas, exportação e recuperação de senha em desktop, tablet e celular.
- Execute backup **restaurável** do banco e teste a restauração em ambiente isolado. O relatório HTML do usuário **não é** um backup restaurável.
- Revise App Check, limites de uso, permissões IAM, política de privacidade, canal de contato, termos comerciais e retenção de dados antes de aceitar clientes pagantes.

`npm run check` verifica imports e estrutura; `npm test` executa testes locais da API e do frontend. Nenhum deles comprova a segurança das regras privadas do Firestore. **Testes locais não substituem homologação no Firebase e Cloudflare reais.** Não considere o Controly liberado para produção antes dessas verificações.

## Estrutura

- `src/` — módulos, estado, domínio, serviços, interface e administração.
- `worker-admin/` — API segura para Cloudflare Workers; segredos nunca entram no Git.
- **Regras Firestore:** armazenadas e gerenciadas separadamente no Firebase Console e em backup privado, **não neste repositório**.
- `scripts/` — verificação, geração de config e build público.
- `.github/workflows/` — publicação GitHub Pages.
- `termos.html` e `privacidade.html` — páginas públicas; revisão jurídica final necessária.

Apenas `README.md` é usado como documentação Markdown no projeto.

## Quadros no celular

Em **Finanças**, os cartões exibem somente o nome por padrão: toque no nome para abrir os detalhes, valor e ações. Arraste pela alça ao lado do nome para mover entre as colunas. Durante o movimento, o quadro acompanha o dedo horizontalmente e continua rolando ao manter o dedo próximo à borda. Uma operação financeira ainda exige confirmação e não permite converter despesa em receita pelo arrasto. O mesmo movimento assistido atende ao quadro de **Leitura**.

## Refinamentos 2.0.9

O Painel oferece atalhos para criar atividades, metas, notas e lançamentos sem procurar o módulo primeiro. Preferências dos blocos do painel são armazenadas separadamente por **conta, projeto e ambiente** no navegador. Em Configurações, as orientações repetidas foram substituídas por ações de proteção de conta.

O Worker passou a rejeitar operações administrativas de contas suspensas, limita o tamanho **real** das solicitações JSON e inclui cabeçalhos de proteção adicionais. Para usar esse backend atualizado é preciso publicar novamente, na raiz do projeto: `npm run admin:deploy`. O GitHub Actions executa os testes locais antes da publicação.

### Pendências de segurança a validar antes da comercialização

1. **Regras publicadas do Firestore:** fazer backup fora do repositório, testar o isolamento entre contas e a negação de contas suspensas no emulador. Não substituir as regras ativas sem testes e plano de reversão. A cópia privada disponibilizada separadamente nesta entrega permite migração, mas **não confirma** que seja idêntica às regras ativas no Firebase; compare antes de qualquer publicação. Contas sem documento em `accountAccess` podem continuar ativas por compatibilidade, o que deve ser revisto antes do lançamento.
2. **App Check:** registrar o domínio em Firebase App Check (reCAPTCHA Enterprise), configurar a chave pública de site por ambiente, acompanhar as métricas e só então ativar enforcement. Antes disso, ativá-lo de imediato pode bloquear clientes legítimos.
3. **Admin:** verificar token, permissões, revogação de acesso e proteção por múltiplos usuários; considerar MFA/2FA para contas administrativas. A revogação imediata de tokens de Authentication ainda exige mecanismo próprio. Não confundir o bloqueio de dados no Firestore com desabilitar o login no Authentication.
4. **Backups:** configurar e testar recuperação real dos documentos em ambiente isolado. Relatório HTML não é backup restaurável.
5. **Segredos e cobrança:** limitar IAM da conta de serviço, restringir criação de novas chaves, fazer rotação se houver exposição, ativar alertas de quota e custos. Auditar dependências e revisar alertas de segurança.
6. **Privacidade e experiência:** confirmar identificação do controlador e contato de privacidade nas páginas legais, testar exportação e solicitações de exclusão, garantir acessibilidade com teclado e celular físico.

A aprovação dos testes automatizados não substitui a homologação com Firebase e Cloudflare reais. Não existe atribuição automática de nota 9,5 nem garantia de lançamento após esta atualização.

## Inicialização em celulares (2.0.10)
O carregamento possui recuperação após 18 segundos, sem mostrar dados internos ao usuário. A biblioteca de ícones é assíncrona e o Worker administrativo tem tempo máximo de espera. Não são necessárias mudanças nas regras Firestore. Se um aparelho não carregar, testar também em aba privada e verificar no navegador os erros de rede; o fallback não é uma confirmação de causa única.

## Publicação e diagnóstico

O GitHub Pages deve estar em **Settings → Pages → Build and deployment → Source: GitHub Actions**. Publicar diretamente de `main/(root)` não funciona, pois `firebase-config.js` é ignorado pelo Git e gerado exclusivamente em `dist/` pelo build. Após `npm run build:production`, execute `npm run verify:pages` para verificar o artefato antes de publicar. O workflow executa essa verificação automaticamente.

Se aparecer carregamento preso com erro HTTP 404 em `firebase-config.js`, confirme a origem GitHub Actions e abra `https://andreirodrigues98.github.io/controly/firebase-config.js` no navegador. O arquivo deve existir no site publicado, mesmo sem existir no repositório. Não adicione credenciais privadas nem force a inclusão do arquivo gerado no Git.
