/**
 * Rates arithmetic tests.
 *
 * These are the rules a user reads a price table by, so they are pinned here:
 * which models count as "newest", what a missing price means, and what a
 * hand-entered value outranks.
 *
 * @module dsh-token-ledger/test/rates.test
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  DEFAULT_PRICE_SOURCE,
  MODELSDEV_URL,
  OPENROUTER_MODELS_URL,
  PRICE_CURRENCY,
  PRICE_SOURCES,
  applyOverrides,
  parseCatalogue,
  parseFx,
  parseModelsDev,
  pricePerMillion,
  validateOverrides,
} from '../lib/rates.js'

/** One OpenRouter-shaped model entry. */
function model(id, created, pricing, extra = {}) {
  return { id, name: `${id} display`, created, context_length: 128000, pricing, ...extra }
}

/** A payload with three vendors, one of which has more models than the quota. */
function cataloguePayload() {
  return {
    data: [
      model('acme/old-flash', 1000, { prompt: '0.0000001', completion: '0.0000004' }),
      model('acme/new-flash', 3000, { prompt: '0.0000002', completion: '0.0000008', input_cache_read: '0.00000002' }),
      model('acme/mid-flash', 2000, { prompt: '0.00000015', completion: '0.0000006' }),
      model('acme/ancient', 500, { prompt: '0.00000005' }),
      model('acme/new-flash:batch', 4000, { prompt: '0.0000001', completion: '0.0000004' }),
      model('acme/new-flash:free', 4500, { prompt: '0', completion: '0' }),
      model('beta/only-one', 2500, { prompt: '0.000001', completion: '0.000002' }),
      model('gamma/expired', 9000, { prompt: '0.0000001' }, { expiration_date: '2020-01-01T00:00:00Z' }),
    ],
  }
}

test('pricePerMillion converts USD per token to USD per million', () => {
  assert.equal(pricePerMillion({ prompt: '0.00000015' }, 'prompt'), 0.15)
  assert.equal(pricePerMillion({ prompt: 0.0000006 }, 'prompt'), 0.6)
  assert.equal(pricePerMillion({ prompt: '0' }, 'prompt'), 0)
  assert.equal(pricePerMillion({}, 'prompt'), null)
  assert.equal(pricePerMillion({ prompt: 'free' }, 'prompt'), null)
  assert.equal(pricePerMillion({ prompt: '-1' }, 'prompt'), null)
  assert.equal(pricePerMillion(undefined, 'prompt'), null)
})

test('the catalogue keeps only the newest few models per vendor', () => {
  const parsed = parseCatalogue(cataloguePayload(), { perVendor: 3, now: Date.parse('2026-01-01') })
  const acme = parsed.vendors.find((entry) => entry.vendor === 'acme')
  assert.deepEqual(
    acme.models.map((entry) => entry.id),
    ['acme/new-flash', 'acme/mid-flash', 'acme/old-flash'],
    'newest first, and the fourth-oldest is dropped',
  )
  assert.equal(acme.modelCount, 4, 'the vendor count reports real models, not the quota')
})

test('variants and retired models never occupy a vendor quota', () => {
  const parsed = parseCatalogue(cataloguePayload(), { perVendor: 3, now: Date.parse('2026-01-01') })
  const ids = parsed.vendors.flatMap((entry) => entry.models.map((model) => model.id))
  assert.ok(!ids.some((id) => id.includes(':batch')), 'a batch variant is the same model')
  assert.ok(!ids.some((id) => id.includes(':free')), 'a free variant is the same model')
  assert.ok(!ids.includes('gamma/expired'), 'a retired model is not offered as latest')
  // gamma therefore has no rows at all, and should not appear as an empty vendor.
  assert.equal(parsed.vendors.some((entry) => entry.vendor === 'gamma'), false)
})

