/**
 * Ledger behaviour tests.
 *
 * Every assertion here is computed by hand in `fixtures.mjs`, plus one
 * property-style cross-check against an independent naive implementation.
 *
 * @module dsh-token-ledger/test/ledger.test
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { UsageLedger, countersFromUsage, dateKeyOf, emptyCounters, inheritedCut, isForkSession } from '../lib/ledger.js'
import {
  ALPHA_EVENTS,
  ALPHA_EXPECTED,
  BETA_EVENTS,
  BETA_EXPECTED,
  BETA_INHERITED,
  COMBINED_EXPECTED,
  DAY1,
  DAY2,
  DAY3,
  fakeSession,
  withSeq,
} from './fixtures.mjs'

/**
 * Fold one fixture session into a fresh ledger.
 *
 * @param {object[]} events - the session events.
 * @param {string} id - the session id.
 * @param {number} [inheritedEventCount] - inherited prefix length.
 * @returns {UsageLedger} the folded ledger.
 */
function fold(events, id, inheritedEventCount) {
  const ledger = new UsageLedger()
  ledger.adoptHistory({ sessionId: id, events: withSeq(events), inheritedEventCount })
  return ledger
}

test('countersFromUsage derives the total from the four buckets', () => {
  const counters = countersFromUsage({
    inputTokens: 14607,
    outputTokens: 321,
    cacheReadTokens: 128,
    totalTokens: 999999,
  })
  // The provider's own totalTokens field is ignored on purpose; the four
  // buckets are the contract and the total is their sum.
  assert.equal(counters.totalTokens, 15056)
  assert.equal(counters.cacheWriteTokens, 0)
})

test('countersFromUsage rejects unusable reports', () => {
  assert.equal(countersFromUsage(undefined), undefined)
  assert.equal(countersFromUsage(null), undefined)
  assert.equal(countersFromUsage({}), undefined)
  assert.equal(countersFromUsage({ inputTokens: 0, outputTokens: 0 }), undefined)
})

test('emptyCounters is a fresh zeroed object each call', () => {
  const first = emptyCounters()
  const second = emptyCounters()
  first.inputTokens = 5
  assert.equal(second.inputTokens, 0)
})

test('dateKeyOf buckets by local calendar day', () => {
  assert.equal(dateKeyOf(DAY1), '2026-01-15')
  assert.equal(dateKeyOf(DAY2), '2026-01-16')
  assert.equal(dateKeyOf(DAY3), '2026-01-17')
})

test('folds a session into exact totals, calls, days and models', () => {
  const ledger = fold(ALPHA_EVENTS, 'sess-alpha')

  assert.equal(ledger.calls, ALPHA_EXPECTED.calls)
  assert.equal(ledger.totals.inputTokens, ALPHA_EXPECTED.inputTokens)
  assert.equal(ledger.totals.outputTokens, ALPHA_EXPECTED.outputTokens)
  assert.equal(ledger.totals.cacheReadTokens, ALPHA_EXPECTED.cacheReadTokens)
  assert.equal(ledger.totals.cacheWriteTokens, ALPHA_EXPECTED.cacheWriteTokens)
  assert.equal(ledger.totals.totalTokens, ALPHA_EXPECTED.totalTokens)
  assert.equal(ledger.totals.reasoningTokens, ALPHA_EXPECTED.reasoningTokens)

  // Buckets must add up to the total, by construction.
  const buckets =
    ledger.totals.inputTokens +
    ledger.totals.outputTokens +
    ledger.totals.cacheReadTokens +
    ledger.totals.cacheWriteTokens
  assert.equal(buckets, ledger.totals.totalTokens)

  const days = Object.fromEntries([...ledger.daily.values()].map((day) => [day.date, day.counters.totalTokens]))
  assert.deepEqual(days, ALPHA_EXPECTED.sessionDays)

  const models = [...ledger.models.values()]
  assert.equal(models.length, 1)
  assert.equal(models[0].model, 'deepseek-official/deepseek-v4-flash')
  assert.equal(models[0].counters.totalTokens, ALPHA_EXPECTED.totalTokens)
  assert.equal(models[0].calls, ALPHA_EXPECTED.calls)
})

test('a streaming sample is replaced by its final message, not added to it', () => {
  const ledger = fold(ALPHA_EVENTS, 'sess-alpha')
  const step1 = fold(
    [ALPHA_EVENTS[0], ALPHA_EVENTS[4]],
    'sess-alpha',
  )
  // step 1 alone: the chunk (1250) and the identical message (1250) count once.
  assert.equal(step1.calls, 1)
  assert.equal(step1.totals.totalTokens, 1250)
  // And the whole session counts step 3's replacement as one call, not two.
  assert.equal(ledger.calls, 5)
})

