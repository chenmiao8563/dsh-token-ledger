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
