import test from 'node:test'
import assert from 'node:assert/strict'
import { createHotmartHandler, insertHotmartEvent, matchesHotmartToken, summarizeHotmartEvent } from '../lib/hotmart.js'

function response() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[name] = value },
    status(code) { this.statusCode = code; return this },
    json(value) { this.body = value; return this },
  }
}

const payload = {
  id: 'evt-123',
  event: 'PURCHASE_APPROVED',
  data: { purchase: { transaction: 'TX-1', buyer: { name: 'must not persist' } }, product: { id: 42 } },
}

test('compares webhook tokens without accepting empty or unequal values', () => {
  assert.equal(matchesHotmartToken('secret', 'secret'), true)
  assert.equal(matchesHotmartToken('secret', 'secreT'), false)
  assert.equal(matchesHotmartToken('secret', 'x'), false)
  assert.equal(matchesHotmartToken('', ''), false)
})

test('summarizes an event without retaining buyer data and creates a stable idempotency key', () => {
  const record = summarizeHotmartEvent(payload, '2026-11-04T12:00:00.000Z')
  assert.equal(record.event_type, 'PURCHASE_APPROVED')
  assert.equal(record.transaction_id, 'TX-1')
  assert.equal(record.product_id, '42')
  assert.equal(record.received_at, '2026-11-04T12:00:00.000Z')
  assert.equal(JSON.stringify(record).includes('must not persist'), false)
  assert.equal(record.event_hash, summarizeHotmartEvent(payload).event_hash)
})

test('accepts authenticated event and records only its summary', async () => {
  const saved = []
  const handler = createHotmartHandler({ secret: 'secret', insertEvent: async row => { saved.push(row); return { duplicate: false } } })
  const res = response()
  await handler({ method: 'POST', headers: { 'x-hotmart-hottok': 'secret' }, body: payload }, res)
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, { received: true, duplicate: false })
  assert.equal(saved.length, 1)
  assert.equal('payload' in saved[0], false)
})

test('rejects unauthenticated requests and does not write them', async () => {
  let writes = 0
  const handler = createHotmartHandler({ secret: 'secret', insertEvent: async () => { writes++ } })
  const res = response()
  await handler({ method: 'POST', headers: { 'x-hotmart-hottok': 'wrong' }, body: payload }, res)
  assert.equal(res.statusCode, 401)
  assert.equal(writes, 0)
})

test('fails closed if configuration or durable event storage is missing', async () => {
  const unconfigured = response()
  await createHotmartHandler({ secret: '', insertEvent: async () => ({}) })({ method: 'POST', headers: {}, body: payload }, unconfigured)
  assert.equal(unconfigured.statusCode, 503)

  const storageFailure = response()
  await createHotmartHandler({ secret: 'secret', insertEvent: async () => { throw Error('db unavailable') } })({ method: 'POST', headers: { 'x-hotmart-hottok': 'secret' }, body: payload }, storageFailure)
  assert.equal(storageFailure.statusCode, 503)
})

test('rejects unsupported methods and malformed events', async () => {
  const handler = createHotmartHandler({ secret: 'secret', insertEvent: async () => ({}) })
  const methodRes = response()
  await handler({ method: 'GET', headers: {}, body: payload }, methodRes)
  assert.equal(methodRes.statusCode, 405)
  assert.equal(methodRes.headers.Allow, 'POST')

  const payloadRes = response()
  await handler({ method: 'POST', headers: { 'x-hotmart-hottok': 'secret' }, body: {} }, payloadRes)
  assert.equal(payloadRes.statusCode, 400)
})

test('persists only the event summary and reports idempotent duplicates', async () => {
  const calls = []
  const env = { SUPABASE_URL: 'https://db.example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-secret' }
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    return { ok: true, json: async () => calls.length === 1 ? [{ event_hash: 'hash' }] : [] }
  }
  const record = summarizeHotmartEvent(payload)
  assert.deepEqual(await insertHotmartEvent(record, env, fetchImpl), { duplicate: false })
  assert.deepEqual(await insertHotmartEvent(record, env, fetchImpl), { duplicate: true })
  assert.equal(new URL(calls[0].url).searchParams.get('on_conflict'), 'event_hash')
  assert.equal(calls[0].init.headers.Prefer, 'resolution=ignore-duplicates,return=representation')
  assert.equal(JSON.parse(calls[0].init.body).transaction_id, 'TX-1')
  assert.equal(calls[0].init.body.includes('must not persist'), false)
  assert.equal(calls[0].init.headers.apikey, env.SUPABASE_SERVICE_ROLE_KEY)
})
