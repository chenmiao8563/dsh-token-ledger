# Verification

What was actually verified for `dsh-token-ledger`, on what, and how. The
point of this file is to be checkable and to state its own gaps.

## Environment

| Item | Value |
| --- | --- |
| Date | 2026-09-13 (0.8.0; the 0.7.x and 0.6.0 runs below were on 2026-09-12) |
| OS | Windows (win32) |
| Node.js | v24.18.0 |
| DSH | 0.1.2-rc.1 (packaged desktop build) |
| Host profile under test | a disposable `web` profile under an isolated `DSH_HOME` |

## Test suite

`npm run test:single-process` — **288 tests in 14 files, all passing**, with no
dependencies to install and no network. (That is the same suite as `npm test`;
the per-file process isolation Node uses by default cannot `spawn` on this
machine, so the isolation-free runner is the one used here.) The
suite replaces `globalThis.fetch` for the duration of a mount, so the pricing
refresh is exercised against a host with no route to the internet and no test can
reach the real one:

| File | Tests | Covers |
| --- | --- | --- |
| `test/ledger.test.mjs` | 28 | counting rules, replacement, fork cut, idempotency, snapshot round trip, CSV — including the byte-order mark on its bytes — the peak/off-peak split and the usage cross table, workspace capture, the session title DSH gives a session (last one wins, blank and non-string titles ignored, survives a restart), and a property-style cross-check against an independent naive implementation over 25 generated logs |
| `test/cli.test.mjs` | 13 | rebuild/audit/rebuild-write/export over synthetic homes, pending-vs-stale classification, tamper detection, exit codes, torn logs |
| `test/plugin.test.mjs` | 21 | the host half against a Cordis stand-in: backfill, fork vs resume, live folding, restart cursors, the working directory read from the session header rather than from the sequenced events, `/tokens` variants, degraded services, config overrides, all three routes and their disposal, the startup refresh, `rates: false`, and a cached catalogue served to a later host with no network |
| `test/session-log.test.mjs` | 7 | Zstandard frame walking: exact round trips, multi-frame files, truncation rejection, torn JSONL lines |
| `test/overview.test.mjs` | 10 | the pure overview projection: ranges, local-day boundaries, cache hit rate, model rows |
| `test/bill.test.mjs` | 27 | the pure bill: name/version model joins and the refusals (a different version is a different model; a tie between two vendors is refused rather than guessed), per-period pricing against one price row, grouping by provider/model/workspace/session with a session labelled `workspace/title` and a model labelled by the route it recorded, each range including `today` and "everything", conversion and the dollars fallback when there is no rate, an unpriced model listed rather than charged at zero, plan amortization over the covered days, a plan replacing the usage it covers, a plan allocated across rows so that every grouping's rows sum to its own total, a plan that has not started leaving its vendor's usage billable, a hand-written config entry that is not an object being skipped rather than fatal, the CSV's shape **and its byte-order mark**, and a Chinese session name surviving the file byte for byte |
| `test/route.test.mjs` | 41 | all three routes: the loopback and origin guard, unsupported methods, the bill's grouping and range lists with their fallbacks (one section per request, twenty for an export), the CSV download and its filename, the overview's per-period costs and its degradation when there are no prices, and for the write half the JSON content-type requirement, malformed and oversized bodies, rejected patches, and the 500 paths |
| `test/rates.test.mjs` | 27 | the pure pricing module: per-token to per-million scaling, newest-per-vendor selection for both sources, the curated vendor cap and its order, alias exclusion, the per-vendor provider-id mapping, own-models-before-hosted ordering, zero-price flagging, the FX parse, hand-entered values outranking fetched ones, orphan overrides, the adopt/keep decision, and the input validator |
| `test/rates-service.test.mjs` | 13 | fetch, cache, schedule and source selection: a failed refresh keeps the last good value, overrides survive a restart, an invalid patch changes nothing, the timer runs and stops, every transport fault is reported instead of thrown, each source parses its own payload, an unknown source falls back, and a five-megabyte body is a real response rather than an attack |
| `test/client.test.mjs` | 56 | the browser half through a stand-in loader: the module wrapper, the registration contract, formatting, heat levels, series slicing, all three views' rendering logic, the overview's estimated cost per range and per day (including the no-prices dash), the bill's four stacked sections with a period each, its export links and its per-section failure, the currency conversion and the USD fallback, per-vendor provenance, peak and off-peak rows, the bundled vendor marks, the column geometry that keeps model names visible, the zero-price marking, the patches each editor sends when its button is clicked, and that each view reads its route only when it is opened |
| `test/vendor-prices.test.mjs` | 9 | the vendor pricing-page adapters: the HTML helpers, a price written as `0.15元` and as `输入：0.5元`, DeepSeek's merged label cells and both time-of-day columns, Z.ai's storage column that sometimes says "Limited-time Free", Tencent's label-embedded prices, and a row per period |
| `test/client-render.test.mjs` | 21 | the same views under the real React, asserting the actual markup, the bill's four cards, twenty period tabs, export URLs and money columns, and that the library raises no complaint |
| `test/providers.test.mjs` | 7 | the provider display names: the `providers:` block read out of a plugin-scoped settings file, quotes and comments and `~`-escaped names, several blocks merged, a name never guessed from a model list, a missing or unreadable file degrading to the provider id, and the cache window that keeps a poll from re-reading the file |
| `test/slot-registration.test.mjs` | 8 | the registration fed into the real slot registry DSH ships |

