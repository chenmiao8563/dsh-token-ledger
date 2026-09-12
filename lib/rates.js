/**
 * Model prices and the USD/CNY rate.
 *
 * ## Offline first
 *
 * Nothing here is trusted to be online. A network fetch is an *enrichment*: when
 * it works the table shows live vendor prices, and when it does not the last
 * successful result is still served from disk, and hand-entered values always
 * win over both. A DSH host behind a firewall, or on a machine whose network
 * blocks an endpoint — which happens intermittently on the machine this was
 * built against — must still show a usable page.
 *
 * ## What a price is
 *
 * Prices are held as **US dollars per one million tokens**, because that is how
 * vendors quote them and how a person reads them. OpenRouter publishes USD per
 * *token* as a decimal string, so the parser scales by 1e6 once, at the edge,
 * and nothing downstream has to remember which unit it is holding.
 *
 * ## Freshness is part of the answer
 *
 * Every served value carries where it came from and when, because a stale price
 * that looks live is worse than no price: a user cannot tell whether a number
 * they are reading was fetched a minute ago or typed by hand last month.
 *
 * @module dsh-token-ledger/rates
 */

/** Where live model prices come from by default: keyless, and covers many vendors. */
export const DEFAULT_MODELS_URL = 'https://openrouter.ai/api/v1/models'

/** Where the USD rate comes from by default: keyless, and reports its own update time. */
export const DEFAULT_FX_URL = 'https://open.er-api.com/v6/latest/USD'

/** How often to refresh, in milliseconds. */
export const REFRESH_INTERVAL_MS = 30 * 60 * 1000

/** How many of each vendor's newest models to publish. */
export const MODELS_PER_VENDOR = 3

/** The currency the ledger prices are quoted in. */
export const PRICE_CURRENCY = 'USD'

/** The currency to convert into for display. */
export const QUOTE_CURRENCY = 'CNY'

/** Variant suffixes OpenRouter appends to a model id; they are not new models. */
const VARIANT_SUFFIX = /:(batch|free|extended|thinking|nitro|online|floor|beta)$/

/** A number that can be a price: non-negative and finite. */
function toPrice(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
  }
  return null
}

/**
 * Read one price out of an OpenRouter pricing block, in USD per million tokens.
 *
 * The scaling is the one floating-point step in this module, and it produces
 * artefacts: `0.0000002 * 1e6` is `0.19999999999999998`, which would be rendered
 * straight into the price table. Rounding to six decimals removes them; a real
 * price per million tokens does not need more, since the finest value OpenRouter
 * publishes is a hundredth of a cent per million.
 *
 * @param {object} pricing - the vendor's pricing object.
 * @param {string} field - the field name (`prompt`, `completion`, `input_cache_read`, …).
 * @returns {number|null} USD per 1M tokens, or null when absent or unusable.
 */
export function pricePerMillion(pricing, field) {
  const perToken = toPrice(pricing?.[field])
  if (perToken === null) return null
  return Math.round(perToken * 1e6 * 1e6) / 1e6
}

/**
 * Turn an OpenRouter model list into the rows the rates view shows.
 *
 * Only the newest few models per vendor are published: the full list runs to
 * hundreds of entries, most of them superseded, and a table nobody can scan is
 * not a price list. Variants (`:batch`, `:free`, …) are excluded from the
 * selection because they are the same model at a different price, and letting
 * them count would fill a vendor's quota with one model three times.
 *
 * @param {unknown} payload - the parsed response body.
 * @param {{ perVendor?: number, now?: number }} [options] - selection options.
 * @returns {{ vendors: object[], selected: number, total: number }} the catalogue rows.
 */
