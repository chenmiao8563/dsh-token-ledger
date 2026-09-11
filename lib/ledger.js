/**
 * The token ledger: a deterministic fold over DSH session events.
 *
 * This module is intentionally pure — no Cordis context, no filesystem, no
 * clock beyond the timestamps already carried by events. The same event
 * sequence always produces the same ledger, which is what makes the ledger
 * auditable: the CLI can recompute it from raw logs and diff the result
 * against whatever the running plugin persisted.
 *
 * ## Which events carry usage
 *
 * | Event                | Payload                        | Meaning                                  |
 * | -------------------- | ------------------------------ | ---------------------------------------- |
 * | `assistant/message`  | `data.usage`, plus turn/step   | authoritative usage of a completed step  |
 * | `assistant/chunk`    | `data.chunk.usage` when the    | streaming sample; only a candidate       |
 * |                      | chunk type is `usage`          |                                          |
 * | `compaction/summary` | `data.usage`                   | one provider call for compaction         |
 * | `request/header`     | `data.header.config`           | provider/model attribution               |
 *
 * ## Counting rules
 *
 * 1. **Successful anchors only.** A failed or cancelled model attempt never
 *    appends `assistant/message`, so it is never counted.
 * 2. **Replace, do not add.** When a step emits a `usage` chunk and then its
 *    final `assistant/message`, the final value replaces the earlier sample.
 * 3. **Inherited history is not recounted.** A forked or resumed session
 *    carries its parent's prefix; folding starts at the inherited cut.
 * 4. **`totalTokens` is the sum of the four buckets.** It is derived rather
 *    than read from the provider's own `totalTokens`, because the provider
 *    field is exactly `input + output + cacheRead + cacheWrite` and deriving it
 *    keeps the buckets and the total consistent by construction.
 * 5. **Reasoning tokens are a subset of output.** They are reported separately
 *    for interest and are never added into `totalTokens`.
 * 6. **Days are local days.** Users read their own calendar, not UTC.
 *
 * @module dsh-token-ledger/ledger
 */

/**
 * Bumped whenever the folded state shape **or the counting semantics** change.
 *
 * A stored ledger is a cache of a fold, and its per-session cursors claim those
 * sessions are fully consumed. State written by a version that counted
 * differently would therefore keep its wrong totals forever: the fixed version
 * would skip every session as already consumed. Version 2 exists precisely
 * because 0.1.0's boundary rule mis-counted forks, so its files must be
 * discarded and rebuilt rather than trusted. Version 3 adds the per-day last
 * activity time for the same reason: a file written before it has no such
 * field, and its cursors would stop those days from ever acquiring one.
 */
export const LEDGER_VERSION = 3

/** The four disjoint provider usage buckets, all defaulting to zero. */
const BUCKET_KEYS = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens']

/**
 * Coerce a provider-reported count into a non-negative integer.
 *
 * @param {unknown} value - the raw field.
 * @returns {number} a safe integer, or 0 when the value is unusable.
 */
function toCount(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0
  return Math.floor(value)
}

/**
 * A fresh, zeroed bucket set.
 *
 * @returns {{ inputTokens: number, outputTokens: number, cacheReadTokens: number, cacheWriteTokens: number, totalTokens: number, reasoningTokens: number }}
 */
