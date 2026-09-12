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
  BILL_PATH,
  OVERVIEW_PATH,
  RATES_PATH,
  createBillRoute,
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

/** A local calendar day as `YYYY-MM-DD`. */
function dayKeyOf(date) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** A minimal snapshot with one day of usage. */
function snapshot() {
  const now = Date.now()
  const key = dayKeyOf(new Date(now))
  return {
    version: 5,
    updatedAt: now,
    totals: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 0, totalTokens: 6, reasoningTokens: 0, calls: 1 },
    daily: [{ date: key, calls: 1, inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 0, totalTokens: 6, reasoningTokens: 0 }],
    models: [],
    sessions: [],
    cursors: {},
  }
}

/**
 * A snapshot with both a daily series and a usage cross table.
 *
 * The overview reads `daily`; the cost it shows beside those totals is computed
 * from `usage`, so a fixture for a priced overview has to carry both — and they
 * have to fall on the same day as the route's clock, or the day's cost is zero.
 *
 * @param {string} [date] - the local day to put the usage on.
 * @returns {object} the snapshot.
 */
function overviewSnapshot(date = dayKeyOf(new Date())) {
  const counters = { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 1_000_000, reasoningTokens: 0 }
  return {
    version: 5,
    updatedAt: Date.now(),
    totals: { ...counters, calls: 1 },
    daily: [{ date, calls: 1, ...counters }],
    models: [],
    sessions: [{ sessionId: 's1', cwd: 'D:\\proj', title: '工作', calls: 1 }],
    cursors: {},
    usage: [
      {
        date,
        sessionId: 's1',
        model: 'acme-official/one',
        calls: 1,
        ...counters,
        peak: { ...counters },
        offPeak: { ...counters, inputTokens: 0, totalTokens: 0 },
      },
    ],
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
 * @param {{ read?: () => object, saveOverrides?: (body: unknown) => object, refresh?: (trigger: object) => Promise<object> }} [parts] - behaviour overrides.
 * @returns {object} the service.
 */
function fakeRates(parts = {}) {
  const saved = []
  return {
    saved,
    // The real service always has one; a test that does not ask for a refresh
    // should not have to say so, hence the spread rather than a default.
    ...(parts.refresh === undefined ? {} : { refresh: parts.refresh }),
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

test('a POST asking for a refresh runs one and reports its outcome', async () => {
  const seen = []
  const route = createRatesRoute({
    rates: fakeRates({
      refresh: async (trigger) => {
        seen.push(trigger)
        return { catalogue: 'ok (6 models, 2 vendors)', fx: 'ok (1 USD = 7.1 CNY)' }
      },
    }),
  })
  const res = await callAsync(route, makeWriteReq({ body: JSON.stringify({ refresh: true }) }))
  assert.equal(res.status, 200)
  const body = JSON.parse(res.body)
  assert.equal(body.refresh.catalogue, 'ok (6 models, 2 vendors)')
  assert.deepEqual(seen, [{ reason: 'page' }], 'the refresh says who asked for it')
  assert.equal(body.rates.plugin, 'token-ledger', 'and the caller still gets the state to render')
})

test('a write that does not ask for a refresh does not run one', async () => {
  let calls = 0
  const route = createRatesRoute({
    rates: fakeRates({
      refresh: async () => {
        calls += 1
        return { catalogue: 'ok', fx: 'ok' }
      },
    }),
  })
  for (const body of [{ models: { 'a/b': { input: 1 } } }, { refresh: 'yes' }, { refresh: false }]) {
    const res = await callAsync(route, makeWriteReq({ body: JSON.stringify(body) }))
    assert.equal(res.status, 200)
    assert.equal(JSON.parse(res.body).refresh, null, JSON.stringify(body))
  }
  assert.equal(calls, 0)
})

test('a refresh that throws is a 502 and stores nothing', async () => {
  const errors = []
  const rates = fakeRates({
    refresh: async () => {
      throw new Error('socket hung up')
    },
  })
  const route = createRatesRoute({ rates, options: { onError: (error) => errors.push(error) } })
  const res = await callAsync(route, makeWriteReq({ body: JSON.stringify({ refresh: true }) }))
  assert.equal(res.status, 502)
  assert.equal(JSON.parse(res.body).error, 'refresh failed')
  assert.deepEqual(rates.saved, [], 'a refresh that failed must not be mistaken for a patch')
  assert.equal(errors.length, 1)
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

/* ------------------------------------------------------------------- bill -- */

/**
 * A stand-in request carrying a query string.
 *
 * @param {{ method?: string, url?: string, address?: string, origin?: string }} [options] - request shape.
 * @returns {object} the request.
 */
function makeBillReq({ method = 'GET', url = BILL_PATH, address = '127.0.0.1', origin } = {}) {
  return { ...makeReq({ method, address, origin }), url }
}

/** A catalogue in the shape the rates service serves, with one priced vendor. */
function billCatalogue() {
  return {
    currency: 'USD',
    quote: 'CNY',
    priceSource: 'modelsdev',
    fx: { available: true, rate: 7, base: 'USD', quote: 'CNY', overridden: false },
    vendors: [
      {
        vendor: 'acme',
        currency: 'USD',
        models: [{ id: 'acme/one', name: 'one', vendor: 'acme', prices: { input: 1, output: 2, cacheRead: 0, cacheWrite: null } }],
      },
    ],
  }
}

/** The day the bill clock stands on, and the day the fixture's usage falls on. */
const BILL_DAY = '2026-09-30'

/** A ledger snapshot with one priced day of usage, on the bill's day. */
function billSnapshot() {
  const counters = { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 1_000_000, reasoningTokens: 0 }
  return {
    version: 4,
    sessions: [{ sessionId: 's1', cwd: 'D:\\proj' }],
    usage: [
      {
        date: BILL_DAY,
        sessionId: 's1',
        model: 'acme-official/one',
        calls: 3,
        ...counters,
        peak: { ...counters },
        offPeak: { ...counters, inputTokens: 0, totalTokens: 0 },
      },
    ],
  }
}

/** The bill route over deterministic dependencies. */
function billRoute(options = {}) {
  return createBillRoute({
    snapshot: options.snapshot ?? billSnapshot,
    catalogue: options.catalogue ?? billCatalogue,
    subscriptions: options.subscriptions ?? [],
    options: { now: () => new Date(2026, 8, 30, 12, 0, 0), ...(options.options ?? {}) },
  })
}

test('the bill route is exact on the documented path', () => {
  const route = billRoute()
  assert.equal(route.kind, 'exact')
  assert.equal(route.path, BILL_PATH)
  assert.equal(BILL_PATH, '/api/token-ledger/bill')
  assert.equal(typeof route.handler, 'function')
})

test('a bill is served as uncacheable JSON, grouped and ranged by the query', () => {
  const route = billRoute({ snapshot: () => billSnapshot() })
  const res = call(route, makeBillReq({ url: `${BILL_PATH}?by=workspace&range=all` }))
  assert.equal(res.status, 200)
  assert.match(res.headers['content-type'], /application\/json/)
  assert.equal(res.headers['cache-control'], 'no-store')
  const body = JSON.parse(res.body)
  assert.equal(body.plugin, 'token-ledger')
  assert.deepEqual(body.dimensions, ['workspace'])
  assert.deepEqual(body.ranges, ['all'])
  assert.equal(body.sections.length, 1)
  const section = body.sections[0]
  assert.equal(section.by, 'workspace')
  assert.equal(section.range.kind, 'all')
  assert.deepEqual(section.rows.map((row) => row.label), ['D:\\proj'])
  assert.equal(section.rows[0].calls, 3)
  assert.equal(section.totals.calls, 3)
  // 1M input at 1 USD per million, converted at the rate on the catalogue.
  assert.equal(section.totals.totalCost, 7)
  assert.equal(section.totals.usageCost, 7, 'with no plan the two agree')
  assert.equal(body.currency, 'CNY')
})

test('the page asks for one section at a time, and the export asks for all of them', () => {
  // One grouping over one range: what a section card fetches.
  const one = JSON.parse(call(billRoute(), makeBillReq({ url: `${BILL_PATH}?by=session&range=today` })).body)
  assert.deepEqual(one.dimensions, ['session'])
  assert.deepEqual(one.ranges, ['today'])
  assert.equal(one.sections.length, 1)
  // A session row is named the way the page shows it: workspace, then DSH's title.
  assert.equal(one.sections[0].rows[0].label, 'proj/s1')

  // Every grouping over every range: what the export fetches. Four times five, and
  // the shared notes stated once.
  const all = JSON.parse(call(billRoute(), makeBillReq({ url: `${BILL_PATH}?by=workspace,session,model,vendor&range=month,year,week,today,all` })).body)
  assert.deepEqual(all.dimensions, ['workspace', 'session', 'model', 'vendor'])
  assert.deepEqual(all.ranges, ['month', 'year', 'week', 'today', 'all'])
  assert.equal(all.sections.length, 20)
  assert.deepEqual(
    all.sections.slice(0, 5).map((section) => `${section.by}/${section.range.kind}`),
    ['workspace/month', 'workspace/year', 'workspace/week', 'workspace/today', 'workspace/all'],
  )
})

test('the default request is every section over the month', () => {
  const body = JSON.parse(call(billRoute(), makeBillReq()).body)
  assert.deepEqual(body.dimensions, ['workspace', 'session', 'model', 'vendor'])
  assert.deepEqual(body.ranges, ['month'])
  assert.equal(body.sections.length, 4)
  assert.deepEqual(body.sections.map((section) => section.by), ['workspace', 'session', 'model', 'vendor'])
})

test('an unknown dimension or range bills the default rather than failing', () => {
  // A bookmarked link with a stale parameter is still a bill.
  const res = call(billRoute(), makeBillReq({ url: `${BILL_PATH}?by=nonsense&range=nonsense` }))
  assert.equal(res.status, 200)
  const body = JSON.parse(res.body)
  assert.deepEqual(body.dimensions, ['workspace', 'session', 'model', 'vendor'])
  assert.deepEqual(body.ranges, ['month'])
  // A list with one good value and one stale one keeps the good one.
  const mixed = JSON.parse(call(billRoute(), makeBillReq({ url: `${BILL_PATH}?by=session,nonsense&range=today,lastweek` })).body)
  assert.deepEqual(mixed.dimensions, ['session'])
  assert.deepEqual(mixed.ranges, ['today'])
})

test('format=csv returns a downloadable attachment, not JSON', () => {
  const res = call(billRoute(), makeBillReq({ url: `${BILL_PATH}?format=csv&by=vendor&range=month` }))
  assert.equal(res.status, 200)
  assert.match(res.headers['content-type'], /text\/csv/)
  assert.equal(res.headers['content-disposition'], 'attachment; filename="token-bill-vendor-month-2026-09-30.csv"')
  assert.equal(res.headers['cache-control'], 'no-store')
  const lines = res.body.trim().split('\r\n')
  assert.equal(lines.length, 3, 'a header, the one vendor and the total')
  assert.ok(lines[0].startsWith('dimension,range,group,'))
  assert.ok(lines.at(-1).startsWith('vendor,month,TOTAL,'))

  // The attachment name follows what was asked for, and a whole export says so.
  const bySession = call(billRoute(), makeBillReq({ url: `${BILL_PATH}?format=csv&by=session&range=today` }))
  assert.equal(bySession.headers['content-disposition'], 'attachment; filename="token-bill-session-today-2026-09-30.csv"')
  const everything = call(billRoute(), makeBillReq({ url: `${BILL_PATH}?format=csv&by=workspace,session,model,vendor&range=month,year,week,today,all` }))
  assert.equal(everything.headers['content-disposition'], 'attachment; filename="token-bill-all-2026-09-30.csv"')
  assert.equal(everything.body.trim().split('\r\n').length, 1 + 20 * 2, 'a header, one row and one total per section')
})

test('a CSV export is the same arithmetic the page shows', () => {
  const route = billRoute()
  const json = JSON.parse(call(route, makeBillReq({ url: `${BILL_PATH}?by=vendor&range=month` })).body)
  const csv = call(route, makeBillReq({ url: `${BILL_PATH}?format=csv&by=vendor&range=month` })).body.trim().split('\r\n')
  assert.equal(csv.length, json.sections[0].rows.length + 2)
  // The cost column sits after the hit rate; the total is the section's.
  assert.equal(Number(csv.at(-1).split(',')[9]).toFixed(4), Number(json.sections[0].totals.totalCost).toFixed(4))
})

test('a bill HEAD request is served', () => {
  const res = call(billRoute(), makeBillReq({ method: 'HEAD' }))
  assert.equal(res.status, 200)
})

test('writing to the bill route is refused', () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const res = call(billRoute(), makeBillReq({ method }))
    assert.equal(res.status, 405, method)
    assert.equal(JSON.parse(res.body).error, 'method not allowed')
  }
})

test('a bill is refused from off the machine and from another origin', () => {
  for (const address of ['192.168.1.20', '203.0.113.9']) {
    const res = call(billRoute(), makeBillReq({ address }))
    assert.equal(res.status, 403, address)
    assert.equal(JSON.parse(res.body).error, 'forbidden')
  }
  assert.equal(call(billRoute(), makeBillReq({ origin: 'https://evil.example' })).status, 403)
  // The desktop IPC bridge has no peer address and must keep working.
  assert.equal(call(billRoute(), makeBillReq({ address: undefined })).status, 200)
})

test('a faulting ledger or rate service is a 500, never a thrown handler', () => {
  const errors = []
  const options = { onError: (error) => errors.push(error) }
  const fromLedger = call(
    billRoute({
      snapshot: () => {
        throw new Error('ledger is broken')
      },
      options,
    }),
    makeBillReq(),
  )
  assert.equal(fromLedger.status, 500)
  assert.equal(JSON.parse(fromLedger.body).error, 'bill unavailable')

  const fromRates = call(
    billRoute({
      catalogue: () => {
        throw new Error('cache is corrupt')
      },
      options,
    }),
    makeBillReq(),
  )
  assert.equal(fromRates.status, 500)
  assert.equal(errors.length, 2)
  assert.match(String(errors[0].message), /ledger is broken/)
})

test('a bill with plans reports the plan, and keeps the totals honest', () => {
  const route = billRoute({
    subscriptions: [{ vendor: 'acme', plan: 'Acme Pro', amount: 100, currency: 'CNY', startedAt: '2026-09-01' }],
  })
  const body = JSON.parse(call(route, makeBillReq({ url: `${BILL_PATH}?by=subscription&range=month` })).body)
  assert.equal(body.subscriptions.length, 1)
  assert.equal(body.subscriptions[0].share, 100)
  const section = body.sections[0]
  const planRow = section.rows.find((row) => row.plan === true)
  const usageRow = section.rows.find((row) => row.plan === false)
  assert.equal(planRow.cost, 100, 'the plan is what the month cost')
  assert.equal(planRow.usageCost, 7, 'and the usage it covered is beside it, not added to it')
  assert.equal(usageRow.cost, 0, 'nothing is off-plan here')
  assert.equal(section.totals.totalCost, 100, 'no double counting')
  assert.equal(section.totals.usageCost, 7)
})

test('the overview carries what each of its periods cost', () => {
  const day = '2026-09-30'
  const route = createOverviewRoute({
    ledger: { snapshot: () => overviewSnapshot(day) },
    catalogue: billCatalogue,
    options: { now: () => new Date(2026, 8, 30, 12, 0, 0) },
  })
  const body = JSON.parse(call(route, makeReq()).body)
  assert.equal(body.cost.priced, true)
  assert.equal(body.cost.currency, 'CNY')
  assert.equal(body.cost.rate, 7)
  // 1M input at 1 USD per million, on the day the fixture bills.
  assert.equal(body.cost.byRange.today.cost, 7)
  assert.equal(body.cost.byRange.month.cost, 7)
  assert.equal(body.cost.byRange.week.cost, 7)
  assert.equal(body.cost.byRange.year.cost, 7)
  assert.equal(body.cost.byRange.today.unpricedTokens, 0)

  // Without a catalogue the tokens are still served, with no cost claimed.
  const bare = JSON.parse(call(createOverviewRoute({ ledger: { snapshot: () => overviewSnapshot(day) } }), makeReq()).body)
  assert.equal(bare.cost.priced, false)
  assert.equal(bare.cost.byRange, null)
  assert.ok(bare.totals.totalTokens > 0, 'the token totals are still there')

  // A pricing fault degrades the cost, not the page.
  const errors = []
  const broken = JSON.parse(
    call(
      createOverviewRoute({
        ledger: { snapshot: () => overviewSnapshot(day) },
        catalogue: () => {
          throw new Error('cache is corrupt')
        },
        options: { onError: (error) => errors.push(error) },
      }),
      makeReq(),
    ).body,
  )
  assert.equal(broken.cost.priced, false)
  assert.equal(errors.length, 1)
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
