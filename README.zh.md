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

## 配置

按 `id` 覆盖组合条目：

```yaml
- id: token-ledger
  config:
    ledgerPath: 'D:/dsh/ledger.json'   # 默认 <DSH_HOME>/token-ledger/ledger.json
    backfill: false                     # 默认 true——启动时折叠已存历史
```

## 它刻意不做的事

- **不做定价。** 它只数 token；折算成钱需要一份会过期的价目表。要钱就配一个计费插件。
- **不注册面向模型的工具。** 工具 schema 会在每次请求上花提示词 token 并改变缓存前缀——
  对一个 token 记账插件来说这很荒唐。人类场景由 `/tokens` 与 CLI 覆盖。
- **0.1.0 不带 UI。** 宿主端与 CLI 就是契约；浏览器端计划在 0.2 作为纯增量加入。

## 兼容性

- **Node：** ≥ 22.15.0（CLI 需要解码 Zstandard 帧）。宿主端本身没有版本相关要求。
- **DSH：** 在 `0.1.2-rc.1` 上验证。所用到的接口面——`ctx.on`、`ctx.inject`、`ctx.get`、
  `ctx.effect`、`commands.register`、`sessionPersistence.list()/inspect()`——在 `0.1.2` 线上一致。
- **Profile：** 任意。没有 profile 相关代码。

## 卸载

```bash
dsh plugin --profile web remove @chenmiao8563/dsh-token-ledger
```

账本文件是**故意**不删的——要清空历史请自行删除 `<DSH_HOME>/token-ledger/`。

## 开发

```bash
npm test            # 49 个测试，无需安装任何依赖
npm run verify      # 打包不变式（零依赖、无安装脚本、无裸模块说明符）
```

`npm test` 使用 Node 内置测试运行器。在禁止逐文件 spawn 子进程的受限环境里，
改用 `npm run test:single-process`。

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
