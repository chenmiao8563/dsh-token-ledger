/**
 * Bill tests.
 *
 * A bill is arithmetic over two sources that do not agree on names, so what is
 * pinned here is exactly that: how a ledger model joins a price row, how tokens are
 * split by a vendor's peak window before a price is applied, what happens to a model
 * with no price, and how a monthly plan is spread over the days a bill covers.
 *
 * @module dsh-token-ledger/test/bill.test
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  BILL_DIMENSIONS,
  BILL_RANGES,
  BILL_SECTIONS,
  billToCsv,
  buildBill,
  buildBillSections,
  costOf,
  entryFor,
  modelMatch,
  modelTokens,
  priceEntries,
  rangeBounds,
  shortSessionId,
  subscriptionShare,
  workspaceName,
} from '../lib/bill.js'

/** Money, to the cent: floating-point sums are never exactly equal. */
function closeTo(actual, expected, what = '') {
  assert.ok(Math.abs(actual - expected) < 0.005, `${what} expected ~${expected}, saw ${actual}`)
}

/** Counters, with the total derived the way the ledger derives it. */
function counters(input, output, cacheRead = 0, cacheWrite = 0) {
  const total = input + output + cacheRead + cacheWrite
  return { inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite, totalTokens: total, reasoningTokens: 0 }
}

/** A usage row: one day, session and model, split by the vendor's window. */
function usage(date, sessionId, model, peak, offPeak, calls = 1) {
  return {
    date,
    sessionId,
    model,
    calls,
    ...counters(peak.inputTokens + offPeak.inputTokens, peak.outputTokens + offPeak.outputTokens, peak.cacheReadTokens + offPeak.cacheReadTokens),
    peak: { ...peak, totalTokens: peak.inputTokens + peak.outputTokens + peak.cacheReadTokens + peak.cacheWriteTokens, reasoningTokens: 0 },
    offPeak: { ...offPeak, totalTokens: offPeak.inputTokens + offPeak.outputTokens + offPeak.cacheReadTokens + offPeak.cacheWriteTokens, reasoningTokens: 0 },
  }
}

/** An empty counter set for a period. */
const none = () => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cacheWriteTokens_: 0 })

/** A price catalogue in the shape `rates-service#read` serves. */
function catalogue(overrides = {}) {
  return {
    plugin: 'token-ledger',
    currency: 'USD',
    quote: 'CNY',
    priceSource: 'modelsdev',
    fx: { available: true, rate: 7, base: 'USD', quote: 'CNY', overridden: false },
    vendors: [
      {
        vendor: 'deepseek',
        modelCount: 1,
        source: 'vendor',
        currency: 'CNY',
        models: [
          { id: 'deepseek/deepseek-flash@peak', name: 'DeepSeek-V4.1-Flash', vendor: 'deepseek', prices: { input: 2, output: 8, cacheRead: 0.04, cacheWrite: null }, period: 'peak', source: 'vendor' },
          { id: 'deepseek/deepseek-flash@offPeak', name: 'DeepSeek-V4.1-Flash', vendor: 'deepseek', prices: { input: 1, output: 4, cacheRead: 0.02, cacheWrite: null }, period: 'offPeak', source: 'vendor' },
        ],
      },
      {
        vendor: 'openai',
        modelCount: 1,
        source: 'dataset',
        currency: 'USD',
        models: [{ id: 'openai/gpt-6-astra', name: 'GPT-6 Astra', vendor: 'openai', prices: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 }, source: 'fetched' }],
      },
    ],
    ...overrides,
  }
}

/** A ledger snapshot in the shape `UsageLedger#snapshot` produces. */
function snapshot(overrides = {}) {
  return {
    version: 5,
    sessions: [
      { sessionId: 's1', cwd: 'D:\\proj', title: '修复账单导出', calls: 2 },
      // A session DSH never named falls back to its id rather than to nothing.
      { sessionId: 's2', cwd: 'D:\\other', title: null, calls: 1 },
    ],
    usage: [
      // DeepSeek, priced in yuan, one call inside the window and one outside it.
      usage('2026-09-10', 's1', 'deepseek-official/deepseek-v4-flash', counters(1_000_000, 100_000, 0), counters(0, 0, 0)),
      usage('2026-09-10', 's2', 'deepseek-official/deepseek-v4-flash', counters(0, 0, 0), counters(1_000_000, 100_000, 0)),
      // OpenAI, priced in dollars, converted for display.
      usage('2026-09-11', 's1', 'openai-official/gpt-6-astra', counters(1_000_000, 0, 0), counters(0, 0, 0)),
    ],
    ...overrides,
  }
}

