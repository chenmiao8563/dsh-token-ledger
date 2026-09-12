/**
 * Render the overview with a real React.
 *
 * The stand-in React in `client.test.mjs` proves the wrapper and the data flow
 * but cannot prove that this component is really React-compatible: it does not
 * enforce hook order, does not validate DOM props, and does not warn. This file
 * renders the presentation component with the real library and asserts the
 * actual markup.
 *
 * React is not a dependency of this package, so the test resolves it from
 * `DSH_TOKEN_LEDGER_REACT_DIR` (a directory whose `node_modules` holds react and
 * react-dom) or from an installed devDependency, and **skips with a stated
 * reason** when neither is present. That keeps `npm test` dependency-free — the
 * property that makes the package installable without a build — while still
 * making the strongest available check run wherever React can be found.
 *
 * @module dsh-token-ledger/test/client-render.test
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

/** Resolve React the way the test header describes, or explain why it cannot. */
function loadReact() {
  const local = createRequire(import.meta.url)
  const explicit = process.env.DSH_TOKEN_LEDGER_REACT_DIR
  const resolve = (name) =>
    explicit === undefined
      ? local(name)
      : createRequire(join(explicit, 'noop.cjs'))(name)
  try {
    return { react: resolve('react'), server: resolve('react-dom/server') }
  } catch (error) {
    return { reason: `react and react-dom are not resolvable (${error.code ?? error.message}); set DSH_TOKEN_LEDGER_REACT_DIR to a directory whose node_modules contains both` }
  }
}

const loaded = loadReact()
const skip = loaded.reason

/**
 * Load the browser half, giving its factory the real React.
 *
 * @returns {object} the module's exports.
 */
function loadClient() {
  let registration
  globalThis.window = { __ModuleLoader__: { load: (definition) => (registration = definition) } }
  const source = readFileSync(fileURLToPath(new URL('../lib/client.js', import.meta.url)), 'utf8')
  new Function('require', source)((name) => {
    if (name === 'react') return loaded.react
    throw new Error(`unexpected require("${name}")`)
  })
  return registration.factory((name) => (name === 'react' ? loaded.react : undefined))
}

/**
 * Render any exported view and report anything React complained about.
 *
 * React reports invalid DOM props, bad hook usage and key problems through
 * `console.error`, so capturing it turns "it rendered" into "it rendered without
 * the library objecting", which the stand-in React cannot detect.
 *
 * @param {Function} component - the exported view.
 * @param {object} props - the view props.
 * @returns {{ html: string, complaints: string[] }} the markup and React's output.
 */
function renderComponent(component, props) {
  const complaints = []
  const realError = console.error
  const realWarn = console.warn
  console.error = (...args) => complaints.push(args.map(String).join(' '))
  console.warn = (...args) => complaints.push(args.map(String).join(' '))
  try {
    const html = loaded.server.renderToStaticMarkup(loaded.react.createElement(component, { t: (key) => key, ...props }))
    return { html, complaints }
  } finally {
    console.error = realError
    console.warn = realWarn
  }
}

/**
 * Render the overview view.
 *
 * @param {object} exports - the loaded client module.
 * @param {object} props - the view props.
 * @returns {{ html: string, complaints: string[] }} the markup and React's output.
 */
function renderView(exports, props) {
  return renderComponent(exports.OverviewView, {
    range: 'month',
    view: 'year',
    onRange: () => {},
    onView: () => {},
    ...props,
  })
}

/**
 * Count occurrences of an exact class attribute in rendered markup.
 *
 * @param {string} html - the markup.
 * @param {string} className - the class name.
 * @returns {number} the count.
 */
function countClass(html, className) {
  return (html.match(new RegExp(`class="${className}"`, 'g')) ?? []).length
}

/**
 * Count occurrences of a class fragment anywhere in a class attribute.
 *
 * `countClass` matches the attribute exactly, which is what a count of real
 * calendar cells needs; this one is for namespaced families such as `tl-week-*`.
 *
 * @param {string} html - the markup.
 * @param {string} fragment - the class fragment.
 * @returns {number} the count.
 */
function countByClass(html, fragment) {
  return (html.match(new RegExp(`class="[^"]*${fragment}[^"]*"`, 'g')) ?? []).length
}

