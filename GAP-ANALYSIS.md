# EK-Assistant 三端功能对齐差距分析

> 调研日期：2026-07-04
> 调研范围：EK-Assistant（gateway + web）、easykol-web、efluns-browser-extension、talent-marking-backend
> 对照基准：PROPOSAL.md「EK 全量功能覆盖矩阵」（A=MVP工具化 / B=后续迭代 / C=保留手动UI / D=明确不做）

## 结论摘要

问题分两类：

1. **展示层完成度只有一半**——12 类工具结果展示中 7 类退化成裸 JSON，多个写操作完全没有反馈卡片，核心结果默认被折叠，确认卡片刷新后丢失。这是「功能在 agent 端展示表现不好」的直接原因。
2. **功能覆盖存在缺口**——A 类（MVP 承诺）有 4 项实现不完整；B 类（承诺后续迭代、接口现成）一项都没做；web 端多个高频操作和插件端多个纯 API 能力未对齐。

---

## 一、展示层问题（P0）

工具结果渲染总入口：`apps/web/src/components/ToolCard.tsx`（按 `display.kind` switch）。

### 1.1 有定制卡片的 kind（6 类）

| kind | 组件 | 说明 |
|---|---|---|
| `kol-list` | KolListCard | 最完整：头像/粉丝/平台指标/邮箱标记，网格预览 12 个，可展开表格（前 100），支持下载 CSV |
| `comments` | CommentsCard | 评论列表（前 100）+ 下载 Excel（透传 backend xlsx） |
| `outreach-stat` / `tracking-summary` | StatCard（共用） | number/string 字段渲染成 stat 网格 |
| `performance-comparison` | ComparisonCard | 指标对比表格（本条/基线中位数/倍数/百分位） |
| `comment-analysis` | 无独立组件 | 裸 `<pre>` 渲染 LLM 分析文本，未结构化 |

### 1.2 退化成裸 JSON 的 kind（7 类）

走 `ToolCard.tsx` default 分支 → JsonCard，裸 `<pre>` 截断 3000 字符：

| kind | 所属工具 | 影响 |
|---|---|---|
| `email-templates` / `email-template` | manage_email_template | 高频场景，模板列表/详情是一坨 JSON |
| `send-result` | send_outreach_batch | 发真实邮件这种关键动作没有像样的结果反馈 |
| `outreach-records` | get_outreach_status | 有 statistics/list 结构却没有表格 |
| `tracking-list` | get_tracking_results | 投放明细无表格 |
| `track-created` | track_publications | 追踪任务创建结果无卡片 |
| `task-list` | list_my_tasks | 任务列表无卡片 |
| `collect-result` | save_kols_to_project | 收藏结果无卡片 |

### 1.3 其他体验硬伤

1. **多个写操作 action 不返回 display**：create_project、move_to_project、create_tag、set_followups 等在界面上只体现为步骤行「已完成」，无任何内容反馈。
2. **结果卡片默认收起**：`MessageView.tsx` 的 StepsPanel 把工具执行渲染为可折叠面板，有 display 的行要点击展开才渲染 ToolCard——搜出来的 KOL 列表这种核心产出被埋没。
3. **确认卡片刷新丢失**：pending action 已落库，但 `GET /api/sessions/:id/messages` 重建历史时只映射文本与 display（`apps/web/src/components/Chat.tsx:93`），不重建未决 confirmations——刷新页面后待确认的发信卡片消失（backend 仍可通过 action id 确认，但用户无入口）。
4. `comment-analysis` 的 LLM 输出未结构化（正/负面反馈、高频问题应做成分区卡片）。

---

## 二、功能覆盖缺口

### 2.1 A 类（MVP 承诺）但实现不完整

| 项 | 现状 | 位置 |
|---|---|---|
| 找相似的细分模式（关键词/Hashtag/BGM/关注列表/粉丝列表） | 矩阵承诺「作为工具参数暴露」，实际 `find_similar_kols` 只支持 URL/账号 | `apps/gateway/src/tools/search.ts`；backend 接口现成（`/api/ttInfo/hashtag|bgm|followingList|followersList` 等） |
| 轻量记忆（按 user/project 记住偏好） | **死代码**：`store.setMemory` 全代码零调用，`getMemory` 只读不写，记忆永远为空 | `apps/gateway/src/session/store.ts:292` |
| 配额感知 | Cost Meter 用本地硬编码上限（默认 200）计数，从不调 backend 读真实配额余额 | `apps/gateway/src/cost/meter.ts`；backend 有 `/api/quota/user-info`、`/api/userMember/quota/remaining` |
| 效果归因基线口径 | 基线取「该达人其它已追踪发布」而非 KOL 记录历史视频 JSON（README 已知偏差，基线 <3 条提示置信度低） | `apps/gateway/src/tools/performance.ts:11` |
| OpenAPI 类型化 client | 手写轻量封装，`pnpm openapi` 脚本存在但未接入 | `apps/gateway/src/backend/client.ts` |

### 2.2 B 类（承诺后续迭代、backend 接口现成）——全部未做