export function parseCatalogue(payload, { perVendor = MODELS_PER_VENDOR, now = Date.now() } = {}) {
  const list = Array.isArray(payload?.data) ? payload.data : []
  const usable = list.filter((model) => typeof model?.id === 'string' && model.id.includes('/'))

  const byVendor = new Map()
  for (const model of usable) {
    if (VARIANT_SUFFIX.test(model.id)) continue
    // A model OpenRouter has already retired must not be offered as "latest".
    if (typeof model.expiration_date === 'string' && model.expiration_date !== '') {
      const expires = Date.parse(model.expiration_date)
      if (Number.isFinite(expires) && expires < now) continue
    }
    const prices = {
      input: pricePerMillion(model.pricing, 'prompt'),
      output: pricePerMillion(model.pricing, 'completion'),
      cacheRead: pricePerMillion(model.pricing, 'input_cache_read'),
      cacheWrite: pricePerMillion(model.pricing, 'input_cache_write'),
    }
    // A model with no published input or output price is not a price-list entry:
    // it would render as four dashes and, worse, take one of the vendor's few
    // slots from a model that does have a price. Three such rows exist in the
    // live list at the time of writing, so this is not hypothetical.
    if (prices.input === null && prices.output === null) continue
    const vendor = model.id.slice(0, model.id.indexOf('/'))
    if (!byVendor.has(vendor)) byVendor.set(vendor, [])
    byVendor.get(vendor).push({ model, prices })
  }

  const vendors = []
  for (const [vendor, entries] of byVendor) {
    const newest = [...entries]
      .sort((left, right) => (right.model.created ?? 0) - (left.model.created ?? 0))
      .slice(0, perVendor)
      .map(({ model, prices }) => ({
        id: model.id,
        name: typeof model.name === 'string' ? model.name : model.id,
        vendor,
        created: typeof model.created === 'number' ? model.created : null,
        contextLength: typeof model.context_length === 'number' ? model.context_length : null,
        prices,
      }))
    vendors.push({ vendor, modelCount: entries.length, models: newest })
  }

  vendors.sort((left, right) => right.modelCount - left.modelCount || left.vendor.localeCompare(right.vendor))
  return {
    vendors,
    total: usable.length,
    selected: vendors.reduce((sum, entry) => sum + entry.models.length, 0),
  }
}

/**
 * Read the USD/CNY rate out of an exchangerate response.
 *
 * @param {unknown} payload - the parsed response body.
 * @param {{ quote?: string }} [options] - the target currency.
 * @returns {{ base: string, quote: string, rate: number, updatedAt: number|null }|undefined} the rate, or undefined when unusable.
 */
export function parseFx(payload, { quote = QUOTE_CURRENCY } = {}) {
  const rate = toPrice(payload?.rates?.[quote])
  if (rate === null || rate === 0) return undefined
  const updated = typeof payload?.time_last_update_unix === 'number' ? payload.time_last_update_unix * 1000 : null
  return {
    base: typeof payload?.base_code === 'string' ? payload.base_code : 'USD',
    quote,
    rate,
    updatedAt: updated,
  }
}

/**
 * Merge hand-entered values over fetched ones.
 *
 * A hand-entered price is a deliberate statement about a route the user is
 * actually billed for, so it outranks a fetched one and survives every refresh.
 * A null override clears the price rather than setting it to zero, because "not
 * priced" and "free" are different claims.
 *
 * Hand-entered values for models no fetch has ever described are published as
 * their own group. That case is the whole offline story: on a host that has
 * never reached the network there are no catalogue rows to attach an override
 * to, and without this the values a user typed would be stored and then never
 * shown — a manual entry path that silently discards what it is given. The
 * group is flagged `manualOnly` so a reader can tell it apart from a vendor the
 * catalogue actually described.
 *
 * @param {{ vendors?: object[], fx?: object, overrides?: object }} input - the fetched state and the overrides.
 * @returns {{ vendors: object[], fx: object, overriddenModels: number, fxOverridden: boolean }} the effective view.
 */
