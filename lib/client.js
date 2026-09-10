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
    /** How often to re-read the route. The host debounces its own writes at 2s. */
    const POLL_MS = 15000
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
      cacheReadTokens: '缓存命中读入',
      reasoningTokens: '其中推理',
      today: '今日实时',
      todayHint: '每一步完成后立即更新（成功完成的调用才计入）',
      todayEmpty: '今天还没有产生用量',
      calendar: '用量热力图',
      viewYear: '年',
      viewMonth: '月',
      viewWeek: '一周',
      weekChart: '近 7 天每日 Token',
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
      todayHint: 'Updates as each step completes (only successful calls count)',
      todayEmpty: 'No usage yet today',
      calendar: 'Usage calendar',
      viewYear: 'Year',
      viewMonth: 'Month',
      viewWeek: 'Week',
      weekChart: 'Tokens per day, last 7 days',
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
.tl-detail { display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 12px; opacity: .8; }
.tl-detail span { font-variant-numeric: tabular-nums; }
.tl-note { font-size: 11px; opacity: .55; margin: 0; }
.tl-scroll { overflow-x: auto; padding-bottom: 4px; }
.tl-grid { display: grid; grid-auto-flow: column; grid-template-rows: repeat(7, 12px); gap: 3px; width: max-content; }
.tl-month-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; }
.tl-cell { width: 12px; height: 12px; border-radius: 2px; background: rgba(127,127,127,.14); }
.tl-month-cell { position: relative; aspect-ratio: 1 / 1; border-radius: 3px; background: rgba(127,127,127,.14); }
.tl-month-cell[data-today='true'] { outline: 1px solid var(--dsh-accent, #408cff); outline-offset: 1px; }
.tl-weekday { font-size: 10px; opacity: .5; text-align: center; }
.tl-legend { display: flex; align-items: center; gap: 6px; font-size: 11px; opacity: .6; }
.tl-bars { display: flex; align-items: flex-end; gap: 8px; height: 132px; }
.tl-bar-col { flex: 1 1 0; display: flex; flex-direction: column; justify-content: flex-end; gap: 6px; height: 100%; min-width: 0; }
.tl-bar { border-radius: 4px 4px 0 0; background: linear-gradient(180deg, #408cff, #2f6fd0); min-height: 2px; }
.tl-bar-value { font-size: 10px; text-align: center; opacity: .75; font-variant-numeric: tabular-nums; white-space: nowrap; }
.tl-bar-label { font-size: 10px; text-align: center; opacity: .55; white-space: nowrap; }
.tl-models { display: flex; flex-direction: column; gap: 6px; font-size: 12px; }
.tl-model-line { display: flex; align-items: center; gap: 10px; }
.tl-model-name { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tl-model-bar { flex: 0 0 96px; height: 6px; border-radius: 3px; background: rgba(127,127,127,.16); overflow: hidden; }
.tl-model-fill { height: 100%; background: #408cff; }
.tl-model-value { flex: 0 0 auto; font-variant-numeric: tabular-nums; opacity: .75; }
.tl-status { font-size: 12px; opacity: .6; }
.tl-error { font-size: 12px; color: var(--dsh-danger, #d9534f); }
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
     * Map a day's tokens onto one of five intensity levels.
     *
     * The scale is relative to the busiest day in the window and square-rooted,
     * because a single very large day would otherwise flatten every other cell
     * to the faintest level.
     *
     * @param {number} value - the day's tokens.
     * @param {number} max - the window's busiest day.
     * @returns {number} 0 for an empty day, otherwise 1 to 4.
     */
    function level(value, max) {
      if (!(value > 0) || !(max > 0)) return 0
      const ratio = Math.sqrt(value / max)
      return Math.max(1, Math.min(4, Math.ceil(ratio * 4)))
    }

    /** The five heat levels, readable on both light and dark backgrounds. */
    const LEVEL_BG = [
      'rgba(127,127,127,.14)',
      'rgba(64,140,255,.28)',
      'rgba(64,140,255,.48)',
      'rgba(64,140,255,.7)',
      'rgba(64,140,255,.95)',
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
     * The year or month calendar, drawn as a grid of day cells.
     *
     * @param {object} props - the calendar.
     * @returns {object} the element.
     */
    function Calendar({ series, view, t }) {
      const byDate = new Map(series.map((day) => [day.date, day]))
      const max = series.reduce((peak, day) => Math.max(peak, day.totalTokens ?? 0), 0)

      if (view === 'month') {
        // Always show the month of the last day in the series, which is today.
        const last = series.length > 0 ? dayParts(series[series.length - 1].date) : dayParts('1970-01-01')
        const daysInMonth = new Date(last.year, last.month, 0).getDate()
        const leading = dayParts(`${last.year}-${String(last.month).padStart(2, '0')}-01`).weekday
        const cells = []
        for (let index = 0; index < leading; index += 1) cells.push(h('div', { key: `pad-${index}` }))
        for (let day = 1; day <= daysInMonth; day += 1) {
          const key = `${last.year}-${String(last.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const entry = byDate.get(key)
          const tokens = entry?.totalTokens ?? 0
          cells.push(
            h('div', {
              key,
              className: 'tl-month-cell',
              'data-today': key === series[series.length - 1]?.date ? 'true' : 'false',
              style: { background: LEVEL_BG[level(tokens, max)] },
              title: `${key} · ${compact(tokens)}`,
            }),
          )
        }
        return h(
          'div',
          { className: 'tl-month-grid' },
          ['一', '二', '三', '四', '五', '六', '日'].map((label, index) =>
            h('div', { key: `h-${index}`, className: 'tl-weekday' }, label),
          ),
          cells,
        )
      }

      // Year: one column per week, one row per weekday, oldest first.
      return h(
        'div',
        { className: 'tl-grid' },
        series.map((day) =>
          h('div', {
            key: day.date,
            className: 'tl-cell',
            style: { background: LEVEL_BG[level(day.totalTokens ?? 0, max)] },
            title: `${day.date} · ${compact(day.totalTokens ?? 0)} · ${full(day.calls ?? 0)} ${t('calls')}`,
          }),
        ),
      )
    }

    /**
     * The last seven days as bars.
     *
     * @param {object} props - the chart.
     * @returns {object} the element.
     */
    function WeekBars({ series }) {
      const lastSeven = series.slice(-7)
      const max = lastSeven.reduce((peak, day) => Math.max(peak, day.totalTokens ?? 0), 0)
      return h(
        'div',
        { className: 'tl-bars' },
        lastSeven.map((day) => {
          const tokens = day.totalTokens ?? 0
          const height = max > 0 ? Math.max(2, Math.round((tokens / max) * 88)) : 2
          return h(
            'div',
            { key: day.date, className: 'tl-bar-col', title: `${day.date} · ${full(tokens)}` },
            h('div', { className: 'tl-bar-value' }, compact(tokens)),
            h('div', { className: 'tl-bar', style: { height: `${height}px` } }),
            h('div', { className: 'tl-bar-label' }, day.date.slice(5)),
          )
        }),
      )
    }

    /**
     * The settings section.
     *
     * @param {object} props - props injected by the registration.
     * @param {(key: string) => string} props.t - the bound translator.
     * @returns {object} the element.
     */
    function TokenLedgerSection({ t }) {
      const [range, setRange] = react.useState('month')
      const [view, setView] = react.useState('year')
      const [state, setState] = react.useState({ status: 'loading', data: null, error: null })

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
      const busiest = models.reduce((peak, model) => Math.max(peak, model.totalTokens ?? 0), 0)

      return h(
        'div',
        { className: 'tl-root' },

        h(
          'div',
          { className: 'tl-row' },
          header,
          h('div', { className: 'tl-spacer' }),
          h(Tabs, {
            value: range,
            onChange: setRange,
            options: [
              { value: 'month', label: t('rangeMonth') },
              { value: 'year', label: t('rangeYear') },
              { value: 'week', label: t('rangeWeek') },
            ],
          }),
        ),

        state.status === 'stale' ? h('p', { className: 'tl-note' }, t('stale')) : null,

        // Range totals.
        h(
          'div',
          { className: 'tl-card' },
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
            : h(
                'div',
                { className: 'tl-metrics' },
                h(Metric, { label: t('totalTokens'), value: compact(today.totals.totalTokens), sub: full(today.totals.totalTokens), small: true }),
                h(Metric, { label: t('cacheHitRate'), value: percent(today.cacheHitRate), small: true }),
                h(Metric, { label: t('calls'), value: full(today.calls), small: true }),
              ),
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
              onChange: setView,
              options: [
                { value: 'year', label: t('viewYear') },
                { value: 'month', label: t('viewMonth') },
                { value: 'week', label: t('viewWeek') },
              ],
            }),
          ),
          series.length === 0
            ? h('p', { className: 'tl-note' }, t('noData'))
            : view === 'week'
              ? h(
                  'div',
                  null,
                  h('p', { className: 'tl-note' }, t('weekChart')),
                  h(WeekBars, { series }),
                )
              : h('div', { className: 'tl-scroll' }, h(Calendar, { series, view, t })),
          view === 'week'
            ? null
            : h(
                'div',
                { className: 'tl-legend' },
                h('span', null, t('less')),
                LEVEL_BG.map((background, index) => h('span', { key: index, className: 'tl-cell', style: { background } })),
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
                models.map((model) =>
                  h(
                    'div',
                    { key: model.model, className: 'tl-model-line' },
                    h('span', { className: 'tl-model-name', title: model.model }, model.model),
                    h(
                      'span',
                      { className: 'tl-model-bar' },
                      h('span', {
                        className: 'tl-model-fill',
                        style: { width: `${busiest > 0 ? Math.round(((model.totalTokens ?? 0) / busiest) * 100) : 0}%` },
                      }),
                    ),
                    h('span', { className: 'tl-model-value' }, `${compact(model.totalTokens)} · ${percent(model.cacheHitRate)}`),
                  ),
                ),
              ),
            ),

        h('p', { className: 'tl-note' }, `${t('updatedAt')} ${updated}`),
      )
    }

    const inject = ['slots', 'locale']

    /**
     * Register the settings section.
     *
     * @param {object} ctx - the Cordis context for this plugin's client fiber.
     * @returns {void}
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-token-ledger: dictionaries')
      ctx.effect(() => installStyles(), 'dsh-token-ledger: styles')
      const t = ctx.locale.bind(NS)
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: 'token-ledger',
            order: 40,
            label: () => t('nav'),
            locale: NS,
            inject: () => ({ t }),
          },
          TokenLedgerSection,
        ),
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
