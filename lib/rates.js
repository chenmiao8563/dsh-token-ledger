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

/** OpenRouter's public model list: a gateway's own price list, and the widest model coverage. */
export const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models'

/**
 * models.dev, a community-maintained per-vendor price list.
 *
 * Every vendor's own model-list API returns model ids and no prices — the price
 * only exists on their pricing page — so a per-vendor price list has to come from
 * somewhere that reads those pages. This is that somewhere, and it is a curated
 * data set rather than a vendor API: 213 providers, each model with `input`,
 * `output` and usually `cache_read`/`cache_write` in USD per million tokens, plus
 * a `release_date`. Spot-checking it against the vendors' own pricing pages is
 * what earns it the "vendor list price" label in the docs; where a number could
 * not be found on the vendor's page, the docs say so.
 */
export const MODELSDEV_URL = 'https://models.dev/api.json'

/** Where live model prices come from by default. */
export const DEFAULT_MODELS_URL = MODELSDEV_URL

/** The price sources this plugin can read. */
export const PRICE_SOURCES = ['modelsdev', 'openrouter']

/** Which price source to use unless config says otherwise. */
export const DEFAULT_PRICE_SOURCE = 'modelsdev'

/**
 * The models.dev provider id for each vendor this page publishes.
 *
 * The two catalogues do not agree on ids — models.dev calls Qwen's provider
 * `alibaba`, xAI's `xai`, Z.ai's `zai`, Meta's `meta` and Amazon's
 * `amazon-bedrock` — and a vendor with no entry simply does not appear rather
 * than appearing empty. Where a vendor publishes through a platform of its own,
 * the platform id is the right one: ByteDance's Seed models are sold on
 * Volcengine Ark, so `bytedance-seed` reads from `volcengine`.
 */
const MODELSDEV_PROVIDER = {
  openai: 'openai',
  anthropic: 'anthropic',
  google: 'google',
  deepseek: 'deepseek',
  qwen: 'alibaba',
  'x-ai': 'xai',
  'z-ai': 'zai',
  kimi: 'moonshotai',
  minimax: 'minimax',
  xiaomi: 'xiaomi',
  bytedance: 'volcengine',
}

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

/**
 * The vendors this page publishes, most familiar first.
 *
 * A curated list rather than everything a source offers: the per-vendor price
 * list carries 213 providers and most are one-model resellers nobody is shopping
 * for, and a table of 213 is not a price list. The order is editorial — sorting
 * by model count alone puts `qwen` above `anthropic` and drifts whenever a
 * publisher ships a batch — and every id here was read off a live source rather
 * than guessed.
 */
export const MAINSTREAM_VENDORS = [
  'openai',
  'anthropic',
  'google',
  'deepseek',
  'qwen',
  'x-ai',
  'z-ai',
  'kimi',
  'minimax',
  'tencent',
  'xiaomi',
  'bytedance',
]

/**
 * How each vendor's name is written.
 *
 * The ids are source keys and read like machine output — `z-ai`, `x-ai`,
 * `bytedance` — while these are the vendors' own spellings, which is what belongs
 * on a page a person reads.
 */
export const VENDOR_NAMES = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  deepseek: 'DeepSeek',
  qwen: 'Qwen',
  'x-ai': 'xAI',
  'z-ai': 'Z.ai',
  kimi: 'Kimi',
  minimax: 'MiniMax',
  tencent: 'Tencent',
  xiaomi: 'Xiaomi',
  bytedance: 'ByteDance',
}

/**
 * Write a vendor id the way the vendor writes it.
 *
 * @param {string} vendor - the vendor id.
 * @returns {string} the display name, or the id capitalised when it is unknown.
 */
export function vendorName(vendor) {
  if (typeof vendor !== 'string' || vendor === '') return ''
  return VENDOR_NAMES[vendor] ?? vendor.charAt(0).toUpperCase() + vendor.slice(1)
}

/** How many vendors to publish by default. */
export const VENDOR_LIMIT = 15

/**
 * Rank a vendor by how familiar it is.
 *
 * @param {string} vendor - the vendor id.
 * @returns {number} the index in {@link MAINSTREAM_VENDORS}, or one past the end for a vendor that is not on it.
 */
