/**
 * Host plugin tests.
 *
 * A minimal Cordis stand-in records what the plugin registers and lets a test
 * drive the lifecycle by hand: backfill from a fake persistence service, live
 * session events, the `/tokens` command, and the flush-on-dispose contract.
 *
 * @module dsh-token-ledger/test/plugin.test
 */

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { apply, name } from '../lib/index.js'
import { ledgerPaths, loadLedger } from '../lib/store.js'
import { ALPHA_EVENTS, BETA_EVENTS, BETA_INHERITED, DAY3, fakeSession, withSeq } from './fixtures.mjs'

/**
 * A Cordis context stand-in recording registrations.
 *
 * @param {Record<string, unknown>} services - services `ctx.get` should return.
 * @returns {object} the stand-in plus inspection helpers.
 */
function makeCtx(services = {}) {
  const listeners = new Map()
  const disposers = []
  const registered = []
  const logs = []

  const ctx = {
    logger: {
      info: (...args) => logs.push(['info', args]),
      warn: (...args) => logs.push(['warn', args]),
    },
    on: (event, listener) => {
      const current = listeners.get(event) ?? []
      current.push(listener)
      listeners.set(event, current)
    },
    get: (serviceName) => services[serviceName],
    inject: (deps, callback) => {
      const available = deps.every((dep) => services[dep] !== undefined)
      if (!available) return
      const scoped = { ...ctx }
      for (const dep of deps) scoped[dep] = services[dep]
      callback(scoped)
    },
    effect: (factory) => {
      disposers.push(factory())
    },
  }

  return {
    ctx,
    logs,
    disposers,
    registered,
    /** Deliver an event to every listener registered for it. */
    emit: (event, ...args) => {
      for (const listener of listeners.get(event) ?? []) listener(...args)
    },
    /** Run every dispose callback and await them. */
    dispose: async () => {
      for (const disposer of disposers) await disposer()
    },
  }
}

/**
 * Run `apply` against a temporary DSH home.
 *
 * @param {object} options - the harness inputs.
 * @param {object} [options.persistence] - a persistence service stand-in.
 * @param {object[]} [options.liveSessions] - sessions `ctx.get('sessions')` should list.
 * @param {object} [options.config] - plugin config.
 * @param {object} [options.extraServices] - further services, e.g. a `webServer`.
 * @param {(url: string, options: object) => Promise<object>} [options.fetchImpl] - what the pricing refresh should see.
 * @param {string} [options.home] - an existing DSH home to reuse, so a second run can be tested against the first one's files. The caller then owns it.
 * @returns {Promise<{ harness: object, home: string, commands: object[], fetches: object[], settle: () => Promise<void>, cleanup: () => void }>} the harness.
 */
async function mount({ persistence, liveSessions = [], config, extraServices = {}, fetchImpl, home: givenHome } = {}) {
  const ownsHome = givenHome === undefined
  const home = givenHome ?? mkdtempSync(join(tmpdir(), 'token-ledger-plugin-'))

  const services = {}
  if (persistence !== undefined) services.sessionPersistence = persistence
  if (liveSessions.length > 0 || persistence === undefined) {
    services.sessions = { list: () => liveSessions }
  }
  const registeredCommands = []
  const commands = {
    register: (definition) => {
      registeredCommands.push(definition)
      return () => {}
    },
  }
  services.commands = commands
  Object.assign(services, extraServices)

  // The pricing refresh fetches on startup, so the network is replaced for the
  // whole mount. A test that reached the real internet would be slow, flaky, and
  // dependent on a firewall; this way the offline path is what gets exercised,
  // which is also the path a user behind one of those firewalls sees.
  const previousFetch = globalThis.fetch
  const fetches = []
  globalThis.fetch = (url, options) => {
    fetches.push({ url: String(url), options })
    if (typeof fetchImpl === 'function') return fetchImpl(String(url), options)
    return Promise.resolve({ ok: false, status: 599, statusText: 'offline in tests', text: () => Promise.resolve('') })
  }

  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const harness = makeCtx(services)
  apply(harness.ctx, config)
  // Let the fire-and-forget backfill and pricing refresh settle.
  const settle = async () => {
    for (let index = 0; index < 20; index += 1) await new Promise((resolve) => setImmediate(resolve))
  }
  await settle()

  return {
    harness,
    home,
    commands: registeredCommands,
    fetches,
    settle,
    cleanup: () => {
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
      if (previousFetch === undefined) delete globalThis.fetch
      else globalThis.fetch = previousFetch
      if (ownsHome) rmSync(home, { recursive: true, force: true })
    },
  }
}

