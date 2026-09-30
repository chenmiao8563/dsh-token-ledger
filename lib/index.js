/**
 * `dsh-token-ledger` host half.
 *
 * A transparent, restart-safe token ledger for DeepSeek Harness. It folds the
 * durable session event stream into per-session, per-day and per-model token
 * totals, keeps the result in `<DSH_HOME>/token-ledger/ledger.json`, and
 * answers `/tokens` in the conversation input.
 *
 * Design constraints, in order of importance:
 *
 * 1. **Installable anywhere.** The module imports nothing but Node builtins and
 *    its own files, so it cannot fail on a missing or drifting peer dependency.
 *    It also declares no install scripts, so `dsh plugin add` from a git URL
 *    works without pre-authorizing a pnpm build.
 * 2. **Never in the model's way.** It registers no prompt section, no message
 *    and no model-facing tool, so it cannot change a request prefix and cannot
 *    affect KV-cache reuse. The ledger is read by a command and by the CLI.
 * 3. **Never the reason a session fails.** Every hook is wrapped so a ledger
 *    fault degrades to a warning; folding is pure and cannot mutate session
 *    state.
 *
 * @module dsh-token-ledger
 */

import { UsageLedger, cwdFrom, inheritedCut, isForkSession } from './ledger.js'
import { BILL_PATH, RATES_PATH, createBillRoute, createOverviewRoute, createRatesRoute, OVERVIEW_PATH } from './route.js'
import { SMALL_SESSION } from './bill.js'
import { createRatesService } from './rates-service.js'
import { createProviderNames } from './providers.js'
import { foldLogEntry, listLogSessions } from './session-logs.js'
import { ledgerPaths, loadLedger, saveLedger, writeFileAtomic } from './store.js'
import { join } from 'node:path'

/** Plugin name, as it appears in the Cordis tree. */
export const name = 'token-ledger'

/** Milliseconds to coalesce ledger writes after activity. */
const PERSIST_DEBOUNCE_MS = 2000

/**
 * Mount the ledger.
 *
 * @param {object} ctx - the Cordis context for this plugin's fiber.
 * @param {{ ledgerPath?: string, backfill?: boolean, backfillLogs?: boolean, rates?: boolean|object }} [config] - composition config. `rates: false` disables the pricing feature's networking entirely, leaving hand-entered values as the only source, which is the setting a strictly offline host wants. `rates.source` picks the price source (`modelsdev`, the default, for each vendor's own list price; or `openrouter` for a gateway's quotes and the widest model coverage). `rates.vendors` caps how many vendors are published (`0` for all of them).
 * @returns {void}
 */