function vendorRank(vendor) {
  const index = MAINSTREAM_VENDORS.indexOf(vendor)
  return index === -1 ? MAINSTREAM_VENDORS.length : index
}

/**
 * Whether a vendor id is a publisher alias rather than a vendor.
 *
 * OpenRouter publishes floating aliases as `~vendor/model-latest`. Counting them
 * would list the same vendor twice under a name nobody recognises — and the
 * `~` will not survive being dropped into a logo badge either.
 *
 * @param {string} vendor - the vendor id.
 * @returns {boolean} whether it is an alias.
 */
function isAliasVendor(vendor) {
  return vendor.startsWith('~')
}

/**
 * Every token that names a vendor, so a hosted model can be told from an own one.
 *
 * Platforms resell other vendors' models — Bedrock lists `openai.gpt-6-astra`,
 * Nvidia lists `deepseek-ai/deepseek-v4-pro`, Alibaba lists DeepSeek too — and
 * those rows are real prices for the platform. They are not, however, what a
 * reader means by "Mistral's newest models": one such row took a Mistral slot
 * away from Mistral itself. This set sorts a vendor's own models ahead of the
 * ones it hosts; it never drops a row.
 */
const VENDOR_TOKENS = [...new Set([...MAINSTREAM_VENDORS, ...Object.values(MODELSDEV_PROVIDER)])]

/**
 * Whether a model looks like another vendor's.
 *
 * @param {string} vendor - the vendor the row is grouped under.
 * @param {string} id - the model id.
 * @param {string} name - the model name.
 * @returns {boolean} true when the row names a different vendor.
 */
function isHostedModel(vendor, id, name) {
  const haystack = `${id} ${name}`.toLowerCase()
  const own = [vendor, MODELSDEV_PROVIDER[vendor]].filter((value) => typeof value === 'string')
  return VENDOR_TOKENS.some((token) => token.length > 2 && !own.includes(token) && haystack.includes(token))
}

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
 * them count would fill a vendor's quota with one model three times. Publisher
 * aliases are excluded outright, and only the most familiar
 * {@link VENDOR_LIMIT} vendors survive, in {@link MAINSTREAM_VENDORS} order.
 *
 * A model with no published input or output price is dropped rather than listed:
 * it would render as four dashes and take one of the vendor's few slots from a
 * model that has a real price. Five such rows exist in the live list — the
 * `openrouter/auto*` routers, published as `prompt: "-1"`.
 *
 * @param {unknown} payload - the parsed response body.
 * @param {{ perVendor?: number, now?: number, vendorLimit?: number }} [options] - selection options. `vendorLimit: 0` publishes every vendor.
 * @returns {{ vendors: object[], selected: number, total: number, availableVendorCount: number }} the catalogue rows.
 */
export function parseCatalogue(payload, { perVendor = MODELS_PER_VENDOR, now = Date.now(), vendorLimit = VENDOR_LIMIT } = {}) {
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
    if (isAliasVendor(vendor)) continue
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

  // Familiar vendors first, then whoever publishes the most, then alphabetical —
  // so the order is stable from one refresh to the next and the 15 that survive
  // the cap are the 15 a reader recognises.
  vendors.sort(
    (left, right) =>
      vendorRank(left.vendor) - vendorRank(right.vendor) ||
      right.modelCount - left.modelCount ||
      left.vendor.localeCompare(right.vendor),
  )

  const availableVendorCount = vendors.length
  const shown = vendorLimit > 0 ? vendors.slice(0, vendorLimit) : vendors
  return {
    vendors: shown,
    total: usable.length,
    selected: shown.reduce((sum, entry) => sum + entry.models.length, 0),
    availableVendorCount,
  }
}

