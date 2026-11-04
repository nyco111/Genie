# Genie backend

Backend exclusivo de `nyco111/Genie`. Primeiro deploy pelo usuário no time **ny (`ny23`)**, em um projeto Vercel novo. Não modifica outros repositórios, projetos nem webhooks.

## Primeiro deploy no painel

| Campo | Valor |
| --- | --- |
| Git repository | `nyco111/Genie` |
| Production branch | `main` |
| Root Directory | `./` — raiz do repositório, onde está `package.json` |
| Framework Preset | **Other** |
| Build Command | vazio; `vercel.json` já desabilita o build |
| Output Directory | `public`; definido em `vercel.json` |
| Install Command | padrão |

As funções ficam em `api/`; apenas `public/` é servido como conteúdo estático.

Para obter a primeira URL, **nenhuma credencial é obrigatória**: `/api/health` funciona sem configuração e mantém os provedores como não configurados/não validados. Recomendado cadastrar desde já, **somente neste novo projeto**, ambiente **Production**:

- `GENIE_API_KEY`: segredo aleatório de pelo menos 32 caracteres.
- `OAUTH_STATE_SECRET`: outro segredo aleatório independente, de pelo menos 32 caracteres.
- `GENIE_TOKEN_ENCRYPTION_KEY`: chave independente de 32 bytes em **64 caracteres hexadecimais**. Preserve-a para ler os tokens salvos; não faça rotação sem planejar a migração.

Se o banco do Genie já tiver sido escolhido/aprovado, adicione também `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`. O `database/schema.sql` precisa estar aplicado nesse banco para OAuth e webhooks funcionarem. Nenhum SQL é executado automaticamente. Não use o projeto de outro aplicativo e não rode migrações em projetos não aprovados.

Depois do deploy, preencha `GENIE_BASE_URL` com a origem estável de produção confirmada, sem caminho, e cadastre as credenciais/callbacks abaixo. Pode deixar os demais provedores ausentes; não use valores fictícios. Use o domínio de produção, não um preview ou a URL temporária de deployment, e garanta que os provedores consigam acessá-lo sem login da Vercel. Faça **Redeploy** após mudar variáveis: elas não atualizam deployments existentes.

## Current implementation

- `GET /api/github/repositories` performs read-only listing, mints a short-lived installation token, and returns only repositories selected in the GitHub App. The connection is validated against the installing account before it is saved.
- `GET /api/vercel/projects` returns projects only after a live Vercel API read succeeds with the requested project-read permission.
- `GET /api/hotmart/sales` validates API credentials by querying sales summary/history and returns only analytics fields, never buyer contact data.
- `GET /api/hotmart/status` reports whether the webhook and storage are configured and the latest minimized event; it requires `GENIE_API_KEY`.
- `POST /api/webhooks/hotmart` validates `X-HOTMART-HOTTOK`, records a minimized event summary in Supabase, and uses an idempotency hash to avoid duplicate rows.
- `database/schema.sql` creates the event, provider-token, and one-time OAuth-state tables with RLS enabled and no client-role access.
- `npm test` runs offline tests with mocked provider responses; it does not claim live provider connectivity.

The GitHub App install/user-authorization flow, Vercel connectable-integration OAuth flow, and project/repository read routes are prepared for the first publication on `main`. External app registration and real provider validation remain separate steps after the final production domain is confirmed.

## Credentials required (set in Vercel Environment Variables; never send them in chat)

