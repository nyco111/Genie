import { createHash, randomBytes } from 'node:crypto'
import { encryptSecret, decryptSecret } from './security.js'
import { consumeSavedState, createSavedState } from './oauth-state.js'
import { createGitHubAppJWT, isGenieRepositoryScope, listInstallationRepositories, mintInstallationToken } from './github.js'

const API = 'https://api.github.com'
const VERSION = '2022-11-28'
const TOKEN_URL = 'https://github.com/login/oauth/access_token'

function render(res, title, message, status = 200) {
  const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Referrer-Policy', 'no-referrer')
  return res.status(status).end(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>${escape(title)}</title><main><h1>${escape(title)}</h1><p>${escape(message)}</p><p>Volte ao Genie para continuar.</p></main></html>`)
}

export function createGitHubSetupHandler({ env = process.env, store, now = Date.now }) {
  return async function githubSetupHandler(req, res) {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET')
      return res.status(405).json({ error: 'Method not allowed' })
    }
    const { state, installation_id: id, setup_action: action } = req.query ?? {}
    if (!id || !/^\d+$/.test(String(id)) || !['install', 'update'].includes(action)) {
      return render(res, 'Instalação não concluída', 'O GitHub não retornou uma instalação válida.', 400)
    }
    const initial = await consumeSavedState(store, state, 'github-install', env, now()).catch(() => false)
    if (!initial) return render(res, 'Autorização expirada', 'Inicie novamente a conexão pelo Genie.', 400)
    if (!env.GITHUB_APP_CLIENT_ID || !env.GENIE_BASE_URL) return render(res, 'Configuração incompleta', 'Faltam o Client ID do GitHub App e a URL pública do Genie.', 503)

    try {
      const verifier = randomBytes(32).toString('base64url')
      const stateForOAuth = await createSavedState(store, 'github-oauth', env, now(), {
        installationId: Number(id),
        codeVerifierCiphertext: encryptSecret(verifier, env),
      })
      const authorize = new URL('https://github.com/login/oauth/authorize')
      authorize.searchParams.set('client_id', env.GITHUB_APP_CLIENT_ID)
      authorize.searchParams.set('redirect_uri', `${new URL(env.GENIE_BASE_URL).origin}/api/github/oauth/callback`)
      authorize.searchParams.set('state', stateForOAuth)
      authorize.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'))
      authorize.searchParams.set('code_challenge_method', 'S256')
      res.setHeader('Location', authorize.toString())
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('Referrer-Policy', 'no-referrer')
      return res.status(303).end()
    } catch {
      return render(res, 'Conexão não iniciada', 'Não foi possível iniciar a autorização do GitHub.', 503)
    }
  }
}

export function createGitHubOAuthCallbackHandler({ env = process.env, store, fetchImpl = fetch, now = Date.now }) {
  return async function githubOAuthCallbackHandler(req, res) {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET')
      return res.status(405).json({ error: 'Method not allowed' })
    }
    if (req.query?.error) return render(res, 'GitHub não autorizado', 'A autorização foi cancelada no GitHub.', 400)
    const { code, state } = req.query ?? {}
    if (typeof code !== 'string' || !code) return render(res, 'Autorização inválida', 'O GitHub não retornou um código.', 400)
    const context = await consumeSavedState(store, state, 'github-oauth', env, now()).catch(() => false)
    if (!context || !Number.isSafeInteger(context.installationId) || !context.codeVerifierCiphertext) {
      return render(res, 'Autorização expirada', 'Inicie novamente a conexão pelo Genie.', 400)
    }
    if (!env.GITHUB_APP_CLIENT_ID || !env.GITHUB_APP_CLIENT_SECRET || !env.GENIE_BASE_URL) {
      return render(res, 'Configuração incompleta', 'Faltam credenciais de OAuth do GitHub App.', 503)
    }

    try {
      const redirectUri = `${new URL(env.GENIE_BASE_URL).origin}/api/github/oauth/callback`
      const form = new URLSearchParams({
        client_id: env.GITHUB_APP_CLIENT_ID,
        client_secret: env.GITHUB_APP_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri,
        code_verifier: decryptSecret(context.codeVerifierCiphertext, env),
      })
      const tokenResponse = await fetchImpl(TOKEN_URL, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      })
      if (!tokenResponse.ok) return render(res, 'Conexão não validada', 'O GitHub rejeitou a autorização.', 502)
      const oauth = await tokenResponse.json()
      if (typeof oauth.access_token !== 'string' || !oauth.access_token) return render(res, 'Conexão não validada', 'O GitHub não retornou um token.', 502)

      const userCheck = await fetchImpl(`${API}/user/installations/${context.installationId}/repositories?per_page=1`, {
        headers: { Authorization: `Bearer ${oauth.access_token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': VERSION },
      })
      if (!userCheck.ok) return render(res, 'Instalação não pertence à conta', 'Use a mesma conta GitHub que instalou o Genie App.', 403)

      const appJwt = createGitHubAppJWT(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY, now())
      const installationResponse = await fetchImpl(`${API}/app/installations/${context.installationId}`, {
        headers: { Authorization: `Bearer ${appJwt}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': VERSION },
      })
      if (!installationResponse.ok) return render(res, 'Conexão não validada', 'Não foi possível validar a instalação do GitHub App.', 502)
      const installation = await installationResponse.json()
      if (installation.account?.login !== 'nyco111' || installation.repository_selection !== 'selected') {
        return render(res, 'Escopo não autorizado', 'Instale a GitHub App somente em nyco111/Genie, usando a seleção de repositórios.', 403)
      }

      const installationToken = await mintInstallationToken(context.installationId, { env, fetchImpl, now: now() })
      const listing = await listInstallationRepositories(installationToken, fetchImpl)
      if (!isGenieRepositoryScope(listing)) return render(res, 'Escopo não autorizado', 'Permita somente o repositório nyco111/Genie na GitHub App.', 403)
      await store.saveConnection('github', encryptSecret(JSON.stringify({ installationId: context.installationId }), env), {
        accountLogin: installation.account.login,
        accountType: installation.account.type ?? null,
        repositorySelection: installation.repository_selection ?? null,
        repositoryCount: listing.totalCount,
      })
      return render(res, 'GitHub conectado', `${listing.totalCount} repositórios autorizados foram validados para ${installation.account.login}.`)
    } catch {
      return render(res, 'Conexão não validada', 'A conexão do GitHub não pôde ser validada. Revise a configuração e tente novamente.', 502)
    }
  }
}
