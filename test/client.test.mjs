/**
 * Browser-half tests.
 *
 * There is no browser here, and React is supplied by the client module loader
 * rather than installed, so the module is loaded through a stand-in loader with
 * a stand-in React. That is enough to exercise everything that is actually
 * written in this repository: the module wrapper, the registration contract,
 * and the component's own rendering logic — formatting, heat levels, series
 * slicing and view switching. What it cannot check is how the result looks and
 * whether the settings shell accepts the registration, which is why the README
 * says so plainly.
 *
 * @module dsh-token-ledger/test/client.test
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

/** Sentinel meaning "use the component's own default for this hook". */
const DEFAULT = Symbol('default')

/**
 * Load `lib/client.js` through a fake module loader.
 *
 * @returns {{ id: string, exports: object, reactEffects: object[], priming: unknown[], recorder: object }} the loaded module and its instruments.
 */
function loadClientModule() {
  const reactEffects = []
  const priming = []
  const recorder = { setState: null }

  const react = {
    createElement: (type, props, ...children) => ({
      type,
      props: props ?? {},
      children: children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false),
    }),
    useState: (initial) => {
      const next = priming.length > 0 ? priming.shift() : DEFAULT
      const value = next === DEFAULT ? initial : next
      const setter = (update) => {
        recorder.setState = typeof update === 'function' ? update(value) : update
      }
      return [value, setter]
    },
    useEffect: (factory) => {
      reactEffects.push(factory)
    },
    useRef: (initial) => ({ current: initial }),
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  }

  let loaded
  globalThis.window = {
    __ModuleLoader__: {
      load: (definition) => {
        loaded = definition
      },
    },
  }
  globalThis.document = {
    head: { appendChild: () => {} },
    getElementById: () => null,
    createElement: () => ({ dataset: {}, remove: () => {}, textContent: '', id: '' }),
  }

  const source = readFileSync(fileURLToPath(new URL('../lib/client.js', import.meta.url)), 'utf8')
  // Evaluate the file the way the browser would: it calls the global loader.
  new Function('require', source)((name) => {
    if (name === 'react') return react
    throw new Error(`unexpected require("${name}")`)
  })

  assert.ok(loaded !== undefined, 'the module did not call window.__ModuleLoader__.load')
  return {
    id: loaded.id,
    exports: loaded.factory((name) => (name === 'react' ? react : undefined)),
    reactEffects,
    priming,
    recorder,
  }
}

/**
 * Expand a rendered tree the way React would.
 *
 * The stand-in `createElement` records a component element as `{ type: <function> }`
 * without calling it, so a walk has to invoke function components itself.
 * Expansion happens exactly once per render, because a second pass would consume
 * primed hook values that are already spent.
 *
 * @param {unknown} node - an element, an array, or a leaf.
 * @returns {unknown[]} a tree of host elements and primitives.
 */
function expand(node) {
  if (node === null || node === undefined || node === false || node === true) return []
  if (typeof node === 'string' || typeof node === 'number') return [node]
  if (Array.isArray(node)) return node.flatMap(expand)
  if (typeof node === 'object' && 'type' in node) {
    const { type, props, children } = node
    if (typeof type === 'function') return expand(type({ ...props, children }))
    return [{ type, props, children: expand(children ?? []) }]
  }
  return []
}

/**
 * Collect every string in an expanded tree.
 *
 * @param {unknown} node - the expanded tree.
 * @returns {string[]} the strings, in tree order.
 */
function collectText(node) {
  if (node === null || node === undefined || node === false) return []
  if (typeof node === 'string') return [node]
  if (typeof node === 'number') return [String(node)]
  if (Array.isArray(node)) return node.flatMap(collectText)
  if (typeof node === 'object' && 'type' in node) return collectText(node.children ?? [])
  return []
}

/**
 * Count host elements whose className contains a fragment.
 *
 * Substring matching is the right default for namespaced classes, but a prefix
 * like `tl-week` also matches `tl-week-row`, so exact counting is available too.
 *
 * @param {unknown} node - the expanded tree.
 * @param {string} fragment - the class fragment.
 * @returns {number} the count.
 */
function countByClass(node, fragment) {
  if (node === null || node === undefined || typeof node !== 'object') return 0
  if (Array.isArray(node)) return node.reduce((sum, child) => sum + countByClass(child, fragment), 0)
  let total = String(node.props?.className ?? '').includes(fragment) ? 1 : 0
  total += countByClass(node.children ?? [], fragment)
  return total
}

/**
 * Count host elements carrying exactly one class string.
 *
 * @param {unknown} node - the expanded tree.
 * @param {string} className - the exact class attribute.
 * @returns {number} the count.
 */
function countByExactClass(node, className) {
  if (node === null || node === undefined || typeof node !== 'object') return 0
  if (Array.isArray(node)) return node.reduce((sum, child) => sum + countByExactClass(child, className), 0)
  let total = node.props?.className === className ? 1 : 0
  total += countByExactClass(node.children ?? [], className)
  return total
}

/**
 * Find the first element carrying a class fragment.
 *
 * @param {unknown} node - the expanded tree.
 * @param {string} fragment - the class fragment.
 * @returns {unknown} the element, or null when nothing matches.
 */
function findByClass(node, fragment) {
  if (node === null || node === undefined || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findByClass(child, fragment)
      if (found !== null) return found
    }
    return null
  }
  if (String(node.props?.className ?? '').includes(fragment)) return node
  return findByClass(node.children ?? [], fragment)
}

/**
 * Whether any rendered string contains a fragment.
 *
 * The collected text is a list of leaf strings, so a substring has to be looked
 * for inside each element rather than compared to the list.
 *
 * @param {string[]} texts - the collected text.
 * @param {string} needle - the fragment.
 * @returns {boolean} whether it appears.
 */
function hasText(texts, needle) {
  return texts.some((value) => value.includes(needle))
}

/**
 * Collect every element carrying a class fragment.
 *
 * @param {unknown} node - the expanded tree.
 * @param {string} fragment - the class fragment.
 * @returns {unknown[]} the matching elements, in tree order.
 */
function findAllByClass(node, fragment) {
  if (node === null || node === undefined || typeof node !== 'object') return []
  if (Array.isArray(node)) return node.flatMap((child) => findAllByClass(child, fragment))
  const found = String(node.props?.className ?? '').includes(fragment) ? [node] : []
  return found.concat(findAllByClass(node.children ?? [], fragment))
}

/**
 * Find the buttons inside a subtree by their label.
 *
 * @param {unknown} node - the expanded tree.
 * @param {string} label - the button's text.
 * @returns {object[]} the buttons.
 */
function findButtons(node, label) {
  return findAllByClass(node, 'tl-btn').filter((element) => collectText(element).includes(label))
}

/**
 * A stand-in translator: returns the key, so assertions read the key names.
 *
 * @returns {(key: string) => string} the translator.
 */
function fakeT() {
  return (key) => key
}

/**
 * A ready payload covering 2026-03-01 to 2026-03-10.
 *
 * The fixture is built so the month highlights each have one unambiguous
 * answer: the 1st is a Sunday and the lightest day overall, the 5th is the
 * last weekday to stop working, and the weekend of the 7th and 8th runs later
 * still — so a weekend leaking into a weekday highlight fails the test.
 */
function payload(overrides = {}) {
  const lastAt = {
    5: new Date(2026, 2, 5, 23, 40).getTime(),
    7: new Date(2026, 2, 7, 23, 50).getTime(),
    8: new Date(2026, 2, 8, 23, 55).getTime(),
  }
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
      lastAt: lastAt[day] ?? new Date(2026, 2, day, 20, 0).getTime(),
    })
  }
  return {
    plugin: 'token-ledger',
    generatedAt: new Date(2026, 2, 10, 12, 0, 0).getTime(),
    ledgerUpdatedAt: new Date(2026, 2, 10, 12, 0, 0).getTime(),
    totals: { inputTokens: 550, outputTokens: 55, cacheReadTokens: 4950, cacheWriteTokens: 0, totalTokens: 5500, reasoningTokens: 7, calls: 55, cacheHitRate: 0.9 },
    ranges: {
      month: { kind: 'month', from: '2026-03-01', to: '2026-03-10', totals: { inputTokens: 550, outputTokens: 55, cacheReadTokens: 4950, cacheWriteTokens: 0, totalTokens: 5500, reasoningTokens: 7 }, calls: 55, activeDays: 10, cacheHitRate: 0.9 },
      year: { kind: 'year', from: '2026-01-01', to: '2026-03-10', totals: { inputTokens: 550, outputTokens: 55, cacheReadTokens: 4950, cacheWriteTokens: 0, totalTokens: 5500, reasoningTokens: 0 }, calls: 55, activeDays: 10, cacheHitRate: 0.9 },
      week: { kind: 'week', from: '2026-03-04', to: '2026-03-10', totals: { inputTokens: 490, outputTokens: 49, cacheReadTokens: 4410, cacheWriteTokens: 0, totalTokens: 4900, reasoningTokens: 0 }, calls: 49, activeDays: 7, cacheHitRate: 0.9 },
    },
    today: { date: '2026-03-10', lastEventAt: 1, totals: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 900, cacheWriteTokens: 0, totalTokens: 1000, reasoningTokens: 0 }, calls: 10, activeDays: 1, cacheHitRate: 0.9 },
    series,
    models: [{ model: 'deepseek-official/deepseek-v4-flash', calls: 55, totalTokens: 5500, cacheReadTokens: 4950, inputTokens: 550, cacheHitRate: 0.9 }],
    sessionCount: 3,
    // What each period cost, priced by the host. The month and the day differ, so a
    // test can tell which one a metric is reading.
    cost: {
      currency: 'CNY',
      rate: 7.1,
      priced: true,
      byRange: {
        month: { cost: 123.456, usageCost: 120, subscriptionCost: 3.456, unpricedTokens: 0, unpricedCost: false },
        year: { cost: 223.456, usageCost: 220, subscriptionCost: 3.456, unpricedTokens: 0, unpricedCost: false },
        week: { cost: 23.456, usageCost: 20, subscriptionCost: 3.456, unpricedTokens: 0, unpricedCost: false },
        today: { cost: 1.5, usageCost: 1.5, subscriptionCost: 0, unpricedTokens: 0, unpricedCost: false },
      },
    },
    ...overrides,
  }
}

/**
 * Render the section with the third hook primed to a given state.
 *
 * @param {object} module - the loaded client module.
 * @param {object} state - the fetch state the component should render.
 * @param {{ range?: unknown, view?: unknown }} [hooks] - extra hook priming.
 * @returns {{ tree: unknown, text: string[] }} the render.
 */
