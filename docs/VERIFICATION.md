# Verification

What was actually verified for `dsh-token-ledger` 0.1.0, on what, and how. The
point of this file is to be checkable and to state its own gaps.

## Environment

| Item | Value |
| --- | --- |
| Date | 2026-09-10 |
| OS | Windows (win32) |
| Node.js | v24.18.0 |
| DSH | 0.1.2-rc.1 (packaged desktop build) |
| Host profile under test | a disposable `web` profile under an isolated `DSH_HOME` |

## Test suite

`npm test` — 49 tests, no dependencies to install, no network:

| File | Tests | Covers |
| --- | --- | --- |
| `test/ledger.test.mjs` | 17 | counting rules, replacement, fork cut, idempotency, snapshot round trip, CSV, and a property-style cross-check against an independent naive implementation over 25 generated logs |
| `test/cli.test.mjs` | 13 | rebuild/audit/rebuild-write/export over synthetic homes, pending-vs-stale classification, tamper detection, exit codes, torn logs |
| `test/plugin.test.mjs` | 12 | the host half against a Cordis stand-in: backfill, fork vs resume, live folding, restart cursors, `/tokens` variants, degraded services, config overrides |
| `test/session-log.test.mjs` | 7 | Zstandard frame walking: exact round trips, multi-frame files, truncation rejection, torn JSONL lines |

## Evidence from real session logs

These runs used a real DSH home with 139 stored sessions. They are the basis for
the counting claims in the README; the numbers are reproducible against any
populated home with the CLI.

### Frame walking covers every byte

All 139 logs decoded with **228,868 frames** and **344,203 events**, and the
frame boundaries accounted for **100% of every file's bytes** — no magic-number
scanning, no silently dropped tail.

### `totalTokens` is the four-bucket sum

Across **15,778** provider usage reports (messages, usage chunks and compaction
summaries), the provider's own `totalTokens` field differed from
`input + output + cacheRead + cacheWrite` **zero** times. This is why the ledger
derives the total instead of trusting the field, and why the buckets and the
total cannot drift apart.

`cacheWriteTokens` was non-zero in **zero** reports: DeepSeek does not populate
that bucket, so a zero there is expected rather than a bug.

### Fork versus resume

The rule "cut a fork's prefix, never cut a resume's prefix" was derived from the
data rather than assumed:

| Finding | Count |
| --- | --- |
| Logs whose first record is a `session` header | 139 / 139 |
| Logs carrying a `session/end-seed` marker | 72 |
| ... of those, with a `parentSession` (a fork) | 29 |
| ... of those, without a parent (a resume) | 43 |
| Forks whose pre-marker usage fingerprints are a subset of the parent's history | 24, plus 5 whose prefix contains no usage at all (vacuously true) |
| Resumes whose prefix reappears later in the same file | 1 of 43 (consistent with a fingerprint collision between two identically-sized calls) |

Cutting only the 29 forks changes the home's total from **1,284,550,137** to
**1,204,627,868** tokens — **79,922,269 tokens** of double counting avoided.

### A real audit

```
$ dsh-token-ledger rebuild --write
scanned 139 session log(s), 344203 events, 29 fork(s), 0 unreadable
wrote <DSH_HOME>/token-ledger/ledger.json

$ dsh-token-ledger audit
scanned 139 session log(s), 344203 events, 29 fork(s), 0 unreadable

  stored      6901 calls  1205685663 tokens
  recomputed  6901 calls  1205685663 tokens

  audit: match — the stored ledger equals a fresh fold of the raw logs
```

Running `audit` while the session that was producing this very document kept
generating produced the intended non-alarming result instead of a false alarm:

```
  audit: match — 1 session(s) advanced after the ledger was written
         (1 calls, 5100 tokens not yet flushed)
```

## Profile install, isolated

Verified with a disposable `DSH_HOME` so no real profile was touched:

```
$ DSH_HOME=<tmp>/home <dsh-desktop-cli> plugin --profile web add <repo path>
dsh: initialized profile web at <tmp>/home/profiles/web
+ @chenmiao8563/dsh-token-ledger link:C:/.../plugins/dsh-token-ledger
Done in 317ms using pnpm v11.8.0
```

The profile manifest was updated by the CLI's own reconciler, which only adds a
dependency whose package declares `dsh.bundle.patch`:

```json
"dsh": { "profile": { "bundles": [
  "@deepseek-ai/dsh-base",
  "@deepseek-ai/dsh-web-app",
  "@chenmiao8563/dsh-token-ledger"
] } }
```

And the composition really contains the row, with the scoped specifier resolving
as a Cordis entry name:

```
$ DSH_HOME=<tmp>/home <dsh-desktop-cli> --profile web --dump-config
# == @chenmiao8563/dsh-token-ledger
- id: token-ledger
  name: '@chenmiao8563/dsh-token-ledger'
```

Installing involved no build step and no `allowBuilds` entry, which is the
package's central installability claim.

### Why the package is scoped

The unscoped name `dsh-token-ledger` was rejected at publish time:

```
403 Forbidden - PUT https://registry.npmjs.org/dsh-token-ledger - Package name
too similar to existing package dsh-tokenledger
```

npm normalizes separators away before comparing, so `dsh-token-ledger` and the
existing `dsh-tokenledger` collide. Note that a registry lookup for the name
returned `E404`, which only proves the name is unclaimed — it does not predict
this similarity gate, which runs at publish time. The scoped name was
re-verified end to end as shown above; the CLI command and Cordis entry id are
unchanged.

### Install from the npm registry, isolated

The published artifact was installed the way a stranger would install it, into a
disposable `DSH_HOME`:

```
$ DSH_HOME=<tmp>/home <dsh-desktop-cli> plugin --profile web add @chenmiao8563/dsh-token-ledger
dsh: initialized profile web at <tmp>/home/profiles/web
Progress: resolved 1, reused 0, downloaded 0, added 0
dependencies:
+ @chenmiao8563/dsh-token-ledger ^0.1.0
Packages: +1
Progress: resolved 1, reused 0, downloaded 1, added 1, done
Done in 2.7s using pnpm v11.8.0
```

The lockfile records a real registry resolution with its integrity hash and the
declared engine range:

```
'@chenmiao8563/dsh-token-ledger@0.1.0':
  resolution: {integrity: sha512-yApGruS1Hcyq0oIOq8t6Y8gAJFefAoiHLzDsvPsecND6+DIj878x8YtQ5Ggz+PVYL9yTvaPAgIVcOhyBNvPGnw==}
  engines: {node: '>=22.15.0'}
  hasBin: true
```

The reconciler added it to the bundle stack, and `pnpm-workspace.yaml` was left
untouched — **no `allowBuilds` entry was needed**, which is the installability
claim this document exists to check:

```json
"dsh": { "profile": { "bundles": [
  "@deepseek-ai/dsh-base",
  "@deepseek-ai/dsh-web-app",
  "@chenmiao8563/dsh-token-ledger"
] } }
```

The packument itself took roughly two minutes to become readable after the first
publish in the new scope — during that window `dist-tags` and the tarball were
already live while `GET /@chenmiao8563%2Fdsh-token-ledger` still returned 404.
That is registry propagation, not a failed publish.

### Note for whoever verifies this next

