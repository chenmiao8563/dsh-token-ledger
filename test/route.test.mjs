/**
 * Route tests.
 *
 * The route is the one place where this plugin answers a network request, so
 * the guard and the response shape are pinned here rather than trusted.
 *
 * @module dsh-token-ledger/test/route.test
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { OVERVIEW_PATH, createOverviewRoute, isAllowedPeer, isLocalOrigin, isLoopbackAddress } from '../lib/route.js'

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
