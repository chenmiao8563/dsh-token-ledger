/**
 * The bill: what the recorded tokens would cost, grouped the way a person pays.
 *
 * ## What this is, and what it is not
 *
 * This is an *estimate from published list prices*, not an invoice. The tokens are
 * the ledger's — the same numbers the overview shows, which the CLI can recompute
 * from the raw logs — and the prices are whatever the rates view is showing, with
 * the vendor's own pricing page preferred where it can be read. A provider's actual
 * invoice can differ: discounts, credits, committed-use rates and failed requests
 * are all real and none of them are visible from here. The page says so.
 *
 * ## Why the tokens are split by time of day
 *
 * A vendor with two rates cannot be priced from a daily total. DeepSeek charges
 * half outside its peak window, so a token has to be known to be peak or off-peak
 * *before* a price is applied; the ledger records that split per day, session and
 * model, and this module spends it. Vendors with one rate get both sides priced the
 * same, which is the same sum as before.
 *
 * ## Why a model with no price is not free
 *
 * A model the price catalogue does not describe is reported as unpriced, with its
 * token count, and contributes nothing to the cost — rather than contributing zero,
 * which would quietly make the bill too small and wrong in the direction nobody
 * checks.
 *
 * @module dsh-token-ledger/bill
 */

import { CSV_BOM } from './csv.js'
import { cacheHitRate, dayKey, parseDayKey, rangeStart } from './overview.js'

/** The ways a bill can be grouped. */
export const BILL_DIMENSIONS = ['workspace', 'session', 'model', 'vendor', 'subscription']

/**
 * The groupings the settings page stacks, top to bottom.
 *
 * A page rather than an API list: the four are shown one after another so the
 * same usage can be read from four directions at once, and `subscription` is left
 * out of it only because a plan already shows up inside the vendor it covers.
 */
export const BILL_SECTIONS = ['workspace', 'session', 'model', 'vendor']

/** The ranges a bill can cover, in the order the page offers them. `all` is everything the ledger holds. */
export const BILL_RANGES = ['month', 'year', 'week', 'today', 'all']

/** The four buckets, in the order every table shows them. */
const BUCKETS = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens']

/** The price field behind each bucket. */
const PRICE_FIELD = {
  inputTokens: 'input',
  outputTokens: 'output',
  cacheReadTokens: 'cacheRead',
  cacheWriteTokens: 'cacheWrite',
}

/**
 * Break a model id into the words and the version numbers it is made of.
 *
 * Needed because the sources disagree about names in a way no string comparison
 * survives: the ledger's route is `deepseek-official/deepseek-v4-flash`, DeepSeek's
 * own pricing page lists the same model as `deepseek-flash` with the display name
 * `DeepSeek-V4.1-Flash`. The words agree and the version is written two ways, so the
 * comparison is made on words and on version parts as written — `4` and `4.1` are
 * treated as the same model only because `4` is a prefix of `4.1`, while `3.7` and
 * `3.8` stay different.
 *
 * @param {unknown} id - a model id or a display name.
 * @returns {{ words: string[], versions: string[], raw: string }} the parts.
 */
export function modelTokens(id) {
  const raw = String(id ?? '')
    .split('/')
    .pop()
    .toLowerCase()
  const words = []
  const versions = []
  for (const piece of raw.split(/[^a-z0-9.]+/)) {
    if (piece === '') continue
    for (const part of piece.split(/(\d+(?:\.\d+)?)/)) {
      if (part === '') continue
      if (/^\d/.test(part)) versions.push(part)
      else if (part.length > 1) words.push(part)
    }
  }
  return { words: [...new Set(words)].sort(), versions: [...new Set(versions)].sort(), raw }
}

/**
 * Whether two sets of version numbers describe the same generation.
 *
 * Equal is equal. Otherwise every version on one side must have a counterpart on
 * the other that it is a prefix of, which is how `4` meets `4.1` and `v4` meets
 * `V4.1` — without letting `3.7` meet `3.8`.
 *
 * @param {string[]} left - version parts.
 * @param {string[]} right - version parts.
 * @returns {boolean} whether they can describe the same model.
 */
function versionsAgree(left, right) {
  if (left.join(' ') === right.join(' ')) return true
  const compatible = (a, b) => a.every((version) => b.some((other) => other === version || other.startsWith(`${version}.`)))
  return compatible(left, right) || compatible(right, left)
}

/**
 * How two model names correspond, or that they do not.
 *
 * The rule is deliberately conservative, because a wrong price is worse than no
 * price: the words have to match exactly and the versions have to agree, so
 * `deepseek-v4-flash` meets `deepseek-flash` and `gemini-3.8-flash` is refused a
 * match against `gemini-3.7-flash` — whose words also match, and which is a
 * different model.
 *
 * @param {string} left - a model id or name.
 * @param {string} right - another.
 * @returns {'exact'|'name'|null} the strength of the correspondence.
 */
export function modelMatch(left, right) {
  const a = modelTokens(left)
  const b = modelTokens(right)
  if (a.raw === '') return null
  if (a.raw === b.raw) return 'exact'
  if (a.words.join(' ') !== b.words.join(' ')) return null
  return versionsAgree(a.versions, b.versions) ? 'name' : null
}

/**
 * Flatten a price catalogue into one entry per vendor-published model.
 *
 * Time-priced models arrive as several rows — one per period — and become one
 * entry holding both, because a bill has to price the two sides of the window
 * separately but treats them as one model.
 *
 * @param {object} catalogue - a rates payload (`lib/rates-service.js#read`).
 * @returns {object[]} the entries.
 */