/** A ready payload with ten days of data. */
function payload() {
  const series = []
  for (let day = 1; day <= 10; day += 1) {
    series.push({
      date: `2026-03-${String(day).padStart(2, '0')}`,
      calls: day,
      inputTokens: day * 10,
      outputTokens: day,
      cacheReadTokens: day * 90,
      cacheWriteTokens: 0,
      totalTokens: day * 100,
      reasoningTokens: 0,
    })
  }
  const totals = { inputTokens: 550, outputTokens: 55, cacheReadTokens: 4950, cacheWriteTokens: 0, totalTokens: 5500, reasoningTokens: 7 }
  return {
    plugin: 'token-ledger',
    generatedAt: new Date(2026, 2, 10, 12, 0, 0).getTime(),
    ledgerUpdatedAt: Date.now(),
    totals: { ...totals, calls: 55, cacheHitRate: 0.9 },
    ranges: {
      month: { kind: 'month', totals, calls: 55, activeDays: 10, cacheHitRate: 0.9 },
      year: { kind: 'year', totals, calls: 55, activeDays: 10, cacheHitRate: 0.9 },
      week: { kind: 'week', totals: { ...totals, inputTokens: 490, totalTokens: 4900 }, calls: 49, activeDays: 7, cacheHitRate: 0.9 },
    },
    today: { date: '2026-03-10', totals: { ...totals, totalTokens: 1000 }, calls: 10, activeDays: 1, cacheHitRate: 0.9 },
    series,
    models: [{ model: 'deepseek-official/deepseek-v4-flash', calls: 55, totalTokens: 5500, cacheReadTokens: 4950, inputTokens: 495, outputTokens: 55, cacheWriteTokens: 0, reasoningTokens: 7, cacheHitRate: 0.9 }],
    sessionCount: 3,
  }
}

const ready = { status: 'ready', data: payload(), error: null }

test('the overview renders under real React without the library objecting', { skip }, () => {
  const exports = loadClient()
  assert.equal(typeof exports.OverviewView, 'function', 'the view must be exported for this test')

  const { html, complaints } = renderView(exports, { state: ready })
  assert.deepEqual(complaints, [], 'React reported a problem with the rendered tree')
  assert.ok(html.startsWith('<div class="tl-root"'), html.slice(0, 80))
})

test('the range metrics render with the selected range applied', { skip }, () => {
  const exports = loadClient()

  const month = renderView(exports, { state: ready, range: 'month' })
  assert.ok(month.html.includes('5,500'), 'the full month total')
  assert.ok(month.html.includes('90.0%'), 'the cache hit rate')
  assert.ok(month.html.includes('>55<'), 'the call count')

  const week = renderView(exports, { state: ready, range: 'week' })
  assert.ok(week.html.includes('4,900'), 'the week range reads its own summary')
  const year = renderView(exports, { state: ready, range: 'year' })
  assert.ok(year.html.includes('5,500'))

  // The four periods are offered as tabs, with the active one marked.
  for (const key of ['rangeMonth', 'rangeYear', 'rangeWeek', 'rangeAll']) assert.ok(month.html.includes(key), key)
  assert.equal(countClass(month.html, 'tl-tab'), 7, 'four range tabs and three calendar tabs')
  assert.ok(month.html.includes('data-active="true"'), 'the active tab is marked')
})

test('today renders separately from the selected range', { skip }, () => {
  const exports = loadClient()
  const { html } = renderView(exports, { state: ready, range: 'year' })
  assert.ok(html.includes('2026-03-10'), 'the local date')
  assert.ok(html.includes('todayHint'))
  assert.ok(html.includes('today'), 'the today heading survives a year-range selection')
})

test('the year view is a weekday-aligned heatmap with a month axis', { skip }, () => {
  const exports = loadClient()
  const { html, complaints } = renderView(exports, { state: ready, view: 'year' })
  assert.deepEqual(complaints, [])

  assert.equal(countClass(html, 'tl-grid'), 1)
  // One cell per calendar day in the year, and one legend chip per ramp step.
  assert.equal(countClass(html, 'tl-cell'), 365)
  assert.equal(countByClass(html, 'tl-chip'), 7)
  // 2026-01-01 is a Thursday, so the first column is padded by three blanks;
  // without them every row would be a weekday that lies and the axis would
  // point at the wrong columns.
  assert.equal(countByClass(html, 'tl-blank'), 3)
  // One axis label per month of the year, and the text comes from the
  // dictionary rather than from the date string.
  assert.equal(countByClass(html, 'tl-axis-label'), 12)
  assert.ok(html.includes('>m3<'), 'March is labelled through the dictionary')
})

