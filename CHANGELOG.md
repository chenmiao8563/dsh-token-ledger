# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

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

[Unreleased]: https://github.com/chenmiao8563/dsh-token-ledger/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/chenmiao8563/dsh-token-ledger/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/chenmiao8563/dsh-token-ledger/releases/tag/v0.1.0