export function priceEntries(catalogue) {
  const entries = []
  for (const vendor of Array.isArray(catalogue?.vendors) ? catalogue.vendors : []) {
    if (vendor === null || typeof vendor !== 'object') continue
    const byId = new Map()
    for (const model of Array.isArray(vendor.models) ? vendor.models : []) {
      if (model === null || typeof model !== 'object') continue
      const base = String(model.id ?? '').replace(/@(peak|offpeak)$/i, '')
      if (base === '') continue
      let entry = byId.get(base)
      if (entry === undefined) {
        entry = {
          vendor: vendor.vendor,
          model: model.name ?? model.id,
          modelId: base,
          currency: vendor.currency ?? catalogue?.currency ?? 'USD',
          source: vendor.source ?? 'dataset',
          prices: model.prices,
          periods: undefined,
        }
        byId.set(base, entry)
        entries.push(entry)
      }
      if (model.period !== undefined) {
        entry.periods = { ...(entry.periods ?? {}), [model.period]: model.prices }
        entry.prices = entry.periods.peak ?? entry.periods.offPeak ?? entry.prices
      }
    }
  }
  return entries
}

/**
 * Find the price entry for a ledger model, and say how sure the join is.
 *
 * Candidates are scored by {@link modelMatch} against both the price id and its
 * display name, and the vendor named in the route breaks a tie — the route
 * `deepseek-official/...` contains `deepseek`, which is the best evidence available
 * that this is DeepSeek's own price rather than another platform's for the same
 * model. The result carries the confidence so a reader can audit every join the
 * bill makes, and `null` is a real answer: no join, no invented price.
 *
 * @param {object[]} entries - the price entries.
 * @param {string} model - the ledger's `provider/model` key.
 * @returns {{ entry: object, confidence: 'exact'|'name', matchedOn: string }|null} the join.
 */
