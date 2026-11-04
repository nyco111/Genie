import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import health from '../api/health.js'

test('every deployed API entry point can load without injected test options', async () => {
  const routes = readdirSync(new URL('../api/', import.meta.url), { recursive: true }).filter(file => file.endsWith('.js'))
  assert.ok(routes.length > 0)
  for (const file of routes) {
    const entry = await import(new URL(`../api/${file.replaceAll('\\', '/')}`, import.meta.url))
    assert.equal(typeof entry.default, 'function', file)
  }
})

// No credentials are needed to obtain the first production URL.
test('health works before credentials exist without claiming provider validation', () => {
  const names = readFileSync(new URL('../.env.example', import.meta.url), 'utf8').split('\n').filter(line => /^[A-Z_]+=/.test(line)).map(line => line.split('=')[0])
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]))
  try {
    for (const name of names) delete process.env[name]
    const res = { setHeader() {}, status(n) { this.code = n; return this }, json(body) { this.body = body } }
    health({}, res)
    assert.equal(res.code, 200)
    assert.equal(res.body.service, 'genie-backend')
    assert.equal(res.body.status, 'ok')
    assert.equal(res.body.storage.configured, false)
    for (const state of Object.values(res.body.integrations)) assert.deepEqual(state, { configured: false, validated: false })
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})