test('exports the plugin shape the loader expects', () => {
  assert.equal(name, 'token-ledger')
  assert.equal(typeof apply, 'function')
})

test('starts with an empty ledger when nothing is stored', async () => {
  const mounted = await mount()
  try {
    assert.ok(mounted.commands.some((command) => command.name === 'tokens'))
    assert.ok(mounted.harness.logs.some(([, args]) => String(args[0]).includes('started a new ledger')))
  } finally {
    mounted.cleanup()
  }
})

test('backfills stored sessions, cutting only a fork prefix', async () => {
  const persistence = {
    list: async () => [{ id: 'sess-alpha' }, { id: 'sess-beta' }],
    inspect: async (id) => {
      if (id === 'sess-alpha') return { meta: { id }, events: withSeq(ALPHA_EVENTS) }
      return {
        meta: { id, parentSession: 'sess-parent' },
        inheritedEventCount: BETA_INHERITED,
        events: withSeq(BETA_EVENTS),
      }
    },
  }
  const mounted = await mount({ persistence })
  try {
    const path = ledgerPaths(mounted.home, {}).ledger
    await mounted.harness.dispose()
    const snapshot = loadLedger(path)
    assert.equal(snapshot.totals.totalTokens, 6220 + 15)
    assert.equal(snapshot.totals.calls, 6)
    // The forked session's inherited 1,000,000-token call must be absent.
    assert.equal(snapshot.sessions.find((session) => session.sessionId === 'sess-beta').totalTokens, 15)
  } finally {
    mounted.cleanup()
  }
})

test('a resume without a parent is folded in full', async () => {
  const resumeEvents = withSeq([...ALPHA_EVENTS.slice(0, 5), { type: 'session/end-seed', seq: 5, time: DAY3, data: {} }])
  const persistence = {
    list: async () => [{ id: 'sess-resume' }],
    // Storage reports a cut, but with no parent the prefix is this session's own.
    inspect: async (id) => ({ meta: { id }, inheritedEventCount: 5, events: resumeEvents }),
  }
  const mounted = await mount({ persistence })
  try {
    await mounted.harness.dispose()
    const snapshot = loadLedger(ledgerPaths(mounted.home, {}).ledger)
    // Events 0..4 include the header, a sample and one completed step, all counted.
    assert.equal(snapshot.totals.totalTokens, 1250)
  } finally {
    mounted.cleanup()
  }
})

test('folds live session events and flushes them on dispose', async () => {
  const mounted = await mount()
  try {
    const session = fakeSession('sess-live', withSeq(ALPHA_EVENTS))
    mounted.harness.emit('session/created', session)
    mounted.harness.emit('session/event', session)
    // A second delivery of the same state must not double count.
    mounted.harness.emit('session/event', session)
    await mounted.harness.dispose()

    const snapshot = loadLedger(ledgerPaths(mounted.home, {}).ledger)
    assert.equal(snapshot.totals.totalTokens, 6220)
    assert.equal(snapshot.sessions.length, 1)
    assert.equal(snapshot.sessions[0].sessionId, 'sess-live')
  } finally {
    mounted.cleanup()
  }
})

test('a restarted plugin resumes from the stored cursor', async () => {
  const first = await mount()
  try {
    const session = fakeSession('sess-live', withSeq(ALPHA_EVENTS))
    first.harness.emit('session/created', session)
    first.harness.emit('session/event', session)
    await first.harness.dispose()

    // Restart against the same home with one more call appended.
    const grown = withSeq([
      ...ALPHA_EVENTS,
      { type: 'assistant/message', time: DAY3, data: { turn: 4, step: 1, usage: { inputTokens: 9, outputTokens: 1 } } },
    ])
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = first.home
    const second = makeCtx({ sessions: { list: () => [fakeSession('sess-live', grown)] }, commands: { register: () => () => {} } })
    apply(second.ctx)
    await second.dispose()
    process.env.DSH_HOME = previousHome

    const snapshot = loadLedger(ledgerPaths(first.home, {}).ledger)
    assert.equal(snapshot.totals.totalTokens, 6220 + 10)
  } finally {
    first.cleanup()
  }
})

/**
 * Regression: the command registry requires `input` to be an object carrying a
 * non-empty `hint` string. Registering a bare string threw
 * `TypeError: command "tokens" input hint must be a string` inside the mount,
 * which aborted the rest of `apply()` — the command never registered, and the
 * flush-on-dispose effect was never installed either. Nothing but a live host
 * surfaced this, so the contract is asserted here.
 */
