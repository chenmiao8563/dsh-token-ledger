/**
 * The rates service: fetch, cache, schedule and serve.
 *
 * Split from `rates.js` on purpose. That module is pure — payloads in, rows out —
 * and is tested without a socket. This one owns everything that can fail: the
 * network, the cache file, the timer, and the merge of hand-entered values over
 * fetched ones. Its whole job is to make those failures invisible to the page.
 *
 * The rules it enforces:
 *
 * - **A failed refresh never clears a good value.** The last successful catalogue
 *   and rate stay served, with their fetch time, so the page can say how old they
 *   are instead of going blank.
 * - **A fetch failure is not an error state.** It is the normal case on a
 *   firewalled host, so it is recorded as `ok: false` with a reason and nothing
 *   throws upward.
 * - **Overrides outlive refreshes.** They live in their own section of the cache
 *   file and are re-applied to every fetch.
 * - **One fetch serves every client.** The timer runs in the host, so opening the
 *   settings page does not cause a request, and an offline host does not retry
 *   once per page view.
 *
 * @module dsh-token-ledger/rates-service
 */

import {
  DEFAULT_FX_URL,
  DEFAULT_MODELS_URL,
  MODELS_PER_VENDOR,
  PRICE_CURRENCY,
  QUOTE_CURRENCY,
  REFRESH_INTERVAL_MS,
  applyOverrides,
  emptyRatesState,
  parseCatalogue,
  parseFx,
  validateOverrides,
} from './rates.js'
import { loadLedger, saveLedger } from './store.js'

/** Refuse to parse a response body larger than this; the model list is ~200 kB. */
const MAX_BODY_BYTES = 4 * 1024 * 1024

/**
 * Fetch and parse JSON with a timeout, without throwing.
 *
 * @param {string} url - the URL.
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [options] - the transport.
 * @returns {Promise<{ ok: true, json: unknown }|{ ok: false, reason: string }>} the result.
 */
