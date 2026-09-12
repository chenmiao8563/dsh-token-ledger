/**
 * The host route that feeds the browser half.
 *
 * ## Why a route instead of the settings namespace
 *
 * The obvious channel for plugin data is a settings namespace, and the reference
 * UI plugins use one. This plugin deliberately does not, for two reasons:
 *
 * 1. A settings namespace needs a schema, and the schema library is a real
 *    dependency. This package's whole installability claim is that it has none.
 * 2. Settings are persisted. Publishing token aggregates through them would
 *    rewrite `settings.yaml` on every debounce and grow it with data that is
 *    derived and reproducible, which is exactly the mistake that left a 185 kB
 *    settings backup on the machine this was developed against.
 *
 * The ledger file stays the store of record; this route is a read-only view of
 * the live in-memory ledger.
 *
 * ## The guard
 *
 * The route exposes local usage counts, which are not secrets but are also
 * nobody else's business. The web server binds loopback by default, but an
 * operator may bind `0.0.0.0`, so the handler checks the peer itself: an
 * address is accepted only when it is loopback, and an `Origin` header is
 * accepted only when it is loopback or absent.
 *
 * Absent is allowed because the desktop build loads the front end over
 * `file://` and carries `fetch` over an IPC bridge, where a socket address may
 * be unavailable. Refusing that case would break the desktop app to protect
 * against a request that never left the machine.
 *
 * @module dsh-token-ledger/route
 */

import { buildOverview } from './overview.js'

/** The path the browser half fetches. */
export const OVERVIEW_PATH = '/api/token-ledger/summary'

/**
 * Whether a peer address is loopback.
 *
 * @param {string|undefined} address - `req.socket.remoteAddress`.
 * @returns {boolean} true for IPv4 or IPv6 loopback.
 */
export function isLoopbackAddress(address) {
  if (typeof address !== 'string') return false
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/**
 * Whether an `Origin` header belongs to a local page.
 *
 * @param {string|undefined} origin - the header value.
 * @returns {boolean} true when absent, `null`, `file://`, or a loopback host.
 */
export function isLocalOrigin(origin) {
  if (origin === undefined || origin === '' || origin === 'null') return true
  if (origin.startsWith('file://')) return true
  try {
    const url = new URL(origin)
    // WHATWG URL keeps the brackets on an IPv6 host: `new URL('http://[::1]/').hostname`
    // is `'[::1]'`, so they have to come off before comparing.
    const hostname = url.hostname.replace(/^\[|\]$/g, '')
    return hostname === '127.0.0.1' || hostname === '::1' || hostname === 'localhost'
  } catch {
    return false
  }
}

/**
 * Decide whether a request may read the overview.
 *
 * @param {object} req - a node `IncomingMessage`-shaped object.
 * @returns {boolean} whether to serve it.
 */
export function isAllowedPeer(req) {
  const address = req?.socket?.remoteAddress
  // An unrecognized address means the request did not arrive over a socket we
  // can judge (the desktop IPC bridge), not that it came from a stranger.
  if (typeof address === 'string' && address !== '' && !isLoopbackAddress(address)) return false
  return isLocalOrigin(req?.headers?.origin)
}

/**
 * Write a JSON response.
 *
 * @param {object} res - a node `ServerResponse`-shaped object.
 * @param {number} status - the HTTP status.
 * @param {unknown} body - the JSON value.
 * @returns {void}
 */
function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    // The numbers move as steps complete, so a cached copy is always wrong.
    'cache-control': 'no-store',
  })
  res.end(text)
}

/**
 * Build the route definition to hand to `ctx.webServer.register`.
 *
 * The handler never throws: a fault becomes a 500 with a JSON body, because the
 * web server logs a warning and destroys the socket when a handler throws, and
 * a client that cannot reach the plugin should be able to say why.
 *
 * @param {object} input - the route's dependencies.
 * @param {{ snapshot: () => object }} input.ledger - the live ledger.
 * @param {{ now?: () => Date, onError?: (error: unknown) => void }} [input.options] - clock and diagnostics.
 * @returns {{ kind: 'exact', path: string, handler: (req: object, res: object) => void }} the route.
 */
