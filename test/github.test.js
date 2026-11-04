import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, createVerify } from 'node:crypto'
import { createGitHubAppJWT, createGitHubRepositoriesHandler } from '../lib/github.js'
import { createGitHubOAuthCallbackHandler, createGitHubSetupHandler } from '../lib/github-flow.js'
import { createSavedState } from '../lib/oauth-state.js'
import { decryptSecret, encryptSecret } from '../lib/security.js'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const env = {
  OAUTH_STATE_SECRET: 's'.repeat(48),
  GENIE_TOKEN_ENCRYPTION_KEY: 'a'.repeat(64),
  GENIE_BASE_URL: 'https://genie-backend.vercel.app',
  GITHUB_APP_ID: '12345',
  GITHUB_APP_CLIENT_ID: 'Iv1.test',
  GITHUB_APP_CLIENT_SECRET: 'github-secret',
  GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }),
}

function createStore() {
  const states = new Map()
  return {
    connections: new Map(),
    async saveOAuthState(provider, stateHash, expiresAt, context = {}) { states.set(`${provider}:${stateHash}`, { expiresAt, context }) },
    async consumeOAuthState(provider, stateHash, now) {
      const key = `${provider}:${stateHash}`
      const record = states.get(key)
      if (!record || Date.parse(record.expiresAt) <= Date.parse(now)) return null
      states.delete(key)
      return { context: record.context }
    },
    async saveConnection(provider, tokenCiphertext, metadata) { this.connections.set(provider, { token_ciphertext: tokenCiphertext, metadata }) },
    async getConnection(provider) { return this.connections.get(provider) ?? null },
  }
}

function response() {
  return { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v }, status(n) { this.statusCode = n; return this }, end(body = '') { this.body = body; return this }, json(body) { this.body = body; return this } }
}
function jsonResponse(body, ok = true) { return { ok, json: async () => body } }

test('GitHub App JWT is RS256-signed and expires within ten minutes', () => {
  const jwt = createGitHubAppJWT(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY, 1_800_000_000_000)
  const [header, payload, signature] = jwt.split('.')
  const verifier = createVerify('RSA-SHA256')
  verifier.update(`${header}.${payload}`)
  assert.equal(verifier.verify(publicKey, Buffer.from(signature, 'base64url')), true)
  assert.equal(JSON.parse(Buffer.from(header, 'base64url')).alg, 'RS256')
  assert.equal(JSON.parse(Buffer.from(payload, 'base64url')).iss, env.GITHUB_APP_ID)
})

test('installation callback starts PKCE OAuth and does not expose its verifier in the URL', async () => {
  const store = createStore()
  const state = await createSavedState(store, 'github-install', env)
  const res = response()
  await createGitHubSetupHandler({ env, store })({ method: 'GET', query: { state, installation_id: '789', setup_action: 'install' } }, res)
  assert.equal(res.statusCode, 303)
  const url = new URL(res.headers.Location)
  assert.equal(url.origin, 'https://github.com')
  assert.equal(url.pathname, '/login/oauth/authorize')
  assert.equal(url.searchParams.get('redirect_uri'), `${env.GENIE_BASE_URL}/api/github/oauth/callback`)
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  assert.ok(url.searchParams.get('code_challenge'))
  assert.equal(url.searchParams.has('code_verifier'), false)
})

test('OAuth callback verifies the installation belongs to the signed-in account before connecting', async () => {
  const store = createStore()
  const verifier = 'one-time-pkce-verifier'
  const state = await createSavedState(store, 'github-oauth', env, Date.now(), {
    installationId: 789,
    codeVerifierCiphertext: encryptSecret(verifier, env),
  })
  const calls = []
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input)
    calls.push({ url, init })
    if (url.hostname === 'github.com') {
      assert.equal(new URLSearchParams(init.body).get('code_verifier'), verifier)
      return jsonResponse({ access_token: 'user-token' })
    }
    if (url.pathname === '/user/installations/789/repositories') return jsonResponse({ repositories: [] })
    if (url.pathname === '/app/installations/789') return jsonResponse({ account: { login: 'nyco111', type: 'User' }, repository_selection: 'selected' })
    if (url.pathname === '/app/installations/789/access_tokens') return jsonResponse({ token: 'installation-token' })
    if (url.pathname === '/installation/repositories') return jsonResponse({ total_count: 1, repositories: [{ id: 17, full_name: 'nyco111/Genie', private: true, default_branch: 'main' }] })
    throw Error(`unexpected request ${url}`)
  }
  const res = response()
  await createGitHubOAuthCallbackHandler({ env, store, fetchImpl })({ method: 'GET', query: { state, code: 'one-time-code' } }, res)
  assert.equal(res.statusCode, 200)
  assert.match(res.body, /GitHub conectado/)
  assert.match(res.body, /1 repositórios autorizados/)
  const connection = store.connections.get('github')
  assert.equal(connection.metadata.accountLogin, 'nyco111')
  assert.deepEqual(JSON.parse(decryptSecret(connection.token_ciphertext, env)), { installationId: 789 })
  assert.equal(calls.length, 5)
})