export async function fetchJson(url, { fetchImpl = globalThis.fetch, timeoutMs = 20000 } = {}) {
  if (typeof fetchImpl !== 'function') return { ok: false, reason: 'no fetch implementation available' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { accept: 'application/json', 'user-agent': 'dsh-token-ledger' },
    })
    if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` }
    const text = await response.text()
    if (text.length > MAX_BODY_BYTES) return { ok: false, reason: `body too large (${text.length} bytes)` }
    return { ok: true, json: JSON.parse(text) }
  } catch (error) {
    const reason = error?.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : String(error?.message ?? error)
    return { ok: false, reason }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Create the rates service.
 *
 * @param {object} input - the service's dependencies.
 * @param {string} input.path - where to cache fetched state.
 * @param {{ modelsUrl?: string, fxUrl?: string, perVendor?: number, fetchImpl?: typeof fetch, now?: () => number, intervalMs?: number, log?: object }} [input.options] - overrides, mostly for tests.
 * @returns {object} the service.
 */
export function createRatesService({ path, options = {} }) {
  const modelsUrl = options.modelsUrl ?? DEFAULT_MODELS_URL
  const fxUrl = options.fxUrl ?? DEFAULT_FX_URL
  const perVendor = options.perVendor ?? MODELS_PER_VENDOR
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const now = options.now ?? (() => Date.now())
  const intervalMs = options.intervalMs ?? REFRESH_INTERVAL_MS
  const log = options.log ?? {}

  let state = loadLedger(path) ?? emptyRatesState()
  if (state.version !== 1) state = emptyRatesState()
  if (state.overrides === undefined || typeof state.overrides !== 'object') state.overrides = { models: {}, fx: null }
  if (typeof state.overrides.models !== 'object' || state.overrides.models === null) state.overrides.models = {}

  let timer
  let inFlight

  /** Write the state atomically, swallowing write failures. */
  const persist = () => {
    try {
      saveLedger(path, state)
    } catch (error) {
      log.warn?.('[token-ledger] could not write rates cache: %o', error)
    }
  }

  /**
   * Fetch both sources and cache whatever worked.
   *
   * The two are independent: a blocked FX endpoint must not cost the user the
   * model prices, and vice versa.
   *
   * @param {{ reason?: string }} [trigger] - why the refresh ran, for the log.
   * @returns {Promise<{ catalogue: string, fx: string }>} per-source outcome.
   */
  const refresh = async (trigger = {}) => {
    if (inFlight !== undefined) return inFlight
    inFlight = (async () => {
      const at = now()
      const outcome = { catalogue: 'failed', fx: 'failed' }

      const models = await fetchJson(modelsUrl, { fetchImpl })
      if (models.ok) {
        const parsed = parseCatalogue(models.json, { perVendor, now: at })
        if (parsed.selected > 0) {
          state.catalogue = {
            source: modelsUrl,
            fetchedAt: at,
            ok: true,
            vendorCount: parsed.vendors.length,
            modelCount: parsed.selected,
            totalAvailable: parsed.total,
            perVendor,
            currency: PRICE_CURRENCY,
            vendors: parsed.vendors,
          }
          outcome.catalogue = `ok (${parsed.selected} models, ${parsed.vendors.length} vendors)`
        } else {
          outcome.catalogue = 'failed (no usable models in the response)'
        }
      } else {
        outcome.catalogue = `failed (${models.reason})`
      }

      const fx = await fetchJson(fxUrl, { fetchImpl })
      if (fx.ok) {
        const parsed = parseFx(fx.json, { quote: QUOTE_CURRENCY })
        if (parsed !== undefined) {
          state.fx = { source: fxUrl, fetchedAt: at, ok: true, ...parsed }
          outcome.fx = `ok (1 ${parsed.base} = ${parsed.rate} ${parsed.quote})`
        } else {
          outcome.fx = 'failed (no usable rate in the response)'
        }
      } else {
        outcome.fx = `failed (${fx.reason})`
      }

      persist()
      // The last *attempt* is recorded separately from the last success. A page
      // that only knew "last successful fetch" could not tell a user that the
      // refresh has been failing for an hour while showing hour-old numbers.
      state.lastRefresh = { at, catalogue: outcome.catalogue, fx: outcome.fx }
      persist()
      log.info?.('[token-ledger] rates refresh (%s): catalogue %s, fx %s', trigger.reason ?? 'timer', outcome.catalogue, outcome.fx)
      inFlight = undefined
      return outcome
    })()
    return inFlight
  }

  /** Schedule the periodic refresh; the timer must not hold the host open. */
  const start = () => {
    if (timer !== undefined) return
    timer = setInterval(() => {
      void refresh({ reason: 'timer' })
    }, intervalMs)
    timer.unref?.()
  }

  const stop = () => {
    if (timer === undefined) return
    clearInterval(timer)
    timer = undefined
  }

  /**
   * The effective state, with overrides applied and freshness attached.
   *
   * @returns {object} everything the rates page needs, in plain JSON.
   */
  const read = () => {
    const at = now()
    const catalogue = state.catalogue
    const { vendors, fx, overriddenModels, fxOverridden } = applyOverrides({
      vendors: catalogue?.vendors ?? [],
      fx: state.fx,
      overrides: state.overrides,
    })
    return {
      plugin: 'token-ledger',
      generatedAt: at,
      refreshIntervalMs: intervalMs,
      perVendor,
      currency: PRICE_CURRENCY,
      quote: QUOTE_CURRENCY,
      catalogue: {
        available: catalogue !== undefined,
        fetchedAt: catalogue?.fetchedAt ?? null,
        ageMs: catalogue?.fetchedAt === undefined ? null : at - catalogue.fetchedAt,
        source: catalogue?.source ?? modelsUrl,
        totalAvailable: catalogue?.totalAvailable ?? null,
        modelCount: catalogue?.modelCount ?? 0,
        vendorCount: catalogue?.vendorCount ?? 0,
      },
      fx: {
        available: fx?.rate !== undefined && fx?.rate !== null,
        rate: fx?.rate ?? null,
        base: fx?.base ?? 'USD',
        quote: fx?.quote ?? QUOTE_CURRENCY,
        source: fx?.source ?? fxUrl,
        fetchedAt: fx?.fetchedAt ?? null,
        ageMs: typeof fx?.fetchedAt === 'number' ? at - fx.fetchedAt : null,
        overridden: fxOverridden,
      },
      overriddenModels,
      lastRefresh: {
        at: state.lastRefresh?.at ?? null,
        ageMs: typeof state.lastRefresh?.at === 'number' ? at - state.lastRefresh.at : null,
        catalogue: state.lastRefresh?.catalogue ?? null,
        fx: state.lastRefresh?.fx ?? null,
      },
      vendors,
    }
  }

  /**
   * Store hand-entered values.
   *
   * @param {unknown} body - the request body.
   * @returns {{ ok: true, saved: object }|{ ok: false, error: string }} the outcome.
   */
  const saveOverrides = (body) => {
    const validated = validateOverrides(body)
    if (!validated.ok) return validated
    const patch = validated.patch
    if (patch.fx !== undefined) state.overrides.fx = patch.fx
    if (patch.models !== undefined) {
      for (const [id, value] of Object.entries(patch.models)) {
        if (value === null) delete state.overrides.models[id]
        else state.overrides.models[id] = value
      }
    }
    persist()
    return { ok: true, saved: { models: Object.keys(state.overrides.models).length, fx: state.overrides.fx !== null } }
  }

  return { refresh, start, stop, read, saveOverrides, statePath: path }
}