const SEPTEMBER = new Date(2026, 8, 30, 12, 0, 0)

test('a ledger model joins the price row its name corresponds to', () => {
  // The route and the price list disagree about names, and a wrong price is worse
  // than no price, so the rule is narrow and the refusals matter as much as the hits.
  assert.equal(modelMatch('deepseek-official/deepseek-v4-flash', 'deepseek-flash'), 'name')
  assert.equal(modelMatch('deepseek-official/deepseek-v4-flash', 'DeepSeek-V4.1-Flash'), 'name')
  assert.equal(modelMatch('openai-official/gpt-6-astra', 'gpt-6-astra'), 'exact')
  // Same words, different version: not the same model.
  assert.equal(modelMatch('x/gemini-3.8-flash', 'gemini-3.7-flash'), null)
  assert.equal(modelMatch('x/gemini-3.8-flash', 'gemini-3.8-flash'), 'exact')
  // A suffix is a different model.
  assert.equal(modelMatch('x/deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'), null)
  assert.equal(modelMatch('', 'anything'), null)

  assert.deepEqual(modelTokens('DeepSeek-V4.1-Flash').versions, ['4.1'])
  assert.deepEqual(modelTokens('deepseek-v4-flash').versions, ['4'])
})

test('the price entry chosen names the vendor the route belongs to', () => {
  const entries = priceEntries(catalogue())
  const join = entryFor(entries, 'deepseek-official/deepseek-v4-flash')
  assert.equal(join.entry.vendor, 'deepseek')
  assert.equal(join.confidence, 'name')
  assert.equal(entryFor(entries, 'nobody/unknown-model'), null)
})

test('an ambiguous join is refused rather than guessed', () => {
  // Two vendors publish the same model name. Picking one would put a competitor's
  // price on these tokens; refusing leaves the model visible as unpriced.
  const entries = priceEntries({
    currency: 'USD',
    quote: 'CNY',
    vendors: [
      { vendor: 'alpha', currency: 'USD', models: [{ id: 'alpha/mystery-1', name: 'mystery-1', prices: { input: 1, output: 1 } }] },
      { vendor: 'beta', currency: 'USD', models: [{ id: 'beta/mystery-1', name: 'mystery-1', prices: { input: 9, output: 9 } }] },
    ],
  })
  const refused = entryFor(entries, 'gamma/mystery-1')
  assert.equal(refused.ambiguous, true)
  assert.equal(refused.entry, undefined)
  assert.deepEqual(refused.candidates, ['alpha/mystery-1', 'beta/mystery-1'])

  // A route that names one of them settles it.
  assert.equal(entryFor(entries, 'alpha/mystery-1').entry.vendor, 'alpha')
  assert.equal(entryFor(entries, 'beta/mystery-1').entry.vendor, 'beta')

  // A model only one source publishes needs no tie-break at all.
  const single = priceEntries({ currency: 'CNY', quote: 'CNY', vendors: [{ vendor: 'solo', currency: 'CNY', models: [{ id: 'solo/only-1', name: 'only-1', prices: { input: 1, output: 1 } }] }] })
  assert.equal(entryFor(single, 'somewhere-else/only-1').entry.vendor, 'solo')
})

test('a time-priced model is charged per side of the window', () => {
  const entries = priceEntries(catalogue())
  const deepseek = entryFor(entries, 'deepseek-official/deepseek-v4-flash').entry
  // 1M input + 100k output at peak (2 / 8 per million), and the same off-peak (1 / 4).
  const peak = costOf({ peak: counters(1_000_000, 100_000), offPeak: counters(0, 0) }, deepseek)
  const offPeak = costOf({ peak: counters(0, 0), offPeak: counters(1_000_000, 100_000) }, deepseek)
  assert.equal(peak, 2 + 0.8, '2 per million input and 8 per million output')
  assert.equal(offPeak, 1 + 0.4, 'half of peak outside the window')
  assert.ok(peak > offPeak * 1.9)
})

