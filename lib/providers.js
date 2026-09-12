/**
 * The display names of the providers a reader has connected.
 *
 * ## Why this reads a settings file
 *
 * A bill grouped by provider should say *BOS-API*, which is what the model settings
 * page calls it, rather than `bos`, which is what the request route calls it. The
 * two are the same thing seen from different sides, and only one of them is in a
 * session log: the ledger records `provider` from the request header, and the
 * display name lives in the harness settings the page writes.
 *
 * So the settings file is **read** — never written, never published through a
 * settings namespace — and only for this one mapping. Everything degrades to the
 * provider id when the file is missing, unreadable, or shaped differently than
 * expected, because a bill that falls back to `bos` is still a correct bill.
 *
 * ## Why a scanner and not a YAML parser
 *
 * A YAML parser is a dependency, and this package's installability claim is that it
 * has none. What is needed is much smaller than YAML: the `providers:` block at the
 * top level, each entry under it, and that entry's `displayName`. The scanner below
 * reads exactly that by indentation, ignores comments and quoted strings' contents,
 * and refuses to guess when the shape is not what it expects.
 *
 * @module dsh-token-ledger/providers
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** How long a read of the settings file is reused, so a poll does not re-read it. */
const CACHE_MS = 30_000

/**
 * Strip a YAML comment and the surrounding quotes from a scalar.
 *
 * @param {string} text - the raw scalar.
 * @returns {string} the value, or an empty string when there was none.
 */
function scalar(text) {
  let value = String(text ?? '')
  // A `#` starts a comment unless it is inside quotes; provider names are short and
  // plain, so the simple rule is enough and a name containing ` # ` is not a name.
  const hash = value.indexOf('#')
  if (hash !== -1) value = value.slice(0, hash)
  value = value.trim()
  if ((value.startsWith('"') && value.endsWith('"') && value.length > 1) || (value.startsWith("'") && value.endsWith("'") && value.length > 1)) {
    value = value.slice(1, -1)
  }
  return value.trim()
}

/**
 * Indentation width of a line, or -1 when the line carries no content.
 *
 * @param {string} line - one line of YAML.
 * @returns {number} the number of leading spaces, or -1 for a blank or comment line.
 */
function indentOf(line) {
  if (typeof line !== 'string') return -1
  const trimmed = line.trim()
  if (trimmed === '' || trimmed.startsWith('#')) return -1
  const match = /^(\s*)/.exec(line)
  return match === null ? 0 : match[1].length
}

/**
 * Read the provider display names out of a settings file's text.
 *
 * The harness settings are keyed by plugin, and the provider list belongs to
 * whichever LLM plugin owns it — `llm-pi-ai.providers.bos.displayName` on the
 * machine this was written against. So every `providers:` block is scanned, at
 * whatever depth it appears, and their entries are merged; a provider named the
 * same way by two plugins is the same provider.
 *
 * @param {string} text - the settings file's contents.
 * @returns {Record<string, string>} provider id to display name, for the providers that have one.
 */
export function parseProviderNames(text) {
  const lines = String(text ?? '').split(/\r?\n/)
  const names = {}

  for (let index = 0; index < lines.length; index += 1) {
    const blockMatch = /^(\s*)providers:\s*(#.*)?$/.exec(lines[index])
    if (blockMatch === null) continue
    const blockIndent = blockMatch[1].length
    let entry = null
    let entryIndent = -1

    for (let inner = index + 1; inner < lines.length; inner += 1) {
      const line = lines[inner]
      const indent = indentOf(line)
      if (indent === -1) continue
      // The block ends at the first line that is not deeper than `providers:` —
      // a sibling key of the plugin, whose own fields are none of our business.
      if (indent <= blockIndent) break

      if (entryIndent === -1) entryIndent = indent
      const trimmed = line.trim()
      if (indent === entryIndent) {
        const entryMatch = /^([A-Za-z0-9._@/-]+):\s*(#.*)?$/.exec(trimmed)
        if (entryMatch !== null) {
          entry = entryMatch[1]
          continue
        }
      }
      if (entry === null) continue
      const nameMatch = /^displayName:\s*(.*)$/.exec(trimmed)
      if (nameMatch !== null) {
        const value = scalar(nameMatch[1])
        if (value !== '') names[entry] = value
      }
    }
  }
  return names
}

/**
 * Where a harness keeps its settings, most specific first.
 *
 * @param {string} home - the resolved DSH home.
 * @returns {string[]} candidate paths.
 */
export function settingsPaths(home) {
  return [join(home, 'settings.yaml'), join(home, 'settings.yml')]
}

/**
 * Build a reader for the provider display names.
 *
 * The file is re-read at most every {@link CACHE_MS}, which is enough for a page
 * that polls once a minute and cheap enough to call from a route. Every failure —
 * no file, no permission, a shape this scanner does not recognise — yields an empty
 * map rather than an error, because the names are cosmetic and the provider id is
 * always a truthful fallback.
 *
 * @param {object} input - the reader's inputs.
 * @param {string} input.home - the resolved DSH home.
 * @param {{ now?: () => number, readFile?: (path: string) => string, log?: { warn: Function } }} [input.options] - clock, file reader and diagnostics, all injectable for tests.
 * @returns {() => Record<string, string>} the reader.
 */
export function createProviderNames({ home, options = {} }) {
  const now = options.now ?? (() => Date.now())
  const readFile = options.readFile ?? ((path) => readFileSync(path, 'utf8'))
  const log = options.log ?? { warn: () => {} }
  let at = 0
  let cached = {}

  return () => {
    const stamp = now()
    if (at !== 0 && stamp - at < CACHE_MS) return cached
    at = stamp
    for (const path of settingsPaths(home)) {
      let text
      try {
        text = readFile(path)
      } catch {
        // No settings file at this path: try the next, and then give up quietly.
        continue
      }
      try {
        const names = parseProviderNames(text)
        if (Object.keys(names).length > 0) {
          cached = names
          return cached
        }
      } catch (error) {
        log.warn('[token-ledger] could not read provider names from %s: %o', path, error)
      }
    }
    // Nothing readable: the empty map is cached too, so a missing file is not
    // re-opened on every request.
    cached = {}
    return cached
  }
}
