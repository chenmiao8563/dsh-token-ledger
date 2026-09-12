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

import { cacheHitRate, dayKey, parseDayKey, rangeStart } from './overview.js'

/** The ways a bill can be grouped. */
export const BILL_DIMENSIONS = ['vendor', 'model', 'workspace', 'session', 'subscription']

/** The ranges a bill can cover. `all` is everything the ledger holds. */
export const BILL_RANGES = ['week', 'month', 'year', 'all']

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
 * @param {'week'|'month'|'year'|'all'} kind - the range.
 * @param {Date} now - the current time.
 * @returns {{ from: string, to: string, covers: (key: string) => boolean }} the bounds; `from` is empty for `all`.
 */
export function rangeBounds(kind, now) {
  const to = dayKey(now)
  if (kind === 'all') return { from: '', to, covers: () => true }
  const from = dayKey(rangeStart(kind, now))
  return { from, to, covers: (key) => key >= from && key <= to }
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
 * Render a bill as CSV, one row per group plus a total.
 *
 * Columns are the ones a bill is read by: what the group is, how many calls, the
 * four token buckets, the hit rate and the cost — with the currency on every row,
 * because a bill can contain two.
 *
 * @param {object} bill - a payload from {@link buildBill}.
 * @returns {string} CSV text with a header row and CRLF line endings.
 */
export function billToCsv(bill) {
  const header = [
    'group',
    'calls',
    'inputTokens',
    'outputTokens',
    'cacheReadTokens',
    'cacheWriteTokens',
    'totalTokens',
    'cacheHitRate',
    'cost',
    'currency',
    'billing',
  ]
  const rows = []
  for (const row of bill?.rows ?? []) {
    rows.push([
      row.label ?? '',
      row.calls,
      row.inputTokens,
      row.outputTokens,
      row.cacheReadTokens,
      row.cacheWriteTokens,
      row.totalTokens,
      row.cacheHitRate === null || row.cacheHitRate === undefined ? '' : row.cacheHitRate.toFixed(4),
      Number(row.cost ?? 0).toFixed(4),
      bill.currency,
      row.plan === true ? 'subscription' : 'usage',
    ])
  }
  const totals = bill?.totals ?? {}
  rows.push([
    'TOTAL',
    totals.calls ?? 0,
    totals.inputTokens ?? 0,
    totals.outputTokens ?? 0,
    totals.cacheReadTokens ?? 0,
    totals.cacheWriteTokens ?? 0,
    totals.totalTokens ?? 0,
    totals.cacheHitRate === null || totals.cacheHitRate === undefined ? '' : totals.cacheHitRate.toFixed(4),
    Number(totals.totalCost ?? 0).toFixed(4),
    bill?.currency ?? '',
    '',
  ])
  return [header, ...rows].map((row) => row.map(csvField).join(',')).join('\r\n') + '\r\n'
}

/**
 * Build a bill from the ledger, the price catalogue and the configured plans.
 *
 * @param {object} input - the inputs.
 * @param {object} input.snapshot - a ledger snapshot.
 * @param {object} input.catalogue - the rates payload.
 * @param {object[]} [input.subscriptions] - configured monthly plans.
 * @param {string} [input.by] - one of {@link BILL_DIMENSIONS}.
 * @param {string} [input.range] - one of {@link BILL_RANGES}.
 * @param {Date} [input.now] - the clock.
 * @returns {object} the bill payload.
 */
export function buildBill({ snapshot, catalogue, subscriptions = [], by = 'vendor', range = 'month', now = new Date() } = {}) {
  const dimension = BILL_DIMENSIONS.includes(by) ? by : 'vendor'
  const kind = BILL_RANGES.includes(range) ? range : 'month'
  const bounds = rangeBounds(kind, now)
  const entries = priceEntries(catalogue)

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
   * @param {object} row - a row accumulator.
   * @param {Map<string, number>} plansByVendor - plan shares, per vendor.
   * @returns {{ cost: number, usageCost: number }} what is billed, and what the tokens would have cost.
   */
  const billed = (row, plansByVendor) => {
    let cost = 0
    let covered = false
    for (const [vendor, usageCost] of row.vendorCost) {
      const plan = plansByVendor.get(vendor)
      if (plan === undefined) cost += usageCost
      else {
        cost += plan
        covered = true
      }
    }
    return { cost, usageCost: row.cost, covered }
  }

  const sessionCwd = new Map()
  for (const session of snapshot?.sessions ?? []) sessionCwd.set(String(session.sessionId), session.cwd ?? null)

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
    row.models.add(variant.model)
    row.sessions.add(String(usage.sessionId))
    if (cost !== null) {
      row.cost += cost
      row.vendorCost.set(variant.vendor, (row.vendorCost.get(variant.vendor) ?? 0) + cost)
    } else {
      row.unpricedTokens += usage.totalTokens ?? 0
    }
  }

  for (const usage of snapshot?.usage ?? []) {
    const date = String(usage?.date ?? '')
    if (!bounds.covers(date)) continue
    const model = String(usage?.model ?? 'unknown/unknown')
    const join = entryFor(entries, model)
    const entry = join?.entry
    const cost = entry === undefined ? null : convert(costOf(usage, entry), entry.currency)
    if (join?.entry !== undefined) {
      const record = joins.get(model) ?? { model, vendor: join.entry.vendor, price: join.entry.model, priceId: join.entry.modelId, confidence: join.confidence, matchedOn: join.matchedOn, tokens: 0 }
      record.tokens += usage?.totalTokens ?? 0
      joins.set(model, record)
    }
    const [routeProvider, routeModel] = model.split('/')
    const vendor = String(entry?.vendor ?? routeProvider ?? 'unknown')
    const workspace = sessionCwd.get(String(usage.sessionId)) ?? null
    const label = entry?.model ?? routeModel ?? model
    const variant = { model: label, entry, vendor }

    totals.calls += usage.calls ?? 0
    for (const bucket of BUCKETS) totals[bucket] += usage[bucket] ?? 0
    if (cost === null) {
      totals.unpricedCost = true
      const record = unpriced.get(model) ?? {
        model,
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

    const key =
      dimension === 'vendor' || dimension === 'subscription'
        ? vendor
        : dimension === 'model'
          ? label
          : dimension === 'workspace'
            ? (workspace ?? '(unknown)')
            : String(usage.sessionId)
    const dimensionLabel = dimension === 'workspace' ? (workspace ?? '(unknown)') : dimension === 'session' ? String(usage.sessionId) : key
    const row = byDimension.get(key) ?? blankRow(dimensionLabel, dimension === 'model' ? model : null)
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
    const vendor = subscription.vendor === undefined || subscription.vendor === null ? null : String(subscription.vendor)
    const vendorRow = vendor === null ? undefined : byVendor.get(vendor)
    const label = subscription.plan ?? vendor ?? 'plan'
    plans.push({
      plan: label,
      vendor,
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
        calls: row.calls,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        cacheReadTokens: row.cacheReadTokens,
        cacheWriteTokens: row.cacheWriteTokens,
        totalTokens: row.totalTokens,
        cacheHitRate: cacheHitRate(row),
        cost: charge.cost,
        usageCost: charge.usageCost,
        unpricedTokens: row.unpricedTokens,
        modelCount: row.models.size,
        sessionCount: row.sessions.size,
      }
    })
  }
  rows.sort((left, right) => right.cost - left.cost || right.totalTokens - left.totalTokens)

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
