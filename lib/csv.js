/**
 * The one thing a CSV file needs that its own bytes cannot say.
 *
 * ## Why a byte-order mark
 *
 * A UTF-8 CSV with no mark is still a perfectly good UTF-8 file — and Excel does not
 * read it as one. Excel opens a `.csv` in the system code page unless the first bytes
 * say otherwise, so on a Chinese Windows a session row named `编写统计` arrives as
 * `缂栧啓缁熻`: the bytes are right, the reader guessed. Three bytes at the front are
 * the whole difference, and every spreadsheet and every modern CSV parser strips
 * them.
 *
 * The JSON this package also writes deliberately has none: a JSON parser rejects a
 * leading mark outright, and nothing opens JSON in Excel expecting a spreadsheet.
 *
 * Both CSV writers in this package — the bill's export and the CLI's `export` tables
 * — start with it, and each has a test asserting the bytes rather than the string,
 * because a mark that only exists in a trimmed string is a mark no reader ever sees.
 *
 * @module dsh-token-ledger/csv
 */

/** The byte-order mark every CSV export starts with. */
export const CSV_BOM = '\ufeff'