function render(module, state, hooks = {}) {
  const priming = module.priming
  priming.length = 0
  priming.push(hooks.range ?? DEFAULT, hooks.view ?? DEFAULT, state)
  // The registration's inject() supplies `t`; mirror that here.
  const section = module.__section
  const tree = expand(section({ t: fakeT() }))
  priming.length = 0
  return { tree, text: collectText(tree) }
}

/**
 * Load a module and capture the component the registration passes to the slot.
 *
 * @returns {{ module: object, registered: object[], registeredLocale: object[], ctxEffects: object[], reactEffects: object[] }} the module plus what it registered.
 */
function loadWithSection() {
  const module = loadClientModule()
  const registered = []
  const registeredLocale = []
  const ctxEffects = []
  const ctx = {
    effect: (factory) => {
      ctxEffects.push(factory())
    },
    locale: {
      register: (namespace, dictionaries) => {
        registeredLocale.push({ namespace, dictionaries })
        // The real service returns a disposer, and the component's effect hands
        // that disposer back to Cordis, so the stand-in must too.
        return () => {}
      },
      bind: () => fakeT(),
    },
    slots: {
      inject: (name, callback) => {
        assert.equal(name, 'settings.section')
        callback()
      },
      register: (options, component) => {
        registered.push({ options, component })
      },
    },
  }
  module.exports.apply(ctx)
  return {
    module: { ...module, __section: registered[0]?.component },
    registered,
    registeredLocale,
    ctxEffects,
    reactEffects: module.reactEffects,
  }
}

test('apply still registers the section when locale is unavailable', () => {
  const module = loadClientModule()
  const registered = []
  const ctxEffects = []
  let injected
  const ctx = {
    effect: (factory) => ctxEffects.push(factory()),
    // No locale service at all, as if the dependency were absent.
    slots: {
      inject: (_name, callback) => callback(),
      register: (options, component) => {
        registered.push({ options, component })
        injected = options
      },
    },
  }
  // A throw here would abort the mount and the section would never appear.
  module.exports.apply(ctx)
  assert.equal(registered.length, 1)
  assert.equal(registered[0].options.name, 'settings.section')
  // The label must still be a usable string, untranslated rather than missing.
  assert.equal(registered[0].options.label(), 'nav')
  // And the optional locale field must be omitted rather than pointing at a
  // namespace that was never registered.
  assert.equal('locale' in injected, false)
  assert.equal(ctxEffects.length, 1, 'only the stylesheet effect remains')
  assert.equal(typeof ctxEffects[0], 'function')
})

test('a locale that cannot bind is treated as unavailable, not as fatal', () => {
  const module = loadClientModule()
  const registered = []
  const ctx = {
    effect: () => {},
    locale: { register: () => () => {} },
    slots: {
      inject: (_name, callback) => callback(),
      register: (options) => registered.push(options),
    },
  }
  module.exports.apply(ctx)
  assert.equal(registered.length, 1)
  assert.equal(registered[0].label(), 'nav')
})

test('the module registers itself with the client loader under its package name', () => {
  const loaded = loadClientModule()
  assert.equal(loaded.id, '@chenmiao8563/dsh-token-ledger')
  assert.equal(typeof loaded.exports.apply, 'function')
  assert.deepEqual(loaded.exports.inject, ['slots', 'locale'])
})

test('apply registers a settings section with a label and dictionaries', () => {
  const { registered, registeredLocale, ctxEffects } = loadWithSection()
  assert.equal(registered.length, 1)
  const { options } = registered[0]
  assert.equal(options.name, 'settings.section')
  assert.equal(options.id, 'token-ledger')
  assert.equal(typeof options.order, 'number')
  assert.equal(typeof options.label(), 'string')
  assert.ok(options.label().length > 0)
  assert.equal(options.locale, 'token-ledger')
  assert.equal(typeof options.inject, 'function')

  assert.equal(registeredLocale.length, 1)
  assert.ok(registeredLocale[0].dictionaries.zh.nav.length > 0)
  assert.ok(registeredLocale[0].dictionaries.en.nav.length > 0)
  // Two effects: the stylesheet and the dictionaries, both with removers.
  assert.equal(ctxEffects.length, 2)
  assert.equal(typeof ctxEffects[0], 'function')
  assert.equal(typeof ctxEffects[1], 'function')
})

test('an unavailable host renders the explanation instead of throwing', () => {
  const { module } = loadWithSection()
  const loading = render(module, { status: 'loading', data: null, error: null })
  assert.ok(hasText(loading.text, 'loading'))
  const failed = render(module, { status: 'error', data: null, error: 'HTTP 404' })
  assert.ok(hasText(failed.text, 'unavailable'))
  assert.ok(hasText(failed.text, 'unavailableReason'))
  assert.ok(hasText(failed.text, 'HTTP 404'))
})

test('a ready payload renders the four ranges, their metrics, today and the calendar', () => {
  const { module } = loadWithSection()
  const { tree, text } = render(module, { status: 'ready', data: payload(), error: null })

  // Range switcher offers exactly the four requested periods, the whole ledger last.
  for (const key of ['rangeMonth', 'rangeYear', 'rangeWeek', 'rangeAll']) assert.ok(hasText(text, key), `missing ${key}`)
  // Metrics: total, cache hit rate, calls, and what the period cost.
  assert.ok(hasText(text, 'totalTokens'))
  assert.ok(hasText(text, 'cacheHitRate'))
  assert.ok(hasText(text, 'calls'))
  assert.ok(hasText(text, 'estCost'))
  assert.ok(hasText(text, '5,500'), 'the full total should be shown')
  assert.ok(hasText(text, '90.0%'), 'the cache hit rate should be shown')
  assert.ok(hasText(text, '55'))
  // Today block.
  assert.ok(hasText(text, 'today'))
  assert.ok(hasText(text, '2026-03-10'))
  // The year heatmap draws the whole calendar year — one cell per day and one
  // label per month — plus one legend chip per ramp step.
  assert.equal(countByExactClass(tree, 'tl-cell'), 365)
  assert.equal(countByClass(tree, 'tl-axis-label'), 12)
  assert.equal(countByClass(tree, 'tl-chip'), 7)
  assert.ok(hasText(text, 'byModel'))
  assert.ok(hasText(text, 'deepseek-official/deepseek-v4-flash'))
  assert.ok(hasText(text, 'updatedAt'))
})

