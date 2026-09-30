# Screenshots

The plugin market shows these beside the listing. They are declared in
[`screenshots.json`](../../screenshots.json) at the repository root, which
`awesome-dsh-plugin`'s nightly build reads straight out of the repository — no pull
request, no npm release: push an image here, list it in that file, and the next build
picks it up.

## What is here

| File | Shows |
| --- | --- |
| `01-overview.jpg` | Overview: this month's totals, today, and a year of activity |
| `02-calendar.jpg` | The calendar — busiest, lightest and latest day — and usage by model |
| `03-weekly.jpg` | The last seven days as bars, with the same by-model breakdown |
| `04-rates.jpg` | Rates: the live USD/CNY rate and each vendor's published price list |

Two gaps worth closing the next time someone has the GUI open: the **bill** tab — the
grouping by workspace, session, model and vendor, and the export — and `/tokens` in a
conversation, which is the path that needs no browser at all. `02-calendar.jpg` and
`03-weekly.jpg` also overlap: both end on the same by-model chart, and only the heatmap's
period differs, so one of the two is a candidate to swap for a bill shot.

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
