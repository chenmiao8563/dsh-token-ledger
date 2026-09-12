/**
 * Prices read from the vendors' own pages.
 *
 * ## Why this file exists
 *
 * No vendor exposes prices through an API. Their model-list endpoints return ids
 * with no money in them — DeepSeek's `/models` answers 401 without a key,
 * Anthropic's `/v1/models` answers 403 — and the price exists only on a pricing
 * page. So "the vendor's own price" and "the vendor's own pricing page" are the
 * same thing, and reading it means parsing HTML.
 *
 * A per-vendor dataset sits behind this as a fallback, because most of these
 * pages cannot be read without a browser: an adapter here is added only when the
 * page's own markup can be parsed and the result checked against what the page
 * displays. Everything an adapter returns is marked as vendor-sourced, and the
 * page shows which vendors are live and which are on the dataset.
 *
 * ## What the adapters promise
 *
 * Each returns rows shaped like the catalogue's, in the vendor's own currency,
 * and nothing else: no conversion, no invention. A number that cannot be read
 * becomes no row, so a parse that stops working shows up as a vendor falling back
 * to the dataset rather than as a price quietly going wrong.
 *
 * @module dsh-token-ledger/vendor-prices
 */

/** A model row from a vendor page, before it is merged into the catalogue. */
const EMPTY = { input: null, output: null, cacheRead: null, cacheWrite: null }

/**
 * Strip a page down to its text, with cells separated so tables stay parseable.
 *
 * @param {string} html - the page source.
 * @returns {string} the text.
 */
