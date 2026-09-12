# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

## [0.4.0] - 2026-09-10

A second view: what the models cost, and what the dollar is worth. The settings
section now has **概览 / Overview** and **费率 / Rates** tabs at the top.

### Added

- **A rates view.** It shows the live USD/CNY rate in its own box, then each
  vendor's newest models with their published prices per million tokens — input,
  output, cache read and cache write — and it lets any of those numbers be typed
  over by hand.
  - **Prices** are each vendor's **own list price**, from a per-vendor price list
    (models.dev by default), filtered to the newest **two to three models per
    vendor**. Vendors' own model-list APIs return model ids and no prices at all —
    the price only exists on their pricing page — so a per-vendor price list has
    to come from somewhere that reads those pages, and the page says which source
    it is showing. The source is switchable (`rates.source`): `openrouter` reads a
    gateway's quotes instead, which cover more models but are not the vendors'
    numbers. Spot-checking both against the vendors' own pages is what settled the
    default: on Z.ai's advertised prices `models.dev` agreed with the page while
    OpenRouter differed by more than a factor of two on two models, and across the
    27 models both sources describe they agreed on 21 and differed on 6.
  - **The rate** comes from a keyless exchange-rate endpoint and is shown to four
    decimals with its source and age. It is displayed for reference only: **no
    token count is multiplied by any price on this page**, which is why the rate
    sits in its own box with a note saying so.
  - **Freshness travels with the value.** Every served number carries where it
    came from and how long ago it was fetched, because a stale price that looks
    live is worse than no price.
  - **A zero price is flagged, not called free.** Some platforms bill by the hour
    and publish 0 per token (Nvidia's NIM catalogue is the live example); the row
    keeps the number, is marked, and the page explains that 0 may mean "not priced
    per token" rather than "free". Plan and long-context tiers are not shown, so a
    row is the base-tier price.
  - **A vendor's own models come before the ones it resells.** Bedrock lists
    `openai.*`, Nvidia lists `deepseek-ai/*`, Alibaba lists DeepSeek too, and one
    such row was taking Mistral's newest slot away from Mistral. The ordering
    prefers the vendor's own models; nothing is dropped over it.
- **Offline is a supported state, not an error.** The host refreshes every
  30 minutes; a failed refresh keeps the last good result on disk and reports
  the attempt as failed rather than clearing anything, so a firewalled machine
  shows the last known prices with a visible age instead of an empty page. On a
  host that has **never** reached the network, hand-entered prices are published
  as their own group and the page says so.
- **Hand-entered values win and survive.** A price or a rate typed by the user is
  stored beside the ledger, outranks every later fetch, and can be handed back to
  the fetched value ("恢复自动 / Use fetched") or cleared per model. Emptying every
  price in a row is an undo rather than a claim that the model has no price, so it
  removes the override and the fetched prices return; a field left blank on a row
  that is being edited clears that one price. This is the whole offline story: with
  `rates: false` a strictly offline host makes no request at all and the page is a
  price list the user maintains themselves.
- `lib/rates.js` (pure: payloads in, rows out, one parser per source),
  `lib/vendor-prices.js` (one adapter per vendor whose own pricing page can be
  read) and `lib/rates-service.js` (the network, the cache file, the timer, the
  source switch, the vendor-page merge, and the merge of hand-entered values).
- `GET|POST /api/token-ledger/rates`. The write half is restricted: a JSON
  content type is required — a cross-origin form can only send `urlencoded`,
  `multipart` or `text/plain`, so requiring JSON is what keeps another page from
  writing these values — the body is capped at 256 KiB, and the loopback peer
  and origin checks are the same ones the read route uses. The write answers with
  the re-read state, so a save is one round trip and the page never shows a value
  the host rejected.

### Changed, after looking at the page

Four things only a person reading the rendered table could have asked for:

- **Prices are shown in yuan.** The table is quoted in CNY and converted with the
  rate in the box above it. The rate remains display only, so the page still
  computes no cost; each converted cell keeps the dollar quote it came from in its
  tooltip, so a number on screen stays traceable to what the vendor published. With
  no rate fetched there is nothing to convert with, so the table falls back to USD,
  says so in a note, and labels its column in dollars rather than printing a
  number it cannot stand behind.
- **The model-name column no longer collapses.** With four fixed price columns and
  a 150px action column, a narrow panel left the name column zero pixels wide, so
  the table showed a price list for models nobody could identify. The name column
  now has a floor, the action buttons are compact, and the table scrolls sideways
  instead of squeezing: a panel narrower than the table scrolls, it does not lie.
- **Each vendor carries a brand mark.** Two letters in the vendor's own colour,
  drawn by the page. A real logo is an asset that has to be shipped (and licensed)
  or fetched at page load, and fetching one would put a network dependency in a
  page whose whole point is that it works offline. A vendor nobody curated still
  gets a mark, coloured from a hash of its name so it stays the same across
  refreshes, because one blank leading cell makes the column look broken.
- **Fifteen vendors, not fifty-nine.** The list is capped to the most familiar
  vendors in a curated order rather than by model count — sorting by count alone
  puts `qwen` above `anthropic` and drifts whenever a publisher ships a batch. The
  ids were read off the live list rather than guessed. Publisher aliases
  (`~openai/model-latest`) are excluded outright; counting them would list a vendor
  twice under a name nobody recognises. The status line reads `showing 15 / 49`
  rather than `15`, because a bare count reads as "the list has 15 vendors", which
  is not what happened. `rates.vendors: 0` publishes all of them; at the default
  the payload drops from 30 KB to 11 KB.

### Changed, once the prices were checked against the vendors

- **One precision per column.** A price list is read down a column, so a column that
  read `0.04 / 0.02 / 0.3 / 0.15` was showing four measurements where there is one
  scale. The column now decides its own width and every cell pads to it: DeepSeek's
  cache reads read `¥0.04 / ¥0.02 / ¥0.30 / ¥0.15` and its inputs
  `¥2.0 / ¥1.0 / ¥9.0 / ¥4.5`. Trailing zeros are kept rather than trimmed, for
  exactly this reason. Two rules feed it: a price the vendor published in the display
  currency is shown as published, and a converted price is shown in cents — except
  that a column containing a price cents would erase takes the decimals that price
  needs to keep two significant digits, so `¥0.0014` does not become `¥0.00`. A
  tooltip is one number rather than a column and keeps the vendor's own precision.
- **Prices are read from the vendors' own pricing pages where that is possible.**
  Three of them are: DeepSeek, Z.ai and Tencent. Each vendor group now says which
  it is — a `官方 / vendor` badge means those numbers were read from that vendor's
  page, and no badge means the per-vendor dataset. That distinction is the point:
  an earlier draft showed a dataset's numbers as if they were the vendors', and
  they are not always the same number.
- **DeepSeek is split into peak and off-peak.** Their page prices two models in
  yuan across three lines — cache-hit input, cache-miss input, output — with a peak
  and an off-peak column, off-peak being half of peak outside 09:00–12:00 and
  14:00–18:00 Beijing time on weekdays. So DeepSeek gets a row per period,
  labelled, because those are two prices for one model and hiding one behind a
  toggle would make the table wrong for whoever is reading it at the wrong hour.
  The window appears in the vendor's own words, not paraphrased.
  This is also what the dataset had wrong: it recorded the **off-peak** price as
  if it were the price, so a peak-hour read was understated by half.
- **A vendor that publishes in yuan is shown in yuan.** DeepSeek and Tencent quote
  CNY per million tokens; those numbers are passed through as published rather than
  converted, and the price editor follows the row's currency, so typing into a yuan
  row means yuan. Dataset prices are USD and are converted with the rate in the box
  above, as before.
- **The vendor list is twelve names, not twenty-one**: OpenAI, Anthropic, Google,
  DeepSeek, Qwen, xAI, Z.ai, Kimi, MiniMax, Tencent, Xiaomi and ByteDance — each
  written the way the vendor writes it rather than as its source key. Tencent has
  no entry in the per-vendor dataset at all, so its own pricing page is the only
  reason it can be shown.
- **Real vendor marks instead of monograms.** Twelve official marks are drawn
  inline: the geometry came from the vendors' own sites where they publish an SVG
  (OpenAI, Z.ai, Tencent) and otherwise from Simple Icons, which carries the
  official marks as plain files. Nothing was drawn by hand and nothing is fetched
  at page load, and each mark sits on a small white tile because several of them
  are black and the panel may be dark. They are the trademarks of their owners,
  used to identify whose price is being shown. A vendor with no bundled mark still
  gets its letters.

### Fixed

- **Three vendor marks rendered wrong, and the cause was this package's own
  extraction.** The client kept each mark's `<path d>` plus a colour, which silently
  discarded everything else a mark can need. Tencent's sits inside a flipped
  `<g transform="translate(0,848) scale(0.1,-0.1)">`, so it came out mirrored and
  displaced; Z.ai's file paints every path through a CSS class (`.st0` … `.st194`)
  and a gradient, so three meaninglessly painted fragments appeared instead of the
  logo; OpenAI's mark is a `<path>` inside a `<clipPath>` over a background
  `<rect>`, so the whole thing was dropped. On top of that, Tencent's file is a
  Safari *mask* icon — a white shape on transparent, meant to be recoloured by the
  consumer — and white on a white tile is invisible, which is exactly how it looked.
  Each mark is now bundled as the vendor's own sanitized SVG document and injected
  whole, so whatever a file needs to draw itself survives. The sanitizer does four
  things and nothing else: it strips the root's fixed size, resolves OpenAI's
  `:root` variable swap into concrete colours (a plugin has no business setting CSS
  variables on the host page), prefixes ids so two inline SVGs cannot collide, and
  drops scripts and `on*` attributes. Every bundled mark is then diffed against the
  vendor's original file — same elements in the same order, same path geometry,
  same transforms, fill-rules and classes — so only those four changes can differ.
  `docs/logo-preview.html` shows all twelve at the page's real 18px and enlarged,
  on a light and a dark band.

### Notes

- Prices are stored as **USD per one million tokens** unless the vendor publishes
  in another currency, in which case the vendor's own number and currency are kept
  as published — converting a vendor's yuan price into dollars only to convert it
  back for display would add error for nothing. A USD price is converted for
  display at the last moment, from the same rate the table showed, including in the
  price editor, so typing into a table that reads ¥ does not mean typing dollars.
  Converting back rounds to the six decimals the host keeps, so a value that leaves
  and returns unchanged comes back identical.
- **A model the source gives no price for is not published.** The live list marks
  a router that has no single price with the sentinel `prompt: "-1"`,
  `completion: "-1"` — five entries when this was written. A negative price is not
  a price, is not free, and must not be shown as `$0`; those rows are dropped, and
  the comment in `parseCatalogue` says why. Dropping them also matters for the
  table's shape: a row of four dashes would take one of a vendor's few slots from
  a model that has a real price. A price of `0` is kept, because free is a price.
- The ledger format is unchanged, so a 0.3.0 ledger is still read. Prices live in
  `<DSH_HOME>/token-ledger/rates.json`, beside the ledger, so one backup covers
  both.
- The rates view is a **reference table, not a bill**. Cost computation needs the
  per-model token counts and the price of the route actually used, and both are
  approximate in ways that would make a number wrong in a plausible-looking way.
- Hand-entered prices are entered on the settings page, so a profile without a web
  server can read the usage ledger but has no way to type a price yet. A CLI
  equivalent is the obvious next addition.

## [0.3.0] - 2026-09-10

Presentation changes, all of them from looking at the page in a real host.

### Changed

- **The year heatmap is now weekday-aligned and month-labelled.** The series was
  drawn seven cells per column from whatever weekday it happened to start on, so
  the rows were weekdays that lied and there was nothing to read the columns
  against. The first column is now padded to the real weekday of its first day,
  and a month axis above the grid lines up with it — the two share the same
  column width and gap rather than being measured into agreement.
- **The heat ramp goes deeper and has more steps.** Seven levels instead of five,
  ending in a near-navy rather than saturating at a mid blue, so the busiest days
  stand out instead of all reading as "dark".
- **The month view is a bar chart, not a calendar grid**, with thin bars and
  labels thinned to every fifth day. Bar widths are fixed per view (9px for a
  month, 26px for a week) because a proportional column made seven bars and
  thirty bars look like different charts; the week's bars no longer stretch to
  fill the pane.
- **The per-model bar shows the composition of the usage.** A single-width fill
  could not distinguish a model that is mostly cache reads from one that is
  mostly fresh input, so it is now a stacked bar over the four provider buckets,
  with a colour key. This is why the overview payload gained fields: the split
  has to travel, because a total cannot be decomposed in the browser.

### Notes

- Tool calls are **not** a bucket. Provider usage reports uncached input, output,
  cache read and cache write; tool results arrive as input on the following
  request, so a "tool tokens" share cannot be measured without inventing one.
- The ledger format is unchanged, so a 0.2.0 file is still read.

## [0.2.0] - 2026-09-10

### Added

- **A settings page.** The browser half registers a `settings.section`, so the
  ledger appears in the settings sidebar beside every other section. It shows:
  - range totals for **this month**, **this year** and the **last 7 days**, each
    with total tokens, cache hit rate and call count, plus the bucket breakdown;
  - **today**, live, which moves as steps complete;
  - a **usage calendar** switchable between year, month and week, where the week
    view is a bar chart rather than a heatmap;
  - the per-model breakdown with its own cache hit rates.
- `lib/overview.js`, a pure function from a ledger snapshot to the payload the
  page renders, and `lib/route.js`, the read-only
  `GET /api/token-ledger/summary` route that serves it.
- The browser half is hand-written against the client's module loader and
  requires nothing but `react`, so the package still installs with no build step.

### Changed

- The overview is served over an HTTP route rather than a settings namespace.
  A namespace would need a schema — a real dependency — and would rewrite
  `settings.yaml` on every debounce with data that is derived and reproducible.
  The ledger file remains the only store of record.

## [0.1.1] - 2026-09-10

Both fixes come from mounting the plugin in a real DSH host, which is the only
place either defect was observable. Neither was reachable from the test suite,
so both now have regression tests.

### Fixed

- **`/tokens` never registered.** The command definition passed `input` as a
  bare string, and the command registry requires an object carrying a non-empty
  `hint`. The resulting `TypeError` was thrown during mount, which also aborted
  the rest of `apply()` — so the flush-on-dispose effect was never installed
  either.
- **Backfill under-counted forked sessions.** The inherited boundary was applied
  as a raw index, but a stored session can arrive in the compact row form where
  several logical events share one record and the declared count overshoots the
  array length by an order of magnitude. Applying it skipped those sessions
  entirely, which under-counted a real 139-session home by hundreds of millions
  of tokens. The boundary is now located by the `session/end-seed` marker, which
  is present and equivalent in both coordinate spaces, with the declared count
  as a fallback that is refused when it cannot index the array it came with. A
  fork with no usable boundary is folded whole and warned about, so the error
  direction is over-counting rather than silent loss.

### Changed

- The on-disk ledger format is now version 2. A ledger written by 0.1.0 is
  ignored on start rather than trusted, because its cursors would otherwise
  mark every session as consumed and preserve the mis-counted totals forever.
  The ledger rebuilds itself from the session logs, so the only effect is that
  the first start after upgrading does the backfill again.

## [0.1.0] - 2026-09-10

### Added

- Host plugin `token-ledger` that folds the durable session event stream into
  per-session, per-day and per-model token totals.
- Four disjoint buckets (uncached input, output, cache read, cache write) with
  `totalTokens` derived from them, plus reasoning tokens reported separately as
  a subset of output.
- Fork-aware folding: an inherited prefix is cut only when the session has a
  parent, so a fork is not double counted and a resume is not under counted.
- Backfill of every stored session on startup, so a fresh install shows real
  history rather than starting from zero.
- Restart-safe cursors: the ledger is written atomically to
  `<DSH_HOME>/token-ledger/ledger.json` and resumes instead of recounting.
- `/tokens [summary|export|json|path]` conversation command.
- `dsh-token-ledger` CLI with `summary`, `audit`, `rebuild` and `export`
  commands, `--json` output, and an audit that distinguishes a ledger merely
  behind a live session from a genuinely wrong ledger.
- CSV export for the daily, session and model tables.
- Zero runtime dependencies, zero peer dependencies and no install scripts, so
  the package installs without a build step.

[Unreleased]: https://github.com/chenmiao8563/dsh-token-ledger/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/chenmiao8563/dsh-token-ledger/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/chenmiao8563/dsh-token-ledger/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/chenmiao8563/dsh-token-ledger/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/chenmiao8563/dsh-token-ledger/releases/tag/v0.1.0