test('the /tokens definition satisfies the command registry contract', async () => {
  const mounted = await mount()
  try {
    const command = mounted.commands.find((definition) => definition.name === 'tokens')
    assert.ok(command !== undefined, 'no command was registered')
    assert.match(command.name, /^[a-z]+$/)
    assert.equal(typeof command.description, 'string')
    assert.ok(command.description.trim() !== '')
    assert.equal(typeof command.handler, 'function')
    assert.equal(typeof command.input, 'object', 'input must be an object, not a bare string')
    assert.equal(typeof command.input.hint, 'string')
    assert.ok(command.input.hint.trim() !== '', 'input.hint must not be empty')
  } finally {
    mounted.cleanup()
  }
})

/**
 * Regression: a fork whose declared count cannot index the array it arrived
 * with must be folded whole and warned about. Refusing it loses the session's
 * own usage silently; folding it whole over-counts the parent prefix, which the
 * warning makes visible.
 */
test('a fork with an unusable declared cut is folded whole, with a warning', async () => {
  const persistence = {
    list: async () => [{ id: 'sess-fork' }],
    inspect: async () => ({
      meta: { id: 'sess-fork', parentSession: 'sess-parent' },
      // Logical-event coordinates, against a much shorter row-form array.
      inheritedEventCount: 13757,
      events: withSeq(ALPHA_EVENTS),
    }),
  }
  const mounted = await mount({ persistence })
  try {
    await mounted.harness.dispose()
    const snapshot = loadLedger(ledgerPaths(mounted.home, {}).ledger)
    // Folded whole rather than zeroed.
    assert.equal(snapshot.totals.totalTokens, 6220)
    assert.ok(
      mounted.harness.logs.some(
        ([level, args]) => level === 'warn' && String(args[0]).includes('no usable inheritance boundary'),
      ),
      JSON.stringify(mounted.harness.logs),
    )
  } finally {
    mounted.cleanup()
  }
})

test('a fork carrying its boundary marker is cut after it', async () => {
  const events = withSeq([
    { type: 'session', id: 'sess-fork', parentSession: 'sess-parent' },
    BETA_EVENTS[2],
    { type: 'session/end-seed', time: DAY3, data: {} },
    BETA_EVENTS[4],
  ])
  const persistence = {
    list: async () => [{ id: 'sess-fork' }],
    inspect: async () => ({ meta: { id: 'sess-fork', parentSession: 'sess-parent' }, inheritedEventCount: 13757, events }),
  }
  const mounted = await mount({ persistence })
  try {
    await mounted.harness.dispose()
    const snapshot = loadLedger(ledgerPaths(mounted.home, {}).ledger)
    // Only the post-marker call, even though the declared count overshoots.
    assert.equal(snapshot.totals.totalTokens, 15)
    assert.ok(
      !mounted.harness.logs.some(([level, args]) => level === 'warn' && String(args[0]).includes('inheritance boundary')),
      'a marker was present, so no warning was expected',
    )
  } finally {
    mounted.cleanup()
  }
})

test('both settings page routes are registered and logged when a web server exists', async () => {
  const routes = []
  const disposed = []
  const mounted = await mount({
    extraServices: {
      webServer: {
        register: (route) => {
          routes.push(route)
          return () => disposed.push(route.path)
        },
      },
    },
  })
  try {
    assert.equal(routes.length, 2, 'the overview and the rates route should both be registered')
    assert.deepEqual(
      routes.map((route) => [route.kind, route.path]),
      [
        ['exact', '/api/token-ledger/summary'],
        ['exact', '/api/token-ledger/rates'],
      ],
    )
    for (const route of routes) assert.equal(typeof route.handler, 'function')
    // The log line is what the settings page cannot tell the user: from the
    // browser, "no web server" and "registration failed" look the same.
    assert.ok(
      mounted.harness.logs.some(
        ([level, args]) => level === 'info' && String(args[0]).includes('settings page routes ready'),
      ),
      JSON.stringify(mounted.harness.logs),
    )
    // Disposing the plugin must hand both routes back.
    await mounted.harness.dispose()
    assert.deepEqual(disposed.sort(), ['/api/token-ledger/rates', '/api/token-ledger/summary'])
  } finally {
    mounted.cleanup()
  }
})

