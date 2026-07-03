# EK-Assistant

对话式 Agent 驱动 EasyKOL 工作流：KOL 搜索发现、相似达人挖掘、邮件 outreach、发布数据追踪、评论反馈分析与效果归因。设计方案见 [PROPOSAL.md](./PROPOSAL.md)。

## 结构

```
apps/gateway   Fastify Gateway：Agent Loop(Vercel AI SDK) + Tool Registry + Permission Gate
               + Cost Meter + Session Store(Postgres)
apps/web       React 对话界面：Supabase 登录 + SSE 流式 + 确认卡片 + 结果卡片
```

调用链：Web → Gateway(SSE) → Agent Loop → 工具 → talent-marking-backend `/api/*`（用户 Supabase JWT 原样转发，行为/配额/审计与手动操作一致）。

## 本地启动

1. 先起 backend：EK 根目录 `./start.sh`（:3000）
2. 配置 `apps/gateway/.env`（照 `.env.example`，必填 `ASSISTANT_DATABASE_URL` 和至少一个模型 API Key）
3. EK 根目录 `./start-assistant.sh`（Gateway :3002 + Web :3003）

首次启动 Gateway 会自动建表（`assistant_*` 前缀，不动 backend 的表）。

## 权限分级（风险 + 成本）

| 级别 | 行为 | 工具 |
|---|---|---|
| 只读免费 | 全自动 | get_outreach_status / get_tracking_results / list_my_tasks / analyze_comments_feedback / compare_campaign_performance |
| 只读耗配额 | 告知预估消耗；单会话超上限需确认 | search_kols / find_similar_kols / export_comments |
| 可逆写 | 自动执行 + 活动日志（GET /api/activity） | manage_email_template / track_publications / save_kols_to_project |
| 不可逆 | 必须 UI 确认卡片批准 | send_outreach_batch |

## 与方案的已知偏差

- **评论接口为同步实现**（`POST /api/videoComments/fetch|export`，maxCount≤1000）：新增 TaskType 枚举值需要 Prisma 迁移，本期不动 schema；待枚举扩充后迁移到统一 create→poll 模式。
- **效果归因的基线**取自该达人其它已追踪发布（而非 KOL 记录里的历史视频 JSON）；后者等 backend 暴露只读接口后切换。
- **不做每日摘要定时推送**：方案里的 Scheduler recipe 已移除，外联/投放数据由用户在会话里主动查询。
- 工具层 backend client 为手写轻量封装；`pnpm --filter @ek-assistant/gateway openapi` 可在 backend 本地运行时生成 OpenAPI 类型（后续迭代接入）。

## 验证

```
pnpm typecheck   # 两个 app 的 tsc
pnpm test        # gateway vitest
```

端到端验收路径见 PROPOSAL.md「验证方案」。