export function createOverviewRoute({ ledger, options = {} }) {
  const now = options.now ?? (() => new Date())
  const onError = options.onError ?? (() => {})

  return {
    kind: 'exact',
    path: OVERVIEW_PATH,
    handler: (req, res) => {
      if (!isAllowedPeer(req)) {
        sendJson(res, 403, { error: 'forbidden' })
        return
      }
      const method = req?.method ?? 'GET'
      if (method !== 'GET' && method !== 'HEAD') {
        sendJson(res, 405, { error: 'method not allowed' })
        return
      }
      try {
        sendJson(res, 200, buildOverview(ledger.snapshot(), { now: now() }))
      } catch (error) {
        onError(error)
        sendJson(res, 500, { error: 'overview unavailable' })
      }
    },
  }
}

/** The path the browser half reads and writes for prices and the rate. */
export const RATES_PATH = '/api/token-ledger/rates'

/** Refuse a request body larger than this; the page only ever sends a small patch. */
const MAX_BODY_BYTES = 256 * 1024

/**
 * Whether a request declares a JSON body.
 *
 * A handler that accepts writes is reachable from any page the user visits, so
 * requiring a JSON content type means a form post from another origin cannot
 * reach it: forms can only send the three encodings a browser allows, none of
 * which is `application/json`.
 *
 * @param {object} req - a node `IncomingMessage`-shaped object.
 * @returns {boolean} whether the declared type is JSON.
 */
function isJsonRequest(req) {
  const type = req?.headers?.['content-type']
  return typeof type === 'string' && type.toLowerCase().includes('application/json')
}

/**
 * Read a request body with a hard size cap.
 *
 * Exceeding the cap stops reading and answers 413. The request stream is
 * deliberately *not* destroyed: destroying it makes the client see a connection
 * reset instead of the status code the handler just wrote, which turns a clear
 * "too large" into an unexplained network error. Nothing further is read once
 * the promise settles, and Node closes the connection after the response because
 * the body was not consumed.
 *
 * @param {object} req - the request stream.
 * @param {number} limit - the maximum accepted size in bytes.
 * @returns {Promise<unknown>} the parsed body.
 * @throws {{ status: number, message: string }} when the body is too large or not JSON.
 */
function readJsonBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let settled = false
    req.on('data', (chunk) => {
      if (settled) return
      size += chunk.length
      if (size > limit) {
        settled = true
        reject({ status: 413, message: `body exceeds ${limit} bytes` })
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject({ status: 400, message: 'body is not valid JSON' })
      }
    })
    req.on('error', (error) => {
      if (settled) return
      settled = true
      reject({ status: 400, message: String(error?.message ?? error) })
    })
  })
}

/**
 * Build the route that serves and stores prices and the USD rate.
 *
 * `GET` returns everything the rates page renders. `POST` stores hand-entered
 * values, which is the whole offline story: a host with no route to the internet
 * still gets a usable price list, because the values a user types are kept
 * beside the ledger and outrank anything a later refresh brings back.
 *
 * @param {object} input - the route's dependencies.
 * @param {{ read: () => object, saveOverrides: (body: unknown) => object }} input.rates - the rates service.
 * @param {{ onError?: (error: unknown) => void }} [input.options] - diagnostics.
 * @returns {{ kind: 'exact', path: string, handler: (req: object, res: object) => Promise<void> }} the route.
 */
export function createRatesRoute({ rates, options = {} }) {
  const onError = options.onError ?? (() => {})

  return {
    kind: 'exact',
    path: RATES_PATH,
    handler: async (req, res) => {
      if (!isAllowedPeer(req)) {
        sendJson(res, 403, { error: 'forbidden' })
        return
      }
      const method = req?.method ?? 'GET'

      if (method === 'GET' || method === 'HEAD') {
        try {
          sendJson(res, 200, rates.read())
        } catch (error) {
          onError(error)
          sendJson(res, 500, { error: 'rates unavailable' })
        }
        return
      }

      if (method !== 'POST') {
        sendJson(res, 405, { error: 'method not allowed' })
        return
      }

      if (!isJsonRequest(req)) {
        sendJson(res, 415, { error: 'content-type must be application/json' })
        return
      }

      let body
      try {
        body = await readJsonBody(req, MAX_BODY_BYTES)
      } catch (error) {
        sendJson(res, typeof error?.status === 'number' ? error.status : 400, { error: String(error?.message ?? error) })
        return
      }

      try {
        const saved = rates.saveOverrides(body)
        if (saved.ok !== true) {
          sendJson(res, 400, { error: saved.error })
          return
        }
        sendJson(res, 200, { ok: true, saved: saved.saved, rates: rates.read() })
      } catch (error) {
        onError(error)
        sendJson(res, 500, { error: 'could not save' })
      }
    },
  }
}