test('the overview shows what a period cost, in the bill’s own currency', () => {
  const { module } = loadWithSection()
  const { tree, text } = render(module, { status: 'ready', data: payload(), error: null })

  // The estimate sits with the other metrics, after the hit rate, and it is money:
  // two decimals and the currency the host priced in.
  // `tl-metric` also prefixes the value, label and sub elements, so the metric
  // itself is the one whose class is exactly that.
  const metrics = findAllByClass(tree, 'tl-metric').filter((element) => element.props.className === 'tl-metric')
  const labels = metrics.map((metric) => collectText(metric).join('|'))
  const costMetric = labels.find((label) => label.includes('estCost'))
  assert.ok(costMetric !== undefined, 'the estimate is one of the metrics')
  assert.ok(costMetric.includes('¥123.46'), `two decimals of the month: ${costMetric}`)
  assert.ok(costMetric.includes('CNY'), 'and the currency it is in')
  assert.ok(labels.indexOf(costMetric) > labels.findIndex((label) => label.includes('cacheHitRate')), 'it comes after the hit rate')

  // One row of four, at one size. The row was four auto-fit columns with a 140px
  // floor, which needed 596px of card to keep the fourth tile beside the others, and
  // the estimate — the only tile that is money — was set at the smaller value size,
  // so on a narrow panel it sat alone on a second row looking like a footnote.
  const costElement = metrics.find((metric) => collectText(metric).includes('estCost'))
  assert.equal(
    String(findByClass(costElement, 'tl-metric-value').props.className),
    'tl-metric-value',
    'the estimate is set at the same size as the counts beside it',
  )
  const source = readFileSync(fileURLToPath(new URL('../lib/client.js', import.meta.url)), 'utf8')
  assert.match(source, /\.tl-metrics \{ display: grid; grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/, 'four tiles, one row')
  assert.doesNotMatch(source, /\.tl-metrics \{[^}]*auto-fit/, 'and nothing left to wrap onto a second row')

  // The range switcher stays on the header's own line, at the right. As a plain
  // row, its wrap was decided by the header's width, and a subtitle that filled
  // the card pushed the four tabs onto a second line at the left.
  const headerRows = findAllByClass(tree, 'tl-row-head')
  assert.equal(headerRows.length, 1, 'the overview header row is marked as one')
  assert.equal(String(headerRows[0].props.className), 'tl-row tl-row-head')
  assert.equal(countByClass(headerRows[0], 'tl-tabs'), 1, 'and the range tabs are on it')
  assert.match(source, /\.tl-row-head \{ flex-wrap: nowrap; align-items: flex-start; \}/, 'a header row never wraps, and its buttons sit in the corner the title does')
  assert.match(source, /\.tl-row-head > \.tl-head \{ flex: 1 1 auto; min-width: 0; \}/, 'the header is the item that gives way')
  assert.doesNotMatch(source, /\.tl-row-head \{[^}]*flex-wrap: wrap/, 'nothing on it is allowed to drop to a second line')

  // Today has its own number, not the month's.
  const todayBlock = findAllByClass(tree, 'tl-card').find((card) => collectText(card).some((value) => value.startsWith('today')))
  assert.ok(hasText(collectText(todayBlock), '¥1.50'), 'today is priced for today')

  // Switching the range switches the estimate with it.
  const year = render(module, { status: 'ready', data: payload(), error: null }, { range: 'year' })
  assert.ok(hasText(year.text, '¥223.46'))

  // A host with no prices says so rather than showing a confident zero.
  const unpriced = render(module, { status: 'ready', data: payload({ cost: { priced: false, currency: null, rate: null, byRange: null } }), error: null })
  assert.ok(hasText(unpriced.text, 'estCostNone'))
  assert.ok(hasText(unpriced.text, '—'))
  const silent = render(module, { status: 'ready', data: payload({ cost: undefined }), error: null })
  assert.ok(hasText(silent.text, 'estCostNone'), 'and an older host without a cost at all is the same case')

  // Tokens the bill could not price are named under the number they are missing from.
  const partial = render(
    module,
    { status: 'ready', data: payload({ cost: { ...payload().cost, byRange: { ...payload().cost.byRange, month: { cost: 10, usageCost: 10, subscriptionCost: 0, unpricedTokens: 5_000_000, unpricedCost: true } } } }), error: null },
  )
  assert.ok(hasText(partial.text, 'estCostUnpriced'))
  assert.ok(hasText(partial.text, '500.00 万'))
})

test('the week view renders one horizontal bar per day and drops the heat legend', () => {
  const { module } = loadWithSection()
  const { tree, text } = render(module, { status: 'ready', data: payload(), error: null }, { view: 'week' })
  assert.equal(countByClass(tree, 'tl-week-row'), 7)
  // Six bare rows plus today's, which carries the extra marker class.
  assert.equal(countByExactClass(tree, 'tl-week-row'), 6)
  assert.equal(countByClass(tree, 'tl-week-row-today'), 1)
  assert.equal(countByClass(tree, 'tl-week-fill'), 7)
  assert.ok(hasText(text, 'weekChart'))
  assert.equal(countByClass(tree, 'tl-cell'), 0, 'no heat cells while the bars are shown')
})

test('the month view draws the current month as a calendar heatmap', () => {
  const { module } = loadWithSection()
  const { tree } = render(module, { status: 'ready', data: payload(), error: null }, { view: 'month' })
  // March 2026 has 31 days and the 1st is a Sunday, so the first week is padded
  // by six blanks and the columns stay aligned to their real weekdays.
  assert.equal(countByExactClass(tree, 'tl-month-cell'), 31)
  assert.equal(countByExactClass(tree, 'tl-month-blank'), 6)
  assert.equal(countByExactClass(tree, 'tl-month-weekday'), 7)
  assert.equal(countByClass(tree, 'tl-week-row'), 0, 'no week bars in the month view')
  assert.equal(countByClass(tree, 'tl-grid'), 0, 'no year grid in the month view')
})

test('the month summary highlights the busiest, lightest and latest day', () => {
  const { module } = loadWithSection()
  const { tree } = render(module, { status: 'ready', data: payload(), error: null }, { view: 'month' })
  // Scoped to the summary block, because today's card renders the same date
  // string and would otherwise let a wrong highlight pass.
  const summary = findByClass(tree, 'tl-month-summary')
  assert.ok(summary !== null, 'the month view has a summary block')
  assert.equal(countByExactClass(summary, 'tl-metric'), 3)
  const text = collectText(summary)
  assert.ok(hasText(text, 'busiestDay') && hasText(text, 'lightestDay') && hasText(text, 'latestDay'))
  assert.ok(hasText(text, '2026-03-10'), 'the busiest day is the 10th')
  // The 1st is the lightest day overall and the 7th/8th stop latest, but all
  // three are weekend days: the weekday rule must skip them.
  assert.ok(hasText(text, '2026-03-02'), 'the lightest weekday is the 2nd')
  assert.ok(!hasText(text, '2026-03-01'), 'a weekend day must not win a weekday highlight')
  assert.ok(hasText(text, '23:40'), 'the latest finish is the 5th at 23:40')
  assert.ok(!hasText(text, '23:50') && !hasText(text, '23:55'), 'weekend finishes are not highlighted')
  assert.ok(hasText(text, 'weekdayOnly'))
})

test('an idle month still names the lightest weekday, but no busiest or latest day', () => {
  const { module } = loadWithSection()
  const zeros = payload().series.map((day) => ({ ...day, calls: 0, totalTokens: 0, lastAt: null }))
  const { tree } = render(module, { status: 'ready', data: payload({ series: zeros }), error: null }, { view: 'month' })
  const text = collectText(findByClass(tree, 'tl-month-summary'))
  // Every weekday counts, so an idle month still has a lightest one: the first
  // elapsed weekday wins the tie.
  assert.ok(hasText(text, '2026-03-02'), 'the first elapsed weekday is the lightest at zero')
  assert.ok(!hasText(text, '2026-03-10'), 'a zero day is never the busiest')
  assert.ok(hasText(text, '—'), 'nothing was busy and nothing ran late')
})

test('switching the range reads the matching summary out of the payload', () => {
  const { module } = loadWithSection()
  const week = render(module, { status: 'ready', data: payload(), error: null }, { range: 'week' })
  assert.ok(hasText(week.text, '4,900'), 'the week range total should be rendered')
  const year = render(module, { status: 'ready', data: payload(), error: null }, { range: 'year' })
  assert.ok(hasText(year.text, '5,500'))
})

test('an empty ledger renders zeroes and a no-data calendar without throwing', () => {
  const { module } = loadWithSection()
  const empty = {
    plugin: 'token-ledger',
    generatedAt: 1,
    ledgerUpdatedAt: null,
    totals: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, reasoningTokens: 0, cacheHitRate: null },
    ranges: {
      month: { kind: 'month', from: '2026-03-01', to: '2026-03-10', totals: {}, calls: 0, activeDays: 0, cacheHitRate: null },
      year: { kind: 'year', from: '2026-01-01', to: '2026-03-10', totals: {}, calls: 0, activeDays: 0, cacheHitRate: null },
      week: { kind: 'week', from: '2026-03-04', to: '2026-03-10', totals: {}, calls: 0, activeDays: 0, cacheHitRate: null },
    },
    today: { date: '2026-03-10', lastEventAt: null, totals: {}, calls: 0, activeDays: 0, cacheHitRate: null },
    series: [],
    models: [],
    sessionCount: 0,
  }
  const { text } = render(module, { status: 'ready', data: empty, error: null })
  assert.ok(hasText(text, 'todayEmpty'))
  assert.ok(hasText(text, 'noData'))
  assert.ok(hasText(text, '—'), 'undefined numbers render as a dash')
})

test('a payload missing every optional field still renders', () => {
  const { module } = loadWithSection()
  const { text } = render(module, { status: 'ready', data: { plugin: 'token-ledger' }, error: null })
  assert.ok(hasText(text, 'totalTokens'))
  assert.ok(hasText(text, '—'))
})

test('a stale read keeps showing the previous data with a note', () => {
  const { module } = loadWithSection()
  const { text } = render(module, { status: 'stale', data: payload(), error: 'network' })
  assert.ok(hasText(text, 'stale'))
  assert.ok(hasText(text, '5,500'), 'the previous payload is still rendered')
})

test('the fetch effect reads the documented endpoint and cleans up its timer', () => {
  const { module, reactEffects } = loadWithSection()
  reactEffects.length = 0
  render(module, { status: 'loading', data: null, error: null })
  const effect = reactEffects[0]
  assert.equal(typeof effect, 'function', 'the component should register a fetch effect')

  const calls = []
  const realFetch = globalThis.fetch
  const realClear = globalThis.clearInterval
  let cleared = 0
  globalThis.fetch = (url, options) => {
    calls.push({ url, options })
    return Promise.resolve({ ok: true, json: () => Promise.resolve(payload()) })
  }
  globalThis.clearInterval = (timer) => {
    cleared += 1
    return realClear(timer)
  }
  try {
    // The shim does not run effects on its own, so run it by hand.
    const dispose = effect()
    assert.deepEqual(calls.map((call) => call.url), ['/api/token-ledger/summary'])
    assert.equal(calls[0].options.cache, 'no-store')
    assert.equal(typeof dispose, 'function')
    dispose()
    assert.equal(cleared, 1, 'the polling timer must be cleared on unmount')
  } finally {
    globalThis.fetch = realFetch
    globalThis.clearInterval = realClear
  }
})

test('a failed fetch is reported through the state setter', async () => {
  const { module, reactEffects } = loadWithSection()
  reactEffects.length = 0
  render(module, { status: 'loading', data: null, error: null })
  const effect = reactEffects[0]

  const realFetch = globalThis.fetch
  globalThis.fetch = () => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) })
  let dispose
  try {
    dispose = effect()
    // Let the promise chain settle: the component's own catch sets the state.
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(module.recorder.setState?.status, 'error')
    assert.match(module.recorder.setState?.error ?? '', /503/)
  } finally {
    // The effect arms a polling interval; leaving it running would keep the
    // test process alive forever.
    if (typeof dispose === 'function') dispose()
    globalThis.fetch = realFetch
  }
})

/* ------------------------------------------------------------------- rates -- */

/**
 * A ready rates payload.
 *
 * The fixture is built so every claim the view makes has one unambiguous
 * answer: one vendor with a fetched row and a hand-entered row, one vendor that
 * exists only because someone typed it, prices spanning five orders of
 * magnitude, and a rate that was fetched rather than typed.
 *
 * @param {object} [overrides] - fields to replace.
 * @returns {object} the payload.
 */
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
          {
            id: 'acme/flagship',
            name: 'Acme Flagship',
            vendor: 'acme',
            created: 200,
            contextLength: 128000,
            prices: { input: 2.5, output: 75, cacheRead: 0.15, cacheWrite: 0.0002 },
            source: 'manual',
          },
          {
            id: 'acme/mini',
            name: 'Acme Mini',
            vendor: 'acme',
            created: 100,
            contextLength: 32000,
            prices: { input: 0.25, output: 1, cacheRead: null, cacheWrite: null },
            source: 'fetched',
          },
        ],
      },
      {
        vendor: '',
        modelCount: 1,
        manualOnly: true,
        models: [
          { id: 'deepseek/deepseek-chat', name: 'deepseek/deepseek-chat', vendor: '', created: null, contextLength: null, prices: { input: 0.27, output: 1.1, cacheRead: null, cacheWrite: null }, source: 'manual' },
        ],
      },
    ],
    ...overrides,
  }
}

/**
 * Render the section on the rates view with a given state.
 *
 * The hook order is range, view, overview state, tab, rates state.
 *
 * @param {object} module - the loaded client module.
 * @param {object} state - the rates fetch state.
 * @returns {{ tree: unknown, text: string[] }} the render.
 */
function renderRates(module, state) {
  const priming = module.priming
  priming.length = 0
  priming.push(DEFAULT, DEFAULT, { status: 'ready', data: payload(), error: null }, 'rates', state)
  const tree = expand(module.__section({ t: fakeT() }))
  priming.length = 0
  return { tree, text: collectText(tree) }
}

test('the section offers a tab per view and shows the overview first', () => {
  const { module } = loadWithSection()
  const priming = module.priming
  priming.length = 0
  priming.push(DEFAULT, DEFAULT, { status: 'ready', data: payload(), error: null })
  const tree = expand(module.__section({ t: fakeT() }))
  priming.length = 0
  const text = collectText(tree)
  assert.ok(hasText(text, 'tabOverview'), 'the overview tab is offered')
  assert.ok(hasText(text, 'tabRates'), 'the rates tab is offered')
  // The overview is what a reader lands on: its own title, not the rates one.
  assert.ok(hasText(text, 'title'))
  assert.ok(!hasText(text, 'ratesTitle'), 'the rates view is not rendered until it is chosen')
})

