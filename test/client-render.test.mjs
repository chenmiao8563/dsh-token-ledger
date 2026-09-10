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
 * Render the view and report anything React complained about.
 *
 * React reports invalid DOM props, bad hook usage and key problems through
 * `console.error`, so capturing it turns "it rendered" into "it rendered without
 * the library objecting", which the stand-in React cannot detect.
 *
 * @param {object} exports - the loaded client module.
 * @param {object} props - the view props.
 * @returns {{ html: string, complaints: string[] }} the markup and React's output.
 */
function renderView(exports, props) {
  const complaints = []
  const realError = console.error
  const realWarn = console.warn
  console.error = (...args) => complaints.push(args.map(String).join(' '))
  console.warn = (...args) => complaints.push(args.map(String).join(' '))
  try {
    const html = loaded.server.renderToStaticMarkup(
      loaded.react.createElement(exports.OverviewView, {
        t: (key) => key,
        range: 'month',
        view: 'year',
        onRange: () => {},
        onView: () => {},
        ...props,
      }),
    )
    return { html, complaints }
  } finally {
    console.error = realError
    console.warn = realWarn
  }
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
    models: [{ model: 'deepseek-official/deepseek-v4-flash', calls: 55, totalTokens: 5500, cacheReadTokens: 4950, inputTokens: 550, cacheHitRate: 0.9 }],
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

  // The three requested periods are offered as tabs, with the active one marked.
  for (const key of ['rangeMonth', 'rangeYear', 'rangeWeek']) assert.ok(month.html.includes(key), key)
  assert.equal(countClass(month.html, 'tl-tab'), 6, 'three range tabs and three calendar tabs')
  assert.ok(month.html.includes('data-active="true"'), 'the active tab is marked')
})

test('today renders separately from the selected range', { skip }, () => {
  const exports = loadClient()
  const { html } = renderView(exports, { state: ready, range: 'year' })
  assert.ok(html.includes('2026-03-10'), 'the local date')
  assert.ok(html.includes('todayHint'))
  assert.ok(html.includes('today'), 'the today heading survives a year-range selection')
})

test('the calendar switches between a heat grid, a month grid and bars', { skip }, () => {
  const exports = loadClient()

  const year = renderView(exports, { state: ready, view: 'year' })
  // Ten series days plus the five legend swatches.
  assert.equal(countClass(year.html, 'tl-cell'), 15)
  assert.ok(year.html.includes('tl-grid'))

  const month = renderView(exports, { state: ready, view: 'month' })
  assert.equal(countClass(month.html, 'tl-month-grid'), 1)
  assert.equal(countClass(month.html, 'tl-month-cell'), 31, 'every day of March is a cell')
  // The year grid is gone; the five `tl-cell` swatches left are the legend,
  // which both heat views share.
  assert.equal(countClass(month.html, 'tl-grid'), 0, 'no year grid while the month grid is shown')
  assert.equal(countClass(month.html, 'tl-cell'), 5, 'only the legend swatches remain')

  const week = renderView(exports, { state: ready, view: 'week' })
  assert.equal(countClass(week.html, 'tl-bar'), 7, 'one bar per day')
  assert.equal(countClass(week.html, 'tl-bar-col'), 7)
  assert.equal(countClass(week.html, 'tl-cell'), 0, 'no heat cells while the bars are shown')
  assert.ok(week.html.includes('weekChart'))
  // Bars carry inline heights, so the chart is actually proportional.
  assert.ok(/class="tl-bar" style="height:\d+px"/.test(week.html), 'bars are sized')
})

test('heat levels are bounded and relative to the busiest day', { skip }, () => {
  const exports = loadClient()
  const { html } = renderView(exports, { state: ready, view: 'year' })
  const backgrounds = [...html.matchAll(/class="tl-cell" style="background:([^"]+)"/g)].map((match) => match[1])
  assert.equal(backgrounds.length, 15)
  // The five legend swatches are the palette; the ten day cells must use it too.
  const palette = new Set(backgrounds)
  assert.ok(palette.size <= 5, `expected at most five levels, saw ${palette.size}`)
  assert.ok(backgrounds.every((value) => /^rgba\(/.test(value)), 'levels are explicit colours')
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

test('the model list is proportional to the largest model', { skip }, () => {
  const exports = loadClient()
  const { html } = renderView(exports, { state: ready })
  assert.ok(html.includes('deepseek-official/deepseek-v4-flash'))
  assert.ok(html.includes('tl-model-fill'))
  // A single model is the busiest one, so its bar is full width.
  assert.ok(/class="tl-model-fill" style="width:100%"/.test(html), 'the largest model fills its bar')
})