test('every catalogue row carries prices in USD per million, or null', () => {
  const parsed = parseCatalogue(cataloguePayload())
  const newest = parsed.vendors.find((entry) => entry.vendor === 'acme').models[0]
  assert.equal(newest.prices.input, 0.2)
  assert.equal(newest.prices.output, 0.8)
  assert.equal(newest.prices.cacheRead, 0.02)
  assert.equal(newest.prices.cacheWrite, null, 'a bucket the vendor does not publish stays null')
  assert.equal(newest.contextLength, 128000)
  assert.equal(parsed.selected, 4)
  assert.equal(parsed.total, 8)
})

test('a model with no published price never takes a vendor quota slot', () => {
  // This is the shape the live list actually carries: a router that has no
  // single price is published with the sentinel `-1`, which must not be read as
  // a price, as free, or as a row worth one of the vendor's few slots.
  const payload = {
    data: [
      model('acme/unknown-newest', 9000, { prompt: '-1', completion: '-1' }),
      model('acme/priced', 8000, { prompt: '0.000001', completion: '0.000002' }),
      model('beta/no-prices-at-all', 9000, {}),
      // A cache-only row has no usable headline price either.
      model('gamma/cache-only', 100, { input_cache_read: '0.0000001' }),
      // Free is a price, and it is not the same claim as unpriced.
      model('delta/free', 50, { prompt: '0', completion: '0' }),
    ],
  }
  const parsed = parseCatalogue(payload)
  const acme = parsed.vendors.find((entry) => entry.vendor === 'acme')
  assert.deepEqual(acme.models.map((entry) => entry.id), ['acme/priced'])
  assert.equal(acme.modelCount, 1, 'the unpriced model is not counted as on sale either')
  assert.equal(parsed.vendors.find((entry) => entry.vendor === 'beta'), undefined)
  assert.equal(parsed.vendors.find((entry) => entry.vendor === 'gamma'), undefined)
  assert.deepEqual(parsed.vendors.find((entry) => entry.vendor === 'delta').models[0].prices, {
    input: 0,
    output: 0,
    cacheRead: null,
    cacheWrite: null,
  })
  // The headline count still reports every entry the source listed.
  assert.equal(parsed.total, 5)
  assert.equal(parsed.selected, 2)
})

test('only the most familiar vendors are published, in a stable order', () => {
  // Twenty vendors, five of them the ones a reader looks for first. The list has
  // to be capped, and the cap has to be spent on the familiar ones rather than
  // handed to whoever happens to ship the most models this week.
  const data = []
  for (const vendor of ['obscure-a', 'qwen', 'obscure-b', 'openai', 'obscure-c', 'deepseek']) {
    for (let index = 0; index < 4; index += 1) {
      data.push(model(`${vendor}/m${index}`, 1000 + index, { prompt: '0.000001', completion: '0.000002' }))
    }
  }
  for (let index = 0; index < 14; index += 1) {
    data.push(model(`filler-${index}/m`, 1000, { prompt: '0.000001', completion: '0.000002' }))
  }

  const parsed = parseCatalogue({ data }, { vendorLimit: 3 })
  assert.equal(parsed.availableVendorCount, 20, 'every vendor the source listed is counted')
  assert.equal(parsed.vendors.length, 3, 'but only three are published')
  assert.deepEqual(
    parsed.vendors.map((entry) => entry.vendor),
    ['openai', 'deepseek', 'qwen'],
    'the three that survived are the familiar ones, in the curated order',
  )
  assert.equal(parsed.selected, 9, 'three newest models each')

  // The default cap, and the escape hatch that publishes everything.
  assert.equal(parseCatalogue({ data }).vendors.length, 15)
  assert.equal(parseCatalogue({ data }, { vendorLimit: 0 }).vendors.length, 20)
  assert.equal(parseCatalogue({ data }, { vendorLimit: 0 }).selected, 6 * 3 + 14, 'three newest per vendor, plus the one-model publishers')
})