export function applyOverrides({ vendors = [], fx = undefined, overrides = {} } = {}) {
  const modelOverrides = overrides.models ?? {}
  let overriddenModels = 0
  const covered = new Set()

  const merged = vendors.map((entry) => ({
    ...entry,
    models: entry.models.map((model) => {
      covered.add(model.id)
      const override = modelOverrides[model.id]
      if (override === undefined || override === null || typeof override !== 'object') return { ...model, source: 'fetched' }
      overriddenModels += 1
      const prices = { ...model.prices }
      for (const key of ['input', 'output', 'cacheRead', 'cacheWrite']) {
        if (!(key in override)) continue
        const value = toPrice(override[key])
        prices[key] = value
      }
      return { ...model, prices, source: 'manual' }
    }),
  }))

  const orphans = new Map()
  for (const [id, override] of Object.entries(modelOverrides)) {
    if (covered.has(id) || override === null || typeof override !== 'object') continue
    const prices = { input: null, output: null, cacheRead: null, cacheWrite: null }
    for (const key of ['input', 'output', 'cacheRead', 'cacheWrite']) {
      if (key in override) prices[key] = toPrice(override[key])
    }
    const slash = id.indexOf('/')
    // An id with no vendor part is still a usable row; it just has no vendor to
    // be grouped under, which the page renders as its own manual group.
    const vendor = slash > 0 ? id.slice(0, slash) : ''
    if (!orphans.has(vendor)) orphans.set(vendor, [])
    orphans.get(vendor).push({ id, name: id, vendor, created: null, contextLength: null, prices, source: 'manual' })
    overriddenModels += 1
  }
  for (const [vendor, models] of [...orphans.entries()].sort((left, right) => left[0].localeCompare(right[0]))) {
    merged.push({ vendor, modelCount: models.length, manualOnly: true, models })
  }

  const fxOverride = overrides.fx
  const fxRate = fxOverride === undefined || fxOverride === null ? null : toPrice(fxOverride.rate)
  const effectiveFx =
    fxRate === null || fxRate === 0
      ? // A rate of `null` rather than `undefined` when there is none: the page
        // distinguishes "not fetched yet" from "fetched and zero" by this field,
        // and an absent key would make that check depend on the reader.
        { base: 'USD', quote: QUOTE_CURRENCY, rate: null, updatedAt: null, ...(fx ?? {}), source: fx === undefined ? 'none' : 'fetched' }
      : { base: 'USD', quote: fxOverride.quote ?? QUOTE_CURRENCY, rate: fxRate, updatedAt: fxOverride.updatedAt ?? null, source: 'manual' }

  return { vendors: merged, fx: effectiveFx, overriddenModels, fxOverridden: fxRate !== null && fxRate !== 0 }
}

/**
 * Validate a patch coming from the UI.
 *
 * The route is reachable by anything on the machine, so nothing here trusts the
 * body: unknown keys are dropped, prices must be non-negative finite numbers or
 * null, and the result is a fresh object rather than the parsed input.
 *
 * @param {unknown} body - the parsed request body.
 * @returns {{ ok: true, patch: object }|{ ok: false, error: string }} the accepted patch or why it was refused.
 */
export function validateOverrides(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'body must be an object' }
  }
  const patch = {}

  if (body.fx !== undefined) {
    if (body.fx === null) {
      patch.fx = null
    } else if (typeof body.fx !== 'object' || Array.isArray(body.fx)) {
      return { ok: false, error: 'fx must be an object or null' }
    } else {
      const rate = toPrice(body.fx.rate)
      if (rate === null || rate === 0) return { ok: false, error: 'fx.rate must be a positive number' }
      patch.fx = { rate }
    }
  }

  if (body.models !== undefined) {
    if (typeof body.models !== 'object' || body.models === null || Array.isArray(body.models)) {
      return { ok: false, error: 'models must be an object' }
    }
    const models = {}
    for (const [id, value] of Object.entries(body.models)) {
      if (id.length === 0 || id.length > 200) return { ok: false, error: `model id out of range: ${id.slice(0, 40)}` }
      if (value === null) {
        models[id] = null
        continue
      }
      if (typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: `price for ${id} must be an object or null` }
      const prices = {}
      for (const key of ['input', 'output', 'cacheRead', 'cacheWrite']) {
        if (!(key in value)) continue
        const price = toPrice(value[key])
        if (price === null && value[key] !== null) return { ok: false, error: `${id}.${key} must be a non-negative number or null` }
        prices[key] = price
      }
      models[id] = prices
    }
    patch.models = models
  }

  return { ok: true, patch }
}

/**
 * A fresh, empty rates state.
 *
 * @returns {{ version: number, catalogue: object|undefined, fx: object|undefined, overrides: { models: object, fx: null } }} the state.
 */
export function emptyRatesState() {
  return { version: 1, catalogue: undefined, fx: undefined, overrides: { models: {}, fx: null } }
}