export function emptyCounters() {
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
 * Convert one provider `usage` object into ledger counters.
 *
 * @param {unknown} usage - a provider usage report.
 * @returns {ReturnType<typeof emptyCounters> | undefined} `undefined` when the
 *   report carries no usable counts, so callers can tell "no usage" apart from
 *   "zero usage".
 */
export function countersFromUsage(usage) {
  if (usage === null || typeof usage !== 'object') return undefined
  const counters = {
    inputTokens: toCount(usage.inputTokens),
    outputTokens: toCount(usage.outputTokens),
    cacheReadTokens: toCount(usage.cacheReadTokens),
    cacheWriteTokens: toCount(usage.cacheWriteTokens),
    totalTokens: 0,
    reasoningTokens: toCount(usage.reasoningTokens),
  }
  counters.totalTokens =
    counters.inputTokens + counters.outputTokens + counters.cacheReadTokens + counters.cacheWriteTokens
  if (counters.totalTokens === 0) return undefined
  return counters
}

/**
 * Sum two counter sets into a new object.
 *
 * @param {ReturnType<typeof emptyCounters>} left - the accumulator.
 * @param {ReturnType<typeof emptyCounters>} right - the addend.
 * @returns {ReturnType<typeof emptyCounters>} the elementwise sum.
 */
export function addCounters(left, right) {
  const out = {}
  for (const key of [...BUCKET_KEYS, 'totalTokens', 'reasoningTokens']) out[key] = left[key] + right[key]
  return out
}

/**
 * Add counters in place.
 *
 * @param {ReturnType<typeof emptyCounters>} target - mutated accumulator.
 * @param {ReturnType<typeof emptyCounters>} delta - the addend.
 * @returns {void}
 */
function addInto(target, delta) {
  for (const key of [...BUCKET_KEYS, 'totalTokens', 'reasoningTokens']) target[key] += delta[key]
}

/**
 * Subtract counters in place. Used when a later sample replaces an earlier one.
 *
 * @param {ReturnType<typeof emptyCounters>} target - mutated accumulator.
 * @param {ReturnType<typeof emptyCounters>} delta - the subtrahend.
 * @returns {void}
 */
function subInto(target, delta) {
  for (const key of [...BUCKET_KEYS, 'totalTokens', 'reasoningTokens']) target[key] -= delta[key]
}

/**
 * Compare the four buckets, ignoring the derived total and reasoning subset.
 *
 * @param {ReturnType<typeof emptyCounters>} a - left counters.
 * @param {ReturnType<typeof emptyCounters>} b - right counters.
 * @returns {boolean} true when both describe the same provider usage.
 */
function sameBuckets(a, b) {
  return BUCKET_KEYS.every((key) => a[key] === b[key])
}

function pad2(value) {
  return value < 10 ? `0${value}` : String(value)
}

/**
 * Format an event timestamp as a local calendar day.
 *
 * @param {unknown} timeMs - event time in milliseconds since the epoch.
 * @param {Date} [now] - clock fallback for events without a usable time.
 * @returns {string} `YYYY-MM-DD`.
 */
export function dateKeyOf(timeMs, now = new Date()) {
  const date = new Date(typeof timeMs === 'number' && Number.isFinite(timeMs) && timeMs > 0 ? timeMs : now.getTime())
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/**
 * Whether a stored session header describes a fork.
 *
 * @param {object} [header] - a `SessionHeader`-shaped object.
 * @returns {boolean} true when the session has a parent.
 */
export function isForkSession(header) {
  return header?.parentSession !== undefined && header?.parentSession !== null
}

/**
 * Decide how much of a session's event list belongs to another session.
 *
 * A session log can carry a prefix of already-recorded history. Two very
 * different situations produce one, and only one of them must be cut:
 *
 * - **Fork** (`header.parentSession` is set): the prefix is the *parent
 *   session's* history, and the parent is counted separately. Folding the
 *   prefix here would count those tokens twice, so it is cut.
 * - **Resume** (no parent): the prefix is *this session's own* earlier history,
 *   stored once, with no other session to double count it against. Cutting it
 *   would lose tokens, so nothing is cut.
 *
 * The distinction was established against real logs, not inferred: for every
 * forked session whose parent log was still on disk, the usage fingerprints
 * found before the `session/end-seed` marker were a subset of the parent's,
 * while for the non-forked logs carrying the same marker the prefix did not
 * reappear later in the file.
 *
 * ## Why the boundary is located by the marker
 *
 * The obvious implementation — skip `inheritedEventCount` leading entries — is
 * wrong, and shipping it under-counted a real 139-session home by hundreds of
 * millions of tokens. A stored session reaches this fold in one of two
 * coordinate spaces:
 *
 * - the **logical** event list, where positions match `seq` and
 *   `inheritedEventCount` is directly meaningful;
 * - the **compact row** form the log is stored in, where several logical events
 *   share one record, so the declared count overshoots the array length and
 *   applying it skipped the entire session.
 *
 * `session/end-seed` is present in both forms and marks the same boundary, so
 * it is authoritative. The declared count is only a fallback, and only when it
 * is a plausible index into the list we were actually handed: a count that
 * reaches past the end proves it is not in this list's space and is refused
 * rather than trusted. Callers are expected to warn when a fork yields a cut of
 * zero, because that over-counts rather than silently losing data.
 *
 * @param {object} input - what is known about the session's stored content.
 * @param {object} [input.header] - stored header/meta carrying `parentSession`.
 * @param {object[]} [input.events] - the stored event list about to be folded.
 * @param {number} [input.inheritedEventCount] - the cut storage declares.
 * @returns {number} the number of leading events to skip.
 */
export function inheritedCut({ header, events, inheritedEventCount } = {}) {
  if (!isForkSession(header)) return 0
  const list = Array.isArray(events) ? events : []
  const marker = list.findIndex((event) => event?.type === 'session/end-seed')
  if (marker >= 0) return marker + 1
  const declared =
    typeof inheritedEventCount === 'number' && Number.isFinite(inheritedEventCount) && inheritedEventCount > 0
      ? Math.floor(inheritedEventCount)
      : 0
  return declared > 0 && declared < list.length ? declared : 0
}

/**
 * Fold a sequence of DSH session events into cumulative token usage.
 *
 * The ledger is incremental and restart-safe: it keeps a per-session cursor
 * over consumed events, and `snapshot()`/`restore()` round-trip that cursor so
 * a restarted process resumes instead of recounting history.
 */
export class UsageLedger {
  constructor() {
    this.reset()
  }

  /** Drop all state. */
  reset() {
    /** @type {ReturnType<typeof emptyCounters>} */
    this.totals = emptyCounters()
    /** Number of committed provider calls. */
    this.calls = 0
    /** @type {Map<string, { date: string, counters: ReturnType<typeof emptyCounters>, calls: number, lastAt: number|null }>} */
    this.daily = new Map()
    /** @type {Map<string, { model: string, counters: ReturnType<typeof emptyCounters>, calls: number }>} */
    this.models = new Map()
    /** @type {Map<string, { sessionId: string, counters: ReturnType<typeof emptyCounters>, calls: number, firstAt: number|null, lastAt: number|null }>} */
    this.sessions = new Map()
    /** @type {Map<string, number>} next unconsumed event index, per session */
    this.cursors = new Map()
    /** @type {Map<string, { turn: unknown, step: unknown, counters: ReturnType<typeof emptyCounters> }>} */
    this.pending = new Map()
    /** @type {Map<string, { key: string, counters: ReturnType<typeof emptyCounters>, dateKey: string, modelKey: string }>} */
    this.last = new Map()
    /** @type {Map<string, { provider: string, model: string }>} */
    this.routes = new Map()
    this.compactionSeq = 0
  }

  /**
   * The provider/model currently attributed to a session.
   *
   * @param {string} sessionId - the session id.
   * @returns {{ provider: string, model: string }} the last observed route.
   */
  routeOf(sessionId) {
    return this.routes.get(sessionId) ?? { provider: 'unknown', model: 'unknown' }
  }

  sessionRecord(sessionId) {
    let record = this.sessions.get(sessionId)
    if (record === undefined) {
      record = { sessionId, counters: emptyCounters(), calls: 0, firstAt: null, lastAt: null }
      this.sessions.set(sessionId, record)
    }
    return record
  }

  dailyRecord(dateKey) {
    let record = this.daily.get(dateKey)
    if (record === undefined) {
      record = { date: dateKey, counters: emptyCounters(), calls: 0, lastAt: null }
      this.daily.set(dateKey, record)
    }
    return record
  }

  modelRecord(modelKey) {
    let record = this.models.get(modelKey)
    if (record === undefined) {
      record = { model: modelKey, counters: emptyCounters(), calls: 0 }
      this.models.set(modelKey, record)
    }
    return record
  }

  /**
   * Commit one provider call into every aggregate.
   *
   * When `replacementKey` equals the previous commit's key for this session
   * (same turn and step), the earlier value is subtracted first, so a streamed
   * sample followed by its final message counts once.
   *
   * @param {string} sessionId - the owning session.
   * @param {object} input - the commit.
   * @param {ReturnType<typeof emptyCounters>} input.counters - the usage.
   * @param {unknown} input.time - the event timestamp.
   * @param {string|null} input.provider - explicit provider override.
   * @param {string|null} input.model - explicit model override.
   * @param {string} input.replacementKey - identity of the attempt.
   * @returns {void}
   */
  commit(sessionId, { counters, time, provider = null, model = null, replacementKey }) {
    const dateKey = dateKeyOf(time)
    const session = this.sessionRecord(sessionId)
    const previous = this.last.get(sessionId)

    if (previous !== undefined && previous.key === replacementKey) {
      if (sameBuckets(previous.counters, counters)) return
      subInto(this.totals, previous.counters)
      subInto(session.counters, previous.counters)
      subInto(this.dailyRecord(previous.dateKey).counters, previous.counters)
      subInto(this.modelRecord(previous.modelKey).counters, previous.counters)
      this.calls -= 1
      session.calls -= 1
      this.dailyRecord(previous.dateKey).calls -= 1
      this.modelRecord(previous.modelKey).calls -= 1
    }

    const route = this.routeOf(sessionId)
    const modelKey = `${provider ?? route.provider}/${model ?? route.model}`

    addInto(this.totals, counters)
    addInto(session.counters, counters)
    addInto(this.dailyRecord(dateKey).counters, counters)
    addInto(this.modelRecord(modelKey).counters, counters)
    this.calls += 1
    session.calls += 1
    this.dailyRecord(dateKey).calls += 1
    this.modelRecord(modelKey).calls += 1

    const at = typeof time === 'number' && Number.isFinite(time) ? time : null
    if (at !== null) {
      if (session.firstAt === null || at < session.firstAt) session.firstAt = at
      if (session.lastAt === null || at > session.lastAt) session.lastAt = at
      // The day remembers the latest event it saw; the settings page reads it
      // as "the day that finished latest". A replaced sample never lowers this,
      // because a maximum cannot be unwound without every timestamp behind it.
      const day = this.dailyRecord(dateKey)
      if (day.lastAt === null || at > day.lastAt) day.lastAt = at
    }

    this.last.set(sessionId, { key: replacementKey, counters, dateKey, modelKey })
  }

  /**
   * Fold a single session event.
   *
   * Events the ledger does not care about return immediately, so hooking this
   * to every session event stays cheap.
   *
   * @param {string} sessionId - the owning session.
   * @param {object} event - one committed `SessionEvent`.
   * @returns {void}
   */
  consume(sessionId, event) {
    if (event === null || typeof event !== 'object') return
    const data = event.data ?? {}

    switch (event.type) {
      case 'request/header': {
        const config = data.header?.config
        if (config !== undefined && config !== null) this.setRoute(sessionId, config)
        return
      }

      case 'compaction/summary': {
        const counters = countersFromUsage(data.usage)
        if (counters === undefined) return
        this.compactionSeq += 1
        this.commit(sessionId, {
          counters,
          time: event.time,
          replacementKey: `compaction#${this.compactionSeq}`,
        })
        return
      }

      case 'assistant/chunk': {
        const chunk = data.chunk
        if (chunk === null || typeof chunk !== 'object' || chunk.type !== 'usage') return
        const counters = countersFromUsage(chunk.usage)
        if (counters === undefined) return
        this.pending.set(sessionId, { turn: data.turn, step: data.step, counters })
        return
      }

      case 'assistant/message': {
        const { turn, step } = data
        const pending = this.pending.get(sessionId)
        const matching =
          pending !== undefined && pending.turn === turn && pending.step === step ? pending : undefined
        const counters = countersFromUsage(data.usage) ?? matching?.counters
        if (counters === undefined) return
        this.pending.delete(sessionId)
        this.commit(sessionId, {
          counters,
          time: event.time,
          replacementKey: `attempt#${turn}#${step}`,
        })
        return
      }

      case 'step/end':
      case 'turn/end': {
        this.pending.delete(sessionId)
        return
      }

      default:
    }
  }

  /**
   * Record the provider/model a session's calls should be attributed to.
   *
   * @param {string} sessionId - the session id.
   * @param {object} config - a `request/header` call configuration.
   * @returns {void}
   */
  setRoute(sessionId, config) {
    this.routes.set(sessionId, {
      provider: typeof config.provider === 'string' ? config.provider : 'unknown',
      model: typeof config.model === 'string' ? config.model : 'unknown',
    })
  }

  /**
   * Seed a session's route from a skipped prefix.
   *
   * Only `request/header` is inspected; no usage is folded, so an inherited
   * prefix can never contribute tokens.
   *
   * @param {string} sessionId - the session id.
   * @param {object[]} events - the session's full event list.
   * @param {number} cut - length of the prefix to skip.
   * @returns {void}
   */
  primeRoute(sessionId, events, cut) {
    for (let index = 0; index < cut; index += 1) {
      const event = events[index]
      if (event?.type !== 'request/header') continue
      const config = event.data?.header?.config
      if (config !== undefined && config !== null) this.setRoute(sessionId, config)
    }
  }

  /**
   * Fold an offline history: an ordered event array plus the inherited cut.
   *
   * This is the path used for backfilling every stored session on startup, and
   * by the CLI when it recomputes the ledger from raw logs.
   *
   * @param {object} history - the session's stored content.
   * @param {string} history.sessionId - the session id.
   * @param {object[]} history.events - every event, inherited prefix included.
   * @param {number} [history.inheritedEventCount] - length of the inherited prefix.
   * @returns {void}
   */
  adoptHistory({ sessionId, events, inheritedEventCount = 0 }) {
    if (!Array.isArray(events)) return
    const id = String(sessionId)
    if (!this.cursors.has(id)) {
      const cut = inheritedEventCount > 0 ? inheritedEventCount : 0
      // A forked session's `request/header` usually lives in the inherited
      // prefix we are about to skip. Read the route out of that prefix without
      // counting any usage in it, or the fork's calls would be attributed to
      // `unknown/unknown`.
      if (cut > 0) this.primeRoute(id, events, cut)
      this.cursors.set(id, cut)
    }
    let cursor = this.cursors.get(id)
    while (cursor < events.length) {
      const event = events[cursor]
      if (event === undefined) break
      this.consume(id, event)
      cursor += 1
    }
    this.cursors.set(id, cursor)
  }

  /**
   * Fold a live Cordis `Session` by reading only the events not yet consumed.
   *
   * Prefers the incremental `seq`/`eventAt` pair so that a session with a long
   * log is not re-materialized on every appended event.
   *
   * @param {object} session - a live Session.
   * @returns {void}
   */
  adoptSession(session) {
    const id = String(session?.id ?? session?.sessionId ?? '')
    if (id === '') return
    if (!this.cursors.has(id)) {
      const inherited = session.inheritedEventCount
      const fromHeader = session.header?.seedLength ?? session.firstLiveSeq
      const start = typeof inherited === 'number' && inherited > 0 ? inherited : typeof fromHeader === 'number' && fromHeader > 0 ? fromHeader : 0
      this.cursors.set(id, start)
    }

    const total = typeof session.seq === 'number' ? session.seq : (session.events?.length ?? 0)
    let cursor = this.cursors.get(id)
    while (cursor < total) {
      const event = typeof session.eventAt === 'function' ? session.eventAt(cursor) : session.events?.[cursor]
      if (event === undefined) break
      this.consume(id, event)
      cursor += 1
    }
    this.cursors.set(id, cursor)
  }

  /**
   * Export the ledger as plain JSON.
   *
   * Everything here is a primitive or a plain object, so the result is
   * losslessly serializable and safe to hand to a browser half.
   *
   * @returns {object} the snapshot.
   */
  snapshot() {
    const countersOf = (record) => ({ ...record.counters })
    return {
      version: LEDGER_VERSION,
      updatedAt: Date.now(),
      totals: { ...this.totals, calls: this.calls },
      daily: [...this.daily.values()]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((day) => ({ date: day.date, calls: day.calls, lastAt: day.lastAt, ...countersOf(day) })),
      models: [...this.models.values()]
        .sort((a, b) => b.counters.totalTokens - a.counters.totalTokens)
        .map((model) => ({ model: model.model, calls: model.calls, ...countersOf(model) })),
      sessions: [...this.sessions.values()]
        .sort((a, b) => b.counters.totalTokens - a.counters.totalTokens)
        .map((session) => ({
          sessionId: session.sessionId,
          calls: session.calls,
          firstAt: session.firstAt,
          lastAt: session.lastAt,
          ...countersOf(session),
        })),
      cursors: Object.fromEntries(this.cursors),
    }
  }

  /**
   * Merge a snapshot back in. Returns false for missing or incompatible state,
   * which callers treat as "start fresh" rather than as an error.
   *
   * The postcondition of a `false` return is an empty ledger, never a partially
   * loaded one: the state is cleared before the snapshot is judged, so a
   * rejected file cannot leave stale totals or cursors behind for the next
   * caller to mistake for real data.
   *
   * @param {unknown} snapshot - a previously produced snapshot.
   * @returns {boolean} whether the snapshot was usable.
   */
  restore(snapshot) {
    this.reset()
    if (snapshot === null || typeof snapshot !== 'object') return false
    if (snapshot.version !== LEDGER_VERSION) return false

    const absorb = (raw) => countersFromUsage(raw)
    const totals = absorb(snapshot.totals)
    if (totals !== undefined) addInto(this.totals, totals)
    this.calls = toCount(snapshot.totals?.calls)

    for (const day of snapshot.daily ?? []) {
      const record = this.dailyRecord(String(day.date))
      const counters = absorb(day)
      if (counters !== undefined) addInto(record.counters, counters)
      record.calls = toCount(day.calls)
      record.lastAt = typeof day.lastAt === 'number' && Number.isFinite(day.lastAt) ? day.lastAt : null
    }
    for (const model of snapshot.models ?? []) {
      const record = this.modelRecord(String(model.model ?? 'unknown/unknown'))
      const counters = absorb(model)
      if (counters !== undefined) addInto(record.counters, counters)
      record.calls = toCount(model.calls)
    }
    for (const session of snapshot.sessions ?? []) {
      const id = String(session.sessionId ?? '')
      if (id === '') continue
      const record = this.sessionRecord(id)
      const counters = absorb(session)
      if (counters !== undefined) addInto(record.counters, counters)
      record.calls = toCount(session.calls)
      record.firstAt = typeof session.firstAt === 'number' ? session.firstAt : null
      record.lastAt = typeof session.lastAt === 'number' ? session.lastAt : null
    }
    for (const [id, cursor] of Object.entries(snapshot.cursors ?? {})) {
      this.cursors.set(String(id), toCount(cursor))
    }
    return true
  }

  /**
   * Render a human-readable summary.
   *
   * @param {object} [options] - rendering options.
   * @param {number} [options.days] - how many recent days to list.
   * @param {number} [options.models] - how many models to list.
   * @returns {string} the summary text.
   */
  format({ days = 7, models = 5 } = {}) {
    const n = (value) => value.toLocaleString('en-US')
    const lines = [
      'Token ledger',
      '',
      `  calls              ${n(this.calls)}`,
      `  input (uncached)   ${n(this.totals.inputTokens)}`,
      `  cache read         ${n(this.totals.cacheReadTokens)}`,
      `  cache write        ${n(this.totals.cacheWriteTokens)}`,
      `  output             ${n(this.totals.outputTokens)}`,
      `  total              ${n(this.totals.totalTokens)}`,
    ]
    if (this.totals.reasoningTokens > 0) {
      lines.push(`  of which reasoning ${n(this.totals.reasoningTokens)}`)
    }
    if (this.totals.cacheReadTokens > 0) {
      const share = Math.round((this.totals.cacheReadTokens / this.totals.totalTokens) * 100)
      lines.push(`  cache hit share    ${share}%`)
    }

    const recent = [...this.daily.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, days)
    if (recent.length > 0) {
      lines.push('', `Last ${recent.length} day(s)`)
      for (const day of recent) {
        lines.push(`  ${day.date}  ${n(day.counters.totalTokens).padStart(15)}  ${n(day.calls).padStart(6)} calls`)
      }
    }

    const top = [...this.models.values()]
      .sort((a, b) => b.counters.totalTokens - a.counters.totalTokens)
      .slice(0, models)
    if (top.length > 0) {
      lines.push('', 'By model')
      for (const model of top) {
        lines.push(`  ${model.model}  ${n(model.counters.totalTokens)}  ${n(model.calls)} calls`)
      }
    }
    return lines.join('\n')
  }

  /**
   * Render one aggregate as CSV, for spreadsheets and audit trails.
   *
   * @param {'daily'|'sessions'|'models'} [kind] - which table to emit.
   * @returns {string} CSV text with a header row and CRLF line endings.
   */
  toCsv(kind = 'daily') {
    const header = [
      'key',
      'calls',
      'inputTokens',
      'outputTokens',
      'cacheReadTokens',
      'cacheWriteTokens',
      'totalTokens',
      'reasoningTokens',
    ]
    const rows = []
    const push = (key, record) => {
      rows.push([
        key,
        record.calls,
        record.counters.inputTokens,
        record.counters.outputTokens,
        record.counters.cacheReadTokens,
        record.counters.cacheWriteTokens,
        record.counters.totalTokens,
        record.counters.reasoningTokens,
      ])
    }

    if (kind === 'daily') {
      for (const day of [...this.daily.values()].sort((a, b) => a.date.localeCompare(b.date))) push(day.date, day)
    } else if (kind === 'models') {
      for (const model of [...this.models.values()].sort((a, b) => b.counters.totalTokens - a.counters.totalTokens)) {
        push(model.model, model)
      }
    } else if (kind === 'sessions') {
      for (const session of [...this.sessions.values()].sort((a, b) => b.counters.totalTokens - a.counters.totalTokens)) {
        push(session.sessionId, session)
      }
    } else {
      throw new Error(`unknown CSV table "${kind}" (expected daily, sessions, or models)`)
    }

    return [header, ...rows].map((row) => row.join(',')).join('\r\n') + '\r\n'
  }
}
