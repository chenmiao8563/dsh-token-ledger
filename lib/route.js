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

import { BILL_DIMENSIONS, BILL_RANGES, BILL_SECTIONS, billToCsv, buildBillSections } from './bill.js'
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
 * Price the overview's own periods, so the page can show what they cost.
 *
 * The arithmetic is the bill's, called four times with the same prices, rather
 * than a second estimator living next to the first: the number under "this month"
 * on the overview and the number on the bill for the same month have to be the
 * same number, and the only way to be sure is for them to be the same code.
 *
 * `cost` is null when there is no price at all to apply — an empty catalogue, or
 * prices the bill cannot convert — because a confident `¥0.00` for a month that
 * was never priced is worse than a dash.
 *
 * @param {object} input - the pricing inputs.
 * @param {object} input.snapshot - the live ledger snapshot.
 * @param {() => object} [input.catalogue] - the current price catalogue.
 * @param {object[]} [input.subscriptions] - configured monthly plans.
 * @param {Date} input.now - the clock.
 * @param {(error: unknown) => void} [input.onError] - diagnostics.
 * @returns {{ currency: string|null, rate: number|null, priced: boolean, byRange: object|null }} the costs.
 */
function priceOverview({ snapshot, catalogue, subscriptions = [], now, onError = () => {} }) {
  let payload
  try {
    payload = catalogue?.()
  } catch (error) {
    // A price catalogue that cannot be read is not an overview that cannot be
    // read: the tokens are still true, so they are served without a cost.
    onError(error)
    return { currency: null, rate: null, priced: false, byRange: null }
  }

  const bill = buildBillSections({
    snapshot,
    catalogue: payload,
    subscriptions,
    dims: ['vendor'],
    ranges: ['today', 'week', 'month', 'year', 'all'],
    now,
  })
  const first = bill.sections[0]
  if (first === undefined) return { currency: null, rate: null, priced: false, byRange: null }

  const byRange = {}
  for (const section of bill.sections) {
    byRange[section.range.kind] = {
      cost: section.totals.totalCost,
      usageCost: section.totals.usageCost,
      subscriptionCost: section.totals.subscriptionCost,
      // The tokens behind a cost the bill could not name: shown as a note so the
      // number is not read as covering usage it does not cover.
      unpricedTokens: section.rows.reduce((sum, row) => sum + (row.unpricedTokens ?? 0), 0),
      unpricedCost: section.totals.unpricedCost === true,
    }
  }
  return { currency: bill.currency, rate: bill.fxRate, priced: true, byRange }
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
 * @param {() => object} [input.catalogue] - the current price catalogue, for the estimated cost.
 * @param {object[]} [input.subscriptions] - configured monthly plans.
 * @param {{ now?: () => Date, onError?: (error: unknown) => void }} [input.options] - clock and diagnostics.
 * @returns {{ kind: 'exact', path: string, handler: (req: object, res: object) => void }} the route.
 */
export function createOverviewRoute({ ledger, catalogue, subscriptions = [], options = {} }) {
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
        const at = now()
        const snapshot = ledger.snapshot()
        const payload = buildOverview(snapshot, { now: at })
        // A cost is a nice-to-have next to tokens that are the point of the page,
        // so a failure to price them degrades to "no cost" rather than to a 500.
        let cost = { currency: null, rate: null, priced: false, byRange: null }
        if (typeof catalogue === 'function') {
          try {
            cost = priceOverview({ snapshot, catalogue, subscriptions, now: at, onError })
          } catch (error) {
            onError(error)
          }
        }
        sendJson(res, 200, { ...payload, cost })
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
 * `POST { refresh: true }` runs the same fetch the timer would, on demand. The
 * page is the only place that knows someone is looking at stale numbers and
 * wants them now, and waiting up to half an hour for the timer is not an answer
 * to "refresh". The fetch is the slow part — vendor pages are read one at a
 * time — so this request can take a while, and the page says so while it waits.
 *
 * @param {object} input - the route's dependencies.
 * @param {{ read: () => object, saveOverrides: (body: unknown) => object, refresh?: (input: object) => Promise<object> }} input.rates - the rates service.
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

      // The outcome is reported even though it is not an error: a source that
      // could not be reached leaves the previous numbers in place, which is a
      // perfectly renderable state, and the page still has to be able to say that
      // what it is showing is not what a reader just asked for.
      let refresh = null
      if (body?.refresh === true && typeof rates.refresh === 'function') {
        try {
          refresh = await rates.refresh({ reason: 'page' })
        } catch (error) {
          onError(error)
          sendJson(res, 502, { error: 'refresh failed' })
          return
        }
      }

      try {
        const saved = rates.saveOverrides(body)
        if (saved.ok !== true) {
          sendJson(res, 400, { error: saved.error })
          return
        }
        sendJson(res, 200, { ok: true, saved: saved.saved, refresh, rates: rates.read() })
      } catch (error) {
        onError(error)
        sendJson(res, 500, { error: 'could not save' })
      }
    },
  }
}

