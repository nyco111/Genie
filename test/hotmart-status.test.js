import test from 'node:test'
import assert from 'node:assert/strict'
import { createHotmartStatusHandler } from '../lib/hotmart.js'

function response() {
  return { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v }, status(n) { this.statusCode = n; return this }, json(v) { this.body = v; return this }, end() { return this } }
}
const key = 'k'.repeat(48)
const event = { event_type: 'PURCHASE_COMPLETE', product_id: '1234567', received_at: '2026-11-04T12:00:00.000Z' }

test('Hotmart webhook status requires the private Genie API key', async () => {
  let reads = 0
  const handler = createHotmartStatusHandler({ env: { GENIE_API_KEY: key }, store: { getLatestHotmartEvent: async () => { reads++; return event } } })
  const res = response()
  await handler({ method: 'GET', headers: {}, query: {} }, res)
  assert.equal(res.statusCode, 401)
  assert.equal(reads, 0)
})

test('Hotmart webhook status reports only the latest minimized event', async () => {
  const handler = createHotmartStatusHandler({
    env: { GENIE_API_KEY: key, HOTMART_HOTTOK: 'hottok', SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'private' },
    store: { getLatestHotmartEvent: async () => event },
  })
  const res = response()
  await handler({ method: 'GET', headers: { authorization: `Bearer ${key}` }, query: {} }, res)
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, { webhookConfigured: true, latestEvent: event })
  assert.equal(JSON.stringify(res.body).includes('buyer'), false)
})
