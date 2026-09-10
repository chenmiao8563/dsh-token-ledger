# dsh-token-ledger

Transparent, auditable token accounting for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

[![CI](https://github.com/chenmiao8563/dsh-token-ledger/actions/workflows/ci.yml/badge.svg)](https://github.com/chenmiao8563/dsh-token-ledger/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@chenmiao8563/dsh-token-ledger.svg)](https://www.npmjs.com/package/@chenmiao8563/dsh-token-ledger)
[![license](https://img.shields.io/npm/l/dsh-token-ledger.svg)](./LICENSE)

[English](README.md) | [中文](README.zh.md)

---

## What this is

A ledger, not a dashboard. It folds the durable DSH session log into token
totals, keeps them restart-safe, and — the part that matters — lets you
**recompute the exact same numbers from the raw logs and diff them** against
what the running host recorded.

```
$ dsh-token-ledger audit
scanned 139 session log(s), 344203 events, 29 fork(s), 0 unreadable

  stored      6901 calls  1205685663 tokens
  recomputed  6901 calls  1205685663 tokens

  audit: match — the stored ledger equals a fresh fold of the raw logs
```

If you only want a pretty chart, there are a dozen plugins for that. This one is
for when you need to *defend* the number.

## Why it installs where others do not

| Property | Why it matters |
| --- | --- |
| **Zero dependencies, zero peer dependencies** | Nothing to resolve, so a version drift in a DSH package cannot break the install. |
| **Zero install scripts** | `dsh plugin add` from a git URL works immediately — pnpm has no build to block and no `allowBuilds` entry to add. |
| **Only `node:` imports** | The host half loads from any profile (web, desktop, headless, TUI) without resolving a single package. |
| **No model-facing surface** | It registers no prompt section, no message and no tool, so it cannot change a request prefix or hurt KV-cache reuse. |
| **Fails soft** | Every hook is guarded. A ledger fault logs a warning; it never fails a session. |

## Install

```bash
# from npm
dsh plugin --profile web add @chenmiao8563/dsh-token-ledger

# from a git URL (no build step is involved)
dsh plugin --profile web add github:chenmiao8563/dsh-token-ledger

# from a local checkout
dsh plugin --profile web add /absolute/path/to/dsh-token-ledger
```

The npm package is scoped because npm rejects the unscoped name
`dsh-token-ledger` as too similar to an existing package once separators are
normalized away. The CLI command is still `dsh-token-ledger`.

Restart DSH, then check the row landed:

```bash
dsh --profile web --dump-config | grep token-ledger
```

In the conversation, `/tokens` prints the ledger:

```
/tokens
/tokens export     # write CSV + JSON under <DSH_HOME>/token-ledger/exports/
/tokens json       # the raw snapshot
/tokens path       # where the ledger file is
```

The ledger is written to `<DSH_HOME>/token-ledger/ledger.json`.

## Counting rules

The numbers are only useful if you know exactly what they count.

| Rule | Behaviour |
| --- | --- |
| **Successful anchors only** | Usage is taken from `assistant/message` (a completed step) and `compaction/summary` (one compaction call). A failed or cancelled attempt never appends either, so it is never counted. |
| **Streaming samples are replaced, not added** | When a step emits a `usage` chunk and then its final message, the final value replaces the earlier sample — one call either way. |
| **`totalTokens` is derived** | It is the sum of the four buckets, never the provider's own total field. Across 15,778 real usage reports the two agreed every single time, and deriving it keeps the buckets and the total consistent by construction. |
| **Reasoning tokens are a subset** | Reported separately, never added into the total, because they are already inside `outputTokens`. |
| **Local calendar days** | Days are your days, not UTC days. |
| **Forks are cut, resumes are not** | See below. |

### Forks versus resumes

A stored log can begin with a prefix of history that was already recorded. Two
different situations produce one, and getting them confused is the most common
way a usage plugin silently gets the wrong answer:

- **Fork** (`parentSession` set): the prefix is the *parent's* history, counted
  in the parent's own log. Counting it again here would double count. It is cut.
- **Resume** (no parent): the prefix is *this session's own* earlier history,
  stored once. Cutting it would lose tokens. Nothing is cut.

This is not a guess. Against real logs, every forked session whose parent log was
still present had its pre-marker usage fingerprints contained in the parent's,
while the non-forked logs carrying the same marker never repeated their prefix
later in the file. On one real 139-session home the distinction was worth
79.9 million tokens of double counting that a naive "count every log" pass
reports.

## CLI

Works without DSH running — it reads the raw logs directly.

```
dsh-token-ledger [summary] [options]     print the stored ledger (default)
dsh-token-ledger audit   [options]       recompute from raw logs and diff
dsh-token-ledger rebuild [options]       recompute from raw logs
dsh-token-ledger export  [options]       write CSV and JSON exports

--home <path>    DSH home to read (default: $DSH_HOME, else ~/.dsh)
--ledger <path>  ledger file to read or write
--out <path>     export destination directory
--days <n>       days in the summary (default 7)
--models <n>     models in the summary (default 5)
--write          with rebuild: replace the stored ledger
--json           machine-readable output
--quiet          suppress the human summary, keep the exit code
```

Exit codes: `0` success or audit match, `1` audit found a real difference,
`2` bad usage or an unreadable input. That makes it usable as a scheduled check.

### The audit distinguishes two kinds of difference

A running host writes its ledger on a debounce, so a live session is routinely a
little ahead of the stored file. Reporting that as corruption would make the
audit useless. The ledger's own `updatedAt` settles it:

- a differing session whose newest event is **newer than the ledger** has simply
  kept running → *match*, with the unflushed amount reported;
- a differing session whose newest event **predates the ledger**, or a day/model
  row that contradicts the fold it should sum to → *mismatch*, exit 1.

```
  audit: match — 1 session(s) advanced after the ledger was written
         (1 calls, 5100 tokens not yet flushed)
```

## Settings page

The browser half adds a **Token ledger** section to the settings sidebar:

- **Range totals** for this month, this year and the last 7 days — total tokens,
  cache hit rate, call count, and the bucket breakdown behind them. The cache hit
  rate is `cacheRead / (cacheRead + uncachedInput)`: the share of input the prompt
  cache absorbed, so a route with no caching reads 0% rather than undefined.
- **Today, live** — today's tokens, hit rate and calls, which move as steps
  complete.
- **A usage calendar** switchable between year, month and week. Year and month are
  heatmaps; the week view is a bar chart. Heat levels are relative to the busiest
  day in the window and square-rooted, so one huge day cannot flatten the rest.
- **Per model** totals, each with its own hit rate.

The page reads one read-only route, `GET /api/token-ledger/summary`, and polls it
every 15 seconds. The route refuses a non-loopback peer, so it stays private even
if the web server is bound to `0.0.0.0`.

It needs a profile with a web server (the `web` or `desktop` profile). Without one,
`/tokens` and the CLI still work, and the section says so instead of failing.

The overview is deliberately **not** published through a settings namespace. That
would need a schema — a real dependency, and this package has none — and would
rewrite `settings.yaml` on every debounce with data that is derived and
reproducible. The ledger file stays the only store of record.

## Configuration

Override the composition entry by its `id`:

```yaml
- id: token-ledger
  config:
    ledgerPath: 'D:/dsh/ledger.json'   # default: <DSH_HOME>/token-ledger/ledger.json
    backfill: false                     # default: true — fold stored history on startup
```

## What it deliberately does not do

- **No pricing.** It counts tokens; turning them into money needs a price
  catalogue that goes stale. Pair it with a billing plugin if you want money.
- **No model-facing tool.** A tool schema costs prompt tokens on every request
  and shifts the cache prefix — a strange thing for a token-accounting plugin to
  do. `/tokens` and the CLI cover the human cases.
- **No UI in 0.1.0.** The host half and the CLI are the contract; a browser half
  is planned for 0.2 as a pure addition.

## Compatibility

- **Node:** ≥ 22.15.0 (the CLI decodes Zstandard frames). The host half itself
  needs nothing version-specific.
- **DSH:** verified on `0.1.2-rc.1`. The surface used — `ctx.on`, `ctx.inject`,
  `ctx.get`, `ctx.effect`, `commands.register`, and
  `sessionPersistence.list()/inspect()` — is the same across the `0.1.2` line.
- **Profiles:** any. There is no profile-specific code.

## Uninstall

```bash
dsh plugin --profile web remove @chenmiao8563/dsh-token-ledger
```

The ledger file is left alone on purpose — delete
`<DSH_HOME>/token-ledger/` yourself to reset the history.

## Development

```bash
npm test            # 49 tests, no dependencies to install
npm run verify      # packaging invariants (dependency-free, no install scripts, no bare imports)
```

`npm test` uses Node's built-in test runner. In a restricted environment where
spawning a child process per test file is blocked, use
`npm run test:single-process`.

See [docs/VERIFICATION.md](docs/VERIFICATION.md) for what was actually verified
and how, including the evidence behind the fork rule.

## Releasing

npm requires two-factor authentication for every publish, so a version's first
release is interactive:

```bash
npm login
npm publish --access public --otp=<six digits from your authenticator>
```

After that first publish, configure a **Trusted Publisher** for the package on
npmjs.com (package → Settings → Trusted Publisher → GitHub Actions, repository
`chenmiao8563/dsh-token-ledger`, workflow `release.yml`). OIDC cannot be set up
before the package exists, which is why the first release is manual. From then
on, a tag push publishes with no stored token at all:

```bash
git tag v0.1.1 && git push origin v0.1.1
```

`release.yml` skips the publish step when the version is already on the
registry and creates the GitHub release regardless, so re-running it is safe.

## License

MIT