The React-dependent files skip with a stated reason when `react` and `react-dom`
are not resolvable, which keeps `npm test` working from a fresh clone with no
network. The counts above were taken with React resolvable, so none skipped.

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

## The bill, 0.5.0 — real ledger, real prices, real host

Three separate things were checked: the arithmetic over the real ledger, the
route inside a real DSH web server, and the exported file matching the response.

### What the real ledger bills

The ledger was rebuilt from this machine's 140 stored sessions into the version-4
shape (`dsh-token-ledger rebuild --ledger … --write`): **1,781,106,633 tokens**
across **8,283 calls**, of which **796,057,786** were recorded inside DeepSeek's
peak window and **985,048,847** outside it. The bill was then computed against a
freshly fetched live catalogue (fx **6.725314**):

```
by vendor          calls        input       output     hit          cost
deepseek           5,478  213,824,029    4,111,258   83.8%    CNY 444.31
qwen               1,924   19,451,225    2,199,720   94.0%     CNY 63.98
z-ai                 881   13,773,217    1,152,944   89.3%     CNY 53.55

by workspace
E:\bosc_project\torchv-master  2,218  165,436,946  1,231,026  48.6%  CNY 331.55
…
```

Every model that appeared in the ledger was priced: **zero unpriced rows**, and
seven joins, six of them exact. The DeepSeek route in the log
(`deepseek-official/deepseek-v4-flash`) matches no price id directly and is joined
by name to `deepseek/deepseek-flash`, which is exactly the kind of join the bill
lists rather than hides.

### The route inside a real DSH host

An isolated `DSH_HOME`, a disposable `web` profile, the real ledger copied in, and
one plan configured through the profile's patch layer
(`- id: token-ledger` / `config.subscriptions`):

```
GET  /api/token-ledger/summary                                -> 200, 1350 bytes
GET  /api/token-ledger/bill                                   -> 200, application/json
GET  /api/token-ledger/bill?by=workspace&range=all            -> 200
GET  /api/token-ledger/bill?by=session&range=all&format=csv   -> 200, text/csv
     content-disposition: attachment; filename="token-bill-session-2026-09-12.csv"
GET  /api/token-ledger/bill?by=nonsense&range=nonsense        -> 200, by=vendor, month
GET  /api/token-ledger/bill  (Origin: https://evil.example)   -> 403
POST /api/token-ledger/bill                                   -> 405
```

The plan was picked up from the host config and billed as a share of the days the
bill covered — ¥199 for September 1–12 is **79.60**, and DeepSeek's row reads
79.60 where its usage alone would have been 444.31:

```
by subscription        label                calls        cost     usageCost
  (pay as you go)      [null]               2,805      117.54        117.54
  DeepSeek 包月         [plan]               5,478       79.60        444.31
  totals: usageCost 561.85 · subscriptionCost 79.60 · totalCost 197.14
```

197.14 is 79.60 + 117.54: the plan is not added to the usage it covers. The CSV
ended with `TOTAL,8283,…,197.1369,CNY`, the same number to four decimals as the
JSON `totals.totalCost` — which is the property the export exists to have.

The browser half served by that host was read back too: the boot page's bundle
list names `@chenmiao8563/dsh-token-ledger/client.js`, and the 3.86 MB bundle the
host serves contains `tabBill`, `billTitle`, `api/token-ledger/bill`,
`billExportCsv`, `billCoveredUsage` and `tl-bill-total`. So the artifact a browser
loads is the one with the bill tab in it.

The isolated host was stopped by port afterwards, and this machine's real DSH
instance on its own port was confirmed still listening.

## The stacked bill and the overview's cost, 0.6.0

The same host was reused — isolated `DSH_HOME`, disposable `web` profile, one
¥199 DeepSeek plan in the patch layer — with the ledger rebuilt to version 5 from
this machine's 140 stored sessions (1,915,709,366 tokens, 8,783 calls, 58 sessions
carrying the title DSH gave them).

### Every grouping's rows add up to that grouping's total

This is the property the plan allocation exists to have, checked against the live
ledger rather than a fixture:

```
grouping   rows   sum(rows)   section total   plan allocated
workspace  8      169.784     169.7840        79.6
session    50     169.784     169.7840        79.6
model      4      169.784     169.7840        79.6
vendor     3      169.784     169.7840        79.6
```

The plan is 79.6 (¥199 over the 12 days of September the bill covers) and it is
allocated across the rows in proportion to the usage it covers — the vendor
section carries it in full on the one DeepSeek row, the workspace section spreads
it over the workspaces that used DeepSeek:

```
vendor / month            cost     usageCost   planCost
  deepseek                79.60    96.45       79.60
  qwen                    63.98    63.98       0
  z-ai                    26.20    26.20       0

workspace / month         cost     planCost    usageCost
  E:\bosc_project\DB_ontology   71.47   42.29   80.43
  D:\LLM\knowledge-base         40.85    5.84   42.09
  E:\bosc_project\dsh行内部署    22.64    8.30   24.40
```

### The labels are DSH's own names

A session row is `workspace/title` with the DSH session title, and a model row is
`vendor/model`:

```
dsh行内部署/@2026-09-02-AI工作复盘.md 这是我   · session-61bd1519-… · E:\bosc_project\dsh行内部署
DB_ontology/# 任务书：把样例数据建成 Onto…    · session-d818967e-… · E:\bosc_project\DB_ontology
deepseek/DeepSeek-V4.1-Flash                  cost 79.60
qwen/Qwen3.8 Flash                            cost 59.31
```

### The export

`?by=workspace,session,model,vendor&range=month,year,week,today,all&format=csv`
answered 200, `text/csv`, **36,007 bytes**, `attachment; filename="token-bill-all-2026-09-12.csv"`,
with 325 lines: a header, one row and one total for each of the 20 sections, and
no grand total across the overlapping periods. The single-section export
(`?by=vendor&range=today`) is named for what it holds —
`token-bill-vendor-today-2026-09-12.csv` — and its total matched the JSON
`totals.totalCost` for the same section.

### The overview's estimate

```
GET /api/token-ledger/summary
  cost.priced: true, currency: CNY, rate: 6.725314
  today  cost   6.63   (usage 13.99, plan 6.63)
  week   cost 107.52   (usage 101.96, plan 46.43)
  month  cost 169.78   (usage 186.64, plan 79.60)
  year   cost 197.14   (usage 566.30, plan 79.60)
```

The month's 169.78 is the same number the bill's month section reports, which is
the point of pricing the overview with the bill's own arithmetic rather than a
second estimator. The overview's `today` is priced by the same code path as the
bill's `today` range.

