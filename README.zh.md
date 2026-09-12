# dsh-token-ledger

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 提供透明、可审计的 token 记账。

[![CI](https://github.com/chenmiao8563/dsh-token-ledger/actions/workflows/ci.yml/badge.svg)](https://github.com/chenmiao8563/dsh-token-ledger/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@chenmiao8563/dsh-token-ledger.svg)](https://www.npmjs.com/package/@chenmiao8563/dsh-token-ledger)
[![license](https://img.shields.io/npm/l/dsh-token-ledger.svg)](./LICENSE)

[English](README.md) | 中文

---

## 这是什么

这是一本**账本**，不是一块仪表盘。它把 DSH 的持久会话日志折叠成 token 用量，保证重启不丢，
而且——这是关键——允许你**从原始日志重算同一批数字并与之对账**。

```
$ dsh-token-ledger audit
scanned 139 session log(s), 344203 events, 29 fork(s), 0 unreadable

  stored      6901 calls  1205685663 tokens
  recomputed  6901 calls  1205685663 tokens

  audit: match — the stored ledger equals a fresh fold of the raw logs
```

只想看漂亮的图表，市面上有十几个同类插件。这个插件是给你**需要为这个数字辩护**的时候用的。

从 0.4 起，设置页还多了一个 **费率** 页：各厂商最新模型的价格表，以及实时美元汇率。
它是一张参照表——详见[设置页](#设置页)——并且刻意停在「不把 token 折算成钱」这一步。

## 为什么别的插件装不上时它能装上

| 特性 | 为什么重要 |
| --- | --- |
| **零依赖、零 peer 依赖** | 没有东西需要解析，DSH 内部包的版本漂移搞不坏安装。 |
| **零安装脚本** | 直接用 git URL `dsh plugin add` 即可——pnpm 没有构建要拦，你也不必去 `allowBuilds` 里加白名单。 |
| **只 import `node:`** | 宿主端可以从任意 profile（web / desktop / headless / TUI）加载，不需要解析任何包。 |
| **不碰模型可见面** | 它不注册任何提示词段、消息或工具，因此不会改变请求前缀，也不会损害 KV cache 复用。 |
| **故障降级** | 每个钩子都有保护。账本出问题只记一条警告，绝不让会话失败。 |

## 安装

```bash
# 从 npm
dsh plugin --profile web add @chenmiao8563/dsh-token-ledger

# 从 git URL（不涉及任何构建步骤）
dsh plugin --profile web add github:chenmiao8563/dsh-token-ledger

# 从本地仓库
dsh plugin --profile web add /absolute/path/to/dsh-token-ledger
```

npm 包名带 scope，是因为 npm 会把分隔符归一化后比较，无 scope 的
`dsh-token-ledger` 被判为与已有包过于相似而拒绝发布。CLI 命令名仍然是
`dsh-token-ledger`。

重启 DSH，然后确认那一行进去了：

```bash
dsh --profile web --dump-config | grep token-ledger
```

在对话里用 `/tokens`：

```
/tokens
/tokens export     # 把 CSV 与 JSON 写到 <DSH_HOME>/token-ledger/exports/
/tokens json       # 原始快照
/tokens path       # 账本文件位置
```

账本写在 `<DSH_HOME>/token-ledger/ledger.json`。

## 计数规则

只有知道它到底在数什么，这些数字才有用。

| 规则 | 行为 |
| --- | --- |
| **只认成功锚点** | 用量取自 `assistant/message`（已完成的步）与 `compaction/summary`（一次压缩调用）。失败或被取消的尝试不会追加这两种事件，因此永远不计入。 |
| **流式样本是替换，不是相加** | 同一步先出 `usage` chunk、后出最终消息时，最终值**替换**早期样本——无论哪种情况都算一次调用。 |
| **`totalTokens` 是推导出来的** | 它是四个桶之和，绝不采信提供方自己的总量字段。在 15,778 份真实用量报告上两者完全一致，而推导能让桶与总量在构造上永远自洽。 |
| **推理 token 是子集** | 单独报告，绝不相加进总量，因为它本来就在 `outputTokens` 里面。 |
| **按本地日历日** | 是你所在时区的日，不是 UTC 日。 |
| **fork 切、resume 不切** | 见下。 |

### fork 与 resume 的区别

存储的日志可能以一段"已经记录过的历史"开头。有两种完全不同的情况会产生这种前缀，
把它们搞混是用量插件静默算错的最常见原因：

- **fork**（有 `parentSession`）：前缀是**父会话**的历史，已经在父会话自己的日志里计过。
  在这里再计一次就是重复计入——必须切掉。
- **resume**（没有父会话）：前缀是**这个会话自己**更早的历史，只存了一次。
  切掉就是漏计——不能切。

这不是猜的。对照真实日志：所有父日志仍在磁盘上的 fork 会话，其边界标记之前的用量指纹
都包含在父会话里；而带同样标记但没有父会话的日志，其前缀在文件后半段从未重复出现。
在一个真实的 139 会话 home 上，这个区别意味着 **7,992 万 token** 的重复计入——那是
"把每个日志都完整计一遍"的天真做法会报出来的数字。

## 命令行

不需要 DSH 在运行——它直接读原始日志。

```
dsh-token-ledger [summary] [选项]     打印已存账本（默认）
dsh-token-ledger audit   [选项]       从原始日志重算并对比
dsh-token-ledger rebuild [选项]       从原始日志重算
dsh-token-ledger export  [选项]       导出 CSV 与 JSON

--home <path>    DSH home（默认 $DSH_HOME，其次 ~/.dsh）
--ledger <path>  要读写的账本文件
--out <path>     导出目录
--days <n>       摘要显示天数（默认 7）
--models <n>     摘要显示模型数（默认 5）
--write          配合 rebuild：覆盖已存账本
--json           机器可读输出
--quiet          抑制人类可读摘要，只保留退出码
```

退出码：`0` 成功或审计通过，`1` 审计发现真实差异，`2` 用法错误或输入不可读。
因此它可以挂进定时任务。

### 审计能区分两类差异

运行中的宿主是按防抖写入账本的，所以活跃会话比文件"新一点"是常态。
把这种情况报成数据损坏，审计就废了。账本自己的 `updatedAt` 可以裁决：

- 有差异的会话，其最新事件**比账本更新** → 只是还在跑 → **通过**，并报出尚未落盘的量；
- 有差异的会话，其最新事件**早于账本**，或者某条日/模型行与它本该汇总的折叠结果矛盾
  → **不通过**，退出码 1。

```
  audit: match — 1 session(s) advanced after the ledger was written
         (1 calls, 5100 tokens not yet flushed)
```

## 设置页

浏览器端会在设置侧边栏注册一个 **用量账本** 分区，顶部有 **概览 / 费率** 两个按钮。

### 概览

- **区间总计**：本月 / 本年 / 近 7 天三档可切换，每档显示 Token 总计、缓存命中率、
  调用次数，以及背后的四桶明细。缓存命中率定义为
  `缓存读入 / (缓存读入 + 未命中输入)`——即输入中被缓存吸收的比例，因此完全不缓存的
  路由读数是 0%，而不是空白。
- **今日实时**：今天的 Token、命中率与调用次数，每分钟刷新一次。
- **用量热力图**：年 / 月 / 一周三档可切换；年和月是热力图，切到一周改为每天一行
  的横向条形图。
  热力档位相对窗口内最忙的一天取平方根，避免某一天特别大把其余全部压成最淡档。
  月视图右侧另给本月小结：最忙的一天、最轻松的一天（仅工作日）与工作到最晚的一天
  （仅工作日，按当天最后一次调用的时刻比较）。
- **按模型**：各模型的用量、各自命中率，以及一条展示用量构成的堆叠条。

### 费率

- **美元汇率**单独一个框，保留四位小数，并标注来源与获取时间。它只作对照——
  本页**不做任何费用换算**，页面上也写明了这一点。
- **各厂商最新模型**：每个厂商只列最新的 2~3 个，给出输入 / 输出 / 缓存读 / 缓存写
  每百万 Token 的价格。价格是**各家自己公布的价目**，取自一份按厂商整理的价格清单，并按
  上方汇率换算成人民币显示；每个换算后的单元格悬停时仍能看到原始的美元报价。没取到汇率时
  表格回退成美元并在列头标明单位，而不是硬凑一个自己都站不住的数字。厂商没有公布的价格显示为
  短横线（「没有标价」和「免费」是两回事）；公布为 `0` 的会额外标注「不一定是免费」，因为有些
  平台按 GPU 小时计费、根本不按 Token 标价。
- **价格来自厂商自己公布的地方**：这些厂商**没有任何一家提供价格 API**——它们的模型列表接口
  只返回模型 id、不含价格，价格只存在于官网 pricing 页面。默认源是
  [models.dev](https://models.dev)（它读的正是这些页面），页面会标明价格出自哪个源；
  配置 `rates.source: openrouter` 可切换成该网关自己的报价——覆盖模型更多，但不是各家官方价目。
  页面会写明当前是哪种口径，因为这两者的含义并不相同。
- **只列最主流的 15 家厂商**，按人工排定的顺序而不是按模型数量：实时列表有 59 家，多数是
  没人会去挑的单模型发布者，59 行的表同样算不上价目表。每家前面有一个用自家品牌色的两字母
  徽标，由页面自己绘制，因此完全离线可用；不在名单里的厂商也会拿到徽标，颜色由其名称哈希决定。
  `rates.vendors: 0` 可以放开限制、显示全部厂商。
- **手动填写**：任何一项价格、以及汇率本身，都可以直接改写——按表格当前显示的币种填写。
  手动值优先级最高，不会被后续刷新覆盖，在表格里带「手动」标记，也可以一键「恢复自动」或
  「清除」。另有一行自由录入，用于自动获取没覆盖到的模型。
- **离线是一种状态，不是错误**：宿主每 30 分钟刷新一次价格与汇率。刷新失败不会清空
  已有结果，而是把这次尝试标记为失败，因此被防火墙挡住时看到的是「上次已知价格 +
  可见的陈旧时间」，而不是一片空白。从未联网的宿主会明确说明并引导到手动录入；
  配置 `rates: false` 的宿主完全不发请求，页面就是一份你自己维护的价目表。

页面读两个仅限回环的路由：概览用 `GET /api/token-ledger/summary`，价格与汇率用
`GET|POST /api/token-ledger/rates`。概览每分钟轮询一次，价格只在切到费率页时才拉取。
两个路由都会拒绝非回环来源，因此即使 web 服务器绑定到 `0.0.0.0` 也不会外泄；
写入那半边还额外要求 JSON 内容类型（跨站表单发不出这种类型），并把请求体限制在 256 KiB。

它需要带 web 服务器的 profile（`web` 或 `desktop`）。没有的话 `/tokens` 与 CLI
照常可用，分区会明确说明而不是直接失败。

两个视图都**刻意不**通过设置命名空间下发：那需要 schema（一个真实依赖，而本包零依赖），
而且每次防抖都会用可推导、可重放的数据重写一遍 `settings.yaml`。
账本文件始终是唯一的记录来源，价格存在它旁边的 `rates.json` 里。

## 配置

按 `id` 覆盖组合条目：

```yaml
- id: token-ledger
  config:
    ledgerPath: 'D:/dsh/ledger.json'   # 默认 <DSH_HOME>/token-ledger/ledger.json
    backfill: false                     # 默认 true——启动时折叠已存历史
    rates: false                        # 默认 true——false 时完全不发网络请求
    # rates 也可以写成对象：
    # rates:
    #   source: modelsdev                # 默认各家官方价目；改成 openrouter 则用网关报价
    #   refreshIntervalMs: 1800000       # 默认 30 分钟
    #   perVendor: 3                     # 默认每厂商取最新 3 个
    #   vendors: 15                      # 默认只列最主流的 15 家；填 0 则列出全部厂商
    #   modelsUrl: 'https://…'           # 默认随 source——https://models.dev/api.json
    #   fxUrl: 'https://…/latest/USD'    # 默认 open.er-api.com
```

`rates: false` 会彻底关掉定价功能的联网，只保留手动填写的值——这正是严格离线环境
需要的配置。费率页本身照常可用。

## 它刻意不做的事

- **不算钱。** 它数 token，也展示价目表和实时汇率，但从不把两者相乘。一个费用数字
  需要把「按模型的 token 数」和「实际计费路由的价格」乘起来，而这两者都带着会让结果
  「错得很像对的」的近似。这笔账请拿你自己的账单数据去算。
- **不内置价目表。** 价格要么从一个可选的源联网取（默认是各家官方价目），要么你自己填。
  内置一份价目表几周内就会过期，而且每次更新都得发一个版本。
- **不注册面向模型的工具。** 工具 schema 会在每次请求上花提示词 token 并改变缓存前缀——
  对一个 token 记账插件来说这很荒唐。人类场景由 `/tokens` 与 CLI 覆盖。

## 兼容性

- **Node：** ≥ 22.15.0（CLI 需要解码 Zstandard 帧）。宿主端本身没有版本相关要求。
- **DSH：** 在 `0.1.2-rc.1` 上验证。所用到的接口面——`ctx.on`、`ctx.inject`、`ctx.get`、
  `ctx.effect`、`commands.register`、`sessionPersistence.list()/inspect()`——在 `0.1.2` 线上一致。
- **Profile：** 任意。没有 profile 相关代码。
- **网络：** 费率页会通过 HTTPS 取价格与美元汇率，但这完全是可选的：没有外网时仍然
  提供本机缓存的上次结果，手动填写的值照常可用，`rates: false` 则连请求都省掉。

## 卸载

```bash
dsh plugin --profile web remove @chenmiao8563/dsh-token-ledger
```

账本文件是**故意**不删的——要清空历史请自行删除 `<DSH_HOME>/token-ledger/`。

## 开发

```bash
npm install         # 两个 devDependency：react 与 react-dom，供渲染测试使用
npm test            # 96 个测试
npm run verify      # 打包不变式（零依赖、无安装脚本、无裸模块说明符）
```

`npm test` 使用 Node 内置测试运行器。在禁止逐文件 spawn 子进程的受限环境里，
改用 `npm run test:single-process`。

React **只是 devDependency**，消费者永远不会安装它：本包不带任何依赖、任何 peer
依赖、任何安装脚本，而 pnpm 不会为依赖安装其 devDependencies。它在这里的作用是让
浏览器端能用**真库**渲染并断言——这能抓到替身抓不到的东西：hook 顺序违规与非法
DOM 属性，React 会报出来，而手写的 `createElement` 会默默接受。没装它时这些渲染
测试会带明确原因**跳过而不是失败**，所以全新克隆、无网络也能跑 `npm test`。

实际验证了什么、怎么验证的（包括 fork 规则背后的证据）见
[docs/VERIFICATION.md](docs/VERIFICATION.md)。

## 发布

npm 现在强制每次发布都要 2FA，所以一个版本的首发必须交互式完成：

```bash
npm login
npm publish --access public --otp=<认证器里的 6 位数字>
```

首发之后，在 npmjs.com 上给这个包配 **Trusted Publisher**（包 → Settings →
Trusted Publisher → GitHub Actions，仓库填 `chenmiao8563/dsh-token-ledger`，
workflow 填 `release.yml`）。OIDC 没法在包存在之前配置，这就是首发必须手动的
原因。配好之后，打 tag 即可发布，**不需要存放任何 token**：

```bash
git tag v0.1.1 && git push origin v0.1.1
```

`release.yml` 会在版本已存在于 registry 时跳过发布步骤、但仍创建 GitHub
Release，所以重复运行是安全的。

## 许可证

MIT
