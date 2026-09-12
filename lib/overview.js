/**
 * The overview payload the browser half renders.
 *
 * Kept separate from the plugin so it is a pure function of a ledger snapshot
 * and a clock, and therefore testable without a host, a browser or a socket.
 * The host route is then a thin wrapper: take the live snapshot, call this,
 * serialize.
 *
 * ## Why the payload is shaped like this
 *
 * The page the client draws has three parts — range totals, today, and a
 * calendar. Each is answered here rather than in the browser so the client
 * stays dumb and two clients cannot disagree:
 *
 * - `ranges` carries the totals for the three selectable ranges, plus the
 *   derived cache-hit rate, so switching a tab is a re-render and not a
 *   re-fetch.
 * - `today` carries the current local day's numbers, which is what "live"
 *   means for a ledger: a value that moves as steps complete.
 * - `daily` is a **contiguous** day series including zero-token days, because
 *   a calendar grid needs every cell, and gap-filling in one place is better
 *   than in every view.
 *
 * @module dsh-token-ledger/overview
 */

/** How many days of daily series to publish, bounding the payload. */
export const SERIES_DAYS = 366

/**
 * Render a local calendar day as `YYYY-MM-DD`.
 *
 * @param {Date} date - the day.
 * @returns {string} the key.
 */
export function dayKey(date) {
  const pad = (value) => (value < 10 ? `0${value}` : String(value))
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * Parse a `YYYY-MM-DD` key back into a local midnight `Date`.
 *
 * @param {string} key - the day key.
 * @returns {Date} local midnight of that day.
 */
export function parseDayKey(key) {
  const [year, month, day] = String(key).split('-').map((part) => Number.parseInt(part, 10))
  return new Date(year, (month ?? 1) - 1, day ?? 1)
}

/**
 * The local date a range starts on.
 *
 * `week` is the trailing seven days including today, because "7 天" reads as a
 * rolling window; `month` and `year` are calendar periods, because "本月" and
 * "本年" read as the period you are in.
 *
 * @param {'week'|'month'|'year'} kind - the range.
 * @param {Date} now - the current time.
 * @returns {Date} local midnight of the first day in range.
 */
export function rangeStart(kind, now) {
  if (kind === 'week') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    start.setDate(start.getDate() - 6)
    return start
  }
  if (kind === 'month') return new Date(now.getFullYear(), now.getMonth(), 1)
  if (kind === 'year') return new Date(now.getFullYear(), 0, 1)
  throw new Error(`unknown range "${kind}" (expected week, month, or year)`)
}

/**
 * An empty counter set in the shape the ledger emits.
 *
 * @returns {{ inputTokens: number, outputTokens: number, cacheReadTokens: number, cacheWriteTokens: number, totalTokens: number, reasoningTokens: number }} zeroed counters.
 */
function emptyTotals() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    reasoningTokens: 0,
  }
}

/**
 * Add one day row into an accumulator.
 *
 * @param {ReturnType<typeof emptyTotals>} target - mutated accumulator.
 * @param {object} row - a ledger daily row.
 * @returns {void}
 */
function accumulate(target, row) {
  for (const key of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'totalTokens', 'reasoningTokens']) {
    const value = row?.[key]
    if (typeof value === 'number' && Number.isFinite(value)) target[key] += value
  }
}

/**
 * The share of input tokens served from the prompt cache.
 *
 * Defined over input only: a cache read is an input token that did not have to
 * be re-sent, so `cacheRead / (cacheRead + uncachedInput)` is the fraction of
 * input the cache absorbed. Returns `null` when there was no input at all,
 * which the client renders as a dash rather than as a misleading 0%.
 *
 * @param {{ inputTokens: number, cacheReadTokens: number }} totals - the counters.
 * @returns {number|null} a fraction between 0 and 1, or null when undefined.
 */
export function cacheHitRate(totals) {
  const denominator = (totals.cacheReadTokens ?? 0) + (totals.inputTokens ?? 0)
  if (denominator <= 0) return null
  return totals.cacheReadTokens / denominator
}

/**
 * Fold a set of day rows into one range summary.
 *
 * @param {object[]} rows - day rows inside the range.
 * @returns {{ totals: ReturnType<typeof emptyTotals>, calls: number, activeDays: number, cacheHitRate: number|null }} the summary.
 */
export function summarize(rows) {
  const totals = emptyTotals()
  let calls = 0
  let activeDays = 0
  for (const row of rows) {
    accumulate(totals, row)
    if (typeof row?.calls === 'number' && Number.isFinite(row.calls)) calls += row.calls
    if ((row?.totalTokens ?? 0) > 0) activeDays += 1
  }
  return { totals, calls, activeDays, cacheHitRate: cacheHitRate(totals) }
}

