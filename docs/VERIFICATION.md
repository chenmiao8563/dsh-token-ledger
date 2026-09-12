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

`npm test` — 200 tests in 12 files, no dependencies to install, no network. The
suite replaces `globalThis.fetch` for the duration of a mount, so the pricing
refresh is exercised against a host with no route to the internet and no test can
reach the real one:

| File | Tests | Covers |
| --- | --- | --- |
| `test/ledger.test.mjs` | 21 | counting rules, replacement, fork cut, idempotency, snapshot round trip, CSV, and a property-style cross-check against an independent naive implementation over 25 generated logs |
| `test/cli.test.mjs` | 13 | rebuild/audit/rebuild-write/export over synthetic homes, pending-vs-stale classification, tamper detection, exit codes, torn logs |
| `test/plugin.test.mjs` | 20 | the host half against a Cordis stand-in: backfill, fork vs resume, live folding, restart cursors, `/tokens` variants, degraded services, config overrides, both routes and their disposal, the startup refresh, `rates: false`, and a cached catalogue served to a later host with no network |
| `test/session-log.test.mjs` | 7 | Zstandard frame walking: exact round trips, multi-frame files, truncation rejection, torn JSONL lines |
| `test/overview.test.mjs` | 10 | the pure overview projection: ranges, local-day boundaries, cache hit rate, model rows |
| `test/route.test.mjs` | 24 | both routes: the loopback and origin guard, unsupported methods, and for the write half the JSON content-type requirement, malformed and oversized bodies, rejected patches, and the 500 path |
| `test/rates.test.mjs` | 23 | the pure pricing module: per-token to per-million scaling, newest-per-vendor selection for both sources, the curated vendor cap and its order, alias exclusion, the per-vendor provider-id mapping, own-models-before-hosted ordering, zero-price flagging, the FX parse, hand-entered values outranking fetched ones, orphan overrides, and the input validator |
| `test/rates-service.test.mjs` | 12 | fetch, cache, schedule and source selection: a failed refresh keeps the last good value, overrides survive a restart, an invalid patch changes nothing, the timer runs and stops, every transport fault is reported instead of thrown, each source parses its own payload, an unknown source falls back, and a five-megabyte body is a real response rather than an attack |
| `test/client.test.mjs` | 40 | the browser half through a stand-in loader: the module wrapper, the registration contract, formatting, heat levels, series slicing, both views' rendering logic, the currency conversion and the USD fallback, per-vendor provenance, peak and off-peak rows, the bundled vendor marks, the column geometry that keeps model names visible, the zero-price marking, the patches each editor sends when its button is clicked, and that prices are only fetched once the rates tab is open |
| `test/vendor-prices.test.mjs` | 9 | the vendor pricing-page adapters: the HTML helpers, a price written as `0.15元` and as `输入：0.5元`, DeepSeek's merged label cells and both time-of-day columns, Z.ai's storage column that sometimes says "Limited-time Free", Tencent's label-embedded prices, and a row per period |
| `test/client-render.test.mjs` | 13 | the same views under the real React, asserting the actual markup and that the library raises no complaint |
| `test/slot-registration.test.mjs` | 8 | the registration fed into the real slot registry DSH ships |

The React-dependent files skip with a stated reason when `react` and `react-dom`
are not resolvable, which keeps `npm test` working from a fresh clone with no
network.

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

### Where the prices come from, and why that source

The question that produced this section was the right one to ask: the first cut
of the rates view took its numbers from OpenRouter's model list, which is a
**gateway's** price list, not any vendor's own. Checking that claim is what
changed the default.

**No vendor exposes prices through an API.** Probed directly: DeepSeek's
`/models` answers `401` without a key, Anthropic's `/v1/models` answers `403`,
and the documented shape of those endpoints is model ids with no money in them.
Prices exist only on the vendors' pricing pages. The one genuinely public price
API found was Microsoft's Azure Retail Prices (`prices.azure.com`, HTTP 200, but
`Count: 0` for the filter tried), which covers Azure only.