test('a publisher alias is never published as a vendor', () => {
  // OpenRouter publishes `~vendor/model-latest` floating aliases. Listing them
  // would show the same vendor twice under a name nobody recognises.
  const payload = {
    data: [
      model('~openai/gpt-astra-latest', 9000, { prompt: '0.000001', completion: '0.000002' }),
      model('openai/gpt-astra', 8000, { prompt: '0.000001', completion: '0.000002' }),
    ],
  }
  const parsed = parseCatalogue(payload, { vendorLimit: 0 })
  assert.deepEqual(parsed.vendors.map((entry) => entry.vendor), ['openai'])
  assert.equal(parsed.selected, 1)
})

test('the per-vendor source publishes each vendor’s own list price', () => {
  // Same output shape as the gateway source, but the prices are the vendors'
  // own, the ids are bare and have to be namespaced, and a vendor with no entry
  // is simply absent.
  const payload = {
    deepseek: {
      models: {
        'deepseek-v4-pro': { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', release_date: '2026-09-01', limit: { context: 65536 }, cost: { input: 0.435, output: 0.87 } },
        'deepseek-v4-flash': { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', release_date: '2026-09-10', limit: { context: 128000 }, cost: { input: 0.15, output: 0.6, cache_read: 0.003, cache_write: 0 } },
        'deepseek-no-price': { id: 'deepseek-no-price', name: 'No Price', release_date: '2026-12-31' },
      },
    },
    // Qwen is sold under Alibaba's provider id.
    alibaba: {
      models: {
        'qwen3.8-max': { id: 'qwen3.8-max', name: 'Qwen3.8 Max', release_date: '2026-08-03', cost: { input: 2, output: 6 } },
      },
    },
    // Already namespaced by the source, so it must not be prefixed twice.
    nvidia: {
      models: {
        'nvidia/nemotron-3.5-lightning': { id: 'nvidia/nemotron-3.5-lightning', name: 'Nemotron 3.5', release_date: '2026-08-11', cost: { input: 0.1, output: 0.4 } },
      },
    },
    // Not one of the curated vendors, and not published.
    someotherprovider: { models: { x: { id: 'x', name: 'X', release_date: '2026-01-01', cost: { input: 1, output: 1 } } } },
  }

  const parsed = parseModelsDev(payload, { vendorLimit: 0 })
  assert.deepEqual(parsed.vendors.map((entry) => entry.vendor), ['deepseek', 'qwen', 'nvidia'], 'curated order, mapped provider ids')
  assert.equal(parsed.availableVendorCount, 3)
  assert.equal(parsed.selected, 4, 'two from DeepSeek, one from each of the others')

  const deepseek = parsed.vendors[0]
  assert.equal(deepseek.modelCount, 2, 'the unpriced model is not counted')
  assert.deepEqual(deepseek.models.map((entry) => entry.id), ['deepseek/deepseek-v4-flash', 'deepseek/deepseek-v4-pro'], 'newest by release date, bare ids namespaced')
  const flash = deepseek.models[0]
  assert.equal(flash.name, 'DeepSeek V4 Flash', 'the source name is used as-is, without a vendor prefix')
  assert.equal(flash.prices.input, 0.15, 'USD per million, as published')
  assert.equal(flash.prices.cacheRead, 0.003)
  assert.equal(flash.prices.cacheWrite, 0, 'a zero cache-write price is a price, not a gap')
  assert.equal(flash.contextLength, 128000)
  assert.equal(flash.created, Date.parse('2026-09-10'))
  assert.equal(flash.vendor, 'deepseek')

  assert.equal(parsed.vendors[2].models[0].id, 'nvidia/nemotron-3.5-lightning', 'an id already carrying a vendor part is left alone')
  assert.equal(parsed.total, 4, 'every priced model the curated vendors listed')
})

test('a vendor’s own models win its slots over the ones it hosts', () => {
  // Bedrock lists openai.*, Nvidia lists deepseek-ai/*, Alibaba lists DeepSeek.
  // Those rows are real prices for the platform, but a hosted model must not take
  // a vendor's slot away from the vendor itself — which is what happened to
  // Mistral, whose newest row was a Z.ai model.
  const payload = {
    mistral: {
      models: {
        'zai-glm-5-2': { id: 'zai-glm-5-2', name: 'GLM-5.2', release_date: '2026-09-30', cost: { input: 1.4, output: 4.4 } },
        'mistral-medium-2604': { id: 'mistral-medium-2604', name: 'Mistral Medium 3.5', release_date: '2026-04-29', cost: { input: 1.5, output: 7.5 } },
      },
    },
    nvidia: {
      models: {
        'deepseek-ai/deepseek-v4-pro': { id: 'deepseek-ai/deepseek-v4-pro', name: 'DeepSeek V4 Pro', release_date: '2026-09-20', cost: { input: 0, output: 0 } },
        'nvidia/nemotron-3.5-lightning': { id: 'nvidia/nemotron-3.5-lightning', name: 'Nemotron 3.5 Lightning', release_date: '2026-08-11', cost: { input: 0.1, output: 0.4 } },
      },
    },
  }

  const parsed = parseModelsDev(payload, { vendorLimit: 0, perVendor: 1 })
  assert.deepEqual(
    parsed.vendors.map((entry) => entry.models[0].id),
    ['mistralai/mistral-medium-2604', 'nvidia/nemotron-3.5-lightning'],
    'the vendor comes before its hosted guests, even when the guest is newer',
  )
  // Nothing is dropped: the hosted row is still in the vendor's list.
  const wide = parseModelsDev(payload, { vendorLimit: 0, perVendor: 5 })
  assert.equal(wide.selected, 4)
})

test('an all-zero price is flagged rather than quietly called free', () => {
  // Nvidia NIM is billed by GPU-hour and lists 0 per token, so a bare ¥0 would
  // claim the model is free. The row keeps the number and carries the warning.
  const payload = {
    nvidia: {
      models: {
        'nvidia/nemotron-3.5-lightning': { id: 'nvidia/nemotron-3.5-lightning', name: 'Nemotron 3.5', release_date: '2026-08-11', cost: { input: 0, output: 0 } },
        'nvidia/priced': { id: 'nvidia/priced', name: 'Priced', release_date: '2026-08-10', cost: { input: 0, output: 0.4 } },
      },
    },
  }
  const parsed = parseModelsDev(payload, { vendorLimit: 0 })
  const models = parsed.vendors[0].models
  assert.equal(models[0].zero, true, 'both headline prices are zero')
  assert.equal(models[1].zero, false, 'a zero input beside a real output is not a zero row')
  assert.deepEqual(models[0].prices, { input: 0, output: 0, cacheRead: null, cacheWrite: null }, 'the published number is kept unchanged')
})

test('the per-vendor source survives a payload that is not what it expects', () => {
  for (const payload of [undefined, null, {}, { deepseek: null }, { deepseek: { models: null } }, { deepseek: { models: { a: null, b: 5, c: { id: 1 } } } }]) {
    const parsed = parseModelsDev(payload)
    assert.deepEqual(parsed.vendors, [], JSON.stringify(payload))
    assert.equal(parsed.selected, 0)
    assert.equal(parsed.availableVendorCount, 0)
  }
})

test('an empty or malformed payload yields an empty catalogue rather than throwing', () => {
  for (const payload of [undefined, null, {}, { data: 'nope' }, { data: [null, 5, {}] }]) {
    const parsed = parseCatalogue(payload)
    assert.deepEqual(parsed.vendors, [])
    assert.equal(parsed.selected, 0)
  }
})

test('parseFx reads the rate and its own update time', () => {
  const parsed = parseFx({ base_code: 'USD', rates: { CNY: 6.725314 }, time_last_update_unix: 1789000000 })
  assert.equal(parsed.base, 'USD')
  assert.equal(parsed.quote, 'CNY')
  assert.equal(parsed.rate, 6.725314)
  assert.equal(parsed.updatedAt, 1789000000000)
  assert.equal(parseFx({ rates: {} }), undefined)
  assert.equal(parseFx({ rates: { CNY: 0 } }), undefined)
  assert.equal(parseFx({ rates: { CNY: 'x' } }), undefined)
  assert.equal(parseFx(undefined), undefined)
  assert.equal(parseFx({ rates: { CNY: 7 } }).updatedAt, null, 'a missing update time is not invented')
})

test('a hand-entered price outranks a fetched one and is marked as such', () => {
  const vendors = parseCatalogue(cataloguePayload()).vendors
  const result = applyOverrides({
    vendors,
    fx: { rate: 7.1, base: 'USD', quote: 'CNY', source: 'https://fx' },
    overrides: { models: { 'acme/new-flash': { input: 0.42 } }, fx: null },
  })

  const acme = result.vendors.find((entry) => entry.vendor === 'acme')
  const overridden = acme.models.find((entry) => entry.id === 'acme/new-flash')
  assert.equal(overridden.prices.input, 0.42, 'the typed input price wins')
  assert.equal(overridden.prices.output, 0.8, 'untouched fields keep the fetched value')
  assert.equal(overridden.source, 'manual')
  const untouched = acme.models.find((entry) => entry.id === 'acme/mid-flash')
  assert.equal(untouched.source, 'fetched')
  assert.equal(result.overriddenModels, 1)
  assert.equal(result.fx.rate, 7.1)
  assert.equal(result.fx.source, 'fetched')
})

test('a null override clears a price instead of zeroing it', () => {
  const vendors = parseCatalogue(cataloguePayload()).vendors
  const result = applyOverrides({ vendors, overrides: { models: { 'acme/new-flash': { input: null } } } })
  const model = result.vendors.find((entry) => entry.vendor === 'acme').models.find((entry) => entry.id === 'acme/new-flash')
  assert.equal(model.prices.input, null, 'not priced, which is not the same claim as free')
  assert.equal(model.prices.output, 0.8)
})

test('prices typed for a model no fetch described are still published', () => {
  // The offline case: nothing was ever fetched, so there is no catalogue row to
  // attach an override to. Without this the values a user typed on a firewalled
  // host would be stored and then never shown.
  const result = applyOverrides({
    vendors: [],
    overrides: { models: { 'deepseek/deepseek-chat': { input: 0.27, output: 1.1 }, 'unslashed': { input: 1 } } },
  })
  assert.equal(result.vendors.length, 2)
  const deepseek = result.vendors.find((entry) => entry.vendor === 'deepseek')
  assert.equal(deepseek.manualOnly, true)
  assert.equal(deepseek.models[0].id, 'deepseek/deepseek-chat')
  assert.equal(deepseek.models[0].name, 'deepseek/deepseek-chat', 'the id is the only name available')
  assert.equal(deepseek.models[0].source, 'manual')
  assert.deepEqual(deepseek.models[0].prices, { input: 0.27, output: 1.1, cacheRead: null, cacheWrite: null })
  // An id with no vendor part still becomes a usable row, in its own group.
  const unslashed = result.vendors.find((entry) => entry.vendor === '')
  assert.equal(unslashed.models[0].id, 'unslashed')
  assert.equal(unslashed.models[0].prices.output, null)
  assert.equal(result.overriddenModels, 2)
})

test('a fetched row and an orphan override never duplicate the same model', () => {
  const vendors = parseCatalogue(cataloguePayload()).vendors
  const result = applyOverrides({
    vendors,
    overrides: { models: { 'acme/new-flash': { input: 0.42 }, 'acme/never-listed': { input: 9 } } },
  })
  const acmeGroups = result.vendors.filter((entry) => entry.vendor === 'acme')
  assert.equal(acmeGroups.length, 2, 'the fetched group and the manual-only group')
  assert.equal(acmeGroups[0].manualOnly, undefined)
  assert.equal(acmeGroups[1].manualOnly, true)
  assert.deepEqual(acmeGroups[1].models.map((model) => model.id), ['acme/never-listed'])
  assert.equal(acmeGroups[0].models.filter((model) => model.id === 'acme/new-flash').length, 1)
})

test('clearing an orphan override removes its row entirely', () => {
  const overrides = { models: { 'deepseek/deepseek-chat': { input: 0.27 } } }
  assert.equal(applyOverrides({ vendors: [], overrides }).vendors.length, 1)
  // A null override is a deletion, so the group goes with it.
  assert.equal(applyOverrides({ vendors: [], overrides: { models: { 'deepseek/deepseek-chat': null } } }).vendors.length, 0)
})

test('a hand-entered rate outranks the fetched one', () => {
  const withManual = applyOverrides({ vendors: [], fx: { rate: 7.1 }, overrides: { fx: { rate: 6.8 } } })
  assert.equal(withManual.fx.rate, 6.8)
  assert.equal(withManual.fx.source, 'manual')
  assert.equal(withManual.fxOverridden, true)

  const fetched = applyOverrides({ vendors: [], fx: { rate: 7.1, base: 'USD', quote: 'CNY' }, overrides: { fx: null } })
  assert.equal(fetched.fx.rate, 7.1)
  assert.equal(fetched.fxOverridden, false)

  const nothing = applyOverrides({ vendors: [], overrides: {} })
  assert.equal(nothing.fx.rate, null)
  assert.equal(nothing.fx.source, 'none')
})

test('validateOverrides refuses anything it cannot trust', () => {
  assert.equal(validateOverrides(null).ok, false)
  assert.equal(validateOverrides([]).ok, false)
  assert.equal(validateOverrides('nope').ok, false)
  assert.equal(validateOverrides({ fx: { rate: 0 } }).ok, false)
  assert.equal(validateOverrides({ fx: { rate: -1 } }).ok, false)
  assert.equal(validateOverrides({ fx: { rate: 'x' } }).ok, false)
  assert.equal(validateOverrides({ fx: [] }).ok, false)
  assert.equal(validateOverrides({ models: [] }).ok, false)
  assert.equal(validateOverrides({ models: { a: 5 } }).ok, false)
  assert.equal(validateOverrides({ models: { a: { input: -2 } } }).ok, false)
  assert.equal(validateOverrides({ models: { a: { input: 'free' } } }).ok, false)
  assert.equal(validateOverrides({ models: { '': { input: 1 } } }).ok, false)
})

test('validateOverrides keeps only the fields it understands', () => {
  const accepted = validateOverrides({
    fx: { rate: 6.9, sneaky: 'ignored' },
    models: { 'a/b': { input: 1, output: null, cacheRead: 0.1, cacheWrite: null, extra: 5 } },
    somethingElse: 'dropped',
  })
  assert.equal(accepted.ok, true)
  assert.deepEqual(accepted.patch, {
    fx: { rate: 6.9 },
    models: { 'a/b': { input: 1, output: null, cacheRead: 0.1, cacheWrite: null } },
  })
  assert.equal('somethingElse' in accepted.patch, false)
})

test('the published currency is USD, quoted in CNY', () => {
  assert.equal(PRICE_CURRENCY, 'USD')
})

test('the default source is the per-vendor price list, and both sources are named', () => {
  // Which source answers is a user-visible claim, so the default and the set of
  // acceptable values are pinned rather than left to whoever reads the code.
  assert.equal(DEFAULT_PRICE_SOURCE, 'modelsdev')
  assert.deepEqual(PRICE_SOURCES, ['modelsdev', 'openrouter'])
  assert.match(MODELSDEV_URL, /^https:\/\/models\.dev\//)
  assert.match(OPENROUTER_MODELS_URL, /^https:\/\/openrouter\.ai\//)
})