/**
 * A contiguous day series ending today, gaps filled with zeroes.
 *
 * @param {Map<string, object>} byDay - ledger daily rows keyed by day.
 * @param {Date} now - the current time.
 * @param {number} [limit] - maximum number of days emitted.
 * @returns {object[]} ascending day rows, one per calendar day.
 */
export function buildSeries(byDay, now, limit = SERIES_DAYS) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const keys = [...byDay.keys()].sort()
  const earliest = keys.length > 0 ? parseDayKey(keys[0]) : today
  const span = Math.min(limit, Math.max(1, Math.round((today - earliest) / 86400000) + 1))

  const series = []
  for (let offset = span - 1; offset >= 0; offset -= 1) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset)
    const key = dayKey(date)
    const row = byDay.get(key)
    series.push({
      date: key,
      calls: typeof row?.calls === 'number' ? row.calls : 0,
      inputTokens: row?.inputTokens ?? 0,
      outputTokens: row?.outputTokens ?? 0,
      cacheReadTokens: row?.cacheReadTokens ?? 0,
      cacheWriteTokens: row?.cacheWriteTokens ?? 0,
      totalTokens: row?.totalTokens ?? 0,
      reasoningTokens: row?.reasoningTokens ?? 0,
      // When the day's last call landed, or null for a day with no usage. The
      // browser turns it into "the day that finished latest".
      lastAt: typeof row?.lastAt === 'number' && Number.isFinite(row.lastAt) ? row.lastAt : null,
    })
  }
  return series
}

/**
 * Build the whole overview payload.
 *
 * @param {object} snapshot - a `UsageLedger#snapshot()` value.
 * @param {{ now?: Date }} [options] - clock override for tests.
 * @returns {object} the JSON payload the client renders. Every field is a
 *   primitive, a plain object or an array, so it serializes losslessly.
 */
export function buildOverview(snapshot, { now = new Date() } = {}) {
  const dailyRows = Array.isArray(snapshot?.daily) ? snapshot.daily : []
  const byDay = new Map()
  for (const row of dailyRows) {
    if (typeof row?.date === 'string') byDay.set(row.date, row)
  }

  const series = buildSeries(byDay, now)
  const todayKey = dayKey(now)

  const ranges = {}
  for (const kind of ['week', 'month', 'year']) {
    const startKey = dayKey(rangeStart(kind, now))
    const inRange = [...byDay.entries()]
      .filter(([key]) => key >= startKey && key <= todayKey)
      .map(([, row]) => row)
    ranges[kind] = { kind, from: startKey, to: todayKey, ...summarize(inRange) }
  }
  // Everything the ledger holds. Not routed through `rangeStart`, which owns dates
  // and would have to invent one for "always": this range starts on the first day
  // there is, so the reader can see how far back the total reaches.
  const dayKeys = [...byDay.keys()].sort()
  ranges.all = {
    kind: 'all',
    from: dayKeys[0] ?? todayKey,
    to: todayKey,
    ...summarize(dayKeys.map((key) => byDay.get(key))),
  }

  const todayRow = byDay.get(todayKey)
  const todaySummary = summarize(todayRow === undefined ? [] : [todayRow])

  const models = (Array.isArray(snapshot?.models) ? snapshot.models : [])
    .slice(0, 12)
    .map((model) => {
      // Every bucket travels, not just the total: the model row draws the
      // composition of the usage, so the split has to be in the payload rather
      // than derived in the browser from a number that cannot be split.
      const counters = {
        inputTokens: model?.inputTokens ?? 0,
        outputTokens: model?.outputTokens ?? 0,
        cacheReadTokens: model?.cacheReadTokens ?? 0,
        cacheWriteTokens: model?.cacheWriteTokens ?? 0,
      }
      return {
        model: String(model?.model ?? 'unknown'),
        calls: typeof model?.calls === 'number' ? model.calls : 0,
        totalTokens: model?.totalTokens ?? 0,
        reasoningTokens: model?.reasoningTokens ?? 0,
        ...counters,
        cacheHitRate: cacheHitRate(counters),
      }
    })

  return {
    plugin: 'token-ledger',
    generatedAt: now.getTime(),
    ledgerUpdatedAt: typeof snapshot?.updatedAt === 'number' ? snapshot.updatedAt : null,
    totals: {
      ...emptyTotals(),
      ...(snapshot?.totals ?? {}),
      cacheHitRate: cacheHitRate(snapshot?.totals ?? {}),
    },
    ranges,
    today: { date: todayKey, lastEventAt: typeof snapshot?.updatedAt === 'number' ? snapshot.updatedAt : null, ...todaySummary },
    series,
    models,
    sessionCount: Array.isArray(snapshot?.sessions) ? snapshot.sessions.length : 0,
  }
}