test('the bill groups, converts and totals', () => {
  const bill = buildBill({ snapshot: snapshot(), catalogue: catalogue(), by: 'vendor', range: 'month', now: SEPTEMBER })

  assert.equal(bill.currency, 'CNY')
  // DeepSeek is published in yuan and is not converted; OpenAI is in dollars and is.
  const deepseek = bill.rows.find((row) => row.label === 'deepseek-official')
  const openai = bill.rows.find((row) => row.label === 'openai-official')
  closeTo(deepseek.cost, 4.2, 'yuan-priced usage')
  closeTo(openai.cost, 70, 'dollars converted at the rate')
  assert.equal(openai.calls, 1)

  assert.equal(bill.totals.calls, 3)
  assert.equal(bill.totals.inputTokens, 3_000_000)
  assert.equal(bill.totals.outputTokens, 200_000)
  closeTo(bill.totals.cost, 74.2, 'total')
  closeTo(bill.totals.totalCost, bill.totals.cost, 'no plans configured')
  // The hit rate is the ledger's definition, on the bill's own rows.
  assert.equal(deepseek.cacheHitRate, 0)
  assert.equal(bill.unpriced.length, 0)
})

test('a model with no price is listed, not charged at zero', () => {
  const withUnknown = snapshot({
    usage: [...snapshot().usage, usage('2026-09-12', 's1', 'nobody/mystery-1', counters(5_000_000, 0), counters(0, 0), 4)],
  })
  const bill = buildBill({ snapshot: withUnknown, catalogue: catalogue(), by: 'vendor', range: 'month', now: SEPTEMBER })

  assert.equal(bill.unpriced.length, 1)
  assert.equal(bill.unpriced[0].model, 'nobody/mystery-1')
  assert.equal(bill.unpriced[0].tokens, 5_000_000)
  assert.match(bill.unpriced[0].reason, /no price/)
  assert.equal(bill.totals.unpricedCost, true)
  // Its tokens are counted — they are real usage — but they add nothing to the cost.
  assert.equal(bill.totals.totalTokens, 3_000_000 + 200_000 + 5_000_000)
  closeTo(bill.totals.cost, 74.2, 'priced usage only')
  const row = bill.rows.find((entry) => entry.label === 'nobody')
  assert.equal(row.unpricedTokens, 5_000_000)
  assert.equal(row.cost, 0)
})

test('a bill groups by workspace, session and model as well', () => {
  const byWorkspace = buildBill({ snapshot: snapshot(), catalogue: catalogue(), by: 'workspace', range: 'month', now: SEPTEMBER })
  assert.deepEqual(byWorkspace.rows.map((row) => row.label).sort(), ['D:\\other', 'D:\\proj'])
  const project = byWorkspace.rows.find((row) => row.label === 'D:\\proj')
  assert.equal(project.sessionCount, 1)
  assert.equal(project.modelCount, 2, 'one DeepSeek call and one OpenAI call')

  // A session row is named the way DSH names it: the workspace it ran in, then the
  // session's own title, with the id kept for the sessions DSH never titled.
  const bySession = buildBill({ snapshot: snapshot(), catalogue: catalogue(), by: 'session', range: 'month', now: SEPTEMBER })
  assert.equal(bySession.rows.length, 2)
  assert.deepEqual(bySession.rows.map((row) => row.label).sort(), ['other/s2', 'proj/修复账单导出'])
  assert.ok(bySession.rows.every((row) => String(row.sublabel).includes('D:\\')), 'the id and the full path are in the tooltip')
  closeTo(bySession.rows.find((row) => row.label === 'other/s2').cost, 1.4)

  // A model row names its vendor as well as the model.
  const byModel = buildBill({ snapshot: snapshot(), catalogue: catalogue(), by: 'model', range: 'month', now: SEPTEMBER })
  assert.deepEqual(byModel.rows.map((row) => row.label).sort(), ['deepseek-official/deepseek-v4-flash', 'openai-official/gpt-6-astra'], 'the route the ledger recorded, provider and model')
  closeTo(byModel.rows.find((row) => row.label === 'deepseek-official/deepseek-v4-flash').cost, 4.2)
  // The price row it was billed at travels with the row rather than replacing its name.
  assert.equal(byModel.rows.find((row) => row.label === 'deepseek-official/deepseek-v4-flash').priceVendor, 'deepseek')
  assert.deepEqual(byModel.rows.find((row) => row.label === 'deepseek-official/deepseek-v4-flash').priceNames, ['DeepSeek-V4.1-Flash'])
})