/** The path the browser half reads a bill from. */
export const BILL_PATH = '/api/token-ledger/bill'

/**
 * Read the query string of a request.
 *
 * @param {object} req - a node `IncomingMessage`-shaped object.
 * @returns {URLSearchParams} the parameters.
 */
function queryOf(req) {
  const url = String(req?.url ?? '')
  const at = url.indexOf('?')
  return new URLSearchParams(at === -1 ? '' : url.slice(at + 1))
}

/**
 * Read a comma-separated query parameter as a list of allowed values.
 *
 * A stale or misspelled value is dropped rather than refused, and an empty list
 * falls back to the default: a bill is a read, so a link that carries a parameter
 * this version no longer knows should still answer.
 *
 * @param {string|null} raw - the parameter value.
 * @param {string[]} allowed - the values this route understands.
 * @param {string[]} fallback - what to use when nothing usable was asked for.
 * @returns {string[]} the requested values, in the order asked for.
 */
function listParam(raw, allowed, fallback) {
  if (typeof raw !== 'string' || raw.trim() === '') return [...fallback]
  const wanted = raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => allowed.includes(value))
  return wanted.length > 0 ? [...new Set(wanted)] : [...fallback]
}

/**
 * Build the route that serves a bill, as JSON or as a downloadable CSV.
 *
 * Both forms come from the same computation, so an exported file is what the page
 * was showing rather than a second implementation of the same arithmetic. `by` and
 * `range` are comma-separated lists: the page asks for one section at a time, and
 * the export asks for every section over every range at once.
 *
 * `fold=small` is the one thing the page asks for and the export must not: it lets the
 * session list stand in one summarised row for the sessions that are cheap or barely
 * used. A file is read for its detail, so the export leaves the flag off and gets every
 * session.
 *
 * @param {object} input - the route's dependencies.
 * @param {() => object} input.snapshot - the live ledger snapshot.
 * @param {() => object} input.catalogue - the current price catalogue.
 * @param {object[]} [input.subscriptions] - configured monthly plans.
 * @param {() => Record<string, string>} [input.providerNames] - the display name of each configured provider, so a vendor row can read `BOS-API` rather than `bos`.
 * @param {boolean} [input.foldSmallSessions] - whether the page may ask for the summarised session list (default true); `false` returns every row to every caller.
 * @param {{ cost?: number, calls?: number }} [input.smallSession] - what counts as a small session; `cost` is read in the bill's own currency.
 * @param {{ now?: () => Date, onError?: (error: unknown) => void }} [input.options] - clock and diagnostics.
 * @returns {{ kind: 'exact', path: string, handler: (req: object, res: object) => void }} the route.
 */
export function createBillRoute({
  snapshot,
  catalogue,
  subscriptions = [],
  providerNames,
  foldSmallSessions = true,
  smallSession = {},
  options = {},
}) {
  const now = options.now ?? (() => new Date())
  const onError = options.onError ?? (() => {})
  const names =
    typeof providerNames === 'function'
      ? () => {
          try {
            return providerNames() ?? {}
          } catch (error) {
            // The names are cosmetic; a settings file that cannot be read must not
            // cost anyone a bill.
            onError(error)
            return {}
          }
        }
      : () => ({})

  return {
    kind: 'exact',
    path: BILL_PATH,
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

      const query = queryOf(req)
      try {
        // The page asks for one grouping over one range at a time; the export asks
        // for all of them, which is why these are lists and not single values.
        const dims = listParam(query.get('by'), BILL_DIMENSIONS, BILL_SECTIONS)
        const ranges = listParam(query.get('range'), BILL_RANGES, ['month'])
        // Only the page asks to fold, and only when the config allows it; a file — even
        // one built by handing this URL to a browser — keeps every row.
        const fold = foldSmallSessions && (query.get('fold') ?? '').toLowerCase() === 'small'
        const bill = buildBillSections({
          snapshot: snapshot(),
          catalogue: catalogue(),
          subscriptions,
          providerNames: names(),
          dims,
          ranges,
          fold,
          smallSessionCost: smallSession.cost,
          smallSessionCalls: smallSession.calls,
          now: now(),
        })
        if ((query.get('format') ?? 'json').toLowerCase() === 'csv') {
          const text = billToCsv(bill)
          const stamp = now().toISOString().slice(0, 10)
          const name = dims.length === 1 && ranges.length === 1 ? `token-bill-${dims[0]}-${ranges[0]}-${stamp}.csv` : `token-bill-all-${stamp}.csv`
          res.writeHead(200, {
            'content-type': 'text/csv; charset=utf-8',
            'content-length': Buffer.byteLength(text),
            'cache-control': 'no-store',
            'content-disposition': `attachment; filename="${name}"`,
          })
          res.end(text)
          return
        }
        sendJson(res, 200, bill)
      } catch (error) {
        onError(error)
        sendJson(res, 500, { error: 'bill unavailable' })
      }
    },
  }
}