test('a differing final value replaces the sample, keeping the buckets coherent', () => {
  const ledger = new UsageLedger()
  const events = withSeq([
    ALPHA_EVENTS[0],
    // sample: 500 in / 10 out -> 510
    ALPHA_EVENTS[8],
    // final: 500 in / 20 out / 900 cache read -> 1420
    ALPHA_EVENTS[9],
  ])
  ledger.adoptHistory({ sessionId: 'replacement', events })
  assert.equal(ledger.calls, 1)
  assert.equal(ledger.totals.inputTokens, 500)
  assert.equal(ledger.totals.outputTokens, 20)
  assert.equal(ledger.totals.cacheReadTokens, 900)
  assert.equal(ledger.totals.totalTokens, 1420)
})

test('failed attempts and usage-less messages are never counted', () => {
  // Steps 4 (message without usage) and 5 (sample with no message) contribute 0.
  const withoutThem = fold(
    ALPHA_EVENTS.filter((_, index) => ![11, 12, 13, 14].includes(index)),
    'sess-alpha',
  )
  const full = fold(ALPHA_EVENTS, 'sess-alpha')
  assert.equal(withoutThem.totals.totalTokens, full.totals.totalTokens)
  assert.equal(withoutThem.calls, full.calls)
})

test('a compaction summary without usage is skipped without error', () => {
  const ledger = new UsageLedger()
  ledger.adoptHistory({
    sessionId: 'compact-nousage',
    events: withSeq([ALPHA_EVENTS[0], ALPHA_EVENTS[16]]),
  })
  assert.equal(ledger.calls, 0)
  assert.equal(ledger.totals.totalTokens, 0)
})

test('a forked session does not recount its inherited prefix but keeps its route', () => {
  const ledger = fold(BETA_EVENTS, 'sess-beta', BETA_INHERITED)
  assert.equal(ledger.calls, BETA_EXPECTED.calls)
  assert.equal(ledger.totals.totalTokens, BETA_EXPECTED.totalTokens)
  const models = [...ledger.models.values()]
  assert.equal(models.length, 1)
  assert.equal(models[0].model, BETA_EXPECTED.modelKey)
})

test('folding twice is idempotent', () => {
  const ledger = new UsageLedger()
  const events = withSeq(ALPHA_EVENTS)
  ledger.adoptHistory({ sessionId: 'sess-alpha', events })
  const afterFirst = ledger.totals.totalTokens
  ledger.adoptHistory({ sessionId: 'sess-alpha', events })
  ledger.adoptSession(fakeSession('sess-alpha', events))
  assert.equal(ledger.totals.totalTokens, afterFirst)
  assert.equal(ledger.calls, ALPHA_EXPECTED.calls)
})

test('snapshot and restore round-trip without double counting', () => {
  const original = new UsageLedger()
  original.adoptHistory({ sessionId: 'sess-alpha', events: withSeq(ALPHA_EVENTS) })
  original.adoptHistory({
    sessionId: 'sess-beta',
    events: withSeq(BETA_EVENTS),
    inheritedEventCount: BETA_INHERITED,
  })
  assert.equal(original.totals.totalTokens, COMBINED_EXPECTED.totalTokens)
  assert.equal(original.calls, COMBINED_EXPECTED.calls)

  // A snapshot must survive a JSON round trip, since that is how it is stored.
  const snapshot = JSON.parse(JSON.stringify(original.snapshot()))
  const restored = new UsageLedger()
  assert.equal(restored.restore(snapshot), true)
  assert.equal(restored.totals.totalTokens, original.totals.totalTokens)
  assert.equal(restored.calls, original.calls)

  // Replaying the same logs after a restart must not double count.
  restored.adoptHistory({ sessionId: 'sess-alpha', events: withSeq(ALPHA_EVENTS) })
  restored.adoptHistory({
    sessionId: 'sess-beta',
    events: withSeq(BETA_EVENTS),
    inheritedEventCount: BETA_INHERITED,
  })
  assert.equal(restored.totals.totalTokens, original.totals.totalTokens)
  assert.equal(restored.calls, original.calls)

  // But genuinely new events must still be counted.
  const extra = [...withSeq(ALPHA_EVENTS), { type: 'assistant/message', seq: 99, time: DAY3, data: { turn: 9, step: 1, usage: { inputTokens: 7, outputTokens: 3 } } }]
  restored.adoptHistory({ sessionId: 'sess-alpha', events: extra })
  assert.equal(restored.totals.totalTokens, original.totals.totalTokens + 10)
})

