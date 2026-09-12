/**
 * Rates service tests.
 *
 * The service exists to make network failure invisible, so most of these tests
 * are about what survives a failure rather than about what happens on success.
 *
 * @module dsh-token-ledger/test/rates-service.test
 */

import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { createRatesService, fetchJson } from '../lib/rates-service.js'
import { VENDOR_PRICE_SOURCES } from '../lib/vendor-prices.js'

/** A model list with two vendors. */
const MODELS = {
  data: [
    { id: 'acme/new-flash', name: 'Acme New', created: 3000, context_length: 1000, pricing: { prompt: '0.0000002', completion: '0.0000008', input_cache_read: '0.00000002' } },
    { id: 'acme/old-flash', name: 'Acme Old', created: 1000, context_length: 1000, pricing: { prompt: '0.0000001', completion: '0.0000004' } },
    { id: 'beta/only', name: 'Beta Only', created: 2000, context_length: 2000, pricing: { prompt: '0.000001', completion: '0.000002' } },
  ],
}

const FX = { result: 'success', base_code: 'USD', rates: { CNY: 6.725314 }, time_last_update_unix: 1789000000 }

/**
 * A fetch stand-in that answers by URL and records calls.
 *
 * @param {{ models?: unknown, fx?: unknown, failModels?: boolean, failFx?: boolean }} [options] - response control.
 * @returns {{ fetchImpl: typeof fetch, calls: string[] }} the transport and its log.
 */
function stubFetch({ models = MODELS, fx = FX, failModels = false, failFx = false } = {}) {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(String(url))
    const isFx = String(url).includes('rates')
    if (isFx && failFx) throw new Error('fx unreachable')
    if (!isFx && failModels) throw new Error('models unreachable')
    const payload = isFx ? fx : models
    return { ok: true, status: 200, text: async () => JSON.stringify(payload) }
  }
  return { fetchImpl, calls }
}

/**
 * Build a service over a temporary cache file.
 *
 * @param {object} options - service options plus the fetch stub.
 * @returns {{ service: object, path: string, cleanup: () => void, calls: string[] }} the service and its disposer.
 */