test('only the requested period is billed', () => {
  const bill = buildBill({ snapshot: snapshot(), catalogue: catalogue(), by: 'vendor', range: 'week', now: new Date(2026, 8, 12, 12, 0, 0) })
  // The trailing seven days from the 12th cover the 10th and the 11th, so everything
  // is in; a range that ends earlier must not be.
  assert.equal(bill.totals.calls, 3)
  const earlier = buildBill({ snapshot: snapshot(), catalogue: catalogue(), by: 'vendor', range: 'week', now: new Date(2026, 8, 5, 12, 0, 0) })
  assert.equal(earlier.totals.calls, 0)

  const all = buildBill({ snapshot: snapshot(), catalogue: catalogue(), by: 'vendor', range: 'all', now: SEPTEMBER })
  assert.equal(bill.totals.calls, all.totals.calls)
  assert.equal(boundsFrom(all), '')
})

/** The `from` bound of a bill, as a convenience for assertions. */
function boundsFrom(bill) {
  return bill.range.from
}

test('a monthly plan is spread over the days the bill covers', () => {
  const full = subscriptionShare({ amount: 199 }, { from: '2026-09-01', to: '2026-09-30' })
  assert.equal(Math.round(full.share * 100) / 100, 199)
  assert.deepEqual(full.months, ['2026-09'])

  const half = subscriptionShare({ amount: 199 }, { from: '2026-09-16', to: '2026-09-30' })
  assert.equal(Math.round(half.share * 100) / 100, Math.round(((199 * 15) / 30) * 100) / 100)

  // A plan that has not started is not billed.
  assert.equal(subscriptionShare({ amount: 199, startedAt: '2026-10-01' }, { from: '2026-09-01', to: '2026-09-30' }).share, 0)
  // A plan that ended is billed only for the days it covered.
  const ended = subscriptionShare({ amount: 30, startedAt: '2026-01-01', endedAt: '2026-09-10' }, { from: '2026-09-01', to: '2026-09-30' })
  assert.equal(Math.round(ended.share * 100) / 100, Math.round(((30 * 10) / 30) * 100) / 100)
})

test('the plan view shows the plans and what is left on usage', () => {
  const bill = buildBill({
    snapshot: snapshot(),
    catalogue: catalogue(),
    subscriptions: [{ vendor: 'openai', plan: 'GPT plan', amount: 140, currency: 'CNY', startedAt: '2026-09-01' }],
    by: 'subscription',
    range: 'month',
    now: SEPTEMBER,
  })
  assert.equal(bill.subscriptions.length, 1)
  assert.equal(bill.subscriptions[0].plan, 'GPT plan')
  assert.equal(Math.round(bill.subscriptions[0].share * 100) / 100, 140)
  assert.equal(bill.subscriptions[0].totalTokens, 1_000_000, 'the plan shows the usage it covers')

  const planRow = bill.rows.find((row) => row.plan === true)
  const usageRow = bill.rows.find((row) => row.plan === false)
  assert.equal(planRow.label, 'GPT plan')
  assert.equal(planRow.cost, 140, 'the plan is what it costs')
  closeTo(planRow.usageCost, 70, 'and the usage it covers is shown beside it')
  assert.equal(usageRow.label, null, 'the pay-as-you-go line has no name of its own; the page names it')
  closeTo(usageRow.cost, 4.2, 'everything not on a plan')
  assert.equal(bill.totals.subscriptionCost, 140)
  closeTo(bill.totals.totalCost, 144.2)
})

test('without a rate the bill stays in dollars rather than mixing units', () => {
  const bill = buildBill({
    snapshot: snapshot(),
    catalogue: catalogue({ fx: { available: false, rate: null, base: 'USD', quote: 'CNY', overridden: false } }),
    by: 'vendor',
    range: 'month',
    now: SEPTEMBER,
  })
  assert.equal(bill.currency, 'USD')
  assert.equal(bill.fxRate, null)
  // The yuan-priced vendor cannot be stated in dollars, so it is listed as unpriced
  // rather than being added to a total it does not belong in.
  assert.equal(bill.unpriced.some((row) => row.vendor === 'deepseek'), true)
  assert.match(bill.unpriced.find((row) => row.vendor === 'deepseek').reason, /cannot convert/)
  closeTo(bill.totals.cost, 10, 'only the dollar-priced usage is counted')
})

