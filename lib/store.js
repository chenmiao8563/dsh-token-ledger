/**
 * Ledger persistence: where the ledger lives and how it is written.
 *
 * Both the host plugin and the CLI use these helpers, so the file the plugin
 * writes is exactly the file the CLI audits. Writes are atomic (temporary file
 * plus rename) because a half-written ledger would silently lose history.
 *
 * @module dsh-token-ledger/store
 */

import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/** Directory name created inside the DSH home for this plugin's state. */
export const STATE_DIRNAME = 'token-ledger'

/** The ledger file's name inside {@link STATE_DIRNAME}. */
export const LEDGER_FILENAME = 'ledger.json'

/** Where fetched prices, the USD rate and hand-entered overrides are cached. */
export const RATES_FILENAME = 'rates.json'

/**
 * Resolve the DSH home directory the way the host process does.
 *
 * @param {string} [explicit] - an explicit home, e.g. a CLI `--home` flag.
 * @param {NodeJS.ProcessEnv} [env] - environment to consult.
 * @returns {string} an absolute path to the DSH home.
 */
export function resolveHome(explicit, env = process.env) {
  if (typeof explicit === 'string' && explicit.trim() !== '') return resolve(explicit)
  if (typeof env.DSH_HOME === 'string' && env.DSH_HOME.trim() !== '') return resolve(env.DSH_HOME)
  return join(homedir(), '.dsh')
}

/**
 * The paths this plugin reads and writes inside a DSH home.
 *
 * @param {string} [home] - an explicit DSH home.
 * @param {NodeJS.ProcessEnv} [env] - environment to consult.
 * @returns {{ home: string, dir: string, ledger: string, exportsDir: string, sessionsDir: string }} the layout.
 */
export function ledgerPaths(home, env = process.env) {
  const resolved = resolveHome(home, env)
  const dir = join(resolved, STATE_DIRNAME)
  return {
    home: resolved,
    dir,
    ledger: join(dir, LEDGER_FILENAME),
    rates: join(dir, RATES_FILENAME),
    exportsDir: join(dir, 'exports'),
    sessionsDir: join(resolved, 'sessions'),
  }
}

/**
 * Read a stored ledger.
 *
 * @param {string} path - the ledger file path.
 * @returns {object|undefined} the snapshot, or `undefined` when absent or
 *   unreadable. A corrupt ledger is treated as "start fresh" rather than fatal.
 */
export function loadLedger(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * Write a file atomically, creating parent directories as needed.
 *
 * @param {string} path - the destination path.
 * @param {string} text - the content to write.
 * @returns {string} the destination path.
 */
export function writeFileAtomic(path, text) {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${process.pid}`
  writeFileSync(temporary, text, 'utf8')
  try {
    renameSync(temporary, path)
  } catch (error) {
    try {
      unlinkSync(temporary)
    } catch {
      // The rename failure matters more than the cleanup failure.
    }
    throw error
  }
  return path
}

/**
 * Persist a ledger snapshot atomically.
 *
 * @param {string} path - the ledger file path.
 * @param {object} snapshot - a value from `UsageLedger#snapshot`.
 * @returns {string} the destination path.
 */
export function saveLedger(path, snapshot) {
  return writeFileAtomic(path, `${JSON.stringify(snapshot, null, 2)}\n`)
}
