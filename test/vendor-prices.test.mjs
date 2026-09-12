/**
 * Vendor pricing-page tests.
 *
 * These parsers read HTML that the vendor can change without telling anyone, so
 * they are pinned against the shape each page actually has — including the two
 * things that broke the first attempt: DeepSeek merges its label cells, so the
 * price columns are not at fixed indices, and it writes its numbers in yuan with
 * `元` *after* the number, while Tencent writes them inside a label
 * (`输入：0.5元`).
 *
 * @module dsh-token-ledger/test/vendor-prices.test
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { VENDOR_PRICE_SOURCES, parseDeepSeek, parseTencent, parseZai, priceIn, tablesOf, textOf, vendorRows } from '../lib/vendor-prices.js'

/** DeepSeek's table, with the merged label cells exactly as the page has them. */
const DEEPSEEK = `
<html><body>
<table>
  <tr><th>模型</th><th>deepseek-flash (1)</th><th>deepseek-v4-pro (2)</th></tr>
  <tr><td>BASE URL (OpenAI 格式)</td><td colspan="2">https://api.deepseek.com</td></tr>
  <tr><td>模型版本</td><td>DeepSeek-V4.1-Flash</td><td>DeepSeek-V4-Pro-0813</td></tr>
  <tr><td rowspan="2">价格 (3)</td><td>百万tokens输入 （缓存命中）</td><td>空闲时段</td><td>0.02元</td><td>0.15元</td></tr>
  <tr><td>高峰时段</td><td>0.04元</td><td>0.30元</td></tr>
  <tr><td rowspan="2"></td><td>百万tokens输入 （缓存未命中）</td><td>空闲时段</td><td>1元</td><td>4.5元</td></tr>
  <tr><td>高峰时段</td><td>2元</td><td>9.0元</td></tr>
  <tr><td rowspan="2"></td><td>百万tokens输出</td><td>空闲时段</td><td>4元</td><td>13.5元</td></tr>
  <tr><td>高峰时段</td><td>8元</td><td>27.0元</td></tr>
  <tr><td>并发限制 (4)</td><td>2500</td><td>500</td></tr>
</table>
<p>(1) 感谢您的理解与支持！(3) 空闲时段价格为高峰时段价格的一半</p>
<p>高峰时段为北京时间周一至周五 9:00 - 12:00、14:00 - 18:00（其余为空闲时段）</p>
</body></html>`

test('priceIn reads a number whichever side of it the currency sits on', () => {
  assert.deepEqual(priceIn('$0.15'), { value: 0.15, currency: 'USD' })
  assert.deepEqual(priceIn('0.30元'), { value: 0.3, currency: 'CNY' })
  assert.deepEqual(priceIn('输入：0.5元 输出：2元'), { value: 0.5, currency: 'CNY' })
  assert.deepEqual(priceIn('¥1,234'), { value: 1, currency: 'CNY' }, 'a thousands separator is not a decimal point')
  // Words where a number should be are not a price, and not a zero.
  assert.equal(priceIn('Limited-time Free'), null)
  assert.equal(priceIn('—'), null)
  assert.equal(priceIn(''), null)
})

test('the HTML helpers keep table cells apart', () => {
  const tables = tablesOf('<table><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></table>')
  assert.deepEqual(tables, [[['a', 'b'], ['c']]])
  assert.equal(textOf('<p>a &amp; b</p><script>var x = 1</script>').trim(), 'a & b')
})

test('DeepSeek’s page is read with both time-of-day prices', () => {
  const parsed = parseDeepSeek(DEEPSEEK)
  assert.equal(parsed.currency, 'CNY', 'the page quotes yuan')
  assert.equal(parsed.models.length, 2)

  const flash = parsed.models.find((model) => model.id === 'deepseek-flash')
  assert.equal(flash.name, 'DeepSeek-V4.1-Flash', 'the version row gives a better name than the id')
  // Read straight off the page: cache-hit input, cache-miss input, output.
  assert.deepEqual(flash.periods.peak, { input: 2, output: 8, cacheRead: 0.04, cacheWrite: null })
  assert.deepEqual(flash.periods.offPeak, { input: 1, output: 4, cacheRead: 0.02, cacheWrite: null })

  const pro = parsed.models.find((model) => model.id === 'deepseek-v4-pro')
  assert.deepEqual(pro.periods.peak, { input: 9, output: 27, cacheRead: 0.3, cacheWrite: null })
  assert.deepEqual(pro.periods.offPeak, { input: 4.5, output: 13.5, cacheRead: 0.15, cacheWrite: null })
  // The window is the vendor's own sentence, not a paraphrase.
  assert.match(parsed.note, /北京时间周一至周五 9:00 - 12:00、14:00 - 18:00/)
  assert.match(parsed.note, /其余为空闲时段/)
})

