/**
 * Route tests.
 *
 * The route is the one place where this plugin answers a network request, so
 * the guard and the response shape are pinned here rather than trusted.
 *
 * @module dsh-token-ledger/test/route.test
 */

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'

import {
  OVERVIEW_PATH,
  RATES_PATH,
  createOverviewRoute,
  createRatesRoute,
  isAllowedPeer,
  isLocalOrigin,
  isLoopbackAddress,
} from '../lib/route.js'

/**
 * A stand-in ledger.
 *
 * @param {() => object} snapshot - the snapshot producer.
 * @returns {{ snapshot: () => object }} the ledger.
 */
function fakeLedger(snapshot) {
  return { snapshot }
}

/** A minimal snapshot with one day of usage. */
function snapshot() {
  const now = Date.now()
  const date = new Date(now)
  const pad = (value) => String(value).padStart(2, '0')
  const key = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return {
    version: 3,
    updatedAt: now,
    totals: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 0, totalTokens: 6, reasoningTokens: 0, calls: 1 },
    daily: [{ date: key, calls: 1, inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 0, totalTokens: 6, reasoningTokens: 0 }],
    models: [],
    sessions: [],
    cursors: {},
  }
}

/**
 * A stand-in response that records what the handler wrote.
 *
 * @returns {object} the response.
 */
function makeRes() {
  return {
    status: 0,
    headers: null,
    body: '',
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
    },
    end(text) {
      this.body = text ?? ''
    },
  }
}

/**
 * A stand-in request.
 *
 * @param {{ method?: string, address?: string|undefined, origin?: string }} [options] - request shape.
 * @returns {object} the request.
 */
function makeReq({ method = 'GET', address = '127.0.0.1', origin } = {}) {
  const headers = {}
  if (origin !== undefined) headers.origin = origin
  return { method, headers, socket: { remoteAddress: address } }
}

/**
 * Invoke the route handler.
 *
 * @param {object} route - the route definition.
 * @param {object} req - the request.
 * @returns {object} the response.
 */
function call(route, req) {
  const res = makeRes()
  route.handler(req, res)
  return res
}

test('the route is an exact route on the documented path', () => {
  const route = createOverviewRoute({ ledger: fakeLedger(snapshot) })
  assert.equal(route.kind, 'exact')
  assert.equal(route.path, OVERVIEW_PATH)
  assert.equal(OVERVIEW_PATH, '/api/token-ledger/summary')
  assert.equal(typeof route.handler, 'function')
})

test('a loopback GET is served as uncacheable JSON', () => {
  const route = createOverviewRoute({ ledger: fakeLedger(snapshot) })
  const res = call(route, makeReq())
  assert.equal(res.status, 200)
  assert.match(res.headers['content-type'], /application\/json/)
  assert.equal(res.headers['cache-control'], 'no-store')
  assert.equal(typeof res.headers['content-length'], 'number')
  const body = JSON.parse(res.body)
  assert.equal(body.plugin, 'token-ledger')
  assert.ok(body.ranges.month !== undefined)
  assert.ok(Array.isArray(body.series))
})

test('a HEAD request is served without a body complaint', () => {
  const route = createOverviewRoute({ ledger: fakeLedger(snapshot) })
  const res = call(route, makeReq({ method: 'HEAD' }))
  assert.equal(res.status, 200)
})

test('writes are refused', () => {
  const route = createOverviewRoute({ ledger: fakeLedger(snapshot) })
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const res = call(route, makeReq({ method }))
    assert.equal(res.status, 405, method)
    assert.equal(JSON.parse(res.body).error, 'method not allowed')
  }
})

test('a non-loopback peer is refused', () => {
  const route = createOverviewRoute({ ledger: fakeLedger(snapshot) })
  for (const address of ['192.168.1.20', '10.0.0.7', '::ffff:192.168.1.20', '203.0.113.9']) {
    const res = call(route, makeReq({ address }))
    assert.equal(res.status, 403, address)
    assert.equal(JSON.parse(res.body).error, 'forbidden')
  }
})

test('loopback addresses in every spelling are allowed', () => {
  for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    assert.equal(isLoopbackAddress(address), true, address)
  }
  assert.equal(isLoopbackAddress(undefined), false)
  assert.equal(isLoopbackAddress(''), false)
  assert.equal(isLoopbackAddress('localhost'), false, 'a hostname is not an address')
})

