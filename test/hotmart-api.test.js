import test from 'node:test'
import assert from 'node:assert/strict'
import { createHotmartSalesHandler, normalizeSalesHistory, normalizeSalesSummary } from '../lib/hotmart-api.js'

function response() {
  return { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v }, status(n) { this.statusCode = n; return this }, json(v) { this.body = v; return this } }
}
const env = { GENIE_API_KEY: 'c'.repeat(48), HOTMART_CLIENT_ID: 'id', HOTMART_CLIENT_SECRET: 'secret', HOTMART_BASIC_TOKEN: 'basic' }
const history = { items: [{ purchase: { transaction: 'T-1', status: 'APPROVED', order_date: 1790000000000, price: { value: 19.9, currency_code: 'BRL' }, tracking: { source_sck: 'email' }, buyer: { email: 'private@example.com' } }, product: { id: 1234567, name: 'Oferta' } }] }

test('normalizes history and discards buyer data', () => {
  const result = normalizeSalesHistory(history)
  assert.deepEqual(result[0], { transaction: 'T-1', status: 'APPROVED', orderDate: 1790000000000, productId: '1234567', productName: 'Oferta', source: 'email', amount: 19.9, currency: 'BRL' })
  assert.equal(JSON.stringify(result).includes('private@example.com'), false)
})

test('requires the Genie client key and valid dates before contacting Hotmart', async () => {
  let requests = 0
  const handler = createHotmartSalesHandler({ env, fetchImpl: async () => { requests++; throw Error('unexpected') } })
  const unauthorized = response()
  await handler({ method: 'GET', headers: {}, query: { start_date: '1790000000000', end_date: '1790000000000' } }, unauthorized)
  assert.equal(unauthorized.statusCode, 401)
  const invalid = response()
  await handler({ method: 'GET', headers: { authorization: `Bearer ${env.GENIE_API_KEY}` }, query: { start_date: 'x', end_date: '1790000000000' } }, invalid)
  assert.equal(invalid.statusCode, 400)
  assert.equal(requests, 0)
})

test('validates Hotmart credentials and returns a PII-minimized sales result', async () => {
  const urls = []
  const handler = createHotmartSalesHandler({ env, fetchImpl: async (input, init) => {
    const url = new URL(input)
    urls.push({ url, init })
    if (url.hostname === 'api-sec-vlc.hotmart.com') return { ok: true, json: async () => ({ access_token: 'ephemeral' }) }
    if (url.pathname.endsWith('/summary')) return { ok: true, json: async () => ({ items: [{ total_items: 1, total_value: { value: 19.9, currency_code: 'BRL' } }] }) }
    return { ok: true, json: async () => history }
  } })
  const res = response()
  await handler({ method: 'GET', headers: { authorization: `Bearer ${env.GENIE_API_KEY}` }, query: { start_date: '1790000000000', end_date: '1790000000000', product_id: '1234567', page_token: 'next_1' } }, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.connected, true)
  assert.equal(res.body.sales[0].transaction, 'T-1')
  assert.deepEqual(res.body.summary[0], { totalItems: 1, totalValue: { value: 19.9, currencyCode: 'BRL' } })
  assert.equal(JSON.stringify(res.body).includes('private@example.com'), false)
  assert.equal(urls.length, 3)
  assert.equal(urls[0].init.headers.Authorization, 'Basic basic')
  assert.equal(urls[1].url.searchParams.get('product_id'), '1234567')
  assert.equal(urls[1].url.searchParams.has('page_token'), false)
  assert.equal(urls[2].url.searchParams.get('page_token'), 'next_1')
  assert.equal(urls[2].init.headers.Authorization, 'Bearer ephemeral')
})

test('does not report connected when Hotmart credentials are rejected', async () => {
  const handler = createHotmartSalesHandler({ env, fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }) })
  const res = response()
  await handler({ method: 'GET', headers: { authorization: `Bearer ${env.GENIE_API_KEY}` }, query: { start_date: '1790000000000', end_date: '1790000000000' } }, res)
  assert.equal(res.statusCode, 502)
  assert.notEqual(res.body.connected, true)
})