test('the startup refresh is attempted once and a blocked network is not an error', async () => {
  const mounted = await mount()
  try {
    assert.equal(mounted.fetches.length, 2, 'one catalogue fetch and one rate fetch')
    for (const call of mounted.fetches) {
      assert.match(String(call.options?.headers?.accept ?? ''), /json/)
      assert.ok(call.options?.signal !== undefined, 'a refresh that hangs must be able to abort')
    }
    // The failure is recorded, not thrown: the host has to keep running on a
    // machine whose firewall answers nothing.
    assert.equal(
      mounted.harness.logs.some(([, args]) => String(args[0]).includes('rates refresh')),
      true,
      'a refresh attempt should be logged with its outcome',
    )
    const stored = JSON.parse(readFileSync(ledgerPaths(mounted.home, {}).rates, 'utf8'))
    assert.equal(stored.lastRefresh.catalogue.startsWith('failed'), true)
    assert.equal(stored.catalogue, undefined)
  } finally {
    mounted.cleanup()
  }
})

test('rates: false leaves hand-entered prices as the only source', async () => {
  const mounted = await mount({ config: { rates: false } })
  try {
    assert.equal(mounted.fetches.length, 0, 'a strictly offline host must make no request at all')
    assert.ok(
      mounted.harness.logs.some(([, args]) => String(args[0]).includes('pricing refresh is disabled')),
      JSON.stringify(mounted.harness.logs),
    )
  } finally {
    mounted.cleanup()
  }
})

test('a cached catalogue is still served to a later host with no network at all', async () => {
  const home = mkdtempSync(join(tmpdir(), 'token-ledger-cache-'))
  const catalogue = {
    data: [
      { id: 'acme/two', name: 'Acme Two', created: 200, pricing: { prompt: '0.000002', completion: '0.000008' } },
      { id: 'acme/one', name: 'Acme One', created: 100, pricing: { prompt: '0.000001', completion: '0.000004' } },
    ],
  }
  const fx = { base_code: 'USD', rates: { CNY: 7.25 }, time_last_update_unix: 1_700_000_000 }
  const served = (route) => {
    const res = { status: 0, body: '', writeHead(status) { this.status = status }, end(text) { this.body = text ?? '' } }
    return Promise.resolve(route.handler({ method: 'GET', headers: {}, socket: { remoteAddress: '127.0.0.1' } }, res)).then(() => res)
  }

  // First host: online, so the prices are fetched and cached beside the ledger.
  const online = await mount({
    home,
    extraServices: { webServer: { register: () => () => {} } },
    fetchImpl: (url) =>
      Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(String(url).includes('openrouter') ? catalogue : fx)) }),
  })
  try {
    const stored = JSON.parse(readFileSync(ledgerPaths(home, {}).rates, 'utf8'))
    assert.equal(stored.catalogue.vendors[0].vendor, 'acme')
    assert.equal(stored.catalogue.vendors[0].models[0].id, 'acme/two', 'the newest model comes first')
    assert.equal(stored.catalogue.vendors[0].models[0].prices.input, 2, 'USD per million tokens')
    assert.equal(stored.catalogue.vendors[0].models[0].prices.cacheRead, null)
    assert.equal(stored.fx.rate, 7.25)
  } finally {
    online.cleanup()
  }

  const routes = []
  const offline = await mount({
    home,
    extraServices: { webServer: { register: (route) => routes.push(route) } },
  })
  try {
    const res = await served(routes[1])
    assert.equal(res.status, 200)
    const body = JSON.parse(res.body)
    assert.equal(body.catalogue.available, true, 'the cached catalogue survives a host with no network')
    assert.equal(body.vendors[0].models[0].prices.input, 2)
    assert.equal(body.fx.rate, 7.25)
    // ...and the failed refresh is visible as an age, not as an empty page.
    assert.equal(typeof body.catalogue.ageMs, 'number')
    assert.match(body.lastRefresh.catalogue, /^failed/)
  } finally {
    offline.cleanup()
    rmSync(home, { recursive: true, force: true })
  }
})

test('no web server is not an error: the rest of the plugin still works', async () => {
  const mounted = await mount()
  try {
    assert.ok(mounted.commands.some((command) => command.name === 'tokens'))
    assert.equal(
      mounted.harness.logs.some(([, args]) => String(args[0]).includes('overview route failed')),
      false,
      'an absent web server must not be reported as a failure',
    )
  } finally {
    mounted.cleanup()
  }
})