test('the CSV carries the bill, with the currency on every row and a total per section', () => {
  const bill = buildBill({ snapshot: snapshot(), catalogue: catalogue(), by: 'vendor', range: 'month', now: SEPTEMBER })
  const csv = billToCsv(bill)
  const lines = csv.trim().split('\r\n')
  assert.equal(lines[0], 'dimension,range,group,calls,cacheReadInput,uncachedInput,output,cacheWriteInput,cacheHitRate,cost,currency,billing,usagePricedCost')
  assert.equal(lines.length, bill.rows.length + 2, 'a header, every row, and a total')
  for (const line of lines.slice(1)) assert.ok(line.includes(',CNY'), `no currency on: ${line}`)
  assert.ok(lines.at(-1).startsWith('vendor,month,TOTAL,'))

  // Rows are ordered by cost, so the dollar-priced vendor comes first.
  const deepseek = lines.find((line) => line.includes(',deepseek-official,'))
  assert.equal(deepseek.split(',')[11], 'usage')
  // The two input columns are the halves a bill is read by: cache reads first, then
  // the input that missed the cache — one million tokens on each side of the window.
  assert.equal(deepseek.split(',')[4], '0', 'no cache-read input in this fixture')
  assert.equal(deepseek.split(',')[5], '2000000', 'uncached input')
  // For a pay-as-you-go row the usage-priced cost is the cost.
  assert.equal(deepseek.split(',')[9], deepseek.split(',')[12])
})

test('every section totals separately, because ranges overlap', () => {
  // Summing today, this week, this month and everything would count the same tokens
  // several times over, so the export totals each section and stops there.
  const payload = buildBillSections({
    snapshot: snapshot(),
    catalogue: catalogue(),
    dims: ['vendor', 'workspace'],
    ranges: ['today', 'month', 'all'],
    now: SEPTEMBER,
  })
  assert.deepEqual(payload.dimensions, ['vendor', 'workspace'])
  assert.deepEqual(payload.ranges, ['today', 'month', 'all'])
  assert.equal(payload.sections.length, 6, 'two groupings over three ranges')
  const csv = billToCsv(payload)
  const lines = csv.trim().split('\r\n').filter((line) => line.includes(',TOTAL,'))
  assert.equal(lines.length, 6, 'one total per section')
  assert.deepEqual(
    lines.map((line) => line.split(',').slice(0, 2).join('/')),
    ['vendor/today', 'vendor/month', 'vendor/all', 'workspace/today', 'workspace/month', 'workspace/all'],
  )

  // The notes are shared: the same unpriced model in five ranges is one note.
  const withUnknown = snapshot({ usage: [...snapshot().usage, usage('2026-09-12', 's1', 'nobody/mystery-1', counters(5_000_000, 0, 0), counters(0, 0, 0), 4)] })
  const notes = buildBillSections({ snapshot: withUnknown, catalogue: catalogue(), dims: ['vendor'], ranges: ['today', 'week', 'month', 'year', 'all'], now: SEPTEMBER })
  assert.equal(notes.unpriced.length, 1)
  assert.equal(notes.sections.length, 5)
  assert.equal(notes.unpriced[0].tokens, 5_000_000, 'the widest range carries the count that is kept')
})

test('a plan replaces the usage it covers, on every row that spans it', () => {
  // One workspace uses both a plan vendor and a pay-as-you-go vendor. Billing the row
  // as plan + usage would charge for the same calls twice, so the plan stands in for
  // the covered vendor's tokens and the other vendor's usage is added to it.
  const plans = [{ vendor: 'openai', plan: 'GPT plan', amount: 140, currency: 'CNY', startedAt: '2026-09-01' }]
  const byWorkspace = buildBill({ snapshot: snapshot(), catalogue: catalogue(), subscriptions: plans, by: 'workspace', range: 'month', now: SEPTEMBER })
  const project = byWorkspace.rows.find((row) => row.label === 'D:\\proj')
  // The workspace holds the peak DeepSeek call (2.8) and the OpenAI call (70):
  // 140 for the plan plus the 2.8 the plan does not cover.
  closeTo(project.cost, 142.8, 'the plan plus the vendor that is not on one')
  closeTo(project.usageCost, 72.8, 'and the tokens it covers are still shown')
  assert.equal(project.covered, true)
  const other = byWorkspace.rows.find((row) => row.label === 'D:\\other')
  closeTo(other.cost, 1.4, 'a workspace with no plan vendor is billed its usage')
  assert.equal(other.covered, false)

  const byVendor = buildBill({ snapshot: snapshot(), catalogue: catalogue(), subscriptions: plans, by: 'vendor', range: 'month', now: SEPTEMBER })
  closeTo(byVendor.rows.find((row) => row.label === 'openai-official').cost, 140, 'a plan vendor is billed its plan')
  closeTo(byVendor.rows.find((row) => row.label === 'deepseek-official').cost, 4.2, 'and the rest is billed its usage')
  closeTo(byVendor.totals.cost, 144.2)
  closeTo(byVendor.totals.usageCost, 74.2, 'what the month would have cost without the plan')

  // A plan for a vendor with no usage in range is still money spent.
  const idle = buildBill({ snapshot: snapshot(), catalogue: catalogue(), subscriptions: [{ vendor: 'anthropic', plan: 'Claude Max', amount: 100, currency: 'CNY' }], by: 'vendor', range: 'month', now: SEPTEMBER })
  closeTo(idle.totals.cost, 74.2)
  closeTo(idle.totals.totalCost, 174.2)
})