test('the month view is a calendar heatmap and the week view is a row-per-day bar chart', { skip }, () => {
  const exports = loadClient()

  const month = renderView(exports, { state: ready, view: 'month' })
  // March 2026: 31 day cells, one header cell per weekday, and six blanks before
  // the 1st lands on its Sunday column.
  assert.equal(countClass(month.html, 'tl-month-cell'), 31, 'one cell per day of the current month')
  assert.equal(countClass(month.html, 'tl-month-weekday'), 7, 'a column per weekday')
  assert.equal(countClass(month.html, 'tl-month-blank'), 6, 'the first week is padded to the real weekday')
  assert.equal(countByClass(month.html, 'tl-week-row'), 0, 'no week bars in the month view')
  assert.equal(countByClass(month.html, 'tl-grid'), 0, 'no year grid in the month view')
  // The heat legend is shared with the year grid.
  assert.equal(countByClass(month.html, 'tl-chip'), 7)

  const week = renderView(exports, { state: ready, view: 'week' })
  assert.equal(countByClass(week.html, 'tl-week-row'), 7, 'one row per day')
  assert.equal(countByClass(week.html, 'tl-week-fill'), 7, 'every day draws a proportional bar')
  assert.equal(countByClass(week.html, 'tl-week-row-today'), 1, 'today is marked')
  assert.ok(week.html.includes('weekChart'))
  // Bars carry inline widths, so the chart is actually proportional.
  assert.ok(/class="tl-week-fill" style="width:\d+%/.test(week.html), 'bars are sized')
})

test('heat levels are bounded and relative to the busiest day', { skip }, () => {
  const exports = loadClient()
  const { html } = renderView(exports, { state: ready, view: 'year' })
  const backgrounds = [...html.matchAll(/class="tl-cell" style="background:([^"]+)"/g)].map((match) => match[1])
  assert.equal(backgrounds.length, 365, 'one background per day cell in the year')
  // The legend chips are the palette; the year cells must draw from it too.
  const palette = new Set(backgrounds)
  assert.ok(palette.size <= 7, `expected at most seven levels, saw ${palette.size}`)
  assert.ok(backgrounds.every((value) => /^rgba\(/.test(value)), 'levels are explicit colours')
  // The ramp must span a real range, or the busiest days stop standing out from
  // the quiet ones. The check is on the spread rather than on any single colour,
  // so the palette can be re-tuned without the test pinning a depth or a hue.
  const sums = backgrounds.map((value) =>
    value
      .match(/[\d.]+/g)
      .slice(0, 3)
      .map(Number)
      .reduce((total, channel) => total + channel, 0),
  )
  assert.ok(Math.max(...sums) - Math.min(...sums) > 200, 'the ramp spans a real range')
})

test('loading, error, stale and empty states all render', { skip }, () => {
  const exports = loadClient()

  const loading = renderView(exports, { state: { status: 'loading', data: null, error: null } })
  assert.ok(loading.html.includes('loading'))
  assert.equal(countClass(loading.html, 'tl-metrics'), 0)

  const failed = renderView(exports, { state: { status: 'error', data: null, error: 'HTTP 404' } })
  assert.ok(failed.html.includes('unavailable'))
  assert.ok(failed.html.includes('unavailableReason'))
  assert.ok(failed.html.includes('HTTP 404'))

  const stale = renderView(exports, { state: { status: 'stale', data: payload(), error: 'network' } })
  assert.ok(stale.html.includes('stale'))
  assert.ok(stale.html.includes('5,500'), 'stale keeps the previous numbers on screen')

  const empty = renderView(exports, {
    state: {
      status: 'ready',
      error: null,
      data: {
        plugin: 'token-ledger',
        totals: {},
        ranges: {},
        today: { date: '2026-03-10', totals: {}, calls: 0, cacheHitRate: null },
        series: [],
        models: [],
      },
    },
  })
  assert.ok(empty.html.includes('todayEmpty'))
  assert.ok(empty.html.includes('noData'))
  assert.ok(empty.html.includes('—'), 'undefined numbers render as a dash')
  assert.deepEqual(empty.complaints, [])
})

test('the model rows show where the tokens went, with a key', { skip }, () => {
  const exports = loadClient()
  const { html, complaints } = renderView(exports, { state: ready })
  assert.deepEqual(complaints, [])

  assert.ok(html.includes('deepseek-official/deepseek-v4-flash'))
  assert.equal(countByClass(html, 'tl-meter'), 1, 'one composition bar per model')
  // The fixture model has cache reads, uncached input and output, and no cache
  // writes at all — so the cache-write bucket is drawn nowhere *and* named nowhere.
  // A colour in the key that appears in no bar is a puzzle, not a fact.
  assert.equal(countByClass(html, 'tl-seg'), 3)
  assert.ok(html.includes('background:#7fb2ff'), 'cache reads have their own colour')
  assert.ok(html.includes('background:#2f6fd0'), 'uncached input has its own colour')
  assert.ok(html.includes('background:#2fa86a'), 'output has its own colour')
  assert.equal(countClass(html, 'tl-key'), 3, 'one key per bucket that is actually drawn')
  assert.equal(countClass(html, 'tl-swatch'), 3)
  // The keys are translated, not printed as raw bucket names.
  for (const key of ['cacheReadTokens', 'inputTokens', 'outputTokens']) {
    assert.ok(html.includes(key), `${key} is named in the key`)
  }
  assert.ok(!html.includes('cacheWriteTokens'), 'a bucket with no tokens anywhere is left out entirely')
})

test('a cache-write bucket with tokens in it is drawn and named', { skip }, () => {
  const exports = loadClient()
  const payload = ready.data
  const withWrite = {
    ...ready,
    data: {
      ...payload,
      totals: { ...payload.totals, cacheWriteTokens: 1_000 },
      models: payload.models.map((model) => ({ ...model, cacheWriteTokens: 1_000 })),
    },
  }
  const { html, complaints } = renderView(exports, { state: withWrite })
  assert.deepEqual(complaints, [])
  assert.equal(countByClass(html, 'tl-seg'), 4, 'four buckets when the fourth has tokens')
  assert.equal(countClass(html, 'tl-key'), 4)
  assert.ok(html.includes('cacheWriteTokens'), 'and it is named in the key')
  assert.ok(html.includes('background:#9a6bd6'), 'with its own colour')
})

test('a model with no usage renders an empty meter rather than a broken stack', { skip }, () => {
  const exports = loadClient()
  const empty = { ...ready, data: { ...ready.data, models: [{ model: 'unused/model', calls: 0, totalTokens: 0 }] } }
  const { html, complaints } = renderView(exports, { state: empty })
  assert.deepEqual(complaints, [])
  assert.equal(countByClass(html, 'tl-meter'), 1)
  assert.equal(countByClass(html, 'tl-seg'), 0, 'no segments to draw')
})

/* ------------------------------------------------------------------- rates -- */

/** A ready rates payload: one fetched vendor, one entered by hand, one offline-only. */
function ratesPayload(overrides = {}) {
  const fetchedAt = new Date(2026, 2, 10, 12, 0, 0).getTime()
  return {
    plugin: 'token-ledger',
    generatedAt: fetchedAt,
    refreshIntervalMs: 1_800_000,
    perVendor: 3,
    currency: 'USD',
    quote: 'CNY',
    catalogue: {
      available: true,
      fetchedAt,
      ageMs: 95 * 60 * 1000,
      source: 'https://openrouter.ai/api/v1/models',
      totalAvailable: 445,
      modelCount: 6,
      vendorCount: 2,
    },
    fx: { available: true, rate: 7.1234, base: 'USD', quote: 'CNY', source: 'https://open.er-api.com/v6/latest/USD', fetchedAt, ageMs: 95 * 60 * 1000, overridden: false },
    overriddenModels: 1,
    lastRefresh: { at: fetchedAt, ageMs: 60_000, catalogue: 'ok (6 models, 2 vendors)', fx: 'ok (1 USD = 7.1234 CNY)' },
    vendors: [
      {
        vendor: 'acme',
        modelCount: 12,
        models: [
          { id: 'acme/flagship', name: 'Acme Flagship', vendor: 'acme', created: 200, contextLength: 128000, prices: { input: 2.5, output: 75, cacheRead: 0.15, cacheWrite: 0.0002 }, source: 'manual' },
          { id: 'acme/mini', name: 'Acme Mini', vendor: 'acme', created: 100, contextLength: 32000, prices: { input: 0.25, output: 1, cacheRead: null, cacheWrite: null }, source: 'fetched' },
        ],
      },
      {
        vendor: '',
        modelCount: 1,
        manualOnly: true,
        models: [{ id: 'deepseek/deepseek-chat', name: 'deepseek/deepseek-chat', vendor: '', created: null, contextLength: null, prices: { input: 0.27, output: 1.1, cacheRead: null, cacheWrite: null }, source: 'manual' }],
      },
    ],
    ...overrides,
  }
}

const readyRates = { status: 'ready', data: ratesPayload(), error: null, saving: false, notice: null }

test('the rates view renders under real React without the library objecting', { skip }, () => {
  const exports = loadClient()
  assert.equal(typeof exports.RatesView, 'function', 'the view must be exported for this test')

  const { html, complaints } = renderComponent(exports.RatesView, { state: readyRates, onPatch: () => {} })
  assert.deepEqual(complaints, [], 'React reported a problem with the rendered tree')
  assert.ok(html.startsWith('<div class="tl-root"'), html.slice(0, 80))
  assert.ok(html.includes('1 USD ='))
  assert.ok(html.includes('7.1234'))
  assert.ok(html.includes('open.er-api.com'), 'the source host is named, not the whole URL')
  assert.ok(!html.includes('https://open.er-api.com'), 'the full URL is not dumped into the page')
})

test('every vendor group renders a header and one row per model', { skip }, () => {
  const exports = loadClient()
  const { html, complaints } = renderComponent(exports.RatesView, { state: readyRates, onPatch: () => {} })
  assert.deepEqual(complaints, [])

  assert.equal(countClass(html, 'tl-vendor'), 2, 'a fetched vendor and a hand-entered group')
  assert.equal(countClass(html, 'tl-vendor-head'), 2)
  assert.equal(countClass(html, 'tl-rate-head'), 2, 'each group carries its own column header')
  assert.equal(countClass(html, 'tl-rate-row'), 3, 'one row per published model')
  // Six cells per row: the model, four prices and the actions.
  assert.equal(countByClass(html, 'tl-rate-price'), 12)
  assert.ok(html.includes('Acme Flagship'))
  assert.ok(html.includes('deepseek/deepseek-chat'))
  // A manual row is marked in the markup, not only in prose.
  assert.equal(countClass(html, 'tl-rate-row').valueOf(), 3)
  assert.equal((html.match(/data-manual="true"/g) ?? []).length, 2)
  // Prices are shown in the quote currency, one precision per column: a converted
  // price keeps cents, a price cents would erase keeps the decimals it needs, and an
  // unpublished one is a dash.
  assert.ok(html.includes('>¥534.25<'), 'a converted price')
  assert.ok(html.includes('>¥17.81<'))
  assert.ok(html.includes('>¥0.0014<'))
  assert.ok(html.includes('>—<'))
  // The US dollar quote it came from is on the cell, not lost.
  assert.ok(html.includes('title="priceUsdHint $75"'), html.slice(html.indexOf('tl-rate-price'), html.indexOf('tl-rate-price') + 200))
  // Each vendor group carries a mark, and the table is wide enough to name its
  // models: the name column has a floor and the list scrolls under it.
  assert.equal(countByClass(html, 'tl-logo'), 2)
  assert.equal(countClass(html, 'tl-rate-table'), 2)
})

test('the hand-entry form is a real form, with one field per price', { skip }, () => {
  const exports = loadClient()
  const { html, complaints } = renderComponent(exports.RatesView, { state: readyRates, onPatch: () => {} })
  assert.deepEqual(complaints, [])
  assert.equal(countClass(html, 'tl-manual-form'), 1)
  assert.equal(countByClass(html, 'tl-field'), 10, 'five fields, each with a label element')
  const inputs = html.match(/<input[^>]*class="tl-input[^"]*"[^>]*>/g) ?? []
  // One filter box, one per row action set (none while nothing is being edited),
  // and five in the manual form.
  assert.ok(inputs.length >= 6, `expected the form's inputs, saw ${inputs.length}`)
  assert.ok(html.includes('value=""'), 'the empty form starts empty')
  // A blank model id cannot be submitted, and every field carries a label.
  assert.ok(html.includes('disabled=""'), 'the save button starts disabled')
})

test('a typed price that disagrees with the published one is put to the reader', { skip }, () => {
  const exports = loadClient()
  const pending = [{ id: 'acme/flagship', name: 'Acme Flagship', vendor: 'acme', fields: [{ key: 'input', manual: 2.5, official: 2.4 }] }]
  const { html, complaints } = renderComponent(exports.RatesView, { state: { ...readyRates, data: ratesPayload({ pending }) }, onPatch: () => {} })
  assert.deepEqual(complaints, [])

  assert.equal(countClass(html, 'tl-review-row'), 1, 'one block per model being asked about')
  assert.equal(countClass(html, 'tl-review-field'), 1)
  assert.ok(html.includes('reviewTitle'))
  assert.ok(html.includes('reviewAdopt'))
  assert.ok(html.includes('reviewKeep'))
  // Both numbers are shown, at a precision fine enough to keep them apart: the
  // row is a comparison, so rounding it to cents would hide the difference.
  assert.ok(html.includes('¥17.80850'), html.slice(html.indexOf('tl-review-field'), html.indexOf('tl-review-field') + 300))
  assert.ok(html.includes('¥17.09616'))

  // With nothing to settle the card is absent, not an empty shell.
  const quiet = renderComponent(exports.RatesView, { state: readyRates, onPatch: () => {} })
  assert.equal(countClass(quiet.html, 'tl-review-row'), 0)
  assert.ok(!quiet.html.includes('reviewTitle'))
})

test('the price card offers a refresh, which says it is working while it waits', { skip }, () => {
  const exports = loadClient()
  const idle = renderComponent(exports.RatesView, { state: readyRates, onPatch: () => {} })
  assert.ok(idle.html.includes('refreshNow'))

  const working = renderComponent(exports.RatesView, { state: { ...readyRates, saving: true, action: 'refresh' }, onPatch: () => {} })
  assert.ok(working.html.includes('refreshing'), 'the button that was pressed is the one that reports progress')

  // A save in flight is not a refresh, so the button keeps its own label and is
  // merely disabled.
  const saving = renderComponent(exports.RatesView, { state: { ...readyRates, saving: true, action: 'save' }, onPatch: () => {} })
  assert.ok(saving.html.includes('refreshNow'))
})

test('an offline rates payload renders without a rate and without complaint', { skip }, () => {
  const exports = loadClient()
  const offline = {
    status: 'ready',
    error: null,
    saving: false,
    notice: null,
    data: ratesPayload({
      catalogue: { available: false, fetchedAt: null, ageMs: null, source: 'https://openrouter.ai/api/v1/models', totalAvailable: null, modelCount: 0, vendorCount: 0 },
      fx: { available: false, rate: null, base: 'USD', quote: 'CNY', source: 'https://open.er-api.com/v6/latest/USD', fetchedAt: null, ageMs: null, overridden: false },
      vendors: [],
      lastRefresh: { at: Date.now(), ageMs: 1000, catalogue: 'failed (timeout after 20000ms)', fx: 'failed (getaddrinfo ENOTFOUND)' },
    }),
  }
  const { html, complaints } = renderComponent(exports.RatesView, { state: offline, onPatch: () => {} })
  assert.deepEqual(complaints, [])
  assert.ok(html.includes('neverFetched'))
  assert.ok(html.includes('fxNone'))
  assert.equal(countClass(html, 'tl-vendor'), 0)
  assert.ok(html.includes('ratesEmpty'), 'the empty table says what to do instead')
  assert.ok(html.includes('modelIdPlaceholder'), 'the hand-entry form is still offered')
  assert.equal(countClass(html, 'tl-manual-form'), 1)
})

/* ------------------------------------------------------------------- bill -- */

/** The groupings the bill stacks, in page order. */
const BILL_DIMS = ['workspace', 'session', 'model', 'vendor']

/**
 * A ready bill payload.
 *
 * @param {object} [overrides] - fields to replace.
 * @returns {object} the payload.
 */
function billPayload(overrides = {}) {
  const rows = [
    {
      key: 'openai',
      label: 'openai',
      sublabel: null,
      plan: true,
      covered: true,
      calls: 12,
      inputTokens: 1_000_000,
      outputTokens: 200_000,
      cacheReadTokens: 500_000,
      cacheWriteTokens: 0,
      totalTokens: 1_700_000,
      cacheHitRate: 0.3333,
      cost: 140,
      usageCost: 98.6,
      unpricedTokens: 0,
      modelCount: 2,
      sessionCount: 3,
    },
    {
      key: 'proj/修复导出',
      label: 'proj/修复导出',
      sublabel: 'session-54da1581 · D:\\proj',
      plan: false,
      covered: false,
      calls: 4,
      inputTokens: 400_000,
      outputTokens: 40_000,
      cacheReadTokens: 3_000_000,
      cacheWriteTokens: 12_000,
      totalTokens: 3_440_000,
      cacheHitRate: 0.8824,
      cost: 4.2,
      usageCost: 4.2,
      unpricedTokens: 0,
      modelCount: 3,
      sessionCount: 2,
    },
  ]
  const totals = {
    calls: 16,
    inputTokens: 1_400_000,
    outputTokens: 240_000,
    cacheReadTokens: 3_500_000,
    cacheWriteTokens: 12_000,
    totalTokens: 5_140_000,
    cacheHitRate: 0.7143,
    cost: 144.2,
    usageCost: 102.8,
    subscriptionCost: 140,
    totalCost: 144.2,
    unpricedCost: false,
  }
  return {
    plugin: 'token-ledger',
    generatedAt: new Date(2026, 2, 31, 12, 0, 0).getTime(),
    dimensions: BILL_DIMS,
    ranges: ['month'],
    currency: 'CNY',
    priceSource: 'modelsdev',
    fxRate: 7.1234,
    sections: [{ by: 'workspace', range: { kind: 'month', from: '2026-03-01', to: '2026-03-31' }, rows, totals, currency: 'CNY' }],
    subscriptions: [{ plan: 'GPT plan', vendor: 'openai', amount: 140, currency: 'CNY', share: 140, months: ['2026-03'], note: null, calls: 12, totalTokens: 1_700_000, cacheHitRate: 0.3333 }],
    unpriced: [],
    joins: [{ model: 'deepseek-official/deepseek-v4-flash', vendor: 'deepseek', price: 'DeepSeek-V4.1-Flash', priceId: 'deepseek-flash', confidence: 'name', matchedOn: 'name+version', tokens: 440_000 }],
    ...overrides,
  }
}

/**
 * One fetch state per grouping, all ready on the same payload.
 *
 * @param {object} [data] - what every section answers with.
 * @param {object} [states] - per-grouping overrides.
 * @returns {object} the `bills` prop.
 */
function billStates(data = billPayload(), states = {}) {
  return Object.fromEntries(BILL_DIMS.map((dim) => [dim, states[dim] ?? { status: 'ready', data, error: null }]))
}

/** The props the bill view takes, with every period on the month. */
function billProps(bills = billStates()) {
  return {
    bills,
    ranges: Object.fromEntries(BILL_DIMS.map((dim) => [dim, 'month'])),
    onRange: () => {},
  }
}

/** Count elements whose class attribute is exactly this one. */
function countExactClass(html, className) {
  return (html.match(new RegExp(`class="${className}"`, 'g')) ?? []).length
}

test('the bill view renders under real React without the library objecting', { skip }, () => {
  const exports = loadClient()
  assert.equal(typeof exports.BillView, 'function', 'the view must be exported for this test')

  const { html, complaints } = renderComponent(exports.BillView, billProps())
  assert.deepEqual(complaints, [], 'React reported a problem with the rendered tree')
  assert.ok(html.startsWith('<div class="tl-root"'), html.slice(0, 80))
  assert.equal(countExactClass(html, 'tl-card'), 4, 'one card per grouping')
  assert.equal(countExactClass(html, 'tl-bill-table'), 4)
  assert.equal(countClass(html, 'tl-bill-head'), 4)
  assert.equal(countClass(html, 'tl-bill-total'), 4)
  // Five periods in each of four sections.
  assert.equal(countClass(html, 'tl-tab'), 20, 'four period strips of five tabs each')
  assert.equal(countClass(html, 'tl-tabs'), 4, 'and one strip per section')
})

test('the export links carry every grouping over every period', { skip }, () => {
  const exports = loadClient()
  const { html } = renderComponent(exports.BillView, billProps())
  const hrefs = html.match(/href="[^"]*"/g)?.join(' ') ?? ''
  assert.ok(hrefs.includes('href="/api/token-ledger/bill?by=workspace,session,model,vendor&amp;range=month,year,week,today,all&amp;format=csv"'), hrefs)
  assert.ok(html.includes('download="token-bill-all-2026-03-31.csv"'))
  assert.ok(hrefs.includes('format=json'))
  assert.ok(html.includes('download="token-bill-all-2026-03-31.json"'))
})

test('the bill shows both halves of the input, the money and what went unpriced', { skip }, () => {
  const exports = loadClient()
  const withUnpriced = billPayload({
    unpriced: [{ model: 'nobody/mystery-1', vendor: 'nobody', tokens: 300_000, calls: 2, reason: 'no price for this model' }],
  })
  const { html, complaints } = renderComponent(exports.BillView, billProps(billStates(withUnpriced)))
  assert.deepEqual(complaints, [])
  // The header names the columns, in the order a bill is read: the group, the
  // calls, both halves of the input, the output, the hit rate and the cost. The
  // translator in this test returns its key, so the keys are what to look for.
  for (const label of ['calls', 'cacheReadTokens', 'inputTokens', 'outputTokens', 'cacheHitRate', 'billCost']) {
    assert.ok(html.includes(`<span>${label}</span>`), `missing column: ${label}`)
  }
  assert.ok(html.includes('¥140.00'), 'the plan is what the row costs')
  assert.ok(html.includes('¥144.20'), 'and the total is the bill, not the usage alone')
  assert.ok(html.includes('billCoveredUsage ¥98.60'), 'the usage the plan covers is stated beside it, not added to it')
  assert.ok(html.includes('88.2%'), 'the hit rate is on the row')
  assert.ok(html.includes('billCacheWrite'), 'cache writes are footnoted rather than dropped')
  assert.ok(html.includes('billUnpriced'))
  assert.ok(html.includes('nobody/mystery-1'))
  assert.ok(html.includes('no price for this model'))
  assert.ok(html.includes('billJoins'), 'a price applied by name is shown rather than trusted')
  assert.ok(html.includes('deepseek-flash'))
})

test('each section renders its own period, and a failed one keeps the rest', { skip }, () => {
  const exports = loadClient()
  const mixed = {
    workspace: { status: 'ready', data: billPayload(), error: null },
    session: { status: 'error', data: null, error: 'HTTP 500' },
    model: { status: 'stale', data: billPayload(), error: 'network' },
    vendor: { status: 'ready', data: billPayload({ currency: 'USD', fxRate: null }), error: null },
  }
  const props = { ...billProps(mixed), ranges: { workspace: 'today', session: 'month', model: 'year', vendor: 'all' } }
  const { html, complaints } = renderComponent(exports.BillView, props)
  assert.deepEqual(complaints, [])
  assert.equal(countExactClass(html, 'tl-card'), 4)
  // One section failed: three tables are still there, and the failure is inside it.
  assert.equal(countExactClass(html, 'tl-bill-table'), 3)
  assert.ok(html.includes('billSectionFailed'))
  assert.ok(html.includes('HTTP 500'))
  assert.ok(html.includes('stale'), 'and a stale section says so')
  // The section that is in dollars renders dollars, not yuan.
  assert.ok(html.includes('$144.20'))
})

test('a bill that cannot be read explains itself instead of rendering tables', { skip }, () => {
  const exports = loadClient()
  const failed = Object.fromEntries(BILL_DIMS.map((dim) => [dim, { status: 'error', data: null, error: 'HTTP 500' }]))
  const { html, complaints } = renderComponent(exports.BillView, billProps(failed))
  assert.deepEqual(complaints, [])
  assert.equal(countExactClass(html, 'tl-bill-table'), 0)
  assert.ok(html.includes('billUnavailableReason'))
  assert.ok(html.includes('billSectionFailed'))

  // An empty period says so rather than drawing a table with no rows.
  const empty = billPayload({ sections: [{ by: 'workspace', range: { kind: 'month', from: '2026-03-01', to: '2026-03-31' }, rows: [], totals: { calls: 0, totalTokens: 0, totalCost: 0, cacheHitRate: null }, currency: 'CNY' }] })
  const blank = renderComponent(exports.BillView, billProps(billStates(empty)))
  assert.deepEqual(blank.complaints, [])
  assert.ok(blank.html.includes('billSectionEmpty'))
  assert.equal(countClass(blank.html, 'tl-bill-row'), 0)
})