function makeService(options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'token-ledger-rates-'))
  const path = join(dir, 'rates.json')
  const { fetchImpl, calls } = stubFetch(options)
  const service = createRatesService({
    path,
    // The fixture here is OpenRouter-shaped, so these tests drive the gateway
    // source explicitly; the per-vendor source has its own fixture below. The
    // spread comes last so a test can ask for the other one.
    options: { source: 'openrouter', fetchImpl, modelsUrl: 'https://models.test/list', fxUrl: 'https://rates.test/latest', now: options.now, ...options },
  })
  return { service, path, calls, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

test('a successful refresh publishes the catalogue and the rate, and caches them', async () => {
  const { service, path, calls, cleanup } = makeService()
  try {
    const outcome = await service.refresh({ reason: 'test' })
    assert.match(outcome.catalogue, /^ok/)
    assert.match(outcome.fx, /^ok/)
    // The model list, the rate, and one request per vendor whose own pricing page
    // is read. The stub answers every one of them, so nothing fails here.
    assert.equal(calls.length, 2 + Object.keys(VENDOR_PRICE_SOURCES).length, 'the list, the rate, and each vendor page')

    const view = service.read()
    assert.equal(view.catalogue.available, true)
    assert.equal(view.catalogue.modelCount, 3)
    assert.equal(view.catalogue.vendorCount, 2)
    assert.equal(view.catalogue.totalAvailable, 3)
    assert.equal(view.fx.available, true)
    assert.equal(view.fx.rate, 6.725314)
    assert.equal(view.fx.overridden, false)
    assert.match(view.catalogue.source, /models\.test/)

    const vendors = view.vendors.map((entry) => entry.vendor)
    assert.deepEqual(vendors, ['acme', 'beta'], 'ordered by model count')
    assert.equal(view.vendors[0].models[0].id, 'acme/new-flash', 'newest first within a vendor')
    assert.equal(view.vendors[0].models[0].prices.input, 0.2, 'scaled to USD per million without artefacts')

    assert.equal(existsSync(path), true, 'the cache file is written')
    const cached = JSON.parse(readFileSync(path, 'utf8'))
    assert.equal(cached.catalogue.vendors.length, 2)
    assert.equal(cached.fx.rate, 6.725314)
  } finally {
    cleanup()
  }
})

test('a failed refresh keeps the last good values and says the attempt failed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'token-ledger-rates-'))
  const path = join(dir, 'rates.json')
  try {
    const first = createRatesService({
      path,
      options: { source: 'openrouter', fetchImpl: stubFetch().fetchImpl, modelsUrl: 'https://models.test/list', fxUrl: 'https://rates.test/latest' },
    })
    await first.refresh()
    const good = first.read()
    assert.equal(good.catalogue.available, true)

    // The same cache file, but now nothing is reachable.
    const offline = createRatesService({
      path,
      options: {
        source: 'openrouter',
        fetchImpl: stubFetch({ failModels: true, failFx: true }).fetchImpl,
        modelsUrl: 'https://models.test/list',
        fxUrl: 'https://rates.test/latest',
      },
    })
    const before = offline.read()
    assert.equal(before.catalogue.available, true, 'the cache is read at construction, before any fetch')

    const outcome = await offline.refresh({ reason: 'test' })
    assert.match(outcome.catalogue, /^failed \(models unreachable\)/)
    assert.match(outcome.fx, /^failed \(fx unreachable\)/)

    const after = offline.read()
    assert.equal(after.catalogue.available, true, 'a failed refresh must not blank the table')
    assert.equal(after.catalogue.fetchedAt, good.catalogue.fetchedAt, 'and must not rewrite the fetch time')
    assert.equal(after.fx.rate, 6.725314)
    assert.match(after.lastRefresh.catalogue, /^failed/)
    assert.equal(typeof after.lastRefresh.ageMs, 'number')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a host that has never reached the network still serves a usable shape', () => {
  const { service, cleanup } = makeService()
  try {
    const view = service.read()
    assert.equal(view.catalogue.available, false)
    assert.equal(view.catalogue.modelCount, 0)
    assert.deepEqual(view.vendors, [])
    assert.equal(view.fx.available, false)
    assert.equal(view.fx.rate, null, 'an absent rate is null, not undefined')
    assert.equal(view.lastRefresh.at, null)
    assert.equal(view.currency, 'USD')
    assert.equal(view.quote, 'CNY')
    assert.equal(view.perVendor, 3)
    assert.equal(view.refreshIntervalMs, 30 * 60 * 1000)
  } finally {
    cleanup()
  }
})

test('hand-entered values are saved, outrank fetched ones, and survive a restart', async () => {
  const { service, path, cleanup } = makeService()
  try {
    await service.refresh()
    const saved = service.saveOverrides({
      fx: { rate: 6.9 },
      models: { 'acme/new-flash': { input: 0.42, cacheWrite: 1.5 } },
    })
    assert.equal(saved.ok, true)
    assert.equal(saved.saved.models, 1)
    assert.equal(saved.saved.fx, true)

    const view = service.read()
    assert.equal(view.fx.rate, 6.9)
    assert.equal(view.fx.source, 'manual')
    assert.equal(view.fx.overridden, true)
    assert.equal(view.overriddenModels, 1)
    const row = view.vendors.find((entry) => entry.vendor === 'acme').models.find((entry) => entry.id === 'acme/new-flash')
    assert.equal(row.prices.input, 0.42)
    assert.equal(row.prices.cacheWrite, 1.5, 'a bucket the vendor never published can still be typed in')
    assert.equal(row.source, 'manual')

    // A restart reads the cache and leaves the typed values on top.
    const restarted = createRatesService({ path, options: { fetchImpl: stubFetch().fetchImpl } })
    const afterRestart = restarted.read()
    assert.equal(afterRestart.overriddenModels, 1)
    assert.equal(afterRestart.fx.rate, 6.9)
    const restartRow = afterRestart.vendors.find((entry) => entry.vendor === 'acme').models.find((entry) => entry.id === 'acme/new-flash')
    assert.equal(restartRow.prices.input, 0.42)

    // A refetch does not undo the typed value.
    await restarted.refresh()
    assert.equal(restarted.read().vendors.find((entry) => entry.vendor === 'acme').models.find((entry) => entry.id === 'acme/new-flash').prices.input, 0.42)
  } finally {
    cleanup()
  }
})

test('clearing an override hands the row back to the fetched value', async () => {
  const { service, cleanup } = makeService()
  try {
    await service.refresh()
    service.saveOverrides({ models: { 'acme/new-flash': { input: 9 } } })
    assert.equal(service.read().vendors[0].models[0].prices.input, 9)
    service.saveOverrides({ models: { 'acme/new-flash': null } })
    const row = service.read().vendors.find((entry) => entry.vendor === 'acme').models.find((entry) => entry.id === 'acme/new-flash')
    assert.equal(row.prices.input, 0.2, 'back to the fetched price')
    assert.equal(row.source, 'fetched')
    assert.equal(service.read().overriddenModels, 0)
  } finally {
    cleanup()
  }
})

test('an invalid patch is refused and changes nothing', async () => {
  const { service, cleanup } = makeService()
  try {
    await service.refresh()
    const refused = service.saveOverrides({ fx: { rate: 'not a number' } })
    assert.equal(refused.ok, false)
    assert.match(refused.error, /fx\.rate/)
    assert.equal(service.read().fx.rate, 6.725314, 'the previous rate is untouched')
    assert.equal(service.read().fx.overridden, false)
  } finally {
    cleanup()
  }
})

test('the timer refreshes on its interval and stops on demand', async () => {
  const { service, calls, cleanup } = makeService({ intervalMs: 15 })
  try {
    await service.refresh()
    const afterFirst = calls.length
    service.start()
    service.start() // a second call must not double-schedule
    await new Promise((resolve) => setTimeout(resolve, 70))
    service.stop()
    const afterTimer = calls.length
    assert.ok(afterTimer > afterFirst, `expected the timer to refresh, saw ${afterFirst} -> ${afterTimer}`)

    // After stop, nothing more happens.
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal(calls.length, afterTimer, 'a stopped timer must not keep fetching')
  } finally {
    cleanup()
  }
})

test('fetchJson reports a timeout, an HTTP error and malformed JSON instead of throwing', async () => {
  const timeout = await fetchJson('https://x.test', {
    fetchImpl: (_url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
      }),
    timeoutMs: 20,
  })
  assert.equal(timeout.ok, false)
  assert.match(timeout.reason, /timeout after 20ms/)

  const http = await fetchJson('https://x.test', { fetchImpl: async () => ({ ok: false, status: 503, text: async () => '' }) })
  assert.deepEqual(http, { ok: false, reason: 'HTTP 503' })

  const malformed = await fetchJson('https://x.test', { fetchImpl: async () => ({ ok: true, status: 200, text: async () => 'not json' }) })
  assert.equal(malformed.ok, false)

  // The per-vendor price list is 4.6 MB today, so a response that size is a real
  // one and must not be mistaken for an attack.
  const realistic = await fetchJson('https://x.test', {
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ pad: 'x'.repeat(5 * 1024 * 1024) }) }),
  })
  assert.equal(realistic.ok, true, 'a five-megabyte body is a real response')

  const huge = await fetchJson('https://x.test', { fetchImpl: async () => ({ ok: true, status: 200, text: async () => 'x'.repeat(9 * 1024 * 1024) }) })
  assert.equal(huge.ok, false)
  assert.match(huge.reason, /body too large/)

  const none = await fetchJson('https://x.test', { fetchImpl: null })
  assert.equal(none.ok, false)
  assert.match(none.reason, /no fetch implementation/)
})