test('a plan is allocated across rows, so the rows add up to the total', () => {
  // One plan covers OpenAI, whose usage appears in both workspaces. Charging the
  // whole plan to each row would make the rows sum to more than the bill; the plan
  // is therefore spread in proportion to the usage it covers.
  const plans = [{ vendor: 'openai', plan: 'GPT plan', amount: 140, currency: 'CNY', startedAt: '2026-09-01' }]
  const twoSessions = snapshot({
    sessions: [
      { sessionId: 's1', cwd: 'D:\\proj', title: '甲', calls: 2 },
      { sessionId: 's3', cwd: 'D:\\proj', title: '乙', calls: 1 },
    ],
    usage: [
      // Two OpenAI calls in s1 and one in s3: a third of the plan belongs to s3.
      usage('2026-09-11', 's1', 'openai-official/gpt-6-astra', counters(1_000_000, 0, 0), counters(0, 0, 0)),
      usage('2026-09-11', 's3', 'openai-official/gpt-6-astra', counters(500_000, 0, 0), counters(0, 0, 0)),
    ],
  })
  const bySession = buildBill({ snapshot: twoSessions, catalogue: catalogue(), subscriptions: plans, by: 'session', range: 'month', now: SEPTEMBER })
  const first = bySession.rows.find((row) => row.label === 'proj/甲')
  const second = bySession.rows.find((row) => row.label === 'proj/乙')
  closeTo(second.cost, 140 / 3, 'the smaller session carries a third of the plan')
  closeTo(second.planCost, 140 / 3)
  closeTo(first.cost, (140 * 2) / 3)
  closeTo(bySession.rows.reduce((sum, row) => sum + row.cost, 0), bySession.totals.totalCost, 'the rows sum to the total')
  closeTo(bySession.totals.totalCost, 140)

  // The vendor grouping has one row per vendor, so it carries the whole plan.
  const byVendor = buildBill({ snapshot: twoSessions, catalogue: catalogue(), subscriptions: plans, by: 'vendor', range: 'month', now: SEPTEMBER })
  closeTo(byVendor.rows.find((row) => row.label === 'openai-official').cost, 140)
})

test('every grouping totals to the same bill, row by row', () => {
  // The four sections are four readings of one bill: whatever they group by, the
  // rows must add up to the same total.
  const payload = buildBillSections({
    snapshot: snapshot(),
    catalogue: catalogue(),
    subscriptions: [{ vendor: 'openai', plan: 'GPT plan', amount: 140, currency: 'CNY', startedAt: '2026-09-01' }],
    dims: ['workspace', 'session', 'model', 'vendor'],
    ranges: ['month'],
    now: SEPTEMBER,
  })
  const totals = payload.sections.map((section) => section.totals.totalCost)
  for (const total of totals) closeTo(total, 144.2, 'one bill, four readings')
  for (const section of payload.sections) {
    closeTo(section.rows.reduce((sum, row) => sum + row.cost, 0), section.totals.totalCost, `${section.by} rows sum to its total`)
  }
})

