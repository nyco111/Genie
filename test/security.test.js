import test from 'node:test'
import assert from 'node:assert/strict'
import { createSavedState, consumeSavedState } from '../lib/oauth-state.js'
import { decryptSecret, encryptSecret, equalSecret, makeOAuthState, readOAuthState } from '../lib/security.js'
import { requireApiKey } from '../lib/http.js'

const env = { OAUTH_STATE_SECRET: 's'.repeat(48), GENIE_TOKEN_ENCRYPTION_KEY: 'b'.repeat(64), GENIE_API_KEY: 'g'.repeat(48) }

test('OAuth state is signed, provider-bound, and expires', () => {
  const state = makeOAuthState('vercel', env, 1_800_000_000_000)
  assert.ok(readOAuthState(state, 'vercel', env, 1_800_000_100_000))
  assert.equal(readOAuthState(state, 'github', env, 1_800_000_100_000), null)
  assert.equal(readOAuthState(`${state}x`, 'vercel', env, 1_800_000_100_000), null)
  assert.equal(readOAuthState(state, 'vercel', env, 1_800_001_000_000), null)
})

test('OAuth state can be consumed only once', async () => {
  const rows = new Map()
  const store = {
    async saveOAuthState(provider, hash, expiresAt, context) { rows.set(`${provider}:${hash}`, { expiresAt, context }) },
    async consumeOAuthState(provider, hash, now) {
      const key = `${provider}:${hash}`
      const row = rows.get(key)
      if (!row || Date.parse(row.expiresAt) <= Date.parse(now)) return null
      rows.delete(key)
      return { context: row.context }
    },
  }
  const state = await createSavedState(store, 'github-install', env)
  assert.ok(await consumeSavedState(store, state, 'github-install', env))
  assert.equal(await consumeSavedState(store, state, 'github-install', env), false)
})

test('provider tokens encrypt and decrypt with authenticated integrity', () => {
  const ciphertext = encryptSecret('private-provider-token', env)
  assert.equal(ciphertext.includes('private-provider-token'), false)
  assert.equal(decryptSecret(ciphertext, env), 'private-provider-token')
  assert.throws(() => decryptSecret(`${ciphertext}x`, env))
  assert.throws(() => decryptSecret(ciphertext, { ...env, GENIE_TOKEN_ENCRYPTION_KEY: 'c'.repeat(64) }))
})

test('API key checks require a long, exact bearer secret', () => {
  const result = () => {
    const res = { statusCode: 200, status(n) { this.statusCode = n; return this }, json() { return this } }
    return { res, ok: requireApiKey({ headers: { authorization: `Bearer ${env.GENIE_API_KEY}` } }, res, env) }
  }
  assert.equal(result().ok, true)
  const shortRes = { statusCode: 200, status(n) { this.statusCode = n; return this }, json() { return this } }
  assert.equal(requireApiKey({ headers: { authorization: 'Bearer short' } }, shortRes, { GENIE_API_KEY: 'short' }), false)
  assert.equal(shortRes.statusCode, 503)
})

test('secret comparisons reject empty and unequal values', () => {
  assert.equal(equalSecret('same', 'same'), true)
  assert.equal(equalSecret('', ''), false)
  assert.equal(equalSecret('same', 'different'), false)
})
