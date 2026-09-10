/**
 * `dsh-token-ledger` command line.
 *
 * The CLI is the audit half of the plugin. Because the ledger is a pure fold
 * over session logs, the CLI can recompute the exact same numbers from the raw
 * files on disk and diff them against whatever the running host persisted —
 * without starting DSH, and without trusting the ledger file.
 *
 * @module dsh-token-ledger/cli
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { UsageLedger, inheritedCut } from './ledger.js'
import { readSessionLog } from './session-log.js'
import { ledgerPaths, loadLedger, saveLedger, writeFileAtomic } from './store.js'

const USAGE = `dsh-token-ledger — token accounting for DeepSeek Harness

Usage
  dsh-token-ledger [summary] [options]     print the stored ledger (default)
  dsh-token-ledger audit   [options]       recompute from raw logs and diff
  dsh-token-ledger rebuild [options]       recompute from raw logs
  dsh-token-ledger export  [options]       write CSV and JSON exports

Options
  --home <path>      DSH home to read (default: $DSH_HOME, else ~/.dsh)
  --ledger <path>    ledger file to read or write
  --out <path>       export destination directory
  --days <n>         days to show in the summary (default 7)
  --models <n>       models to show in the summary (default 5)
  --write            with rebuild: replace the stored ledger
  --json             machine-readable output
  --quiet            suppress the human summary, keep the exit code
  -h, --help         show this help
  -v, --version      show the version

Exit codes
  0  success, or the audit matched
  1  the audit found a difference
  2  bad usage or an unreadable input
`

/**
 * Read this package's version.
 *
 * @returns {string} the version, or `'unknown'`.
 */
