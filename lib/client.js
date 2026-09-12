/**
 * `@chenmiao8563/dsh-token-ledger` browser half.
 *
 * Registers a settings section that draws an overview of the ledger: range
 * totals, today, and a calendar.
 *
 * ## Why this file has no build step
 *
 * The client module system is a global loader that hands the factory a
 * `require`, so a hand-written file can ask for React directly. That keeps the
 * package's central promise — install with no build — true for the browser half
 * as well as the host half, at the cost of writing `createElement` calls
 * instead of JSX.
 *
 * Every string is localised, every number is formatted here rather than by the
 * host, and nothing in this file may assume the shape of the payload beyond
 * what `lib/overview.js` documents. A missing field renders as a dash; it never
 * throws, because a settings page that crashes takes the whole settings view
 * with it.
 *
 * @module dsh-token-ledger/client
 */

window.__ModuleLoader__.load({
  id: '@chenmiao8563/dsh-token-ledger',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const react = require('react')
    const h = react.createElement

    /** Locale namespace registered with the client locale service. */
    const NS = 'token-ledger'
    /** Where the host half serves the overview. */
    const ENDPOINT = '/api/token-ledger/summary'
    /** Where the host half serves prices and the USD rate. Read with GET, written with POST. */
    const RATES_ENDPOINT = '/api/token-ledger/rates'
    /**
     * How often to re-read the route. The panel only needs minute-level
     * freshness; the host debounces its own writes at 2s.
     */
    const POLL_MS = 60000
    /** Style element id, so a reload replaces its own styles and nothing else. */
    const STYLE_ID = 'dsh-token-ledger-styles'

    const zh = {
      nav: '用量账本',
      title: 'Token 用量概览',
      subtitle: '数据来自本机会话日志，与 dsh-token-ledger CLI 的重算结果一致',
      rangeMonth: '本月',
      rangeYear: '本年',
      rangeWeek: '7 天',
      totalTokens: 'Token 总计',
      cacheHitRate: '缓存命中率',
      calls: '调用次数',
      activeDays: '活跃天数',
      inputTokens: '未命中输入',
      outputTokens: '输出',
      cacheReadTokens: '缓存命中输入',
      reasoningTokens: '其中推理',
      today: '今日实时',
      todayHint: '每 1 分钟更新一次（成功完成的调用才计入）',
      todayEmpty: '今天还没有产生用量',
      calendar: '用量热力图',
      viewYear: '年',
      viewMonth: '月',
      viewWeek: '一周',
      weekChart: '近 7 天每日 Token',
      monthChart: '本月每日 Token',
      monthSummary: '本月小结',
      busiestDay: '最忙的一天',
      lightestDay: '最轻松的一天',
      latestDay: '工作到最晚的一天',
      weekdayOnly: '仅工作日',
      m1: '1月',
      m2: '2月',
      m3: '3月',
      m4: '4月',
      m5: '5月',
      m6: '6月',
      m7: '7月',
      m8: '8月',
      m9: '9月',
      m10: '10月',
      m11: '11月',
      m12: '12月',
      less: '少',
      more: '多',
      byModel: '按模型',
      model: '模型',
      updatedAt: '数据更新于',
      loading: '加载中…',
      unavailable: '无法读取用量数据',
      unavailableReason: '设置面板读不到 /api/token-ledger/summary。通常是因为当前 profile 没有挂载 web 服务器，或插件刚更新还没重启。',
      stale: '暂时读取失败，显示的是上一次成功的数据',
      noData: '暂无数据',
      day: '日',
      cells: '格',
      mon: '一',
      tue: '二',
      wed: '三',
      thu: '四',
      fri: '五',
      sat: '六',
      sun: '日',
      tabOverview: '概览',
      tabRates: '费率',
      ratesTitle: '模型费率',
      ratesSubtitle: '价格取自公开模型列表，每 30 分钟自动刷新一次；手动填写的值优先，且不会被刷新覆盖',
      ratesUnavailableReason: '设置面板读不到 /api/token-ledger/rates。通常是因为当前 profile 没有挂载 web 服务器，或插件刚更新还没重启。',
      fxTitle: '美元汇率',
      fxFetched: '自动获取',
      fxNone: '尚未获取',
      fxEdit: '改写',
      fxCancel: '取消',
      fxAuto: '恢复自动',
      fxSaveFailed: '汇率保存失败',
      fxHint: '汇率只作对照，本页不做费用换算',
      fxManualNote: '当前使用的是手动填写的汇率',
      fxNoneNote: '还没拿到过汇率：可以点“改写”手动填一个',
      priceTitle: '各厂商最新模型价格',
      perMillion: 'USD / 百万 Token',
      perMillionCny: '人民币 / 百万 Token',
      perMillionUsd: '美元 / 百万 Token',
      noRateForPrices: '还没拿到汇率，价格暂时按美元显示',
      priceUsdHint: '原始报价',
      priceInput: '输入',
      priceOutput: '输出',
      priceCacheRead: '缓存读',
      priceCacheWrite: '缓存写',
      catalogueOk: '已获取',
      catalogueModels: '个模型',
      catalogueAvailable: '在售',
      vendors: '个厂商',
      vendorsShown: '显示',
      fetchedAt: '获取于',
      source: '来源',
      neverFetched: '还没成功获取过价格数据，当前环境可能无法访问外网',
      neverFetchedHint: '可以在下面的“手动录入”里填写常用模型的价格：手动值保存在本机，联网恢复后也不会被覆盖。',
      offlineNote: '显示的是本机保存的上次结果；联网失败不会清空它，也不会覆盖手动填写的值',
      sourceVendorPrices: '价格是各厂商自己公布的价目（由 models.dev 汇总），单位 USD / 百万 Token',
      sourceGatewayPrices: '价格是 OpenRouter 网关的报价，不一定等于各厂商官网价目',
      sourcePlans: '不含套餐 / 长上下文档位：这里显示的是基础档价格',
      zeroPriceNote: '标价 0 的模型：可能是免费额度，也可能不按 Token 计价（例如按 GPU 小时），请以厂商页面为准',
      zeroPriceHint: '来源标价为 0，不一定是免费',
      refreshNote: '主机每 30 分钟自动刷新一次',
      manualGroup: '手动录入',
      manualOnly: '仅手动录入',
      manualBadge: '手动',
      vendorModels: '个模型有报价',
      edit: '编辑',
      save: '保存',
      clear: '清除',
      invalidPrice: '请填写大于等于 0 的数字',
      filterPlaceholder: '筛选厂商或模型',
      ratesEmpty: '暂无价格数据，请在下方手动录入',
      noMatch: '没有匹配的模型',
      manualFormTitle: '手动录入价格',
      modelId: '模型 ID',
      modelIdPlaceholder: '例如 deepseek/deepseek-chat',
      manualFormHint: '格式为“厂商/模型”，与上方列表里的模型 ID 一致；留空的项表示不设置。',
      saved: '已保存',
      saveFailed: '保存失败',
      justNow: '刚刚',
      minutesAgo: '分钟前',
      hoursAgo: '小时前',
      daysAgo: '天前',
    }

    const en = {
      nav: 'Token ledger',
      title: 'Token usage overview',
      subtitle: 'Folded from local session logs; identical to a CLI recomputation',
      rangeMonth: 'This month',
      rangeYear: 'This year',
      rangeWeek: '7 days',
      totalTokens: 'Total tokens',
      cacheHitRate: 'Cache hit rate',
      calls: 'Calls',
      activeDays: 'Active days',
      inputTokens: 'Uncached input',
      outputTokens: 'Output',
      cacheReadTokens: 'Cache read',
      reasoningTokens: 'of which reasoning',
      today: 'Today, live',
      todayHint: 'Updates once a minute (only successful calls count)',
      todayEmpty: 'No usage yet today',
      calendar: 'Usage calendar',
      viewYear: 'Year',
      viewMonth: 'Month',
      viewWeek: 'Week',
      weekChart: 'Tokens per day, last 7 days',
      monthChart: 'Tokens per day, this month',
      monthSummary: 'This month',
      busiestDay: 'Busiest day',
      lightestDay: 'Lightest day',
      latestDay: 'Latest finish',
      weekdayOnly: 'weekdays only',
      m1: 'Jan',
      m2: 'Feb',
      m3: 'Mar',
      m4: 'Apr',
      m5: 'May',
      m6: 'Jun',
      m7: 'Jul',
      m8: 'Aug',
      m9: 'Sep',
      m10: 'Oct',
      m11: 'Nov',
      m12: 'Dec',
      less: 'Less',
      more: 'More',
      byModel: 'By model',
      model: 'Model',
      updatedAt: 'Updated',
      loading: 'Loading…',
      unavailable: 'Usage data is unavailable',
      unavailableReason: 'The settings panel could not read /api/token-ledger/summary. The active profile usually has no web server mounted, or the plugin was updated without a restart.',
      stale: 'Last read failed; showing the previous data',
      noData: 'No data yet',
      day: 'day',
      cells: 'cells',
      mon: 'Mon',
      tue: 'Tue',
      wed: 'Wed',
      thu: 'Thu',
      fri: 'Fri',
      sat: 'Sat',
      sun: 'Sun',
      tabOverview: 'Overview',
      tabRates: 'Rates',
      ratesTitle: 'Model rates',
      ratesSubtitle: 'Prices come from a public model list and refresh every 30 minutes; hand-entered values win and are never overwritten',
      ratesUnavailableReason: 'The settings panel could not read /api/token-ledger/rates. The active profile usually has no web server mounted, or the plugin was updated without a restart.',
      fxTitle: 'USD rate',
      fxFetched: 'fetched',
      fxNone: 'not fetched',
      fxEdit: 'Edit',
      fxCancel: 'Cancel',
      fxAuto: 'Use fetched',
      fxSaveFailed: 'Could not save the rate',
      fxHint: 'The rate is shown for reference; this page computes no cost',
      fxManualNote: 'Currently using the rate you entered',
      fxNoneNote: 'No rate has arrived yet: use Edit to type one',
      priceTitle: 'Newest models, by vendor',
      perMillion: 'USD / 1M tokens',
      perMillionCny: 'CNY / 1M tokens',
      perMillionUsd: 'USD / 1M tokens',
      noRateForPrices: 'No rate yet, so prices are shown in USD',
      priceUsdHint: 'quoted in',
      priceInput: 'Input',
      priceOutput: 'Output',
      priceCacheRead: 'Cache read',
      priceCacheWrite: 'Cache write',
      catalogueOk: 'Fetched',
      catalogueModels: 'models',
      catalogueAvailable: 'available',
      vendors: 'vendors',
      vendorsShown: 'showing',
      fetchedAt: 'fetched at',
      source: 'source',
      neverFetched: 'Prices have never been fetched successfully; this host may have no route to the internet',
      neverFetchedHint: 'Use the manual entry below to record the models you pay for: hand-entered values are stored locally and survive a later refresh.',
      offlineNote: 'Showing the last result saved on this machine; a failed fetch neither clears it nor overwrites a hand-entered value',
      sourceVendorPrices: "Prices are each vendor's own list price (collected by models.dev), in USD per 1M tokens",
      sourceGatewayPrices: "Prices are OpenRouter gateway quotes, which are not always the vendors' list prices",
      sourcePlans: 'Excludes plans and long-context tiers: this is the base-tier price',
      zeroPriceNote: 'A price of 0 is not necessarily free: the source may simply not price this model per token (some platforms bill by GPU-hour)',
      zeroPriceHint: 'the source lists 0, which is not necessarily free',
      refreshNote: 'The host refreshes every 30 minutes',
      manualGroup: 'Entered by hand',
      manualOnly: 'hand-entered only',
      manualBadge: 'manual',
      vendorModels: 'priced models',
      edit: 'Edit',
      save: 'Save',
      clear: 'Clear',
      invalidPrice: 'Enter a number greater than or equal to 0',
      filterPlaceholder: 'Filter by vendor or model',
      ratesEmpty: 'No prices yet — enter one by hand below',
      noMatch: 'No model matches',
      manualFormTitle: 'Enter a price by hand',
      modelId: 'Model id',
      modelIdPlaceholder: 'for example deepseek/deepseek-chat',
      manualFormHint: 'Written as `vendor/model`, matching the ids in the list above; a blank field is left unset.',
      saved: 'Saved',
      saveFailed: 'Could not save',
      justNow: 'just now',
      minutesAgo: 'min ago',
      hoursAgo: 'h ago',
      daysAgo: 'd ago',
    }

    const CSS = `
.tl-root { display: flex; flex-direction: column; gap: 18px; color: var(--dsh-text-primary, inherit); }
.tl-head { display: flex; flex-direction: column; gap: 4px; }
.tl-title { font-size: 15px; font-weight: 600; margin: 0; }
.tl-sub { font-size: 12px; opacity: .65; margin: 0; }
.tl-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.tl-spacer { flex: 1 1 auto; }
.tl-tabs { display: inline-flex; border: 1px solid var(--dsh-border, rgba(127,127,127,.32)); border-radius: 8px; overflow: hidden; }
.tl-tab { appearance: none; border: 0; background: transparent; color: inherit; font: inherit; font-size: 12px; padding: 5px 12px; cursor: pointer; opacity: .7; }
.tl-tab:hover { background: var(--dsh-bg-hover, rgba(127,127,127,.12)); opacity: 1; }
.tl-tab[data-active='true'] { background: var(--dsh-bg-selected, rgba(64,140,255,.16)); opacity: 1; font-weight: 600; }
.tl-card { border: 1px solid var(--dsh-border, rgba(127,127,127,.28)); border-radius: 10px; padding: 14px; display: flex; flex-direction: column; gap: 12px; }
.tl-card-title { font-size: 13px; font-weight: 600; margin: 0; display: flex; align-items: center; gap: 8px; }
.tl-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
.tl-metric { display: flex; flex-direction: column; gap: 2px; }
.tl-metric-value { font-size: 22px; font-weight: 650; line-height: 1.15; font-variant-numeric: tabular-nums; }
.tl-metric-value-sm { font-size: 17px; }
.tl-metric-label { font-size: 11px; opacity: .65; }
.tl-metric-sub { font-size: 11px; opacity: .5; font-variant-numeric: tabular-nums; }
.tl-detail { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px 18px; font-size: 12px; opacity: .8; }
.tl-detail span { font-variant-numeric: tabular-nums; }
.tl-note { font-size: 11px; opacity: .55; margin: 0; }
.tl-scroll { overflow-x: auto; padding-bottom: 4px; }
.tl-calendar { display: flex; flex-direction: column; gap: 4px; width: max-content; }
.tl-axis { display: grid; font-size: 10px; opacity: .55; line-height: 1; }
.tl-axis-label { white-space: nowrap; }
.tl-grid { display: grid; grid-auto-flow: column; width: max-content; }
.tl-cell { border-radius: 2px; background: rgba(127,127,127,.14); }
.tl-legend { display: flex; align-items: center; gap: 6px; font-size: 11px; opacity: .7; }
.tl-chip { width: 11px; height: 11px; border-radius: 2px; flex: 0 0 auto; }
.tl-blank { border-radius: 2px; background: transparent; }
.tl-month-wrap { display: grid; grid-template-columns: minmax(170px, 340px) minmax(140px, 1fr); gap: 18px; align-items: start; }
.tl-month { display: flex; flex-direction: column; gap: 6px; }
.tl-month-summary { display: flex; flex-direction: column; gap: 10px; padding-left: 40px; }
.tl-month-weekdays { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; font-size: 10px; opacity: .55; text-align: center; }
.tl-month-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; }
.tl-month-cell { aspect-ratio: 1 / 1; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 12px; font-variant-numeric: tabular-nums; background: rgba(127,127,127,.14); }
.tl-month-blank { aspect-ratio: 1 / 1; }
.tl-meter { flex: 1 1 auto; min-width: 0; height: 9px; border-radius: 3px; background: rgba(127,127,127,.14); overflow: hidden; display: flex; }
.tl-seg { height: 100%; }
.tl-week { display: flex; flex-direction: column; gap: 7px; }
.tl-week-row { display: grid; grid-template-columns: 74px minmax(0, 1fr) 58px; align-items: center; gap: 10px; }
.tl-week-day { font-size: 11px; opacity: .7; white-space: nowrap; font-variant-numeric: tabular-nums; }
.tl-week-row-today .tl-week-day { opacity: 1; font-weight: 650; }
.tl-week-track { height: 14px; border-radius: 7px; background: rgba(127,127,127,.14); overflow: hidden; }
.tl-week-fill { height: 100%; border-radius: 7px; }
.tl-week-value { font-size: 11px; text-align: center; opacity: .7; white-space: nowrap; font-variant-numeric: tabular-nums; }
.tl-models { display: flex; flex-direction: column; gap: 7px; font-size: 12px; }
.tl-model-line { display: flex; align-items: center; gap: 10px; }
.tl-model-name { flex: 0 0 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tl-model-value { flex: 0 0 auto; font-variant-numeric: tabular-nums; opacity: .75; }
.tl-keys { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 11px; opacity: .7; }
.tl-key { display: inline-flex; align-items: center; gap: 5px; }
.tl-swatch { width: 9px; height: 9px; border-radius: 2px; }
.tl-status { font-size: 12px; opacity: .6; }
.tl-error { font-size: 12px; color: var(--dsh-danger, #d9534f); }
.tl-btn { appearance: none; border: 1px solid var(--dsh-border, rgba(127,127,127,.32)); background: transparent; color: inherit; font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 6px; cursor: pointer; white-space: nowrap; }
.tl-btn:hover { background: var(--dsh-bg-hover, rgba(127,127,127,.12)); }
.tl-btn:disabled { opacity: .45; cursor: default; }
.tl-btn:disabled:hover { background: transparent; }
.tl-btn-primary { background: var(--dsh-bg-selected, rgba(64,140,255,.16)); border-color: rgba(64,140,255,.4); font-weight: 600; }
.tl-input { appearance: none; border: 1px solid var(--dsh-border, rgba(127,127,127,.32)); border-radius: 6px; background: var(--dsh-bg-input, rgba(127,127,127,.08)); color: inherit; font: inherit; font-size: 12px; padding: 4px 8px; min-width: 0; }
.tl-input-sm { width: 96px; }
.tl-input-price { width: 100%; text-align: right; font-variant-numeric: tabular-nums; }
.tl-input-search { width: 170px; }
.tl-badge { font-size: 10px; padding: 1px 6px; border-radius: 999px; background: rgba(154,107,214,.18); border: 1px solid rgba(154,107,214,.35); opacity: .9; white-space: nowrap; }
.tl-fx { display: flex; align-items: baseline; gap: 8px; }
.tl-fx-pair { font-size: 13px; opacity: .7; }
.tl-fx-rate { font-size: 26px; font-weight: 650; font-variant-numeric: tabular-nums; line-height: 1.1; }
.tl-fx-unit { font-size: 13px; opacity: .7; }
/* The list scrolls in both directions, and the table inside it has a floor, so
   the model name can never be squeezed away: at four fixed price columns and a
   150px action column, a narrow panel left the name column zero pixels wide and
   the table showed prices for models nobody could identify. One scroll container
   for the whole list rather than one per vendor keeps a single scrollbar and
   keeps every vendor's columns aligned with the others.
   190 name + 4 x 72 price + 84 actions + 5 gaps of 7 = 597. */
.tl-rates-list { display: flex; flex-direction: column; gap: 12px; max-height: 460px; overflow: auto; padding-right: 4px; }
.tl-rate-table { min-width: 597px; display: flex; flex-direction: column; }
.tl-vendor { display: flex; flex-direction: column; gap: 2px; }
.tl-vendor-head { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 650; padding: 2px 0; }
.tl-vendor-count { font-size: 10px; font-weight: 400; opacity: .55; }
.tl-rate-head, .tl-rate-row { display: grid; grid-template-columns: minmax(190px, 1fr) repeat(4, 72px) 84px; align-items: center; gap: 7px; font-size: 12px; }
.tl-rate-head { font-size: 10px; opacity: .5; }
.tl-rate-head > span { text-align: right; }
.tl-rate-head > span:first-child { text-align: left; }
.tl-rate-row { padding: 1px 0; }
.tl-rate-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: .9; }
.tl-rate-price { text-align: right; font-variant-numeric: tabular-nums; opacity: .85; }
.tl-rate-actions { display: flex; align-items: center; justify-content: flex-end; gap: 5px; }
.tl-rate-row[data-manual='true'] .tl-rate-name { font-style: italic; }
.tl-btn-sm { font-size: 11px; padding: 2px 7px; }
.tl-logo { flex: 0 0 auto; width: 18px; height: 18px; border-radius: 5px; display: inline-flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 700; color: #fff; text-transform: uppercase; }
.tl-manual-form { display: grid; grid-template-columns: minmax(150px, 1fr) repeat(4, 88px) auto; align-items: end; gap: 8px; }
.tl-field { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.tl-field-label { font-size: 10px; opacity: .6; }
`

    /** Install the section's stylesheet, returning a remover. */
    function installStyles() {
      const existing = document.getElementById(STYLE_ID)
      if (existing !== null) existing.remove()
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.dataset.plugin = 'dsh-token-ledger'
      style.textContent = CSS
      document.head.appendChild(style)
      return () => {
        style.remove()
      }
    }

    /**
     * Format a token count the way a person reads it.
     *
     * Chinese orders of magnitude are used for the compact form because the
     * primary audience reads 万 and 亿, not M and B.
     *
     * @param {unknown} value - the count.
     * @returns {string} a compact string, or a dash when unusable.
     */
    function compact(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      const abs = Math.abs(value)
      if (abs >= 1e8) return `${(value / 1e8).toFixed(2)} 亿`
      if (abs >= 1e4) return `${(value / 1e4).toFixed(2)} 万`
      return String(Math.round(value))
    }

    /**
     * Format a count with thousands separators.
     *
     * @param {unknown} value - the count.
     * @returns {string} the full string, or a dash when unusable.
     */
    function full(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      return Math.round(value).toLocaleString('en-US')
    }

    /**
     * Format a fraction as a percentage.
     *
     * @param {unknown} value - a fraction between 0 and 1, or null.
     * @returns {string} the percentage, or a dash when undefined.
     */
    function percent(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      return `${(value * 100).toFixed(1)}%`
    }

    /**
     * Format an event timestamp as a local wall-clock time.
     *
     * @param {unknown} value - epoch milliseconds, or null when unknown.
     * @returns {string} the `HH:MM` time, or a dash when unusable.
     */
    function clock(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      const date = new Date(value)
      const pad = (part) => (part < 10 ? `0${part}` : String(part))
      return `${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    /**
     * The minute of the local day an event timestamp falls in.
     *
     * "The day that ran latest" is about the hour someone stopped working, not
     * about which calendar day came last — comparing raw timestamps would just
     * name the most recent day every time. The clock time is what gets compared.
     *
     * @param {unknown} value - epoch milliseconds, or null when unknown.
     * @returns {number|null} minutes since local midnight, or null when unusable.
     */
    function minuteOfDay(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return null
      const date = new Date(value)
      return date.getHours() * 60 + date.getMinutes()
    }

    /**
     * Split a `YYYY-MM-DD` key into its parts without timezone drift.
     *
     * @param {string} key - the day key.
     * @returns {{ year: number, month: number, day: number, weekday: number }} local parts.
     */
    function dayParts(key) {
      const [year, month, day] = String(key).split('-').map((part) => Number.parseInt(part, 10))
      const date = new Date(year, (month ?? 1) - 1, day ?? 1)
      // JS weeks start on Sunday; the calendar reads better starting Monday.
      return { year, month, day, weekday: (date.getDay() + 6) % 7 }
    }

    /**
     * Render a local date as a `YYYY-MM-DD` key.
     *
     * @param {Date} date - the day.
     * @returns {string} the key.
     */
    function dayKey(date) {
      const pad = (value) => (value < 10 ? `0${value}` : String(value))
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    }

    /** Side of one heat cell, and the gap between cells, in pixels. */
    const CELL = 11
    const CELL_GAP = 3

    /**
     * The heat ramp: index 0 is a day with no usage and is the palest step, so
     * an empty day still reads as a block rather than as a gap; 1 to 6 climb to
     * a deep blue, the conventional colour of a usage heatmap.
     */
    const LEVEL_BG = [
      'rgba(207, 222, 246, 0.3)',
      'rgba(158, 196, 255, 0.45)',
      'rgba(120, 168, 250, 0.6)',
      'rgba(86, 140, 240, 0.74)',
      'rgba(62, 116, 226, 0.86)',
      'rgba(44, 94, 208, 0.94)',
      'rgba(32, 76, 188, 1)',
    ]

    /** How many coloured steps the ramp has, excluding the empty level. */
    const LEVEL_STEPS = LEVEL_BG.length - 1

    /**
     * Map a day's tokens onto one of the ramp's levels.
     *
     * The scale is relative to the busiest day in the window and square-rooted,
     * because a single very large day would otherwise flatten every other cell
     * to the faintest level.
     *
     * @param {number} value - the day's tokens.
     * @param {number} max - the window's busiest day.
     * @returns {number} 0 for an empty day, otherwise 1 to {@link LEVEL_STEPS}.
     */
    function level(value, max) {
      if (!(value > 0) || !(max > 0)) return 0
      const ratio = Math.sqrt(value / max)
      return Math.max(1, Math.min(LEVEL_STEPS, Math.ceil(ratio * LEVEL_STEPS)))
    }

    /** The four buckets a composition bar can show, in stack order. */
    const BUCKETS = [
      { key: 'cacheReadTokens', color: '#7fb2ff', label: 'cacheReadTokens' },
      { key: 'inputTokens', color: '#2f6fd0', label: 'inputTokens' },
      { key: 'outputTokens', color: '#2fa86a', label: 'outputTokens' },
      { key: 'cacheWriteTokens', color: '#9a6bd6', label: 'cacheWriteTokens' },
    ]

    /**
     * A labelled metric.
     *
     * @param {object} props - the metric.
     * @returns {object} the element.
     */
    function Metric({ label, value, sub, small }) {
      return h(
        'div',
        { className: 'tl-metric' },
        h('div', { className: small === true ? 'tl-metric-value tl-metric-value-sm' : 'tl-metric-value' }, value),
        h('div', { className: 'tl-metric-label' }, label),
        sub === undefined || sub === null ? null : h('div', { className: 'tl-metric-sub' }, sub),
      )
    }

    /**
     * A two- or three-way segmented control.
     *
     * @param {object} props - the control.
     * @returns {object} the element.
     */
    function Tabs({ options, value, onChange }) {
      return h(
        'div',
        { className: 'tl-tabs', role: 'tablist' },
        options.map((option) =>
          h(
            'button',
            {
              key: option.value,
              type: 'button',
              role: 'tab',
              className: 'tl-tab',
              'data-active': option.value === value ? 'true' : 'false',
              'aria-selected': option.value === value,
              onClick: () => onChange(option.value),
            },
            option.label,
          ),
        ),
      )
    }

    /**
     * The year calendar: January to December of the current year, left to right,
     * one column per week and one row per weekday.
     *
     * The grid is the whole calendar year rather than a trailing window, so the
     * columns always begin in January and the month axis reads left to right.
     * Every day of the year gets a cell — days the series does not carry, and
     * days still in the future, are drawn with the ramp's palest step — so the
     * year reads as a calendar and not as a sparse scatter. The first column is
     * padded until 1 January lands on its real weekday; without that padding
     * every row would be a weekday that lies and the month axis would point at
     * the wrong columns. The axis itself is a grid with the same column width
     * and gap as the heat grid, so the two line up without measurement.
     *
     * @param {object} props - the calendar.
     * @param {object[]} props.series - contiguous day rows, ascending, ending today.
     * @param {(key: string) => string} props.t - the bound translator.
     * @returns {object} the element.
     */
    function YearHeatmap({ series, t }) {
      const byDate = new Map(series.map((day) => [String(day.date), day]))
      // The series ends today, so its tail names the year the grid draws.
      const latest = series.length > 0 ? String(series[series.length - 1].date) : ''
      const year = latest.length >= 4 ? Number.parseInt(latest.slice(0, 4), 10) : new Date().getFullYear()

      const start = new Date(year, 0, 1)
      const dayCount = Math.round((new Date(year + 1, 0, 1) - start) / 86400000)
      const leading = (start.getDay() + 6) % 7

      const days = []
      let max = 0
      for (let index = 0; index < dayCount; index += 1) {
        const key = dayKey(new Date(year, 0, 1 + index))
        const row = byDate.get(key)
        const totalTokens = row?.totalTokens ?? 0
        if (totalTokens > max) max = totalTokens
        days.push({ key, totalTokens, calls: typeof row?.calls === 'number' ? row.calls : 0 })
      }

      // One label per month, placed over the column where that month starts.
      const months = []
      let seenMonth = null
      for (const [index, day] of days.entries()) {
        const parts = dayParts(day.key)
        if (parts.month === seenMonth) continue
        seenMonth = parts.month
        months.push({ key: `${parts.year}-${parts.month}`, column: Math.floor((leading + index) / 7), label: t(`m${parts.month}`) })
      }

      const columns = Math.max(1, Math.ceil((leading + dayCount) / 7))
      const axisStyle = { gridTemplateColumns: `repeat(${columns}, ${CELL}px)`, columnGap: `${CELL_GAP}px` }
      const gridStyle = {
        gridTemplateRows: `repeat(7, ${CELL}px)`,
        gridAutoColumns: `${CELL}px`,
        rowGap: `${CELL_GAP}px`,
        columnGap: `${CELL_GAP}px`,
      }

      return h(
        'div',
        { className: 'tl-calendar' },
        h(
          'div',
          { className: 'tl-axis', style: axisStyle },
          months.map((month) =>
            h('div', { key: month.key, className: 'tl-axis-label', style: { gridColumn: month.column + 1 } }, month.label),
          ),
        ),
        h(
          'div',
          { className: 'tl-grid', style: gridStyle },
          Array.from({ length: leading }, (_, index) =>
            h('div', { key: `blank-${index}`, className: 'tl-blank', style: { width: `${CELL}px`, height: `${CELL}px` } }),
          ),
          days.map((day) =>
            h('div', {
              key: day.key,
              className: 'tl-cell',
              style: { background: LEVEL_BG[level(day.totalTokens, max)] },
              title: `${day.key} · ${compact(day.totalTokens)} · ${full(day.calls)} ${t('calls')}`,
            }),
          ),
        ),
      )
    }

    /** Weekday initials in calendar order, Monday first, as dictionary keys. */
    const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

    /**
     * The month calendar: one column per weekday, one row per week, with a
     * summary beside it.
     *
     * The whole month is laid out as a calendar rather than as thirty bars, so
     * the shape of the week — quiet weekends, busy Mondays — is visible at a
     * glance. Each day carries its number and is coloured from the same ramp
     * the year grid uses, which keeps the two views readable against the same
     * legend. The first week is padded until the 1st lands on its real weekday,
     * so the columns never lie about which day is which. Seven columns only fill
     * the card on a narrow pane, so the space to the right is spent on the
     * month's own numbers rather than left blank. That summary repeats nothing
     * from the range card above: it is three highlights — the busiest day, the
     * lightest weekday and the weekday that stopped latest — none of which any
     * total shows. The two weekday highlights skip weekends and days still to
     * come, so an empty future Friday cannot pass as the lightest day.
     *
     * @param {object} props - the calendar.
     * @param {string} props.monthPrefix - the `YYYY-MM` month to draw.
     * @param {object[]} props.series - contiguous day rows the month is read from.
     * @param {(key: string) => string} props.t - the bound translator.
     * @returns {object} the element.
     */
    function MonthHeatmap({ monthPrefix, series, t }) {
      const byDate = new Map(series.map((day) => [String(day.date), day]))
      const year = Number.parseInt(monthPrefix.slice(0, 4), 10)
      const month = Number.parseInt(monthPrefix.slice(5, 7), 10)
      const start = new Date(year, month - 1, 1)
      const dayCount = new Date(year, month, 0).getDate()
      const leading = (start.getDay() + 6) % 7
      const lastRow = series.length > 0 ? series[series.length - 1] : null
      const today = String(lastRow?.date ?? '')

      const days = []
      let max = 0
      for (let index = 0; index < dayCount; index += 1) {
        const key = dayKey(new Date(year, month - 1, index + 1))
        const row = byDate.get(key)
        const totalTokens = row?.totalTokens ?? 0
        if (totalTokens > max) max = totalTokens
        days.push({
          key,
          day: index + 1,
          totalTokens,
          calls: typeof row?.calls === 'number' ? row.calls : 0,
          lastAt: typeof row?.lastAt === 'number' && Number.isFinite(row.lastAt) ? row.lastAt : null,
          lastMinute: minuteOfDay(row?.lastAt),
        })
      }

      let busiest = null
      let lightest = null
      let latest = null
      for (const day of days) {
        if (busiest === null || day.totalTokens > busiest.totalTokens) busiest = day
        // The two weekday highlights ignore weekends, and a day that has not
        // happened yet: an empty future weekday would always win "lightest",
        // which says nothing about how the month was actually worked.
        if (day.key > today || dayParts(day.key).weekday > 4) continue
        if (lightest === null || day.totalTokens < lightest.totalTokens) lightest = day
        if (day.lastMinute !== null && (latest === null || day.lastMinute > latest.lastMinute)) latest = day
      }
      if (max === 0) busiest = null

      return h(
        'div',
        { className: 'tl-month-wrap' },
        h(
          'div',
          { className: 'tl-month' },
          h(
            'div',
            { className: 'tl-month-weekdays' },
            WEEKDAY_KEYS.map((key) => h('div', { key, className: 'tl-month-weekday' }, t(key))),
          ),
          h(
            'div',
            { className: 'tl-month-grid' },
            Array.from({ length: leading }, (_, index) => h('div', { key: `blank-${index}`, className: 'tl-month-blank' })),
            days.map((day) => {
              const step = level(day.totalTokens, max)
              return h(
                'div',
                {
                  key: day.key,
                  className: 'tl-month-cell',
                  // The deeper steps are dark enough that the day number has to
                  // flip to white to stay readable; the lighter ones keep the
                  // inherited colour, which works on both light and dark themes.
                  style: { background: LEVEL_BG[step], color: step >= 3 ? '#fff' : 'inherit' },
                  title: `${day.key} · ${compact(day.totalTokens)} · ${full(day.calls)} ${t('calls')}`,
                },
                day.day,
              )
            }),
          ),
        ),
        h(
          'div',
          { className: 'tl-month-summary' },
          h('h3', { className: 'tl-card-title' }, t('monthSummary')),
          h(Metric, {
            label: t('busiestDay'),
            value: busiest === null ? '—' : compact(busiest.totalTokens),
            sub: busiest === null ? '—' : busiest.key,
            small: true,
          }),
          h(Metric, {
            label: t('lightestDay'),
            value: lightest === null ? '—' : compact(lightest.totalTokens),
            sub: lightest === null ? '—' : `${lightest.key} · ${t('weekdayOnly')}`,
            small: true,
          }),
          h(Metric, {
            label: t('latestDay'),
            value: latest === null ? '—' : clock(latest.lastAt),
            sub: latest === null ? '—' : `${latest.key} · ${t('weekdayOnly')}`,
            small: true,
          }),
        ),
      )
    }

    /**
     * The last seven days as horizontal bars, one row per day.
     *
     * Rows rather than columns because a row has the whole card width behind
     * it: seven columns huddle in the middle of a wide pane, while seven rows
     * use all of it. Each day's number then sits beside its own bar instead of
     * above it, and the weekday can be spelled out. Bars take their colour from
     * the same ramp the heat grids use, so the week reads on the same scale as
     * the year and the month.
     *
     * @param {object} props - the chart.
     * @param {object[]} props.series - the days to draw, ascending, ending today.
     * @param {string} props.todayDate - the `YYYY-MM-DD` day to mark as today.
     * @param {(key: string) => string} props.t - the bound translator.
     * @returns {object} the element.
     */
    function WeekBars({ series, todayDate, t }) {
      const max = series.reduce((peak, day) => Math.max(peak, day.totalTokens ?? 0), 0)
      return h(
        'div',
        { className: 'tl-week' },
        series.map((day) => {
          const tokens = day.totalTokens ?? 0
          const calls = typeof day.calls === 'number' ? day.calls : 0
          const weekday = WEEKDAY_KEYS[dayParts(String(day.date)).weekday]
          const percent = max > 0 ? Math.round((tokens / max) * 100) : 0
          return h(
            'div',
            {
              key: day.date,
              className: day.date === todayDate ? 'tl-week-row tl-week-row-today' : 'tl-week-row',
              title: `${day.date} · ${full(tokens)} · ${full(calls)} ${t('calls')}`,
            },
            h(
              'div',
              { className: 'tl-week-day' },
              weekday === undefined ? String(day.date) : `${t(weekday)} ${String(day.date).slice(5)}`,
            ),
            h(
              'div',
              { className: 'tl-week-track' },
              // A non-zero day always gets a visible sliver; an empty day gets
              // no fill at all, rather than a sliver that would read as usage.
              tokens > 0
                ? h('div', {
                    className: 'tl-week-fill',
                    style: { width: `${Math.max(percent, 2)}%`, background: LEVEL_BG[level(tokens, max)] },
                  })
                : null,
            ),
            h('div', { className: 'tl-week-value' }, compact(tokens)),
          )
        }),
      )
    }

    /**
     * The overview, as pure presentation.
     *
     * Split out from the section deliberately. Everything visible here is a
     * function of these props — no fetching, no state, no clock — which is what
     * makes it renderable under a real React in a test, with no browser, no DOM
     * and no network. The fetching half is `TokenLedgerSection` below.
     *
     * @param {object} props - the view inputs.
     * @param {(key: string) => string} props.t - the bound translator.
     * @param {{ status: string, data: object|null, error: string|null }} props.state - what to show.
     * @param {'month'|'year'|'week'} props.range - the selected range.
     * @param {'year'|'month'|'week'} props.view - the selected calendar view.
     * @param {(value: string) => void} props.onRange - range change handler.
     * @param {(value: string) => void} props.onView - calendar view change handler.
     * @returns {object} the element.
     */
    function OverviewView({ t, state, range, view, onRange, onView }) {
      const header = h(
        'div',
        { className: 'tl-head' },
        h('h2', { className: 'tl-title' }, t('title')),
        h('p', { className: 'tl-sub' }, t('subtitle')),
      )

      if (state.data === null) {
        return h(
          'div',
          { className: 'tl-root' },
          header,
          h(
            'div',
            { className: 'tl-card' },
            h('h3', { className: 'tl-card-title' }, state.status === 'error' ? t('unavailable') : t('loading')),
            state.status === 'error' ? h('p', { className: 'tl-note' }, t('unavailableReason')) : null,
            state.error === null ? null : h('p', { className: 'tl-error' }, state.error),
          ),
        )
      }

      const data = state.data
      const summary = data.ranges?.[range] ?? { totals: {}, calls: 0, activeDays: 0, cacheHitRate: null }
      const totals = summary.totals ?? {}
      const today = data.today ?? { totals: {}, calls: 0, cacheHitRate: null, date: '' }
      const series = Array.isArray(data.series) ? data.series : []
      const models = Array.isArray(data.models) ? data.models : []
      const updated =
        typeof data.generatedAt === 'number' ? new Date(data.generatedAt).toLocaleTimeString() : '—'
      // The month view draws the current calendar month out of the same series
      // the year heatmap uses, so the two cannot disagree. A payload without a
      // usable date falls back to the month the browser is in.
      const monthPrefix =
        typeof today.date === 'string' && today.date.length >= 7 ? today.date.slice(0, 7) : dayKey(new Date()).slice(0, 7)

      return h(
        'div',
        { className: 'tl-root' },

        state.status === 'stale' ? h('p', { className: 'tl-note' }, t('stale')) : null,

        // Range totals.
        h(
          'div',
          { className: 'tl-card' },
          h(
            'div',
            { className: 'tl-row' },
            header,
            h('div', { className: 'tl-spacer' }),
            h(Tabs, {
              value: range,
              onChange: onRange,
              options: [
                { value: 'month', label: t('rangeMonth') },
                { value: 'year', label: t('rangeYear') },
                { value: 'week', label: t('rangeWeek') },
              ],
            }),
          ),
          h(
            'div',
            { className: 'tl-metrics' },
            h(Metric, { label: t('totalTokens'), value: compact(totals.totalTokens), sub: full(totals.totalTokens) }),
            h(Metric, { label: t('cacheHitRate'), value: percent(summary.cacheHitRate), sub: `${compact(totals.cacheReadTokens)} / ${compact((totals.cacheReadTokens ?? 0) + (totals.inputTokens ?? 0))}` }),
            h(Metric, { label: t('calls'), value: full(summary.calls), sub: `${full(summary.activeDays)} ${t('day')}` }),
          ),
          h(
            'div',
            { className: 'tl-detail' },
            h('span', null, `${t('inputTokens')} ${full(totals.inputTokens)}`),
            h('span', null, `${t('cacheReadTokens')} ${full(totals.cacheReadTokens)}`),
            h('span', null, `${t('outputTokens')} ${full(totals.outputTokens)}`),
            totals.reasoningTokens > 0 ? h('span', null, `${t('reasoningTokens')} ${full(totals.reasoningTokens)}`) : null,
          ),
        ),

        // Today, live.
        h(
          'div',
          { className: 'tl-card' },
          h(
            'h3',
            { className: 'tl-card-title' },
            t('today'),
            h('span', { className: 'tl-status' }, today.date ?? ''),
          ),
          (today.totals?.totalTokens ?? 0) === 0
            ? h('p', { className: 'tl-note' }, t('todayEmpty'))
            : [
                h(
                  'div',
                  { key: 'metrics', className: 'tl-metrics' },
                  h(Metric, { label: t('totalTokens'), value: compact(today.totals.totalTokens), sub: full(today.totals.totalTokens) }),
                  h(Metric, { label: t('cacheHitRate'), value: percent(today.cacheHitRate) }),
                  h(Metric, { label: t('calls'), value: full(today.calls) }),
                ),
                h(
                  'div',
                  { key: 'detail', className: 'tl-detail' },
                  h('span', null, `${t('inputTokens')} ${full(today.totals.inputTokens)}`),
                  h('span', null, `${t('cacheReadTokens')} ${full(today.totals.cacheReadTokens)}`),
                  h('span', null, `${t('outputTokens')} ${full(today.totals.outputTokens)}`),
                  today.totals.reasoningTokens > 0 ? h('span', null, `${t('reasoningTokens')} ${full(today.totals.reasoningTokens)}`) : null,
                ),
              ],
          h('p', { className: 'tl-note' }, t('todayHint')),
        ),

        // Calendar.
        h(
          'div',
          { className: 'tl-card' },
          h(
            'div',
            { className: 'tl-row' },
            h('h3', { className: 'tl-card-title' }, t('calendar')),
            h('div', { className: 'tl-spacer' }),
            h(Tabs, {
              value: view,
              onChange: onView,
              options: [
                { value: 'year', label: t('viewYear') },
                { value: 'month', label: t('viewMonth') },
                { value: 'week', label: t('viewWeek') },
              ],
            }),
          ),
          series.length === 0
            ? h('p', { className: 'tl-note' }, t('noData'))
            : view === 'year'
              ? h('div', { className: 'tl-scroll' }, h(YearHeatmap, { series, t }))
              : view === 'month'
                ? h(MonthHeatmap, { monthPrefix, series, t })
                : h(WeekBars, { series: series.slice(-7), todayDate: String(today.date ?? ''), t }),
          view === 'week'
            ? h('p', { className: 'tl-note' }, t('weekChart'))
            : h(
                'div',
                { className: 'tl-legend' },
                h('span', null, t('less')),
                LEVEL_BG.map((background, index) => h('span', { key: index, className: 'tl-chip', style: { background } })),
                h('span', null, t('more')),
              ),
        ),

        // Models.
        models.length === 0
          ? null
          : h(
              'div',
              { className: 'tl-card' },
              h('h3', { className: 'tl-card-title' }, t('byModel')),
              h(
                'div',
                { className: 'tl-models' },
                models.map((model) => {
                  // The bar shows where the tokens went, not just how many there
                  // were: a single-width fill cannot distinguish a model that is
                  // mostly cache reads from one that is mostly fresh input.
                  const total = BUCKETS.reduce((sum, bucket) => sum + (model[bucket.key] ?? 0), 0)
                  return h(
                    'div',
                    { key: model.model, className: 'tl-model-line' },
                    h('span', { className: 'tl-model-name', title: model.model }, model.model),
                    h(
                      'span',
                      { className: 'tl-meter', title: BUCKETS.map((bucket) => `${t(bucket.label)} ${full(model[bucket.key])}`).join(' · ') },
                      total > 0
                        ? BUCKETS.filter((bucket) => (model[bucket.key] ?? 0) > 0).map((bucket) =>
                            h('span', {
                              key: bucket.key,
                              className: 'tl-seg',
                              style: { width: `${((model[bucket.key] ?? 0) / total) * 100}%`, background: bucket.color },
                            }),
                          )
                        : null,
                    ),
                    h('span', { className: 'tl-model-value' }, `${compact(model.totalTokens)} · ${percent(model.cacheHitRate)}`),
                  )
                }),
              ),
              h(
                'div',
                { className: 'tl-keys' },
                BUCKETS.map((bucket) =>
                  h(
                    'span',
                    { key: bucket.key, className: 'tl-key' },
                    h('span', { className: 'tl-swatch', style: { background: bucket.color } }),
                    t(bucket.label),
                  ),
                ),
              ),
            ),

        h('p', { className: 'tl-note' }, `${t('updatedAt')} ${updated}`),
      )
    }

    /**
     * Format a price: US dollars per one million tokens, converted for display.
     *
     * Published prices span five orders of magnitude — a cache read can cost a
     * hundredth of what an output token does — so the precision follows the
     * magnitude instead of being fixed, and trailing zeros are dropped because
     * `$2.5` is what a person writes and `$2.50` only looks like data.
     *
     * The conversion is display only. Nothing here multiplies a token count by a
     * price; it changes the unit a price is quoted in, which is why the table can
     * switch currency without the page ever claiming to know a bill.
     *
     * @param {unknown} usd - USD per 1M tokens, or null when unpriced.
     * @param {number|null} rate - USD → display currency, or null to show USD.
     * @returns {string} the formatted price, or a dash when there is none.
     */
    function price(usd, rate = null) {
      if (typeof usd !== 'number' || !Number.isFinite(usd)) return '—'
      const converted = rate === null ? usd : usd * rate
      const digits = converted >= 1 ? 2 : converted >= 0.01 ? 3 : 6
      let text = converted.toFixed(digits)
      if (Number(text) === 0 && converted > 0) {
        // Rounding to nothing would print a real price as `¥0`, which claims
        // "free". Nothing publishes a price this small, but a lie is a lie.
        text = converted.toPrecision(2)
      } else {
        text = text.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')
      }
      return `${rate === null ? '$' : '¥'}${text}`
    }

    /**
     * Format an exchange rate: four decimals, which is what a rate board shows.
     *
     * @param {unknown} value - the rate.
     * @returns {string} the rate, or a dash when there is none.
     */
    function rateText(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      return value >= 1000 ? full(value) : value.toFixed(4)
    }

    /**
     * Describe an age in the units a reader thinks in.
     *
     * The host attaches `ageMs` to every fetched value, so the page never has to
     * do date arithmetic against a clock that may not agree with the host's.
     *
     * @param {unknown} ageMs - milliseconds since the value was fetched.
     * @param {(key: string) => string} t - the bound translator.
     * @returns {string} the description, or an empty string when unknown.
     */
    function since(ageMs, t) {
      if (typeof ageMs !== 'number' || !Number.isFinite(ageMs) || ageMs < 0) return ''
      const minutes = Math.floor(ageMs / 60000)
      if (minutes < 1) return t('justNow')
      if (minutes < 60) return `${full(minutes)} ${t('minutesAgo')}`
      const hours = Math.floor(minutes / 60)
      if (hours < 24) return `${full(hours)} ${t('hoursAgo')}`
      return `${full(Math.floor(hours / 24))} ${t('daysAgo')}`
    }

    /**
     * The host part of a URL, for naming where a value came from.
     *
     * @param {unknown} url - the source URL.
     * @returns {string} the host, the raw string when it will not parse, or a dash.
     */
    function hostOf(url) {
      if (typeof url !== 'string' || url === '') return '—'
      try {
        return new URL(url).host
      } catch {
        return url
      }
    }

    /** The four prices a row can carry, and the dictionary label for each. */
    const PRICE_FIELDS = [
      { key: 'input', label: 'priceInput' },
      { key: 'output', label: 'priceOutput' },
      { key: 'cacheRead', label: 'priceCacheRead' },
      { key: 'cacheWrite', label: 'priceCacheWrite' },
    ]

    /**
     * Read one price out of a text input.
     *
     * Three outcomes, not two: an empty field means "do not set this price",
     * which is different from a field that was filled in wrongly.
     *
     * @param {unknown} text - the input's value.
     * @returns {number|null|undefined} the price, null for blank, undefined for invalid.
     */
    function readPrice(text) {
      if (typeof text !== 'string' || text.trim() === '') return null
      const value = Number(text)
      if (!Number.isFinite(value) || value < 0) return undefined
      return value
    }

    /**
     * Build a `/rates` patch from four draft fields.
     *
     * The host stores prices in USD, because that is how they are quoted, so a
     * draft typed in another currency is converted back here — at the last
     * moment, and with the same rate the table displayed. The conversion is
     * rounded to six decimals, which is the precision the host keeps, so a value
     * that goes out and comes back unchanged does not drift.
     *
     * @param {string} id - the model id.
     * @param {object} drafts - the four draft strings, in the display currency.
     * @param {number|null} rate - USD → display currency, or null when the drafts are already USD.
     * @returns {object|null} the patch, or null when a field is not a price.
     */
    function pricePatch(id, drafts, rate = null) {
      const prices = {}
      for (const field of PRICE_FIELDS) {
        const value = readPrice(drafts?.[field.key])
        if (value === undefined) return null
        // A blank field must stay null — "clear this price" — and not fall
        // through the conversion below, where `null / rate` is 0 and would
        // silently claim the model is free.
        if (value === null) {
          prices[field.key] = null
        } else {
          prices[field.key] = rate === null ? value : Math.round((value / rate) * 1e6) / 1e6
        }
      }
      return { models: { [id]: prices } }
    }

    /**
     * Turn a row's served prices back into draft strings.
     *
     * @param {object} model - a catalogue row.
     * @param {number|null} rate - USD → display currency, or null to edit in USD.
     * @returns {object} the four draft strings.
     */
    function draftsOf(model, rate = null) {
      const drafts = {}
      for (const field of PRICE_FIELDS) {
        const value = model?.prices?.[field.key]
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          drafts[field.key] = ''
          continue
        }
        drafts[field.key] = String(rate === null ? value : Math.round(value * rate * 1e6) / 1e6)
      }
      return drafts
    }

    /**
     * The vendors worth a brand mark, and what to draw for each.
     *
     * These are monograms in the vendor's own colour rather than the real logos.
     * A real logo is an asset: it has to be shipped (and licensed), or fetched
     * from somewhere at page load, which would put a network dependency in a page
     * whose whole point is that it works offline. Two letters in the brand colour
     * carry the same information at a glance and cannot break.
     */
    const VENDOR_MARKS = {
      openai: ['OA', '#10a37f'],
      anthropic: ['AN', '#d97757'],
      google: ['GO', '#4285f4'],
      deepseek: ['DS', '#4d6bfe'],
      qwen: ['QW', '#6f5cf1'],
      'x-ai': ['XA', '#3f4653'],
      'meta-llama': ['ML', '#0866ff'],
      meta: ['ME', '#0866ff'],
      mistralai: ['MI', '#ff7000'],
      'z-ai': ['ZA', '#2f6fed'],
      moonshotai: ['MO', '#5b5bd6'],
      minimax: ['MM', '#e5484d'],
      nvidia: ['NV', '#76b900'],
      amazon: ['AM', '#e07b00'],
      cohere: ['CO', '#39594d'],
      perplexity: ['PX', '#20808d'],
      microsoft: ['MS', '#0078d4'],
      tencent: ['TX', '#0052d9'],
      'bytedance-seed': ['BS', '#325ab4'],
      stepfun: ['ST', '#16a34a'],
      xiaomi: ['XI', '#ff6900'],
      'ibm-granite': ['IB', '#0f62fe'],
      inclusionai: ['IN', '#7c3aed'],
      thedrummer: ['TD', '#b45309'],
      nousresearch: ['NR', '#9333ea'],
      sakana: ['SA', '#db2777'],
      upstage: ['UP', '#0d9488'],
      liquid: ['LQ', '#0284c7'],
      rekaai: ['RK', '#c2410c'],
      morph: ['MR', '#475569'],
    }

    /** Colours for a vendor with no brand entry, picked by name so it is stable. */
    const FALLBACK_MARK_COLORS = ['#4d6bfe', '#2fa86a', '#9a6bd6', '#d97757', '#20808d', '#b45309', '#5b5bd6', '#0f766e']

    /**
     * The mark to draw before a vendor's name.
     *
     * A vendor nobody curated still gets a mark, because a row of names with one
     * blank leading column looks broken: the colour comes from a hash of the name
     * so the same vendor keeps the same colour across refreshes, and the letters
     * are its first two.
     *
     * @param {string} vendor - the vendor id.
     * @returns {{ mark: string, color: string }} the badge.
     */
    function vendorMark(vendor) {
      const name = String(vendor ?? '')
      const known = VENDOR_MARKS[name]
      if (known !== undefined) return { mark: known[0], color: known[1] }
      let hash = 0
      for (let index = 0; index < name.length; index += 1) {
        hash = (hash * 31 + name.charCodeAt(index)) % 100000
      }
      return {
        mark: name.replace(/[^a-z0-9]/gi, '').slice(0, 2) || '··',
        color: FALLBACK_MARK_COLORS[hash % FALLBACK_MARK_COLORS.length],
      }
    }

    /**
     * The rates view: the live USD rate, then each vendor's newest models and
     * what they cost.
     *
     * Two things shape this screen. The first is that prices come from a network
     * the host may not have: every value carries where it came from and how old
     * it is, a failed refresh says so without blanking anything, and hand entry
     * is a first-class path rather than a fallback hidden behind an error. The
     * second is that this is a reference table, not a bill: no token count is
     * multiplied by any price here, which is why the rate sits in its own box
     * with a note saying so.
     *
     * @param {object} props - the view inputs.
     * @param {(key: string) => string} props.t - the bound translator.
     * @param {{ status: string, data: object|null, error: string|null, saving?: boolean, notice?: object|null }} props.state - what to show.
     * @param {(patch: object) => void} props.onPatch - sends a hand-entered patch to the host.
     * @returns {object} the element.
     */
    function RatesView({ t, state, onPatch }) {
      const [filter, setFilter] = react.useState('')
      const [fxDraft, setFxDraft] = react.useState(null)
      const [editing, setEditing] = react.useState(null)
      const [draft, setDraft] = react.useState({ id: '', input: '', output: '', cacheRead: '', cacheWrite: '' })

      const header = h(
        'div',
        { className: 'tl-head' },
        h('h2', { className: 'tl-title' }, t('ratesTitle')),
        h('p', { className: 'tl-sub' }, t('ratesSubtitle')),
      )

      if (state.data === null) {
        return h(
          'div',
          { className: 'tl-root' },
          header,
          h(
            'div',
            { className: 'tl-card' },
            h('h3', { className: 'tl-card-title' }, state.status === 'error' ? t('unavailable') : t('loading')),
            state.status === 'error' ? h('p', { className: 'tl-note' }, t('ratesUnavailableReason')) : null,
            state.error === null ? null : h('p', { className: 'tl-error' }, state.error),
          ),
        )
      }

      const data = state.data
      const fx = data.fx ?? {}
      const catalogue = data.catalogue ?? {}
      const vendors = Array.isArray(data.vendors) ? data.vendors : []
      const notice = state.notice ?? null
      const busy = state.saving === true
      // Prices are quoted in USD and displayed in the quote currency. With no
      // rate there is nothing to convert with, so the table falls back to USD and
      // says so rather than inventing a number.
      const rate = typeof fx.rate === 'number' && Number.isFinite(fx.rate) && fx.rate > 0 ? fx.rate : null
      const symbol = rate === null ? '$' : '¥'
      const send = (patch) => {
        if (typeof onPatch === 'function') onPatch(patch)
      }

      const fxEditing = fxDraft !== null
      const saveFx = () => {
        const value = readPrice(fxDraft)
        if (value === null || value === undefined) return
        setFxDraft(null)
        send({ fx: { rate: value } })
      }

      const fxCard = h(
        'div',
        { className: 'tl-card' },
        h(
          'div',
          { className: 'tl-row' },
          h(
            'h3',
            { className: 'tl-card-title' },
            t('fxTitle'),
            h('span', { className: 'tl-badge' }, fx.overridden === true ? t('manualBadge') : fx.available === true ? t('fxFetched') : t('fxNone')),
          ),
          h('div', { className: 'tl-spacer' }),
          fxEditing
            ? [
                h('input', {
                  key: 'draft',
                  className: 'tl-input tl-input-sm',
                  value: fxDraft,
                  inputMode: 'decimal',
                  'aria-label': t('fxTitle'),
                  onChange: (event) => setFxDraft(event.target.value),
                }),
                h(
                  'button',
                  {
                    key: 'save',
                    type: 'button',
                    className: 'tl-btn tl-btn-primary',
                    disabled: busy || readPrice(fxDraft) === null || readPrice(fxDraft) === undefined,
                    onClick: saveFx,
                  },
                  t('save'),
                ),
                h('button', { key: 'cancel', type: 'button', className: 'tl-btn', onClick: () => setFxDraft(null) }, t('fxCancel')),
              ]
            : [
                h(
                  'button',
                  {
                    key: 'edit',
                    type: 'button',
                    className: 'tl-btn',
                    onClick: () => setFxDraft(typeof fx.rate === 'number' ? String(fx.rate) : ''),
                  },
                  t('fxEdit'),
                ),
                fx.overridden === true
                  ? h('button', { key: 'auto', type: 'button', className: 'tl-btn', disabled: busy, onClick: () => send({ fx: null }) }, t('fxAuto'))
                  : null,
              ],
        ),
        h(
          'div',
          { className: 'tl-fx' },
          h('span', { className: 'tl-fx-pair' }, `1 ${fx.base ?? 'USD'} =`),
          h('span', { className: 'tl-fx-rate' }, rateText(fx.rate)),
          h('span', { className: 'tl-fx-unit' }, fx.quote ?? data.quote ?? 'CNY'),
        ),
        h(
          'p',
          { className: 'tl-note' },
          fx.overridden === true
            ? t('fxManualNote')
            : fx.available === true
              ? `${t('source')} ${hostOf(fx.source)} · ${t('fetchedAt')} ${clock(fx.fetchedAt)} · ${since(fx.ageMs, t)}`
              : t('fxNoneNote'),
        ),
        h('p', { className: 'tl-note' }, t('fxHint')),
      )

      const needle = filter.trim().toLowerCase()
      const groups = vendors
        .filter((entry) => entry !== null && typeof entry === 'object')
        .map((entry) => {
          const models = Array.isArray(entry.models) ? entry.models : []
          const matched =
            needle === ''
              ? models
              : models.filter(
                  (model) => String(model?.id ?? '').toLowerCase().includes(needle) || String(entry.vendor ?? '').toLowerCase().includes(needle),
                )
          return { ...entry, models: matched }
        })
        .filter((entry) => entry.models.length > 0)

      const rowFor = (model) => {
        const isEditing = editing !== null && editing.id === model.id
        // `¥0` reads as free. Where the source lists 0 for both headline prices it
        // may mean the platform does not price this model per token at all, so the
        // row says so instead of quietly claiming the model costs nothing.
        const zero = model.zero === true && isEditing === false
        return h(
          'div',
          {
            key: String(model.id),
            className: 'tl-rate-row',
            'data-manual': model.source === 'manual' ? 'true' : 'false',
            'data-zero': model.zero === true ? 'true' : 'false',
          },
          h('span', { className: 'tl-rate-name', title: String(model.id) }, model.name ?? String(model.id)),
          isEditing
            ? PRICE_FIELDS.map((field) =>
                h('input', {
                  key: field.key,
                  className: 'tl-input tl-input-price',
                  value: editing[field.key],
                  inputMode: 'decimal',
                  'aria-label': `${t(field.label)} (${symbol})`,
                  onChange: (event) => setEditing({ ...editing, [field.key]: event.target.value, invalid: false }),
                }),
              )
            : PRICE_FIELDS.map((field) =>
                h(
                  'span',
                  {
                    key: field.key,
                    className: 'tl-rate-price',
                    // The served value is USD, so a converted price keeps its
                    // original one hover away: the page never shows a number it
                    // cannot trace.
                    title:
                      rate === null
                        ? undefined
                        : `${t('priceUsdHint')} ${price(model.prices?.[field.key], null)}${zero ? ` · ${t('zeroPriceHint')}` : ''}`,
                  },
                  price(model.prices?.[field.key], rate),
                ),
              ),
          h(
            'span',
            { className: 'tl-rate-actions' },
            isEditing === false && model.source === 'manual' ? h('span', { className: 'tl-badge' }, t('manualBadge')) : null,
            isEditing === true && editing.invalid === true ? h('span', { className: 'tl-error' }, t('invalidPrice')) : null,
            isEditing
              ? [
                  h(
                    'button',
                    {
                      key: 'save',
                      type: 'button',
                      className: 'tl-btn tl-btn-primary tl-btn-sm',
                      disabled: busy,
                      onClick: () => {
                        // Emptying every field is an undo, not a claim that the
                        // model has no price: the row was already in the table
                        // with fetched prices, so hand it back to them.
                        if (PRICE_FIELDS.every((field) => readPrice(editing[field.key]) === null)) {
                          setEditing(null)
                          send({ models: { [model.id]: null } })
                          return
                        }
                        const patch = pricePatch(model.id, editing, rate)
                        if (patch === null) {
                          setEditing({ ...editing, invalid: true })
                          return
                        }
                        setEditing(null)
                        send(patch)
                      },
                    },
                    t('save'),
                  ),
                  h('button', { key: 'cancel', type: 'button', className: 'tl-btn tl-btn-sm', onClick: () => setEditing(null) }, t('fxCancel')),
                ]
              : [
                  h(
                    'button',
                    {
                      key: 'edit',
                      type: 'button',
                      className: 'tl-btn tl-btn-sm',
                      onClick: () => setEditing({ id: model.id, ...draftsOf(model, rate), invalid: false }),
                    },
                    t('edit'),
                  ),
                  model.source === 'manual'
                    ? h(
                        'button',
                        { key: 'clear', type: 'button', className: 'tl-btn tl-btn-sm', disabled: busy, onClick: () => send({ models: { [model.id]: null } }) },
                        t('clear'),
                      )
                    : null,
                ],
          ),
        )
      }

      const statusLine =
        catalogue.available === true
          ? [
              `${t('catalogueOk')} ${full(catalogue.modelCount)} / ${full(catalogue.totalAvailable)} ${t('catalogueModels')}`,
              // Say both numbers when a cap is in play: "15 vendors" alone would
              // read as "the list has 15 vendors", which is not what happened.
              typeof catalogue.availableVendorCount === 'number' && catalogue.availableVendorCount > catalogue.vendorCount
                ? `${t('vendorsShown')} ${full(catalogue.vendorCount)} / ${full(catalogue.availableVendorCount)} ${t('vendors')}`
                : `${full(catalogue.vendorCount)} ${t('vendors')}`,
              `${t('fetchedAt')} ${clock(catalogue.fetchedAt)} · ${since(catalogue.ageMs, t)}`,
              `${t('source')} ${hostOf(catalogue.source)}`,
            ].join(' · ')
          : t('neverFetched')

      const pricesCard = h(
        'div',
        { className: 'tl-card' },
        h(
          'div',
          { className: 'tl-row' },
          h(
            'h3',
            { className: 'tl-card-title' },
            t('priceTitle'),
            h('span', { className: 'tl-status' }, rate === null ? t('perMillionUsd') : t('perMillionCny')),
          ),
          h('div', { className: 'tl-spacer' }),
          h('input', {
            className: 'tl-input tl-input-search',
            type: 'search',
            value: filter,
            placeholder: t('filterPlaceholder'),
            'aria-label': t('filterPlaceholder'),
            onChange: (event) => setFilter(event.target.value),
          }),
        ),
        h('p', { className: 'tl-note' }, statusLine),
        rate === null && catalogue.available === true ? h('p', { className: 'tl-note' }, t('noRateForPrices')) : null,
        // Which prices these are is part of reading them: the per-vendor source is
        // each vendor's own list price, the gateway source is OpenRouter's quote,
        // and a reader who does not know which one they are looking at cannot
        // judge a number that surprises them.
        catalogue.available === true
          ? h(
              'p',
              { className: 'tl-note' },
              data.priceSource === 'openrouter' ? t('sourceGatewayPrices') : t('sourceVendorPrices'),
            )
          : null,
        catalogue.available === true ? h('p', { className: 'tl-note' }, t('offlineNote')) : h('p', { className: 'tl-note' }, t('neverFetchedHint')),
        groups.some((entry) => entry.models.some((model) => model.zero === true)) ? h('p', { className: 'tl-note' }, t('zeroPriceNote')) : null,
        groups.length === 0
          ? h('p', { className: 'tl-note' }, vendors.length === 0 ? t('ratesEmpty') : t('noMatch'))
          : h(
              'div',
              { className: 'tl-rates-list' },
              groups.map((entry) =>
                h(
                  'div',
                  { key: String(entry.vendor ?? 'manual'), className: 'tl-vendor' },
                  h(
                    'div',
                    { className: 'tl-vendor-head' },
                    entry.manualOnly === true || entry.vendor === '' || entry.vendor === undefined
                      ? h('span', { className: 'tl-logo', style: { background: '#64748b' } }, '··')
                      : h('span', { className: 'tl-logo', style: { background: vendorMark(entry.vendor).color } }, vendorMark(entry.vendor).mark),
                    h('span', { className: 'tl-vendor-name' }, entry.vendor === '' || entry.vendor === undefined ? t('manualGroup') : String(entry.vendor)),
                    h(
                      'span',
                      { className: 'tl-vendor-count' },
                      entry.manualOnly === true ? t('manualOnly') : `${full(entry.modelCount)} ${t('vendorModels')}`,
                    ),
                  ),
                  h(
                    'div',
                    { className: 'tl-rate-table' },
                    h(
                      'div',
                      { className: 'tl-rate-head' },
                      h('span', null, t('model')),
                      PRICE_FIELDS.map((field) => h('span', { key: field.key }, t(field.label))),
                      h('span', null, ''),
                    ),
                    entry.models.map(rowFor),
                  ),
                ),
              ),
            ),
      )

      const saveDraft = () => {
        const id = draft.id.trim()
        if (id === '') return
        const patch = pricePatch(id, draft, rate)
        if (patch === null) {
          setDraft({ ...draft, invalid: true })
          return
        }
        setDraft({ id: '', input: '', output: '', cacheRead: '', cacheWrite: '' })
        send(patch)
      }

      // A model id with no price beside it would create a row of dashes, and a
      // hand-entered row exists to carry a price, so the form needs both.
      const draftReady =
        draft.id.trim() !== '' && PRICE_FIELDS.some((field) => typeof readPrice(draft[field.key]) === 'number')

      const manualCard = h(
        'div',
        { className: 'tl-card' },
        h(
          'h3',
          { className: 'tl-card-title' },
          t('manualFormTitle'),
          h('span', { className: 'tl-status' }, rate === null ? t('perMillionUsd') : t('perMillionCny')),
        ),
        h(
          'div',
          { className: 'tl-manual-form' },
          h(
            'label',
            { className: 'tl-field' },
            h('span', { className: 'tl-field-label' }, t('modelId')),
            h('input', {
              className: 'tl-input',
              value: draft.id,
              placeholder: t('modelIdPlaceholder'),
              onChange: (event) => setDraft({ ...draft, id: event.target.value, invalid: false }),
            }),
          ),
          PRICE_FIELDS.map((field) =>
            h(
              'label',
              { key: field.key, className: 'tl-field' },
              h('span', { className: 'tl-field-label' }, t(field.label)),
              h('input', {
                className: 'tl-input tl-input-price',
                value: draft[field.key],
                inputMode: 'decimal',
                onChange: (event) => setDraft({ ...draft, [field.key]: event.target.value, invalid: false }),
              }),
            ),
          ),
          h(
            'button',
            { type: 'button', className: 'tl-btn tl-btn-primary', disabled: busy || draftReady === false, onClick: saveDraft },
            t('save'),
          ),
        ),
        draft.invalid === true ? h('p', { className: 'tl-error' }, t('invalidPrice')) : null,
        h('p', { className: 'tl-note' }, t('manualFormHint')),
      )

      return h(
        'div',
        { className: 'tl-root' },
        state.status === 'stale' ? h('p', { className: 'tl-note' }, t('stale')) : null,
        notice === null ? null : h('p', { className: notice.ok === true ? 'tl-note' : 'tl-error' }, notice.text),
        fxCard,
        pricesCard,
        manualCard,
        h('p', { className: 'tl-note' }, `${t('refreshNote')} · ${t('updatedAt')} ${clock(data.generatedAt)}`),
      )
    }

    const inject = ['slots', 'locale']
    /**
     * The settings section: fetch, then render the selected view.
     *
     * The fetch is the whole reason this exists separately from
     * {@link OverviewView} and {@link RatesView}. It polls rather than
     * subscribing because the host answers over a plain route, and a failed poll
     * with data already in hand degrades to `stale` instead of blanking the page.
     *
     * Prices are fetched only once the rates view is opened: the catalogue runs
     * to a couple of hundred rows, and a reader who never leaves the overview
     * should not pay for them. A write posts the patch and renders the state the
     * host answers with, so a save is one round trip and the page never shows a
     * value the host did not accept.
     *
     * @param {object} props - props injected by the registration.
     * @param {(key: string) => string} props.t - the bound translator.
     * @returns {object} the element.
     */
    function TokenLedgerSection({ t }) {
      const [range, setRange] = react.useState('month')
      const [view, setView] = react.useState('year')
      const [state, setState] = react.useState({ status: 'loading', data: null, error: null })
      const [kind, setKind] = react.useState('overview')
      const [rates, setRates] = react.useState({ status: 'idle', data: null, error: null, saving: false, notice: null })

      react.useEffect(() => {
        let cancelled = false
        const load = () => {
          fetch(ENDPOINT, { cache: 'no-store' })
            .then((response) => {
              if (!response.ok) throw new Error(`HTTP ${response.status}`)
              return response.json()
            })
            .then((data) => {
              if (!cancelled) setState({ status: 'ready', data, error: null })
            })
            .catch((error) => {
              if (cancelled) return
              setState((previous) =>
                previous.data === null
                  ? { status: 'error', data: null, error: String(error?.message ?? error) }
                  : { status: 'stale', data: previous.data, error: String(error?.message ?? error) },
              )
            })
        }
        load()
        const timer = setInterval(load, POLL_MS)
        return () => {
          cancelled = true
          clearInterval(timer)
        }
      }, [])

      react.useEffect(() => {
        if (kind !== 'rates') return undefined
        let cancelled = false
        const load = () => {
          fetch(RATES_ENDPOINT, { cache: 'no-store' })
            .then((response) => {
              if (!response.ok) throw new Error(`HTTP ${response.status}`)
              return response.json()
            })
            .then((data) => {
              if (!cancelled) setRates((previous) => ({ ...previous, status: 'ready', data, error: null }))
            })
            .catch((error) => {
              if (cancelled) return
              setRates((previous) =>
                previous.data === null
                  ? { ...previous, status: 'error', error: String(error?.message ?? error) }
                  : { ...previous, status: 'stale', error: String(error?.message ?? error) },
              )
            })
        }
        load()
        const timer = setInterval(load, POLL_MS)
        return () => {
          cancelled = true
          clearInterval(timer)
        }
      }, [kind])

      /**
       * Send hand-entered values to the host and adopt what it answers with.
       *
       * The answer carries the re-read state, so a save needs no follow-up read
       * and cannot leave the page showing a value the host rejected.
       *
       * @param {object} patch - the validated-shape patch.
       * @returns {void}
       */
      const patchRates = (patch) => {
        setRates((previous) => ({ ...previous, saving: true, notice: null }))
        fetch(RATES_ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(patch),
        })
          .then((response) => response.json().then((payload) => ({ response, payload })))
          .then(({ response, payload }) => {
            if (!response.ok || payload?.ok !== true) throw new Error(payload?.error ?? `HTTP ${response.status}`)
            setRates((previous) => ({
              status: 'ready',
              data: payload.rates ?? previous.data,
              error: null,
              saving: false,
              notice: { ok: true, text: t('saved') },
            }))
          })
          .catch((error) => {
            setRates((previous) => ({
              ...previous,
              saving: false,
              notice: { ok: false, text: `${t('saveFailed')}: ${String(error?.message ?? error)}` },
            }))
          })
      }

      return h(
        'div',
        { className: 'tl-root' },
        h(
          'div',
          { className: 'tl-row' },
          h(Tabs, {
            value: kind,
            onChange: setKind,
            options: [
              { value: 'overview', label: t('tabOverview') },
              { value: 'rates', label: t('tabRates') },
            ],
          }),
        ),
        kind === 'rates'
          ? h(RatesView, { t, state: rates, onPatch: patchRates })
          : h(OverviewView, { t, state, range, view, onRange: setRange, onView: setView }),
      )
    }

    /**
     * Register the settings section.
     *
     * Nothing in here may throw. A fault during `apply` aborts the whole mount,
     * and the section then simply never appears — a failure mode this plugin has
     * already hit twice on the host side, where a `TypeError` from one
     * registration silently took the rest of `apply` with it. `locale` is a
     * declared dependency and should always be present, but the section is
     * readable without it, so it degrades to untranslated labels instead of
     * disappearing.
     *
     * @param {object} ctx - the Cordis context for this plugin's client fiber.
     * @returns {void}
     */
    function apply(ctx) {
      const hasLocale = typeof ctx.locale?.bind === 'function'
      const t = hasLocale ? ctx.locale.bind(NS) : (key) => key
      if (hasLocale && typeof ctx.locale.register === 'function') {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-token-ledger: dictionaries')
      }
      ctx.effect(() => installStyles(), 'dsh-token-ledger: styles')

      const registration = {
        name: 'settings.section',
        id: 'token-ledger',
        order: 40,
        label: () => t('nav'),
        inject: () => ({ t }),
      }
      // DSH's own models section omits `locale` when it has no dictionary to
      // resolve against, so the field is optional and only meaningful when the
      // namespace was actually registered.
      if (hasLocale) registration.locale = NS

      ctx.slots.inject('settings.section', () => ctx.slots.register(registration, TokenLedgerSection))
    }

    exports.apply = apply
    exports.inject = inject
    // The view is exported so it can be rendered on its own. The client loader
    // only reads `apply` and `inject`, and a presentation component that can be
    // rendered without a fetch is what makes the visible half testable at all —
    // the alternative is a DOM and a browser in CI.
    exports.OverviewView = OverviewView
    exports.RatesView = RatesView
    return module.exports
  },
})
