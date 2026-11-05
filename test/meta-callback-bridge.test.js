import test from 'node:test'
import assert from 'node:assert/strict'
import { createMetaCallbackBridgeHandler } from '../lib/meta-callback-bridge.js'

function response() {
  return { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v }, status(n) { this.statusCode = n; return this }, end(body = '') { this.body = body; return this } }
}

test('Meta callback bridge forwards only authorization response to fixed local callback', () => {
  const res = response()
  createMetaCallbackBridgeHandler()({ method: 'GET', query: { state: 'a'.repeat(32), code: 'one-time-code', attacker: 'https://evil.test' } }, res)
  const url = new URL(res.headers.Location)
  assert.equal(res.statusCode, 303)
  assert.equal(url.origin, 'http://127.0.0.1:3347')
  assert.equal(url.pathname, '/api/meta/callback')
  assert.equal(url.searchParams.get('state'), 'a'.repeat(32))
  assert.equal(url.searchParams.get('code'), 'one-time-code')
  assert.equal(url.searchParams.has('attacker'), false)
  assert.equal(res.headers['Cache-Control'], 'no-store')
})

test('Meta callback bridge refuses invalid state and non-GET requests', () => {
  const handler = createMetaCallbackBridgeHandler()
  const bad = response()
  handler({ method: 'GET', query: { state: 'bad', code: 'code' } }, bad)
  assert.equal(bad.statusCode, 400)
  const method = response()
  handler({ method: 'POST' }, method)
  assert.equal(method.statusCode, 405)
  assert.equal(method.headers.Allow, 'GET')
})
