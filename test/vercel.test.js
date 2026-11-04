import test from 'node:test'
import assert from 'node:assert/strict'
import { createVercelCallbackHandler, createVercelProjectsHandler } from '../lib/vercel.js'
import { createOAuthStartHandler } from '../lib/oauth-start.js'
import { createSavedState } from '../lib/oauth-state.js'
import { decryptSecret, encryptSecret } from '../lib/security.js'

const env = {
  OAUTH_STATE_SECRET: 's'.repeat(48),
  GENIE_TOKEN_ENCRYPTION_KEY: 'a'.repeat(64),
  GENIE_API_KEY: 'k'.repeat(48),
  GENIE_BASE_URL: 'https://genie-backend.vercel.app',
  VERCEL_CLIENT_ID: 'client-id',
  VERCEL_CLIENT_SECRET: 'vercel-secret',
  VERCEL_INTEGRATION_SLUG: 'genie-backend',
}
function store() {
  const states = new Map()
  return {
    connections: new Map(),
    async saveOAuthState(provider, hash, expiresAt, context = {}) { states.set(`${provider}:${hash}`, { expiresAt, context }) },
    async consumeOAuthState(provider, hash, now) {
      const key = `${provider}:${hash}`
      const item = states.get(key)
      if (!item || Date.parse(item.expiresAt) <= Date.parse(now)) return null
      states.delete(key)
      return { context: item.context }
    },
    async saveConnection(provider, tokenCiphertext, metadata) { this.connections.set(provider, { token_ciphertext: tokenCiphertext, metadata }) },
    async getConnection(provider) { return this.connections.get(provider) ?? null },
  }
}
function response() {
  return { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v }, status(n) { this.statusCode = n; return this }, end(body = '') { this.body = body; return this }, json(body) { this.body = body; return this } }
}
function jsonResponse(body, ok = true) { return { ok, json: async () => body } }

test('Vercel connection start requires the local Genie API key', async () => {
  const handler = createOAuthStartHandler({ provider: 'vercel', baseUrl: 'https://vercel.com/integrations/genie-backend/new', env, store: store() })
  const res = response()
  await handler({ method: 'POST', headers: {} }, res)
  assert.equal(res.statusCode, 401)
})

test('Vercel callback stores an encrypted token only after the project-read API validates', async () => {
  const db = store()
  const state = await createSavedState(db, 'vercel', env)
  const calls = []
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input)
    calls.push({ url, init })
    if (url.pathname === '/v2/oauth/access_token') return jsonResponse({ access_token: 'vercel-token', team_id: 'team_123', user_id: 'user_abc' })
    return jsonResponse({ projects: [{ id: 'prj_1', name: 'genie-backend', framework: 'node', targets: { production: { alias: ['genie-backend.vercel.app'] } }, updatedAt: 1790000000000 }], pagination: { count: 1, next: null } })
  }
  const res = response()
  await createVercelCallbackHandler({ env, store: db, fetchImpl })({ method: 'GET', query: { code: 'one-time-code', state, teamId: 'team_123', configurationId: 'cfg_1', next: 'https://vercel.com/dashboard' } }, res)
  assert.equal(res.statusCode, 200)
  assert.match(res.body, /Vercel conectada/)
  assert.match(res.body, /1 projetos foram listados e validados/)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].url.searchParams.has('client_secret'), false)
  assert.equal(calls[1].url.pathname, '/v9/projects')
  assert.equal(calls[1].url.searchParams.get('teamId'), 'team_123')
  assert.equal(calls[1].init.headers.Authorization, 'Bearer vercel-token')
  const saved = db.connections.get('vercel')
  assert.deepEqual(JSON.parse(decryptSecret(saved.token_ciphertext, env)), { accessToken: 'vercel-token' })
  assert.equal(saved.metadata.configurationId, 'cfg_1')
})

test('Vercel projects endpoint reports connected only after live project listing', async () => {
  const validStore = { async getConnection() { return { token_ciphertext: encryptSecret(JSON.stringify({ accessToken: 'access' }), env), metadata: { teamId: 'team_123' } } } }
  const fetchImpl = async (input, init) => {
    const url = new URL(input)
    assert.equal(url.searchParams.get('teamId'), 'team_123')
    assert.equal(init.headers.Authorization, 'Bearer access')
    return jsonResponse({ projects: [{ id: 'prj_1', name: 'genie-backend', framework: null, updatedAt: 10 }], pagination: { count: 1, next: null } })
  }
  const res = response()
  await createVercelProjectsHandler({ env, store: validStore, fetchImpl })({ method: 'GET', headers: { authorization: `Bearer ${env.GENIE_API_KEY}` } }, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.connected, true)
  assert.equal(res.body.projects[0].name, 'genie-backend')
})

test('Vercel projects endpoint fails closed on provider errors', async () => {
  const validStore = { async getConnection() { return { token_ciphertext: encryptSecret(JSON.stringify({ accessToken: 'access' }), env), metadata: { teamId: null } } } }
  const res = response()
  await createVercelProjectsHandler({ env, store: validStore, fetchImpl: async () => jsonResponse({}, false) })({ method: 'GET', headers: { authorization: `Bearer ${env.GENIE_API_KEY}` } }, res)
  assert.equal(res.statusCode, 502)
  assert.equal(res.body.connected, false)
})