export function textOf(html) {
  return String(html ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
}

/**
 * Extract every HTML table as rows of cell text.
 *
 * Vendor pricing pages are tables in practice, and reading the table structure
 * beats matching prose: it keeps a model name and its numbers in one row.
 *
 * @param {string} html - the page source.
 * @returns {string[][][]} one array of rows per table, each row an array of cells.
 */
export function tablesOf(html) {
  const tables = []
  for (const table of String(html ?? '').matchAll(/<table[\s\S]*?<\/table>/gi)) {
    const rows = []
    for (const row of table[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)) {
      const cells = [...row[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((cell) =>
        cell[1]
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/\s+/g, ' ')
          .trim(),
      )
      if (cells.length > 0) rows.push(cells)
    }
    if (rows.length > 0) tables.push(rows)
  }
  return tables
}

/**
 * Read the first number out of a cell, and which currency it is in.
 *
 * Handles both orders a page may write: `$0.15`, `0.15元`, `输入：0.5元`.
 *
 * @param {string} cell - the cell text.
 * @returns {{ value: number, currency: string }|null} the price, or null when there is none.
 */
export function priceIn(cell) {
  const text = String(cell ?? '')
  const match = /([$¥￥]|USD|CNY)?\s?(\d+(?:\.\d+)?)\s?(元|美元|USD|CNY)?/.exec(text)
  if (match === null) return null
  const value = Number(match[2])
  if (!Number.isFinite(value)) return null
  const token = `${match[1] ?? ''}${match[3] ?? ''}`
  const currency = /[$]|USD|美元/.test(token) ? 'USD' : /[¥￥]|元|CNY/.test(token) ? 'CNY' : ''
  return { value, currency }
}

/** Which currency a page is written in, from the first priced cell found. */
function currencyOf(rows) {
  for (const row of rows) {
    for (const cell of row) {
      const price = priceIn(cell)
      if (price !== null && price.currency !== '') return price.currency
    }
  }
  return ''
}

/**
 * DeepSeek's pricing page: `api-docs.deepseek.com/zh-cn/quick_start/pricing/`.
 *
 * The page prices two models in yuan per million tokens across three lines —
 * cache-hit input, cache-miss input, output — and every line has a peak and an
 * off-peak column. The prose below the table states the rule and the window:
 * off-peak is half of peak, and peak is 09:00–12:00 and 14:00–18:00 Beijing time
 * on weekdays, everything else being off-peak.
 *
 * @param {string} html - the page source.
 * @returns {{ models: object[], note: string }} rows in CNY, and the page's own window text.
 */
export function parseDeepSeek(html) {
  const tables = tablesOf(html)
  const models = []
  let note = ''

  const prose = textOf(html)
  // The window is stated in one sentence, and it is the vendor's sentence.
  const window = /高峰时段为([^（(]{4,80})[（(]([^）)]{2,60})[）)]/.exec(prose)
  if (window !== null) note = `${window[1].trim()}（${window[2].trim()}）`

  for (const table of tables) {
    // Column heads are model ids: `deepseek-flash (1)`, `deepseek-v4-pro (2)`.
    const head = table.find((row) => /^deepseek[\w.-]*/.test(row[0] ?? '') || row.filter((cell) => /^deepseek[\w.-]*/.test(cell)).length >= 2)
    if (head === undefined) continue
    const columns = head.filter((cell) => /^deepseek[\w.-]*/.test(cell)).map((cell) => /^(deepseek[\w.-]*)/.exec(cell)[1])
    if (columns.length === 0) continue

    // A nicer name than the id, when the table lists the model's version.
    const versionRow = table.find((row) => /模型版本/.test(row[0] ?? ''))
    const names = columns.map((id, index) => {
      const cell = versionRow?.[index + 1]
      return typeof cell === 'string' && cell !== '' ? cell : id
    })

    const collected = new Map(columns.map((id) => [id, { peak: { ...EMPTY }, offPeak: { ...EMPTY } }]))
    let line = null
    for (const row of table) {
      if (row.length < columns.length + 1) continue
      // The price cells are the columns under the model headers, so the values
      // are the last cells of the row and everything before them is a label —
      // which matters because the vendor's table merges the label cells, so the
      // first row of a group carries two labels and the rest carry one.
      const values = row.slice(-columns.length)
      const labels = row.slice(0, -columns.length).join(' ')
      const found = /缓存命中/.test(labels) ? 'cacheRead' : /缓存未命中/.test(labels) ? 'input' : /输出/.test(labels) ? 'output' : null
      if (found !== null) line = found
      const period = /空闲时段|优惠时段/.test(labels) ? 'offPeak' : /高峰时段|标准时段/.test(labels) ? 'peak' : null
      if (period === null || line === null) continue
      for (const [index, id] of columns.entries()) {
        const price = priceIn(values[index])
        if (price === null) continue
        collected.get(id)[period][line] = price.value
      }
    }

    for (const [id, periods] of collected) {
      const hasPrice = (periods.peak.input !== null || periods.peak.output !== null) && (periods.offPeak.input !== null || periods.offPeak.output !== null)
      if (!hasPrice) continue
      models.push({ id, name: names[columns.indexOf(id)] ?? id, periods })
    }
    if (models.length > 0) break
  }

  return { models, note, currency: 'CNY' }
}

/**
 * Z.ai's pricing page: `docs.z.ai/guides/overview/pricing`, priced in dollars.
 *
 * The table is `Model | Input | Cached Input | Cached Input Storage | Output`, all
 * per million tokens. The storage column is a cache-write cost and is sometimes
 * the words "Limited-time Free" rather than a number, which becomes no price
 * rather than a zero.
 *
 * @param {string} html - the page source.
 * @returns {{ models: object[], note: string }} rows in USD.
 */
export function parseZai(html) {
  const models = []
  for (const table of tablesOf(html)) {
    const head = table.find((row) => /model/i.test(row[0] ?? '') && row.length >= 4)
    if (head === undefined) continue
    for (const row of table) {
      const id = String(row[0] ?? '').trim()
      if (id === '' || /^(model|模型)$/i.test(id)) continue
      const input = priceIn(row[1])
      const cacheRead = priceIn(row[2])
      const cacheWrite = priceIn(row[3])
      const output = priceIn(row[4])
      const prices = {
        input: input?.value ?? null,
        output: output?.value ?? null,
        cacheRead: cacheRead?.value ?? null,
        cacheWrite: cacheWrite?.value ?? null,
      }
      if (prices.input === null && prices.output === null) continue
      models.push({ id, prices })
    }
  }
  const currency = currencyOf(tablesOf(html)) || 'USD'
  return { models, note: `价格单位 ${currency}`, currency }
}

/**
 * Tencent's Hunyuan pricing page: `cloud.tencent.com/document/product/1729/97731`.
 *
 * One table with a 「产品名 / 刊例价（每 百万 tokens）」 header and rows such as
 * `Hunyuan-a13b | 输入：0.5元 输出：2元` — both numbers in one cell, so they are
 * read by label rather than by column.
 *
 * @param {string} html - the page source.
 * @returns {{ models: object[], note: string }} rows in CNY.
 */
export function parseTencent(html) {
  const models = []
  for (const table of tablesOf(html)) {
    if (!table.some((row) => row.some((cell) => /每\s*百万\s*tokens/i.test(cell)))) continue
    for (const row of table) {
      const id = String(row[0] ?? '').trim()
      if (id === '' || /产品名|模型|计费/.test(id)) continue
      const rest = row.slice(1).join(' ')
      const input = /输入[：:]\s*([\d.]+)\s*元/.exec(rest)
      const output = /输出[：:]\s*([\d.]+)\s*元/.exec(rest)
      if (input === null && output === null) continue
      models.push({
        id,
        prices: {
          input: input === null ? null : Number(input[1]),
          output: output === null ? null : Number(output[1]),
          cacheRead: null,
          cacheWrite: null,
        },
      })
    }
    if (models.length > 0) break
  }
  return { models, note: '刊例价，单位元 / 百万 Token', currency: 'CNY' }
}

/**
 * The vendors whose own page can be read, and how.
 *
 * Only the vendors listed here are fetched directly; every other vendor's rows
 * come from the per-vendor dataset, and the page says which is which. The `note`
 * each adapter returns is the page's own wording where it has any, because the
 * window DeepSeek charges by is not something to paraphrase.
 */
export const VENDOR_PRICE_SOURCES = {
  deepseek: {
    url: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',
    currency: 'CNY',
    periodic: true,
    parse: parseDeepSeek,
  },
  'z-ai': {
    url: 'https://docs.z.ai/guides/overview/pricing',
    currency: 'USD',
    parse: parseZai,
  },
  tencent: {
    url: 'https://cloud.tencent.com/document/product/1729/97731',
    currency: 'CNY',
    parse: parseTencent,
  },
}

/**
 * Turn an adapter's models into catalogue rows.
 *
 * @param {string} vendor - the vendor id.
 * @param {{ models: object[], note?: string, currency?: string }} parsed - the adapter's result.
 * @param {{ perVendor?: number }} [options] - how many models to publish.
 * @returns {object[]} catalogue rows, newest-listed first, one per period where the vendor charges by time.
 */
export function vendorRows(vendor, parsed, { perVendor = 3 } = {}) {
  const rows = []
  for (const model of (parsed?.models ?? []).slice(0, perVendor)) {
    const id = `${vendor}/${model.id}`
    const name = typeof model.name === 'string' && model.name !== '' ? model.name : model.id
    if (model.periods === undefined) {
      rows.push({ id, name, vendor, created: null, contextLength: null, prices: model.prices, source: 'vendor' })
      continue
    }
    // A time-of-day price is two prices for one model, so it is two rows: hiding
    // half of it behind a toggle would make the table wrong for whoever is
    // reading it at the wrong hour.
    for (const [period, label] of [
      ['peak', 'peak'],
      ['offPeak', 'offPeak'],
    ]) {
      const prices = model.periods[period]
      if (prices === undefined || (prices.input === null && prices.output === null)) continue
      rows.push({
        id: `${id}@${period}`,
        name,
        vendor,
        created: null,
        contextLength: null,
        prices,
        period,
        periodLabel: label,
        source: 'vendor',
      })
    }
  }
  return rows
}