test('an inherited IP is not mistaken for loopback', () => {
  // 127.0.0.1.evil.example must not pass a naive prefix check.
  assert.equal(isLoopbackAddress('127.0.0.1.evil.example'), false)
  assert.equal(isLoopbackAddress('127.0.0.10'), false)
})

test('only local origins are accepted, and an absent origin is fine', () => {
  assert.equal(isLocalOrigin(undefined), true)
  assert.equal(isLocalOrigin(''), true)
  assert.equal(isLocalOrigin('null'), true)
  assert.equal(isLocalOrigin('file://'), true)
  assert.equal(isLocalOrigin('http://127.0.0.1:43120'), true)
  assert.equal(isLocalOrigin('http://localhost:3000'), true)
  assert.equal(isLocalOrigin('http://[::1]:8080'), true)
  assert.equal(isLocalOrigin('https://evil.example'), false)
  assert.equal(isLocalOrigin('not a url'), false)
})

test('a cross-site origin is refused even from loopback', () => {
  const route = createOverviewRoute({ ledger: fakeLedger(snapshot) })
  const res = call(route, makeReq({ origin: 'https://evil.example' }))
  assert.equal(res.status, 403)
})

test('a request with no socket address is served, for the desktop IPC bridge', () => {
  // The desktop build loads the front end over file:// and carries fetch over
  // IPC, where a peer address may be unavailable.
  assert.equal(isAllowedPeer(makeReq({ address: undefined })), true)
  const route = createOverviewRoute({ ledger: fakeLedger(snapshot) })
  assert.equal(call(route, makeReq({ address: undefined })).status, 200)
})

test('a faulting ledger becomes a 500 with a JSON body, never a thrown handler', () => {
  const errors = []
  const route = createOverviewRoute({
    ledger: fakeLedger(() => {
      throw new Error('ledger is broken')
    }),
    options: { onError: (error) => errors.push(error) },
  })
  const res = call(route, makeReq())
  assert.equal(res.status, 500)
  assert.equal(JSON.parse(res.body).error, 'overview unavailable')
  assert.equal(errors.length, 1)
  assert.match(String(errors[0].message), /ledger is broken/)
})

test('the clock is injectable, so the payload is deterministic under test', () => {
  const fixed = new Date(2026, 2, 15, 12, 0, 0)
  const route = createOverviewRoute({ ledger: fakeLedger(snapshot), options: { now: () => fixed } })
  const body = JSON.parse(call(route, makeReq()).body)
  assert.equal(body.generatedAt, fixed.getTime())
  assert.equal(body.today.date, '2026-03-15')
})

/* ------------------------------------------------------------------ rates -- */

/**
 * A stand-in rates service.
 *
 * @param {{ read?: () => object, saveOverrides?: (body: unknown) => object }} [parts] - behaviour overrides.
 * @returns {object} the service.
 */
function fakeRates(parts = {}) {
  const saved = []
  return {
    saved,
    read:
      parts.read ??
      (() => ({
        plugin: 'token-ledger',
        generatedAt: Date.now(),
        currency: 'USD',
        quote: 'CNY',
        refreshIntervalMs: 1_800_000,
        perVendor: 3,
        catalogue: { available: true, fetchedAt: Date.now(), ageMs: 10, source: 'https://example.test/models', totalAvailable: 445, modelCount: 6, vendorCount: 2 },
        fx: { available: true, rate: 7.1, base: 'USD', quote: 'CNY', source: 'https://example.test/fx', fetchedAt: Date.now(), ageMs: 5, overridden: false },
        overriddenModels: [],
        lastRefresh: { at: Date.now(), ageMs: 1, catalogue: 'ok (6 models, 2 vendors)', fx: 'ok (1 USD = 7.1 CNY)' },
        vendors: [{ vendor: 'acme', models: [] }],
      })),
    saveOverrides:
      parts.saveOverrides ??
      ((body) => {
        saved.push(body)
        return { ok: true, saved: { models: 1, fx: false } }
      }),
  }
}

/**
 * A stand-in write request whose body arrives after the handler subscribes.
 *
 * @param {{ method?: string, body?: string, contentType?: string|null, address?: string }} [options] - request shape.
 * @returns {object} an `IncomingMessage`-shaped emitter.
 */
