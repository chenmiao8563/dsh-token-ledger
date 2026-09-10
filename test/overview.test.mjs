/**
 * Overview payload tests.
 *
 * The payload is the contract between the host half and the browser half, and
 * the browser half cannot be exercised here, so the arithmetic it depends on is
 * pinned exactly.
 *
 * @module dsh-token-ledger/test/overview.test
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildOverview, buildSeries, cacheHitRate, dayKey, parseDayKey, rangeStart, summarize } from '../lib/overview.js'

/** A fixed clock: local noon on 2026-03-15, a Sunday in a 31-day month. */
const NOW = new Date(2026, 2, 15, 12, 0, 0)

/**
 * A ledger daily row.
 *
 * @param {string} date - the day key.
 * @param {number} totalTokens - total for the day.
 * @param {{ calls?: number, inputTokens?: number, cacheReadTokens?: number }} [extra] - overrides.
 * @returns {object} the row.
 */
function row(date, totalTokens, { calls = 1, inputTokens = totalTokens, cacheReadTokens = 0 } = {}) {
  return {
    date,
    calls,
    inputTokens,
    outputTokens: 0,
    cacheReadTokens,
    cacheWriteTokens: 0,
    totalTokens,
    reasoningTokens: 0,
  }
}

test('day keys round-trip through local time', () => {
  assert.equal(dayKey(new Date(2026, 2, 15, 23, 59, 59)), '2026-03-15')
  assert.equal(dayKey(new Date(2026, 0, 1, 0, 0, 0)), '2026-01-01')
  assert.equal(dayKey(parseDayKey('2026-03-15')), '2026-03-15')
})

test('rangeStart uses a trailing week but calendar month and year', () => {
  assert.equal(dayKey(rangeStart('week', NOW)), '2026-03-09') // today plus the six days before it
  assert.equal(dayKey(rangeStart('month', NOW)), '2026-03-01')
  assert.equal(dayKey(rangeStart('year', NOW)), '2026-01-01')
  assert.throws(() => rangeStart('decade', NOW), /unknown range/)
})

test('cacheHitRate is defined over input only, and null when there is none', () => {
  assert.equal(cacheHitRate({ inputTokens: 200, cacheReadTokens: 800 }), 0.8)
  assert.equal(cacheHitRate({ inputTokens: 0, cacheReadTokens: 0 }), null)
  assert.equal(cacheHitRate({}), null)
})

test('summarize adds counters and counts only days that spent tokens', () => {
  const summary = summarize([row('2026-03-13', 100), row('2026-03-14', 0, { calls: 0 }), row('2026-03-15', 300)])
  assert.equal(summary.totals.totalTokens, 400)
  assert.equal(summary.calls, 2)
  assert.equal(summary.activeDays, 2)
})

test('buildSeries is contiguous, zero-filled, ascending, and bounded', () => {
  const byDay = new Map([
    ['2026-03-13', row('2026-03-13', 100)],
    ['2026-03-15', row('2026-03-15', 300)],
  ])
  const series = buildSeries(byDay, NOW)
  assert.deepEqual(
    series.map((day) => day.date),
    ['2026-03-13', '2026-03-14', '2026-03-15'],
  )
  assert.equal(series[1].totalTokens, 0, 'the missing day is present and zeroed')
  assert.equal(series[1].calls, 0)
  assert.equal(series[2].totalTokens, 300)

  // A limit keeps the newest days, never the oldest.
  const clipped = buildSeries(byDay, NOW, 2)
  assert.deepEqual(
    clipped.map((day) => day.date),
    ['2026-03-14', '2026-03-15'],
  )
})

test('buildSeries always emits at least today when the ledger is empty', () => {
  const series = buildSeries(new Map(), NOW)
  assert.deepEqual(
    series.map((day) => day.date),
    ['2026-03-15'],
  )
  assert.equal(series[0].totalTokens, 0)
})

test('buildOverview separates the three ranges correctly', () => {
  const snapshot = {
    updatedAt: NOW.getTime(),
    totals: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, reasoningTokens: 0 },
    daily: [
      row('2025-12-31', 1), // last year
      row('2026-01-05', 10), // this year, before this month
      row('2026-02-20', 20), // this year, last month
      row('2026-03-08', 30), // this month, before the trailing week
      row('2026-03-09', 40, { inputTokens: 10, cacheReadTokens: 90 }), // first day of the week range
      row('2026-03-15', 60), // today
    ],
    models: [{ model: 'p/m', calls: 6, totalTokens: 161, inputTokens: 10, cacheReadTokens: 90 }],
    sessions: [{ sessionId: 'a' }],
  }

  const overview = buildOverview(snapshot, { now: NOW })

  assert.equal(overview.ranges.week.kind, 'week')
  assert.equal(overview.ranges.week.from, '2026-03-09')
  assert.equal(overview.ranges.week.totals.totalTokens, 100) // 40 + 60
  assert.equal(overview.ranges.month.totals.totalTokens, 130) // 30 + 40 + 60
  assert.equal(overview.ranges.month.from, '2026-03-01')
  assert.equal(overview.ranges.year.totals.totalTokens, 160) // 10 + 20 + 30 + 40 + 60
  assert.equal(overview.ranges.year.from, '2026-01-01')

  assert.equal(overview.today.date, '2026-03-15')
  assert.equal(overview.today.totals.totalTokens, 60)
  assert.equal(overview.today.calls, 1)

  assert.equal(overview.sessionCount, 1)
  assert.equal(overview.models.length, 1)
  assert.equal(overview.models[0].cacheHitRate, 0.9)
  assert.equal(overview.generatedAt, NOW.getTime())
})

test('buildOverview tolerates an empty or malformed snapshot', () => {
  for (const snapshot of [undefined, null, {}, { daily: 'nope' }, { totals: null, daily: [{ date: 5 }] }]) {
    const overview = buildOverview(snapshot, { now: NOW })
    assert.equal(overview.ranges.week.totals.totalTokens, 0)
    assert.equal(overview.today.totals.totalTokens, 0)
    assert.equal(overview.series.length >= 1, true)
    assert.equal(overview.models.length, 0)
    assert.equal(overview.sessionCount, 0)
    // The whole payload must survive a JSON round trip, since it is served.
    assert.deepEqual(JSON.parse(JSON.stringify(overview)).plugin, 'token-ledger')
  }
})