test('the rates view shows the live rate, its source and the per-million unit', () => {
  const { module } = loadWithSection()
  const { text } = renderRates(module, { status: 'ready', data: ratesPayload(), error: null })
  assert.ok(hasText(text, 'fxTitle'))
  assert.ok(hasText(text, '1 USD ='), 'the pair is written out')
  assert.ok(hasText(text, '7.1234'), 'the rate is shown to four decimals')
  assert.ok(hasText(text, 'CNY'))
  assert.ok(hasText(text, 'open.er-api.com'), 'the source host is named')
  assert.ok(hasText(text, 'fxHint'), 'the page says it computes no cost')
  assert.ok(hasText(text, 'perMillionCny'), 'prices are labelled per million tokens, in the quote currency')
})

test('prices are converted into the quote currency, with the quote a hover away', () => {
  const { module } = loadWithSection()
  const { tree, text } = renderRates(module, { status: 'ready', data: ratesPayload(), error: null })
  // 2.5 / 75 / 0.15 / 0.0002 USD per million tokens at 7.1234.
  assert.ok(hasText(text, '¥17.81'))
  assert.ok(hasText(text, '¥534.25'))
  assert.ok(hasText(text, '¥1.07'))
  // A converted column is shown in cents, so a price that cents would erase keeps
  // two significant digits instead of becoming `¥0.00`, and the column's other cells
  // pad to that same width.
  assert.ok(hasText(text, '¥0.0014'), 'a hundredth of a cent is not rounded away')
  assert.ok(!hasText(text, '$75'), 'the table does not mix currencies')
  // The served value is USD, so every converted cell keeps its original one
  // hover away: the page never shows a number it cannot trace.
  const titles = findAllByClass(tree, 'tl-rate-price')
    .map((cell) => cell.props.title)
    .filter((title) => typeof title === 'string')
  assert.ok(titles.includes('priceUsdHint $75'), JSON.stringify(titles))
  assert.ok(titles.includes('priceUsdHint $0.0002'))
  // An unpublished price is a dash, which is not the same claim as free.
  assert.ok(hasText(text, '—'))
})

test('with no rate the table falls back to USD and says why', () => {
  const { module } = loadWithSection()
  const noRate = ratesPayload({
    fx: { available: false, rate: null, base: 'USD', quote: 'CNY', source: 'https://open.er-api.com/v6/latest/USD', fetchedAt: null, ageMs: null, overridden: false },
  })
  const { tree, text } = renderRates(module, { status: 'ready', data: noRate, error: null })
  assert.ok(hasText(text, '$75'), 'an unconvertible price stays in the currency it was quoted in')
  assert.ok(hasText(text, '$0.0002'))
  assert.ok(!hasText(text, '¥534.25'))
  assert.ok(hasText(text, 'noRateForPrices'))
  assert.ok(hasText(text, 'perMillionUsd'), 'the unit label follows the currency actually shown')
  // ...and no cell claims a conversion it never made.
  const titles = findAllByClass(tree, 'tl-rate-price').map((cell) => cell.props.title)
  assert.ok(titles.every((title) => title === undefined), JSON.stringify(titles))
})

