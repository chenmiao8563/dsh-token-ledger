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

### Note for whoever verifies this next

On this machine the `dsh` shell shim hardcodes `DSH_HOME`, so exporting
`DSH_HOME` before calling `dsh` does **not** isolate anything — it edits the real
home. Isolate by invoking the packaged CLI directly:

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
$env:DSH_HOME = '<tmp>\home'
& '<install>\DSH Desktop.exe' --expose-internals '<install>\resources\app.asar\lib\desktop-cli.js' plugin --profile web add <path>
```

## Not verified

Stated plainly, because a verification file that only lists successes is not
useful:

- **Live in-process mount inside a running DSH host.** The composition is proven
  (`--dump-config`), and the plugin's behaviour against a Cordis stand-in is
  covered by tests, but the packaged desktop CLI exposes no way to boot the
  plugin tree without serving the GUI, so the plugin was not observed mounting
  inside a real host process, and `/tokens` was not exercised in a live
  conversation. The remaining risk is confined to the host's exact service
  contract at mount time, not to the counting logic.
- **Any DSH release other than `0.1.2-rc.1`.** The API surface used is stable
  across the `0.1.2` line by inspection, not by test.
- **Non-Windows platforms.** The logic is platform-independent and CI runs
  Linux, macOS and Windows jobs, but all manual verification above was on
  Windows.
- **Provider billing agreement.** The ledger counts what the session log
  records. It makes no claim about what a provider invoices, which can differ
  for failed, retried or partially delivered requests.
