# Controly

## Termos de Uso e Política de Privacidade — versão 2.0.6

As páginas públicas `termos.html` e `privacidade.html` ficam na raiz e são copiadas automaticamente para o GitHub Pages. Elas podem ser abertas sem login e possuem links no login e em Configurações. O CSS dessas páginas é `src/styles/legal.css`.

**Revisão jurídica antes da comercialização:** os textos públicos usam linguagem voltada ao usuário e não descrevem a implementação interna. Confirmar a identificação formal do responsável pelo serviço, canal específico de privacidade, prazos e bases legais, transferências internacionais e condições comerciais. Uma revisão jurídica é necessária antes de disponibilizar a clientes reais.


Aplicativo web de organização pessoal (rotina, estudos, leitura, treinos, finanças, metas e notas). Interface com Firebase Authentication e Firestore; administração opcional pelo Cloudflare Worker. Esta é uma **distribuição de código limpa**, não uma homologação de segurança/lançamento.

## Executar no VS Code (Live Server)

1. Abra esta pasta no VS Code.
2. Copie `.env.development.example` para `.env.development` e preencha com o `firebaseConfig` **web** do seu projeto Firebase. Se já tinha esse arquivo, copie-o da versão anterior; não envie ao GitHub.
3. No terminal da raiz do projeto, execute `npm run config:development` e depois `npm run check`.
4. Clique em `index.html` → **Open with Live Server** (`http://127.0.0.1:5500`). Use Ctrl+Shift+R depois de trocar de versão.

`firebase-config.js` é gerado localmente, não deve ser versionado. O Firebase Web config é **público por natureza**; jamais use nesse arquivo uma credencial de **conta de serviço**, chave privada ou `FIREBASE_SERVICE_ACCOUNT_JSON`.

## Administração VORA (Cloudflare Workers)

O código da API fica em `worker-admin/src/index.js`; a configuração **pública** fica em `worker-admin/wrangler.jsonc`. O Worker `controly-vora-admin` foi preparado para o Firebase `controly-ec636`. Confirme o projeto antes de alterar ou publicar.

Os segredos `VORA_ADMIN_UIDS` e `FIREBASE_SERVICE_ACCOUNT_JSON` devem estar **somente no painel de segredos da Cloudflare** — nunca neste repositório. O Worker já implantado mantém seus segredos ao receber uma atualização de código.

Para republicar **quando necessário**, estando na raiz do projeto:

```powershell
cd worker-admin
npm install
npx wrangler deploy
```

Para habilitar o painel no Live Server, use no `.env.development`:

```dotenv
CONTROLY_ADMIN_BACKEND_ENABLED=true
CONTROLY_ADMIN_WORKER_URL=https://controly-vora-admin.andreirodrigues1510.workers.dev
```

Regere `firebase-config.js` com `npm run config:development`, faça login novamente e teste com um administrador e uma conta comum. O Worker só responde a origens em `ALLOWED_ORIGINS` e verifica assinatura do token Firebase e UID autorizado. Para o site no GitHub Pages, adicione **a origem exata** do site em `ALLOWED_ORIGINS`, salve e republique o Worker; não use `*`.

## Regras de acesso do Firestore — único arquivo

`firestore.rules` é o **único conjunto de regras** neste projeto. Ele restringe os dados por usuário, valida a foto e consulta `accountAccess/{uid}` para suspensões. Contas sem registro de status permanecem ativas durante migração; confirme se isso é adequado antes de aceitar clientes reais.

**Para revisar e aplicar**: Firebase Console → Firestore Database → Regras → faça uma cópia do conteúdo existente → compare → cole `firestore.rules` → publique **somente depois de testar em desenvolvimento**. A conta de serviço do Worker usa permissões Google Cloud/Firestore e não é protegida pelas regras do SDK cliente; limite seu papel ao necessário.

## Publicação no GitHub Pages

A workflow `.github/workflows/deploy-pages.yml` publica apenas a pasta `dist/`, gerada pelo script `npm run build:production`. O build exige os seguintes GitHub **Secrets**: `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`, `FIREBASE_MESSAGING_SENDER_ID` e `FIREBASE_APP_ID`. Para admin e App Check, use as GitHub **Variables** `CONTROLY_ADMIN_BACKEND_ENABLED`, `CONTROLY_ADMIN_WORKER_URL` e `CONTROLY_APPCHECK_SITE_KEY`, conforme o ambiente.

Antes de dar `git add`, confira que **não** há `.env.development`, `firebase-config.js` local, chave de serviço `.json`, arquivos exportados ou backups entre os arquivos rastreados:

```powershell
git status --short
git ls-files | Select-String -Pattern 'firebase-config|\.env|service|credencial|\.pem|\.p12'
```

Se uma chave privada já tiver sido commitada alguma vez, **revogue-a e gere outra**; `.gitignore` não apaga histórico de Git.

Para testar o pacote público com variáveis configuradas no ambiente, execute `npm run build:production`. O diretório `dist/` e as credenciais locais não são incluídos no Git.

## Estrutura necessária

- `src/modules/`, `src/features/`, `src/services/`, `src/admin/`, `src/ui/`, `src/security/`: interface e regras do aplicativo.
- `src/styles/app.css`: estilos consolidados mantendo a ordem anterior; `styles.css` é o ponto de entrada.
- `worker-admin/`: API administrativa com autorização e rate limiting.
- `scripts/`: geração de configuração, verificação e build; `.github/`: publicação.
- `firestore.rules`: regras para o SDK cliente; `img/`, `manifest.json`: imagens e instalação web.

## Antes de vender

Validar regras **publicadas** no Firebase, suspensões com duas contas, App Check, gravação de foto, leituras/custos, backups com restauração, revisão jurídica, acessibilidade e testes móveis com dados reais. O Worker foi implantado, mas isso não substitui homologação do Controly.

## Se a pasta .github não aparecer no VS Code

A pasta `.github/workflows/deploy-pages.yml` está incluída neste pacote. Ela começa com ponto, mas não pode ser omitida na publicação. Confira na raiz do projeto:

```powershell
Test-Path .github\workflows\deploy-pages.yml
git status --short
git ls-files .github/workflows/deploy-pages.yml
```

Se o último comando não retornar caminho, faça `git add .github/workflows/deploy-pages.yml` e inclua o arquivo no commit. Em **GitHub → Settings → Pages**, selecione **GitHub Actions** como origem.

O workflow valida a presença dos seis Secrets do Firebase **sem imprimir seus valores**. Se algum faltar, o log identificará o nome da configuração ausente.
