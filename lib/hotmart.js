import { createHash, timingSafeEqual } from 'node:crypto'
import { handlePreflight, requireApiKey, setCors } from './http.js'

export function matchesHotmartToken(expected, received) {
  if (typeof expected !== 'string' || typeof received !== 'string' || !expected || !received) return false
  const left = Buffer.from(expected, 'utf8')
  const right = Buffer.from(received, 'utf8')
  return left.length === right.length && timingSafeEqual(left, right)
}

export function summarizeHotmartEvent(body, receivedAt = new Date().toISOString()) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.event !== 'string' || !body.event.trim()) {
    throw new TypeError('Invalid Hotmart event')
  }

  const purchase = body.data?.purchase ?? {}
  const product = body.data?.product ?? {}
  const sourceId = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : JSON.stringify(body)
  const eventId = createHash('sha256').update(`${body.event}\n${sourceId}`).digest('hex')

  return {
    event_hash: eventId,
    event_type: body.event.slice(0, 120),
    transaction_id: typeof purchase.transaction === 'string' ? purchase.transaction.slice(0, 160) : null,
    product_id: product.id == null ? null : String(product.id).slice(0, 160),
    received_at: receivedAt,
  }
}

export async function insertHotmartEvent(record, env = process.env, fetchImpl = fetch) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Event storage is not configured')
  const response = await fetchImpl(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/hotmart_events?on_conflict=event_hash`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=representation',
    },
    body: JSON.stringify(record),
  })
  if (!response.ok) throw new Error(`Event storage failed (${response.status})`)
  const inserted = await response.json()
  return { duplicate: inserted.length === 0 }
}

export function createHotmartHandler({ secret, insertEvent }) {
  return async function hotmartHandler(req, res) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      return res.status(405).json({ error: 'Method not allowed' })
    }
    if (!secret || typeof insertEvent !== 'function') return res.status(503).json({ error: 'Hotmart webhook is not configured' })
    if (!matchesHotmartToken(secret, req.headers?.['x-hotmart-hottok'])) return res.status(401).json({ error: 'Invalid webhook token' })

    let record
    try {
      record = summarizeHotmartEvent(req.body)
    } catch {
      return res.status(400).json({ error: 'Invalid Hotmart event payload' })
    }
    try {
      const result = await insertEvent(record)
      return res.status(200).json({ received: true, duplicate: Boolean(result?.duplicate) })
    } catch {
      return res.status(503).json({ error: 'Event could not be recorded' })
    }
  }
}

export function createHotmartStatusHandler({ env = process.env, store }) {
  return async function hotmartStatusHandler(req, res) {
    if (handlePreflight(req, res, 'GET, OPTIONS')) return
    setCors(res, 'GET, OPTIONS')
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET, OPTIONS')
      return res.status(405).json({ error: 'Method not allowed' })
    }
    if (!requireApiKey(req, res, env)) return
    try {
      const latestEvent = await store.getLatestHotmartEvent()
      return res.status(200).json({
        webhookConfigured: Boolean(env.HOTMART_HOTTOK && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY),
        latestEvent,
      })
    } catch {
      return res.status(503).json({ error: 'Hotmart webhook status is unavailable' })
    }
  }
}