The browser half served by that host was read back too: the 3.87 MB bundle
contains `BillSection`, `BILL_SECTION_ORDER`, `rangeToday`, `billExportAllCsv`,
`billPlanShare` and `estCost`.

## The reported defects, 0.7.0 — read against a real ledger

Four problems were reported against the 0.6.0 page while looking at a real bill. All
four were reproduced first and then fixed; the evidence for each is below.

### The workspace grouping collapsed to `(unknown)`

The live ledger on this machine recorded **1 of 75** sessions with a working
directory, so the workspace section had one `(unknown)` row and one real one. The
cause was not in the bill: DSH's `sessionPersistence` returns the *sequenced* events
plus the session header separately, and the header line — the one carrying `cwd` — is
not in the events array. Reading the events alone found no `cwd`, while a CLI
`rebuild` of the same logs found every one, because the CLI decodes the raw file
where the header *is* the first record.

The storage implementation was read out of the packaged app to confirm the shapes
(`dsh-session-persistence-jsonl`): `list()` parses the header line and returns it as
`header`, and `toHeaderLine`/`fromHeaderLine` show `cwd` on it. The host now passes
that header's `cwd` into the fold, trying `stored.meta`, the list header,
`stored.session` and the object itself, and keeps the event scan as a fallback.

Verified by folding this machine's real logs **through a real DSH host** (an isolated
home holding a copy of the 140 session logs, its own port, its own web server):

```
sessions 140, usage rows 148, tokens 2,011,822,094, calls 9,028
sessions with cwd     140 / 140      (was 1 / 75 on the live ledger)
sessions with title    58 / 140
D:\LLM\knowledge-base 56 · E:\bosc_project\LLM-Wiki知识包模版 17 · E:\bosc_project\torchv-master 14 · …
```

### The model column merged two endpoints into one row

Grouped by the price list's name, `deepseek-official/deepseek-v4-flash` and
`bos/deepseek-v4-flash` both displayed as `deepseek/DeepSeek-V4.1-Flash` — three rows
where there are five. The model dimension now keys on the route the ledger recorded,
and the same real-data run shows one row per endpoint, each still billed at DeepSeek's
list price:

```
model / month
  qwen-plan/qwen3.8-flash               provider qwen-plan          priceVendor qwen      ¥59.31
  deepseek-official/deepseek-v4-flash   provider deepseek-official  priceVendor deepseek  ¥49.69
  bos/deepseek-v4-flash                 provider bos                priceVendor deepseek  ¥49.20
  zai/glm-5.3-flash                     provider zai                priceVendor z-ai      ¥26.20
  qwen-plan/qwen3.8-max                 provider qwen-plan          priceVendor qwen       ¥4.68
```

### The vendor section was grouped by price list, not by provider

The same run, grouped by the provider the request named, with the display name read
from the harness settings file (`settings.yaml` → `llm-pi-ai.providers.bos.displayName`):

```
vendor / month
  qwen-plan          provider qwen-plan          priceVendor qwen      ¥63.98
  deepseek-official  provider deepseek-official  priceVendor deepseek  ¥49.69
  BOS-API            provider bos                priceVendor deepseek  ¥49.20
  zai                provider zai                priceVendor z-ai      ¥26.20
  TOTAL                                                               ¥189.08
```

`BOS-API` is the name the model settings page shows for the `bos` endpoint; it is read
from that file (never written), and the price source is stated beside it. Every
grouping's rows summed exactly to its own total (189.08) in the same run, workspaces
included, and the page's four sections were all served from one host:

```
workspace 8 rows · session 50 rows · model 5 rows · vendor 4 rows, all TOTAL 189.08
GET /api/token-ledger/bill?by=…&range=month,year,week,today,all&format=csv
  -> 200, 36,701 bytes, 333 lines, 20 section totals, attachment "token-bill-all-2026-09-12.csv"
```

### The composition key named a bucket that was never drawn

The 按模型 key printed the raw string `cacheWriteTokens`, untranslated, for a bucket no
bar contained — DeepSeek publishes no cache-write price, so nothing ever wrote cache.
The bucket is now translated, and a bucket with no tokens anywhere in the payload is
left out of the bars and the key. Asserted both ways in the render tests: three keys
when nothing wrote cache, four (with the fourth named and coloured) when the payload
has cache-write tokens.