On this machine the `dsh` shell shim hardcodes `DSH_HOME`, so exporting
`DSH_HOME` before calling `dsh` does **not** isolate anything — it edits the real
home. Isolate by invoking the packaged CLI directly:

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
$env:DSH_HOME = '<tmp>\home'
& '<install>\DSH Desktop.exe' --expose-internals '<install>\resources\app.asar\lib\desktop-cli.js' plugin --profile web add <path>
```

## Live host mount

Version 0.1.0 was installed into a real desktop profile, the host was restarted,
and the host log recorded the mount:

```
20:24:52 [I] [token-ledger] started a new ledger at <DSH_HOME>\token-ledger\ledger.json
20:24:52 [E] [token-ledger] TypeError: command "tokens" input hint must be a string
20:25:00 [I] [token-ledger] backfilled 139 stored session(s), 0 unreadable; total 790455336 tokens over 4518 calls
```

This step was worth doing precisely because it failed. Both defects it exposed
were unreachable from the 49-test suite, and both are fixed in 0.1.1 with
regression tests:

| Defect | Evidence | Cause |
| --- | --- | --- |
| `/tokens` never registered | the `TypeError` above, and no `command/*` event when `/tokens` was typed | `input` was passed as a bare string; the registry requires `{ hint: string }`. The throw also aborted the rest of `apply()`, so the flush-on-dispose effect was never installed |
| backfill under-counted forks | 4,518 calls / 790,455,336 tokens against the CLI's 6,901 / 1,205,685,663 on the same logs | the inherited boundary was applied as a raw index, but the row-form log packs several logical events per record, so the declared count overshot the array and skipped those sessions entirely |

The diagnosis came from the ledger's own artifacts rather than from guesswork:
the host log line above, and a cross-tabulation of the ledger's 65 recorded
sessions against the 72 logs carrying a `session/end-seed` marker and the 29
declaring a parent. The 61 sessions outside both sets turned out to be
four-record logs with no usage at all, which is why they correctly have no entry.

## Browser half (0.2.0)

What is checked here and what is not, because the difference is large.

**Checked by test.** `lib/overview.js` and `lib/route.js` are pure or near-pure
and are tested directly: range boundaries, cache-hit-rate arithmetic, gap-filled
series, the loopback and origin guard, method handling, and the 500-on-fault
path. The browser half is loaded through a stand-in module loader with a
stand-in React, which exercises the module wrapper, the registration contract,
and the whole render tree — formatting, heat levels, week-bar slicing, view
switching, and the empty, malformed and stale-data paths.
`scripts/verify-package.mjs` additionally fails the build if the browser half
requires anything the loader does not provide, if its module id stops matching
the package name, if it stops compiling as a classic script, or if a declared
client dependency is outside the client-half namespace.

**Checked by reading DSH's own source, not by inference.** The contracts the
browser half depends on were read out of the shipped bundles rather than copied
from a third-party plugin:

| Contract | Where it was read | Result |
| --- | --- | --- |
| The `settings.section` registration shape | the sections DSH ships — `dsh-client-ui-settings-models` (order 10), `-settings-plugins` (15) and `-ui-agent-preset` (20) — plus the shell in `-settings-general` that renders them via `renderSlot("settings.section", …, { only: active })` | identical field set; `locale` is optional, proven by `-settings-models` omitting it; the sidebar rows come from `id`, `order` and `label`, all of which this plugin supplies |
| The client module format | every `@deepseek-ai/dsh-client-*/lib/client.js` | byte-identical wrapper: `window.__ModuleLoader__.load({ id, factory })` with `var module = { exports: {} }` and `exports.apply`/`exports.inject` |
| When the factory runs | `dsh-client-modules` module docs | only registration happens at script execution; body side effects, styles included, run at materialization — which is why the stylesheet is installed inside `apply()` |
| The `dsh.client` declaration | `parseDshClient` in `dsh-client-modules/lib/index.js` | `platform` must be a string and only `web` is loaded; `inject` and `external` are optional string arrays; `external` — not `inject` — is what orders the module graph |
| What `dsh.client.inject` **contains** | the five `dsh.client` declarations DSH ships, two of them non-empty: `dsh-client-locale` and `dsh-client-ui-settings-general` | **package/entry ids, not service names.** A module's own exported `inject` is the separate service list. This plugin lists the two packages whose services it uses, which is the same convention, and an empty list is also legal (`dsh-client-connection` uses one) |
| What `external` contains | the module-graph walk in `dsh-client-modules/lib/client.js`, which runs every entry through `stripClientSuffix` before resolving it | module specifiers for *other rows*. This plugin requires only `react`, which the loader provides and no row owns, so it declares none |
| How `exports["./client"]` is located | `clientExportOf` in `dsh-client-modules/lib/index.js` | a plain string or an object with a string `default`; anything else throws. A plain string is used here, and `verify-package.mjs` pins it |
| Whether a **scoped** package id survives | `stripClientSuffix` in `dsh-client-modules/lib/client.js` | it removes only a trailing `/client`, so `@chenmiao8563/dsh-token-ledger` passes through intact. DSH's own client packages are scoped too, so the transport already carries ids containing `/` |

That reading corrected two real mistakes in the first draft of this half, both of
which would have been a silent failure rather than an error:

- `@deepseek-ai/dsh-client-ui-slots` was listed as a client dependency. It is a
  pure core library (its manifest exports only `.`, and it declares no
  `dsh.client`), so it is never a client module row.
- The settings shell package was listed as `-ui-settings`, which holds the
  namespace-scope service; the section slot is declared and rendered by
  `-ui-settings-general`.

**Checked under the real React.** `test/client-render.test.mjs` renders the
presentation component with React 18.3.1 — the same major version DSH bundles —
through `react-dom/server`, and asserts the actual markup: the range tabs and
their active state, the totals, hit rate and call count for each range, today's
block surviving a year-range selection, the year heat grid (one cell per day plus
five legend swatches), the month grid (every day of March), the week bars (seven,
with inline heights), bounded heat levels drawn from a five-entry palette,
proportional model bars, and the loading, error, stale and empty states. It also
captures `console.error` and `console.warn` and **fails if React complained at
all**, which is what catches an invalid DOM prop or a hook-order violation — the
class of defect a hand-rolled `createElement` accepts silently.

React is a devDependency, so this runs in CI and under `prepublishOnly`. Without
it installed the file skips with a stated reason rather than failing, which keeps
`npm test` working from a fresh clone with no network.

**Checked against the real slot registry.** `test/slot-registration.test.mjs`
feeds the registration `apply` actually builds into
`@deepseek-ai/dsh-client-ui-slots` — the registry DSH itself runs, pinned as a
devDependency to `0.1.2-rc.1`, the exact version this DSH bundles (`latest` on
npm is an older `0.0.1-rc.1`, so the version is pinned rather than ranged). It
asserts that the registry accepts the entry, that `resolveSlotLabel` resolves the
label thunk to a non-empty string — a label it could not resolve would render as
a blank sidebar row — that the entry id does not collide with the three sections
DSH ships, that a duplicate id is refused, that disposing retires the entry, and
that registering into an undeclared slot is refused, which is why the plugin uses
`slots.inject` rather than registering blind.

**Not checked.** Whether the client module loader accepts the file, whether the
shell renders the section, and how any of it looks. Nothing here executes
`window.__ModuleLoader__` or mounts the component into a DOM: the module's shape
is asserted to match every bundle DSH ships, and the registration is validated by
the real registry, but no single process loads the plugin the way the browser
does. The remaining risk is integration and visual — a first-run surprise, not a
contractual one.

## Not verified

Stated plainly, because a verification file that only lists successes is not
useful:

- **`/tokens` end to end through the GUI.** The command now satisfies the
  registry contract and is covered by a regression test, but the corrected build
  has not yet been observed answering `/tokens` in a live conversation.
- **Backfill parity with the CLI on a real host.** Both paths now share one
  boundary function, and each is tested, but the backfill's numbers have not
  been compared against a CLI rebuild on the same host after the 0.1.1 fix.
- **Any DSH release other than `0.1.2-rc.1`.** The API surface used is stable
  across the `0.1.2` line by inspection, not by test.
- **Non-Windows platforms.** The logic is platform-independent and CI runs
  Linux, macOS and Windows jobs, but all manual verification above was on
  Windows.
- **Provider billing agreement.** The ledger counts what the session log
  records. It makes no claim about what a provider invoices, which can differ
  for failed, retried or partially delivered requests.
