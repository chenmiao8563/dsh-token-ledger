/**
 * Finding and folding the session logs on disk.
 *
 * A DSH session is durably recorded at
 * `<sessionsDir>/<project>/<session id>/session.jsonl.zstd`: independent
 * Zstandard frames carrying newline-delimited JSON in the harness's *compact
 * row* form. Both halves of this plugin need that record, and neither may own
 * the reader:
 *
 * - the host half folds it at mount, so a fresh install shows the user's history
 *   without asking `sessionPersistence` for anything;
 * - the CLI folds it for `rebuild`, `audit` and `export`, where no host is
 *   running at all.
 *
 * ## Why every fold here declares an origin
 *
 * A log's rows are **not** the logical event list a live `Session` or
 * `sessionPersistence` hands back: several logical events share one row, so an
 * index into one list means something else in the other. `adoptHistory` keeps a
 * per-session cursor in whichever list first folded it, so every fold in this
 * module passes `origin: 'log'`. A session folded from disk is then never
 * advanced by the other source, and vice versa — see `LEDGER_VERSION`.
 *
 * @module dsh-token-ledger/session-logs
 */

import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { inheritedCut, isForkSession } from './ledger.js'
import { readSessionLog } from './session-log.js'

/**
 * Find every session log under a directory.
 *
 * The walk is recursive because a session lives in its own directory under a
 * directory named for its working directory, and the layout is the harness's,
 * not this plugin's. Missing or unreadable directories are treated as empty: a
 * host with no sessions stored yet is normal, not an error.
 *
 * @param {string} directory - the DSH `sessions` directory.
 * @returns {string[]} absolute paths to `session.jsonl.zstd` files, in walk order.
 */
export function findSessionLogs(directory) {
  const found = []
  const visit = (current) => {
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile() && entry.name.endsWith('.jsonl.zstd')) found.push(path)
    }
  }
  visit(directory)
  return found
}

/**
 * The session id a log path implies.
 *
 * A log is `<sessionsDir>/<project>/<session id>/session.jsonl.zstd`, so the id
 * is the directory above the file. Reading it off the path costs nothing, which
 * is what lets the host skip a session it has already folded without opening the
 * file.
 *
 * @param {string} path - a `session.jsonl.zstd` path.
 * @returns {string} the implied session id, or `''` when the path is too short.
 */
export function sessionIdOfLogPath(path) {
  return String(path).replace(/\\/g, '/').split('/').slice(-2)[0] ?? ''
}

/**
 * Every session log on disk, with what a `stat` says about it.
 *
 * The modification time is what the host compares against a session's last
 * folded activity to decide whether a log it already owns has grown, so that
 * keeping up with history costs one `stat` per session rather than one read.
 *
 * @param {string} directory - the DSH `sessions` directory.
 * @returns {{ path: string, sessionId: string, mtimeMs: number, size: number }[]} the logs. A
 *   file whose `stat` fails is still listed, with zeroes, so that a caller's
 *   count of what it scanned does not silently drop it.
 */
export function listLogSessions(directory) {
  return findSessionLogs(directory).map((path) => {
    let mtimeMs = 0
    let size = 0
    try {
      const stat = statSync(path)
      mtimeMs = stat.mtimeMs
      size = stat.size
    } catch {
      // Reported as zeroes: the fold will fail on the read and be counted there.
    }
    return { path, sessionId: sessionIdOfLogPath(path), mtimeMs, size }
  })
}

/**
 * Decode one log into the events a fold needs, with its boundary decided.
 *
 * The boundary is located structurally by `inheritedCut` rather than by the
 * header's declared seed length, because the log is the compact row form where
 * that count indexes a different array. See `inheritedCut`.
 *
 * @param {string} path - a `session.jsonl.zstd` path.
 * @returns {{ records: object[], header: object|undefined, sessionId: string, isFork: boolean, cut: number }} the log's content.
 * @throws {Error} when the file cannot be read or decoded.
 */
export function readLogSession(path) {
  const records = readSessionLog(path)
  const header = records[0]?.type === 'session' ? records[0] : undefined
  const sessionId = String(header?.id ?? sessionIdOfLogPath(path))
  const isFork = isForkSession(header)
  const cut = inheritedCut({ header, events: records, inheritedEventCount: header?.seedLength })
  return { records, header, sessionId, isFork, cut }
}

/**
 * Fold one session log into a ledger.
 *
 * @param {import('./ledger.js').UsageLedger} ledger - the ledger to fold into.
 * @param {{ path: string, sessionId: string }} entry - a `listLogSessions` entry.
 * @param {{ onWarning?: (message: string) => void }} [options] - diagnostics sink.
 * @returns {{ sessionId: string, records: object[], isFork: boolean, folded: boolean }} what happened.
 *   `folded: false` means an empty log, an unreadable one, or a session the other
 *   source owns — never a partial fold.
 */
export function foldLogEntry(ledger, entry, { onWarning = () => {} } = {}) {
  let decoded
  try {
    decoded = readLogSession(entry.path)
  } catch (error) {
    onWarning(`could not decode ${entry.path}: ${error instanceof Error ? error.message : String(error)}`)
    return { sessionId: entry.sessionId, records: [], isFork: false, folded: false }
  }
  const { records, header, sessionId, isFork, cut } = decoded
  if (records.length === 0) return { sessionId, records, isFork, folded: false }
  if (isFork && cut === 0) {
    onWarning(
      `forked session ${sessionId} has no usable inheritance boundary; folding it whole, so its totals may include the parent prefix`,
    )
  }
  const folded = ledger.adoptHistory({
    sessionId,
    events: records,
    inheritedEventCount: cut,
    // The compact row form is a different coordinate space from a live
    // Session's event list, and the cursor has to say so.
    origin: 'log',
    // The header line carries the working directory; a log whose header lacks it
    // still gets one from its own events, which `adoptHistory` falls back to.
    cwd: typeof header?.cwd === 'string' && header.cwd !== '' ? header.cwd : null,
  })
  return { sessionId, records, isFork, folded }
}

/**
 * Fold every session log under a directory into a ledger.
 *
 * @param {import('./ledger.js').UsageLedger} ledger - the ledger to fold into.
 * @param {string} directory - the DSH `sessions` directory.
 * @param {{ onWarning?: (message: string) => void, onSession?: (result: object) => void }} [options] - diagnostics sink and per-log hook.
 * @returns {{ scanned: number, folded: number, skipped: number, forks: number, events: number }} the tally.
 */
export function foldSessionLogs(ledger, directory, { onWarning = () => {}, onSession = () => {} } = {}) {
  const entries = listLogSessions(directory)
  let folded = 0
  let skipped = 0
  let forks = 0
  let events = 0
  for (const entry of entries) {
    const result = foldLogEntry(ledger, entry, { onWarning })
    if (!result.folded) {
      skipped += 1
      continue
    }
    folded += 1
    if (result.isFork) forks += 1
    events += result.records.length
    onSession(result)
  }
  return { scanned: entries.length, folded, skipped, forks, events }
}
