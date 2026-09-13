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

Since 0.6 the settings page has three tabs: **Overview** (the ledger, with what each
period cost), **Rates** (a price list for each vendor's newest models, with the live
USD/CNY rate) and **Bill** (the same usage turned into money — four groupings stacked
over five periods each, exportable as CSV or JSON in one file). The bill names the
price source, the rate and every price it could not apply, so the number can be
checked. See [Settings page](#settings-page).

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

The browser half adds a **Token ledger** section to the settings sidebar, with
three tabs: **Overview**, **Rates** and **Bill**.

### Overview

- **Range totals** for this month, this year, the last 7 days and **all of it** —
  total tokens, cache hit rate, call count, **预计花费 (estimated cost)** and the
  bucket breakdown behind them. *All* is every day the ledger holds, starting at its
  first day. The cache hit rate is `cacheRead / (cacheRead + uncachedInput)`: the
  share of input the prompt cache absorbed, so a route with no caching reads 0%
  rather than undefined.
- **The estimated cost is the bill's own arithmetic**, computed on the host for each
  of the overview's periods, so the number under *this month* and the bill's month
  are the same number rather than two estimators that agree today. It is shown in
  yuan to two decimals, with the rate it converted at. A host that has no prices yet
  shows a dash and says why instead of a confident `¥0.00`, and tokens the bill could
  not price are named underneath the number they are missing from.
- **Today, live** — today's tokens, hit rate, calls and cost, refreshed once a
  minute.
- **A usage calendar** switchable between year, month and week. Year and month are
  heatmaps; the week view is one horizontal bar per day. Heat levels are relative
  to the busiest day in the window and square-rooted, so one huge day cannot
  flatten the rest. The month view also carries a summary beside the grid: the
  busiest day, the lightest weekday and the weekday that ran latest (compared by
  the clock time of the day's last call).
- **Per model** totals, each with its own hit rate and a stacked bar showing where
  the tokens went, with a key naming each bucket that appears. A bucket with no tokens
  anywhere — cache writes, on vendors that publish no cache-write price — is left out
  of the bar and the key rather than being a colour nobody can find in a bar.

### Rates

- **The USD/CNY rate** in its own box, to four decimals, with its source and how
  long ago it was fetched. This tab is a price list: it states prices and converts
  them for display, and says on the page that the cost arithmetic lives on the
  **Bill** tab, where it is applied to the ledger.
- **Each vendor's newest models**, two to three per vendor, with the published
  price per million tokens for input, output, cache read and cache write. A USD
  price is converted into yuan with the rate above; every converted cell keeps the
  dollar quote it came from in its tooltip, and with no rate fetched the table falls
  back to USD and labels its column in dollars rather than printing a number it
  cannot stand behind. A price the vendor does not publish is a dash, which is a
  different claim from "free", and a published `0` is flagged as *not necessarily
  free* because some platforms bill by the hour and publish no per-token price.
- **Prices come from where the vendors publish them.** None of these vendors
  exposes prices through an API — their model-list endpoints return ids and no
  money, so the number only exists on their pricing page. Where that page can be
  read, it is: **DeepSeek, Z.ai and Tencent** are priced from their own pages, and
  their group carries a `vendor` badge saying so. The rest come from a per-vendor
  public dataset ([models.dev](https://models.dev)); `rates.source: openrouter`
  switches the whole table to that gateway's own quotes, which cover more models but
  are not the vendors' list prices. The page says which is which, because those are
  different claims.
- **DeepSeek shows peak and off-peak separately.** Its page prices two models in
  yuan across cache-hit input, cache-miss input and output, each with a peak and an
  off-peak column — off-peak being half of peak outside 09:00–12:00 and 14:00–18:00
  Beijing time on weekdays. Each period is its own labelled row, and the window is
  quoted from the vendor's own page. A vendor that publishes in yuan is displayed in
  yuan, unconverted.
- **The twelve vendors worth listing**, each with its own mark drawn inline from
  bundled geometry: OpenAI, Anthropic, Google, DeepSeek, Qwen, xAI, Z.ai, Kimi,
  MiniMax, Tencent, Xiaomi and ByteDance. The marks are the official ones — taken
  from the vendors' own sites or from Simple Icons — and are the trademarks of their
  owners, used to identify whose price is shown. A vendor outside this list still
  gets a mark and a place when a source carries it; `rates.vendors: 0` publishes
  every vendor.
- **Hand entry.** Any price, and the rate itself, can be typed over — in the
  currency the table is showing. A typed value outranks every later fetch, and a
  row whose number actually changed is marked as hand-entered; typing the value
  the fetch already produces leaves the row unmarked, since a refresh would not
  change it. Either way the row can be handed back to the fetched value or
  cleared. There is also a free-form entry row for a model that no fetch has
  described.
- **Refresh on demand, then settle each disagreement.** A button on the prices
  card runs the same fetch the timer would, without waiting up to half an hour
  for it; a fetch that could not reach a source says so instead of reporting a
  save. When the official price for a model you typed over has moved, the model
  is listed on its own with both numbers and one question — use the official
  price, or keep yours. "Use official" deletes the typed value, handing the field
  back to the catalogue rather than freezing it at today's number; "keep mine"
  records the official number that was on screen, so the same disagreement is
  not raised again until the catalogue actually moves.
- **Offline is a state, not an error.** The host refreshes prices and the rate
  every 30 minutes. A failed refresh keeps the last good result and reports the
  attempt as failed, so a firewalled machine sees the last known prices with a
  visible age rather than a blank page. A host that has never reached the network
  says so and points at the hand-entry form; a host configured with
  `rates: false` makes no request at all and is a price list you maintain.

### Bill

The same usage, grouped the way a bill is read. **Four groupings are stacked** —
workspace, session, model, vendor — rather than put behind a tab, because the
question a bill answers is usually comparative, and **each section carries its own
period**, so this month by workspace can sit above today by model.

- **What each row shows**: the group, **the cost** (实际花费), cache-read input
  (缓存命中输入), the input that missed the cache (未命中输入), output, the cache hit
  rate, and the call count. The two input columns are separate because they are priced
  differently on every vendor that prices them at all; cache-write input is stated
  under each table rather than as a column that would be a dash nearly everywhere.
- **Names that mean something**: a workspace row is the `cwd` the ledger recorded for
  the sessions that ran there; a session row reads `workspace/session-name`, using the
  title DSH itself gave the session (falling back to the session id for sessions DSH
  never titled, with the full id and path in the tooltip); a model row reads
  `provider/model` — the route the ledger recorded, the same name the overview's model
  list shows — with the price row it was billed at in the tooltip.
- **A vendor row is a provider you connected, not a price list.** `bos`, `qwen-plan`,
  `deepseek-official` and `zai` are endpoints; `deepseek`, `qwen` and `z-ai` are whose
  list prices their tokens carry. The row shows the provider — under the display name
  the model settings page gives it, so `BOS-API` rather than `bos`, read from the
  harness settings file and never written to it — and states the price source
  underneath (`计价来源 deepseek`). Two endpoints serving the same model are therefore
  two rows, which is the question a vendor bill exists to answer.
- **Five periods per section**: this month, this year, the last 7 days, today, or
  everything, using the same trailing-window definitions as the overview.
- **One export for all of it, top right.** CSV or JSON, carrying every grouping over
  every period, with the currency on every row and **one `TOTAL` per section**. There
  is deliberately no grand total: the periods overlap, and adding today to this week
  to this month would count the same tokens four times. The CSV starts with a UTF-8
  byte-order mark, without which Excel opens it in the system code page and a session
  named `编写统计` arrives as `缂栧啓缁熻`; the JSON export has none, because a JSON
  parser rejects a leading mark.
- **By plan, without double counting.** `subscriptions` in the config takes monthly
  plans, and the fee is spread over the days the bill covers: the 1st-to-10th of a
  ¥199 month is ¥66.33, not ¥199. A vendor on a plan is billed its plan and the usage
  it covers is shown beside it rather than added to it, because adding them would
  charge for the same calls twice. Because a plan is one charge, on a grouping where
  its vendor appears in several rows — workspaces, sessions, models — the plan is
  *allocated* across those rows in proportion to the usage it covers, which is what
  makes a section's rows add up to its total. A row billed partly by plan says so
  (`其中套餐摊分`), and a plan whose vendor has no usage in the period is still billed,
  because it was still paid for. A plan's `vendor` may name either the provider or the
  price vendor (`bos` or `deepseek`); both resolve to the usage the plan covers.
- **What it could not price is listed, not charged at zero**: each unpriced model
  with its tokens, calls and the reason — no price for that model, an ambiguous name
  that two vendors both publish, or a price in a currency the bill cannot convert.
  Prices joined by name rather than by id are listed too, so a join can be checked
  rather than trusted.
- **A time-priced vendor is billed per side of its window.** DeepSeek prices peak
  and off-peak differently, and the ledger records which calls fell inside the
  window — 09:00–12:00 and 14:00–18:00 on weekdays, Beijing time — so the two are
  priced at their own rates instead of being charged at one of them.
- **The bill is an estimate, and says so.** It multiplies the tokens the session log
  recorded by the published list price of the model the route named. It makes no
  claim about what a provider invoices, which differs for failed, retried and
  partially delivered requests, and it does not know about a plan's included quota
  beyond what you tell it in the config.

The page reads three loopback-only routes: `GET /api/token-ledger/summary` for the
overview, `GET|POST /api/token-ledger/rates` for prices and the rate, and
`GET /api/token-ledger/bill` for the bill. The overview polls once a minute, prices
and the bill only while their view is open. All three refuse a
non-loopback peer, so they stay private even if the web server is bound to
`0.0.0.0`. The write half additionally requires a JSON content type — a
cross-origin form cannot send one — and caps the body at 256 KiB.

It needs a profile with a web server (the `web` or `desktop` profile). Without one,
`/tokens` and the CLI still work, and the section says so instead of failing. Note
that hand-entered prices are entered **on that page**: there is no command-line
equivalent yet, so a headless profile can read the usage ledger but cannot type a
price.

None of the three views is published through a settings namespace. That would need a schema —
a real dependency, and this package has none — and would rewrite `settings.yaml` on
every debounce with data that is derived and reproducible. The ledger file stays the
only store of record; prices live in `rates.json` beside it.

## Configuration

Override the composition entry by its `id`:

```yaml
- id: token-ledger
  config:
    ledgerPath: 'D:/dsh/ledger.json'   # default: <DSH_HOME>/token-ledger/ledger.json
    backfill: false                     # default: true — fold stored history on startup
    rates: false                        # default: true — false makes no network request at all
    # rates also takes an object:
    # rates:
    #   source: modelsdev                # default: the per-vendor dataset; 'openrouter' for gateway quotes
    #   refreshIntervalMs: 1800000       # default: 30 minutes
    #   perVendor: 3                     # default: 3 newest models per vendor
    #   vendors: 15                      # default: cap on how many vendors to publish; 0 for all
    #   modelsUrl: 'https://…'           # default: per source — https://models.dev/api.json
    #   fxUrl: 'https://…/latest/USD'    # default: open.er-api.com
    # Monthly plans, for the bill's plan grouping. Each is amortized over the days
    # a bill covers, so a partial month is billed partially.
    subscriptions:
      - vendor: deepseek                 # which vendor's usage this plan covers
        plan: 'DeepSeek 包月'            # the name shown on the bill
        amount: 199                      # the fee per month
        currency: CNY                    # the currency the fee is quoted in
        startedAt: '2026-09-01'          # optional: not billed before this day
        endedAt: null                    # optional: not billed after this day
        note: null                       # optional: free text, shown with the plan
```

`rates: false` disables the pricing feature's networking entirely and leaves
hand-entered values as the only source. That is the setting a strictly offline host
wants; the rates page still works.

## What it deliberately does not do

- **The overview states an estimate with its basis; the bill itemizes it.** The
  overview shows an estimated cost (yuan, two decimals) in its range totals and in
  today, computed by the bill's own arithmetic; the bill shows every grouping and
  every period row by row. Both name the price source, the rate they converted at,
  every price joined by name and every model that could not be priced, so the number
  can be checked rather than believed. Neither is a provider invoice and neither
  claims to be — see the Bill section above for what they leave out.
- **No bundled price list.** Prices are fetched from a source you can choose — the
  default is each vendor's own list price — or typed by you. A price list shipped
  inside the package would be wrong within weeks and would have to be updated by a
  release.
- **No model-facing tool.** A tool schema costs prompt tokens on every request
  and shifts the cache prefix — a strange thing for a token-accounting plugin to
  do. `/tokens` and the CLI cover the human cases.

## Compatibility

- **Node:** ≥ 22.15.0 (the CLI decodes Zstandard frames). The host half itself
  needs nothing version-specific.
- **DSH:** verified on `0.1.2-rc.1`. The surface used — `ctx.on`, `ctx.inject`,
  `ctx.get`, `ctx.effect`, `commands.register`, and
  `sessionPersistence.list()/inspect()` — is the same across the `0.1.2` line.
- **Profiles:** any. There is no profile-specific code.
- **Network:** the rates tab fetches prices and the USD rate over HTTPS. This is
  entirely optional: with no route to the internet the last fetched result is
  still served from disk, hand-entered values still work, and `rates: false`
  removes the requests altogether.

## Uninstall

```bash
dsh plugin --profile web remove @chenmiao8563/dsh-token-ledger
```

The ledger file is left alone on purpose — delete
`<DSH_HOME>/token-ledger/` yourself to reset the history.

## Development

```bash
npm install         # devDependencies only: react, react-dom, and the slot registry DSH runs
npm test            # 284 tests in 14 files
npm run verify      # packaging invariants (dependency-free, no install scripts, no bare imports)
```

`npm test` uses Node's built-in test runner. In a restricted environment where
spawning a child process per test file is blocked, use
`npm run test:single-process`.

**What a change needs to take effect.** Both halves are read when the plugin mounts,
so editing `lib/index.js` *or* `lib/client.js` needs a DSH restart (or a plugin
reload) — refreshing the page is not enough, because the bundle's `rev` is computed
at mount and an unchanged URL keeps the browser's cached copy. Measured, not assumed:
with an isolated host running, a change to `lib/client.js` left both the served
bundle and its `rev` (`d683dd523466`) untouched, while a restart changed the rev
(`f55ee321db50`) and served the change. Exports are files, so if the one you are
looking at came from before a fix, its timestamp will say so.

The devDependencies are **test-only**. They are never installed for a consumer:
the package ships with no dependencies, no peer dependencies and no install
scripts, and `pnpm` does not install a dependency's devDependencies. They exist
so the browser half can be checked against the real thing — React renders it, so
a hook-order or DOM-prop mistake fails instead of passing silently, and
`@deepseek-ai/dsh-client-ui-slots` validates the registration against the very
registry that DSH runs. Without them installed the affected tests skip with a
stated reason, so `npm test` still works from a fresh clone with no network.

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
