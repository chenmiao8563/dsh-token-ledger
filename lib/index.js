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
 * @param {{ ledgerPath?: string, backfill?: boolean, rates?: boolean|object }} [config] - composition config. `rates: false` disables the pricing feature's networking entirely, leaving hand-entered values as the only source, which is the setting a strictly offline host wants. `rates.source` picks the price source (`modelsdev`, the default, for each vendor's own list price; or `openrouter` for a gateway's quotes and the widest model coverage). `rates.vendors` caps how many vendors are published (`0` for all of them).
 * @returns {void}
 */
export function apply(ctx, config = {}) {
  const paths = ledgerPaths()
  const ledgerPath = typeof config.ledgerPath === 'string' && config.ledgerPath !== '' ? config.ledgerPath : paths.ledger
  const shouldBackfill = config.backfill !== false
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

  if (shouldBackfill) {
    const onPersistence = (persistenceCtx) => {
      void backfill(persistenceCtx.sessionPersistence)
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
