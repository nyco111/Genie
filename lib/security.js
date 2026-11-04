import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

function stateSecret(env = process.env) {
  if (!env.OAUTH_STATE_SECRET || env.OAUTH_STATE_SECRET.length < 32) throw new Error('OAuth state signing secret is not configured')
  return env.OAUTH_STATE_SECRET
}

function encryptionKey(env = process.env) {
  const key = env.GENIE_TOKEN_ENCRYPTION_KEY
  if (!/^[0-9a-f]{64}$/i.test(key ?? '')) throw new Error('Token encryption key must be 32-byte hex')
  return Buffer.from(key, 'hex')
}

export function equalSecret(expected, received) {
  if (typeof expected !== 'string' || typeof received !== 'string' || !expected || !received) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(received)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function hashValue(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function makeOAuthState(provider, env = process.env, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ provider, nonce: randomBytes(32).toString('base64url'), iat: now })).toString('base64url')
  const signature = createHmac('sha256', stateSecret(env)).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

export function readOAuthState(state, provider, env = process.env, now = Date.now()) {
  if (typeof state !== 'string') return null
  const [payload, signature, ...extra] = state.split('.')
  if (!payload || !signature || extra.length) return null
  const expected = createHmac('sha256', stateSecret(env)).update(payload).digest()
  let received
  try { received = Buffer.from(signature, 'base64url') } catch { return null }
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (value.provider !== provider || typeof value.nonce !== 'string' || !Number.isFinite(value.iat) || Math.abs(now - value.iat) > 10 * 60 * 1000) return null
    return value
  } catch { return null }
}

export function encryptSecret(value, env = process.env) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(env), iv)
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.')
}

export function decryptSecret(value, env = process.env) {
  const [version, iv, tag, ciphertext, ...extra] = String(value).split('.')
  if (version !== 'v1' || !iv || !tag || ciphertext === undefined || extra.length) throw new Error('Invalid encrypted secret')
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(env), Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8')
}