test('every vendor gets a mark, and it is the vendor’s own', () => {
  const { module } = loadWithSection()
  const curated = ratesPayload({
    vendors: [
      {
        vendor: 'deepseek',
        modelCount: 18,
        models: [
          {
            id: 'deepseek/deepseek-chat',
            name: 'DeepSeek Chat',
            vendor: 'deepseek',
            created: 1,
            contextLength: 128000,
            prices: { input: 10, output: 50, cacheRead: null, cacheWrite: null },
            source: 'fetched',
          },
        ],
      },
    ],
  })
  const { tree, text } = renderRates(module, { status: 'ready', data: curated, error: null })
  const marks = findAllByClass(tree, 'tl-logo')
  assert.equal(marks.length, 1)
  // The mark is the vendor's own document, injected whole rather than rebuilt from
  // its paths — keeping only the geometry is exactly what made three marks render
  // wrong (a dropped `<g transform>`, dropped CSS classes, dropped clip paths).
  const injected = marks[0].props.dangerouslySetInnerHTML?.__html ?? ''
  assert.ok(injected.startsWith('<svg '), 'the mark is an SVG document')
  assert.match(injected, /viewBox="0 0 24 24"/)
  assert.match(injected, /fill="#5786FE"/, 'DeepSeek keeps the brand colour the vendor publishes')
  assert.ok(injected.length > 1000, 'and the real outline, not a letter')
  assert.ok(!injected.includes('<script'), 'a bundled asset, but not one that can run anything')
  // The name is the vendor's own spelling, not the source key.
  assert.ok(hasText(text, 'DeepSeek'), 'the display name is capitalised the way the vendor writes it')
  assert.ok(!hasText(text, 'deepseek ('))

  // A vendor with no bundled mark still gets something, or the leading column
  // looks broken; the hand-entered group is marked as what it is.
  const { tree: mixed } = renderRates(module, { status: 'ready', data: ratesPayload(), error: null })
  const all = findAllByClass(mixed, 'tl-logo')
  assert.equal(all.length, 2, 'one per vendor group')
  assert.deepEqual(collectText(all[0]), ['AC'], 'an unknown vendor falls back to its letters')
  assert.match(all[0].props.style.background, /^#[0-9a-f]{6}$/)
  assert.deepEqual(collectText(all[1]), ['··'], 'the hand-entered group carries no brand')
})

test('every bundled mark is the vendor’s own document and survives intact', () => {
  // The regression this exists for: keeping only `<path d>` rendered three marks
  // wrong — Tencent's sits inside a flipped `<g transform>`, Z.ai's fills live in
  // CSS classes, OpenAI's uses a clip path over a background rect. So the checks
  // are structural: whatever a vendor's own file needs to draw itself has to still
  // be there, and the markup has to stay well formed after sanitizing.
  const vendors = ['openai', 'anthropic', 'google', 'deepseek', 'qwen', 'x-ai', 'z-ai', 'kimi', 'minimax', 'tencent', 'xiaomi', 'bytedance']
  const payload = ratesPayload({
    vendors: vendors.map((vendor) => ({
      vendor,
      modelCount: 1,
      models: [
        {
          id: `${vendor}/one`,
          name: `${vendor} one`,
          vendor,
          created: null,
          contextLength: null,
          prices: { input: 1, output: 2, cacheRead: null, cacheWrite: null },
          source: 'fetched',
        },
      ],
    })),
  })
  const { module } = loadWithSection()
  const tree = renderRatesView(module, { status: 'ready', data: payload, error: null }, [], {})
  const marks = findAllByClass(tree, 'tl-logo').filter((element) => element.props.className === 'tl-logo')
  assert.equal(marks.length, vendors.length, 'one mark per vendor')

  const markup = new Map(vendors.map((vendor, index) => [vendor, marks[index].props.dangerouslySetInnerHTML?.__html ?? '']))
  for (const [vendor, svg] of markup) {
    assert.ok(svg.startsWith('<svg '), `${vendor}: is an SVG document`)
    assert.match(svg, /viewBox="[^"]+"/, `${vendor}: has a viewBox so it scales to its tile`)
    // The root must not pin a size: the tile decides it. (A `<rect width>` deeper
    // in the document is geometry, not a size.)
    const rootTag = /^<svg[^>]*>/.exec(svg)[0]
    assert.ok(
      !/\swidth="\d+(\.\d+)?(pt|px)?"/.test(rootTag) && !/\sheight="\d+(\.\d+)?(pt|px)?"/.test(rootTag),
      `${vendor}: the root has no absolute size`,
    )
    assert.ok(!svg.includes('<style'), `${vendor}: no stylesheet that would leak into the page`)
    assert.ok(!svg.includes('<script') && !/\son[a-z]+=/i.test(svg), `${vendor}: nothing executable`)

    // Well-formedness, roughly: every element that is not self-closed is closed.
    const opened = [...svg.matchAll(/<([a-zA-Z][\w:-]*)(?:\s[^>]*?)?(\/?)>/g)]
    const stack = []
    for (const [, name, selfClosed] of opened) {
      if (selfClosed === '/') continue
      if (name === 'svg') stack.push(name)
    }
    const closes = [...svg.matchAll(/<\/([a-zA-Z][\w:-]*)>/g)].map((match) => match[1])
    for (const name of [...opened].map((match) => match[1])) {
      if (['path', 'rect', 'circle', 'polygon', 'polyline', 'line', 'use', 'stop', 'image'].includes(name)) continue
      const openCount = [...svg.matchAll(new RegExp(`<${name}(?:\\s|>)`, 'g'))].length
      const closeCount = closes.filter((closed) => closed === name).length
      assert.equal(openCount, closeCount, `${vendor}: <${name}> tags balance`)
    }
  }

  // The three that were wrong, checked for the specific thing each one needed.
  assert.match(markup.get('tencent'), /transform="[^"]*scale\(/, 'Tencent keeps its flipped group transform')
  assert.match(markup.get('z-ai'), /class="|clip-path="|stroke="/, 'Z.ai keeps the attributes its fills depend on')
  assert.match(markup.get('openai'), /<clipPath/, 'OpenAI keeps its clip paths')
  assert.match(markup.get('openai'), /<rect[^>]*rx=/, 'and the background it draws the knot on')
  assert.ok(!markup.get('tencent').includes('fill="#ffffff"'), 'Tencent is not left white-on-white')
  assert.match(markup.get('deepseek'), /fill="#5786FE"/, 'DeepSeek keeps its blue')
})

test('a vendor priced from its own page says so, and a dataset vendor does not', () => {
  const { module } = loadWithSection()
  const mixed = ratesPayload({
    vendors: [
      {
        vendor: 'deepseek',
        modelCount: 2,
        source: 'vendor',
        sourceUrl: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',
        currency: 'CNY',
        note: '北京时间周一至周五 9:00 - 12:00、14:00 - 18:00（其余为空闲时段）',
        models: [
          { id: 'deepseek/deepseek-flash@peak', name: 'DeepSeek-V4.1-Flash', vendor: 'deepseek', created: null, contextLength: null, prices: { input: 2, output: 8, cacheRead: 0.04, cacheWrite: null }, period: 'peak', source: 'vendor' },
          { id: 'deepseek/deepseek-flash@offPeak', name: 'DeepSeek-V4.1-Flash', vendor: 'deepseek', created: null, contextLength: null, prices: { input: 1, output: 4, cacheRead: 0.02, cacheWrite: null }, period: 'offPeak', source: 'vendor' },
        ],
      },
      {
        vendor: 'google',
        modelCount: 1,
        source: 'dataset',
        models: [
          { id: 'google/gemini-3.8-flash', name: 'Gemini 3.8 Flash', vendor: 'google', created: null, contextLength: null, prices: { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: null }, source: 'fetched' },
        ],
      },
    ],
  })
  const { tree, text } = renderRates(module, { status: 'ready', data: mixed, error: null })

  // One badge for the vendor whose own page was read, and none for the other.
  // Scoped to the vendor groups, because the rate box carries a badge of its own
  // and `tl-vendor` alone also matches the head, the name and the count.
  const groups = findAllByClass(tree, 'tl-vendor').filter((element) => element.props.className === 'tl-vendor')
  assert.equal(groups.length, 2)
  assert.equal(countByClass(groups[0], 'tl-badge'), 1, 'the vendor-priced group is marked')
  assert.equal(countByClass(groups[1], 'tl-badge'), 0, 'the dataset-priced group makes no such claim')
  assert.ok(hasText(text, 'sourceOfficial'))
  // The vendor's own wording for the charging window is shown as written.
  assert.ok(hasText(text, '北京时间周一至周五'), 'the window is the vendor’s own sentence')
  // Both periods are rows, labelled, because they are two prices for one model.
  const rows = findAllByClass(tree, 'tl-rate-row')
  assert.equal(rows.length, 3)
  assert.equal(rows[0].props['data-period'], 'peak')
  assert.equal(rows[1].props['data-period'], 'offPeak')
  assert.equal(rows[2].props['data-period'], '')
  assert.ok(hasText(text, 'periodPeak') && hasText(text, 'periodOffPeak'))
  // The label is a sibling of the name, not a child of it. The name span is the one
  // that clips, so a label drawn inside it was cut down to a single character on a
  // long id — the DeepSeek rows, which are exactly the rows the label is for.
  const nameCell = rows[0].children[0]
  assert.equal(String(nameCell.props?.className ?? ''), 'tl-rate-model', 'the name cell leads the row')
  assert.equal(countByClass(nameCell, 'tl-period'), 1, 'the label sits in the name cell')
  assert.equal(countByClass(findByClass(nameCell, 'tl-rate-name'), 'tl-period'), 0, 'and outside the name that clips')
  // A yuan price is shown as published: a vendor that quotes in yuan is already
  // in the display currency, so 2 is 2 and not 2 × rate.
  assert.ok(hasText(text, '¥2'), 'the vendor’s own number, unconverted')
  assert.ok(hasText(text, '¥4'), 'and the off-peak number beside it')
  assert.ok(!hasText(text, '¥14.25'), 'nothing was converted')
  // The dataset vendor is still converted with the rate in the box (7.1234 here).
  assert.ok(hasText(text, '¥5.34'), 'Gemini at 0.75 USD becomes 5.34 CNY')
})

test('one column has one precision, so 0.04 and 0.30 line up', () => {
  // The reported problem: DeepSeek's cache-read column read 0.04 / 0.02 / 0.3 /
  // 0.15, where the 0.3 broke the column's scale. A price list is read down a
  // column, so the column's widest cell decides its precision and the rest pad.
  const { module } = loadWithSection()
  const deepseek = ratesPayload({
    vendors: [
      {
        vendor: 'deepseek',
        modelCount: 4,
        source: 'vendor',
        currency: 'CNY',
        models: [
          { id: 'deepseek/flash@peak', name: 'DeepSeek-V4.1-Flash', vendor: 'deepseek', created: null, contextLength: null, prices: { input: 2, output: 8, cacheRead: 0.04, cacheWrite: null }, period: 'peak', source: 'vendor' },
          { id: 'deepseek/flash@offPeak', name: 'DeepSeek-V4.1-Flash', vendor: 'deepseek', created: null, contextLength: null, prices: { input: 1, output: 4, cacheRead: 0.02, cacheWrite: null }, period: 'offPeak', source: 'vendor' },
          { id: 'deepseek/pro@peak', name: 'DeepSeek-V4-Pro-0813', vendor: 'deepseek', created: null, contextLength: null, prices: { input: 9, output: 27, cacheRead: 0.3, cacheWrite: null }, period: 'peak', source: 'vendor' },
          { id: 'deepseek/pro@offPeak', name: 'DeepSeek-V4-Pro-0813', vendor: 'deepseek', created: null, contextLength: null, prices: { input: 4.5, output: 13.5, cacheRead: 0.15, cacheWrite: null }, period: 'offPeak', source: 'vendor' },
        ],
      },
    ],
  })
  const { tree, text } = renderRates(module, { status: 'ready', data: deepseek, error: null })

  // The cache-read column takes two decimals, because 0.04 and 0.02 need two.
  for (const value of ['¥0.04', '¥0.02', '¥0.30', '¥0.15']) assert.ok(hasText(text, value), `missing ${value}`)
  // The input column needs one decimal for 4.5, so the whole column takes one.
  for (const value of ['¥2.0', '¥1.0', '¥9.0', '¥4.5']) assert.ok(hasText(text, value), `missing ${value}`)
  // Output needs one as well, for 13.5.
  for (const value of ['¥8.0', '¥4.0', '¥27.0', '¥13.5']) assert.ok(hasText(text, value), `missing ${value}`)

  // Every row is written to the same width in a given column.
  const rows = findAllByClass(tree, 'tl-rate-row')
  assert.deepEqual(rows.map((row) => collectText(row.children[3])), [['¥0.04'], ['¥0.02'], ['¥0.30'], ['¥0.15']])
  assert.deepEqual(rows.map((row) => collectText(row.children[1])), [['¥2.0'], ['¥1.0'], ['¥9.0'], ['¥4.5']])
  // A column with no price at all stays a dash rather than becoming `¥0.00`.
  // The cells are name, input, output, cache read, cache write, actions.
  assert.deepEqual(rows.map((row) => collectText(row.children[4])), [['—'], ['—'], ['—'], ['—']])
})

test('a column’s padding does not follow the quote into the tooltip', () => {
  // The tooltip answers "what did the vendor quote?", which is one number rather
  // than a column, so it keeps the vendor's own precision.
  const { module } = loadWithSection()
  const { tree } = renderRates(module, { status: 'ready', data: ratesPayload(), error: null })
  const titles = findAllByClass(tree, 'tl-rate-price').map((cell) => cell.props.title)
  assert.ok(titles.includes('priceUsdHint $75'), JSON.stringify(titles))
  assert.ok(titles.includes('priceUsdHint $0.0002'), 'the vendor’s own number, not padded to the column')
})

test('the model-name column has a floor, and a table too wide for the pane scrolls', () => {
  // The reported bug: with a fixed 470px of price and action columns, a narrow
  // panel left the name column zero pixels wide and the table showed prices for a
  // model nobody could identify. The fix is a floor on the name column plus a
  // scrolling list, so both halves are pinned here — and the floor is worth more
  // than the prices, which is why the name column is the flexible one.
  const source = readFileSync(fileURLToPath(new URL('../lib/client.js', import.meta.url)), 'utf8')
  const grid = /\.tl-rate-head, \.tl-rate-row \{ display: grid; grid-template-columns: minmax\((\d+)px, 1fr\) repeat\(4, minmax\((\d+)px, (\d+)px\)\) (\d+)px; align-items: center; gap: (\d+)px/.exec(source)
  assert.ok(grid !== null, 'the row geometry is declared in one place')
  const floor = Number(grid[1])
  const priceMin = Number(grid[2])
  const priceMax = Number(grid[3])
  const actions = Number(grid[4])
  const gap = Number(grid[5])
  assert.ok(floor >= 150, `the name column must keep room for a real model name, saw ${floor}px`)
  // The price tracks are declared as a range, and the range is the point: the
  // table narrows down to its floor before it scrolls, so a panel a little too
  // small for the full width loses input pixels rather than growing a scrollbar.
  assert.ok(priceMax >= 64, `a price column must fit a converted price, saw ${priceMax}px`)
  assert.ok(priceMin < priceMax, 'the price columns have to be able to give way')
  // The declared minimum has to cover the narrowest the columns can be, or the row
  // overflows its own box and the scroll width lies about what is hidden.
  const declared = Number(/\.tl-rate-table \{ min-width: (\d+)px/.exec(source)?.[1])
  assert.equal(declared, floor + 4 * priceMin + actions + 5 * gap, 'the table minimum matches its columns')
  assert.match(source, /\.tl-rates-list \{[^}]*overflow: auto/, 'a pane narrower than the table can still be scrolled sideways')
  // And the list is not a box of its own: it used to cap its height at 460px, which
  // put a second scrollbar inside the card, next to the settings panel's own.
  assert.doesNotMatch(source, /\.tl-rates-list \{[^}]*max-height/, 'the list grows with its contents and the panel scrolls')

  const { module } = loadWithSection()
  const { tree } = renderRates(module, { status: 'ready', data: ratesPayload(), error: null })
  assert.equal(countByExactClass(tree, 'tl-rate-table'), 2, 'the header and its rows stay in one table')
})

test('each vendor group lists its models with a column per price', () => {
  const { module } = loadWithSection()
  const { tree, text } = renderRates(module, { status: 'ready', data: ratesPayload(), error: null })
  assert.equal(countByExactClass(tree, 'tl-vendor'), 2)
  assert.equal(countByClass(tree, 'tl-rate-row'), 3)
  assert.equal(countByExactClass(tree, 'tl-rate-head'), 2, 'each group carries its own column header')
  // Four price columns per header row: input, output, cache read, cache write.
  const header = findByClass(tree, 'tl-rate-head')
  assert.equal(header.children.length, 6, 'model, four prices, actions')
  for (const key of ['priceInput', 'priceOutput', 'priceCacheRead', 'priceCacheWrite']) {
    assert.ok(hasText(text, key), `missing ${key}`)
  }
  assert.ok(hasText(text, 'Acme'), 'the vendor name is capitalised for display')
  assert.ok(hasText(text, 'Acme Flagship'))
  assert.ok(hasText(text, 'deepseek/deepseek-chat'))
  // The vendor-less group is named after what it is rather than left blank.
  assert.ok(hasText(text, 'manualGroup'))
})

test('a hand-entered row is marked, and only such a row can be cleared', () => {
  const { module } = loadWithSection()
  const { tree, text } = renderRates(module, { status: 'ready', data: ratesPayload(), error: null })
  assert.equal(countByClass(tree, 'tl-badge'), 3, 'the rate badge plus one per hand-entered row')
  const manualRows = []
  const walk = (node) => {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) return node.forEach(walk)
    if (node.props?.['data-manual'] === 'true') manualRows.push(node)
    walk(node.children ?? [])
  }
  walk(tree)
  assert.equal(manualRows.length, 2, 'the typed price and the manual-only vendor row')
  // The mark reads as part of the model's name, so it belongs in the first cell
  // rather than out among the buttons.
  const nameCell = manualRows[0].children[0]
  assert.equal(String(nameCell.props?.className ?? ''), 'tl-rate-model', 'the name cell leads the row')
  assert.equal(countByClass(nameCell, 'tl-badge'), 1, 'the badge sits with the name')
  assert.equal(countByClass(manualRows[0].children[manualRows[0].children.length - 1], 'tl-badge'), 0, 'and not with the actions')
  assert.ok(hasText(text, 'edit'), 'every row can be edited')
  assert.ok(hasText(text, 'clear'), 'a hand-entered row can be handed back')
})

test('an offline host is told so, and offered hand entry instead', () => {
  const { module } = loadWithSection()
  const offline = ratesPayload({
    catalogue: { available: false, fetchedAt: null, ageMs: null, source: 'https://openrouter.ai/api/v1/models', totalAvailable: null, modelCount: 0, vendorCount: 0 },
    fx: { available: false, rate: null, base: 'USD', quote: 'CNY', source: 'https://open.er-api.com/v6/latest/USD', fetchedAt: null, ageMs: null, overridden: false },
    vendors: [],
    lastRefresh: { at: Date.now(), ageMs: 1000, catalogue: 'failed (timeout after 20000ms)', fx: 'failed (getaddrinfo ENOTFOUND)' },
  })
  const { text } = renderRates(module, { status: 'ready', data: offline, error: null })
  assert.ok(hasText(text, 'neverFetched'))
  assert.ok(hasText(text, 'neverFetchedHint'))
  assert.ok(hasText(text, 'ratesEmpty'))
  assert.ok(hasText(text, 'fxNone'), 'the rate is marked as never fetched')
  // The manual form is present regardless: it is the offline path, not an error
  // state, and the page must be usable with no network at all.
  assert.ok(hasText(text, 'manualFormTitle'))
  assert.ok(hasText(text, 'modelId'))
})

test('the manual entry form names every field it can set', () => {
  const { module } = loadWithSection()
  const { tree } = renderRates(module, { status: 'ready', data: ratesPayload(), error: null })
  const form = findByClass(tree, 'tl-manual-form')
  assert.ok(form !== null, 'the rates view offers hand entry')
  // Counted by label rather than by the field wrapper: the model-id field
  // carries `tl-field tl-manual-id` so it can span the form's first row, and
  // an exact-class count of `tl-field` would miss it.
  assert.equal(countByExactClass(form, 'tl-field-label'), 5, 'a model id and four prices')
  const text = collectText(form)
  assert.ok(hasText(text, 'modelId'))
  for (const key of ['priceInput', 'priceOutput', 'priceCacheRead', 'priceCacheWrite']) {
    assert.ok(hasText(text, key), `missing ${key} in the manual form`)
  }
})

test('a zero price is marked, because ¥0 is not the same claim as free', () => {
  const { module } = loadWithSection()
  const withZero = ratesPayload({
    vendors: [
      {
        vendor: 'nvidia',
        modelCount: 2,
        models: [
          { id: 'nvidia/nemotron-3.5', name: 'Nemotron 3.5', vendor: 'nvidia', created: 1, contextLength: null, prices: { input: 0, output: 0, cacheRead: null, cacheWrite: null }, source: 'fetched', zero: true },
          { id: 'nvidia/priced', name: 'Priced', vendor: 'nvidia', created: 1, contextLength: null, prices: { input: 0.1, output: 0.4, cacheRead: null, cacheWrite: null }, source: 'fetched' },
        ],
      },
    ],
  })
  const { tree, text } = renderRates(module, { status: 'ready', data: withZero, error: null })
  assert.ok(hasText(text, 'zeroPriceNote'), 'the page explains what a zero means')
  const rows = findAllByClass(tree, 'tl-rate-row')
  assert.equal(rows[0].props['data-zero'], 'true')
  assert.equal(rows[1].props['data-zero'], 'false', 'only an all-zero row is marked')
  assert.ok(rows[0].children.some((child) => String(child.props?.title ?? '').includes('zeroPriceHint')))

  // A table with no zero rows says nothing about zeros.
  const { text: clean } = renderRates(module, { status: 'ready', data: ratesPayload(), error: null })
  assert.ok(!hasText(clean, 'zeroPriceNote'))
})

test('the page says which prices these are, because the two sources claim different things', () => {
  const { module } = loadWithSection()
  // The default source prices each vendor's own models.
  const vendor = renderRates(module, { status: 'ready', data: ratesPayload(), error: null })
  assert.ok(hasText(vendor.text, 'sourceVendorPrices'))
  assert.ok(!hasText(vendor.text, 'sourceGatewayPrices'), 'the two claims are not both shown')

  // A gateway quote is a different claim, and has to be named as one.
  const gateway = renderRates(module, { status: 'ready', data: ratesPayload({ priceSource: 'openrouter' }), error: null })
  assert.ok(hasText(gateway.text, 'sourceGatewayPrices'))
  assert.ok(!hasText(gateway.text, 'sourceVendorPrices'))

  // Nothing to attribute when nothing arrived.
  const offline = renderRates(module, {
    status: 'ready',
    error: null,
    data: ratesPayload({
      catalogue: { available: false, fetchedAt: null, ageMs: null, source: 'https://models.dev/api.json', totalAvailable: null, modelCount: 0, vendorCount: 0 },
      vendors: [],
    }),
  })
  assert.ok(!hasText(offline.text, 'sourceVendorPrices'))
  assert.ok(!hasText(offline.text, 'sourceGatewayPrices'))
})

test('a stale rates read keeps showing the previous payload with a note', () => {
  const { module } = loadWithSection()
  const { text } = renderRates(module, { status: 'stale', data: ratesPayload(), error: 'network' })
  assert.ok(hasText(text, 'stale'))
  assert.ok(hasText(text, '7.1234'), 'the previous payload is still rendered')
})

test('an unreachable rates route explains itself instead of throwing', () => {
  const { module } = loadWithSection()
  const { text } = renderRates(module, { status: 'error', data: null, error: 'HTTP 404' })
  assert.ok(hasText(text, 'unavailable'))
  assert.ok(hasText(text, 'ratesUnavailableReason'))
  assert.ok(hasText(text, 'HTTP 404'))
})

test('a save reports its outcome, and a failure reports why', () => {
  const { module } = loadWithSection()
  const saved = renderRates(module, { status: 'ready', data: ratesPayload(), error: null, notice: { ok: true, text: 'saved' } })
  assert.ok(hasText(saved.text, 'saved'))
  const failed = renderRates(module, {
    status: 'ready',
    data: ratesPayload(),
    error: null,
    notice: { ok: false, text: 'saveFailed: fx.rate must be a positive number' },
  })
  assert.ok(hasText(failed.text, 'saveFailed'))
  assert.ok(hasText(failed.text, 'fx.rate must be a positive number'))
})

test('a rates payload missing every optional field still renders', () => {
  const { module } = loadWithSection()
  const { text } = renderRates(module, { status: 'ready', data: { plugin: 'token-ledger' }, error: null })
  assert.ok(hasText(text, 'fxTitle'))
  assert.ok(hasText(text, '—'))
  assert.ok(hasText(text, 'ratesEmpty'))
})

/**
 * Render the rates view on its own, with its draft hooks primed.
 *
 * The view is rendered directly rather than through the section so a test can
 * hand it a recorder and click what a user would click.
 *
 * @param {object} module - the loaded client module.
 * @param {object} state - the rates state.
 * @param {object[]} sent - a recorder for the patches the view sends.
 * @param {{ filter?: unknown, fxDraft?: unknown, editing?: unknown, draft?: unknown }} [hooks] - primed drafts.
 * @returns {unknown} the expanded tree.
 */
function renderRatesView(module, state, sent, hooks = {}) {
  const priming = module.priming
  priming.length = 0
  priming.push(hooks.filter ?? DEFAULT, hooks.fxDraft ?? DEFAULT, hooks.editing ?? DEFAULT, hooks.draft ?? DEFAULT)
  const tree = expand(module.exports.RatesView({ t: fakeT(), state, onPatch: (patch) => sent.push(patch) }))
  priming.length = 0
  return tree
}

/**
 * The rendered row of a fixture model, found by the name it displays.
 *
 * @param {unknown} tree - the expanded tree.
 * @param {string} name - the display name.
 * @returns {object|undefined} the row.
 */
function findRow(tree, name) {
  return findAllByClass(tree, 'tl-rate-row').find((element) => collectText(element).includes(name))
}

test('the row editor shows the quote currency and sends the stored one', () => {
  const { module } = loadWithSection()
  const sent = []
  // The table shows ¥, so the editor is filled in ¥ and the host is handed USD:
  // 71.234 ¥ and 1.06851 ¥ are exactly 10 and 0.15 USD at the fixture's rate.
  const tree = renderRatesView(module, { status: 'ready', data: ratesPayload(), error: null }, sent, {
    editing: { id: 'acme/flagship', input: '71.234', output: '', cacheRead: '1.06851', cacheWrite: '', invalid: false },
  })
  const row = findRow(tree, 'Acme Flagship')
  assert.ok(row !== undefined, 'the edited row is rendered')
  const save = findButtons(row, 'save')
  assert.equal(save.length, 1, 'an edited row offers one save button')
  assert.equal(save[0].props.disabled, false)
  save[0].props.onClick()
  assert.deepEqual(sent, [{ models: { 'acme/flagship': { input: 10, output: null, cacheRead: 0.15, cacheWrite: null } } }])
})

test('opening the editor fills it with the displayed currency, not the stored one', () => {
  const { module } = loadWithSection()
  const tree = renderRatesView(module, { status: 'ready', data: ratesPayload(), error: null }, [], {})
  findButtons(findRow(tree, 'Acme Flagship'), 'edit')[0].props.onClick()
  // Typing into the editor must not mean typing USD while the table shows ¥, so
  // the draft is the converted value — and the stored one is 2.5 USD per million.
  const draft = module.recorder.setState
  assert.equal(draft.id, 'acme/flagship')
  assert.equal(draft.input, '17.8085')
  assert.equal(draft.output, '534.255')
  assert.equal(draft.cacheRead, '1.06851')
  assert.equal(draft.cacheWrite, '0.001425')
  assert.equal(draft.invalid, false)
})

test('empty every price and the row goes back to the fetched values', () => {
  const { module } = loadWithSection()
  const sent = []
  const tree = renderRatesView(module, { status: 'ready', data: ratesPayload(), error: null }, sent, {
    editing: { id: 'acme/flagship', input: '', output: '', cacheRead: '', cacheWrite: '', invalid: false },
  })
  findButtons(findRow(tree, 'Acme Flagship'), 'save')[0].props.onClick()
  // Not a row of dashes: the override is removed, so the fetched prices return.
  assert.deepEqual(sent, [{ models: { 'acme/flagship': null } }])
})

test('a price that is not a number is refused in place, without sending', () => {
  const { module } = loadWithSection()
  const sent = []
  const tree = renderRatesView(module, { status: 'ready', data: ratesPayload(), error: null }, sent, {
    editing: { id: 'acme/flagship', input: 'abc', output: '', cacheRead: '', cacheWrite: '', invalid: false },
  })
  findButtons(findRow(tree, 'Acme Flagship'), 'save')[0].props.onClick()
  assert.deepEqual(sent, [], 'nothing is sent to the host')
})

test('the manual form needs a model id and at least one price', () => {
  const { module } = loadWithSection()
  const sent = []
  const state = { status: 'ready', data: ratesPayload(), error: null }

  const empty = renderRatesView(module, state, sent, { draft: { id: '', input: '', output: '', cacheRead: '', cacheWrite: '' } })
  assert.equal(findButtons(findByClass(empty, 'tl-manual-form'), 'save')[0].props.disabled, true, 'an empty form cannot be submitted')

  const idOnly = renderRatesView(module, state, sent, { draft: { id: 'my-vendor/my-model', input: '', output: '', cacheRead: '', cacheWrite: '' } })
  assert.equal(findButtons(findByClass(idOnly, 'tl-manual-form'), 'save')[0].props.disabled, true, 'a row of dashes is not worth creating')

  const ready = renderRatesView(module, state, sent, { draft: { id: 'my-vendor/my-model', input: '3.5617', output: '', cacheRead: '', cacheWrite: '' } })
  const readySave = findButtons(findByClass(ready, 'tl-manual-form'), 'save')[0]
  assert.equal(readySave.props.disabled, false)
  readySave.props.onClick()
  // Typed as ¥3.5617, stored as the $0.5 it is worth at the shown rate.
  assert.deepEqual(sent, [{ models: { 'my-vendor/my-model': { input: 0.5, output: null, cacheRead: null, cacheWrite: null } } }])
})

test('the rate box sends the typed rate, and refuses a blank one', () => {
  const { module } = loadWithSection()
  const sent = []
  const state = { status: 'ready', data: ratesPayload(), error: null }

  const editing = renderRatesView(module, state, sent, { fxDraft: '7.05' })
  const editSave = findButtons(editing, 'save')[0]
  assert.equal(editSave.props.disabled, false)
  editSave.props.onClick()
  assert.deepEqual(sent, [{ fx: { rate: 7.05 } }])

  // A blank box is refused rather than sent as zero.
  const blank = renderRatesView(module, state, sent, { fxDraft: '' })
  const blankSave = findButtons(blank, 'save')[0]
  assert.equal(blankSave.props.disabled, true, 'a blank rate cannot be saved')
  blankSave.props.onClick()
  assert.equal(sent.length, 1, 'nothing further was sent')
})

test('the refresh button asks the host to go and fetch', () => {
  const { module } = loadWithSection()
  const sent = []
  const make = (extra) =>
    expand(
      module.exports.RatesView({
        t: fakeT(),
        state: { status: 'ready', data: ratesPayload(), error: null, saving: false, notice: null, action: null, ...extra },
        onPatch: (...args) => sent.push(args),
      }),
    )

  const button = findButtons(make({}), 'refreshNow')[0]
  assert.equal(button.props.disabled, false)
  button.props.onClick()
  assert.deepEqual(sent, [[{ refresh: true }, 'refreshed', 'refresh']])

  // The fetch reads vendor pages one at a time, so the button that was pressed
  // is the one that reports progress — and cannot be pressed twice.
  const busy = findButtons(make({ saving: true, action: 'refresh' }), 'refreshing')
  assert.equal(busy.length, 1)
  assert.equal(busy[0].props.disabled, true)
})

test('each review answer names the fields it settles, and the host supplies the price', () => {
  const { module } = loadWithSection()
  const sent = []
  const pending = [{ id: 'acme/flagship', name: 'Acme Flagship', vendor: 'acme', fields: [{ key: 'input', manual: 2.5, official: 2.4 }] }]
  const tree = expand(
    module.exports.RatesView({
      t: fakeT(),
      state: { status: 'ready', data: ratesPayload({ pending }), error: null, saving: false, notice: null, action: null },
      onPatch: (...args) => sent.push(args),
    }),
  )

  const row = findByClass(tree, 'tl-review-row')
  assert.ok(row !== null, 'the disagreement is put to the reader')
  const text = collectText(row)
  assert.ok(hasText(text, 'reviewYours'))
  assert.ok(hasText(text, 'reviewOfficial'))

  // The page names the price keys and never the numbers: what it is holding came
  // from a payload a refresh may already have replaced, and the host is the one
  // that knows what the catalogue publishes now.
  findButtons(row, 'reviewAdopt')[0].props.onClick()
  findButtons(row, 'reviewKeep')[0].props.onClick()
  assert.deepEqual(sent, [
    [{ adopt: { 'acme/flagship': ['input'] } }, 'reviewAdopted', 'adopt'],
    [{ keep: { 'acme/flagship': ['input'] } }, 'reviewKept', 'keep'],
  ])
})

test('prices and the bill are fetched only when their view is opened', () => {
  const { module, reactEffects } = loadWithSection()
  reactEffects.length = 0
  // The overview render registers an effect per view; only the first should fetch.
  render(module, { status: 'loading', data: null, error: null })
  assert.equal(reactEffects.length, 3, 'overview, rates and bill')
  const calls = []
  const realFetch = globalThis.fetch
  let intervals = 0
  const realSetInterval = globalThis.setInterval
  globalThis.fetch = (url, options) => {
    calls.push({ url, options })
    return Promise.resolve({ ok: true, json: () => Promise.resolve(ratesPayload()) })
  }
  globalThis.setInterval = (handler, ms) => {
    intervals += 1
    return realSetInterval(handler, ms)
  }
  try {
    // On the overview neither of the other two may read anything: the catalogue is
    // a couple of hundred rows, and a reader who stays here should not pay for them
    // nor for a bill they did not ask for.
    for (const index of [1, 2]) {
      assert.equal(reactEffects[index](), undefined, 'no cleanup is needed when nothing was started')
    }
    assert.deepEqual(calls, [])
    assert.equal(intervals, 0)
  } finally {
    globalThis.fetch = realFetch
    globalThis.setInterval = realSetInterval
  }

  /**
   * Render the section on one tab and run the effect at an index.
   *
   * @param {string} kind - the tab to prime.
   * @param {object} state - the state that tab's view receives.
   * @param {number} index - which effect to run.
   * @returns {string[]} the URLs that effect fetched, and its cleanup result.
   */
  const runEffect = (kind, state, index) => {
    reactEffects.length = 0
    const priming = module.priming
    priming.length = 0
    priming.push(DEFAULT, DEFAULT, { status: 'ready', data: payload(), error: null }, kind, state)
    globalThis.fetch = (url, options) => {
      calls.push({ url, options })
      return Promise.resolve({ ok: true, json: () => Promise.resolve(ratesPayload()) })
    }
    globalThis.setInterval = (handler, ms) => {
      intervals += 1
      return realSetInterval(handler, ms)
    }
    expand(module.__section({ t: fakeT() }))
    const dispose = reactEffects[index]()
    priming.length = 0
    return { dispose }
  }

  try {
    // The rates tab reads the documented endpoint and polls.
    calls.length = 0
    intervals = 0
    const rates = runEffect('rates', { status: 'loading', data: null, error: null }, 1)
    assert.deepEqual(calls.map((call) => call.url), ['/api/token-ledger/rates'])
    assert.equal(calls[0].options.cache, 'no-store')
    assert.equal(intervals, 1, 'the rates view polls for changes made by the host timer')
    assert.equal(typeof rates.dispose, 'function')
    rates.dispose()

    // The bill tab reads one request per section, each naming its own grouping and
    // period, so a section that fails leaves the other three readable.
    calls.length = 0
    intervals = 0
    const bill = runEffect('bill', { status: 'loading', data: null, error: null }, 2)
    assert.deepEqual(calls.map((call) => call.url), [
      '/api/token-ledger/bill?by=workspace&range=month',
      '/api/token-ledger/bill?by=session&range=month',
      '/api/token-ledger/bill?by=model&range=month',
      '/api/token-ledger/bill?by=vendor&range=month',
    ])
    assert.equal(calls[0].options.cache, 'no-store')
    assert.equal(intervals, 1, 'the bill polls too, because the host keeps folding')
    assert.equal(typeof bill.dispose, 'function')
    bill.dispose()
  } finally {
    globalThis.fetch = realFetch
    globalThis.setInterval = realSetInterval
  }
})

/* ------------------------------------------------------------------- bill -- */

/** The groupings the page stacks, in order. */
const BILL_DIMS = ['workspace', 'session', 'model', 'vendor']

/**
 * A bill payload in the shape the route serves.
 *
 * It carries one plan row, one pay-as-you-go row, a model that could not be
 * priced and a join made by name, because those are the four things the view has
 * to say something about beyond the numbers.
 *
 * @param {object} [overrides] - fields to replace, applied to the first section.
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
      months: ['2026-03'],
    },
    {
      key: 'usage',
      label: null,
      sublabel: null,
      plan: false,
      covered: false,
      calls: 4,
      inputTokens: 400_000,
      outputTokens: 40_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 440_000,
      cacheHitRate: 0,
      cost: 4.2,
      usageCost: 4.2,
      unpricedTokens: 300_000,
      modelCount: 3,
      sessionCount: 2,
    },
  ]
  const totals = {
    calls: 16,
    inputTokens: 1_400_000,
    outputTokens: 240_000,
    cacheReadTokens: 500_000,
    cacheWriteTokens: 0,
    totalTokens: 2_140_000,
    cacheHitRate: 0.2632,
    cost: 144.2,
    usageCost: 102.8,
    subscriptionCost: 140,
    totalCost: 144.2,
    unpricedCost: true,
  }
  const { sections: _ignored, ...rest } = overrides
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
    unpriced: [{ model: 'nobody/mystery-1', vendor: 'nobody', tokens: 300_000, calls: 2, reason: 'no price for this model' }],
    joins: [{ model: 'deepseek-official/deepseek-v4-flash', vendor: 'deepseek', price: 'DeepSeek-V4.1-Flash', priceId: 'deepseek-flash', confidence: 'name', matchedOn: 'name+version', tokens: 440_000 }],
    ...rest,
    // A test that wants a different set of sections says so; the default above is
    // one section with the two rows the other tests read.
    ...(overrides.sections === undefined ? {} : { sections: overrides.sections }),
  }
}

/**
 * A fetch state per grouping, all ready on the same payload.
 *
 * @param {object} [data] - the payload every section answers with.
 * @param {object} [states] - per-grouping overrides.
 * @returns {object} the `bills` prop.
 */
function billStates(data = billPayload(), states = {}) {
  return Object.fromEntries(
    BILL_DIMS.map((dim) => [dim, states[dim] ?? { status: 'ready', data, error: null }]),
  )
}

/**
 * Render the bill view on its own.
 *
 * The view is pure — it holds no drafts — so it can be handed props directly,
 * which is what lets a test click a tab the way a reader would.
 *
 * @param {object} module - the loaded client module.
 * @param {object} bills - the per-grouping fetch states.
 * @param {{ ranges?: object, onRange?: Function }} [hooks] - the current periods and their setter.
 * @returns {unknown} the expanded tree.
 */
function renderBillView(module, bills, hooks = {}) {
  return expand(
    module.exports.BillView({
      t: fakeT(),
      bills,
      ranges: hooks.ranges ?? Object.fromEntries(BILL_DIMS.map((dim) => [dim, 'month'])),
      onRange: hooks.onRange ?? (() => {}),
    }),
  )
}

/**
 * The section cards, in page order.
 *
 * `findAllByClass` matches a class fragment, and `tl-card-title` contains
 * `tl-card`, so the exact class is what identifies a card.
 *
 * @param {unknown} tree - the expanded tree.
 * @returns {object[]} the cards.
 */
function cardsOf(tree) {
  return findAllByClass(tree, 'tl-card').filter((element) => element.props.className === 'tl-card')
}

test('the bill stacks every grouping, each with every period', () => {
  const { module } = loadWithSection()
  const tree = renderBillView(module, billStates())
  const text = collectText(tree)
  for (const key of ['billByWorkspace', 'billBySession', 'billByModel', 'billByVendor', 'rangeMonth', 'rangeYear', 'rangeWeek', 'rangeToday', 'rangeAll', 'billExportAllCsv', 'billExportAllJson']) {
    assert.ok(hasText(text, key), key)
  }

  // Four cards, one per grouping, each with its own five periods — the grouping is
  // not a tab, and neither is the period.
  assert.equal(cardsOf(tree).length, 4)
  assert.equal(findAllByClass(tree, 'tl-bill-table').length, 4)
  const tabs = findAllByClass(tree, 'tl-tab').filter((tab) => tab.type === 'button')
  assert.equal(tabs.length, 20, 'five periods in each of four sections')
  assert.equal(tabs.filter((tab) => tab.props['data-active'] === 'true').length, 4, 'one period is active per section')
})

test('the export at the top carries every grouping over every period', () => {
  const { module } = loadWithSection()
  const tree = renderBillView(module, billStates())
  const exports = findAllByClass(tree, 'tl-btn')
  assert.equal(exports.length, 2)
  assert.deepEqual(
    exports.map((link) => link.props.href),
    [
      '/api/token-ledger/bill?by=workspace,session,model,vendor&range=month,year,week,today,all&format=csv',
      '/api/token-ledger/bill?by=workspace,session,model,vendor&range=month,year,week,today,all&format=json',
    ],
  )
  assert.equal(exports[0].props.download, 'token-bill-all-2026-03-31.csv')
  assert.equal(exports[1].props.download, 'token-bill-all-2026-03-31.json')
  assert.ok(hasText(collectText(tree), 'billExportHint'), 'and the page says what the file contains')
  // On the header row, so the two links stay in the top right corner however wide
  // the page title's subtitle is.
  const headerRows = findAllByClass(tree, 'tl-row-head')
  assert.equal(headerRows.length, 1)
  assert.equal(String(headerRows[0].props.className), 'tl-row tl-row-head')
  assert.equal(countByClass(headerRows[0], 'tl-bill-actions'), 1, 'the export is on it')
})

test('the bill table shows a row per group, both halves of the input and the cost', () => {
  const { module } = loadWithSection()
  const tree = renderBillView(module, billStates())
  const section = cardsOf(tree)[0]
  const rows = findAllByClass(section, 'tl-bill-row')
  assert.equal(rows.length, 2, 'the plan and the pay-as-you-go line')
  assert.ok(collectText(rows[1]).includes('billPayAsYouGo'), 'the unnamed line is labelled by the view')

  // The header: the group, what the row cost, then the tokens — the two halves of
  // the input first, because they are priced differently — the hit rate, and the
  // call count last.
  const head = collectText(findAllByClass(section, 'tl-bill-head')[0])
  assert.deepEqual(head, ['billByWorkspace', 'billCost', 'cacheReadTokens', 'inputTokens', 'outputTokens', 'cacheHitRate', 'calls'])

  const cells = rows[1].children
  assert.ok(hasText(collectText(cells[1]), '¥4.20'), 'cost')
  assert.equal(collectText(cells[2])[0], '0', 'cache-hit input')
  assert.equal(collectText(cells[3])[0], '40.00 万', 'uncached input')
  assert.equal(collectText(cells[4])[0], '4.00 万', 'output')
  assert.equal(collectText(cells[5])[0], '0.0%', 'hit rate')
  assert.equal(collectText(cells[6])[0], '4', 'calls')

  // The plan row states the plan beside the usage it covers, not added to it.
  const planCells = rows[0].children
  assert.ok(hasText(collectText(planCells[1]), '¥140.00'))
  assert.ok(hasText(collectText(planCells[1]), 'billCoveredUsage ¥98.60'))

  const total = findAllByClass(section, 'tl-bill-total')[0]
  assert.ok(hasText(collectText(total), '¥144.20'), 'the total is the bill, not the usage alone')
})

test('the bill states what it could not price and how it joined the rest', () => {
  const { module } = loadWithSection()
  const text = collectText(renderBillView(module, billStates()))
  assert.ok(hasText(text, 'billUnpriced'))
  assert.ok(hasText(text, 'nobody/mystery-1 — '))
  assert.ok(hasText(text, 'no price for this model'))
  assert.ok(hasText(text, 'billJoins'), 'a price applied by name is shown, not hidden')
  assert.ok(hasText(text, 'deepseek-official/deepseek-v4-flash → deepseek/deepseek-flash (name+version)'))
  assert.ok(hasText(text, 'billEstimate'))
  assert.ok(hasText(text, 'GPT plan'), 'the plan and what it covered are restated below the tables')
  assert.ok(hasText(text, 'unpricedBadge'), 'and the row with unpriced tokens is marked')
})

test('each section can be put on its own period', () => {
  const { module } = loadWithSection()
  const asked = []
  const ranges = { workspace: 'month', session: 'today', model: 'all', vendor: 'year' }
  const tree = renderBillView(module, billStates(), { ranges, onRange: (dim, value) => asked.push([dim, value]) })
  const cards = cardsOf(tree)
  assert.equal(cards.length, 4)

  // The section that is showing today has today's tab active, and only its own.
  const sessionTabs = findAllByClass(cards[1], 'tl-tab').filter((tab) => tab.type === 'button')
  const active = sessionTabs.filter((tab) => tab.props['data-active'] === 'true')
  assert.equal(active.length, 1)
  assert.ok(hasText(collectText(active[0]), 'rangeToday'))

  // Clicking a period reports which section it belongs to.
  const yearTab = findAllByClass(cards[3], 'tl-tab')
    .filter((tab) => tab.type === 'button')
    .find((tab) => hasText(collectText(tab), 'rangeYear'))
  yearTab.props.onClick()
  assert.deepEqual(asked, [['vendor', 'year']])
})

test('one section failing leaves the other three readable', () => {
  const { module } = loadWithSection()
  const tree = renderBillView(
    module,
    billStates(billPayload(), {
      session: { status: 'error', data: null, error: 'HTTP 500' },
      model: { status: 'stale', data: billPayload(), error: 'network' },
    }),
  )
  const cards = cardsOf(tree)
  assert.equal(findAllByClass(cards[1], 'tl-bill-table').length, 0, 'the failed section has no table')
  assert.ok(hasText(collectText(cards[1]), 'billSectionFailed'))
  assert.ok(hasText(collectText(cards[1]), 'HTTP 500'))
  assert.equal(findAllByClass(cards[2], 'tl-bill-table').length, 1, 'a stale section keeps its last good numbers')
  assert.equal(findAllByClass(cards[0], 'tl-bill-table').length, 1, 'the others are untouched')
  assert.ok(hasText(collectText(tree), 'stale'))
})

test('an empty bill says so inside its own card', () => {
  const { module } = loadWithSection()
  const empty = billPayload({ sections: [{ by: 'workspace', range: { kind: 'month', from: '2026-03-01', to: '2026-03-31' }, rows: [], totals: { calls: 0, totalTokens: 0, totalCost: 0, cacheHitRate: null } }] })
  const tree = renderBillView(module, billStates(empty))
  assert.ok(hasText(collectText(tree), 'billSectionEmpty'))
  assert.equal(findAllByClass(tree, 'tl-bill-row').length, 0)
  assert.equal(findAllByClass(tree, 'tl-bill-total').length, 0, 'no table for no rows')
  assert.equal(findAllByClass(tree, 'tl-bill-table').length, 0)
})

test('a bill payload missing every optional field still renders', () => {
  const { module } = loadWithSection()
  const tree = renderBillView(module, billStates({ plugin: 'token-ledger' }))
  const text = collectText(tree)
  assert.equal(cardsOf(tree).length, 4, 'the four sections are still offered')
  assert.ok(hasText(text, 'billByWorkspace'))
  assert.ok(hasText(text, 'billExportHint'))
})