test('OAuth callback refuses an installation that includes another repository', async () => {
  const store = createStore()
  const state = await createSavedState(store, 'github-oauth', env, Date.now(), {
    installationId: 789,
    codeVerifierCiphertext: encryptSecret('verifier', env),
  })
  const fetchImpl = async input => {
    const url = new URL(input)
    if (url.hostname === 'github.com') return jsonResponse({ access_token: 'user-token' })
    if (url.pathname === '/user/installations/789/repositories') return jsonResponse({ repositories: [] })
    if (url.pathname === '/app/installations/789') return jsonResponse({ account: { login: 'nyco111' }, repository_selection: 'selected' })
    if (url.pathname === '/app/installations/789/access_tokens') return jsonResponse({ token: 'installation-token' })
    if (url.pathname === '/installation/repositories') return jsonResponse({ total_count: 2, repositories: [{ full_name: 'nyco111/Genie' }, { full_name: 'nyco111/unrelated' }] })
    throw Error(`unexpected request ${url}`)
  }
  const res = response()
  await createGitHubOAuthCallbackHandler({ env, store, fetchImpl })({ method: 'GET', query: { state, code: 'code' } }, res)
  assert.equal(res.statusCode, 403)
  assert.equal(store.connections.size, 0)
})

test('repository validation rejects expanded or invalid scope and accepts only Genie', async () => {
  const key = 'k'.repeat(48)
  const store = createStore()
  await store.saveConnection('github', encryptSecret(JSON.stringify({ installationId: 789 }), env), { accountLogin: 'nyco111' })
  for (const [listing, expectedStatus] of [
    [{ total_count: 2, repositories: [{ full_name: 'nyco111/Genie' }, { full_name: 'nyco111/unrelated' }] }, 403],
    [{ total_count: 0, repositories: [] }, 403],
    [{}, 502],
    [{ total_count: 1, repositories: [{ full_name: 'nyco111/Genie' }] }, 200],
  ]) {
    const res = response()
    const fetchImpl = async input => new URL(input).pathname.endsWith('/access_tokens') ? jsonResponse({ token: 'installation-token' }) : jsonResponse(listing)
    await createGitHubRepositoriesHandler({ env: { ...env, GENIE_API_KEY: key }, store, fetchImpl })({ method: 'GET', headers: { authorization: `Bearer ${key}` } }, res)
    assert.equal(res.statusCode, expectedStatus, JSON.stringify(listing))
    assert.equal(res.body.connected, expectedStatus === 200)
    if (expectedStatus !== 200) assert.equal(res.body.repositories?.length ?? 0, 0)
  }
})

test('OAuth callback refuses an installation not visible to the GitHub user', async () => {
  const store = createStore()
  const state = await createSavedState(store, 'github-oauth', env, Date.now(), {
    installationId: 789,
    codeVerifierCiphertext: encryptSecret('verifier', env),
  })
  const fetchImpl = async input => {
    const url = new URL(input)
    if (url.hostname === 'github.com') return jsonResponse({ access_token: 'user-token' })
    return jsonResponse({}, false)
  }
  const res = response()
  await createGitHubOAuthCallbackHandler({ env, store, fetchImpl })({ method: 'GET', query: { state, code: 'code' } }, res)
  assert.equal(res.statusCode, 403)
  assert.equal(store.connections.size, 0)
})
