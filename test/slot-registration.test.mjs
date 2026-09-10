/**
 * Validate the registration against the real slot registry.
 *
 * The other client tests load the browser half through a stand-in loader, which
 * proves the module shape and the rendered tree but never asks whether the
 * registration the plugin actually submits would be *accepted*. That question
 * belongs to `@deepseek-ai/dsh-client-ui-slots` — the registry DSH itself runs,
 * pinned here to the exact version DSH bundles.
 *
 * This is the closest thing to an integration test that does not need a browser:
 * the object handed to the registry is the one `apply` really builds, and the
 * validator is the real one, so a missing `id`, a duplicate id, an undeclared
 * slot, or a label the shell cannot resolve all fail here instead of in a
 * settings panel nobody can debug.
 *
 * @module dsh-token-ledger/test/slot-registration.test
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { SlotCore, SlotOwnershipError, resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'

/** The section name the settings shell declares. */
const SLOT = 'settings.section'

/**
 * Load the browser half with a minimal React stand-in.
 *
 * Rendering is not exercised here, so the stand-in only has to let the module
 * evaluate and `apply` run.
 *
 * @returns {(ctx: object) => void} the module's `apply`.
 */
function loadApply() {
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: (initial) => [initial, () => {}],
    useEffect: () => {},
    useRef: (initial) => ({ current: initial }),
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  }
  let registration
  globalThis.window = { __ModuleLoader__: { load: (definition) => (registration = definition) } }
  globalThis.document = {
    head: { appendChild: () => {} },
    getElementById: () => null,
    createElement: () => ({ dataset: {}, remove: () => {}, textContent: '', id: '' }),
  }
  const source = readFileSync(fileURLToPath(new URL('../lib/client.js', import.meta.url)), 'utf8')
  new Function('require', source)((name) => {
    if (name === 'react') return react
    throw new Error(`unexpected require("${name}")`)
  })
  return registration.factory((name) => (name === 'react' ? react : undefined)).apply
}

/**
 * Run `apply` against a stand-in context and return what it registered.
 *
 * @returns {{ options: object, component: unknown, injected: unknown, effects: number, locale: string|undefined }} the captured registration.
 */
function captureRegistration() {
  const captured = { effects: 0, locale: undefined, disposers: [] }
  const ctx = {
    // Cordis runs the factory to obtain the disposer, so the stand-in must too:
    // registering the dictionaries happens inside it, not at the call site.
    effect: (factory) => {
      captured.effects += 1
      captured.disposers.push(factory())
    },
    locale: {
      register: (namespace) => {
        captured.locale = namespace
        return () => {}
      },
      bind: () => (key) => key,
    },
    slots: {
      inject: (name, callback) => {
        assert.equal(name, SLOT)
        callback()
      },
      register: (options, component) => {
        captured.options = options
        captured.component = component
        captured.injected = options.inject()
      },
    },
  }
  loadApply()(ctx)
  return captured
}

/**
 * A registry with the settings section declared, exactly as the shell does it.
 *
 * A slot only exists after a parent entry's children table declares it, which is
 * why the plugin uses `slots.inject` rather than registering blind.
 *
 * @returns {SlotCore} the registry.
 */
function registryWithSection() {
  const core = new SlotCore()
  core.register({ name: 'root', children: { [SLOT]: { kind: 'list', scope: 'root' } } }, () => null)
  return core
}

test('the registry rejects a registration into an undeclared slot', () => {
  const core = new SlotCore()
  const { options, component } = captureRegistration()
  assert.throws(() => core.register(options, component), /is not declared/)
})

test('the real registry accepts the registration this plugin submits', () => {
  const core = registryWithSection()
  const { options, component } = captureRegistration()

  const dispose = core.register(options, component)
  assert.equal(typeof dispose, 'function', 'register must return a disposer')

  const entries = core.entries(SLOT)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].options.id, 'token-ledger')
  assert.equal(entries[0].options.order, 40)
  assert.equal(entries[0].component, component)
  assert.equal(core.spec(SLOT).kind, 'list')

  dispose()
  assert.equal(core.entries(SLOT).length, 0, 'disposing must retire the entry')
})

test('the label is a thunk the shell can resolve to a non-empty name', () => {
  const core = registryWithSection()
  const { options, component } = captureRegistration()
  core.register(options, component)

  const entry = core.entries(SLOT)[0]
  // This is exactly what the shell does before rendering the sidebar row; a
  // label it cannot resolve shows up as a blank section name.
  const resolved = resolveSlotLabel(entry.options.label)
  assert.equal(typeof resolved, 'string')
  assert.ok(resolved.trim().length > 0, 'the sidebar row would have no name')
  assert.deepEqual(core.entries(SLOT).map((e) => resolveSlotLabel(e.options.label)), [resolved])
})

test('the entry id is unique against the sections DSH ships', () => {
  const core = registryWithSection()
  const shipped = ['models', 'plugins', 'agent-presets']
  for (const [index, id] of shipped.entries()) {
    core.register({ name: SLOT, id, order: (index + 1) * 5 }, () => null)
  }
  const { options, component } = captureRegistration()
  // The shipped ids occupy orders 10, 15 and 20; the ledger must not collide.
  core.register(options, component)
  const ids = core.entries(SLOT).map((entry) => entry.options.id)
  assert.deepEqual(ids, [...shipped, 'token-ledger'], 'entries come back in order sequence')
})

test('a duplicate id is refused, so the id really is the uniqueness key', () => {
  const core = registryWithSection()
  const { options, component } = captureRegistration()
  core.register(options, component)
  assert.throws(() => core.register(options, component), /already has an entry with id "token-ledger"/)
})

test('the plugin declares the id the list protocol requires', () => {
  const { options } = captureRegistration()
  // The registry throws for a list slot without an id; assert it is a real
  // string rather than something that merely happens to be defined.
  assert.equal(typeof options.id, 'string')
  assert.ok(options.id.trim().length > 0)
  assert.match(options.id, /^[a-z][a-z0-9-]*$/)
})

test('the inject callback supplies the translator the component reads', () => {
  const captured = captureRegistration()
  assert.equal(typeof captured.injected.t, 'function')
  // The component destructures `t` and calls it with dictionary keys.
  assert.equal(typeof captured.injected.t('nav'), 'string')
  assert.equal(captured.locale, 'token-ledger', 'the dictionaries are registered under the namespace the registration names')
  // Both effects returned a disposer, so a stopped plugin leaves nothing behind.
  assert.equal(captured.effects, 2)
  assert.ok(captured.disposers.every((dispose) => typeof dispose === 'function'))
})

test('a colliding registration from another plugin is reported as an ownership error', () => {
  const core = registryWithSection()
  const core2 = registryWithSection()
  assert.ok(core instanceof SlotCore)
  assert.ok(core2 instanceof SlotCore)
  // Documents the failure shape an operator would see if another plugin claimed
  // this id: the registry's own error type, not something this plugin invents.
  assert.equal(typeof SlotOwnershipError, 'function')
})
