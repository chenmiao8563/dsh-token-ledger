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
      monthChart: '本月每日 Token',
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
      monthChart: 'Tokens per day, this month',
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
.tl-calendar { display: flex; flex-direction: column; gap: 4px; width: max-content; }
.tl-axis { display: grid; font-size: 10px; opacity: .55; line-height: 1; }
.tl-axis-label { white-space: nowrap; }
.tl-grid { display: grid; grid-auto-flow: column; width: max-content; }
.tl-cell { border-radius: 2px; background: rgba(127,127,127,.14); }
.tl-chip { width: 11px; height: 11px; border-radius: 2px; }
.tl-blank { border-radius: 2px; background: transparent; }
.tl-meter { flex: 1 1 auto; min-width: 0; height: 9px; border-radius: 3px; background: rgba(127,127,127,.14); overflow: hidden; display: flex; }
.tl-seg { height: 100%; }
.tl-bars { display: flex; align-items: flex-end; justify-content: center; gap: 6px; height: 132px; }
.tl-bar-col { display: flex; flex-direction: column; justify-content: flex-end; gap: 5px; height: 100%; }
.tl-bar { border-radius: 3px 3px 0 0; background: linear-gradient(180deg, #408cff, #245bb4); min-height: 2px; }
.tl-bar-value { font-size: 10px; text-align: center; opacity: .75; font-variant-numeric: tabular-nums; white-space: nowrap; }
.tl-bar-label { font-size: 10px; text-align: center; opacity: .55; white-space: nowrap; }
.tl-bar-blank { font-size: 10px; text-align: center; opacity: 0; }
.tl-models { display: flex; flex-direction: column; gap: 7px; font-size: 12px; }
.tl-model-line { display: flex; align-items: center; gap: 10px; }
.tl-model-name { flex: 0 0 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tl-model-value { flex: 0 0 auto; font-variant-numeric: tabular-nums; opacity: .75; }
.tl-keys { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 11px; opacity: .7; }
.tl-key { display: inline-flex; align-items: center; gap: 5px; }
.tl-swatch { width: 9px; height: 9px; border-radius: 2px; }
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

    /** Side of one heat cell, and the gap between cells, in pixels. */
    const CELL = 11
    const CELL_GAP = 3

    /** The heat ramp: index 0 is an empty day, 1 to 6 climb to a deep blue. */
    const LEVEL_BG = [
      'rgba(127,127,127,.14)',
      'rgba(158,196,255,.42)',
      'rgba(110,160,250,.58)',
      'rgba(66,124,232,.72)',
      'rgba(38,92,198,.85)',
      'rgba(20,62,158,.95)',
      'rgba(9,36,106,1)',
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
     * The year calendar: one column per week, one row per weekday.
     *
     * The series is consecutive days ending today, so the first column has to be
     * padded until the first day lands on its real weekday — otherwise every row
     * would be a weekday label that lies, and the month axis below would point
     * at the wrong columns. The axis itself is a grid with the same column width
     * and gap as the heat grid, so the two line up without measurement.
     *
     * @param {object} props - the calendar.
     * @param {object[]} props.series - contiguous day rows, ascending.
     * @param {(key: string) => string} props.t - the bound translator.
     * @returns {object} the element.
     */
    function YearHeatmap({ series, t }) {
      const max = series.reduce((peak, day) => Math.max(peak, day.totalTokens ?? 0), 0)
      const leading = series.length > 0 ? dayParts(series[0].date).weekday : 0
      const columns = Math.max(1, Math.ceil((leading + series.length) / 7))

      // One label per month, placed over the column where that month starts.
      const months = []
      let seenMonth = null
      for (const [index, day] of series.entries()) {
        const parts = dayParts(day.date)
        if (parts.month === seenMonth) continue
        seenMonth = parts.month
        months.push({ key: `${parts.year}-${parts.month}`, column: Math.floor((leading + index) / 7), label: t(`m${parts.month}`) })
      }

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
          series.map((day) =>
            h('div', {
              key: day.date,
              className: 'tl-cell',
              style: { background: LEVEL_BG[level(day.totalTokens ?? 0, max)] },
              title: `${day.date} · ${compact(day.totalTokens ?? 0)} · ${full(day.calls ?? 0)} ${t('calls')}`,
            }),
          ),
        ),
      )
    }

    /**
     * A day-per-bar chart.
     *
     * The bar width is fixed rather than flexible so that a seven-bar week and a
     * thirty-bar month read the same way; a proportional column would make the
     * week look like a different chart from the month. `labelEvery` keeps a
     * month from stacking thirty labels into an unreadable line.
     *
     * @param {object} props - the chart.
     * @param {object[]} props.series - the days to draw, ascending.
     * @param {number} props.barWidth - bar width in pixels.
     * @param {number} [props.labelEvery] - draw one label every N bars.
     * @param {boolean} [props.showValues] - draw the value above each bar.
     * @returns {object} the element.
     */
    function BarChart({ series, barWidth, labelEvery = 1, showValues = false }) {
      const max = series.reduce((peak, day) => Math.max(peak, day.totalTokens ?? 0), 0)
      return h(
        'div',
        { className: 'tl-bars' },
        series.map((day, index) => {
          const tokens = day.totalTokens ?? 0
          const height = max > 0 ? Math.max(2, Math.round((tokens / max) * 88)) : 2
          const labelled = index % labelEvery === 0
          return h(
            'div',
            {
              key: day.date,
              className: 'tl-bar-col',
              style: { flex: `0 0 ${barWidth}px`, width: `${barWidth}px` },
              title: `${day.date} · ${full(tokens)}`,
            },
            showValues ? h('div', { className: 'tl-bar-value' }, compact(tokens)) : null,
            h('div', { className: 'tl-bar', style: { height: `${height}px` } }),
            h('div', { className: labelled ? 'tl-bar-label' : 'tl-bar-blank' }, labelled ? day.date.slice(5) : '·'),
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
      // The month chart draws the current calendar month, taken from the tail of
      // the same series the year heatmap uses, so the two cannot disagree.
      const monthPrefix = typeof today.date === 'string' ? today.date.slice(0, 7) : ''
      const monthDays =
        monthPrefix.length === 7 ? series.filter((day) => String(day.date).startsWith(monthPrefix)) : series.slice(-31)

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
            onChange: onRange,
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
                ? h(BarChart, { series: monthDays, barWidth: 9, labelEvery: 5 })
                : h(BarChart, { series: series.slice(-7), barWidth: 26, showValues: true }),
          view === 'year'
            ? h(
                'div',
                { className: 'tl-legend' },
                h('span', null, t('less')),
                LEVEL_BG.map((background, index) => h('span', { key: index, className: 'tl-chip', style: { background } })),
                h('span', null, t('more')),
              )
            : h('p', { className: 'tl-note' }, t(view === 'month' ? 'monthChart' : 'weekChart')),
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

    const inject = ['slots', 'locale']

    /**
     * The settings section: fetch the overview, then render the view.
     *
     * The fetch is the whole reason this exists separately from
     * {@link OverviewView}. It polls rather than subscribing because the host
     * answers over a plain route, and a failed poll with data already in hand
     * degrades to `stale` instead of blanking the page.
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

      return h(OverviewView, { t, state, range, view, onRange: setRange, onView: setView })
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
    return module.exports
  },
})
