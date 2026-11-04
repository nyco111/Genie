import { createSign } from 'node:crypto'
import { encryptSecret, decryptSecret } from './security.js'
import { consumeSavedState } from './oauth-state.js'
import { handlePreflight, requireApiKey, setCors } from './http.js'

const API = 'https://api.github.com'
const API_VERSION = '2022-11-28'

function base64url(value) {
  return Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url')
}

export function createGitHubAppJWT(appId, privateKey, now = Date.now()) {
  if (!appId || !privateKey) throw new Error('GitHub App credentials are not configured')
  const issued = Math.floor(now / 1000)
  const head = base64url({ alg: 'RS256', typ: 'JWT' })
  const body = base64url({ iat: issued - 30, exp: issued + 8 * 60, iss: appId })
  const data = `${head}.${body}`
  const signer = createSign('RSA-SHA256')
  signer.update(data)
  return `${data}.${signer.sign(privateKey.replace(/\\n/g, '\n')).toString('base64url')}`
}

export async function mintInstallationToken(installationId, { env = process.env, fetchImpl = fetch, now = Date.now() } = {}) {
  const jwt = createGitHubAppJWT(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY, now)
  const response = await fetchImpl(`${API}/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': API_VERSION },
  })
  if (!response.ok) throw new Error('GitHub installation token could not be issued')
  const data = await response.json()
  if (typeof data.token !== 'string' || !data.token) throw new Error('GitHub returned no installation token')
  return data.token
}

export async function listInstallationRepositories(token, fetchImpl = fetch) {
  const repositories = []
  let page = 1
  let total = Infinity
  while (repositories.length < total && page <= 20) {
    const response = await fetchImpl(`${API}/installation/repositories?per_page=100&page=${page}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': API_VERSION },
    })
    if (!response.ok) throw new Error('GitHub repository listing failed')
    const data = await response.json()
    if (!Number.isSafeInteger(data.total_count) || data.total_count < 0 || !Array.isArray(data.repositories)) throw new Error('GitHub returned an invalid repository list')
    total = data.total_count
    if (!data.repositories.length && repositories.length < total) throw new Error('GitHub returned an incomplete repository list')
    repositories.push(...data.repositories)
    page++
  }
  return {
    totalCount: total,
    hasMore: repositories.length < total,
    repositories: repositories.slice(0, 2000).map(repo => ({
      id: repo.id,
      fullName: repo.full_name,
      private: Boolean(repo.private),
      defaultBranch: repo.default_branch ?? null,
      description: repo.description ?? null,
    })),
  }
}

export function isGenieRepositoryScope(listing) {
  return listing.totalCount === 1 && listing.hasMore === false && listing.repositories.length === 1 && listing.repositories[0].fullName === 'nyco111/Genie'
}

function page(res, title, message, status = 200) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Referrer-Policy', 'no-referrer')
  return res.status(status).end(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>${title}</title><main><h1>${title}</h1><p>${message}</p><p>Volte ao Genie para continuar.</p></main></html>`)
}

export function createGitHubSetupHandler({ env = process.env, store, fetchImpl = fetch, now = Date.now }) {
  return async function githubSetupHandler(req, res) {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET')
      return res.status(405).json({ error: 'Method not allowed' })
    }
    const { state, installation_id: installationId, setup_action: setupAction } = req.query ?? {}
    if (!installationId || !/^\d+$/.test(String(installationId)) || !['install', 'update'].includes(setupAction)) {
      return page(res, 'Instalação não concluída', 'O GitHub não retornou uma instalação válida.', 400)
    }
    let payload
    try { payload = await consumeSavedState(store, state, 'github', env, now()) } catch { payload = false }
    if (!payload) return page(res, 'Autorização expirada', 'Inicie novamente a conexão pelo Genie.', 400)

    try {
      const jwt = createGitHubAppJWT(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY, now())
      const headers = { Authorization: `Bearer ${jwt}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': API_VERSION }
      const installationResponse = await fetchImpl(`${API}/app/installations/${installationId}`, { headers })
      if (!installationResponse.ok) return page(res, 'Conexão não validada', 'Não foi possível validar o acesso do GitHub App.', 502)
      const installation = await installationResponse.json()
      const installationToken = await mintInstallationToken(installationId, { env, fetchImpl, now: now() })
      if (!installation.account?.login) return page(res, 'Conexão não validada', 'O GitHub não retornou a instalação esperada.', 502)
      const listing = await listInstallationRepositories(installationToken, fetchImpl)
      await store.saveConnection('github', encryptSecret(JSON.stringify({ installationId: Number(installationId) }), env), {
        accountLogin: installation.account.login,
        accountType: installation.account.type ?? null,
        repositorySelection: installation.repository_selection ?? null,
        repositoryCount: listing.totalCount,
      })
      return page(res, 'GitHub conectado', `${listing.totalCount} repositórios autorizados foram validados para ${installation.account.login}.`)
    } catch {
      return page(res, 'Conexão não validada', 'A conexão do GitHub não pôde ser validada. Revise a configuração e tente novamente.', 502)
    }
  }
}

export function createGitHubRepositoriesHandler({ env = process.env, store, fetchImpl = fetch, now = Date.now }) {
  return async function githubRepositoriesHandler(req, res) {
    if (handlePreflight(req, res, 'GET, OPTIONS')) return
    setCors(res, 'GET, OPTIONS')
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET, OPTIONS')
      return res.status(405).json({ error: 'Method not allowed' })
    }
    if (!requireApiKey(req, res, env)) return
    try {
      const connection = await store.getConnection('github')
      if (!connection) return res.status(200).json({ connected: false, repositories: [] })
      const { installationId } = JSON.parse(decryptSecret(connection.token_ciphertext, env))
      if (!Number.isSafeInteger(installationId) || installationId < 1) throw new Error('Invalid installation')
      const token = await mintInstallationToken(installationId, { env, fetchImpl, now: now() })
      const listing = await listInstallationRepositories(token, fetchImpl)
      if (connection.metadata.accountLogin !== 'nyco111' || !isGenieRepositoryScope(listing)) {
        return res.status(403).json({ connected: false, repositories: [], error: 'GitHub access must be restricted to nyco111/Genie' })
      }
      return res.status(200).json({ connected: true, account: connection.metadata.accountLogin, ...listing })
    } catch {
      return res.status(502).json({ connected: false, error: 'GitHub access could not be validated' })
    }
  }
}