test('a vendor row is the provider the request named, under the name the model settings show', () => {
  // Two endpoints serving the same DeepSeek model: a bill that merged them by price
  // vendor could not answer "what is BOS-API costing me", which is the question a
  // provider row exists for.
  const twoProviders = snapshot({
    sessions: [{ sessionId: 's1', cwd: 'D:\\proj', title: '甲', calls: 2 }],
    usage: [
      usage('2026-09-11', 's1', 'deepseek-official/deepseek-v4-flash', counters(1_000_000, 0, 0), counters(0, 0, 0)),
      usage('2026-09-11', 's1', 'bos/deepseek-v4-flash', counters(500_000, 0, 0), counters(0, 0, 0)),
    ],
  })
  const plain = buildBill({ snapshot: twoProviders, catalogue: catalogue(), by: 'vendor', range: 'month', now: SEPTEMBER })
  assert.deepEqual(plain.rows.map((row) => row.label).sort(), ['bos', 'deepseek-official'], 'the provider id when no display name is known')
  // Both are priced from DeepSeek's list, which is what the tooltip says.
  assert.ok(plain.rows.every((row) => row.priceVendor === 'deepseek'))
  assert.equal(plain.rows.find((row) => row.label === 'bos').provider, 'bos')

  const named = buildBill({ snapshot: twoProviders, catalogue: catalogue(), providerNames: { bos: 'BOS-API' }, by: 'vendor', range: 'month', now: SEPTEMBER })
  assert.deepEqual(named.rows.map((row) => row.label).sort(), ['BOS-API', 'deepseek-official'])
  // The pricing is unchanged by the label: same total, same split.
  closeTo(named.totals.totalCost, plain.totals.totalCost)

  // The model dimension keeps the two apart as well.
  const byModel = buildBill({ snapshot: twoProviders, catalogue: catalogue(), providerNames: { bos: 'BOS-API' }, by: 'model', range: 'month', now: SEPTEMBER })
  assert.deepEqual(byModel.rows.map((row) => row.label).sort(), ['bos/deepseek-v4-flash', 'deepseek-official/deepseek-v4-flash'])
  assert.equal(byModel.rows.length, 2, 'two routes are two rows, not one merged model')
})

test('a plan may name the provider whose endpoint it pays for', () => {
  // `bos` is an endpoint, `deepseek` is whose list price its tokens carry; a config
  // file may reasonably write either, and both must reach the same usage.
  const viaProvider = buildBill({
    snapshot: snapshot(),
    catalogue: catalogue(),
    subscriptions: [{ vendor: 'openai-official', plan: 'GPT plan', amount: 140, currency: 'CNY', startedAt: '2026-09-01' }],
    by: 'vendor',
    range: 'month',
    now: SEPTEMBER,
  })
  const viaPriceVendor = buildBill({
    snapshot: snapshot(),
    catalogue: catalogue(),
    subscriptions: [{ vendor: 'openai', plan: 'GPT plan', amount: 140, currency: 'CNY', startedAt: '2026-09-01' }],
    by: 'vendor',
    range: 'month',
    now: SEPTEMBER,
  })
  closeTo(viaProvider.totals.totalCost, 144.2)
  closeTo(viaProvider.totals.totalCost, viaPriceVendor.totals.totalCost)
  // The plan records both what it was written as and what it was charged against.
  assert.equal(viaProvider.subscriptions[0].namedVendor, 'openai-official')
  assert.equal(viaProvider.subscriptions[0].vendor, 'openai')
})

test('the dimensions and ranges on offer are the documented ones', () => {
  assert.deepEqual(BILL_DIMENSIONS, ['workspace', 'session', 'model', 'vendor', 'subscription'])
  assert.deepEqual(BILL_SECTIONS, ['workspace', 'session', 'model', 'vendor'], 'the page stacks four, in this order')
  assert.deepEqual(BILL_RANGES, ['month', 'year', 'week', 'today', 'all'])
  // An unknown value falls back rather than throwing: a stale link should still bill.
  const bill = buildBill({ snapshot: snapshot(), catalogue: catalogue(), by: 'nonsense', range: 'nonsense', now: SEPTEMBER })
  assert.equal(bill.by, 'workspace', 'the first section is the default grouping')
  assert.equal(bill.range.kind, 'month')
  const month = rangeBounds('month', SEPTEMBER)
  assert.equal(month.from, '2026-09-01')
  assert.equal(month.to, '2026-09-30')
  assert.equal(month.covers('2026-09-15'), true)
  assert.equal(month.covers('2026-08-31'), false)
  assert.equal(rangeBounds('all', SEPTEMBER).covers('1999-01-01'), true, 'everything means everything')

  // `today` is one day, and only that day.
  const today = rangeBounds('today', SEPTEMBER)
  assert.equal(today.from, '2026-09-30')
  assert.equal(today.to, '2026-09-30')
  assert.equal(today.covers('2026-09-30'), true)
  assert.equal(today.covers('2026-09-29'), false)

  // Only today's usage is billed by the day range.
  const daily = buildBill({ snapshot: snapshot(), catalogue: catalogue(), by: 'vendor', range: 'today', now: new Date(2026, 8, 10, 12, 0, 0) })
  assert.equal(daily.totals.calls, 2, 'the two calls recorded on the 10th')
  closeTo(daily.totals.totalCost, 4.2)
  const empty = buildBill({ snapshot: snapshot(), catalogue: catalogue(), by: 'vendor', range: 'today', now: SEPTEMBER })
  assert.equal(empty.totals.calls, 0)
})

