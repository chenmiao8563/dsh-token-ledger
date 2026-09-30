# Screenshots

The plugin market shows these beside the listing. They are declared in
[`screenshots.json`](../../screenshots.json) at the repository root, which
`awesome-dsh-plugin`'s nightly build reads straight out of the repository — no pull
request, no npm release: push the images here and the next build picks them up.

## What to capture

Three shots cover what the plugin does; the market shows at most six, so four is plenty.

| File | What it shows | Why it earns a slot |
| --- | --- | --- |
| `01-overview.png` | Settings → Token ledger, the overview tab | The page the plugin exists to draw: range totals, today, the calendar |
| `02-bill.png` | The bill tab, grouped by workspace or session | The feature nothing else here has: usage turned into money |
| `03-rates.png` | The rates tab, prices and the USD rate | Where the numbers come from, and that they are editable offline |
| `04-tokens.png` | `/tokens` in a conversation, its reply | The path that needs no browser at all |

## Rules the market enforces

- **1 to 8 images declared**; the client renders at most **6**.
- **PNG or JPEG.** SVG is rejected outright — that gate exists to keep logos and badges
  out of a screenshot strip.
- **Relative paths, staying inside this directory** — no leading `/`, no `..`.
- If a path is declared and the file is absent, the breakage is visible in this
  repository, which is the point of declaring here rather than somewhere else.

Absolute `https://` URLs are also accepted, but only from GitHub hosting
(`raw.githubusercontent.com`, `user-images.githubusercontent.com`,
`camo.githubusercontent.com`, `github.com` attachments). Third-party image hosts are
rejected: a screenshot URL is a request that carries the reader's IP.

Without a `screenshots.json`, the market falls back to extracting images from
[`README.md`](../../README.md) — declaring them here is how the order and the selection
become a choice rather than a guess.