test('a malformed response body is a failed source, not a crash', async () => {
  const { service, cleanup } = makeService({ models: { data: 'nope' }, fx: { rates: {} } })
  try {
    const outcome = await service.refresh()
    assert.match(outcome.catalogue, /^failed \(no usable models/)
    assert.match(outcome.fx, /^failed \(no usable rate/)
    assert.equal(service.read().catalogue.available, false)
  } finally {
    cleanup()
  }
})

/* ------------------------------------------------ the per-vendor price source -- */

/** A models.dev-shaped payload: two of the vendors the page publishes. */
const MODELSDEV = {
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    models: {
      'deepseek-v4-flash': { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', release_date: '2026-09-10', limit: { context: 128000 }, cost: { input: 0.15, output: 0.6, cache_read: 0.003 } },
      'deepseek-v4-pro': { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', release_date: '2026-09-01', cost: { input: 0.435, output: 0.87 } },
    },
  },
  // Qwen is sold under Alibaba's provider id, not "qwen".
  alibaba: {
    id: 'alibaba',
    name: 'Alibaba',
    models: {
      'qwen3.8-max': { id: 'qwen3.8-max', name: 'Qwen3.8 Max', release_date: '2026-08-03', limit: { context: 1000000 }, cost: { input: 2, output: 6, cache_read: 0.25, cache_write: 2.5 } },
      'unpriced-model': { id: 'unpriced-model', name: 'No Price', release_date: '2026-09-30' },
    },
  },
  // A vendor with no entry in the mapping must not appear at all.
  openai: { id: 'openai', name: 'OpenAI', models: {} },
}

test('the default source is each vendor’s own list price, not a gateway quote', async () => {
  const { service, calls, cleanup } = makeService({ source: 'modelsdev', models: MODELSDEV })
  try {
    const outcome = await service.refresh({ reason: 'test' })
    assert.match(outcome.catalogue, /^ok/)
    assert.match(outcome.catalogue, /modelsdev/, 'the log says which source answered')

    const state = service.read()
    assert.equal(state.priceSource, 'modelsdev')
    assert.equal(state.catalogue.sourceId, 'modelsdev')
    assert.equal(state.catalogue.modelCount, 3, 'the unpriced model is not published')
    assert.deepEqual(state.vendors.map((entry) => entry.vendor), ['deepseek', 'qwen'], 'curated order, mapped ids')
    const flash = state.vendors[0].models[0]
    assert.equal(flash.id, 'deepseek/deepseek-v4-flash', 'a bare id is namespaced for overrides and tooltips')
    assert.equal(flash.prices.input, 0.15, 'USD per million, straight from the vendor list')
    assert.equal(flash.prices.cacheRead, 0.003)
    assert.equal(flash.contextLength, 128000)
    assert.equal(flash.created, Date.parse('2026-09-10'))
    const max = state.vendors[1].models[0]
    assert.equal(max.id, 'qwen/qwen3.8-max')
    assert.equal(max.prices.cacheWrite, 2.5, 'a cache-write price is carried when the source has one')
    // The stub answers the vendor pages with the same JSON fixture, whose HTML
    // parse yields nothing, so every vendor here falls back to the dataset — and
    // that shows up as `source: 'dataset'` rather than as a broken table.
    assert.equal(calls.length, 2 + Object.keys(VENDOR_PRICE_SOURCES).length)
    assert.ok(state.vendors.every((entry) => entry.source === 'dataset'), 'a page that yields nothing is a fallback, not a failure')
    assert.equal(state.catalogue.vendorPages.filter((entry) => entry.ok).length, 0)
  } finally {
    cleanup()
  }
})

test('an unknown source falls back to the default instead of failing', async () => {
  const { service, cleanup } = makeService({ source: 'nonsense', models: MODELSDEV })
  try {
    const outcome = await service.refresh()
    assert.match(outcome.catalogue, /modelsdev/)
    assert.equal(service.read().priceSource, 'modelsdev')
  } finally {
    cleanup()
  }
})

test('switching source to the gateway changes both the URL and the parsing', async () => {
  const { service, calls, cleanup } = makeService({ source: 'openrouter' })
  try {
    await service.refresh()
    assert.equal(service.read().catalogue.sourceId, 'openrouter')
    assert.match(calls[0], /models\.test/, 'the configured URL still wins')
  } finally {
    cleanup()
  }
})