test('a session row is named by its workspace, and a model row by its vendor', () => {
  assert.equal(workspaceName('E:\\bosc_project\\torchv-master'), 'torchv-master')
  assert.equal(workspaceName('E:\\bosc_project\\torchv-master\\'), 'torchv-master')
  assert.equal(workspaceName('/home/me/proj'), 'proj')
  assert.equal(workspaceName(''), null)
  assert.equal(workspaceName(undefined), null)
  assert.equal(shortSessionId('session-54da1581-cfde-4529-b92b-bc94a58254f2'), 'session-54da1')
  assert.equal(shortSessionId('abc'), 'abc')
})

test('an empty ledger bills nothing rather than failing', () => {
  const bill = buildBill({ snapshot: { version: 4, usage: [], sessions: [] }, catalogue: catalogue(), by: 'vendor', range: 'month', now: SEPTEMBER })
  assert.deepEqual(bill.rows, [])
  assert.equal(bill.totals.totalCost, 0)
  assert.equal(bill.totals.cacheHitRate, null)
  assert.equal(billToCsv(bill).trim().split('\r\n').length, 2, 'a header and a zero total')
})

test('a malformed snapshot or catalogue degrades to an empty bill', () => {
  for (const input of [
    {},
    { snapshot: null, catalogue: null },
    { snapshot: { usage: 'nope' }, catalogue: { vendors: 'nope' } },
    { snapshot: { usage: [null, 5, {}] }, catalogue: { vendors: [null, { models: null }] } },
  ]) {
    const bill = buildBill({ ...input, now: SEPTEMBER })
    assert.ok(Array.isArray(bill.rows), JSON.stringify(input))
    assert.equal(bill.totals.totalCost, 0)
  }
})

test('a malformed plan in the config is skipped, not fatal', () => {
  // The config is typed by hand, so a stray entry has to cost nothing but itself.
  const bill = buildBill({
    snapshot: snapshot(),
    catalogue: catalogue(),
    subscriptions: [null, 5, 'deepseek', {}, { vendor: 'openai', amount: '199' }, { vendor: 'openai', plan: 'GPT plan', amount: 140, currency: 'CNY', startedAt: '2026-09-01' }],
    by: 'subscription',
    range: 'month',
    now: SEPTEMBER,
  })
  assert.equal(bill.subscriptions.length, 3, 'an entry that is not an object is skipped entirely')
  assert.equal(bill.subscriptions.filter((plan) => plan.share > 0).length, 1)
  closeTo(bill.totals.totalCost, 144.2, 'the one real plan still bills')
  assert.equal(bill.rows.filter((row) => row.plan === true).length, 3)
  assert.equal(bill.subscriptions.filter((plan) => plan.share === 0).length, 2, 'an empty plan and a non-numeric amount bill nothing')
})

test('a plan that has not started does not zero out the usage it never covered', () => {
  // An amortized share of zero is not the same claim as "this vendor is free".
  const bill = buildBill({
    snapshot: snapshot(),
    catalogue: catalogue(),
    subscriptions: [{ vendor: 'openai', plan: 'Starts in October', amount: 140, currency: 'CNY', startedAt: '2026-10-01' }],
    by: 'vendor',
    range: 'month',
    now: SEPTEMBER,
  })
  closeTo(bill.rows.find((row) => row.label === 'openai-official').cost, 70, 'the usage is still billed as usage')
  closeTo(bill.totals.totalCost, 74.2)
  assert.equal(bill.totals.subscriptionCost, 0)
})

void none