export function apply(ctx, config = {}) {
  const paths = ledgerPaths()
  const ledgerPath = typeof config.ledgerPath === 'string' && config.ledgerPath !== '' ? config.ledgerPath : paths.ledger
  const shouldBackfill = config.backfill !== false
  // Reading the session logs on disk is what a fresh install shows its history
  // from, and the only history source that asks the host for nothing. It is
  // switchable on its own because it is the one that touches the disk.
  const shouldBackfillLogs = shouldBackfill && config.backfillLogs !== false
  const ratesConfig = typeof config.rates === 'object' && config.rates !== null ? config.rates : {}
  const ratesEnabled = config.rates !== false
  // Monthly plans, for the bill's subscription view. A plan is a fixed fee for a
  // period rather than a price per token, so it is declared here and amortized over
  // the days a bill covers.
  const subscriptionsConfig = Array.isArray(config.subscriptions) ? config.subscriptions : []
  // How the session list is shortened on the page — and only on the page: an export is
  // read for its detail, so it always carries every session. `smallSessionCost` is in
  // the bill's own currency, and `bill.foldSmallSessions: false` turns it off entirely.
  const billConfig = typeof config.bill === 'object' && config.bill !== null ? config.bill : {}
  const smallSession = {
    cost: typeof billConfig.smallSessionCost === 'number' && Number.isFinite(billConfig.smallSessionCost) ? billConfig.smallSessionCost : SMALL_SESSION.cost,
    calls: typeof billConfig.smallSessionCalls === 'number' && Number.isFinite(billConfig.smallSessionCalls) ? billConfig.smallSessionCalls : SMALL_SESSION.calls,
  }
  const foldSmallSessions = billConfig.foldSmallSessions !== false

  const ledger = new UsageLedger()
  const restored = ledger.restore(loadLedger(ledgerPath))

  const log = {
    /** @param {string} message @param {...unknown} rest */
    info: (message, ...rest) => ctx.logger?.info?.(message, ...rest),
    warn: (message, ...rest) => ctx.logger?.warn?.(message, ...rest),
  }

  // The name the model settings page shows a provider under, so the bill can say
  // `BOS-API` where the request route says `bos`. Read from the harness settings —
  // never written — and empty when that file is absent or shaped differently.
  const providerNames = createProviderNames({ home: paths.home, options: { log } })

  // Prices and the USD rate live beside the ledger, so the two travel together
  // and one backup covers both.
  const rates = createRatesService({
    path: paths.rates,
    options: {
      source: ratesConfig.source,
      modelsUrl: ratesConfig.modelsUrl,
      fxUrl: ratesConfig.fxUrl,
      perVendor: ratesConfig.perVendor,
      vendorLimit: ratesConfig.vendors,
      intervalMs: ratesConfig.refreshIntervalMs,
      log,
    },
  })

  let timer
  let writing = Promise.resolve()

  /**
   * Write the ledger, serializing writes so two flushes cannot interleave.
   *
   * @returns {Promise<void>} settles when the file is on disk.
   */
  const flush = () => {
    writing = writing
      .then(() => {
        saveLedger(ledgerPath, ledger.snapshot())
      })
      .catch((error) => {
        log.warn('[token-ledger] could not write %s: %o', ledgerPath, error)
      })
    return writing
  }

  /** @param {number} [delay] - coalescing delay in milliseconds. */
  const schedule = (delay = PERSIST_DEBOUNCE_MS) => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      void flush()
    }, delay)
    // Do not hold the host process open just to write a ledger.
    timer.unref?.()
  }

  /**
   * Fold a live session's unconsumed events.
   *
   * @param {object} session - a live Session.
   * @returns {void}
   */
  const adopt = (session) => {
    try {
      ledger.adoptSession(session)
    } catch (error) {
      log.warn('[token-ledger] could not fold session: %o', error)
    }
  }

  // Sessions already live when this plugin mounts (a profile reload, or a
  // ledger installed into a running host).
  try {
    const sessions = ctx.get?.('sessions')
    if (sessions !== undefined && typeof sessions.list === 'function') {
      for (const session of sessions.list()) adopt(session)
    }
  } catch (error) {
    log.warn('[token-ledger] could not enumerate live sessions: %o', error)
  }

  /**
   * Fold the session logs on disk: the durable record, and the only history
   * source that asks the host for nothing.
   *
   * A log holds the *compact row* form, whose indices mean something else than
   * the live event list's do, so `foldLogEntry` marks every session it folds as
   * `'log'`-owned and the live and persistence paths then leave those sessions
   * alone. A session already owned live is skipped from its path alone, so for a
   * host that has run before the cost is one `stat` per log, not one read.
   *
   * The work is spread one file per turn of the event loop: a first run has a
   * whole history to fold, and a host that stalls for it would be felt.
   *
   * @returns {Promise<void>} settles once the fold is done, or immediately when it is off.
   */
  const foldLogs = () => {
    if (!shouldBackfillLogs) return Promise.resolve()

    let entries
    try {
      entries = listLogSessions(paths.sessionsDir)
    } catch (error) {
      log.warn('[token-ledger] could not list %s: %o', paths.sessionsDir, error)
      return Promise.resolve()
    }

    const pending = entries.filter((entry) => {
      const owner = ledger.ownerOf(entry.sessionId)
      // Never folded by anything: either source may take it, and this one has
      // the file. This is the fresh-install case the fold exists for.
      if (owner === undefined) return true
      // Already folded from disk: fold it again only once the log has grown,
      // which its modification time answers without reading it — a log is
      // written after its newest event, so it is the moment the last pass
      // finished that dates what that pass saw. A file landing in the pass's own
      // millisecond counts as grown, on purpose: reading one log again costs a
      // moment, and passing over one costs its tokens.
      if (owner === 'log') return entry.mtimeMs > (ledger.logsFoldedAt ?? 0)
      // Folded from the logical event list: not this source's to advance.
      return false
    })
    if (pending.length === 0) return Promise.resolve()

    return new Promise((resolve) => {
      let index = 0
      let folded = 0
      let skipped = 0
      const step = () => {
        while (index < pending.length) {
          const entry = pending[index]
          index += 1
          // Re-checked per file, because a session can be adopted live between
          // two turns of this loop.
          if (ledger.ownerOf(entry.sessionId) === 'session') {
            skipped += 1
            continue
          }
          const result = foldLogEntry(ledger, entry, {
            onWarning: (message) => log.warn('[token-ledger] %s', message),
          })
          if (result.folded) folded += 1
          else skipped += 1
          if (index < pending.length) {
            // Yield between files: on a first run this is a whole history, and
            // the host has a UI to keep answering.
            setImmediate(step)
            return
          }
        }
        if (folded > 0) {
          log.info(
            '[token-ledger] folded %d session log(s) from disk, %d skipped; total %d tokens over %d calls',
            folded,
            skipped,
            ledger.totals.totalTokens,
            ledger.calls,
          )
          schedule(0)
        }
        // Every log on disk has now been accounted for as of this moment, which
        // is what lets the next start skip the unchanged ones on a `stat`.
        ledger.markLogsFolded()
        resolve()
      }
      step()
    })
  }

  /**
   * Fold one session's log again, for a session this ledger took from disk whose
   * events arrived while the host was running.
   *
   * A resumed session — an old log continued in a new run — is the case: it is
   * `'log'`-owned, so the live path must not fold it, and without this its usage
   * would wait for the next start.
   *
   * @param {string} sessionId - the session that was disposed.
   * @returns {void}
   */
  const refreshLog = (sessionId) => {
    if (ledger.ownerOf(sessionId) !== 'log') return
    let entry
    try {
      entry = listLogSessions(paths.sessionsDir).find((candidate) => candidate.sessionId === sessionId)
    } catch {
      return
    }
    if (entry === undefined) return
    if (entry.mtimeMs <= (ledger.logsFoldedAt ?? 0)) return
    const result = foldLogEntry(ledger, entry, { onWarning: (message) => log.warn('[token-ledger] %s', message) })
    if (result.folded) schedule()
  }

  /**
   * Fold every session storage knows about, including ones from previous runs.
   *
   * This is what makes a fresh install immediately show real history instead of
   * starting from zero. It is safe to repeat: a session already consumed is
   * skipped by its cursor.
   *
   * @param {object} persistence - the `sessionPersistence` service.
   * @returns {Promise<{ sessions: number, errors: number }>} the backfill tally.
   */
  const backfill = async (persistence) => {
    let sessions = 0
    let errors = 0
    const headers = await persistence.list()
    for (const header of headers) {
      const id = String(header?.id ?? '')
      if (id === '') continue
      // A session folded from its log owns that cursor, and this pass numbers the
      // same session's events differently. Leave it to the log fold.
      if (ledger.ownerOf(id) === 'log') continue
      try {
        const read = typeof persistence.inspect === 'function' ? persistence.inspect : persistence.load
        const stored = await read.call(persistence, id)
        const events = stored?.events
        if (!Array.isArray(events)) continue
        const meta = stored?.meta ?? header
        // A fork's prefix belongs to its parent, which is counted separately.
        // The boundary is located by the `session/end-seed` marker rather than
        // by a raw count, because a count can be expressed in a different
        // coordinate space than the array we were handed. See inheritedCut.
        const inheritedEventCount = inheritedCut({
          header: meta,
          events,
          inheritedEventCount: stored?.inheritedEventCount ?? meta?.seedLength,
        })
        if (isForkSession(meta) && inheritedEventCount === 0) {
          log.warn(
            '[token-ledger] forked session %s has no usable inheritance boundary; folding it whole, so its totals may include the parent prefix',
            id,
          )
        }
        // The working directory is on the session's header line, which
        // `sessionPersistence` hands back separately from the sequenced events: the
        // events alone carry no `cwd`, so a backfill that read only them recorded
        // every session without a workspace. It is passed in explicitly here, with
        // the event scan as a fallback for the shapes that do carry it inline.
        const cwd = cwdFrom([stored?.meta, header, stored?.session, stored])
        ledger.adoptHistory({ sessionId: id, events, inheritedEventCount, cwd })
        sessions += 1
      } catch (error) {
        errors += 1
        log.warn('[token-ledger] could not read stored session %s: %o', id, error)
      }
    }
    return { sessions, errors }
  }

  // The logs go first and the persistence pass waits for them. Both fold history
  // into one ledger, and which source owns a session has to be settled before the
  // other one reads it — otherwise a session could be claimed twice, in two
  // coordinate spaces, and counted twice.
  const logsFolded = foldLogs()

  if (shouldBackfill) {
    const onPersistence = (persistenceCtx) => {
      void logsFolded
        .then(() => backfill(persistenceCtx.sessionPersistence))
        .then((tally) => {
          log.info(
            '[token-ledger] backfilled %d stored session(s), %d unreadable; total %d tokens over %d calls',
            tally.sessions,
            tally.errors,
            ledger.totals.totalTokens,
            ledger.calls,
          )
          schedule(0)
        })
        .catch((error) => {
          log.warn('[token-ledger] backfill failed: %o', error)
        })
    }
    if (typeof ctx.inject === 'function') ctx.inject(['sessionPersistence'], onPersistence)
  }

  if (typeof ctx.on === 'function') {
    ctx.on('session/created', (session) => {
      adopt(session)
      schedule()
    })
    ctx.on('session/event', (session) => {
      adopt(session)
      schedule()
    })
    ctx.on('session/disposed', (session) => {
      adopt(session)
      // A session this ledger took from disk is not advanced by `adopt`, so its
      // log is the only place its last events can come from.
      refreshLog(String(session?.id ?? session?.sessionId ?? ''))
      schedule(0)
    })
    ctx.on('session/end-seed', () => schedule())
  }

  if (!restored) log.info('[token-ledger] started a new ledger at %s', ledgerPath)

  /**
   * Handle `/tokens [summary|export|json|path]`.
   *
   * @param {{ rawInput?: string }} input - the command invocation.
   * @returns {{ kind: 'success'|'error', text: string }} the command result.
   */
  const runCommand = ({ rawInput = '' } = {}) => {
    const argument = String(rawInput).trim().split(/\s+/)[0]?.toLowerCase() ?? ''
    switch (argument) {
      case '':
      case 'summary': {
        return { kind: 'success', text: ledger.format() }
      }
      case 'path': {
        return { kind: 'success', text: ledgerPath }
      }
      case 'json': {
        return { kind: 'success', text: JSON.stringify(ledger.snapshot(), null, 2) }
      }
      case 'export': {
        const stamp = new Date().toISOString().slice(0, 10)
        const written = []
        try {
          written.push(writeFileAtomic(join(paths.exportsDir, `daily-${stamp}.csv`), ledger.toCsv('daily')))
          written.push(writeFileAtomic(join(paths.exportsDir, `sessions-${stamp}.csv`), ledger.toCsv('sessions')))
          written.push(writeFileAtomic(join(paths.exportsDir, `models-${stamp}.csv`), ledger.toCsv('models')))
          written.push(saveLedger(join(paths.exportsDir, `ledger-${stamp}.json`), ledger.snapshot()))
        } catch (error) {
          return { kind: 'error', text: `export failed: ${error instanceof Error ? error.message : String(error)}` }
        }
        return { kind: 'success', text: `exported:\n${written.map((path) => `  ${path}`).join('\n')}` }
      }
      default: {
        return {
          kind: 'error',
          text: 'usage: /tokens [summary|export|json|path]',
        }
      }
    }
  }

  if (typeof ctx.inject === 'function') {
    ctx.inject(['commands'], (commandCtx) => {
      commandCtx.commands.register({
        name: 'tokens',
        description: 'Show the cumulative token ledger (per day and per model)',
        // `input` must be an object carrying a non-empty `hint` string; a bare
        // string is rejected by the command registry with a TypeError.
        input: { hint: 'summary | export | json | path' },
        handler: runCommand,
      })
    })
  }

  // The browser half reads this route, which is a read-only view of the live
  // ledger. Without a web server the plugin is still fully usable through
  // /tokens and the CLI, so the service is optional rather than injected.
  //
  // Registration is logged because the settings page can only report that it
  // could not read the route. The log is what distinguishes "this profile has no
  // web server" from "the route failed to register"; from the browser the two
  // look identical.
  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (webCtx) => {
      ctx.effect(() => {
        const dispose = webCtx.webServer.register(
          createOverviewRoute({
            ledger,
            // The overview shows what a period cost, which needs the same prices the
            // bill uses; `rates.read()` serves them from memory, so this adds no
            // network request to a page that polls every minute.
            catalogue: () => rates.read(),
            subscriptions: subscriptionsConfig,
            options: { onError: (error) => log.warn('[token-ledger] overview route failed: %o', error) },
          }),
        )
        const disposeRates = webCtx.webServer.register(
          createRatesRoute({
            rates,
            options: { onError: (error) => log.warn('[token-ledger] rates route failed: %o', error) },
          }),
        )
        const disposeBill = webCtx.webServer.register(
          createBillRoute({
            snapshot: () => ledger.snapshot(),
            catalogue: () => rates.read(),
            subscriptions: subscriptionsConfig,
            providerNames,
            foldSmallSessions,
            smallSession,
            options: { onError: (error) => log.warn('[token-ledger] bill route failed: %o', error) },
          }),
        )
        log.info('[token-ledger] settings page routes ready at %s, %s and %s', OVERVIEW_PATH, RATES_PATH, BILL_PATH)
        return () => {
          disposeBill?.()
          disposeRates?.()
          dispose?.()
        }
      }, 'token-ledger: settings page routes')
    })
  }

  // Prices are enriched from the network but never depend on it. These two files
  // are the same directory, so they travel together in a backup.
  if (ratesEnabled) {
    void rates.refresh({ reason: 'startup' })
    rates.start()
  } else {
    log.info('[token-ledger] pricing refresh is disabled; only hand-entered prices will be used')
  }

  if (typeof ctx.effect === 'function') {
    ctx.effect(
      () => () => {
        rates.stop()
        if (timer !== undefined) {
          clearTimeout(timer)
          timer = undefined
        }
        return flush()
      },
      'token-ledger: flush on dispose',
    )
  }
}

export default { name, apply }