| 功能 | backend 接口 |
|---|---|
| 竞品/对标追踪 | `/api/tasks/competitorTrack/create|refresh|list|:taskId|:taskId/creators` |
| 受众分析 / 批量链接查询 | `/api/search/audienceAnalysis[/triple|/export]`、`/api/tasks/audience-tasks` |
| 链接转名单 | `/api/ins|ttInfo/url-list` 等 |
| 博主去重（排除名单） | `/api/excludeList/statistic|export` |
| Excel/Google Sheet 导出 | `/api/tasks/download/create|:taskId`、`/files/{csv,excel}/:filename`、`/api/userConfig/export-columns` |
| 达人详情、分享页 | `/api/kols/:id`、`/api/snapshot/share` |

### 2.3 web 端有、Assistant 没有的高频操作

| 功能 | web 端位置 | backend 接口 | 说明 |
|---|---|---|---|
| 智能搜索 Pro 交互链路 | `/intelligentSearch` | `/api/intelligent-search/parse|refresh-counts|more-words`、`/api/canonical-search/suggest` | 一句话 → AI 解析标签 → 勾选/推荐更多词 → 实时命中数 → 按勾选数定批次。Assistant 的 `search_kols` 直接盲调 `/api/search/v2/web-search`，缺「先给用户看解析结果再确认」环节——这本是最适合对话式的交互 |
| 发送明细管理 | `/email/sendDetails` | `/api/auto-email/cancel-many|reassign-paused|list`、`/api/email-manage/plans/:id/cancel|resume` | Assistant 只能查（stat/records）不能管（取消待发/恢复暂停/重新分配） |
| 追踪管理操作 | `/dataManagement/easykolTrack` | `/api/publicationStatistics/update-batch|delete-batch|update/:id` | 批量更新/删除/自动更新配置未对齐 |
| AI 视频分析 | VideoTrack 内 | `POST /api/publicationAiAnalysis/batch`、`GET /task/:taskId` | 自定义 prompt 对帖子批量 AI 分析；PROPOSAL 曾提到 `compare_campaign_performance` 可复用此接口，实际未用 |
| KOL 评分/态度 | 搜索结果页/收藏库 | `/api/projectkol/rate|rate-all`、`/api/kols/collects/attitude` | 找完人的自然下一步，未对齐 |

### 2.4 插件端可对齐的纯 API 能力

页面注入类能力（信息卡/采集等）按矩阵 D 类不由 Assistant 替代——合理。但以下能力不依赖页面上下文，纯 API 可对齐：

| 能力 | backend 接口 |
|---|---|
| 受众分析（单达人） | `/api/publicationStatistics/audience`、`/api/search/audienceAnalysis` |
| 虚假粉丝/互动检测 | `/api/ins/audience-fake[/export]`、`/api/ins/post-fake` |
| KOL 邮箱批量提取 | `/api/tasks/kol-emails[/:taskId|/list]`、`/api/kols/:id/fetchEmail` |
| 报价预估（CPM 分布） | `/api/userConfig/cpm-distribution` |
| AI 润色发信 | `POST /api/emails/sendWithPolish` |
| 标签 + 笔记 | `/api/tagAndNote/*`（Assistant 现只用了 `/api/tags`，无笔记能力） |

### 2.5 实现与 PROPOSAL 的端点差异（小问题，留档）

- `manage_email_template` 实际用裸 `PATCH /api/emails/templates/:id`（PROPOSAL 称「无裸 PATCH，走子资源」）。
- `list_my_tasks` 实际是 `GET /api/tasks/user/unterminatedTasks`（PROPOSAL 写 `/api/tasks/unterminatedTasks`）。
- `compare_campaign_performance` 未使用 PROPOSAL 提到的 `POST /api/publicationAiAnalysis/batch`。

---

## 三、建议改造路线

| 阶段 | 内容 | 特点 |
|---|---|---|
| **P0 展示层翻新** | 补齐 7 类 JSON 卡片；写操作反馈卡片；确认卡片刷新恢复；核心结果默认展开策略；评论分析结构化 | 只动 EK-Assistant 前端（+少量 gateway display 补充），见效最快，直接解决「展示表现不好」 |
| **P1 高频功能补齐** | 真实配额读取（Cost Meter 接 `/api/quota/user-info`）；发送明细管理（取消/恢复/重分配）；找相似细分模式；追踪管理操作；KOL 评分 | 全部接口现成，工具层扩展 |
| **P2 B 类工具化** | 竞品追踪、受众分析、批量链接查询、导出（Excel/Google Sheet）、博主去重 | 全部接口现成 |
| **P3 体验升级** | 智能搜索 Pro 对话化（parse → 标签确认卡片 → 搜索）；记忆功能接线；假粉检测/邮箱提取/AI 润色发信等插件端能力对齐 | 交互设计工作量为主 |

---

## 附：关键文件索引

**EK-Assistant**
- 工具注册：`apps/gateway/src/tools/registry.ts`（12 个工具）；类型/权限：`tools/types.ts`
- 权限门：`apps/gateway/src/permissions/gate.ts`；Agent 循环：`agent/loop.ts`；压缩：`agent/compact.ts`
- 存储：`session/store.ts`；配额：`cost/meter.ts`；backend client：`backend/client.ts`
- 展示层：`apps/web/src/components/{ToolCard,ConfirmCard,MessageView,Chat,Workspace}.tsx`

**easykol-web**
- 路由：`src/App.tsx`；智能搜索：`pages/intelligentSearch`；发送明细：`pages/email/sendDetails`；投放追踪：`pages/VideoTrack`

**talent-marking-backend**
- 路由入口：`apps/scrawler/src/routes/api/index.ts`；任务底座：`routes/api/task.ts`（create→poll 统一模式）