/**
 * Turn a models.dev payload into the rows the rates view shows.
 *
 * Same output shape as {@link parseCatalogue}, from a source that prices each
 * vendor's own models instead of a gateway's routes: rows are the vendor's newest
 * `perVendor` priced models by `release_date`, and vendors keep the curated order
 * so the two sources produce a table that reads the same way.
 *
 * Three deliberate readings of the data:
 *
 * - **A model id with no vendor part gets one.** models.dev ids are bare
 *   (`gpt-5-nano`), while a hand-entered override and the page's tooltip both
 *   speak `vendor/model`, so the id is prefixed unless the source already
 *   namespaced it (Nvidia and Bedrock list other vendors' models).
 * - **The base tier is what is published.** models.dev also carries `tiers` and
 *   `context_over_200k` surcharges; those are real, and skipping them means the
 *   table shows the price of the base tier rather than the most expensive way to
 *   call the model. A price table that silently showed the long-context rate
 *   would be worse, but this is a simplification and it is written down here.
 * - **A vendor with no entry is simply absent.** Nothing is invented to fill its
 *   row, and the page's "showing N of M" counts what really arrived.
 *
 * @param {unknown} payload - the parsed response body.
 * @param {{ perVendor?: number, vendorLimit?: number }} [options] - selection options. `vendorLimit: 0` publishes every vendor.
 * @returns {{ vendors: object[], selected: number, total: number, availableVendorCount: number }} the catalogue rows.
 */
export function parseModelsDev(payload, { perVendor = MODELS_PER_VENDOR, vendorLimit = VENDOR_LIMIT } = {}) {
  const catalogue = payload !== null && typeof payload === 'object' ? payload : {}
  const vendors = []
  let total = 0

  for (const vendor of MAINSTREAM_VENDORS) {
    const providerId = MODELSDEV_PROVIDER[vendor]
    if (providerId === undefined) continue
    const provider = catalogue[providerId]
    if (provider === null || typeof provider !== 'object') continue
    const models = provider.models
    if (models === null || typeof models !== 'object') continue

    const priced = []
    for (const model of Object.values(models)) {
      if (model === null || typeof model !== 'object' || typeof model.id !== 'string') continue
      const cost = model.cost
      if (cost === null || typeof cost !== 'object') continue
      const input = toPrice(cost.input)
      const output = toPrice(cost.output)
      // Same rule as the gateway source: a row with no headline price is not a
      // price row, and would take one of the vendor's few slots.
      if (input === null && output === null) continue
      priced.push({
        id: model.id.includes('/') ? model.id : `${vendor}/${model.id}`,
        name: typeof model.name === 'string' && model.name !== '' ? model.name : model.id,
        released: typeof model.release_date === 'string' ? model.release_date : '',
        // 0 means "no per-token price is published", which for a platform billed
        // by the hour (Nvidia NIM) is the honest reading of the number and the
        // wrong reading of the row: the page marks these so ¥0 is not mistaken
        // for free.
        zero: input === 0 && output === 0,
        hosted: isHostedModel(vendor, model.id, String(model.name ?? '')),
        contextLength: typeof model.limit?.context === 'number' ? model.limit.context : null,
        prices: { input, output, cacheRead: toPrice(cost.cache_read), cacheWrite: toPrice(cost.cache_write) },
      })
      total += 1
    }
    if (priced.length === 0) continue

    // A vendor's own models come first, then the ones it hosts, and the newest
    // first within each group: `release_date` is a `YYYY-MM-DD` string, so it
    // sorts lexicographically, and a model without one sorts last rather than
    // winning by accident.
    const newest = [...priced]
      .sort(
        (left, right) =>
          Number(left.hosted) - Number(right.hosted) ||
          right.released.localeCompare(left.released) ||
          left.id.localeCompare(right.id),
      )
      .slice(0, perVendor)
      .map(({ released, hosted, ...model }) => ({ ...model, vendor, created: released === '' ? null : Date.parse(released) }))

    vendors.push({ vendor, modelCount: priced.length, models: newest })
  }

  // Already in curated order; the rest of the ordering only matters for the
  // vendors that are not on the list.
  vendors.sort(
    (left, right) =>
      vendorRank(left.vendor) - vendorRank(right.vendor) ||
      right.modelCount - left.modelCount ||
      left.vendor.localeCompare(right.vendor),
  )

  const availableVendorCount = vendors.length
  const shown = vendorLimit > 0 ? vendors.slice(0, vendorLimit) : vendors
  return {
    vendors: shown,
    total,
    selected: shown.reduce((sum, entry) => sum + entry.models.length, 0),
    availableVendorCount,
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