function packageVersion() {
  try {
    const path = fileURLToPath(new URL('../package.json', import.meta.url))
    return JSON.parse(readFileSync(path, 'utf8')).version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * Parse `argv` into a command and options.
 *
 * @param {string[]} argv - arguments after the executable.
 * @returns {{ command: string, home?: string, ledger?: string, out?: string, days: number, models: number, write: boolean, json: boolean, quiet: boolean, help: boolean, version: boolean, unknown: string[] }} the parsed invocation.
 */
export function parseArgs(argv) {
  const options = {
    command: 'summary',
    days: 7,
    models: 5,
    write: false,
    json: false,
    quiet: false,
    help: false,
    version: false,
    unknown: [],
  }
  const commands = new Set(['summary', 'audit', 'rebuild', 'export', 'help'])
  let sawCommand = false

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    const next = () => {
      index += 1
      return argv[index]
    }
    switch (argument) {
      case '-h':
      case '--help':
        options.help = true
        break
      case '-v':
      case '--version':
        options.version = true
        break
      case '--write':
        options.write = true
        break
      case '--json':
        options.json = true
        break
      case '--quiet':
        options.quiet = true
        break
      case '--home':
        options.home = next()
        break
      case '--ledger':
        options.ledger = next()
        break
      case '--out':
        options.out = next()
        break
      case '--days':
        options.days = Number.parseInt(next() ?? '', 10)
        break
      case '--models':
        options.models = Number.parseInt(next() ?? '', 10)
        break
      default: {
        if (argument.startsWith('--home=')) options.home = argument.slice(7)
        else if (argument.startsWith('--ledger=')) options.ledger = argument.slice(9)
        else if (argument.startsWith('--out=')) options.out = argument.slice(6)
        else if (!sawCommand && commands.has(argument)) {
          options.command = argument
          sawCommand = true
        } else options.unknown.push(argument)
      }
    }
  }
  if (options.command === 'help') options.help = true
  return options
}

/**
 * Recursively find every `session.jsonl.zstd` under a directory.
 *
 * @param {string} directory - the directory to scan.
 * @returns {string[]} absolute file paths.
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
 * Rebuild a ledger by folding every raw session log on disk.
 *
 * Fork handling is deliberately explicit here. The stored file is a *compact
 * row* encoding, so an event's `seq` is not its array index, and the inherited
 * boundary must be located structurally: a forked session's own stream starts
 * at the first `session/end-seed` record. Sessions that carry the same marker
 * without a parent are resumes of their own history and are folded in full.
 *
 * @param {string} sessionsDir - the directory holding session logs.
 * @param {{ onWarning?: (message: string) => void }} [options] - diagnostics sink.
 * @returns {{ ledger: UsageLedger, scanned: number, skipped: number, forks: number, events: number, lastTimes: Map<string, number> }} the rebuild.
 */
export function rebuildFromLogs(sessionsDir, { onWarning = () => {} } = {}) {
  const ledger = new UsageLedger()
  const files = findSessionLogs(sessionsDir)
  const lastTimes = new Map()
  let skipped = 0
  let forks = 0
  let events = 0

  for (const file of files) {
    let records
    try {
      records = readSessionLog(file)
    } catch (error) {
      skipped += 1
      onWarning(`could not decode ${file}: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    if (records.length === 0) {
      skipped += 1
      continue
    }

    const header = records[0]?.type === 'session' ? records[0] : undefined
    const fallbackId = file.replace(/\\/g, '/').split('/').slice(-2)[0]
    const sessionId = String(header?.id ?? fallbackId)
    const markerIndex = records.findIndex((record) => record.type === 'session/end-seed')
    const isFork = header?.parentSession !== undefined && header?.parentSession !== null

    let cut = 0
    if (isFork) {
      forks += 1
      if (markerIndex >= 0) cut = markerIndex
      else onWarning(`forked session ${sessionId} has no session/end-seed marker; folding it whole`)
    }

    // The newest event time lets the audit tell "the ledger is merely behind a
    // session that is still being written" apart from "the ledger is wrong".
    for (const record of records) {
      if (typeof record?.time !== 'number' || !Number.isFinite(record.time)) continue
      const seen = lastTimes.get(sessionId)
      if (seen === undefined || record.time > seen) lastTimes.set(sessionId, record.time)
    }

    events += records.length
    ledger.adoptHistory({ sessionId, events: records, inheritedEventCount: cut })
  }

  return { ledger, scanned: files.length, skipped, forks, events, lastTimes }
}

/**
 * Compare two ledgers, reporting where they disagree and why.
 *
 * A running host writes its ledger on a debounce, so a live session is
 * routinely a little ahead of the stored file. That is expected and must not
 * read as corruption. The ledger's own `updatedAt` settles it: a differing
 * session whose newest event is *newer than the ledger* has simply kept
 * running, while a differing session whose newest event predates the ledger is
 * a real disagreement between the file and the logs.
 *
 * @param {UsageLedger} stored - the ledger read from disk.
 * @param {UsageLedger} recomputed - the ledger folded from raw logs.
 * @param {{ updatedAt?: number, lastTimes?: Map<string, number> }} [context] - evidence for classification.
 * @returns {{ equal: boolean, matches: boolean, totals: object, days: object[], models: object[], sessions: object[], stale: object[], pending: object[] }} the diff.
 */
export function diffLedgers(stored, recomputed, { updatedAt = 0, lastTimes = new Map() } = {}) {
  const rows = (left, right) => {
    const keys = new Set([...left.keys(), ...right.keys()])
    const out = []
    for (const key of keys) {
      const a = left.get(key)?.counters.totalTokens ?? 0
      const b = right.get(key)?.counters.totalTokens ?? 0
      if (a !== b) out.push({ key, stored: a, recomputed: b, delta: b - a })
    }
    return out
  }

  const days = rows(stored.daily, recomputed.daily).sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))
  const models = rows(stored.models, recomputed.models).sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))
  const sessions = rows(stored.sessions, recomputed.sessions).sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))

  const pending = []
  const stale = []
  for (const row of sessions) {
    const newest = lastTimes.get(row.key) ?? 0
    if (updatedAt > 0 && newest > updatedAt) pending.push(row)
    else stale.push(row)
  }

  const totalsEqual =
    stored.totals.totalTokens === recomputed.totals.totalTokens && stored.calls === recomputed.calls

  // Any disagreement anywhere: the grand totals, a per-session figure, or a
  // day/model row contradicting the fold it should sum to.
  const differences = !totalsEqual || sessions.length > 0 || days.length > 0 || models.length > 0
  // A difference is excused only when every differing session has kept running
  // since the ledger was written. With no such session, a difference in the day
  // or model tables is an internal contradiction being caught, not live traffic.
  const explainedByLiveActivity = pending.length > 0 && stale.length === 0

  return {
    // Nothing differs anywhere.
    equal: !differences,
    // Nothing differs except activity that happened after the ledger was written.
    matches: !differences || explainedByLiveActivity,
    totals: {
      stored: { calls: stored.calls, totalTokens: stored.totals.totalTokens },
      recomputed: { calls: recomputed.calls, totalTokens: recomputed.totals.totalTokens },
      deltaTokens: recomputed.totals.totalTokens - stored.totals.totalTokens,
      deltaCalls: recomputed.calls - stored.calls,
    },
    days,
    models,
    sessions,
    stale,
    pending,
  }
}

/**
 * Run the CLI.
 *
 * @param {string[]} argv - arguments after the executable.
 * @param {{ stdout?: (text: string) => void, stderr?: (text: string) => void, env?: NodeJS.ProcessEnv }} [io] - output sinks.
 * @returns {number} the process exit code.
 */
export function run(argv, io = {}) {
  const out = io.stdout ?? ((text) => process.stdout.write(`${text}\n`))
  const err = io.stderr ?? ((text) => process.stderr.write(`${text}\n`))
  const env = io.env ?? process.env
  const options = parseArgs(argv)

  if (options.help) {
    out(USAGE)
    return 0
  }
  if (options.version) {
    out(packageVersion())
    return 0
  }
  if (options.unknown.length > 0) {
    err(`unknown argument(s): ${options.unknown.join(' ')}\n`)
    err(USAGE)
    return 2
  }
  if (!Number.isFinite(options.days) || options.days <= 0 || !Number.isFinite(options.models) || options.models <= 0) {
    err('--days and --models must be positive integers\n')
    return 2
  }

  const paths = ledgerPaths(options.home, env)
  const ledgerPath = options.ledger ?? paths.ledger

  if (options.command === 'audit' || options.command === 'rebuild' || options.command === 'export') {
    const warnings = []
    const { ledger: recomputed, scanned, skipped, forks, events, lastTimes } = rebuildFromLogs(paths.sessionsDir, {
      onWarning: (message) => warnings.push(message),
    })
    // Emit diagnostics before any branch returns.
    for (const warning of warnings) err(`warning: ${warning}\n`)

    if (options.command === 'export') {
      const destination = options.out ?? paths.exportsDir
      const stamp = new Date().toISOString().slice(0, 10)
      let written
      try {
        written = [
          writeFileAtomic(join(destination, `daily-${stamp}.csv`), recomputed.toCsv('daily')),
          writeFileAtomic(join(destination, `sessions-${stamp}.csv`), recomputed.toCsv('sessions')),
          writeFileAtomic(join(destination, `models-${stamp}.csv`), recomputed.toCsv('models')),
          saveLedger(join(destination, `ledger-${stamp}.json`), recomputed.snapshot()),
        ]
      } catch (error) {
        err(`export failed: ${error instanceof Error ? error.message : String(error)}\n`)
        return 2
      }
      if (options.json) out(JSON.stringify({ scanned, events, forks, skipped, written }, null, 2))
      else {
        out(`scanned ${scanned} session log(s), ${events} events, ${forks} fork(s), ${skipped} unreadable`)
        for (const path of written) out(`  ${path}`)
      }
      return 0
    }

    if (options.command === 'rebuild') {
      if (options.write) {
        try {
          saveLedger(ledgerPath, recomputed.snapshot())
        } catch (error) {
          err(`could not write ${ledgerPath}: ${error instanceof Error ? error.message : String(error)}\n`)
          return 2
        }
      }
      if (options.json) out(JSON.stringify({ scanned, events, forks, skipped, write: options.write, totals: recomputed.snapshot().totals }, null, 2))
      else {
        out(`scanned ${scanned} session log(s), ${events} events, ${forks} fork(s), ${skipped} unreadable`)
        if (options.write) out(`wrote ${ledgerPath}`)
        if (!options.quiet) out(`\n${recomputed.format({ days: options.days, models: options.models })}`)
      }
      return 0
    }

    // audit
    const storedSnapshot = loadLedger(ledgerPath)
    if (storedSnapshot === undefined) {
      err(`no ledger at ${ledgerPath}; run "dsh-token-ledger rebuild --write" to create one\n`)
      return 2
    }
    const stored = new UsageLedger()
    if (!stored.restore(storedSnapshot)) {
      err(`ledger at ${ledgerPath} has an unsupported version; rerun with rebuild --write\n`)
      return 2
    }
    const diff = diffLedgers(stored, recomputed, {
      updatedAt: typeof storedSnapshot.updatedAt === 'number' ? storedSnapshot.updatedAt : 0,
      lastTimes,
    })

    if (options.json) {
      out(JSON.stringify({ scanned, events, forks, skipped, warnings, ...diff }, null, 2))
    } else {
      out(`scanned ${scanned} session log(s), ${events} events, ${forks} fork(s), ${skipped} unreadable`)
      out('')
      out(`  stored      ${stored.calls} calls  ${stored.totals.totalTokens} tokens`)
      out(`  recomputed  ${recomputed.calls} calls  ${recomputed.totals.totalTokens} tokens`)
      out('')
      if (diff.equal) {
        out('  audit: match — the stored ledger equals a fresh fold of the raw logs')
      } else if (diff.matches) {
        out(
          `  audit: match — ${diff.pending.length} session(s) advanced after the ledger was written`,
        )
        out(`         (${diff.totals.deltaCalls} calls, ${diff.totals.deltaTokens} tokens not yet flushed)`)
      } else {
        out(`  audit: MISMATCH — ${diff.totals.deltaCalls} calls, ${diff.totals.deltaTokens} tokens`)
        if (diff.pending.length > 0) {
          out(`         ${diff.pending.length} differing session(s) merely ran after the ledger was written`)
        }
        const section = (label, rows) => {
          if (rows.length === 0) return
          out('')
          out(`  ${label}`)
          for (const row of rows.slice(0, 10)) {
            out(`    ${row.key}  stored=${row.stored}  recomputed=${row.recomputed}  delta=${row.delta}`)
          }
          if (rows.length > 10) out(`    … and ${rows.length - 10} more`)
        }
        section('days', diff.days)
        section('models', diff.models)
        section('sessions (stale)', diff.stale)
      }
    }
    return diff.matches ? 0 : 1
  }

  // summary
  const snapshot = loadLedger(ledgerPath)
  if (snapshot === undefined) {
    err(`no ledger at ${ledgerPath}\n`)
    err('the plugin writes one while DSH runs; "dsh-token-ledger rebuild --write" can build it from raw logs\n')
    return 2
  }
  const ledger = new UsageLedger()
  if (!ledger.restore(snapshot)) {
    err(`ledger at ${ledgerPath} has an unsupported version\n`)
    return 2
  }
  if (options.json) out(JSON.stringify(ledger.snapshot(), null, 2))
  else if (!options.quiet) out(ledger.format({ days: options.days, models: options.models }))
  return 0
}
