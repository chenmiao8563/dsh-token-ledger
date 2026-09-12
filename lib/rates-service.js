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
  DEFAULT_PRICE_SOURCE,
  MAINSTREAM_VENDORS,
  MODELSDEV_URL,
  MODELS_PER_VENDOR,
  OPENROUTER_MODELS_URL,
  PRICE_CURRENCY,
  PRICE_SOURCES,
  QUOTE_CURRENCY,
  REFRESH_INTERVAL_MS,
  VENDOR_LIMIT,
  applyOverrides,
  emptyRatesState,
  parseCatalogue,
  parseFx,
  parseModelsDev,
  validateOverrides,
} from './rates.js'
import { loadLedger, saveLedger } from './store.js'
import { VENDOR_PRICE_SOURCES, vendorRows } from './vendor-prices.js'

/**
 * Refuse to parse a response body larger than this.
 *
 * The per-vendor list is 4.6 MB today (OpenRouter's is ~200 kB), and the cap
 * exists to stop a hostile or broken endpoint from filling memory, not to keep
 * a real response out. Eight megabytes leaves headroom for the list to grow
 * while still being a limit.
 */
const MAX_BODY_BYTES = 8 * 1024 * 1024

/** The per-vendor list is a large file over a possibly slow link, so it gets longer than the rate. */
const MODELS_TIMEOUT_MS = 30000
const FX_TIMEOUT_MS = 20000
/** A vendor's pricing page is small, but a slow cloud portal is still slow. */
const VENDOR_TIMEOUT_MS = 20000

/** The default URL for each source. */
const SOURCE_URLS = { modelsdev: MODELSDEV_URL, openrouter: OPENROUTER_MODELS_URL }

/**
 * Fetch a body with a timeout, without throwing.
 *
 * `json: false` returns the raw text instead of parsing it, which is what the
 * vendor pricing pages need: they are HTML, and the same strictness that protects
 * the JSON sources would reject them for not being JSON.
 *
 * @param {string} url - the URL.
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number, json?: boolean }} [options] - the transport.
 * @returns {Promise<{ ok: true, json?: unknown, text?: string }|{ ok: false, reason: string }>} the result.
 */
