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
    /** Where the host half serves the bill; `?by=`, `?range=` and `?format=` are read from the query. */
    const BILL_ENDPOINT = '/api/token-ledger/bill'
    /**
     * The groupings the bill stacks, top to bottom, and the periods each offers.
     *
     * A page order rather than an API list: the host serves any grouping in any
     * order, but the four below are the ones a bill is read by, and they appear in
     * the order the question is usually asked — where did this go, in which session,
     * on which model, from which vendor.
     */
    const BILL_SECTION_ORDER = ['workspace', 'session', 'model', 'vendor']
    /** The periods every section can show, which are also what the export carries. */
    const BILL_RANGE_ORDER = ['month', 'year', 'week', 'today', 'all']
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
      tabBill: '账单',
      billTitle: '费用账单',
      billSubtitle: '按当前价目估算，不是厂商账单：折扣、赠送额度、失败请求都不计入',
      billByVendor: '供应商',
      billBySubscription: '订阅',
      billByWorkspace: '工作区',
      billBySession: '会话',
      billByModel: '模型',
      rangeAll: '全部',
      rangeToday: '今日',
      estCost: '预计花费',
      estCostHint: '按当前价目与汇率估算，套餐按天摊分；这是估算，不是厂商账单',
      estCostNone: '价目未就绪',
      estCostUnpriced: '未定价',
      billCost: '实际花费',
      billUsage: '按量',
      billPlan: '套餐',
      billCoveredUsage: '其中覆盖用量',
      billPlanShare: '其中套餐摊分',
      billTotal: '合计',
      billPayAsYouGo: '按量计费（未包月）',
      billExport: '导出',
      billExportCsv: '导出 CSV',
      billExportJson: '导出 JSON',
      billExportAllCsv: '导出全部 CSV',
      billExportAllJson: '导出全部 JSON',
      billExportHint: '导出包含四个分组 × 五个时间段（本月 / 本年 / 7 天 / 今日 / 全部），每个分组各自合计；不同时间段互相重叠，因此不做跨时间段汇总',
      billCacheWrite: '缓存写入',
      billSectionEmpty: '这个时间段没有用量',
      billSectionFailed: '这一段没读到，其余不受影响',
      billUnpriced: '这些模型没有价格，未计入花费',
      unpricedBadge: '未定价',
      billJoins: '价格匹配：按名称匹配的模型（可按 ID 精确匹配的不在此列）',
      billEmpty: '这段时间没有用量',
      billEstimate: '估算依据',
      billAmount: '金额',
      billUnavailableReason: '设置面板读不到 /api/token-ledger/bill。通常是因为当前 profile 没有挂载 web 服务器，或插件刚更新还没重启。',
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
      periodPeak: '高峰',
      periodOffPeak: '空闲',
      sourceOfficial: '官方',
      officialNote: '标「官方」的厂商，价格直接取自他们自己的定价页；其余取自按厂商整理的公开数据集',
      officialPriceHint: '来自厂商自己的定价页',
      officialFailed: '有官方定价页这次没读到，该厂商暂时显示数据集价格',
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
      refreshNow: '刷新价格',
      refreshing: '刷新中…',
      refreshed: '已刷新',
      refreshFailed: '刷新失败，仍显示上次已知的价格',
      reviewTitle: '官方价格待确认',
      reviewNote: '这些模型的手填价格与官方价格不同，逐个确认要保留哪一个。',
      reviewYours: '你的',
      reviewOfficial: '官方',
      reviewAdopt: '用官方价',
      reviewKeep: '保留我的',
      reviewAdopted: '已改用官方价',
      reviewKept: '已保留你的价格',
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
      tabBill: 'Bill',
      billTitle: 'Bill',
      billSubtitle: 'Estimated from the current price list, not a provider invoice: discounts, credits and failed requests are not included',
      billByVendor: 'Vendor',
      billBySubscription: 'Plan',
      billByWorkspace: 'Workspace',
      billBySession: 'Session',
      billByModel: 'Model',
      rangeAll: 'All',
      rangeToday: 'Today',
      estCost: 'Est. cost',
      estCostHint: 'Estimated from the current price list and rate, plans amortized by day; an estimate, not a provider invoice',
      estCostNone: 'no prices yet',
      estCostUnpriced: 'unpriced',
      billCost: 'Cost',
      billUsage: 'usage',
      billPlan: 'plan',
      billCoveredUsage: 'usage covered',
      billPlanShare: 'of which plan',
      billTotal: 'Total',
      billPayAsYouGo: 'Pay as you go (no plan)',
      billExport: 'Export',
      billExportCsv: 'Export CSV',
      billExportJson: 'Export JSON',
      billExportAllCsv: 'Export all CSV',
      billExportAllJson: 'Export all JSON',
      billExportHint: 'The export carries four groupings × five periods (month / year / 7 days / today / all), each totalled on its own; the periods overlap, so nothing is summed across them',
      billCacheWrite: 'cache write input',
      billSectionEmpty: 'No usage in this period',
      billSectionFailed: 'This section could not be read; the rest are unaffected',
      billUnpriced: 'No price for these models, so they are not in the cost',
      unpricedBadge: 'unpriced',
      billJoins: 'Price matches made by name rather than by exact id',
      billEmpty: 'No usage in this period',
      billEstimate: 'Basis',
      billAmount: 'amount',
      billUnavailableReason: 'The settings panel could not read /api/token-ledger/bill. The active profile usually has no web server mounted, or the plugin was updated without a restart.',
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
      periodPeak: 'peak',
      periodOffPeak: 'off-peak',
      sourceOfficial: 'vendor',
      officialNote: 'Vendors marked "vendor" are priced from their own pricing page; the rest come from a per-vendor public dataset',
      officialPriceHint: 'from the vendor’s own pricing page',
      officialFailed: 'A vendor pricing page could not be read this time, so that vendor shows dataset prices',
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
      refreshNow: 'Refresh prices',
      refreshing: 'Refreshing…',
      refreshed: 'Refreshed',
      refreshFailed: 'Refresh failed; still showing the last known prices',
      reviewTitle: 'Official prices to review',
      reviewNote: 'These typed prices disagree with the published ones. Decide which to keep, one model at a time.',
      reviewYours: 'yours',
      reviewOfficial: 'official',
      reviewAdopt: 'Use official',
      reviewKeep: 'Keep mine',
      reviewAdopted: 'Switched to the official price',
      reviewKept: 'Kept your price',
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
/* border-box, or every width:100% input is 18px wider than its grid track — 16px
   of padding plus 2px of border on top of the declared width — and the price
   boxes in a row overlap their neighbours by 11px across a 7px gap. */
.tl-input { appearance: none; box-sizing: border-box; border: 1px solid var(--dsh-border, rgba(127,127,127,.32)); border-radius: 6px; background: var(--dsh-bg-input, rgba(127,127,127,.08)); color: inherit; font: inherit; font-size: 12px; padding: 4px 8px; min-width: 0; }
.tl-input-sm { width: 96px; }
.tl-input-price { width: 100%; text-align: right; font-variant-numeric: tabular-nums; }
.tl-input-search { width: 170px; }
.tl-badge { font-size: 10px; padding: 1px 6px; border-radius: 999px; background: rgba(154,107,214,.18); border: 1px solid rgba(154,107,214,.35); opacity: .9; white-space: nowrap; }
.tl-fx { display: flex; align-items: baseline; gap: 8px; }
.tl-fx-pair { font-size: 13px; opacity: .7; }
.tl-fx-rate { font-size: 26px; font-weight: 650; font-variant-numeric: tabular-nums; line-height: 1.1; }
.tl-fx-unit { font-size: 13px; opacity: .7; }
/* The table has a floor, so the model name can never be squeezed away: at four
   fixed price columns and a 150px action column, a narrow panel left the name
   column zero pixels wide and the table showed prices for models nobody could
   identify.
   The list used to be a 460px-tall box with its own scrollbar. It is now as tall
   as its contents and the settings panel does the scrolling, so a reader has one
   scrollbar beside the page instead of a second one nested inside it. What is left
   here is the sideways scroll, for a panel narrower than the table's floor, since
   a table that can be scrolled stays readable where one clipped at the card edge
   does not.
   The price tracks have a floor as well as a ceiling: they take the full width
   when there is room and give way before the table has to scroll. The name column
   is the flexible one, and a name too long for it truncates with its id kept in a
   tooltip.
   150 name + 4 x 60 (up to 72) + 84 actions + 5 gaps of 6 = 504. */
.tl-rates-list { display: flex; flex-direction: column; gap: 12px; overflow: auto; }
.tl-rate-table { min-width: 504px; display: flex; flex-direction: column; }
.tl-vendor { display: flex; flex-direction: column; gap: 2px; }
.tl-vendor-head { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 650; padding: 2px 0; }
.tl-vendor-count { font-size: 10px; font-weight: 400; opacity: .55; }
.tl-rate-head, .tl-rate-row { display: grid; grid-template-columns: minmax(150px, 1fr) repeat(4, minmax(60px, 72px)) 84px; align-items: center; gap: 6px; font-size: 12px; }
.tl-rate-head { font-size: 10px; opacity: .5; }
.tl-rate-head > span { text-align: right; }
.tl-rate-head > span:first-child { text-align: left; }
.tl-rate-row { padding: 1px 0; }
/* The name and its badges share the first column; the name gives way first, so a
   long id truncates instead of pushing the badge out of the cell. */
