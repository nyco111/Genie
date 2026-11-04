import { handlePreflight, requireApiKey, setCors } from './http.js'
import { createSavedState } from './oauth-state.js'

export function createOAuthStartHandler({ provider, baseUrl, env = process.env, store }) {
  return async function oauthStartHandler(req, res) {
    if (handlePreflight(req, res, 'POST, OPTIONS')) return
    setCors(res, 'POST, OPTIONS')
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST, OPTIONS')
      return res.status(405).json({ error: 'Method not allowed' })
    }
    if (!requireApiKey(req, res, env)) return
    if (!baseUrl) return res.status(503).json({ error: `${provider} integration is not configured` })
    try {
      const state = await createSavedState(store, provider, env)
      const url = new URL(baseUrl)
      url.searchParams.set('state', state)
      return res.status(200).json({ authorizationUrl: url.toString() })
    } catch {
      return res.status(503).json({ error: 'OAuth could not be started' })
    }
  }
}