export async function fetchJson(url, { fetchImpl = globalThis.fetch, timeoutMs = MODELS_TIMEOUT_MS, json = true } = {}) {
  if (typeof fetchImpl !== 'function') return { ok: false, reason: 'no fetch implementation available' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: json
        ? { accept: 'application/json', 'user-agent': 'dsh-token-ledger' }
        : // A page that blocks unknown clients answers 403 to a bare request; these
          // are the headers a browser sends, which is what makes them readable.
          {
            accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
            'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'user-agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
          },
    })
    if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` }
    const text = await response.text()
    if (text.length > MAX_BODY_BYTES) return { ok: false, reason: `body too large (${text.length} bytes)` }
    if (!json) return { ok: true, text }
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
 * @param {{ source?: string, modelsUrl?: string, fxUrl?: string, perVendor?: number, vendorLimit?: number, fetchImpl?: typeof fetch, now?: () => number, intervalMs?: number, log?: object }} [input.options] - overrides, mostly for tests.
 * @returns {object} the service.
 */
export function createRatesService({ path, options = {} }) {
  const source = PRICE_SOURCES.includes(options.source) ? options.source : DEFAULT_PRICE_SOURCE
  const modelsUrl = options.modelsUrl ?? SOURCE_URLS[source]
  const fxUrl = options.fxUrl ?? DEFAULT_FX_URL
  const perVendor = options.perVendor ?? MODELS_PER_VENDOR
  const vendorLimit = options.vendorLimit ?? VENDOR_LIMIT
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
   * Read the vendors' own pricing pages.
   *
   * Only vendors with a parser are fetched. Each page is independent: one failing
   * is that vendor falling back to the dataset, not the table failing, and every
   * attempt is recorded so the page can show which vendors are live.
   *
   * @param {{ perVendor?: number }} [options] - how many models per vendor.
   * @returns {Promise<{ byVendor: Map<string, object>, outcome: object[] }>} the rows, and the per-vendor result. A page that yields nothing usable counts as a failure rather than as a vendor with no models.
   */
  const readVendorPages = async ({ perVendor: perVendorCount = perVendor } = {}) => {
    const byVendor = new Map()
    const outcome = []
    for (const [vendor, adapter] of Object.entries(VENDOR_PRICE_SOURCES)) {
      const page = await fetchJson(adapter.url, { fetchImpl, timeoutMs: VENDOR_TIMEOUT_MS, json: false })
      if (!page.ok) {
        outcome.push({ vendor, ok: false, url: adapter.url, reason: page.reason })
        log.warn?.('[token-ledger] could not read %s prices from %s: %s', vendor, adapter.url, page.reason)
        continue
      }
      let parsed
      try {
        parsed = adapter.parse(page.text)
      } catch (error) {
        outcome.push({ vendor, ok: false, url: adapter.url, reason: String(error?.message ?? error) })
        continue
      }
      const rows = vendorRows(vendor, parsed, { perVendor: perVendorCount })
      if (rows.length === 0) {
        // The page answered but nothing was recognised: a layout change, not an
        // empty catalogue, so it is reported as a failure and the vendor falls
        // back rather than disappearing.
        outcome.push({ vendor, ok: false, url: adapter.url, reason: 'no price rows found on the page' })
        log.warn?.('[token-ledger] %s pricing page yielded no rows: %s', vendor, adapter.url)
        continue
      }
      byVendor.set(vendor, {
        rows,
        modelCount: parsed.models.length,
        url: adapter.url,
        note: parsed.note ?? '',
        currency: parsed.currency ?? adapter.currency ?? PRICE_CURRENCY,
      })
      outcome.push({ vendor, ok: true, url: adapter.url, models: rows.length })
    }
    return { byVendor, outcome }
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

      const models = await fetchJson(modelsUrl, { fetchImpl, timeoutMs: MODELS_TIMEOUT_MS })
      if (models.ok) {
        const parsed =
          source === 'modelsdev'
            ? parseModelsDev(models.json, { perVendor, vendorLimit })
            : parseCatalogue(models.json, { perVendor, now: at, vendorLimit })
        if (parsed.selected > 0) {
          // Vendors whose own pricing page can be read override their rows. One
          // vendor's page failing is that vendor falling back to the dataset, not
          // the whole table failing, so each is fetched and reported separately.
          const official = await readVendorPages({ perVendor })
          const vendors = parsed.vendors
            .map((entry) => {
              const override = official.byVendor.get(entry.vendor)
              if (override === undefined) return { ...entry, source: 'dataset' }
              return {
                ...entry,
                models: override.rows,
                modelCount: override.modelCount,
                source: 'vendor',
                sourceUrl: override.url,
                note: override.note,
                currency: override.currency,
              }
            })
            // A vendor the dataset does not carry but whose own page does is still
            // a vendor worth showing: Tencent has no entry in the dataset at all.
            .concat(
              [...official.byVendor.entries()]
                .filter(([vendor]) => !parsed.vendors.some((entry) => entry.vendor === vendor))
                .map(([vendor, override]) => ({
                  vendor,
                  modelCount: override.modelCount,
                  models: override.rows,
                  source: 'vendor',
                  sourceUrl: override.url,
                  note: override.note,
                  currency: override.currency,
                })),
            )
          const ordered = [
            ...MAINSTREAM_VENDORS.filter((vendor) => vendors.some((entry) => entry.vendor === vendor)).map((vendor) =>
              vendors.find((entry) => entry.vendor === vendor),
            ),
            ...vendors.filter((entry) => !MAINSTREAM_VENDORS.includes(entry.vendor)),
          ]
          const shown = vendorLimit > 0 ? ordered.slice(0, vendorLimit) : ordered

          state.catalogue = {
            source: modelsUrl,
            sourceId: source,
            fetchedAt: at,
            ok: true,
            vendorCount: shown.length,
            availableVendorCount: ordered.length,
            modelCount: shown.reduce((sum, entry) => sum + entry.models.length, 0),
            totalAvailable: parsed.total,
            perVendor,
            vendorLimit,
            currency: PRICE_CURRENCY,
            vendorPages: official.outcome,
            vendors: shown,
          }
          outcome.catalogue = `ok (${state.catalogue.modelCount} models, ${shown.length} of ${ordered.length} vendors, ${source}; ${official.outcome.filter((entry) => entry.ok).length} vendor page(s) read)`
        } else {
          outcome.catalogue = 'failed (no usable models in the response)'
        }
      } else {
        outcome.catalogue = `failed (${models.reason})`
      }

      const fx = await fetchJson(fxUrl, { fetchImpl, timeoutMs: FX_TIMEOUT_MS })
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
      vendorLimit,
      priceSource: source,
      currency: PRICE_CURRENCY,
      quote: QUOTE_CURRENCY,
      catalogue: {
        available: catalogue !== undefined,
        fetchedAt: catalogue?.fetchedAt ?? null,
        ageMs: catalogue?.fetchedAt === undefined ? null : at - catalogue.fetchedAt,
        source: catalogue?.source ?? modelsUrl,
        sourceId: catalogue?.sourceId ?? source,
        totalAvailable: catalogue?.totalAvailable ?? null,
        modelCount: catalogue?.modelCount ?? 0,
        vendorCount: catalogue?.vendorCount ?? 0,
        availableVendorCount: catalogue?.availableVendorCount ?? null,
        // Which vendor pages were read, and which fell back. The page shows this
        // because "the vendor's own price" is a claim about where a number came
        // from, and a claim that is wrong is worse than no claim.
        vendorPages: catalogue?.vendorPages ?? [],
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
