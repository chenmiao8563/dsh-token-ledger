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
 * like `tl-bar` also matches `tl-bar-col`, so exact counting is available too.
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
 * A stand-in translator: returns the key, so assertions read the key names.
 *
 * @returns {(key: string) => string} the translator.
 */
function fakeT() {
  return (key) => key
}

/** A ready payload with two days of data. */
function payload(overrides = {}) {
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

test('a ready payload renders the three ranges, their metrics, today and the calendar', () => {
  const { module } = loadWithSection()
  const { tree, text } = render(module, { status: 'ready', data: payload(), error: null })

  // Range switcher offers exactly the three requested periods.
  for (const key of ['rangeMonth', 'rangeYear', 'rangeWeek']) assert.ok(hasText(text, key), `missing ${key}`)
  // Metrics: total, cache hit rate, calls.
  assert.ok(hasText(text, 'totalTokens'))
  assert.ok(hasText(text, 'cacheHitRate'))
  assert.ok(hasText(text, 'calls'))
  assert.ok(hasText(text, '5,500'), 'the full total should be shown')
  assert.ok(hasText(text, '90.0%'), 'the cache hit rate should be shown')
  assert.ok(hasText(text, '55'))
  // Today block.
  assert.ok(hasText(text, 'today'))
  assert.ok(hasText(text, '2026-03-10'))
  // Calendar with one cell per day in the series, plus the legend swatches.
  assert.equal(countByClass(tree, 'tl-cell'), 10 + 5)
  assert.ok(hasText(text, 'byModel'))
  assert.ok(hasText(text, 'deepseek-official/deepseek-v4-flash'))
  assert.ok(hasText(text, 'updatedAt'))
})

test('the week view renders one bar per day and drops the heat legend', () => {
  const { module } = loadWithSection()
  const { tree, text } = render(module, { status: 'ready', data: payload(), error: null }, { view: 'week' })
  assert.equal(countByExactClass(tree, 'tl-bar'), 7)
  assert.equal(countByExactClass(tree, 'tl-bar-col'), 7)
  assert.ok(hasText(text, 'weekChart'))
  assert.equal(countByClass(tree, 'tl-cell'), 0, 'no heat cells while the bar chart is shown')
})

test('the month view draws the calendar grid rather than the year grid', () => {
  const { module } = loadWithSection()
  const { tree } = render(module, { status: 'ready', data: payload(), error: null }, { view: 'month' })
  assert.equal(countByClass(tree, 'tl-month-grid'), 1)
  // A 31-day March with the 1st on a Sunday leaves six leading blanks.
  assert.equal(countByClass(tree, 'tl-month-cell'), 31)
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