function makeWriteReq({ method = 'POST', body = '{}', contentType = 'application/json', address = '127.0.0.1' } = {}) {
  const req = new EventEmitter()
  req.method = method
  req.headers = {}
  // `null` means "send no content-type at all"; the default is the JSON one.
  if (contentType !== null) req.headers['content-type'] = contentType
  req.socket = { remoteAddress: address }
  // A real `IncomingMessage` reports `destroyed` from the start; the stand-in has
  // to say so too, or an assertion that the handler did *not* destroy it would
  // pass against `undefined`.
  req.destroyed = false
  req.destroy = () => {
    req.destroyed = true
  }
  process.nextTick(() => {
    if (body !== '') req.emit('data', Buffer.from(body, 'utf8'))
    req.emit('end')
  })
  return req
}

/**
 * Invoke a possibly-async route handler.
 *
 * @param {object} route - the route definition.
 * @param {object} req - the request.
 * @returns {Promise<object>} the response.
 */
async function callAsync(route, req) {
  const res = makeRes()
  await route.handler(req, res)
  return res
}

test('the rates route is exact on the documented path', () => {
  const route = createRatesRoute({ rates: fakeRates() })
  assert.equal(route.kind, 'exact')
  assert.equal(route.path, RATES_PATH)
  assert.equal(RATES_PATH, '/api/token-ledger/rates')
  assert.equal(typeof route.handler, 'function')
})

test('a loopback GET returns the whole rates payload', async () => {
  const route = createRatesRoute({ rates: fakeRates() })
  const res = await callAsync(route, makeReq())
  assert.equal(res.status, 200)
  assert.match(res.headers['content-type'], /application\/json/)
  assert.equal(res.headers['cache-control'], 'no-store')
  const body = JSON.parse(res.body)
  assert.equal(body.plugin, 'token-ledger')
  assert.equal(body.currency, 'USD')
  assert.equal(body.quote, 'CNY')
  assert.ok(body.catalogue.available)
  assert.equal(body.fx.rate, 7.1)
  assert.equal(body.perVendor, 3)
  assert.ok(Array.isArray(body.vendors))
  assert.ok(typeof body.lastRefresh.catalogue === 'string')
})

test('a rates HEAD request is served', async () => {
  const route = createRatesRoute({ rates: fakeRates() })
  const res = await callAsync(route, makeReq({ method: 'HEAD' }))
  assert.equal(res.status, 200)
})

test('an offline host still gets a usable shape, not an error', async () => {
  // Nothing has ever been fetched: the page must still render, with the
  // manual-entry story available.
  const route = createRatesRoute({
    rates: fakeRates({
      read: () => ({
        plugin: 'token-ledger',
        currency: 'USD',
        quote: 'CNY',
        perVendor: 3,
        catalogue: { available: false, fetchedAt: null, ageMs: null, source: 'https://example.test/models', totalAvailable: null, modelCount: 0, vendorCount: 0 },
        fx: { available: false, rate: null, base: 'USD', quote: 'CNY', source: 'https://example.test/fx', fetchedAt: null, ageMs: null, overridden: false },
        overriddenModels: [],
        lastRefresh: { at: null, ageMs: null, catalogue: 'failed (timeout after 20000ms)', fx: 'failed (getaddrinfo ENOTFOUND)' },
        vendors: [],
      }),
    }),
  })
  const res = await callAsync(route, makeReq())
  assert.equal(res.status, 200)
  const body = JSON.parse(res.body)
  assert.equal(body.catalogue.available, false)
  assert.equal(body.fx.rate, null)
  assert.deepEqual(body.vendors, [])
  assert.match(body.lastRefresh.catalogue, /failed/)
})

test('a rates write in any other method is refused', async () => {
  const route = createRatesRoute({ rates: fakeRates() })
  for (const method of ['PUT', 'DELETE', 'PATCH']) {
    const res = await callAsync(route, makeWriteReq({ method }))
    assert.equal(res.status, 405, method)
    assert.equal(JSON.parse(res.body).error, 'method not allowed')
  }
})

test('a POST without a JSON content type is refused before the body is read', async () => {
  // A cross-origin form can only send urlencoded / multipart / text-plain, so
  // requiring JSON is what keeps another page from writing these values.
  const route = createRatesRoute({ rates: fakeRates() })
  for (const contentType of ['application/x-www-form-urlencoded', 'text/plain', 'multipart/form-data', null]) {
    const res = await callAsync(route, makeWriteReq({ contentType }))
    assert.equal(res.status, 415, String(contentType))
    assert.match(JSON.parse(res.body).error, /application\/json/)
  }
})