test('restore rejects foreign or incompatible snapshots', () => {
  const ledger = new UsageLedger()
  assert.equal(ledger.restore(undefined), false)
  assert.equal(ledger.restore(null), false)
  assert.equal(ledger.restore({ version: 999 }), false)
  // A ledger written before the counting rule was fixed must be discarded, not
  // trusted: its cursors would keep the mis-counted totals forever.
  const legacy = new UsageLedger().snapshot()
  legacy.version = 1
  ledger.totals.totalTokens = 123
  assert.equal(ledger.restore(legacy), false)
  assert.equal(ledger.totals.totalTokens, 0)
})

test('snapshots are plain JSON', () => {
  const ledger = fold(ALPHA_EVENTS, 'sess-alpha')
  const snapshot = JSON.parse(JSON.stringify(ledger.snapshot()))
  assert.equal(typeof snapshot.totals.inputTokens, 'number')
  assert.equal(snapshot.totals.calls, ALPHA_EXPECTED.calls)
  assert.equal(snapshot.sessions.length, 1)
  assert.equal(snapshot.sessions[0].sessionId, 'sess-alpha')
  assert.equal(snapshot.cursors['sess-alpha'], ALPHA_EVENTS.length)
})

test('CSV export has a header and one row per entity', () => {
  const ledger = new UsageLedger()
  ledger.adoptHistory({ sessionId: 'sess-alpha', events: withSeq(ALPHA_EVENTS) })

  const daily = ledger.toCsv('daily').trim().split('\r\n')
  assert.equal(daily[0], 'key,calls,inputTokens,outputTokens,cacheReadTokens,cacheWriteTokens,totalTokens,reasoningTokens')
  assert.equal(daily.length, 4) // header + 3 days
  assert.ok(daily[1].startsWith('2026-01-15,3,'))

  assert.equal(ledger.toCsv('sessions').trim().split('\r\n').length, 2)
  assert.equal(ledger.toCsv('models').trim().split('\r\n').length, 2)
  assert.throws(() => ledger.toCsv('nope'), /unknown CSV table/)
})

test('format renders the totals a user reads', () => {
  const text = fold(ALPHA_EVENTS, 'sess-alpha').format()
  assert.match(text, /Token ledger/)
  assert.match(text, /6,220/)
  assert.match(text, /2026-01-15/)
  assert.match(text, /deepseek-official\/deepseek-v4-flash/)
})

test('inheritedCut locates a fork boundary by the marker, not by a count', () => {
  const events = [
    { type: 'session', id: 'child' },
    { type: 'assistant/message', time: DAY1, data: { turn: 1, step: 1, usage: { inputTokens: 999 } } },
    { type: 'session/end-seed', time: DAY1, data: {} },
    { type: 'assistant/message', time: DAY1, data: { turn: 2, step: 1, usage: { inputTokens: 5 } } },
  ]

  // A resume folds in full, whatever number storage offers.
  assert.equal(inheritedCut({ header: { id: 'x' }, events, inheritedEventCount: 2 }), 0)

  // A fork cuts after the marker, and the declared count cannot override it.
  assert.equal(inheritedCut({ header: { parentSession: 'p' }, events, inheritedEventCount: 2 }), 3)
  assert.equal(inheritedCut({ header: { parentSession: 'p' }, events, inheritedEventCount: 9999 }), 3)

  // No marker: a declared count is used only when it can index this list.
  const noMarker = events.filter((event) => event.type !== 'session/end-seed')
  assert.equal(inheritedCut({ header: { parentSession: 'p' }, events: noMarker, inheritedEventCount: 2 }), 2)
  assert.equal(inheritedCut({ header: { parentSession: 'p' }, events: noMarker, inheritedEventCount: 9999 }), 0)
  assert.equal(inheritedCut({ header: { parentSession: 'p' }, events: [] }), 0)
  assert.equal(inheritedCut(), 0)
})

test('isForkSession separates forks from resumes', () => {
  assert.equal(isForkSession({ parentSession: 'p' }), true)
  assert.equal(isForkSession({}), false)
  assert.equal(isForkSession(undefined), false)
  assert.equal(isForkSession({ parentSession: null }), false)
})

