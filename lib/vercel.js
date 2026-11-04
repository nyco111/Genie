import { decryptSecret, encryptSecret } from './security.js'
import { consumeSavedState } from './oauth-state.js'
import { handlePreflight, requireApiKey, setCors } from './http.js'

const API = 'https://api.vercel.com'
const TOKEN_URL = `${API}/v2/oauth/access_token`

function html(res, title, message, status = 200, next) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Referrer-Policy', 'no-referrer')
  const link = next ? `<p><a href="${next}">Voltar à Vercel</a></p>` : '<p>Volte ao Genie para continuar.</p>'
  return res.status(status).end(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>${title}</title><main><h1>${title}</h1><p>${message}</p>${link}</main></html>`)
}

function safeNext(value) {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && (url.hostname === 'vercel.com' || url.hostname.endsWith('.vercel.com')) ? url.toString() : null
  } catch { return null }
}

async function listProjects(token, teamId, fetchImpl, from) {
  const url = new URL(`${API}/v9/projects`)
  url.searchParams.set('limit', '100')
  if (teamId) url.searchParams.set('teamId', teamId)
  if (from) url.searchParams.set('from', from)
  return fetchImpl(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
}

function normalizeProjects(data) {
  return (Array.isArray(data?.projects) ? data.projects : []).map(project => ({
    id: project.id,
    name: project.name,
    framework: project.framework ?? null,
    productionDomain: project.targets?.production?.alias?.[0] ?? null,
    updatedAt: project.updatedAt ?? null,
  }))
}

export function createVercelCallbackHandler({ env = process.env, store, fetchImpl = fetch, now = Date.now }) {
  return async function vercelCallbackHandler(req, res) {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET')
      return res.status(405).json({ error: 'Method not allowed' })
    }
    const next = safeNext(req.query?.next)
    if (req.query?.error) return html(res, 'Vercel não autorizado', 'A autorização foi cancelada na Vercel.', 400, next)
    const { code, state, teamId: queryTeamId, configurationId } = req.query ?? {}
    if (typeof code !== 'string' || !code) return html(res, 'Autorização inválida', 'A Vercel não retornou um código de autorização.', 400, next)
    const payload = await consumeSavedState(store, state, 'vercel', env, now()).catch(() => false)
    if (!payload) return html(res, 'Autorização expirada', 'Inicie novamente a conexão pelo Genie.', 400, next)
    if (!env.VERCEL_CLIENT_ID || !env.VERCEL_CLIENT_SECRET || !env.GENIE_BASE_URL) {
      return html(res, 'Configuração incompleta', 'Faltam as credenciais da integração Vercel.', 503, next)
    }

    try {
      const redirectUri = `${new URL(env.GENIE_BASE_URL).origin}/api/vercel/callback`
      const form = new URLSearchParams({
        client_id: env.VERCEL_CLIENT_ID,
        client_secret: env.VERCEL_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri,
      })
      const tokenResponse = await fetchImpl(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      })
      if (!tokenResponse.ok) return html(res, 'Conexão não validada', 'A Vercel rejeitou a autorização.', 502, next)
      const data = await tokenResponse.json()
      const token = typeof data.access_token === 'string' ? data.access_token : data.token
      if (!token) return html(res, 'Conexão não validada', 'A Vercel não retornou um token de acesso.', 502, next)
      const teamId = data.team_id ?? queryTeamId ?? null
      if (data.team_id && queryTeamId && data.team_id !== queryTeamId) return html(res, 'Conexão não validada', 'A equipe retornada pela Vercel não corresponde à autorização.', 403, next)

      const projectsResponse = await listProjects(token, teamId, fetchImpl)
      if (!projectsResponse.ok) return html(res, 'Acesso a projetos não validado', 'A integração precisa da permissão somente de leitura para projetos.', 403, next)
      const projects = await projectsResponse.json()
      if (!Array.isArray(projects.projects)) return html(res, 'Conexão não validada', 'A resposta da Vercel não contém a lista de projetos esperada.', 502, next)
      await store.saveConnection('vercel', encryptSecret(JSON.stringify({ accessToken: token }), env), {
        teamId,
        userId: data.user_id ?? null,
        configurationId: configurationId ?? null,
        projectCount: projects.projects.length,
      })
      return html(res, 'Vercel conectada', `${projects.projects.length} projetos foram listados e validados.`, 200, next)
    } catch {
      return html(res, 'Conexão não validada', 'A conexão da Vercel não pôde ser validada. Revise a configuração e tente novamente.', 502, next)
    }
  }
}

export function createVercelProjectsHandler({ env = process.env, store, fetchImpl = fetch }) {
  return async function vercelProjectsHandler(req, res) {
    if (handlePreflight(req, res, 'GET, OPTIONS')) return
    setCors(res, 'GET, OPTIONS')
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET, OPTIONS')
      return res.status(405).json({ error: 'Method not allowed' })
    }
    if (!requireApiKey(req, res, env)) return
    try {
      const connection = await store.getConnection('vercel')
      if (!connection) return res.status(200).json({ connected: false, projects: [] })
      const { accessToken } = JSON.parse(decryptSecret(connection.token_ciphertext, env))
      const response = await listProjects(accessToken, connection.metadata.teamId, fetchImpl, req.query?.from)
      if (!response.ok) return res.status(502).json({ connected: false, error: 'Vercel project access could not be validated' })
      const data = await response.json()
      if (!Array.isArray(data.projects)) return res.status(502).json({ connected: false, error: 'Vercel returned an invalid project list' })
      return res.status(200).json({
        connected: true,
        teamId: connection.metadata.teamId,
        projects: normalizeProjects(data),
        pagination: data.pagination ? { next: data.pagination.next ?? null, count: data.pagination.count ?? null } : null,
      })
    } catch {
      return res.status(502).json({ connected: false, error: 'Vercel project access could not be validated' })
    }
  }
}