test('a POST body that is not JSON is a 400', async () => {
  const route = createRatesRoute({ rates: fakeRates() })
  const res = await callAsync(route, makeWriteReq({ body: '{not json' }))
  assert.equal(res.status, 400)
  assert.match(JSON.parse(res.body).error, /not valid JSON/)
})

test('an oversized POST body is refused with a readable 413', async () => {
  const route = createRatesRoute({ rates: fakeRates() })
  const req = makeWriteReq({ body: 'x'.repeat(300 * 1024) })
  const res = await callAsync(route, req)
  assert.equal(res.status, 413)
  assert.match(JSON.parse(res.body).error, /exceeds/)
  // The stream is left readable on purpose: a destroyed request would surface as
  // a connection reset, and the caller would never see the status written here.
  assert.equal(req.destroyed, false)
  // Nothing after the cap is accepted, so a second chunk cannot grow the body.
  req.emit('data', Buffer.from('more'))
  assert.equal(res.status, 413)
  assert.match(JSON.parse(res.body).error, /exceeds/)
})

test('a valid POST stores the patch and returns the re-read state', async () => {
  const rates = fakeRates()
  const route = createRatesRoute({ rates })
  const patch = { models: { 'acme/one': { input: 1, output: 2, cacheRead: 0.1, cacheWrite: null } }, fx: 7.05 }
  const res = await callAsync(route, makeWriteReq({ body: JSON.stringify(patch) }))
  assert.equal(res.status, 200)
  const body = JSON.parse(res.body)
  assert.equal(body.ok, true)
  assert.equal(body.saved.models, 1)
  assert.equal(body.saved.fx, false)
  // The service saw exactly the parsed body, untouched.
  assert.deepEqual(rates.saved, [patch])
  // ...and the caller gets the effective state back, so it need not re-fetch.
  assert.equal(body.rates.plugin, 'token-ledger')
  assert.equal(body.rates.fx.rate, 7.1)
})

test('a patch the service rejects is a 400 carrying its reason', async () => {
  const route = createRatesRoute({
    rates: fakeRates({ saveOverrides: () => ({ ok: false, error: 'fx must be a positive number' }) }),
  })
  const res = await callAsync(route, makeWriteReq({ body: JSON.stringify({ fx: -1 }) }))
  assert.equal(res.status, 400)
  assert.equal(JSON.parse(res.body).error, 'fx must be a positive number')
})

test('a faulting rates service becomes a 500 with a JSON body', async () => {
  const errors = []
  const route = createRatesRoute({
    rates: fakeRates({
      read: () => {
        throw new Error('cache is corrupt')
      },
    }),
    options: { onError: (error) => errors.push(error) },
  })
  const res = await callAsync(route, makeReq())
  assert.equal(res.status, 500)
  assert.equal(JSON.parse(res.body).error, 'rates unavailable')
  assert.equal(errors.length, 1)

  const writeErrors = []
  const writeRoute = createRatesRoute({
    rates: fakeRates({
      saveOverrides: () => {
        throw new Error('disk is full')
      },
    }),
    options: { onError: (error) => writeErrors.push(error) },
  })
  const writeRes = await callAsync(writeRoute, makeWriteReq({ body: '{"fx":7}' }))
  assert.equal(writeRes.status, 500)
  assert.equal(JSON.parse(writeRes.body).error, 'could not save')
  assert.equal(writeErrors.length, 1)
})

test('the rates guard matches the overview guard, on both reads and writes', async () => {
  const route = createRatesRoute({ rates: fakeRates() })
  for (const address of ['192.168.1.20', '203.0.113.9']) {
    const read = await callAsync(route, makeReq({ address }))
    assert.equal(read.status, 403, address)
    const write = await callAsync(route, makeWriteReq({ address }))
    assert.equal(write.status, 403, address)
    assert.equal(JSON.parse(write.body).error, 'forbidden')
  }
  const origin = await callAsync(route, makeReq({ origin: 'https://evil.example' }))
  assert.equal(origin.status, 403)
  // The desktop IPC bridge has no peer address and must keep working.
  const bridged = await callAsync(route, makeReq({ address: undefined }))
  assert.equal(bridged.status, 200)
})