test('DeepSeek’s peak numbers are not mistaken for the off-peak ones', () => {
  const parsed = parseDeepSeek(DEEPSEEK)
  const flash = parsed.models.find((model) => model.id === 'deepseek-flash')
  // The off-peak price is half the peak one, which is the whole point of splitting
  // them: a merged row would silently report whichever came last.
  assert.equal(flash.periods.peak.input, flash.periods.offPeak.input * 2)
  assert.equal(flash.periods.peak.output, flash.periods.offPeak.output * 2)
  assert.equal(flash.periods.peak.cacheRead, flash.periods.offPeak.cacheRead * 2)
})

test('Z.ai’s table is read, and a word where a price belongs becomes no price', () => {
  const html = `
  <table>
    <tr><th>Model</th><th>Input</th><th>Cached Input</th><th>Cached Input Storage</th><th>Output</th></tr>
    <tr><td>GLM-5.3-Flash</td><td>$0.15</td><td>$0.03</td><td>Limited-time Free</td><td>$0.50</td></tr>
    <tr><td>GLM-5.3</td><td>$1.4</td><td>$0.26</td><td>Limited-time Free</td><td>$4.4</td></tr>
    <tr><td>GLM-4.5-flash</td><td>Free</td><td>Free</td><td>Free</td><td>Free</td></tr>
  </table>`
  const parsed = parseZai(html)
  assert.equal(parsed.currency, 'USD')
  assert.deepEqual(parsed.models.find((model) => model.id === 'GLM-5.3-Flash').prices, {
    input: 0.15,
    output: 0.5,
    cacheRead: 0.03,
    cacheWrite: null,
  })
  assert.equal(parsed.models.some((model) => model.id === 'GLM-4.5-flash'), false, 'a row of words is not a price row')
})

test('Tencent’s table is read from its labels, in yuan', () => {
  const html = `
  <table>
    <tr><td>产品名</td><td>刊例价（每 百万 tokens）</td></tr>
    <tr><td>Hunyuan-a13b</td><td>输入：0.5元 输出：2元</td></tr>
    <tr><td>Hunyuan-role-latest</td><td>输入：2.4元 输出：9.6元</td></tr>
    <tr><td>Tencent HY Vision 1.5 Instruct</td><td>输入：3元 输出：9元</td></tr>
    <tr><td>Hunyuan-something-else</td><td>限时免费</td></tr>
  </table>`
  const parsed = parseTencent(html)
  assert.equal(parsed.currency, 'CNY')
  assert.equal(parsed.models.length, 3, 'the免费 row has no number to read')
  assert.deepEqual(parsed.models[0], { id: 'Hunyuan-a13b', prices: { input: 0.5, output: 2, cacheRead: null, cacheWrite: null } })
  assert.match(parsed.note, /元 \/ 百万 Token/)
})

test('a vendor row per period, so one model can carry two prices', () => {
  const rows = vendorRows('deepseek', parseDeepSeek(DEEPSEEK), { perVendor: 3 })
  assert.equal(rows.length, 4, 'two models, two periods each')
  assert.deepEqual(
    rows.map((row) => row.id),
    ['deepseek/deepseek-flash@peak', 'deepseek/deepseek-flash@offPeak', 'deepseek/deepseek-v4-pro@peak', 'deepseek/deepseek-v4-pro@offPeak'],
    'the period is part of the id, so an override lands on the price it was typed against',
  )
  assert.equal(rows[0].period, 'peak')
  assert.equal(rows[1].period, 'offPeak')
  assert.equal(rows[0].name, 'DeepSeek-V4.1-Flash')
  assert.equal(rows[0].vendor, 'deepseek')
  assert.equal(rows[0].source, 'vendor')
  assert.equal(rows[0].prices.input, 2)
  assert.equal(rows[1].prices.input, 1)
})

test('a vendor with no periods gets one row per model', () => {
  const rows = vendorRows('z-ai', parseZai('<table><tr><th>Model</th><th>Input</th><th>Cached Input</th><th>Storage</th><th>Output</th></tr><tr><td>GLM-5.3</td><td>$1.4</td><td>$0.26</td><td>Free</td><td>$4.4</td></tr></table>'))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, 'z-ai/GLM-5.3')
  assert.equal(rows[0].period, undefined)
  assert.equal(rows[0].prices.input, 1.4)
})

test('every adapter is named with the page it reads', () => {
  for (const [vendor, adapter] of Object.entries(VENDOR_PRICE_SOURCES)) {
    assert.equal(typeof adapter.url, 'string')
    assert.match(adapter.url, /^https:\/\//, `${vendor} must point at a real page`)
    assert.equal(typeof adapter.parse, 'function')
    // A parser that throws on anything is worse than useless: the service calls it
    // with whatever the network returned.
    for (const input of ['', '<html></html>', 'not html at all', undefined]) {
      const parsed = adapter.parse(input)
      assert.equal(Array.isArray(parsed.models), true, `${vendor} must always return models`)
    }
  }
})