- `GENIE_BASE_URL` — the confirmed production URL, e.g. `https://<project>.vercel.app`.
- `GENIE_API_KEY` — private key for calls from the local Genie plugin.
- `OAUTH_STATE_SECRET` — random signing secret, at least 32 characters.
- `GENIE_TOKEN_ENCRYPTION_KEY` — 32-byte key encoded as 64 hex characters; encrypts stored provider tokens.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — private server-side database access; run `database/schema.sql` once in that Supabase project.
- GitHub App: `GITHUB_APP_SLUG`, `GITHUB_APP_ID`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY`. Set repository permissions to **Metadata: read** and **Contents: read**; choose only the repositories to install.
- Vercel Integration: `VERCEL_INTEGRATION_SLUG`, `VERCEL_CLIENT_ID`, `VERCEL_CLIENT_SECRET`; grant **Projects: Read** only.
- Hotmart webhook: `HOTMART_HOTTOK`.
- Hotmart API: `HOTMART_CLIENT_ID`, `HOTMART_CLIENT_SECRET`, `HOTMART_BASIC_TOKEN`; used by `GET /api/hotmart/sales?start_date=<unix-ms>&end_date=<unix-ms>&product_id=<7-digit-id>`.

After the domain is confirmed, register these exact path suffixes at the providers:

- GitHub App Setup URL: `/api/github/callback`
- GitHub App User Authorization callback: `/api/github/oauth/callback`
- Vercel Integration Redirect URL: `/api/vercel/callback`
- Hotmart webhook URL: `/api/webhooks/hotmart`

For example, with production host `https://<project>.vercel.app`, append each path to that host. Do not register these with a guessed domain.

## Local Hermes plugin bridge

The installed desktop plugin calls these routes through its Python backend (`ctx.rest`); the bearer key is read only from the Hermes process environment and never enters renderer state. In each provider modal, save the deployed Genie `https://<project>.vercel.app` origin. The non-secret URL is stored locally in `plugins/oficina-criativa/dashboard/genie-config.json`. Add the same `GENIE_API_KEY` value used by the Vercel backend to `$HERMES_HOME/.env`, then restart Hermes; never put it in `config.yaml`, plugin storage, or this repository. The modal enables provider actions only when both values are configured.

- GitHub: **Autorizar com GitHub** opens the real GitHub App install flow. On GitHub, choose only `nyco111/Genie`; the plugin reports connected only after the API returns exactly that repository and validates the installation.
- Vercel: **Autorizar com Vercel** opens the integration flow; **Verificar acesso** performs a live read-only project listing.
- Hotmart: **Testar conexão** validates the API credentials with a live sales query and shows the webhook URL. After configuring that URL in Hotmart, the same button reads `GET /api/hotmart/status` to confirm the latest received test event.

## Not yet verified

No provider app has been registered, no live provider credentials have been entered, and no Vercel deployment or Hotmart test event has happened. The real tests still require the intended Vercel account/team, external app registrations, environment variables, and a live Hotmart test webhook.

## Diagnóstico das rotas locais

O plugin visual e o gateway são processos diferentes. Se a rota local `/status` responde, mas `/genie/config` retorna `404`, o gateway ainda mantém a versão antiga de `plugin_api.py` importada. Fechar/reabrir somente a janela pode reutilizar o mesmo gateway.

1. Verifique `hermes plugins show oficina-criativa` e `hermes gateway status`.
2. Se necessário, habilite apenas este plugin: `hermes plugins enable oficina-criativa`.
3. **Depois de as sessões terminarem**, feche a janela, rode `hermes gateway restart --detach` e abra o app. O comando avisa se ainda houver trabalho ativo; não use `--yes`, `--all` ou `--force` para ignorar essa proteção.
4. Sem a URL de deploy/chave, o estado correto é **Backend não configurado**, nunca **Conectado**. Não é necessário modificar o núcleo do Hermes nem outros plugins.

Generate the three backend-only secrets locally (do not paste their output into chat):

```sh
node -e "const c=require('node:crypto'); console.log('GENIE_API_KEY='+c.randomBytes(32).toString('base64url')); console.log('OAUTH_STATE_SECRET='+c.randomBytes(32).toString('base64url')); console.log('GENIE_TOKEN_ENCRYPTION_KEY='+c.randomBytes(32).toString('hex'))"
```
