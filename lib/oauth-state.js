import { hashValue, makeOAuthState, readOAuthState } from './security.js'

const STATE_TTL_MS = 10 * 60 * 1000

export async function createSavedState(store, provider, env = process.env, now = Date.now(), context = {}) {
  const state = makeOAuthState(provider, env, now)
  const payload = readOAuthState(state, provider, env, now)
  await store.saveOAuthState(provider, hashValue(payload.nonce), new Date(now + STATE_TTL_MS).toISOString(), context)
  return state
}

export async function consumeSavedState(store, state, provider, env = process.env, now = Date.now()) {
  const payload = readOAuthState(state, provider, env, now)
  if (!payload) return false
  const consumed = await store.consumeOAuthState(provider, hashValue(payload.nonce), new Date(now).toISOString())
  return consumed ? { ...payload, ...consumed.context } : false
}
