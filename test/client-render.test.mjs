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

/**
 * Count occurrences of a class fragment anywhere in a class attribute.
 *
 * `countClass` matches the attribute exactly, which is what a count of real
 * calendar cells needs; this one is for namespaced families such as `tl-bar-*`.
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

test('the year view is a weekday-aligned heatmap with a month axis', { skip }, () => {
  const exports = loadClient()
  const { html, complaints } = renderView(exports, { state: ready, view: 'year' })
  assert.deepEqual(complaints, [])

  assert.equal(countClass(html, 'tl-grid'), 1)
  // Ten day cells, and one legend chip per ramp step.
  assert.equal(countClass(html, 'tl-cell'), 10)
  assert.equal(countByClass(html, 'tl-chip'), 7)
  // 2026-03-01 is a Sunday, so the first column is padded by six blanks; without
  // them every row would be a weekday that lies and the axis would point at the
  // wrong columns.
  assert.equal(countByClass(html, 'tl-blank'), 6)
  // One axis label per month in the window, and the text comes from the
  // dictionary rather than from the date string.
  assert.equal(countByClass(html, 'tl-axis-label'), 1)
  assert.ok(html.includes('>m3<'), 'March is labelled through the dictionary')
})

test('the month and week views are both bar charts, with different bar widths', { skip }, () => {
  const exports = loadClient()

  const month = renderView(exports, { state: ready, view: 'month' })
  assert.equal(countByClass(month.html, 'tl-bar-col'), 10, 'one bar per day of the current month')
  // The width is fixed at 9px for a month and 26px for a week: a proportional
  // column would make seven bars and thirty bars look like different charts.
  assert.ok(/flex:\s*0\s+0\s+9px/.test(month.html), 'month bars are thin')
  assert.equal(countByClass(month.html, 'tl-grid'), 0, 'no heat grid in the month view')
  assert.equal(countClass(month.html, 'tl-cell'), 0, 'no heat cells and no legend in the month view')
  assert.ok(month.html.includes('monthChart'))
  // Labels are thinned out, so thirty bars do not stack thirty labels.
  assert.ok(countByClass(month.html, 'tl-bar-blank') > 0, 'month labels are sparse')

  const week = renderView(exports, { state: ready, view: 'week' })
  assert.equal(countByClass(week.html, 'tl-bar-col'), 7)
  assert.ok(/flex:\s*0\s+0\s+26px/.test(week.html), 'week bars have a fixed width instead of filling the pane')
  assert.equal(countByClass(week.html, 'tl-bar-value'), 7, 'the week chart shows its values')
  assert.equal(countByClass(week.html, 'tl-bar-blank'), 0, 'every week bar is labelled')
  assert.ok(week.html.includes('weekChart'))
  // Bars carry inline heights, so the chart is actually proportional.
  assert.ok(/class="tl-bar" style="height:\d+px"/.test(week.html), 'bars are sized')
})

test('heat levels are bounded and relative to the busiest day', { skip }, () => {
  const exports = loadClient()
  const { html } = renderView(exports, { state: ready, view: 'year' })
  const backgrounds = [...html.matchAll(/class="tl-cell" style="background:([^"]+)"/g)].map((match) => match[1])
  assert.equal(backgrounds.length, 10, 'one background per day cell')
  // The legend chips are the palette; the ten day cells must draw from it too.
  const palette = new Set(backgrounds)
  assert.ok(palette.size <= 7, `expected at most seven levels, saw ${palette.size}`)
  assert.ok(backgrounds.every((value) => /^rgba\(/.test(value)), 'levels are explicit colours')
  // The ramp reaches a genuinely dark end, which is what makes the busiest days
  // stand out instead of saturating at a mid blue.
  assert.ok(
    backgrounds.some((value) => {
      const [r, g, b] = value.match(/[\d.]+/g).map(Number)
      return r < 40 && g < 70 && b > 90
    }),
    'the deepest step is dark',
  )
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
  // The fixture model has cache reads, uncached input and output; the empty
  // cache-write bucket is filtered out rather than drawn at zero width.
  assert.equal(countByClass(html, 'tl-seg'), 3)
  assert.ok(html.includes('background:#7fb2ff'), 'cache reads have their own colour')
  assert.ok(html.includes('background:#2f6fd0'), 'uncached input has its own colour')
  assert.ok(html.includes('background:#2fa86a'), 'output has its own colour')
  // Every bucket is named once in the key, whatever the bars happen to contain.
  // `tl-keys` is the container, so the count is of the exact item class.
  assert.equal(countClass(html, 'tl-key'), 4)
  assert.equal(countClass(html, 'tl-swatch'), 4)
  for (const key of ['cacheReadTokens', 'inputTokens', 'outputTokens', 'cacheWriteTokens']) {
    assert.ok(html.includes(key), `${key} is named in the key`)
  }
})

test('a model with no usage renders an empty meter rather than a broken stack', { skip }, () => {
  const exports = loadClient()
  const empty = { ...ready, data: { ...ready.data, models: [{ model: 'unused/model', calls: 0, totalTokens: 0 }] } }
  const { html, complaints } = renderView(exports, { state: empty })
  assert.deepEqual(complaints, [])
  assert.equal(countByClass(html, 'tl-meter'), 1)
  assert.equal(countByClass(html, 'tl-seg'), 0, 'no segments to draw')
})