test('/tokens answers summary, path, json and export', async () => {
  const mounted = await mount()
  try {
    const session = fakeSession('sess-live', withSeq(ALPHA_EVENTS))
    mounted.harness.emit('session/created', session)
    const command = mounted.commands.find((definition) => definition.name === 'tokens')

    const summary = command.handler({ rawInput: '' })
    assert.equal(summary.kind, 'success')
    assert.match(summary.text, /6,220/)

    const explicit = command.handler({ rawInput: 'summary' })
    assert.match(explicit.text, /Token ledger/)

    const path = command.handler({ rawInput: 'path' })
    assert.equal(path.text, ledgerPaths(mounted.home, {}).ledger)

    const json = command.handler({ rawInput: 'json' })
    assert.equal(JSON.parse(json.text).totals.totalTokens, 6220)

    const exported = command.handler({ rawInput: 'export' })
    assert.equal(exported.kind, 'success', exported.text)
    assert.equal(exported.text.split('\n').length, 5)
    assert.ok(existsSync(join(mounted.home, 'token-ledger', 'exports')))
  } finally {
    mounted.cleanup()
  }
})

test('/tokens rejects an unknown argument and surfaces export failures', async () => {
  const mounted = await mount()
  try {
    const command = mounted.commands.find((definition) => definition.name === 'tokens')
    const bad = command.handler({ rawInput: 'nope' })
    assert.equal(bad.kind, 'error')
    assert.match(bad.text, /usage: \/tokens/)

    // Make the export destination unwritable by occupying it with a file.
    const exportsDir = ledgerPaths(mounted.home, {}).exportsDir
    mkdirSync(join(mounted.home, 'token-ledger'), { recursive: true })
    writeFileSync(exportsDir, 'not a directory')
    const failed = command.handler({ rawInput: 'export' })
    assert.equal(failed.kind, 'error')
    assert.match(failed.text, /export failed/)
  } finally {
    mounted.cleanup()
  }
})

test('a broken persistence service degrades to a warning', async () => {
  const persistence = {
    list: async () => {
      throw new Error('storage offline')
    },
  }
  const mounted = await mount({ persistence })
  try {
    assert.ok(
      mounted.harness.logs.some(([level, args]) => level === 'warn' && String(args[0]).includes('backfill failed')),
      JSON.stringify(mounted.harness.logs),
    )
  } finally {
    mounted.cleanup()
  }
})

test('an unreadable stored session does not stop the others', async () => {
  const persistence = {
    list: async () => [{ id: 'sess-bad' }, { id: 'sess-alpha' }],
    inspect: async (id) => {
      if (id === 'sess-bad') throw new Error('torn record')
      return { meta: { id }, events: withSeq(ALPHA_EVENTS) }
    },
  }
  const mounted = await mount({ persistence })
  try {
    await mounted.harness.dispose()
    const snapshot = loadLedger(ledgerPaths(mounted.home, {}).ledger)
    assert.equal(snapshot.totals.totalTokens, 6220)
    assert.ok(
      mounted.harness.logs.some(([level, args]) => level === 'warn' && String(args[0]).includes('could not read stored session')),
    )
  } finally {
    mounted.cleanup()
  }
})

test('backfill can be turned off by config', async () => {
  const persistence = {
    list: async () => [{ id: 'sess-alpha' }],
    inspect: async (id) => ({ meta: { id }, events: withSeq(ALPHA_EVENTS) }),
  }
  const mounted = await mount({ persistence, config: { backfill: false } })
  try {
    await mounted.harness.dispose()
    const snapshot = loadLedger(ledgerPaths(mounted.home, {}).ledger)
    assert.equal(snapshot.totals.totalTokens, 0)
  } finally {
    mounted.cleanup()
  }
})

test('an explicit ledgerPath config wins', async () => {
  const mounted = await mount()
  try {
    const custom = join(mounted.home, 'elsewhere', 'my-ledger.json')
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = mounted.home
    const harness = makeCtx({ commands: { register: () => () => {} } })
    apply(harness.ctx, { ledgerPath: custom, backfill: false })
    harness.emit('session/created', fakeSession('sess-live', withSeq(ALPHA_EVENTS)))
    await harness.dispose()
    process.env.DSH_HOME = previousHome

    assert.ok(existsSync(custom), 'expected the configured ledger path to be written')
    const snapshot = JSON.parse(readFileSync(custom, 'utf8'))
    assert.equal(snapshot.totals.totalTokens, 6220)
  } finally {
    mounted.cleanup()
  }
})
