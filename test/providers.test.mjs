/**
 * Provider-name tests.
 *
 * The names come from a settings file this plugin does not own, so what is pinned
 * here is the reading of it: the shape DSH actually writes, and every way the file
 * can surprise a scanner — comments, quoting, several `providers:` blocks, and a
 * file that is not there at all.
 *
 * @module dsh-token-ledger/test/providers.test
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createProviderNames, parseProviderNames, settingsPaths } from '../lib/providers.js'

test('reads the provider names out of the shape the harness writes', () => {
  // Trimmed from this machine's `settings.yaml`: the block belongs to the LLM
  // plugin, not to the file root, which is what a top-level-only scan would miss.
  const text = [
    'llm-deepseek:',
    '  apiKeyEnv: DEEPSEEK_API_KEY',
    '  baseURL: https://api.deepseek.com/v1',
    'llm-pi-ai:',
    '  providers:',
    '    bos:',
    '      displayName: BOS-API',
    '      apiKeyEnv: BOS_API_KEY',
    '      baseURL: https://api.cloubic.com/v1',
    '    zai:',
    '      apiKeyEnv: ZAI_API_KEY',
    '      models:',
    '        - id: glm-5.3',
    '          name: GLM-5.3',
    '    qwen-plan:',
    '      apiKeyEnv: QWEN_PLAN_API_KEY',
    '      models:',
    '        - id: qwen3.8-flash',
    '          # a comment with a colon: inside a model list',
    '          name: qwen3.8-flash',
    'dsh-better-sidebar:',
    '  openByDefault: false',
    '  displayName: not a provider',
  ].join('\n')
  assert.deepEqual(parseProviderNames(text), { bos: 'BOS-API' })
})

test('a name is read as written, quotes and comments and all', () => {
  const text = [
    'x:',
    '  providers:',
    '    a:',
    '      displayName: "A 官方 API"',
    '    b:',
    "      displayName: 'B Endpoint'",
    '    c:',
    '      displayName: C-API # the one from work',
    '    d:',
    '      apiKeyEnv: D_KEY',
    '    e:',
    '      displayName:',
  ].join('\n')
  assert.deepEqual(parseProviderNames(text), { a: 'A 官方 API', b: 'B Endpoint', c: 'C-API' })
})

test('several provider blocks are merged, and a missing one is not fatal', () => {
  const text = ['llm-one:', '  providers:', '    a:', '      displayName: A', 'llm-two:', '  providers:', '    b:', '      displayName: B'].join('\n')
  assert.deepEqual(parseProviderNames(text), { a: 'A', b: 'B' })
  assert.deepEqual(parseProviderNames('nothing to see'), {})
  assert.deepEqual(parseProviderNames(''), {})
  assert.deepEqual(parseProviderNames(undefined), {})
  assert.deepEqual(parseProviderNames('providers: {}'), {})
})

test('a name is never guessed from a field that is not a display name', () => {
  // `name:` inside a model list, an `apiKeyEnv` and a `baseURL` must not become
  // provider names, or a bill would label a vendor after a model.
  const text = [
    'llm:',
    '  providers:',
    '    bos:',
    '      baseURL: https://api.cloubic.com/v1',
    '      models:',
    '        - id: deepseek-v4-flash',
    '          name: deepseek-v4-flash',
    '    zai:',
    '      displayName: Z.ai',
  ].join('\n')
  assert.deepEqual(parseProviderNames(text), { zai: 'Z.ai' })
})

test('the reader degrades to no names rather than throwing', () => {
  // No file at either candidate path.
  const missing = createProviderNames({ home: 'C:\\nowhere', options: { readFile: () => { throw new Error('ENOENT') } } })
  assert.deepEqual(missing(), {})

  // A file that cannot be read, and a home that is not a path at all.
  const broken = createProviderNames({ home: '', options: { readFile: () => { throw new Error('EACCES') } } })
  assert.deepEqual(broken(), {})

  // A file whose text is fine but says nothing about providers.
  const silent = createProviderNames({ home: 'C:\\home', options: { readFile: () => 'ui-theme:\n  mode: dark\n' } })
  assert.deepEqual(silent(), {})
})

test('the file is read once per cache window, and re-read after it', () => {
  let reads = 0
  let clock = 1_000
  const read = createProviderNames({
    home: 'C:\\home',
    options: {
      now: () => clock,
      readFile: () => {
        reads += 1
        return 'p:\n  providers:\n    bos:\n      displayName: BOS-API\n'
      },
    },
  })
  assert.deepEqual(read(), { bos: 'BOS-API' })
  read()
  read()
  assert.equal(reads, 1, 'a page that polls does not re-read the file every minute')
  clock += 30_000
  read()
  assert.equal(reads, 2, 'but a settings change is picked up within the window')
})

test('the second candidate path is tried when the first is absent', () => {
  const tried = []
  const read = createProviderNames({
    home: 'C:\\home',
    options: {
      readFile: (path) => {
        tried.push(path)
        if (path.endsWith('.yaml')) throw new Error('ENOENT')
        return 'p:\n  providers:\n    bos:\n      displayName: BOS-API\n'
      },
    },
  })
  assert.deepEqual(read(), { bos: 'BOS-API' })
  assert.equal(tried.length, 2)
  assert.deepEqual(settingsPaths('C:\\home').map((path) => path.endsWith('.yml')), [false, true])
})
