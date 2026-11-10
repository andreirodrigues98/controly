# Controly 2.0.9

Aplicação de organização pessoal com Firebase Authentication, Firestore, interface Glass e administração VORA por API gratuita em Cloudflare Workers. **Este repositório não contém credenciais privadas.**

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

O painel só aparece quando a API autentica a conta por **UID** (não por e-mail). O Worker publicado anteriormente precisa ser atualizado com o código desta versão antes de habilitar o admin no site.

1. Faça backup das regras atuais no Firebase e confira o ID do projeto (`controly-ec636`).
2. Entre em `worker-admin/wrangler.jsonc`: confirme `FIREBASE_PROJECT_ID` e `ALLOWED_ORIGINS`. Já estão incluídos os dois endereços do Live Server e `https://andreirodrigues98.github.io`. Nunca use `*` como origem.
3. Confirme no Cloudflare que existem os segredos `VORA_ADMIN_UIDS` e `FIREBASE_SERVICE_ACCOUNT_JSON`. Não compartilhe seus valores. O primeiro deve conter o UID **exato** do usuário atualmente conectado, ou uma lista separada por vírgulas de UIDs autorizados.
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
8. Antes de testar suspensão, compare, teste e publique o arquivo único `firestore.rules` em **Firebase Console → Firestore Database → Regras**. A API também verifica a situação da conta ao iniciar a sessão; as regras do Firestore garantem proteção nos acessos diretos aos dados.

**Importante:** o painel lista contas que já possuem perfil na coleção `users` do Firestore. Contas criadas no Authentication que nunca acessaram o Controly podem não aparecer até o primeiro login. A API permite consultar, suspender, reativar e registrar auditoria. Ela não implementa ainda cobrança, criação administrativa de senhas ou gestão completa de assinaturas.

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

`npm run check` verifica imports e estrutura; `npm test` executa testes locais de segurança e da API. **Testes locais não substituem homologação no Firebase e Cloudflare reais.** Não considere o Controly liberado para produção antes dessas verificações.

## Estrutura

- `src/` — módulos, estado, domínio, serviços, interface e administração.
- `worker-admin/` — API segura para Cloudflare Workers; segredos nunca entram no Git.
- `firestore.rules` — única fonte de regras de acesso do Firestore.
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

1. **Regras publicadas do Firestore:** comparar o conteúdo do Console com `firestore.rules`, testar acesso entre contas e negação de contas suspensas usando o emulador. Não substituir as regras ativas sem backup e testes. Na versão atual, contas sem documento em `accountAccess` são tratadas como ativas por compatibilidade; após migrar todas, recomendamos retirar essa exceção para adotar bloqueio por padrão.
2. **App Check:** registrar o domínio em Firebase App Check (reCAPTCHA Enterprise), configurar a chave pública de site por ambiente, acompanhar as métricas e só então ativar enforcement. Antes disso, ativá-lo de imediato pode bloquear clientes legítimos.
3. **Admin:** verificar token, permissões, revogação de acesso e proteção por múltiplos usuários; considerar MFA/2FA para contas administrativas. A revogação imediata de tokens de Authentication ainda exige mecanismo próprio. Não confundir o bloqueio de dados no Firestore com desabilitar o login no Authentication.
4. **Backups:** configurar e testar recuperação real dos documentos em ambiente isolado. Relatório HTML não é backup restaurável.
5. **Segredos e cobrança:** limitar IAM da conta de serviço, restringir criação de novas chaves, fazer rotação se houver exposição, ativar alertas de quota e custos. Auditar dependências e revisar alertas de segurança.
6. **Privacidade e experiência:** confirmar identificação do controlador e contato de privacidade nas páginas legais, testar exportação e solicitações de exclusão, garantir acessibilidade com teclado e celular físico.

A aprovação dos testes automatizados não substitui a homologação com Firebase e Cloudflare reais. Não existe atribuição automática de nota 9,5 nem garantia de lançamento após esta atualização.