### The exported CSV was mojibake in Excel, 0.7.1

Reported as `.dsh/缂栧啓缁熻dsh token鐢ㄩ噺鎻掍欢` for a session named
`.dsh/编写统计dsh token用量插件`. The diagnosis is arithmetic rather than opinion: `编写`
in UTF-8 is `e7 bc 96 e5 86 99`, and those six bytes read as GBK are `缂栧啓`, so the
file was always UTF-8 and the reader was guessing. It was guessing because the file
had no byte-order mark.

Before and after, on the bytes rather than the text (the same ledger, the same bill,
written by the same code path):

```
before   first 12 bytes: 64 69 6d 65 6e 73 69 6f 6e 2c 72 61   -> "dimension,ra…"
after    first 12 bytes: ef bb bf 64 69 6d 65 6e 73 69 6f 6e   -> BOM, then the header
```

And through a real host — the export fetched over HTTP from a DSH web server holding
a real ledger, written to disk and inspected as bytes:

```
GET /api/token-ledger/bill?by=session,vendor&range=all&format=csv
  -> 9,183 bytes, first six bytes ef bb bf 64 69 6d, text/csv; charset=utf-8
  a row: session,all,torchv-master/在Docker中部署MySQL和Redis,975,37890752,…
    read as UTF-8: torchv-master/在Docker中部署MySQL和Redis
    read as GBK:   torchv-master/鍦―ocker涓儴缃睲ySQL鍜孯edis
```

The second line is the reported defect, reproduced from the same bytes: the mark is
what tells the reader which of those two readings is the intended one. The CLI's
`export` tables carry the same mark for the same reason, and both writers are tested
on their **bytes**, because `trim()` strips a byte-order mark from a string and a mark
no reader sees fixes nothing.

### What could not be verified locally, and why

The host path was verified against **a copy** of this machine's session logs in a
disposable home, not against the live home: two DSH processes folding one ledger would
race on the same file, and the running instance belongs to its user. A hand-built
synthetic home was tried first and abandoned — the storage asserts that a log's path is
`projectKey(cwd)/encodeSegment(id)/session.jsonl.zstd`, and while that encoding can be
replicated (it was, and the fixture then folded correctly through the CLI), copying
real logs proved both cheaper and stronger. A side finding from that attempt: a boot
that fails to bind its port prints nothing at all, which cost some time; a port that a
previous host still holds looks exactly like a plugin that failed to load.

## The summarised session list, 0.8.0 — measured on a real ledger

The rule (under ¥1 **or** fewer than 10 calls) was chosen by running candidate rules over
this machine's real bill rather than by taste, and then verified through a real host on the
same ledger. Both halves of the question matter: how short the list becomes, and what the
summary row absorbs.

| Range | Sessions | Rows shown | Summarised | Their money | Share of the bill |
| ----- | -------- | ---------- | ---------- | ----------- | ----------------- |
| month | 50 | 30 | 21 | ¥7.67 | 4.3% |
| week | 31 | 20 | 12 | ¥6.76 | 6.3% |
| all | 74 | 36 | 39 | ¥7.75 | 3.8% |
| today | 1 | 1 | — | — | — (one session: the list is not shortened) |

What the candidates would have done to the all-time list, which is why ¥1/10 was chosen:

```
cost < 1 且 calls < 10   → 折叠 14 行（剩 60）  汇总 ¥1.90（0.3%）
cost < 1 或 calls < 10   → 折叠 37 行（剩 37）  汇总 ¥12.83（2.2%）   ← 采用
cost < 5 或 calls < 20   → 折叠 56 行（剩 18）  汇总 ¥60.75（10.6%）  ← 隐藏太多钱
```

The most expensive row the chosen rule hides is **¥0.95** (29 calls), so nothing material
disappears; a looser rule would put ¥60 of an all-time bill behind one line.

The arithmetic was checked in the same run, through the host:

