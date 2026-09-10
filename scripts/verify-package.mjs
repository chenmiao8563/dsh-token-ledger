#!/usr/bin/env node
/**
 * Pre-publish checks for the properties that make this package installable.
 *
 * The point is not to restate what npm already validates. It is to fail the
 * build when one of the promises the README makes stops being true:
 *
 * 1. no runtime, peer or optional dependencies;
 * 2. no install scripts, so a git-URL install never needs a build to be
 *    authorized;
 * 3. no bare module specifiers in shipped code, so the plugin loads from any
 *    profile without resolving a single package;
 * 4. every path named in `files`, `exports`, `bin` and `dsh.bundle.patch`
 *    actually exists;
 * 5. the plugin and the CLI really load and answer.
 *
 * Run with `npm run verify`.
 *
 * @module dsh-token-ledger/scripts/verify-package
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const failures = []
const notes = []

/**
 * Record a check result.
 *
 * @param {boolean} ok - whether the check passed.
 * @param {string} label - the human-readable check.
 * @param {string} [detail] - extra context on failure.
 * @returns {void}
 */
function check(ok, label, detail = '') {
  if (ok) notes.push(`  ok    ${label}`)
  else failures.push(`  FAIL  ${label}${detail === '' ? '' : ` — ${detail}`}`)
}

const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies', 'bundledDependencies']) {
  const value = manifest[field]
  check(
    value === undefined || Object.keys(value).length === 0,
    `no ${field}`,
    value === undefined ? '' : JSON.stringify(value),
  )
}

for (const forbidden of ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish']) {
  check(
    manifest.scripts?.[forbidden] === undefined,
    `no ${forbidden} script`,
    manifest.scripts?.[forbidden] ?? '',
  )
}

check(typeof manifest.engines?.node === 'string', 'declares a Node engine range', String(manifest.engines?.node))

const listed = []
const walk = (path) => {
  const stats = statSync(path)
  if (stats.isDirectory()) {
    for (const entry of readdirSync(path)) walk(join(path, entry))
  } else listed.push(path)
}
for (const entry of manifest.files ?? []) {
  const target = join(root, entry)
  let exists = true
  try {
    statSync(target)
  } catch {
    exists = false
  }
  check(exists, `files entry exists: ${entry}`)
}
walk(join(root, 'lib'))
walk(join(root, 'bin'))

const exportsTargets = []
const collectExports = (value) => {
  if (typeof value === 'string') exportsTargets.push(value)
  else if (value !== null && typeof value === 'object') for (const nested of Object.values(value)) collectExports(nested)
}
collectExports(manifest.exports)
for (const target of exportsTargets) {
  let exists = true
  try {
    statSync(join(root, target))
  } catch {
    exists = false
  }
  check(exists, `exports target exists: ${target}`)
}

for (const [name, target] of Object.entries(manifest.bin ?? {})) {
  const path = join(root, target)
  let text = ''
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    check(false, `bin target exists: ${target}`)
    continue
  }
  check(true, `bin target exists: ${name} -> ${target}`)
  check(text.startsWith('#!/usr/bin/env node'), `bin has a node shebang: ${name}`)
}

// The patch must insert this very package by its real name, otherwise a profile
// install would either do nothing or point at the wrong module.
const patchPath = join(root, manifest.dsh?.bundle?.patch ?? 'cordis.patch.yml')
let patch = ''
try {
  patch = readFileSync(patchPath, 'utf8')
} catch {
  check(false, 'dsh.bundle.patch exists', patchPath)
}
check(patch.includes(`name: '${manifest.name}'`), `bundle patch inserts ${manifest.name}`)