/**
 * Regression: a stored session can arrive in the compact row form, where the
 * declared inherited count is expressed in logical-event coordinates and
 * overshoots the array length by an order of magnitude. Treating it as an array
 * index skipped the entire session, which under-counted a real home by hundreds
 * of millions of tokens. The session's own usage must survive.
 */
test('a fork whose declared count overshoots the array is still counted', () => {
  const records = withSeq([
    { type: 'session', id: 'child', parentSession: 'parent', seedLength: 13757 },
    // The parent's history, as the compact row form presents it.
    { type: 'assistant/message', time: DAY1, data: { turn: 1, step: 1, usage: { inputTokens: 400000, outputTokens: 1 } } },
    { type: 'text-chunks', time: DAY1, data: { texts: ['a', 'b'] } },
    { type: 'session/end-seed', time: DAY1, data: {} },
    // The child's own call, which must be counted.
    { type: 'assistant/message', time: DAY1, data: { turn: 2, step: 1, usage: { inputTokens: 700, outputTokens: 30 } } },
  ])

  const ledger = new UsageLedger()
  ledger.adoptHistory({
    sessionId: 'child',
    events: records,
    inheritedEventCount: inheritedCut({
      header: records[0],
      events: records,
      inheritedEventCount: records[0].seedLength,
    }),
  })
  assert.equal(ledger.totals.totalTokens, 730)
  assert.equal(ledger.calls, 1)
})

/** Deterministic PRNG so the property-style check is reproducible. */
function mulberry32(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

test('agrees with an independent naive recomputation over generated logs', () => {
  const random = mulberry32(20260115)
  const count = (max) => Math.floor(random() * max)

  for (let round = 0; round < 25; round += 1) {
    const events = [{ type: 'request/header', seq: 0, time: DAY1, data: { header: { config: { provider: 'p', model: 'm' } } } }]
    const expectedByStep = new Map()
    let compactionTotal = 0
    let seq = 1

    for (let turn = 1; turn <= 4; turn += 1) {
      for (let step = 1; step <= 3; step += 1) {
        const usage = {
          inputTokens: count(50000),
          outputTokens: count(900),
          cacheReadTokens: count(90000),
        }
        if (usage.inputTokens + usage.outputTokens + usage.cacheReadTokens === 0) continue
        // A sample may precede the final message; both describe the same attempt.
        if (random() < 0.5) {
          events.push({ type: 'assistant/chunk', seq: seq++, time: DAY1, data: { turn, step, chunk: { type: 'usage', usage } } })
        }
        events.push({ type: 'assistant/message', seq: seq++, time: DAY1, data: { turn, step, usage } })
        // A retry for the same turn/step replaces the earlier attempt.
        const key = `${turn}#${step}`
        if (random() < 0.25) {
          const retry = { inputTokens: count(50000), outputTokens: count(900), cacheReadTokens: count(90000) }
          events.push({ type: 'assistant/message', seq: seq++, time: DAY1, data: { turn, step, usage: retry } })
          expectedByStep.set(key, retry)
        } else {
          expectedByStep.set(key, usage)
        }
        events.push({ type: 'step/end', seq: seq++, time: DAY1, data: { turn, step } })
      }
      if (random() < 0.4) {
        const usage = { inputTokens: count(20000), outputTokens: count(500), cacheReadTokens: count(30000) }
        events.push({ type: 'compaction/summary', seq: seq++, time: DAY2, data: { usage } })
        compactionTotal += usage.inputTokens + usage.outputTokens + usage.cacheReadTokens
      }
    }

    const naiveTotal =
      compactionTotal +
      [...expectedByStep.values()].reduce(
        (sum, usage) => sum + usage.inputTokens + usage.outputTokens + usage.cacheReadTokens,
        0,
      )

    const ledger = new UsageLedger()
    ledger.adoptHistory({ sessionId: `gen-${round}`, events })
    assert.equal(ledger.totals.totalTokens, naiveTotal, `round ${round} total`)
    assert.equal(ledger.calls, expectedByStep.size + (compactionTotal > 0 ? countCompactions(events) : 0), `round ${round} calls`)
  }
})

/**
 * Count compaction summaries holding usage in a generated log.
 *
 * @param {object[]} events - the log.
 * @returns {number} the number of counted compactions.
 */
function countCompactions(events) {
  return events.filter((event) => event.type === 'compaction/summary' && event.data?.usage !== undefined).length
}