```
GET /api/token-ledger/bill?by=session&range=all&fold=small  -> 36 rows, fold {count: 39, costBelow: 1, callsBelow: 10, currency: CNY}
GET /api/token-ledger/bill?by=session&range=all             -> 74 rows, fold: null
  totals identical (¥203.87), and the folded rows still sum to it (203.87 == 203.87)
  the summary row: 39 sessions, 734 calls, ¥7.75
GET /api/token-ledger/bill?by=session&range=all&format=csv  -> 76 lines: a header, 74 sessions and a total; no `#small`
```

**Not verified:** the appearance of the summarised line (italic label, `汇总` badge, the
note under the table). It is asserted in markup and in the real-React render tests, but no
browser was available to look at it, and the geometry it sits in cannot be measured here
either.

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
- **The rates view and the bill view in a real browser.** All three views are
  asserted under the real React, their markup is checked, and the bundle the
  browser receives was fetched from a running host — but no one has yet looked at
  the **Rates** or **Bill** tab on screen. The 0.3.0 round of feedback came from
  looking at the page; the rates and bill work has not had that pass. The bill's
  CSV download in particular is asserted from the response headers and body, not
  by clicking the button in a browser, and the four stacked sections have not been
  looked at in a panel narrow enough to need their horizontal scroll.
- **What a long session title looks like.** DSH's own titles are sometimes a
  truncated first prompt and sometimes a generated name; the page truncates with an
  ellipsis and keeps the full title in the tooltip, which is a CSS claim rather than
  an observed one.
- **The plan allocation's fairness.** A plan is allocated across rows in proportion
  to the usage cost it covers, which is what makes the rows sum to the total — but
  the ledger does not know a provider's actual plan terms (quotas, per-model
  exclusions), so the allocation is a stated convention, not the provider's own
  accounting.
- **A provider's display name on another machine.** The names are read from
  `settings.yaml` by a scanner that knows one shape (a `providers:` block at any
  depth, entries under it, `displayName` on an entry). A harness version that writes
  its provider list elsewhere falls back to the provider id, which is truthful but
  not the name the settings page shows.
- **The workspace grouping when a session genuinely has no `cwd`.** A session whose
  header carries no working directory is grouped as `(unknown)`; that is the honest
  answer for it, and it is the one row that no fix can attribute.
- **The vendor marks as pixels.** Twelve bundled marks are checked structurally:
  each is diffed against the vendor's original file — same element sequence, same
  path geometry, same transforms, fill-rules, clip paths and classes — so a dropped
  `<g transform>`, a lost CSS class or a missing clip path fails the check, which is
  exactly how three of them were wrong. That is not the same as looking at them.
  This environment has no headless browser to rasterize with (Electron is here, but
  the packaged DSH build will not run an external app, and a script path passed to
  it is ignored), so `docs/logo-preview.html` exists for a human to open instead —
  all twelve at the page's real 18px and enlarged, on a light and a dark band.
- **Price accuracy.** The tables are asserted to carry what the source published,
  spot-checked against one vendor's published numbers. Nothing here verifies that
  a source is correct, current, or the price a given account is actually billed.
- **The bill as an invoice.** The bill multiplies the tokens the session log
  recorded by the list price of the model the route named. It has not been
  reconciled against any provider's actual invoice, so it is an estimate with a
  stated basis — not a claim about what was charged. Plan quotas are taken from
  what the config says, and nothing here checks them against a provider's terms.
- **A plan spanning several months.** The amortization is asserted for a partial
  month and for a plan with a start or end date; a plan billed over a long range
  is the same arithmetic repeated, not a separate path that has been observed.
- **The 30-minute timer over a long run.** The interval is asserted to be
  configured and to fire and stop under test; that it keeps working across a
  multi-hour session, and that the host does not keep a process alive for it, is
  asserted only by the `unref` call rather than by observation.

Two items that earlier drafts of this file listed here have since been closed
with evidence rather than removed quietly: `/tokens` answering in a live
conversation, and backfill parity with the CLI on a real host. Both are recorded
under [Live host mount, after the fixes](#live-host-mount-after-the-fixes-020)
above.
