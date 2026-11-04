import { equalSecret } from './security.js'

export function setCors(res, methods = 'GET, POST, OPTIONS') {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  res.setHeader('Access-Control-Allow-Methods', methods)
  res.setHeader('Access-Control-Max-Age', '600')
}

export function handlePreflight(req, res, methods) {
  setCors(res, methods)
  if (req.method !== 'OPTIONS') return false
  res.status(204).end()
  return true
}

export function requireApiKey(req, res, env = process.env) {
  if (!env.GENIE_API_KEY || env.GENIE_API_KEY.length < 32) {
    res.status(503).json({ error: 'Genie API access is not configured' })
    return false
  }
  if (!equalSecret(env.GENIE_API_KEY, req.headers?.authorization?.replace(/^Bearer\s+/i, '') ?? '')) {
    res.status(401).json({ error: 'Unauthorized' })
    return false
  }
  return true
}