.tl-rate-model { display: flex; align-items: center; gap: 5px; min-width: 0; }
.tl-rate-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: .9; min-width: 0; }
.tl-rate-price { text-align: right; font-variant-numeric: tabular-nums; opacity: .85; }
.tl-rate-actions { display: flex; align-items: center; justify-content: flex-end; gap: 5px; }
.tl-rate-row[data-manual='true'] .tl-rate-name { font-style: italic; }
.tl-btn-sm { font-size: 11px; padding: 2px 7px; }
.tl-logo svg { display: block; width: 100%; height: 100%; }
.tl-logo svg { display: block; width: 100%; height: 100%; }
.tl-logo svg { display: block; width: 100%; height: 100%; }
.tl-logo svg { display: block; width: 100%; height: 100%; }
.tl-logo { flex: 0 0 auto; width: 18px; height: 18px; border-radius: 5px; display: inline-flex; align-items: center; justify-content: center; /* A white tile, because several of these marks are black and the panel may be dark: the mark decides its own colour, the tile guarantees it can be seen. */ background: #fff; border: 1px solid rgba(127,127,127,.28); overflow: hidden; }
.tl-logo-text { font-size: 9px; font-weight: 700; color: #fff; border: 0; }
/* nowrap, so the flex row cannot squeeze the pill until its label wraps onto two
   lines — the name is the item that gives way, and the 5px gap separates them. */
.tl-period { font-size: 10px; padding: 0 5px; border-radius: 999px; border: 1px solid rgba(127,127,127,.35); opacity: .75; white-space: nowrap; }
.tl-rate-row[data-period='offPeak'] .tl-period { border-color: rgba(47,168,106,.5); color: #2fa86a; }
/* The manual form wraps onto two rows instead of running off the card. Laid out
   as one row it needed 150 + 4 x 88 + the save button + five gaps — around
   600px — and the settings panel is often narrower, which pushed the save button
   past the card edge. So the model id takes a row of its own, and the four
   prices sit in equal tracks beneath it with the button placed after them by
   document order. The tracks have a zero minimum, so the form cannot overflow
   again: the inputs shrink instead. */
.tl-manual-form { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)) auto; align-items: end; gap: 8px; }
.tl-manual-id { grid-row: 1; grid-column: 1 / -1; }
.tl-manual-form .tl-field > .tl-input { width: 80%; }
.tl-field { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.tl-field-label { font-size: 10px; opacity: .6; }
/* The bill. A money column is read by comparing numbers down it, so the figures are
   tabular and the columns have fixed widths rather than being sized by content.
   Seven columns: the group, calls, the two halves of the input (cache hits and
   misses), output, the hit rate and the cost. */
.tl-bill-scroll { overflow: auto; }
.tl-bill-table { min-width: 700px; display: flex; flex-direction: column; }
.tl-bill-head, .tl-bill-row, .tl-bill-total { display: grid; grid-template-columns: minmax(150px, 1fr) 64px 96px 88px 88px 76px 104px; align-items: center; gap: 8px; font-size: 12px; }
.tl-bill-head { font-size: 10px; opacity: .5; }
.tl-bill-head > span { text-align: right; }
.tl-bill-head > span:first-child { text-align: left; }
.tl-bill-row { padding: 3px 0; border-bottom: 1px solid rgba(127,127,127,.12); }
.tl-bill-row > span:not(.tl-bill-cell-name) { text-align: right; font-variant-numeric: tabular-nums; opacity: .85; }
.tl-bill-cell-name { display: flex; align-items: center; gap: 6px; min-width: 0; }
.tl-bill-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tl-bill-total { padding: 7px 0 0; font-weight: 650; border-top: 1px solid rgba(127,127,127,.3); }
.tl-bill-total > span:not(.tl-bill-cell-name) { text-align: right; font-variant-numeric: tabular-nums; }
.tl-bill-actions { display: flex; align-items: center; gap: 6px; }
.tl-bill-cost { display: flex; flex-direction: column; align-items: flex-end; gap: 1px; }
.tl-bill-sub { font-size: 10px; font-style: normal; font-weight: 400; opacity: .6; white-space: nowrap; }
.tl-bill-note-list { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0; list-style: none; }
/* One block per model, because the answer is per model: the fields that
   disagree, side by side, and the two buttons that settle them. The field list
   wraps instead of scrolling sideways, so a model with all four prices typed
   differently still fits the panel. */
.tl-review-list { display: flex; flex-direction: column; gap: 10px; }
.tl-review-row { display: flex; flex-direction: column; gap: 6px; border: 1px solid var(--dsh-border, rgba(127,127,127,.24)); border-radius: 8px; padding: 8px 10px; }
.tl-review-model { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 12px; }
.tl-review-fields { display: flex; flex-wrap: wrap; gap: 4px 14px; }
.tl-review-field { display: flex; align-items: center; gap: 5px; font-size: 11px; font-variant-numeric: tabular-nums; }
/* The typed number is struck through rather than merely greyed: the line reads
   as a replacement, and the struck value is the one that would be given up. */
.tl-review-mine { opacity: .65; text-decoration: line-through; }
.tl-review-arrow { opacity: .4; }
.tl-review-official { font-weight: 600; }
.tl-review-actions { display: flex; justify-content: flex-end; gap: 6px; }
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
     * Format an amount as money, in the currency the payload named.
     *
     * Two decimals, which is what a bill is read at. The symbol follows the bill's
     * own currency rather than the browser's locale: a host that could not convert
     * its dollars reports a bill in dollars, and printing ¥ over it would be a lie
     * with a plausible shape.
     *
     * @param {unknown} value - the amount.
     * @param {unknown} currency - `'USD'` or `'CNY'`.
     * @returns {string} the formatted amount, or a dash when unusable.
     */
    function money(value, currency) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      return `${currency === 'USD' ? '$' : '¥'}${value.toFixed(2)}`
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
     * @param {string} props.label - the metric's name.
     * @param {unknown} props.value - the formatted value.
     * @param {string} [props.sub] - a second line under the label.
     * @param {boolean} [props.small] - whether the value is money or text rather than a big count.
     * @returns {object} the element.
     */
    function Metric({ label, value, sub, small, title }) {
      return h(
        'div',
        { className: 'tl-metric', title: title ?? null },
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
      // What the period cost, priced by the host from the same prices the bill uses.
      // A payload that carries no cost at all (an older host, or a profile whose
      // prices were never fetched) says so rather than showing a confident zero.
      const cost = data.cost ?? { priced: false, currency: null, rate: null, byRange: null }
      const costCell = (period) => {
        if (cost.priced !== true) return { value: '—', sub: t('estCostNone') }
        const entry = cost.byRange?.[period]
        if (entry === undefined || entry === null) return { value: '—', sub: t('estCostNone') }
        const unpriced = (entry.unpricedTokens ?? 0) > 0 ? `${t('estCostUnpriced')} ${compact(entry.unpricedTokens)}` : null
        return { value: money(entry.cost, cost.currency), sub: unpriced }
      }
      const rangeCost = costCell(range)
      const todayCost = costCell('today')
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
            h(Metric, {
              label: t('estCost'),
              value: rangeCost.value,
              sub: rangeCost.sub ?? cost.currency,
              small: true,
              title: t('estCostHint'),
            }),
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
                  h(Metric, { label: t('estCost'), value: todayCost.value, sub: todayCost.sub ?? cost.currency, small: true, title: t('estCostHint') }),
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
     * A price cell: the value to show and the symbol it is quoted in.
     *
     * The conversion is display only, and only for a price quoted in something other
     * than the display currency: DeepSeek and Tencent publish in yuan, so their
     * numbers are already what the table shows and are passed through untouched.
     * Nothing here multiplies a token count by a price.
     *
     * @param {unknown} value - the price per 1M tokens, in `currency`.
     * @param {number|null} rate - USD → display currency, or null when there is no rate.
     * @param {'USD'|'CNY'} currency - the currency the vendor published in.
     * @returns {{ value: number, symbol: string }|null} the cell, or null when there is no price.
     */
    function priceCell(value, rate, currency) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return null
      if (currency === 'CNY') return { value, symbol: '¥' }
      return { value: rate === null ? value : value * rate, symbol: rate === null ? '$' : '¥' }
    }

    /**
     * The decimals a number is written with, up to six.
     *
     * @param {number} value - the number.
     * @returns {number} how many decimals it takes to write it exactly.
     */
    function exactDecimals(value) {
      for (let digits = 0; digits <= 6; digits += 1) {
        if (Math.abs(Number(value.toFixed(digits)) - value) < 1e-9) return digits
      }
      return 6
    }

    /**
     * The precision every cell in one column shares.
     *
     * A column is read down, not across, so `0.04 / 0.02 / 0.3 / 0.15` reads as four
     * different measurements when it is one scale. The column's own numbers decide:
     *
     * - a price the vendor published in the display currency is shown as published,
     *   so the column takes the widest of those (`0.30` beside `0.04`);
     * - a converted price is shown in cents, which is a unit a person reads, and the
     *   column takes as many decimals as its *smallest* price needs to keep two
     *   significant digits — so a column holding a fraction of a cent does not round
     *   it to `¥0.00`, which would claim it is free, while a column of ordinary
     *   prices stays at cents instead of inheriting six decimals from one tiny cell.
     *
     * @param {object[]} models - the rows in the group.
     * @param {string} field - the price field.
     * @param {number|null} rate - USD → display currency, or null when there is no rate.
     * @param {'USD'|'CNY'} currency - the currency the vendor published in.
     * @returns {number} the decimals for that column.
     */
    function columnDigits(models, field, rate, currency) {
      const values = []
      for (const model of models) {
        const cell = priceCell(model?.prices?.[field], rate, currency)
        if (cell !== null) values.push(cell.value)
      }
      if (values.length === 0) return 0
      if (currency === 'CNY') return Math.max(...values.map((value) => exactDecimals(value)))
      const smallest = Math.min(...values.filter((value) => value > 0))
      if (!Number.isFinite(smallest)) return 0
      // Two significant digits at the small end, never fewer than cents, never more
      // than the six decimals a vendor's own precision supports.
      return Math.min(6, Math.max(2, 1 - Math.floor(Math.log10(smallest))))
    }

    /**
     * Format a price at the precision its column agreed on.
     *
     * Trailing zeros are kept rather than trimmed: `0.30` beside `0.04` is a price
     * list, and `0.3` beside `0.04` looks like a different measurement.
     *
     * @param {unknown} value - the price per 1M tokens, in `currency`.
     * @param {number|null} rate - USD → display currency, or null when there is no rate.
     * @param {'USD'|'CNY'} currency - the currency the vendor published in.
     * @param {number} digits - the column's precision.
     * @returns {string} the formatted price, or a dash when there is none.
     */
    function price(value, rate, currency, digits) {
      const cell = priceCell(value, rate, currency)
      if (cell === null) return '—'
      return `${cell.symbol}${cell.value.toFixed(digits === undefined ? 2 : digits)}`
    }

    /**
     * The vendor's own quote in dollars, written as the vendor wrote it.
     *
     * Deliberately not padded to the column's width: a tooltip is one number, not a
     * column, and `$0.1500` would be a worse answer than `$0.15` to the question
     * "what did they quote?".
     *
     * @param {unknown} value - USD per 1M tokens.
     * @returns {string} the quote, or a dash when there is none.
     */
    function publishedQuote(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      return `$${value.toFixed(exactDecimals(value))}`
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
     * Each vendor's own mark, as inline SVG geometry.
     *
     * Bundled rather than fetched: a page whose whole point is that it works
     * offline cannot pull a logo from a CDN, and a missing image would leave the
     * leading column looking broken. The geometry came from the vendors' own sites
     * where they publish an SVG mark, and otherwise from Simple Icons, which
     * carries the official marks as plain files — no mark here was drawn by hand.
     *
     * These are the trademarks of their owners, used to identify whose price is
     * being shown.
     */
    const VENDOR_LOGOS = {
      // https://openai.com/favicon.svg
      'openai': { viewBox: '0 0 180 180', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" fill="#0f0f0f" aria-hidden="true"><g clip-path="url(#tl-openai-a)"><rect width="180" height="180" fill="#fff" rx="90" /><g clip-path="url(#tl-openai-b)"><path fill="#000" d="M75.91 73.628V62.232c0-.96.36-1.68 1.199-2.16l22.912-13.194c3.119-1.8 6.838-2.639 10.676-2.639 14.394 0 23.511 11.157 23.511 23.032 0 .839 0 1.799-.12 2.758l-23.752-13.914c-1.439-.84-2.879-.84-4.318 0L75.91 73.627Zm53.499 44.383v-27.23c0-1.68-.72-2.88-2.159-3.719L97.142 69.55l9.836-5.638c.839-.48 1.559-.48 2.399 0l22.912 13.195c6.598 3.839 11.035 11.995 11.035 19.912 0 9.116-5.397 17.513-13.915 20.992v.001Zm-60.577-23.99-9.836-5.758c-.84-.48-1.2-1.2-1.2-2.16v-26.39c0-12.834 9.837-22.55 23.152-22.55 5.039 0 9.716 1.679 13.676 4.678L70.993 55.516c-1.44.84-2.16 2.039-2.16 3.719v34.787-.002Zm21.173 12.234L75.91 98.339V81.546l14.095-7.917 14.094 7.917v16.793l-14.094 7.916Zm9.056 36.467c-5.038 0-9.716-1.68-13.675-4.678l23.631-13.676c1.439-.839 2.159-2.038 2.159-3.718V85.863l9.956 5.757c.84.48 1.2 1.2 1.2 2.16v26.389c0 12.835-9.957 22.552-23.27 22.552v.001Zm-28.43-26.75L47.72 102.778c-6.599-3.84-11.036-11.996-11.036-19.913 0-9.236 5.518-17.513 14.034-20.992v27.35c0 1.68.72 2.879 2.16 3.718l29.989 17.393-9.837 5.638c-.84.48-1.56.48-2.399 0Zm-1.318 19.673c-13.555 0-23.512-10.196-23.512-22.792 0-.959.12-1.919.24-2.879l23.63 13.675c1.44.84 2.88.84 4.32 0l30.108-17.392v11.395c0 .96-.361 1.68-1.2 2.16l-22.912 13.194c-3.119 1.8-6.837 2.639-10.675 2.639Zm29.748 14.274c14.515 0 26.63-10.316 29.39-23.991 13.434-3.479 22.071-16.074 22.071-28.91 0-8.396-3.598-16.553-10.076-22.43.6-2.52.96-5.039.96-7.557 0-17.153-13.915-29.99-29.989-29.99-3.239 0-6.358.48-9.477 1.56-5.398-5.278-12.835-8.637-20.992-8.637-14.515 0-26.63 10.316-29.39 23.991-13.434 3.48-22.07 16.074-22.07 28.91 0 8.396 3.598 16.553 10.075 22.431-.6 2.519-.96 5.038-.96 7.556 0 17.154 13.915 29.989 29.99 29.989 3.238 0 6.357-.479 9.476-1.559 5.397 5.278 12.835 8.637 20.992 8.637Z" /></g></g><defs><clipPath id="tl-openai-a"><path d="M0 0h180v180H0z" /></clipPath><clipPath id="tl-openai-b"><path d="M29.487 29.964h121.035v119.954H29.487z" /></clipPath></defs></svg>' },
      // https://cdn.simpleicons.org/anthropic
      'anthropic': { viewBox: '0 0 24 24', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" fill="#191919" aria-hidden="true"><title>Anthropic</title><path d="M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z"/></svg>' },
      // https://www.gstatic.com/lamda/images/gemini_sparkle_v002_d4735304ff6292a690345.svg
      'google': { viewBox: '0 0 28 28', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" fill="#4285F4" aria-hidden="true"><path d="M14 28C14 26.0633 13.6267 24.2433 12.88 22.54C12.1567 20.8367 11.165 19.355 9.905 18.095C8.645 16.835 7.16333 15.8433 5.46 15.12C3.75667 14.3733 1.93667 14 0 14C1.93667 14 3.75667 13.6383 5.46 12.915C7.16333 12.1683 8.645 11.165 9.905 9.905C11.165 8.645 12.1567 7.16333 12.88 5.46C13.6267 3.75667 14 1.93667 14 0C14 1.93667 14.3617 3.75667 15.085 5.46C15.8317 7.16333 16.835 8.645 18.095 9.905C19.355 11.165 20.8367 12.1683 22.54 12.915C24.2433 13.6383 26.0633 14 28 14C26.0633 14 24.2433 14.3733 22.54 15.12C20.8367 15.8433 19.355 16.835 18.095 18.095C16.835 19.355 15.8317 20.8367 15.085 22.54C14.3617 24.2433 14 26.0633 14 28Z" fill="url(#tl-google-paint0_radial_16771_53212)"/><defs><radialGradient id="tl-google-paint0_radial_16771_53212" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(2.77876 11.3795) rotate(18.6832) scale(29.8025 238.737)"><stop offset="0.0671246" stop-color="#9168C0"/><stop offset="0.342551" stop-color="#5684D1"/><stop offset="0.672076" stop-color="#1BA1E3"/></radialGradient></defs></svg>' },
      // https://cdn.simpleicons.org/deepseek
      'deepseek': { viewBox: '0 0 24 24', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" fill="#5786FE" aria-hidden="true"><title>DeepSeek</title><path d="M23.748 4.651c-.254-.124-.364.113-.512.233-.051.04-.094.09-.137.137-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.155-.708-.311-.955-.65-.172-.24-.219-.509-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.094.172.187.129.323-.082.28-.18.553-.266.833-.055.179-.137.218-.328.14a5.5 5.5 0 0 1-1.737-1.179c-.857-.828-1.631-1.743-2.597-2.46a12 12 0 0 0-.689-.47c-.985-.957.13-1.743.387-1.836.27-.098.094-.433-.778-.428-.872.003-1.67.295-2.687.685a3 3 0 0 1-.465.136 9.6 9.6 0 0 0-2.883-.101c-1.885.21-3.39 1.1-4.497 2.622C.082 8.776-.231 10.854.152 13.02c.403 2.284 1.568 4.175 3.36 5.653 1.857 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.132-.284 4.994-1.86.47.234.962.328 1.78.398.629.058 1.235-.031 1.705-.129.735-.155.684-.836.418-.961-2.155-1.004-1.682-.595-2.112-.926 1.095-1.295 2.768-3.598 3.284-6.733.05-.346.115-.834.108-1.114-.004-.171.035-.238.23-.257a4.2 4.2 0 0 0 1.545-.475c1.397-.763 1.96-2.016 2.093-3.517.02-.23-.004-.467-.247-.588M11.58 18.168c-2.088-1.642-3.101-2.183-3.52-2.16-.39.024-.32.472-.234.763.09.288.207.487.371.74.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.168-1.361-.801-2.5-1.86-3.301-3.306-.775-1.393-1.225-2.888-1.299-4.482-.02-.385.094-.522.477-.592a4.7 4.7 0 0 1 1.53-.038c2.131.311 3.946 1.264 5.467 2.774.868.86 1.525 1.887 2.202 2.89.72 1.066 1.494 2.082 2.48 2.915.348.291.626.513.892.677-.802.09-2.14.109-3.055-.615zm1.001-6.44a.306.306 0 0 1 .415-.287.3.3 0 0 1 .113.074.3.3 0 0 1 .086.214c0 .17-.136.307-.308.307a.303.303 0 0 1-.306-.307m3.11 1.596c-.2.081-.4.151-.591.16a1.25 1.25 0 0 1-.798-.254c-.274-.23-.47-.358-.551-.758a1.7 1.7 0 0 1 .015-.588c.07-.327-.007-.537-.238-.727-.188-.156-.426-.199-.689-.199a.6.6 0 0 1-.254-.078.253.253 0 0 1-.114-.358 1 1 0 0 1 .192-.21c.356-.202.767-.136 1.146.016.352.144.618.408 1.001.782.392.451.462.576.685.915.176.264.336.536.446.848.066.194-.02.353-.25.45"/></svg>' },
      // https://cdn.simpleicons.org/qwen
      'qwen': { viewBox: '0 0 24 24', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" fill="#6950EF" aria-hidden="true"><title>QWen</title><path d="M23.919 14.545 20.817 9.17l1.47-2.544a.56.56 0 0 0 0-.566l-1.633-2.83a.57.57 0 0 0-.49-.283h-6.207L12.487.402a.57.57 0 0 0-.49-.284H8.732a.56.56 0 0 0-.49.284L5.139 5.775h-2.94a.56.56 0 0 0-.49.284L.077 8.887a.56.56 0 0 0 0 .567L3.18 14.83l-1.47 2.545a.56.56 0 0 0 0 .566l1.634 2.83a.57.57 0 0 0 .49.283h6.205l1.47 2.545a.57.57 0 0 0 .49.284h3.266a.57.57 0 0 0 .49-.284l3.104-5.375h2.94a.57.57 0 0 0 .49-.283l1.634-2.828a.55.55 0 0 0-.004-.568M8.733.686l1.634 2.828-1.634 2.828H21.8L20.164 9.17H7.425L5.63 6.06Zm1.306 19.801-6.205-.002 1.634-2.83h3.265L2.201 6.344h3.267q3.182 5.517 6.367 11.032zm10.124-5.66L18.53 12l-6.532 11.315-1.634-2.83c2.129-3.673 4.25-7.351 6.373-11.028h3.592l3.102 5.374z"/></svg>' },
      // https://cdn.simpleicons.org/x
      'x-ai': { viewBox: '0 0 24 24', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" fill="#000000" aria-hidden="true"><title>X</title><path d="M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z"/></svg>' },
      // https://mintcdn.com/zhipu-32152247/B_E8wI-eiNa1QlPV/logo/light.svg
      'z-ai': { viewBox: '0 0 160 160', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" fill="#0f0f0f" aria-hidden="true"><g clip-path="url(#tl-z-ai-clip0_3_25)"><path d="M22.6191 1.66699H137.381C148.952 1.66699 158.333 11.0475 158.333 22.6191V137.381C158.333 148.952 148.952 158.333 137.381 158.333H22.6191C11.0475 158.333 1.66699 148.952 1.66699 137.381V22.6191C1.66699 11.0475 11.0475 1.66699 22.6191 1.66699Z" fill="black" stroke="#B7BCBF" stroke-width="3.33333"/><path d="M82.771 33.208L75.0661 44.157C74.4609 45.0175 73.6581 45.7202 72.7251 46.2063C71.7922 46.6924 70.7562 46.9476 69.7043 46.9506H27.7104V33.1629L82.771 33.208Z" fill="white"/><path d="M135.083 33.2075L68.9835 126.837H24.917L91.0167 33.2075H135.083Z" fill="white"/><path d="M77.2741 126.837L85.024 115.843C85.6316 114.988 86.4359 114.292 87.3692 113.814C88.3025 113.336 89.3372 113.089 90.3859 113.095H132.335V126.612L77.2741 126.837Z" fill="white"/></g><defs><clipPath id="tl-z-ai-clip0_3_25"><rect width="160" height="160" fill="white"/></clipPath></defs></svg>' },
      // https://cdn.simpleicons.org/kimi
      'kimi': { viewBox: '0 0 24 24', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" fill="#000000" aria-hidden="true"><title>KIMI</title><path d="M21.765.351C22.998.351 24 1.353 24 2.586S22.998 4.82 21.765 4.82h-1.974c-.15 0-.26-.12-.26-.26V2.586A2.237 2.237 0 0 1 21.765.35M9.41 13.388l8.447-8.377c.16-.16.07-.471-.14-.471h-4.55s-.1.02-.14.06l-9.099 9.029c-.14.14-.35.02-.35-.21V4.81c0-.15-.1-.27-.221-.27H.22c-.12 0-.22.12-.22.27v18.57c0 .15.1.27.22.27h3.137c.12 0 .22-.12.22-.27v-3.79c0-.08.03-.16.08-.21l2.826-2.796c.07-.07.16-.08.241-.03l7.546 5.551a8.9 8.9 0 0 0 4.018 1.493c.12.01.23-.11.23-.27V19.76c0-.14-.08-.25-.19-.26a5.8 5.8 0 0 1-2.355-.942l-6.533-4.73c-.14-.09-.15-.32-.03-.441"/></svg>' },
      // https://cdn.simpleicons.org/minimax
      'minimax': { viewBox: '0 0 24 24', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" fill="#E73562" aria-hidden="true"><title>MiniMax</title><path d="M11.43 3.92a.86.86 0 1 0-1.718 0v14.236a1.999 1.999 0 0 1-3.997 0V9.022a.86.86 0 1 0-1.718 0v3.87a1.999 1.999 0 0 1-3.997 0V11.49a.57.57 0 0 1 1.139 0v1.404a.86.86 0 0 0 1.719 0V9.022a1.999 1.999 0 0 1 3.997 0v9.134a.86.86 0 0 0 1.719 0V3.92a1.998 1.998 0 1 1 3.996 0v11.788a.57.57 0 1 1-1.139 0zm10.572 3.105a2 2 0 0 0-1.999 1.997v7.63a.86.86 0 0 1-1.718 0V3.923a1.999 1.999 0 0 0-3.997 0v16.16a.86.86 0 0 1-1.719 0V18.08a.57.57 0 1 0-1.138 0v2a1.998 1.998 0 0 0 3.996 0V3.92a.86.86 0 0 1 1.719 0v12.73a1.999 1.999 0 0 0 3.996 0V9.023a.86.86 0 1 1 1.72 0v6.686a.57.57 0 0 0 1.138 0V9.022a2 2 0 0 0-1.998-1.997"/></svg>' },
      // https://www.tencent.com/wp-content/themes/tencent-web/assets/favicon/safari-pinned-tab.svg
      'tencent': { viewBox: '0 0 848.000000 848.000000', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 848.000000 848.000000" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><metadata> Created by potrace 1.14, written by Peter Selinger 2001-2017 </metadata><g transform="translate(0.000000,848.000000) scale(0.100000,-0.100000)" fill="#0052d9" stroke="none"><path d="M4009 8475 c-5 -21 -7 -25 -9 -27 -1 -2 -3 -12 -4 -23 -2 -11 -6 -38 -10 -60 -4 -22 -9 -51 -11 -65 -2 -14 -15 -89 -29 -166 -15 -78 -29 -157 -31 -175 -7 -44 -19 -112 -39 -219 -3 -14 -7 -41 -10 -60 -7 -40 -13 -75 -26 -145 -5 -27 -12 -66 -15 -85 -4 -19 -8 -42 -9 -50 -2 -8 -6 -37 -11 -65 -9 -59 -12 -74 -24 -140 -6 -27 -12 -66 -15 -86 -3 -20 -8 -42 -10 -50 -5 -13 -12 -58 -21 -124 -3 -16 -8 -43 -11 -60 -4 -16 -8 -41 -10 -55 -1 -14 -10 -63 -19 -110 -9 -47 -17 -94 -19 -106 -2 -11 -5 -25 -9 -30 -3 -5 -670 -9 -1626 -8 -1048 0 -1621 -3 -1621 -10 0 -5 6 -17 13 -25 8 -9 35 -46 60 -83 26 -38 67 -96 91 -130 24 -35 63 -92 87 -128 24 -36 47 -67 50 -70 3 -3 25 -34 49 -70 24 -36 47 -66 52 -68 4 -2 8 -10 8 -18 0 -8 3 -14 8 -14 4 0 12 -9 17 -19 10 -21 231 -338 247 -356 6 -6 425 -10 1193 -10 651 0 1187 -3 1191 -7 3 -4 1 -36 -6 -70 -6 -35 -14 -72 -16 -83 -2 -11 -7 -40 -10 -65 -3 -25 -8 -47 -9 -50 -2 -3 -6 -24 -9 -46 -4 -22 -9 -51 -11 -64 -3 -14 -8 -41 -11 -60 -9 -58 -18 -112 -31 -175 -2 -11 -6 -36 -9 -55 -2 -19 -9 -57 -15 -85 -13 -68 -15 -83 -24 -135 -4 -25 -9 -54 -12 -65 -2 -11 -5 -29 -7 -40 -2 -11 -6 -33 -9 -50 -3 -16 -9 -46 -11 -65 -7 -41 -13 -75 -26 -145 -11 -58 -13 -68 -40 -230 -26 -152 -27 -155 -34 -185 -3 -14 -8 -41 -11 -60 -2 -19 -14 -87 -26 -150 -11 -63 -22 -126 -24 -140 -2 -14 -6 -38 -10 -55 -11 -58 -15 -80 -21 -125 -3 -24 -7 -47 -10 -51 -2 -4 -6 -24 -9 -45 -3 -22 -8 -50 -10 -64 -3 -14 -7 -38 -10 -55 -2 -16 -9 -52 -15 -80 -5 -27 -12 -66 -15 -85 -2 -19 -7 -46 -10 -60 -3 -14 -8 -43 -10 -64 -3 -21 -7 -42 -9 -45 -2 -3 -7 -31 -11 -61 -4 -30 -9 -58 -11 -61 -2 -3 -6 -24 -9 -45 -2 -21 -7 -50 -10 -64 -3 -14 -8 -41 -11 -60 -8 -55 -12 -73 -18 -100 -3 -14 -8 -43 -11 -65 -3 -22 -8 -49 -11 -59 -4 -10 -8 -35 -9 -55 -2 -20 -4 -36 -5 -36 -3 0 -10 -39 -16 -90 -3 -27 -10 -55 -15 -61 -5 -6 -6 -13 -4 -16 3 -3 1 -25 -4 -49 -5 -24 -12 -60 -15 -79 -3 -19 -7 -44 -10 -55 -2 -11 -7 -40 -12 -65 -4 -25 -8 -47 -9 -50 0 -3 -4 -27 -9 -53 -4 -27 -9 -59 -12 -70 -2 -12 -7 -35 -9 -52 -3 -16 -11 -57 -17 -90 -6 -33 -12 -69 -13 -81 -2 -11 -8 -45 -14 -75 -6 -30 -13 -70 -15 -89 -3 -19 -10 -60 -16 -90 -6 -30 -13 -73 -16 -95 -3 -22 -8 -47 -11 -55 -5 -16 -11 -46 -17 -100 -3 -19 -5 -35 -6 -35 -2 0 -7 -25 -14 -72 -6 -41 -11 -71 -26 -148 -15 -77 -20 -107 -25 -149 -3 -22 -10 -58 -15 -80 -5 -23 -12 -63 -16 -91 -3 -27 -8 -53 -10 -56 -2 -4 -6 -24 -9 -46 -2 -21 -9 -63 -15 -93 -6 -30 -13 -70 -16 -87 l-5 -33 789 0 c624 0 789 3 790 13 1 19 22 139 57 332 8 44 17 96 20 115 3 19 13 73 21 120 9 47 18 95 20 108 2 12 6 34 9 50 3 15 8 43 11 62 2 19 7 46 10 60 2 14 7 39 9 55 3 17 10 53 15 80 5 28 12 66 15 85 3 19 10 58 15 85 5 28 12 66 15 85 3 19 8 42 10 50 3 8 7 31 9 50 6 43 21 130 31 180 3 14 8 39 10 55 13 74 25 142 30 165 3 14 7 41 10 60 3 19 7 46 10 60 3 14 8 41 11 60 3 19 7 46 10 60 3 14 7 36 9 50 1 14 4 25 5 25 2 0 8 31 14 80 3 22 9 53 12 70 4 16 8 37 9 45 6 41 16 107 20 120 2 8 7 31 10 50 3 19 7 46 10 60 3 14 7 39 10 55 3 17 7 41 10 55 3 14 7 39 10 55 2 17 6 40 9 51 2 12 7 39 10 60 4 22 8 46 11 54 2 8 6 37 10 64 3 27 8 52 10 55 1 3 6 24 9 46 7 42 16 96 23 130 2 11 6 35 9 54 3 18 8 43 10 55 3 11 7 34 9 49 2 16 14 81 25 145 12 64 23 126 25 137 2 11 6 38 10 60 4 22 9 50 11 63 2 12 6 32 8 45 2 12 7 38 10 57 4 19 16 87 27 150 12 63 23 124 24 135 1 11 3 20 4 20 1 0 4 14 6 30 1 17 17 107 33 200 17 94 33 184 36 200 3 17 8 39 10 50 2 11 7 40 11 65 4 25 9 54 11 65 3 11 7 35 10 54 3 18 8 43 10 55 2 11 13 73 24 136 11 63 22 126 25 140 3 14 7 39 10 55 2 17 8 52 14 80 5 27 7 53 5 57 -3 5 -1 8 3 8 5 0 9 10 9 23 1 25 12 94 19 117 3 8 7 31 9 50 7 47 14 78 20 88 2 4 675 7 1495 7 1186 0 1491 3 1491 13 0 6 -5 12 -10 12 -6 0 -16 5 -23 10 -41 35 -148 110 -156 110 -5 0 -11 4 -13 8 -1 4 -25 23 -53 42 -27 19 -56 40 -63 47 -7 7 -26 20 -42 30 -17 9 -30 21 -30 25 0 4 -7 8 -15 8 -9 0 -18 7 -21 15 -4 8 -10 15 -15 15 -8 0 -132 86 -194 134 -11 9 -63 46 -115 82 -52 37 -97 69 -100 73 -3 3 -43 32 -90 64 -47 33 -108 75 -136 95 -341 246 -428 308 -442 317 -9 6 -25 18 -36 28 -11 9 -23 17 -27 17 -4 0 -14 6 -21 13 -13 13 -166 124 -196 142 -10 6 -19 12 -22 15 -3 3 -39 30 -80 60 -41 29 -76 57 -78 62 -2 4 -8 8 -14 8 -5 0 -77 48 -158 108 -175 126 -282 202 -359 256 -31 21 -57 43 -59 47 -2 5 -8 9 -13 9 -6 0 -15 5 -22 10 -22 19 -290 211 -310 223 -11 7 -27 18 -36 26 -9 7 -72 53 -141 102 -69 49 -132 95 -141 102 -8 6 -51 36 -95 66 -43 30 -81 58 -84 61 -3 4 -32 25 -65 48 -127 88 -180 125 -185 132 -3 3 -12 10 -20 13 -8 4 -35 23 -60 41 -25 19 -83 62 -130 95 -47 33 -106 76 -132 96 -27 19 -49 33 -49 30z"/></g></svg>' },
      // https://cdn.simpleicons.org/xiaomi
      'xiaomi': { viewBox: '0 0 24 24', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" fill="#FF6900" aria-hidden="true"><title>Xiaomi</title><path d="M12 0C8.016 0 4.756.255 2.493 2.516.23 4.776 0 8.033 0 12.012c0 3.98.23 7.235 2.494 9.497C4.757 23.77 8.017 24 12 24c3.983 0 7.243-.23 9.506-2.491C23.77 19.247 24 15.99 24 12.012c0-3.984-.233-7.243-2.502-9.504C19.234.252 15.978 0 12 0zM4.906 7.405h5.624c1.47 0 3.007.068 3.764.827.746.746.827 2.233.83 3.676v4.54a.15.15 0 0 1-.152.147h-1.947a.15.15 0 0 1-.152-.148V11.83c-.002-.806-.048-1.634-.464-2.051-.358-.36-1.026-.441-1.72-.458H7.158a.15.15 0 0 0-.151.147v6.98a.15.15 0 0 1-.152.148H4.906a.15.15 0 0 1-.15-.148V7.554a.15.15 0 0 1 .15-.149zm12.131 0h1.949a.15.15 0 0 1 .15.15v8.892a.15.15 0 0 1-.15.148h-1.949a.15.15 0 0 1-.151-.148V7.554a.15.15 0 0 1 .151-.149zM8.92 10.948h2.046c.083 0 .15.066.15.147v5.352a.15.15 0 0 1-.15.148H8.92a.15.15 0 0 1-.152-.148v-5.352a.15.15 0 0 1 .152-.147Z"/></svg>' },
      // https://cdn.simpleicons.org/bytedance
      'bytedance': { viewBox: '0 0 24 24', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" fill="#3C8CFF" aria-hidden="true"><title>ByteDance</title><path d="M19.8772 1.4685L24 2.5326v18.9426l-4.1228 1.0563V1.4685zm-13.3481 9.428l4.115 1.0641v8.9786l-4.115 1.0642v-11.107zM0 2.572l4.115 1.0642v16.7354L0 21.428V2.572zm17.4553 5.6205v11.107l-4.1228-1.0642V9.2568l4.1228-1.0642z"/></svg>' },
    }

    /** Vendors' own spellings, so the page does not read like a source key. */
    const VENDOR_NAMES = {
      openai: 'OpenAI',
      anthropic: 'Anthropic',
      google: 'Google',
      deepseek: 'DeepSeek',
      qwen: 'Qwen',
      'x-ai': 'xAI',
      'z-ai': 'Z.ai',
      kimi: 'Kimi',
      minimax: 'MiniMax',
      tencent: 'Tencent',
      xiaomi: 'Xiaomi',
      bytedance: 'ByteDance',
    }

    /**
     * Write a vendor id the way the vendor writes it.
     *
     * @param {unknown} vendor - the vendor id.
     * @returns {string} the display name, or the id capitalised when it is unknown.
     */
    function vendorName(vendor) {
      const id = String(vendor ?? '')
      if (id === '') return ''
      return VENDOR_NAMES[id] ?? id.charAt(0).toUpperCase() + id.slice(1)
    }

    /** Colours for a vendor with no bundled mark, picked by name so it is stable. */
    const FALLBACK_MARK_COLORS = ['#4d6bfe', '#2fa86a', '#9a6bd6', '#d97757', '#20808d', '#b45309', '#5b5bd6', '#0f766e']

    /**
     * Two letters for a vendor nobody bundled a mark for.
     *
     * A row of names with one blank leading cell looks broken, so a vendor this
     * page has never seen still gets something: its first two letters, coloured
     * from a hash of its name so the colour stays put across refreshes.
     *
     * @param {unknown} vendor - the vendor id.
     * @returns {{ mark: string, color: string }} the letters and their colour.
     */
    function fallbackMark(vendor) {
      const name = String(vendor ?? '')
      let hash = 0
      for (let index = 0; index < name.length; index += 1) {
        hash = (hash * 31 + name.charCodeAt(index)) % 100000
      }
      return {
        mark: (name.replace(/[^a-z0-9]/gi, '').slice(0, 2) || '··').toUpperCase(),
        color: FALLBACK_MARK_COLORS[hash % FALLBACK_MARK_COLORS.length],
      }
    }

    /**
     * The mark to draw before a vendor's name.
     *
     * The SVG document is injected whole rather than rebuilt from its paths. Three
     * of these marks render wrong when only their geometry is kept — Tencent's sits
     * inside a flipped \`<g transform>\`, Z.ai's fills live in CSS classes, OpenAI's
     * uses a clip path over a background rect — so everything except the size is
     * preserved, and what is injected is our own bundled, sanitized asset rather
     * than anything that arrived over the network.
     *
     * @param {unknown} vendor - the vendor id.
     * @returns {object} the element: the vendor's mark, or its letters when there is none.
     */
    function vendorLogo(vendor) {
      const id = String(vendor ?? '')
      const logo = VENDOR_LOGOS[id]
      if (logo === undefined) {
        const fallback = fallbackMark(id)
        return h('span', { className: 'tl-logo tl-logo-text', style: { background: fallback.color } }, fallback.mark)
      }
      return h('span', {
        className: 'tl-logo',
        title: vendorName(id),
        dangerouslySetInnerHTML: { __html: logo.svg },
      })
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
      // A write is a save, a refresh or one of the two review answers; only the
      // refresh gets to write "refreshing" on its own button.
      const refreshing = busy && state.action === 'refresh'
      const pending = Array.isArray(data.pending) ? data.pending : []
      // Prices are quoted in USD and displayed in the quote currency. With no
      // rate there is nothing to convert with, so the table falls back to USD and
      // says so rather than inventing a number.
      const rate = typeof fx.rate === 'number' && Number.isFinite(fx.rate) && fx.rate > 0 ? fx.rate : null
      const symbol = rate === null ? '$' : '¥'
      const send = (patch, noticeKey, action) => {
        if (typeof onPatch === 'function') onPatch(patch, noticeKey, action)
      }

      /**
       * Format a typed price and the published one it disagrees with.
       *
       * They share the finer of their two precisions, because the two numbers only
       * exist to be compared: rounded to the table's two decimals, a cache-write
       * price reads as 0 for both and hides the difference being asked about.
       *
       * @param {number|null} manual - the typed value.
       * @param {number|null} official - the published value.
       * @param {string} currency - the currency the pair is shown in.
       * @returns {(value: number|null) => string} the formatter.
       */
      const pairPrice = (manual, official, currency) => {
        const values = [priceCell(manual, rate, currency), priceCell(official, rate, currency)]
          .filter((cell) => cell !== null)
          .map((cell) => cell.value)
        const digits = Math.min(6, Math.max(2, ...values.map((value) => exactDecimals(value))))
        return (value) => price(value, rate, currency, digits)
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

      const rowFor = (model, entry) => {
        const isEditing = editing !== null && editing.id === model.id
        // `¥0` reads as free. Where the source lists 0 for both headline prices it
        // may mean the platform does not price this model per token at all, so the
        // row says so instead of quietly claiming the model costs nothing.
        const zero = model.zero === true && isEditing === false
        // A vendor that publishes in yuan is already in the display currency, so
        // its numbers are shown as published rather than converted.
        const currency = entry?.currency === 'CNY' ? 'CNY' : 'USD'
        const rowSymbol = currency === 'CNY' ? '¥' : symbol
        // One precision per column, decided by the widest cell in the group.
        const digits = PRICE_FIELDS.map((field) => columnDigits(entry?.models ?? [model], field.key, rate, currency))
        return h(
          'div',
          {
            key: String(model.id),
            className: 'tl-rate-row',
            'data-manual': model.source === 'manual' ? 'true' : 'false',
            'data-zero': model.zero === true ? 'true' : 'false',
            'data-period': model.period ?? '',
          },
          h(
            'div',
            { className: 'tl-rate-model' },
            h('span', { className: 'tl-rate-name', title: String(model.id) }, model.name ?? String(model.id)),
            // A vendor that charges by time of day gets a row per period, labelled,
            // because the two prices are for the same model. The label is a sibling
            // of the name, not a child: the name is the piece that gets clipped, and
            // a label drawn inside it was cut down to one character on a long id,
            // which is exactly the row where a reader needs to tell the two apart.
            model.period === undefined
              ? null
              : h(
                  'span',
                  { className: 'tl-period' },
                  model.period === 'offPeak' ? t('periodOffPeak') : t('periodPeak'),
                ),
            // Beside the name rather than at the end of the row: the mark is about
            // the model, and the actions column is where buttons live.
            isEditing === false && model.source === 'manual' ? h('span', { className: 'tl-badge' }, t('manualBadge')) : null,
          ),
          isEditing
            ? PRICE_FIELDS.map((field) =>
                h('input', {
                  key: field.key,
                  className: 'tl-input tl-input-price',
                  value: editing[field.key],
                  inputMode: 'decimal',
                  'aria-label': `${t(field.label)} (${rowSymbol})`,
                  onChange: (event) => setEditing({ ...editing, [field.key]: event.target.value, invalid: false }),
                }),
              )
            : PRICE_FIELDS.map((field, index) =>
                h(
                  'span',
                  {
                    key: field.key,
                    className: 'tl-rate-price',
                    // A number on screen stays traceable: a converted price keeps
                    // the quote it came from, and a vendor-published one says where
                    // it was read.
                    title:
                      entry?.source === 'vendor'
                        ? `${t('officialPriceHint')} (${currency})${zero ? ` · ${t('zeroPriceHint')}` : ''}`
                        : rate === null
                          ? undefined
                          : `${t('priceUsdHint')} ${publishedQuote(model.prices?.[field.key])}${zero ? ` · ${t('zeroPriceHint')}` : ''}`,
                  },
                  price(model.prices?.[field.key], rate, currency, digits[index]),
                ),
              ),
          h(
            'span',
            { className: 'tl-rate-actions' },
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
                        const patch = pricePatch(model.id, editing, currency === 'CNY' ? null : rate)
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
                      onClick: () => setEditing({ id: model.id, ...draftsOf(model, currency === 'CNY' ? null : rate), invalid: false }),
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

      // Only rows where the two numbers disagree: a typed price the catalogue
      // agrees with is not a question. Everything here is answered by one of two
      // posts, and the host re-reads after each, so the list shrinks as it is
      // worked through and no answer is taken on trust from the page.
      const reviewCard =
        pending.length === 0
          ? null
          : h(
              'div',
              { className: 'tl-card' },
              h('h3', { className: 'tl-card-title' }, t('reviewTitle')),
              h('p', { className: 'tl-note' }, t('reviewNote')),
              h(
                'div',
                { className: 'tl-review-list' },
                pending.map((entry) => {
                  const group = vendors.find((item) => (item?.vendor ?? '') === (entry.vendor ?? ''))
                  const reviewCurrency = group?.currency === 'CNY' ? 'CNY' : 'USD'
                  const keys = (Array.isArray(entry.fields) ? entry.fields : []).map((field) => field.key)
                  return h(
                    'div',
                    { key: String(entry.id), className: 'tl-review-row' },
                    h(
                      'div',
                      { className: 'tl-review-model' },
                      h('span', { className: 'tl-rate-name', title: String(entry.id) }, entry.name ?? String(entry.id)),
                      entry.vendor === '' || entry.vendor === undefined
                        ? null
                        : h('span', { className: 'tl-vendor-count' }, vendorName(entry.vendor)),
                    ),
                    h(
                      'div',
                      { className: 'tl-review-fields' },
                      (Array.isArray(entry.fields) ? entry.fields : []).map((field) => {
                        const format = pairPrice(field.manual, field.official, reviewCurrency)
                        const named = PRICE_FIELDS.find((item) => item.key === field.key)
                        return h(
                          'div',
                          { key: field.key, className: 'tl-review-field' },
                          h('span', { className: 'tl-field-label' }, named === undefined ? field.key : t(named.label)),
                          h('span', { className: 'tl-review-mine' }, `${t('reviewYours')} ${format(field.manual)}`),
                          h('span', { className: 'tl-review-arrow' }, '→'),
                          h('span', { className: 'tl-review-official' }, `${t('reviewOfficial')} ${format(field.official)}`),
                        )
                      }),
                    ),
                    h(
                      'div',
                      { className: 'tl-review-actions' },
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'tl-btn tl-btn-primary tl-btn-sm',
                          disabled: busy,
                          onClick: () => send({ adopt: { [entry.id]: keys } }, 'reviewAdopted', 'adopt'),
                        },
                        t('reviewAdopt'),
                      ),
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'tl-btn tl-btn-sm',
                          disabled: busy,
                          onClick: () => send({ keep: { [entry.id]: keys } }, 'reviewKept', 'keep'),
                        },
                        t('reviewKeep'),
                      ),
                    ),
                  )
                }),
              ),
            )

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
          h(
            'button',
            {
              type: 'button',
              className: 'tl-btn tl-btn-sm',
              disabled: busy,
              // The fetch reads every vendor page in turn, so this can take a while;
              // the button says which of the two things it is doing rather than
              // leaving a reader to guess at a spinner.
              onClick: () => send({ refresh: true }, 'refreshed', 'refresh'),
            },
            refreshing ? t('refreshing') : t('refreshNow'),
          ),
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
                      ? h('span', { className: 'tl-logo tl-logo-text', style: { background: '#64748b' } }, '··')
                      : vendorLogo(entry.vendor),
                    h(
                      'span',
                      { className: 'tl-vendor-name' },
                      entry.vendor === '' || entry.vendor === undefined ? t('manualGroup') : vendorName(entry.vendor),
                    ),
                    // Where the numbers came from is shown per vendor, because it
                    // is per vendor: three of these are read from the vendor's own
                    // pricing page and the rest from a dataset.
                    entry.source === 'vendor'
                      ? h('span', { className: 'tl-badge' }, t('sourceOfficial'))
                      : null,
                    h(
                      'span',
                      { className: 'tl-vendor-count' },
                      entry.manualOnly === true ? t('manualOnly') : `${full(entry.modelCount)} ${t('vendorModels')}`,
                    ),
                    // The vendor's own wording for a time-of-day price. DeepSeek's
                    // window is not something to paraphrase.
                    entry.note === undefined || entry.note === '' ? null : h('span', { className: 'tl-vendor-count' }, entry.note),
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
                    entry.models.map((model) => rowFor(model, entry)),
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
            { className: 'tl-field tl-manual-id' },
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
        reviewCard,
        pricesCard,
        manualCard,
        h('p', { className: 'tl-note' }, `${t('refreshNote')} · ${t('updatedAt')} ${clock(data.generatedAt)}`),
      )
    }

    /**
     * One section of the bill: a grouping over one period.
     *
     * @param {object} props - the section.
     * @param {(key: string) => string} props.t - the bound translator.
     * @param {string} props.dim - the grouping: workspace, session, model or vendor.
     * @param {string} props.range - the period this section is showing.
     * @param {(value: string) => void} props.onRange - period change handler.
     * @param {{ status: string, data: object|null, error: string|null }} props.state - this section's fetch state.
     * @returns {object} the element.
     */
    function BillSection({ t, dim, range, onRange, state }) {
      const payload = state?.data ?? null
      const section = payload?.sections?.[0] ?? null
      const rows = Array.isArray(section?.rows) ? section.rows : []
      const totals = section?.totals ?? {}
      const currency = payload?.currency ?? section?.currency ?? 'CNY'
      const titleKey = `billBy${dim.charAt(0).toUpperCase()}${dim.slice(1)}`

      const head = h(
        'div',
        { className: 'tl-row' },
        h('h3', { className: 'tl-card-title' }, t(titleKey)),
        section === null ? null : h('span', { className: 'tl-status' }, `${section.range.from === '' ? t('rangeAll') : section.range.from} → ${section.range.to}`),
        h('div', { className: 'tl-spacer' }),
        h(Tabs, {
          value: range,
          onChange: onRange,
          options: [
            { value: 'month', label: t('rangeMonth') },
            { value: 'year', label: t('rangeYear') },
            { value: 'week', label: t('rangeWeek') },
            { value: 'today', label: t('rangeToday') },
            { value: 'all', label: t('rangeAll') },
          ],
        }),
      )

      // A section that has never loaded says so inside its own card, so one failed
      // request cannot blank the three that worked.
      if (payload === null || section === null) {
        return h(
          'div',
          { className: 'tl-card' },
          head,
          h(
            'p',
            { className: 'tl-note' },
            state?.status === 'error' ? `${t('billSectionFailed')}${state.error === null ? '' : ` (${state.error})`}` : t('loading'),
          ),
        )
      }

      /**
       * One billed row.
       *
       * The two input columns are the halves a bill is read by — what the prompt
       * cache served, and what had to be sent — because they are priced differently
       * on every vendor that prices them at all.
       *
       * @param {object} row - a bill row.
       * @returns {object} the element.
       */
      const rowElement = (row) =>
        h(
          'div',
          { key: `${row.key}-${row.label}`, className: 'tl-bill-row' },
          h(
            'span',
            { className: 'tl-bill-cell-name' },
            h('span', { className: 'tl-bill-label', title: row.sublabel ?? row.label }, row.label ?? t('billPayAsYouGo')),
            row.plan === true ? h('span', { className: 'tl-badge' }, t('billPlan')) : null,
            row.unpricedTokens > 0 ? h('span', { className: 'tl-badge' }, t('unpricedBadge')) : null,
          ),
          h('span', { title: full(row.calls) }, full(row.calls)),
          h('span', { title: full(row.cacheReadTokens) }, compact(row.cacheReadTokens)),
          h('span', { title: full(row.inputTokens) }, compact(row.inputTokens)),
          h('span', { title: full(row.outputTokens) }, compact(row.outputTokens)),
          h('span', null, percent(row.cacheHitRate)),
          // A plan row states both numbers: what the plan costs, and what the usage
          // it covers would have cost. The second is a note, not a second charge —
          // the two are alternatives, so they must not look like a sum. A row that is
          // billed partly by plan and partly by usage says which part is which.
          h(
            'span',
            {
              className: 'tl-bill-cost',
              title:
                row.plan === true
                  ? t('billCoveredUsage')
                  : (row.planCost ?? 0) > 0
                    ? `${t('billPlanShare')} ${money(row.planCost, currency)}`
                    : null,
            },
            h('span', null, money(row.cost, currency)),
            row.plan === true && typeof row.usageCost === 'number'
              ? h('em', { className: 'tl-bill-sub' }, `${t('billCoveredUsage')} ${money(row.usageCost, currency)}`)
              : null,
            row.plan !== true && (row.planCost ?? 0) > 0
              ? h('em', { className: 'tl-bill-sub' }, `${t('billPlanShare')} ${money(row.planCost, currency)}`)
              : null,
          ),
        )

      return h(
        'div',
        { className: 'tl-card' },
        head,
        state?.status === 'stale' ? h('p', { className: 'tl-note' }, t('stale')) : null,
        rows.length === 0
          ? h('p', { className: 'tl-note' }, t('billSectionEmpty'))
          : h(
              'div',
              { className: 'tl-bill-scroll' },
              h(
                'div',
                { className: 'tl-bill-table' },
                h(
                  'div',
                  { className: 'tl-bill-head' },
                  h('span', null, t(titleKey)),
                  h('span', null, t('calls')),
                  h('span', null, t('cacheReadTokens')),
                  h('span', null, t('inputTokens')),
                  h('span', null, t('outputTokens')),
                  h('span', null, t('cacheHitRate')),
                  h('span', null, t('billCost')),
                ),
                rows.map(rowElement),
                h(
                  'div',
                  { className: 'tl-bill-total' },
                  h('span', { className: 'tl-bill-cell-name' }, t('billTotal')),
                  h('span', null, full(totals.calls)),
                  h('span', { title: full(totals.cacheReadTokens) }, compact(totals.cacheReadTokens)),
                  h('span', { title: full(totals.inputTokens) }, compact(totals.inputTokens)),
                  h('span', { title: full(totals.outputTokens) }, compact(totals.outputTokens)),
                  h('span', null, percent(totals.cacheHitRate)),
                  h('span', null, money(totals.totalCost, currency)),
                ),
              ),
            ),
        // Cache writes are tokens too. They are near zero on the vendors that price
        // them at all, so they are a footnote rather than a column that is almost
        // always a dash — but they are not silently dropped.
        (totals.cacheWriteTokens ?? 0) > 0
          ? h('p', { className: 'tl-note' }, `${t('billCacheWrite')} ${full(totals.cacheWriteTokens)}`)
          : null,
      )
    }

    /**
     * The bill: the same tokens as the overview, priced and totalled four ways.
     *
     * Four groupings are stacked rather than put behind a tab, because the question
     * a bill answers is usually comparative — which workspace, which vendor — and a
     * tab hides three quarters of the answer behind a click. Each section carries
     * its own period, so the page can show this month by workspace next to today by
     * model, and the export at the top takes all of it.
     *
     * Four readings make this screen honest rather than merely tidy. The cost is an
     * estimate from the price list, and the subtitle says so. A model with no price
     * is listed underneath with its token count instead of quietly costing nothing.
     * A price matched by name rather than by exact id is listed too, because a join
     * that guessed should be checkable. And the money column is tabular and
     * fixed-width, because a bill is read by comparing numbers down it.
     *
     * @param {object} props - the view inputs.
     * @param {(key: string) => string} props.t - the bound translator.
     * @param {object} props.bills - one fetch state per grouping.
     * @param {object} props.ranges - the period each grouping is showing.
     * @param {(dim: string, value: string) => void} props.onRange - period change handler.
     * @returns {object} the element.
     */
    function BillView({ t, bills, ranges, onRange }) {
      const states = bills ?? {}
      const periods = ranges ?? {}
      // The export is the whole page and more: every grouping over every period, so
      // the file is complete even though the screen shows four periods at a time.
      const exportUrl = (format) =>
        `${BILL_ENDPOINT}?by=${BILL_SECTION_ORDER.join(',')}&range=${BILL_RANGE_ORDER.join(',')}&format=${format}`
      const stampSource = ['workspace', 'session', 'model', 'vendor']
        .map((dim) => states[dim]?.data?.generatedAt)
        .find((value) => typeof value === 'number')
      const stamp = new Date(stampSource ?? Date.now()).toISOString().slice(0, 10)

      // The shared notes come from whichever section answered: they are the same
      // answer for all of them, since they describe the prices rather than the rows.
      const answered = ['workspace', 'session', 'model', 'vendor'].map((dim) => states[dim]?.data).find((data) => data !== null && data !== undefined) ?? null
      const anyError = ['workspace', 'session', 'model', 'vendor'].some((dim) => states[dim]?.status === 'error')
      const anyStale = ['workspace', 'session', 'model', 'vendor'].some((dim) => states[dim]?.status === 'stale')

      const notes = []
      if (answered !== null) {
        notes.push(
          h(
            'p',
            { key: 'basis', className: 'tl-note' },
            `${t('billEstimate')}: ${t('source')} ${answered.priceSource}${answered.fxRate === null ? '' : ` · 1 USD = ${rateText(answered.fxRate)} ${answered.currency}`}`,
          ),
        )
        if (Array.isArray(answered.subscriptions) && answered.subscriptions.length > 0) {
          for (const plan of answered.subscriptions) {
            notes.push(
              h(
                'p',
                { key: `plan-${plan.plan}`, className: 'tl-note' },
                `${plan.plan}${plan.vendor === null ? '' : ` (${vendorName(plan.vendor)})`} · ${t('billAmount')} ${plan.currency} ${plan.amount} · ${t('billTotal')} ${money(plan.share, answered.currency)}`,
              ),
            )
          }
        }
        if (Array.isArray(answered.unpriced) && answered.unpriced.length > 0) {
          notes.push(
            h(
              'div',
              { key: 'unpriced', className: 'tl-note' },
              h('span', null, `${t('billUnpriced')}:`),
              h(
                'ul',
                { className: 'tl-bill-note-list' },
                answered.unpriced.slice(0, 8).map((row) =>
                  h('li', { key: row.model }, `${row.model} — ${compact(row.tokens)} (${row.calls} ${t('calls')}) · ${row.reason}`),
                ),
              ),
            ),
          )
        }
        const named = (Array.isArray(answered.joins) ? answered.joins : []).filter((join) => join.confidence !== 'exact')
        if (named.length > 0) {
          notes.push(
            h(
              'div',
              { key: 'joins', className: 'tl-note' },
              h('span', null, `${t('billJoins')}:`),
              h(
                'ul',
                { className: 'tl-bill-note-list' },
                named.slice(0, 8).map((join) => h('li', { key: join.model }, `${join.model} → ${join.vendor}/${join.priceId} (${join.matchedOn})`)),
              ),
            ),
          )
        }
      }
      notes.push(h('p', { key: 'export-hint', className: 'tl-note' }, t('billExportHint')))

      return h(
        'div',
        { className: 'tl-root' },
        anyStale ? h('p', { className: 'tl-note' }, t('stale')) : null,
        h(
          'div',
          { className: 'tl-row' },
          h(
            'div',
            { className: 'tl-head' },
            h('h2', { className: 'tl-title' }, t('billTitle')),
            h('p', { className: 'tl-sub' }, t('billSubtitle')),
          ),
          h('div', { className: 'tl-spacer' }),
          // The export sits at the top right, where a bill's export belongs.
          h(
            'div',
            { className: 'tl-bill-actions' },
            h('a', { className: 'tl-btn', href: exportUrl('csv'), download: `token-bill-all-${stamp}.csv`, title: t('billExportHint') }, t('billExportAllCsv')),
            h('a', { className: 'tl-btn', href: exportUrl('json'), download: `token-bill-all-${stamp}.json`, title: t('billExportHint') }, t('billExportAllJson')),
          ),
        ),
        anyError && answered === null ? h('p', { className: 'tl-note' }, t('billUnavailableReason')) : null,
        ...BILL_SECTION_ORDER.map((dim) =>
          h(BillSection, {
            key: dim,
            t,
            dim,
            range: periods[dim] ?? 'month',
            onRange: (value) => onRange(dim, value),
            state: states[dim] ?? { status: 'idle', data: null, error: null },
          }),
        ),
        ...notes,
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
      const [rates, setRates] = react.useState({
        status: 'idle',
        data: null,
        error: null,
        saving: false,
        // Which write is in flight, so a button can tell "busy" from "busy
        // doing what I asked" without a second piece of state per button.
        action: null,
        notice: null,
      })
      const [billRanges, setBillRanges] = react.useState(() =>
        Object.fromEntries(BILL_SECTION_ORDER.map((dim) => [dim, 'month'])),
      )
      const [bills, setBills] = react.useState(() =>
        Object.fromEntries(BILL_SECTION_ORDER.map((dim) => [dim, { status: 'idle', data: null, error: null }])),
      )

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

      // The bill is refetched when a period changes, because pricing tokens is the
      // host's arithmetic: the page has no prices, and a second implementation of it
      // in the browser would be a second answer. Each section is its own request, so
      // one that fails leaves the other three readable.
      react.useEffect(() => {
        if (kind !== 'bill') return undefined
        let cancelled = false

        /**
         * Read one section.
         *
         * @param {string} dim - the grouping.
         * @returns {void}
         */
        const loadSection = (dim) => {
          const url = `${BILL_ENDPOINT}?by=${encodeURIComponent(dim)}&range=${encodeURIComponent(billRanges[dim] ?? 'month')}`
          fetch(url, { cache: 'no-store' })
            .then((response) => {
              if (!response.ok) throw new Error(`HTTP ${response.status}`)
              return response.json()
            })
            .then((data) => {
              if (!cancelled) setBills((previous) => ({ ...previous, [dim]: { status: 'ready', data, error: null } }))
            })
            .catch((error) => {
              if (cancelled) return
              setBills((previous) => {
                const before = previous[dim] ?? { data: null }
                const message = String(error?.message ?? error)
                return {
                  ...previous,
                  [dim]:
                    before.data === null
                      ? { status: 'error', data: null, error: message }
                      : { status: 'stale', data: before.data, error: message },
                }
              })
            })
        }

        const load = () => {
          for (const dim of BILL_SECTION_ORDER) loadSection(dim)
        }
        load()
        const timer = setInterval(load, POLL_MS)
        return () => {
          cancelled = true
          clearInterval(timer)
        }
      }, [kind, billRanges.workspace, billRanges.session, billRanges.model, billRanges.vendor])

      /**
       * Send hand-entered values to the host and adopt what it answers with.
       *
       * The answer carries the re-read state, so a save needs no follow-up read
       * and cannot leave the page showing a value the host rejected.
       *
       * @param {object} patch - the validated-shape patch.
       * @param {string} [noticeKey] - the dictionary key for the success note.
       * @param {string} [action] - which write this is, for the button that started it.
       * @returns {void}
       */
      const patchRates = (patch, noticeKey, action) => {
        setRates((previous) => ({ ...previous, saving: true, notice: null, action: action ?? null }))
        fetch(RATES_ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(patch),
        })
          .then((response) => response.json().then((payload) => ({ response, payload })))
          .then(({ response, payload }) => {
            if (!response.ok || payload?.ok !== true) throw new Error(payload?.error ?? `HTTP ${response.status}`)
            // A refresh that could not reach a source is not a failed write —
            // the previous numbers are still served — but saying "saved" would
            // read as "the prices are current", which is the one thing the
            // reader asked for and did not get.
            const missed = typeof payload.refresh?.catalogue === 'string' && payload.refresh.catalogue.startsWith('failed')
            setRates((previous) => ({
              status: 'ready',
              data: payload.rates ?? previous.data,
              error: null,
              saving: false,
              action: null,
              notice: missed
                ? { ok: false, text: `${t('refreshFailed')} (${payload.refresh.catalogue})` }
                : { ok: true, text: t(noticeKey ?? 'saved') },
            }))
          })
          .catch((error) => {
            setRates((previous) => ({
              ...previous,
              saving: false,
              action: null,
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
              { value: 'bill', label: t('tabBill') },
            ],
          }),
        ),
        kind === 'rates'
          ? h(RatesView, { t, state: rates, onPatch: patchRates })
          : kind === 'bill'
            ? h(BillView, {
                t,
                bills,
                ranges: billRanges,
                onRange: (dim, value) => setBillRanges((previous) => (previous[dim] === value ? previous : { ...previous, [dim]: value })),
              })
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
    exports.BillView = BillView
    exports.BillSection = BillSection
    return module.exports
  },
})