**Two machine-readable per-vendor sources were evaluated.** LiteLLM's
`model_prices_and_context_window.json` could not be reached from this machine
(`raw.githubusercontent.com` times out). [models.dev](https://models.dev)
answered in 4.6 MB: **213 providers and 7,751 models, 7,314 with a `cost` block**
of `input`/`output` and usually `cache_read` (4,765) and/or `cache_write` (1,542),
all numeric, none negative, every priced model carrying a `release_date`. It
covers the vendors the page publishes, under its own ids — `alibaba` for Qwen,
`mistral` for Mistral, `xai` for xAI, `zai` for Z.ai, `meta` for Meta,
`amazon-bedrock` for Amazon, `volcengine` for ByteDance.

**Checked against the vendors' own pages.** The dataset is only worth calling
"the vendor's own list price" if the numbers appear where the vendor published
them:

| Vendor page | Result |
| --- | --- |
| `api-docs.deepseek.com/quick_start/pricing` | 3 of its 4 models match exactly, including `deepseek-v4-flash` at `0.15 / 0.6 / cacheRead 0.003`; `deepseek-v4-pro` at `0.435 / 0.87` is **not** on the page |
| `docs.z.ai/guides/overview/pricing` | 11 of 16 match, including `glm-5.2 = 1.4 / 4.4` and `glm-5.3 = 1.4 / 4.4` |
| `mistral.ai/pricing` | could not be reached from this machine |

The Z.ai line is the one that settled the default. For `glm-5.2` and
`glm-5.3-flash` OpenRouter quotes `0.6 / 2` and `0.15 / 0.5`, while both
models.dev and Z.ai's own page say `1.4 / 4.4` and `0.075 / 0.25`. Across the 27
models both sources describe, **21 agree and 6 differ** — and where they differ,
the vendor's page sides with the per-vendor dataset. OpenRouter's
`moonshotai/kimi-k3` price of `2.302729 / 11.550195` is the tell: a number like
that is a blend across routes, not a list price.

**Still not verified:** that every row is current. Mistral could not be checked
here, a handful of Z.ai rows did not match its page, and the dataset is
community-maintained. This is why the page names its source, keeps the fetch time
on screen, and lets any number be typed over.

### Reading the vendors' own pages instead

Every one of the twelve vendors was then probed for a page a program can read, with
browser headers, because the ask was to take the numbers from the vendors
themselves:

| Vendor | Result |
| --- | --- |
| **DeepSeek** | readable: `api-docs.deepseek.com/zh-cn/quick_start/pricing/` — a table in yuan with merged label cells, a peak and an off-peak column per line, and the charging window stated in prose |
| **Z.ai** | readable: `docs.z.ai/guides/overview/pricing` — `Model / Input / Cached Input / Cached Input Storage / Output`, in dollars |
| **Tencent** | readable: `cloud.tencent.com/document/product/1729/97731` — `产品名 / 刊例价（每 百万 tokens）`, with the prices written inside the label (`输入：0.5元`) |
| OpenAI | `platform.openai.com/docs/pricing` answers **403** to a non-browser client, and `openai.com/api/pricing/` is a marketing page whose only prices are ChatGPT seat plans ($20/$100 per month) |
| Anthropic | `docs.anthropic.com/.../pricing` is client-rendered — 434 KB, no prices in the markup, no tables. The table does exist in `docs.claude.com/llms-full.txt`, which is 34 MB, which is why it is not implemented yet |
| Google | `ai.google.dev/gemini-api/docs/pricing` times out from this machine |
| xAI | `docs.x.ai/docs/models` and `x.ai/api` time out from this machine |
| Qwen | `help.aliyun.com/zh/model-studio/models` has 20 tables and no prices; the pricing must live on another path |
| Kimi | `platform.moonshot.cn/docs/pricing/chat` renders its prices from a script payload |
| MiniMax | `platform.minimaxi.com/document/price` carries only text-to-speech plan prices |
| Xiaomi, ByteDance | JS shells; the Volcengine doc page returns 11 KB with no content |

So three of the twelve are read live — **DeepSeek, Z.ai and Tencent** — and the
other nine keep the dataset's numbers, with each vendor group on the page saying
which it is. An adapter is added per vendor only when its page can be parsed and the
result checked against the page; the framework is in `lib/vendor-prices.js`, so the
remaining nine are a per-vendor job rather than a redesign.

**What reading DeepSeek directly settled.** Its page prices `deepseek-flash` at
`0.02 / 1 / 4` yuan per million off-peak and `0.04 / 2 / 8` at peak (cache-hit
input / cache-miss input / output), and `deepseek-v4-pro` at `0.15 / 4.5 / 13.5` and
`0.3 / 9 / 27`. The dataset had recorded `0.15 / 0.6` USD for the flash model with
`0.003` cache reads — the **off-peak** number, converted. A reader checking at peak
was being told half the real price. That is the concrete answer to "these numbers
are not accurate", and it is why the two periods are now separate rows.

**A correction to an earlier claim in this file.** The first pass concluded that
"where the two sources differ, the vendor's page sides with the per-vendor
dataset". That was wrong for one of the two models it rested on: Z.ai's page says
`GLM-5.3-Flash` is `0.15 / 0.50`, which is the **gateway's** number, while the
dataset had `0.075 / 0.25` — half. `GLM-5.2` did support the claim (`1.4 / 4.4` on
the page and in the dataset, against the gateway's `0.6 / 2`). The honest summary is
that each source is right for some models, which is the argument for reading the
vendor's own page rather than for trusting either aggregator.

### The vendor pages in the running host

With the three adapters in place, a live run reports:

```
outcome: ok (37 models, 12 of 12 vendors, modelsdev; 3 vendor page(s) read)
deepseek [vendor, CNY] — 北京时间周一至周五 9:00 - 12:00、14:00 - 18:00（其余为空闲时段）
   DeepSeek-V4.1-Flash   peak     in 2    out 8     cacheRead 0.04
   DeepSeek-V4.1-Flash   offPeak  in 1    out 4     cacheRead 0.02
   DeepSeek-V4-Pro-0813  peak     in 9    out 27    cacheRead 0.3
   DeepSeek-V4-Pro-0813  offPeak  in 4.5  out 13.5  cacheRead 0.15
z-ai [vendor, USD]     GLM-5.3-Flash 0.15 / 0.5 · GLM-5.3 1.4 / 4.4
tencent [vendor, CNY]  Hunyuan-a13b 输入 0.5 元 输出 2 元
```

Tencent matters for a second reason: it has **no entry in the per-vendor dataset at
all**, so its own pricing page is the only reason it can appear.

## Note for whoever verifies this next

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

## Live host mount, after the fixes (0.2.0)

0.2.0 was published, installed into the same desktop profile and the host
restarted. Three things that had only ever been argued were then observed:

**The ledger rebuilds itself.** The version-2 bump did what it exists for — the
0.1.0 file was discarded rather than trusted, and the fold started again:

```
20:25:00  backfilled 139 stored session(s), 0 unreadable; total  790455336 tokens over 4518 calls   (0.1.0)
20:35:29  started a new ledger at <DSH_HOME>\token-ledger\ledger.json
20:35:36  backfilled 139 stored session(s), 0 unreadable; total 1263174796 tokens over 7069 calls   (0.2.0)
```

**The command registers and answers.** `/tokens` was typed in a live
conversation, and the session log recorded it:

```
command/run  {"name":"tokens","args":" ","source":{"kind":"user"}}
command/done {"kind":"success","text":"Token ledger\n\n  calls  7,069\n  input (uncached)  244,727,714\n  cache read  1,012,…"}
```

**The settings route registers.** The log line added in 0.2.0 for exactly this
purpose is present:

```
21:50:42 [I] [token-ledger] settings page route ready at /api/token-ledger/summary
```

### Independent cross-implementation audit

The strongest check available in this project: the ledger the *running plugin*
wrote — folded from the Cordis persistence service plus live session events — was
audited by the *CLI*, which shares no code with that path and parses the raw
zstd-framed logs itself.

```
$ dsh-token-ledger audit
scanned 139 session log(s), 357988 events, 29 fork(s), 0 unreadable

  stored      7328 calls  1417951113 tokens
  recomputed  7328 calls  1417951113 tokens

  audit: match — the stored ledger equals a fresh fold of the raw logs
```

Identical to the token, on 139 sessions, from two independent implementations.
This closes the backfill-parity question the earlier drafts of this file listed
as unverified, and it is also what makes the 0.1.1 boundary fix credible rather
than merely plausible: the same comparison on 0.1.0 would have shown the gap.

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
block surviving a year-range selection, the year heatmap with its weekday padding
and month axis, the month and week bar charts with their fixed bar widths and
thinned labels, bounded heat levels drawn from the seven-step ramp, the composed
model bars and their colour key, and the loading, error, stale and empty states.
It also captures `console.error` and `console.warn` and **fails if React
complained at all**, which is what catches an invalid DOM prop or a hook-order
violation — the class of defect a hand-rolled `createElement` accepts silently.

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

**Checked in a real browser, by a person.** The browser half is the one part this
environment cannot drive, and it was the last thing left. It is now observed:
the settings section renders in the sidebar, the range tabs and the calendar
switch, and the layout feedback that produced 0.3.0 — month labels wanted on the
year heatmap, a deeper ramp, thinner bars, and a composed model bar — could only
come from looking at the page. What no check here covers is the *appearance* of
the render: spacing, alignment and colour against the rest of the settings UI are
verified by eye, not by assertion.

**Not checked by machine.** The client module loader accepting the file, and the
component mounting into a DOM. Nothing here executes `window.__ModuleLoader__` or
runs a real reconciler into a document: the module's shape is asserted to match
every bundle DSH ships, the registration is validated by the real registry, and
the markup is asserted under the real React — but the loader and the mount are
covered by observation rather than by a test that can run unattended.

## Rates (0.4.0)

Three things had to be true and are checked separately: the sources parse, the
routes serve them, and the write path stores what it is given.

### The live sources, parsed by the plugin's own code

Run on Windows against the real endpoints, through `createRatesService` — not a
reimplementation of it:

```
refresh outcome: {"catalogue":"ok (45 models, 15 of 49 vendors)","fx":"ok (1 USD = 6.725314 CNY)"}
catalogue.totalAvailable: 445
catalogue.vendorCount: 15
catalogue.modelCount: 45
fx.available: true rate: 6.725314 USD->CNY
first vendors: openai (gpt-6-astra in=10 out=50), anthropic (claude-fable-5.1 in=10 out=50),
               google, deepseek, qwen, x-ai, meta-llama, mistralai, z-ai, moonshotai, …
```

445 entries in the response selected down to **45 rows across 15 of 49 vendors**,
at most three per vendor, in an 11 KB payload — down from the 123 rows and 30 KB
the view carried before the vendor cap. The order is the curated one, not model
count. Both endpoints answer without a key.

This probe is what found the negative-price sentinel. Five entries in the live
list carry `pricing: {prompt: "-1", completion: "-1"}` (the `openrouter/auto*`
routers, which have no single price). A negative number is not a price and must
not be rendered as `¥0`; those rows are dropped, and after that change **no
published row carries a price-free row at all**. 46 rows have no cache-read price,
which is why the table renders a dash rather than inventing one.

A separate probe listed every vendor id the live catalogue actually uses, because
the curated list has to be spelled the way the source spells it: `meta-llama` and
`x-ai` are real ids while `meta` and `xai` are not, and `~openai` is an alias that
has to be excluded rather than counted as a vendor.

### Both routes over a real socket

The host half was mounted behind a real `node:http` server (not the DSH web
server) with the real network, then driven with `fetch`:

```
registered paths: [ '/api/token-ledger/summary', '/api/token-ledger/rates' ]
GET summary -> 200 bytes 1350
GET rates   -> 200 bytes 30555
  catalogue: true 123 rows / 56 vendors of 445
  fx: 6.725314 USD -> CNY ageMs 6033 overridden false
  refreshIntervalMs: 1800000
cache-control: no-store content-type: application/json; charset=utf-8
POST rates -> 200 {"models":1,"fx":true}
  row now: openai/gpt-6-astra {"input":1.25,"output":9.5,...} source: manual
  fx now: 7.01 overridden: true source: manual
POST orphan -> 200   (a hand-entered model no fetch described, published as its own group)
fx after reset: 6.725314 overridden: false
POST form content-type -> 415
POST malformed json    -> 400
POST bad value         -> 400
POST oversized body    -> 413 {"error":"body exceeds 262144 bytes"}
PUT rates              -> 405
```

and the host logged:

```
[token-ledger] settings page routes ready at %s and %s  /api/token-ledger/summary  /api/token-ledger/rates
[token-ledger] rates refresh (%s): catalogue %s, fx %s   startup  ok (123 models, 56 vendors)  ok (1 USD = 6.725314 CNY)
```

This is the check that found the oversized-body behaviour: the handler used to
destroy the request while answering, so the caller saw a connection reset instead
of the 413 it had just written. Destroying it was the bug; the stream is now left
alone and the status arrives as `413 {"error":"body exceeds 262144 bytes"}`.

### Checked by hand

The same probe drove the offline path: with the refresh forced to fail, the cached
catalogue and rate are still served with an `ageMs` attached, `lastRefresh`
reports `failed (…)`, and the manual entry group is published rather than
discarded. The isolated two-mount test in `test/plugin.test.mjs` pins the same
story on the second host with no network at all.

## Live host mount, 0.4.0 — the real DSH web server

The gap the previous section left open ("a real `node:http` server, not the DSH
web server") is now closed. 0.4.0 was mounted in a real DSH host with its own web
server, on an isolated home, on a port of its own:

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
$env:DSH_HOME = '<tmp>\host-check\home'
& '<install>\DSH Desktop.exe' --expose-internals '<install>\resources\app.asar\lib\desktop-cli.js' `
    plugin --profile web add <repo path>
& '<install>\DSH Desktop.exe' --expose-internals '<install>\resources\app.asar\lib\desktop-cli.js' `
    --profile web --no-open --port 43977
```

Installing printed `+ @chenmiao8563/dsh-token-ledger link:<repo path>`, and the
profile it composed was `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app` and
this package. Both routes then answered **through DSH's own web server**:

```
GET /api/token-ledger/summary -> 200, 1350 bytes, plugin "token-ledger"
GET /api/token-ledger/rates   -> 200, 30558 bytes
  catalogue: available, 123 rows / 56 vendors of 445
  fx: 6.725314 USD -> CNY
  refreshIntervalMs: 1800000
  first row: openai / openai/gpt-6-astra
POST /api/token-ledger/rates  -> 200, {"models":1,"fx":true}
  row source: manual, input: 1.25, output stayed: 50   (only the typed price moved)
  fx: 7.01 overridden=true
GET  /api/token-ledger/rates  (Origin: https://evil.example) -> 403
```

The host wrote both state files into the isolated home — `token-ledger/ledger.json`
(295 bytes) and `token-ledger/rates.json` (53,777 bytes) — which is what proves the
pricing refresh actually ran inside the host rather than only under test.

**The browser half is served too.** Reading the boot manifest out of the settings
page gave the entry's bundle path, and the host served it:

```
GET /plugins/??@chenmiao8563/dsh-token-ledger/client.js&rev=…  -> 200, 72106 bytes
  contains tabRates, ratesTitle, api/token-ledger/rates, manualFormTitle, __ModuleLoader__
```

So the artifact the browser loads is the 0.4.0 client half. What is *not* covered
is the same thing as before: nobody has looked at the rendered page.

The isolated host was then stopped by port, and the machine's real DSH instance
(a different process, on its own port) was confirmed still listening.

## Not verified

Stated plainly, because a verification file that only lists successes is not
useful:

- **Any DSH release other than `0.1.2-rc.1`.** The API surface used is stable
  across the `0.1.2` line by inspection, not by test.
- **Non-Windows platforms.** The logic is platform-independent and CI runs
  Linux, macOS and Windows jobs, but all manual verification above was on
  Windows.
- **Provider billing agreement.** The ledger counts what the session log
  records. It makes no claim about what a provider invoices, which can differ
  for failed, retried or partially delivered requests.
- **The rates view in a real browser.** Both views are asserted under the real
  React, their markup is checked, and the bundle the browser receives was fetched
  from a running host — but no one has yet looked at the Rates tab on screen. The
  0.3.0 round of feedback came from looking at the page; this one has not had that
  pass.
- **Price accuracy.** The tables are asserted to carry what the source published,
  spot-checked against one vendor's published numbers. Nothing here verifies that
  a source is correct, current, or the price a given account is actually billed.
- **The 30-minute timer over a long run.** The interval is asserted to be
  configured and to fire and stop under test; that it keeps working across a
  multi-hour session, and that the host does not keep a process alive for it, is
  asserted only by the `unref` call rather than by observation.

Two items that earlier drafts of this file listed here have since been closed
with evidence rather than removed quietly: `/tokens` answering in a live
conversation, and backfill parity with the CLI on a real host. Both are recorded
under [Live host mount, after the fixes](#live-host-mount-after-the-fixes-020)
above.