// Bare specifiers are what break a loose module or an unhoisted profile.
const BARE_IMPORT = /(?:^|\n)\s*(?:import|export)[^'"\n]*?from\s+['"]([^'"]+)['"]|(?:^|\n)\s*import\s*\(\s*['"]([^'"]+)['"]\s*\)/g
for (const path of listed) {
  if (!path.endsWith('.js') && !path.endsWith('.mjs')) continue
  const text = readFileSync(path, 'utf8')
  for (const match of text.matchAll(BARE_IMPORT)) {
    const specifier = match[1] ?? match[2]
    if (specifier.startsWith('.') || specifier.startsWith('node:')) continue
    check(false, `no bare specifier in ${path.slice(root.length + 1)}`, specifier)
  }
}
check(true, 'shipped modules import only node: builtins and relative files')

const plugin = await import(pathToFileURL(join(root, 'lib/index.js')).href)
check(plugin.name === 'token-ledger', 'plugin exports its name', String(plugin.name))
check(typeof plugin.apply === 'function', 'plugin exports apply()')
check(typeof plugin.default?.apply === 'function', 'plugin default export carries apply()')

const { run } = await import(pathToFileURL(join(root, 'lib/cli.js')).href)
let version = ''
const versionCode = run(['--version'], { stdout: (text) => (version += text), stderr: () => {}, env: {} })
check(versionCode === 0 && version.trim() === manifest.version, 'cli --version matches package.json', version.trim())

let helped = ''
run(['--help'], { stdout: (text) => (helped += text), stderr: () => {}, env: {} })
for (const command of ['summary', 'audit', 'rebuild', 'export']) {
  check(helped.includes(command), `cli help documents "${command}"`)
}

// The browser half has its own contract, and none of it is enforced by npm.
const browserHalf = readFileSync(join(root, 'lib/client.js'), 'utf8')

// It is a module for the client's global loader, not an ES module. Leading
// comments are stripped first, because the file documents itself before it runs.
const browserCode = browserHalf.replace(/^(?:\s*\/\*[\s\S]*?\*\/|\s*\/\/[^\n]*|\s)+/, '')
check(
  browserCode.startsWith('window.__ModuleLoader__.load('),
  'the browser half registers itself with the client module loader',
  browserCode.slice(0, 40),
)
const moduleId = /__ModuleLoader__\.load\(\s*\{\s*id:\s*['"`]([^'"`]+)['"`]/.exec(browserHalf)?.[1]
check(moduleId === manifest.name, 'the client module id is the package name', String(moduleId))

// Everything it requires must be provided by the loader; anything else would be
// unresolvable at runtime, because there is no bundler and no node_modules.
const LOADER_PROVIDED = new Set(['react', 'react-dom', 'react/jsx-runtime'])
for (const match of browserHalf.matchAll(/require\(\s*['"`]([^'"`]+)['"`]\s*\)/g)) {
  check(
    LOADER_PROVIDED.has(match[1]),
    `client require("${match[1]}") is loader-provided`,
    'only react, react-dom and react/jsx-runtime are supplied by the loader',
  )
}
// A file the browser loads verbatim has to be valid JavaScript on its own: no
// ESM syntax, and nothing that only a bundler would resolve.
check(!/^\s*(import|export)\s/m.test(browserHalf), 'the browser half has no import/export statements')
try {
  new vm.Script(browserHalf, { filename: 'lib/client.js' })
  check(true, 'the browser half compiles as a classic script')
} catch (error) {
  check(false, 'the browser half compiles as a classic script', error.message)
}

// The manifest must declare the browser half and the packages it needs, or the
// client loader never loads it.
//
// These checks mirror `parseDshClient` in @deepseek-ai/dsh-client-modules, which
// THROWS on a malformed declaration while scanning at activation. A malformed
// `dsh.client` is therefore not a cosmetic problem: it can stop the profile from
// booting at all, so every rule that function enforces is repeated here where a
// `prepublishOnly` run will catch it.
const clientDecl = manifest.dsh?.client
check(
  typeof clientDecl === 'object' && clientDecl !== null,
  'dsh.client is an object',
  JSON.stringify(clientDecl),
)
check(typeof clientDecl?.platform === 'string', 'dsh.client.platform is a string', String(clientDecl?.platform))
check(clientDecl?.platform === 'web', 'declares a web client half', String(clientDecl?.platform))

/**
 * Assert a `dsh.client` field is an optional array of non-empty strings.
 *
 * @param {string} field - the field name, for the message.
 * @returns {string[]} the names, when present.
 */
function optionalStringArray(field) {
  const value = clientDecl?.[field]
  if (value === undefined) {
    check(true, `dsh.client.${field} is absent or a string array`)
    return []
  }
  const ok = Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim() !== '')
  check(ok, `dsh.client.${field} is an array of non-empty strings`, JSON.stringify(value))
  return ok ? value : []
}

if (clientDecl?.immediately !== undefined) {
  check(typeof clientDecl.immediately === 'boolean', 'dsh.client.immediately is a boolean', String(clientDecl.immediately))
}

const clientInject = optionalStringArray('inject')
check(clientInject.length > 0, 'declares the client packages it injects', JSON.stringify(clientInject))
optionalStringArray('external')

// Every name here must be a package that ships a client bundle, because the boot
// wire is keyed by package id and only rows exist there. A core library such as
// @deepseek-ai/dsh-client-ui-slots exports no "./client" and declares no
// `dsh.client`, so it is never a row — listing one is a silent no-op at best.
// This script cannot resolve those packages offline, so it pins the namespace
// and the reviewer checks the rest.
for (const name of clientInject) {
  check(
    name.startsWith('@deepseek-ai/dsh-client-'),
    `client inject "${name}" is in the client-half namespace`,
    'only packages that ship a "./client" bundle may be listed',
  )
}
check(
  manifest.exports?.['./client'] === './lib/client.js',
  'exports the browser half as ./client',
  String(manifest.exports?.['./client']),
)

console.log(notes.join('\n'))
if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n${failures.join('\n')}`)
  process.exit(1)
}
console.log(`\nall ${notes.length} checks passed`)