export function entryFor(entries, model) {
  const route = String(String(model ?? '').split('/')[0] ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
  const matches = []
  for (const entry of entries) {
    for (const candidate of [entry.modelId, entry.model]) {
      const confidence = modelMatch(model, candidate)
      if (confidence === null) continue
      const vendor = String(entry.vendor ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
      // The route naming the vendor is worth far more than the name matching exactly,
      // because several platforms publish the same model under the same name at
      // different prices: without it, an exact name is not evidence of whose price it
      // is, only evidence of which model it is.
      const vendorAgrees = vendor !== '' && route !== '' && (route.includes(vendor) || vendor.includes(route))
      matches.push({ entry, confidence, matchedOn: candidate, score: (confidence === 'exact' ? 2 : 1) + (vendorAgrees ? 4 : 0), vendorAgrees })
    }
  }
  if (matches.length === 0) return null
  const best = matches.reduce((top, match) => (match.score > top.score ? match : top))
  const rivals = matches.filter((match) => match.score === best.score && match.entry !== best.entry)
  // Two publishers matching equally well, with nothing in the route to say which is
  // being billed, is an unresolved question. Guessing would put a competitor's price
  // on these tokens; refusing leaves the model unpriced, where it is visible.
  if (rivals.length > 0 && !best.vendorAgrees) {
    return { ambiguous: true, candidates: [...new Set([best, ...rivals].map((match) => match.entry.modelId))] }
  }
  return { entry: best.entry, confidence: best.confidence, matchedOn: best.matchedOn, vendorAgrees: best.vendorAgrees }
}

/**
 * The cost of one usage row, in the currency its price is quoted in.
 *
 * @param {{ peak: object, offPeak: object }} usage - the row's split tokens.
 * @param {object} entry - a price index entry.
 * @returns {number} the cost.
 */
export function costOf(usage, entry) {
  const periods = entry.periods ?? { peak: entry.prices, offPeak: entry.prices }
  let total = 0
  for (const period of ['peak', 'offPeak']) {
    const tokens = usage?.[period]
    if (tokens === undefined) continue
    const prices = periods[period] ?? entry.prices ?? {}
    for (const bucket of BUCKETS) {
      const price = prices[PRICE_FIELD[bucket]]
      if (typeof price !== 'number' || !Number.isFinite(price)) continue
      total += ((tokens[bucket] ?? 0) / 1e6) * price
    }
  }
  return total
}

/**
 * The days a range covers.
 *
 * `today` is a range like any other, so the bill and the overview can name the
 * same day with the same arithmetic instead of one of them special-casing it.
 *
 * @param {'today'|'week'|'month'|'year'|'all'} kind - the range.
 * @param {Date} now - the current time.
 * @returns {{ from: string, to: string, covers: (key: string) => boolean }} the bounds; `from` is empty for `all`.
 */
export function rangeBounds(kind, now) {
  const to = dayKey(now)
  if (kind === 'all') return { from: '', to, covers: () => true }
  if (kind === 'today') return { from: to, to, covers: (key) => key === to }
  const from = dayKey(rangeStart(kind, now))
  return { from, to, covers: (key) => key >= from && key <= to }
}

/**
 * The last path segment of a working directory, which is the name a person uses
 * for a workspace.
 *
 * A bill grouped by workspace is read by full path, because two projects can share
 * the last segment of one. A *session* row only needs enough of the workspace to
 * recognise it, and `torchv-master/修复导出` reads better than the same row spelled
 * out to the drive letter.
 *
 * @param {unknown} cwd - a working directory.
 * @returns {string|null} its last segment, or null when there is none.
 */
export function workspaceName(cwd) {
  if (typeof cwd !== 'string' || cwd.trim() === '') return null
  const parts = cwd.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || cwd
}

/**
 * A session id shortened for display, keeping the head that people quote.
 *
 * @param {unknown} sessionId - the id.
 * @returns {string} the short form.
 */
export function shortSessionId(sessionId) {
  const id = String(sessionId ?? '')
  return id.length > 13 ? id.slice(0, 13) : id
}

/**
 * The share of a monthly plan a range should carry.
 *
 * A plan is bought by the month, so a month's fee is divided across that month's
 * days and the range pays for the days it covers. A range that spans two months
 * carries both shares, which is what a trailing-seven-day bill means when the month
 * boundary falls inside it.
 *
 * @param {object} subscription - `{ amount, startedAt?, endedAt? }`.
 * @param {{ from: string, to: string }} bounds - the range.
 * @returns {{ share: number, months: string[] }} the amount owed, and which months contributed.
 */
export function subscriptionShare(subscription, bounds) {
  const amount = typeof subscription?.amount === 'number' && Number.isFinite(subscription.amount) ? subscription.amount : 0
  if (amount === 0) return { share: 0, months: [] }

  const today = parseDayKey(bounds.to)
  const first = bounds.from === '' ? null : parseDayKey(bounds.from)
  const startedAt = typeof subscription.startedAt === 'string' && subscription.startedAt !== '' ? parseDayKey(subscription.startedAt) : null
  const endedAt = typeof subscription.endedAt === 'string' && subscription.endedAt !== '' ? parseDayKey(subscription.endedAt) : null

  const cursor = new Date((first ?? startedAt ?? today).getFullYear(), (first ?? startedAt ?? today).getMonth(), 1)
  let share = 0
  const months = []
  while (cursor <= today) {
    const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0)
    const daysInMonth = monthEnd.getDate()
    const from = new Date(Math.max(monthStart.getTime(), first?.getTime() ?? monthStart.getTime(), startedAt?.getTime() ?? monthStart.getTime()))
    const to = new Date(Math.min(monthEnd.getTime(), today.getTime(), endedAt?.getTime() ?? monthEnd.getTime()))
    if (from <= to) {
      const covered = Math.round((to - from) / 86400000) + 1
      const portion = (amount * covered) / daysInMonth
      share += portion
      if (portion > 0) months.push(`${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}`)
    }
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return { share, months }
}

/**
 * Escape one CSV field.
 *
 * @param {unknown} value - the value.
 * @returns {string} the field, quoted when it has to be.
 */
function csvField(value) {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * The rule a session has to be under to be summarised instead of listed.
 *
 * A session list is the one that grows without bound — a machine accumulates hundreds
 * of them, and most are a question asked once and archived, which is a row that says
 * nothing a reader needs. The default was chosen against a real ledger of 140
 * sessions: **¥1 or fewer than 10 calls** folds 37 of the 74 sessions in an all-time
 * list and a fifth of a month's, hides 2–4% of the money, and the most expensive row
 * it hides is under ¥1, so nothing material disappears. Both halves are configurable;
 * `cost` is read in the bill's own currency.
 */
export const SMALL_SESSION = { cost: 1, calls: 10 }

/**
 * Whether a row is too small to be worth a line of its own.
 *
 * Cheap **or** barely used: a session with three calls can be worth a line even when it
 * cost pennies, and a session with a hundred calls can be worth none when the model was
 * cheap. One exception matters more than the rule — **a row whose tokens could not be
 * priced is never folded**, because its cost is zero for want of a price rather than
 * for want of spending, and folding it would hide exactly what the bill lists as
 * unpriced.
 *
 * @param {object} row - a bill row.
 * @param {{ cost?: number, calls?: number }} [thresholds] - the rule's thresholds.
 * @returns {boolean} whether the row may be summarised.
 */
export function isSmallSession(row, { cost = SMALL_SESSION.cost, calls = SMALL_SESSION.calls } = {}) {
  if ((row?.unpricedTokens ?? 0) > 0) return false
  return (row?.cost ?? 0) < cost || (row?.calls ?? 0) < calls
}

/**
 * The byte-order mark every CSV export starts with.
 *
 * Imported for this module's own use and re-exported for callers. The reason for it
 * is written out in {@link module:dsh-token-ledger/csv}: without it, Excel reads a
 * UTF-8 CSV in the system code page, and a session named `编写统计` arrives as
 * `缂栧啓缁熻`.
 */
export { CSV_BOM }

/**
 * Render a bill as CSV: one row per group, and a total per section.
 *
 * Columns are the ones a bill is read by, in the order the page shows them — cost,
 * cache-hit input, cache-miss input, output, hit rate, calls — with the currency on
 * every row because a bill can contain two.
 *
 * Every row names its section, and **each section totals separately**: adding
 * today to this week to this month would count the same tokens several times over,
 * so there is deliberately no grand total across ranges.
 *
 * The text begins with {@link CSV_BOM}, so a name in Chinese survives the trip into
 * a spreadsheet.
 *
 * @param {object} payload - a sections payload from {@link buildBillSections}, or a single bill.
 * @returns {string} CSV text beginning with a byte-order mark, with a header row and CRLF line endings.
 */
export function billToCsv(payload) {
  const sections = sectionsOf(payload)
  const header = [
    'dimension',
    'range',
    'group',
    'calls',
    'cacheReadInput',
    'uncachedInput',
    'output',
    'cacheWriteInput',
    'cacheHitRate',
    'cost',
    'currency',
    'billing',
    // What the same tokens would have cost on usage prices: equal to `cost` for a
    // pay-as-you-go row, and the usage a plan covers for a plan row.
    'usagePricedCost',
  ]
  const rows = []
  for (const section of sections) {
    const currency = section.currency ?? payload?.currency ?? ''
    for (const row of section.rows ?? []) {
      rows.push([
        section.by ?? '',
        section.range?.kind ?? '',
        row.label ?? '',
        row.calls,
        row.cacheReadTokens,
        row.inputTokens,
        row.outputTokens,
        row.cacheWriteTokens,
        row.cacheHitRate === null || row.cacheHitRate === undefined ? '' : row.cacheHitRate.toFixed(4),
        Number(row.cost ?? 0).toFixed(4),
        currency,
        row.plan === true ? 'subscription' : 'usage',
        Number(row.usageCost ?? row.cost ?? 0).toFixed(4),
      ])
    }
    const totals = section.totals ?? {}
    rows.push([
      section.by ?? '',
      section.range?.kind ?? '',
      'TOTAL',
      totals.calls ?? 0,
      totals.cacheReadTokens ?? 0,
      totals.inputTokens ?? 0,
      totals.outputTokens ?? 0,
      totals.cacheWriteTokens ?? 0,
      totals.cacheHitRate === null || totals.cacheHitRate === undefined ? '' : totals.cacheHitRate.toFixed(4),
      Number(totals.totalCost ?? 0).toFixed(4),
      currency,
      '',
      Number(totals.usageCost ?? totals.cost ?? 0).toFixed(4),
    ])
  }
  return CSV_BOM + [header, ...rows].map((row) => row.map(csvField).join(',')).join('\r\n') + '\r\n'
}

/**
 * The sections of a payload, in the shape {@link billToCsv} writes.
 *
 * Tolerates a bare bill so a caller holding one grouping does not have to wrap it.
 *
 * @param {object} payload - a sections payload or a single bill.
 * @returns {object[]} the sections.
 */
function sectionsOf(payload) {
  if (Array.isArray(payload?.sections) && payload.sections.length > 0) return payload.sections
  return [
    {
      by: payload?.by ?? '',
      range: payload?.range ?? { kind: '' },
      rows: payload?.rows ?? [],
      totals: payload?.totals ?? {},
      currency: payload?.currency,
    },
  ]
}

/**
 * Bill one grouping over several ranges, as one payload.
 *
 * The settings page stacks four groupings, each with its own range selector, and
 * the export covers every combination at once. Both are served from here so the
 * page and the file cannot be two different computations, and so the shared
 * answers — which currency the bill is in, which models could not be priced, which
 * prices were joined by name — are stated once instead of once per section.
 *
 * @param {object} input - the same inputs as {@link buildBill}, with lists in place of single values.
 * @param {string[]} [input.dims] - the groupings, in the order they should appear.
 * @param {string[]} [input.ranges] - the ranges, in the order they should appear.
 * @param {Record<string, string>} [input.providerNames] - provider id to display name, passed through to every section.
 * @returns {object} the payload, with `sections` and the shared notes.
 */
export function buildBillSections({ dims = BILL_SECTIONS, ranges = BILL_RANGES, ...rest } = {}) {
  const wantedDims = (Array.isArray(dims) ? dims : []).filter((dim) => BILL_DIMENSIONS.includes(dim))
  const wantedRanges = (Array.isArray(ranges) ? ranges : []).filter((range) => BILL_RANGES.includes(range))
  const dimensionList = wantedDims.length > 0 ? wantedDims : BILL_SECTIONS
  const rangeList = wantedRanges.length > 0 ? wantedRanges : BILL_RANGES

  const sections = []
  const unpriced = new Map()
  const joins = new Map()
  let subscriptions = []
  for (const by of dimensionList) {
    for (const range of rangeList) {
      const bill = buildBill({ ...rest, by, range })
      sections.push({
        by,
        range: bill.range,
        rows: bill.rows,
        // The section carries its own fold report: only the session dimension folds, so
        // a page showing four sections has exactly one that was shortened.
        fold: bill.fold,
        totals: bill.totals,
        currency: bill.currency,
      })
      // The same model is unpriced in every range it appears in; the widest range
      // carries the most tokens, so that is the row kept.
      for (const row of bill.unpriced) {
        const seen = unpriced.get(row.model)
        if (seen === undefined || row.tokens > seen.tokens) unpriced.set(row.model, row)
      }
      for (const join of bill.joins) {
        const seen = joins.get(join.model)
        if (seen === undefined || join.tokens > seen.tokens) joins.set(join.model, join)
      }
      if (subscriptions.length === 0 && bill.subscriptions.length > 0) subscriptions = bill.subscriptions
    }
  }

  const first = sections[0] ?? { totals: {}, currency: 'CNY' }
  return {
    plugin: 'token-ledger',
    generatedAt: (rest.now ?? new Date()).getTime(),
    dimensions: dimensionList,
    ranges: rangeList,
    currency: first.currency,
    priceSource: rest.catalogue?.priceSource ?? 'modelsdev',
    fxRate: typeof rest.catalogue?.fx?.rate === 'number' && rest.catalogue.fx.rate > 0 ? rest.catalogue.fx.rate : null,
    sections,
    subscriptions,
    unpriced: [...unpriced.values()].sort((left, right) => right.tokens - left.tokens),
    joins: [...joins.values()].sort((left, right) => right.tokens - left.tokens),
  }
}

/**
 * Build a bill from the ledger, the price catalogue and the configured plans.
 *
 * @param {object} input - the inputs.
 * @param {object} input.snapshot - a ledger snapshot.
 * @param {object} input.catalogue - the rates payload.
 * @param {object[]} [input.subscriptions] - configured monthly plans.
 * @param {Record<string, string>} [input.providerNames] - provider id to the name the model settings show it under.
 * @param {string} [input.by] - one of {@link BILL_DIMENSIONS}.
 * @param {string} [input.range] - one of {@link BILL_RANGES}.
 * @param {boolean} [input.fold] - whether the session dimension may summarise its small rows. The page asks for it; an export never does.
 * @param {number} [input.smallSessionCost] - a session under this cost, in the bill's currency, is small (default {@link SMALL_SESSION}).
 * @param {number} [input.smallSessionCalls] - a session with fewer calls than this is small (default {@link SMALL_SESSION}).
 * @param {Date} [input.now] - the clock.
 * @returns {object} the bill payload.
 */
export function buildBill({
  snapshot,
  catalogue,
  subscriptions = [],
  providerNames = {},
  by = BILL_SECTIONS[0],
  range = 'month',
  fold = false,
  smallSessionCost = SMALL_SESSION.cost,
  smallSessionCalls = SMALL_SESSION.calls,
  now = new Date(),
} = {}) {
  const dimension = BILL_DIMENSIONS.includes(by) ? by : BILL_SECTIONS[0]
  const kind = BILL_RANGES.includes(range) ? range : 'month'
  const bounds = rangeBounds(kind, now)
  const entries = priceEntries(catalogue)
  // The same handful of models accounts for every usage row, and the join is a
  // scan of the catalogue, so it is done once per model rather than once per row.
  // A page that bills four groupings over five ranges leans on this.
  const joinCache = new Map()
  const joinOf = (model) => {
    if (!joinCache.has(model)) joinCache.set(model, entryFor(entries, model))
    return joinCache.get(model)
  }

  const fxRate = typeof catalogue?.fx?.rate === 'number' && catalogue.fx.rate > 0 ? catalogue.fx.rate : null
  const quote = catalogue?.quote ?? 'CNY'
  const hasUsd = entries.some((entry) => entry.currency === 'USD')
  // If dollars cannot be converted there is no single currency to total in, so the
  // bill stays in dollars rather than adding unlike numbers together.
  const displayCurrency = hasUsd && fxRate === null ? 'USD' : quote

  /** Convert an amount into the bill's currency, or null when that is impossible. */
  const convert = (amount, currency) => {
    if (currency === displayCurrency) return amount
    if (currency === 'USD' && displayCurrency === quote && fxRate !== null) return amount * fxRate
    return null
  }

  /**
   * What a row is billed once plans are taken into account.
   *
   * A vendor on a monthly plan is billed its plan, not its tokens: the usage cost is
   * what the plan covers and is shown beside it, but adding both would charge for
   * the same calls twice. A row spanning a plan vendor and a pay-as-you-go vendor
   * gets the plan plus the other one's usage.
   *
   * A plan is one charge, so on a grouping where its vendor appears in more than one
   * row — workspaces, sessions, models — it is *allocated* across those rows in
   * proportion to the usage it covers, rather than being charged in full to each.
   * That is what makes a section's rows add up to its total; charging the whole plan
   * to every row would make the rows sum to several times the bill.
   *
   * @param {object} row - a row accumulator.
   * @param {Map<string, number>} plansByVendor - plan shares, per vendor.
   * @returns {{ cost: number, usageCost: number, covered: boolean, planCost: number }} what is billed, what the tokens would have cost, whether a plan was involved, and how much of the cost came from one.
   */
  const billed = (row, plansByVendor) => {
    let cost = 0
    let planCost = 0
    let covered = false
    for (const [vendor, usageCost] of row.vendorCost) {
      const plan = plansByVendor.get(vendor)
      if (plan === undefined) {
        cost += usageCost
        continue
      }
      covered = true
      // The vendor's usage across the whole bill is what the plan replaces, so each
      // row carries the share of the plan its own usage accounts for. A vendor whose
      // tokens could not be priced at all has no usage to allocate against, and its
      // plan is then carried by the totals rather than by a row.
      const vendorTotal = totals.vendorCost.get(vendor) ?? 0
      const share = vendorTotal > 0 ? plan * (usageCost / vendorTotal) : 0
      cost += share
      planCost += share
    }
    return { cost, usageCost: row.cost, covered, planCost }
  }

  /** Where each session was working, and the name DSH gave it. */
  const sessionMeta = new Map()
  for (const session of snapshot?.sessions ?? []) {
    sessionMeta.set(String(session.sessionId), {
      cwd: session.cwd ?? null,
      title: typeof session.title === 'string' && session.title.trim() !== '' ? session.title.trim() : null,
    })
  }

  /**
   * The name a session row is billed under.
   *
   * A session is not a name anyone recognises, so the row is labelled the way DSH
   * shows it in its own sidebar — the workspace it ran in, then the name DSH gave
   * it — with the id kept in the tooltip for the sessions DSH never named.
   *
   * @param {string} sessionId - the session id.
   * @returns {{ label: string, sublabel: string }} the row's label and its tooltip.
   */
  const sessionLabel = (sessionId) => {
    const meta = sessionMeta.get(sessionId)
    const workspace = workspaceName(meta?.cwd)
    const name = meta?.title ?? shortSessionId(sessionId)
    return {
      label: workspace === null ? name : `${workspace}/${name}`,
      sublabel: `${sessionId}${meta?.cwd === null || meta?.cwd === undefined ? '' : ` · ${meta.cwd}`}`,
    }
  }

  /** A row accumulator, created on first use. */
  const blankRow = (label, sublabel = null) => ({
    label,
    sublabel,
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    cost: 0,
    unpricedTokens: 0,
    models: new Set(),
    sessions: new Set(),
    /**
     * The providers, price vendors and price rows under this row.
     *
     * Sets rather than single values because a row can legitimately span them — a
     * workspace that used two providers, a provider whose models are priced from two
     * vendors — and the page states what a row was priced from only when there is a
     * single answer to state.
     */
    providers: new Set(),
    priceVendors: new Set(),
    priceNames: new Set(),
    /**
     * Usage cost per vendor under this row.
     *
     * Kept per vendor rather than as one number because a plan replaces the usage
     * cost of the vendor it covers: a row that spans a plan vendor and a
     * pay-as-you-go vendor is billed the plan plus the other one's usage, and a
     * single running total could not tell the two apart.
     */
    vendorCost: new Map(),
  })

  const byDimension = new Map()
  const byVendor = new Map()
  const unpriced = new Map()
  const joins = new Map()
  const totals = {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cost: 0,
    unpricedCost: false,
    /** Usage cost per vendor, so the whole bill can be billed the same way a row is. */
    vendorCost: new Map(),
  }

  const accumulate = (row, usage, cost, variant) => {
    row.calls += usage.calls ?? 0
    for (const bucket of BUCKETS) row[bucket] += usage[bucket] ?? 0
    row.totalTokens += usage.totalTokens ?? 0
    // The model count is a count of *models*, so the set holds the route the ledger
    // recorded, not the label the row happens to be displayed under.
    row.models.add(variant.modelKey)
    row.sessions.add(String(usage.sessionId))
    row.providers.add(variant.provider)
    row.priceVendors.add(variant.vendor)
    if (variant.entry !== undefined && typeof variant.entry.model === 'string') row.priceNames.add(variant.entry.model)
    if (cost !== null) {
      row.cost += cost
      row.vendorCost.set(variant.vendor, (row.vendorCost.get(variant.vendor) ?? 0) + cost)
    } else {
      row.unpricedTokens += usage.totalTokens ?? 0
    }
  }

  /**
   * Where each route provider's usage sits, and which price vendor prices it.
   *
   * A provider is what the model settings page calls an endpoint — `bos`,
   * `deepseek-official`, `qwen-plan` — and a price vendor is whose list price the
   * tokens end up billed at, which can be a different name: `bos` serves DeepSeek
   * models, so its tokens are priced from DeepSeek's list. The bill groups by the
   * first and prices by the second, and this table is what ties them together.
   */
  const providerVendor = new Map()

  for (const usage of snapshot?.usage ?? []) {
    const date = String(usage?.date ?? '')
    if (!bounds.covers(date)) continue
    const model = String(usage?.model ?? 'unknown/unknown')
    const join = joinOf(model)
    const entry = join?.entry
    const cost = entry === undefined ? null : convert(costOf(usage, entry), entry.currency)
    if (join?.entry !== undefined) {
      const record = joins.get(model) ?? { model, vendor: join.entry.vendor, price: join.entry.model, priceId: join.entry.modelId, confidence: join.confidence, matchedOn: join.matchedOn, tokens: 0 }
      record.tokens += usage?.totalTokens ?? 0
      joins.set(model, record)
    }
    const [routeProvider, routeModel] = model.split('/')
    // The provider as the request named it, which is the id the model settings use.
    const provider = typeof routeProvider === 'string' && routeProvider !== '' ? routeProvider : 'unknown'
    const vendor = String(entry?.vendor ?? provider)
    if (!providerVendor.has(provider)) providerVendor.set(provider, vendor)
    // The name the model settings page shows, when it has one; the id otherwise.
    const providerLabel = typeof providerNames[provider] === 'string' && providerNames[provider] !== '' ? providerNames[provider] : provider
    const meta = sessionMeta.get(String(usage.sessionId))
    const workspace = meta?.cwd ?? null
    // A model row is the route the ledger recorded — `bos/deepseek-v4-flash` — which
    // is what the overview lists and what the model settings page configures. The
    // price it was billed at is a separate fact and travels in the tooltip.
    const variant = { modelKey: model, provider, providerLabel, vendor, entry }

    totals.calls += usage.calls ?? 0
    for (const bucket of BUCKETS) totals[bucket] += usage[bucket] ?? 0
    if (cost === null) {
      totals.unpricedCost = true
      const record = unpriced.get(model) ?? {
        model,
        provider,
        vendor,
        tokens: 0,
        calls: 0,
        reason:
          entry !== undefined
            ? `priced in ${entry.currency}, which this bill cannot convert`
            : join?.ambiguous === true
              ? `ambiguous price match (${join.candidates.join(' · ')})`
              : 'no price for this model',
      }
      record.tokens += usage.totalTokens ?? 0
      record.calls += usage.calls ?? 0
      unpriced.set(model, record)
    } else {
      totals.cost += cost
      totals.vendorCost.set(vendor, (totals.vendorCost.get(vendor) ?? 0) + cost)
    }

    // Every usage row lands in the vendor table as well: the subscription view needs
    // it to show what each plan covers.
    const vendorRow = byVendor.get(vendor) ?? blankRow(vendor)
    accumulate(vendorRow, usage, cost, variant)
    byVendor.set(vendor, vendorRow)

    const session = sessionLabel(String(usage.sessionId))
    const key =
      dimension === 'vendor' || dimension === 'subscription'
        ? provider
        : dimension === 'model'
          ? model
          : dimension === 'workspace'
            ? (workspace ?? '(unknown)')
            : String(usage.sessionId)
    const dimensionLabel =
      dimension === 'workspace'
        ? (workspace ?? '(unknown)')
        : dimension === 'session'
          ? session.label
          : dimension === 'vendor' || dimension === 'subscription'
            ? providerLabel
            : model
    const row =
      byDimension.get(key) ??
      blankRow(dimensionLabel, dimension === 'session' ? session.sublabel : null)
    accumulate(row, usage, cost, variant)
    byDimension.set(key, row)
  }

  // The plans, and the usage they cover, as rows of their own.
  const plans = []
  let subscriptionCost = 0
  /** What each vendor is charged by plan, which is what replaces its usage cost. */
  const plansByVendor = new Map()
  for (const subscription of Array.isArray(subscriptions) ? subscriptions : []) {
    // A config file is hand-written: a stray `-` or a string where an object was
    // meant must not take the whole bill down with it.
    if (subscription === null || typeof subscription !== 'object') continue
    const { share, months } = subscriptionShare(subscription, bounds)
    const currency = subscription.currency ?? 'CNY'
    const converted = convert(share, currency)
    const named = subscription.vendor === undefined || subscription.vendor === null ? null : String(subscription.vendor)
    // A plan may name either the price vendor whose list price it replaces or the
    // provider whose endpoint it pays for — `deepseek` or `bos` — because both are
    // reasonable things to write in a config file. Whichever it names is resolved to
    // the price vendor, which is what the usage is actually billed against.
    const vendor = named !== null && !totals.vendorCost.has(named) && providerVendor.has(named) ? providerVendor.get(named) : named
    const vendorRow = vendor === null ? undefined : byVendor.get(vendor)
    const label = subscription.plan ?? vendor ?? 'plan'
    plans.push({
      plan: label,
      // The price vendor the plan is charged against, and what the config actually
      // said, so a plan written against a provider id can be read back either way.
      vendor,
      namedVendor: named,
      amount: typeof subscription.amount === 'number' ? subscription.amount : 0,
      currency,
      share: converted,
      months,
      note: subscription.note ?? null,
      calls: vendorRow?.calls ?? 0,
      totalTokens: vendorRow?.totalTokens ?? 0,
      cacheHitRate: vendorRow === undefined ? null : cacheHitRate(vendorRow),
    })
    if (converted !== null && converted > 0) {
      subscriptionCost += converted
      // Only a share that can be stated in the bill's currency can stand in for the
      // vendor's usage — and only a share above zero: a plan that has not started,
      // or whose amount the config got wrong, must not zero out usage it never
      // covered.
      if (vendor !== null) plansByVendor.set(vendor, (plansByVendor.get(vendor) ?? 0) + converted)
    }
  }

  let rows
  if (dimension === 'subscription') {
    // One line per plan, plus one line for everything that is not on a plan. A bill
    // that only listed plans would hide the usage-priced majority.
    const covered = new Set(plansByVendor.keys())
    const residual = [...byVendor.entries()].filter(([vendor]) => !covered.has(vendor))
    const residualRow = residual.reduce(
      (row, [, vendorRow]) => {
        row.calls += vendorRow.calls
        for (const bucket of BUCKETS) row[bucket] += vendorRow[bucket]
        row.totalTokens += vendorRow.totalTokens
        row.cost += vendorRow.cost
        // The per-vendor costs come along, so the row is billed the same way a group
        // row is; the residual is off-plan by construction, but the arithmetic should
        // not depend on that staying true.
        for (const [vendor, cost] of vendorRow.vendorCost) row.vendorCost.set(vendor, (row.vendorCost.get(vendor) ?? 0) + cost)
        row.unpricedTokens += vendorRow.unpricedTokens
        for (const model of vendorRow.models) row.models.add(model)
        for (const session of vendorRow.sessions) row.sessions.add(session)
        return row
      },
      blankRow(null),
    )
    rows = [
      ...plans.map((plan) => {
        const vendorRow = plan.vendor === null ? undefined : byVendor.get(plan.vendor)
        return {
          key: plan.plan,
          label: plan.plan,
          sublabel: plan.vendor,
          plan: true,
          covered: vendorRow !== undefined,
          calls: plan.calls,
          inputTokens: vendorRow?.inputTokens ?? 0,
          outputTokens: vendorRow?.outputTokens ?? 0,
          cacheReadTokens: vendorRow?.cacheReadTokens ?? 0,
          cacheWriteTokens: vendorRow?.cacheWriteTokens ?? 0,
          totalTokens: plan.totalTokens,
          cacheHitRate: plan.cacheHitRate,
          cost: plan.share ?? 0,
          usageCost: vendorRow?.cost ?? 0,
          unpricedTokens: vendorRow?.unpricedTokens ?? 0,
          modelCount: vendorRow?.models.size ?? 0,
          sessionCount: vendorRow?.sessions.size ?? 0,
          months: plan.months,
        }
      }),
      {
        key: 'usage',
        label: residualRow.label,
        sublabel: null,
        plan: false,
        covered: false,
        calls: residualRow.calls,
        inputTokens: residualRow.inputTokens,
        outputTokens: residualRow.outputTokens,
        cacheReadTokens: residualRow.cacheReadTokens,
        cacheWriteTokens: residualRow.cacheWriteTokens,
        totalTokens: residualRow.totalTokens,
        cacheHitRate: cacheHitRate(residualRow),
        // Every vendor left here is off-plan by construction, so this is its usage.
        cost: billed(residualRow, plansByVendor).cost,
        usageCost: residualRow.cost,
        planCost: 0,
        unpricedTokens: residualRow.unpricedTokens,
        modelCount: residualRow.models.size,
        sessionCount: residualRow.sessions.size,
      },
    ]
  } else {
    // A row is billed the way the bill as a whole is: a vendor on a plan contributes
    // its plan rather than its tokens, and every other vendor contributes its usage.
    rows = [...byDimension.values()].map((row) => {
      const charge = billed(row, plansByVendor)
      return {
        key: row.label,
        label: row.label,
        sublabel: row.sublabel,
        plan: false,
        covered: charge.covered,
        // How much of this row's cost is a plan allocated to it, so the page can say
        // so where a row is billed partly by plan and partly by usage.
        planCost: charge.planCost,
        // What the row was priced from, stated only where there is one answer: a row
        // spanning two providers or two price lists says nothing rather than picking.
        provider: row.providers.size === 1 ? [...row.providers][0] : null,
        priceVendor: row.priceVendors.size === 1 ? [...row.priceVendors][0] : null,
        priceNames: [...row.priceNames],
        calls: row.calls,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        cacheReadTokens: row.cacheReadTokens,
        cacheWriteTokens: row.cacheWriteTokens,
        totalTokens: row.totalTokens,
        cacheHitRate: cacheHitRate(row),
        cost: charge.cost,
        usageCost: charge.usageCost,
        planCost: charge.planCost,
        unpricedTokens: row.unpricedTokens,
        modelCount: row.models.size,
        sessionCount: row.sessions.size,
      }
    })
  }
  /**
   * The single row that stands in for the sessions too small to list.
   *
   * It carries the same fields a real row does, summed, so the columns mean the same
   * thing on that line as on every other, and the section's rows still add up to its
   * total. Its name is left null on purpose: the host has no dictionary, so the page
   * names it in the reader's language from `foldedCount`.
   *
   * @param {object[]} small - the rows being summarised.
   * @returns {object} the summary row.
   */
  const summariseSmall = (small) => {
    const sum = { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 }
    let cost = 0
    let usageCost = 0
    let planCost = 0
    let covered = false
    for (const row of small) {
      sum.calls += row.calls
      for (const bucket of BUCKETS) sum[bucket] += row[bucket] ?? 0
      sum.totalTokens += row.totalTokens
      cost += row.cost
      usageCost += row.usageCost ?? row.cost
      planCost += row.planCost ?? 0
      covered = covered || row.covered === true
    }
    return {
      key: '#small',
      label: null,
      sublabel: null,
      plan: false,
      covered,
      folded: true,
      foldedCount: small.length,
      planCost,
      provider: null,
      priceVendor: null,
      priceNames: [],
      ...sum,
      cacheHitRate: cacheHitRate(sum),
      cost,
      usageCost,
      // Nothing unpriced can be in here: `isSmallSession` refuses those rows.
      unpricedTokens: 0,
      modelCount: null,
      sessionCount: small.length,
    }
  }

  rows.sort((left, right) => right.cost - left.cost || right.totalTokens - left.totalTokens)

  // The session list is the long one, and on the page it is summarised: the sessions
  // that are cheap or barely used become one row that carries their total, so the list
  // shows the work that cost something without losing a cent of the arithmetic. The
  // export never does this — a file is read for its detail.
  const sizeOf = { cost: smallSessionCost, calls: smallSessionCalls }
  const small = dimension === 'session' && fold === true ? rows.filter((row) => isSmallSession(row, sizeOf)) : []
  // A summary that swallowed the whole list would hide it rather than shorten it, so a
  // list where every row qualifies is left as it is.
  const folded = small.length > 0 && small.length < rows.length
  if (folded) {
    const summarised = new Set(small)
    rows = [...rows.filter((row) => !summarised.has(row)), summariseSmall(small)]
  }

  const totalTokens = BUCKETS.reduce((sum, bucket) => sum + totals[bucket], 0)
  const billedTotals = billed(totals, plansByVendor)
  // A plan for a vendor the ledger never saw still has to be paid for, and no usage
  // row carries it, so it is added here rather than in `billed`.
  const unusedPlanCost = [...plansByVendor.entries()]
    .filter(([vendor]) => !totals.vendorCost.has(vendor))
    .reduce((sum, [, share]) => sum + share, 0)
  return {
    plugin: 'token-ledger',
    generatedAt: now.getTime(),
    by: dimension,
    range: { kind, from: bounds.from, to: bounds.to },
    currency: displayCurrency,
    priceSource: catalogue?.priceSource ?? 'modelsdev',
    fxRate,
    rows,
    // What was summarised, so the page can say it and the reader knows the list is not
    // the whole story — the export always is.
    fold: folded ? { count: small.length, costBelow: smallSessionCost, callsBelow: smallSessionCalls, currency: displayCurrency } : null,
    totals: {
      calls: totals.calls,
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      cacheReadTokens: totals.cacheReadTokens,
      cacheWriteTokens: totals.cacheWriteTokens,
      totalTokens,
      cacheHitRate: cacheHitRate(totals),
      // `cost` is what the tokens are billed at — plan-covered vendors charged their
      // plan, not their tokens — and `usageCost` is what those same tokens would have
      // cost on usage alone, so the saving a plan buys stays visible. A plan is never
      // added to the usage it covers: `totalCost` sums the two mutually exclusive
      // kinds of charge, plus any plan whose vendor has no usage at all.
      cost: billedTotals.cost,
      usageCost: billedTotals.usageCost,
      subscriptionCost,
      totalCost: billedTotals.cost + unusedPlanCost,
      unpricedCost: totals.unpricedCost,
    },
    subscriptions: plans,
    unpriced: [...unpriced.values()].sort((left, right) => right.tokens - left.tokens),
    // Every join the bill made, so a price applied by name rather than by id can be
    // checked rather than trusted.
    joins: [...joins.values()].sort((left, right) => right.tokens - left.tokens),
  }
}
