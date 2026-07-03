# EK-Assistant 方案

## Context

现有EK系统（talent-marking-backend + easykol-web + efluns-browser-extension）覆盖了KOL达人营销的全流程：搜索发现、质量筛选、outreach邮件、发布数据追踪，但都是"人工点鼠标"完成的多步骤操作（例如搜索要设置一堆筛选项、outreach要一步步建模板/建收件人/发送/追踪、追踪要手动配置auto-update策略）。EK-Assistant 的目标是做一个**更自动化智能化**的新项目，用自然语言对话驱动这些工作流，同时参考 `claude-code`（工具系统+权限模型、记忆分层、多智能体、上下文压缩、成本追踪、计划模式）和 `openclaw`（Gateway控制平面、多渠道、定时自动化+结果投递、Skills可插拔）这两个项目的架构设计。admin端不在参考范围内。

已对齐的产品决策：

- **产品形态**：对话式Agent为主 + 保留强确定性操作（邮件真正发送前确认、报表查看）的手动UI —— "两者结合"
- **与backend关系**：复用talent-marking-backend现有API作为Agent工具，不重写业务逻辑
- **第一期渠道**：先做Web对话界面
- **MVP四大场景**：KOL搜索与相似发现、质量筛选/打分、邮件outreach自动化、任务与数据追踪

## 关键技术发现（决定架构的事实依据）

1. **backend实际是单体Fastify app**（`apps/scrawler`，非NestJS），通过环境变量叠加开启多个角色（Producer默认HTTP / Worker / Track / Background / Shop-Parser / Cron，非互斥开关），本地用`start.sh`只起Producer+Worker。
2. **backend有两套鉴权面**：
   - `/api/*`（主面，业务全覆盖）—— Supabase JWT，`Authorization: Bearer <token>`，和easykol-web用的是同一套（`src/middlewares/auth.ts`）。
   - `/external/v1/*`（专为程序化/第三方集成设计）—— `ek-api-key`+`ek-api-email` header鉴权，但**覆盖不全**：有KOL解析、Similar创建/轮询、intelligent-search（仅TikTok/YouTube/Instagram）、video信息、kol-emails（邮箱**提取**，非发送）、audience受众分析、quota查询、小宇宙source-reports。但没有outreach邮件**发送**、没有发布数据追踪、没有质量分接口。
3. **结论：EK-Assistant应该走`/api/*` + 用户自己的Supabase JWT**，而不是`/external/v1`的API-Key面。理由：(a) `/external/v1`覆盖不了邮件outreach和发布追踪两大MVP场景；(b) EK-Assistant是给EK内部/登录用户用的，不是给外部集成商用的，用用户自己的JWT调用`/api/*`，行为、配额、审计都和用户手动操作完全一致，不需要额外发API Key；(c) 这正是easykol-web自己调用后端的方式，最省事、风险最低。
4. **create→poll是backend统一的异步任务模式**（`POST .../create` + `GET .../:taskId`），贯穿搜索、相似发现、追踪、审核等所有耗时操作 —— 这是EK-Assistant工具层可以复用的统一原语。
5. **质量分（Quality Blogger）没有独立对外接口**，判定逻辑在`src/services/kolAiTagging/quality.ts`的`validateKolQuality()`，是唯一真源（核查确认：全仓只有两处内部调用，无任何路由引用）。EK-Assistant不在客户端复刻这个阈值逻辑（会漂移），**决策：backend加一个薄薄的只读接口把这个函数包出来**——函数本身就是几条简单阈值判断，包接口是小时级工作量，不设"客户端近似判断"的兜底方案。MVP需要backend配合的改动共两块：这个质量分只读接口 + 场景5的评论拉取/导出接口（见场景5），其余全部复用现存接口。
6. **平台覆盖缺口**：backend的intelligent-search/相似发现目前只支持TikTok/YouTube/Instagram，抖音只是追踪场景里的一个枚举值，小红书只有短链转换。MVP的"KOL搜索与相似发现"场景先只覆盖这三个平台，抖音/小红书发现留到backend补上后再接入。
7. **OpenAPI spec在`/api/swagger/json`**（非生产环境暴露），easykol-web用`pnpm openapi`从这里生成TS类型 —— EK-Assistant的工具层用同样方式生成类型化client，不用手写请求。
8. **邮箱授权（Gmail OAuth）天然是跳转式UI流程**，没法纯对话完成 —— 这部分保留为手动UI操作，属于"两者结合"里要保留的强确定性环节。
9. **backend已有`/api/copilot`"托管任务"接口**，它就是web端"全自动找博主"（`/auto-task`）的后端：传projectId+hostedTaskType+kolDescription+filters创建托管任务，后台自动持续找人，支持stop/resume/轮询详情（`routes/api/copilot.ts`）。它是单一场景的自动化托管，与EK-Assistant的对话式多工具Agent定位不重叠，**应作为现成工具直接封装接入，不要重复造**。
10. **搜索/相似发现/评论拉取等"只读"操作在backend是按quota计费的** —— "只读"不等于"免费"。Agent权限分级必须引入成本维度，否则一轮对话自动发起多次搜索会静默烧掉用户积分（见下文权限分级）。

## 架构设计

```
EK-Assistant Web (React, 对话界面 + 关键操作确认/结果展示卡片)
        │ SSE/WebSocket (流式) + REST
EK-Assistant Gateway (Node/TS, Fastify)
  ├─ Agent Loop        —— 组装system prompt、维护会话、把模型返回的tool call分发给工具、把结果流回前端
  │                        （循环结构参考claude-code的QueryEngine.ts：assemble prompt → stream → dispatch tool → feed back；
  │                          模型层用Vercel AI SDK做多供应商抽象，不绑定任何单一模型，见下）
  ├─ Tool Registry      —— 每个工具=名字+JSON Schema+handler，包一层talent-marking-backend的/api/*端点
  ├─ Permission Gate    —— 工具按风险+成本分级，参考claude-code的hooks→rules→风险分类器→confirm四段式（claude-code实际实现里rules和confirm之间还有一层启发式风险分类，非纯三段）
  ├─ Cost Meter         —— 参考claude-code的cost-tracker：跟踪本会话工具调用消耗的backend配额，执行消耗配额的工具前告知预估消耗，超过单会话上限需用户确认
  ├─ Session Store      —— 会话历史+按(user, project)持久化的轻量记忆（当前项目/常用筛选偏好）
  │                        + 上下文压缩与token预算（参考claude-code services/compact与query/tokenBudget：长会话逼近上限自动压缩；KOL列表类大工具结果按工具语义截断，不整段塞上下文）—— 一条搜索结果就是几十个KOL的数据，这在MVP就会撞上下文墙，不是二期问题
  └─ Scheduler (MVP: 1个每日摘要recipe) —— 参考openclaw的定时能力，复用backend Track-pod"30秒轮询"式的简单loop，不引入额外框架；结果投递与失败通知参考openclaw cron/delivery-plan（定时任务产出可靠回投到对话、失败时通知用户，而不是静默丢失）
        │ Authorization: Bearer <user's Supabase JWT>  （原样转发，像多一个前端一样）
talent-marking-backend  /api/*  （不改动，除1个新的质量分只读接口）
```

**模型选型与Agent Loop实现（已定：不用Claude，候选DeepSeek/Gemini）**：

- **模型抽象层用Vercel AI SDK**（TypeScript的`ai`包：`streamText` + `tools` + 多步agent循环）。这不是新引入的依赖——**talent-marking-backend的AI基建本来就是Vercel AI SDK搭的**（`src/infras/ai/`：`generateText` + `@ai-sdk/google-vertex` + `@ai-sdk/openai-compatible`，统一模型编码`UnifiedModelCode`，`generateTextWithFailover`多模型故障转移，现有模型池Gemini/Qwen/OpenRouter），团队已熟悉，公司已有Vertex计费通道。EK-Assistant的Gateway沿用同一套模式，工具定义写一遍（Zod schema），换模型改一行provider配置。
- **主模型建议Gemini、DeepSeek做成本备选**，理由：对话式Agent的核心负载是**长链路工具调用**（一轮对话串起搜索→筛选→存库→发信确认），2026年主流评测里Gemini 3系在工具调用可靠性（BFCL等）上明显强于DeepSeek——DeepSeek开源模型里Agent能力最强、便宜，但复杂指令+工具循环场景比Gemini掉链子更多。加上backend已在生产用Gemini（`gemini-2.5-flash-lite`是默认failover首选），主Gemini是风险最低的选择。DeepSeek通过AI SDK的first-party provider或OpenRouter接入，作为低成本fallback/简单任务分流，上线后用真实工具链路做A/B再定最终配比。
- **不用任何厂商的Agent SDK/框架**（Claude Agent SDK是CLI导向单用户，LangChain类框架对这个场景过重）：多用户/多会话的服务端场景就是"AI SDK streamText + tool循环"手写一个精简版QueryEngine，claude-code的QueryEngine.ts只作为**循环结构与权限设计的参考**，不构成API依赖。
- system prompt与工具描述编写时注意**不依赖特定模型的方言**（如Anthropic的XML偏好），保持供应商中立，这样A/B换模型时行为漂移最小。

## 工具目录（Tool Registry）与对应backend端点

| 工具 | 风险分级 | backend端点 |
|---|---|---|
| `search_kols` | 只读但**消耗配额**，执行前告知预估消耗 | `POST /api/search/v2/web-search` + 轮询 |
| `find_similar_kols` | 只读但**消耗配额**，执行前告知预估消耗 | `POST /api/similars/create` + `GET /api/similars/:taskId` |
| `check_kol_quality` | 只读，自动执行 | **新增**：薄封装`validateKolQuality()`的只读GET接口 |
| `manage_email_template` | 可逆写操作，自动执行+活动日志可见 | `POST/GET /api/emails`、`PATCH /api/emails/:id/*`（更新走子资源，无裸PATCH） |
| `send_outreach_batch` | **高风险，需用户在UI里显式确认后才真正执行** | `POST /api/auto-email/import`、`POST /api/email-manage/templates/followup` |
| `get_outreach_status` | 只读，自动执行 | `GET /api/auto-email/stat`、`GET /api/emails/records`、`GET /api/outreach-dashboard/overview`（无裸`/`路径） |
| `track_publications` | 可逆写操作，自动执行 | `POST /api/publicationStatistics/task/track-new` + 轮询 |
| `get_tracking_results` | 只读，自动执行 | `POST /api/publicationStatistics/publications`、`/summary` |
| `list_my_tasks` | 只读，自动执行 | `GET /api/tasks/unterminatedTasks`、`POST /api/tasks/batch` |
| `save_kols_to_project` | 可逆写操作，自动执行+活动日志可见 | `/api/kols/user/collects`、`/api/projects`、`/api/projectkol`、`/api/tags`（收藏/分组/打标，接口现成） |
| `manage_auto_kol_task` | 创建消耗配额需告知；stop/resume自动执行 | `/api/copilot`（现成的"全自动找博主"托管任务：创建/轮询/stop/resume） |
| `export_comments` | 只读但**消耗配额**，执行前告知预估消耗 | **新增**：拉取并导出某条(批)视频的全部评论（Excel） |
| `analyze_comments_feedback` | 只读，Agent侧分析，无需backend改动 | 基于`export_comments`返回的评论文本做主题/情感分析 |
| `compare_campaign_performance` | 只读，Agent侧分析 | `PublicationStatisticsSheetData` + KOL自身历史视频数据 + `POST /api/publicationAiAnalysis/batch`（扩展） |

所有工具共享一个通用的`callBackendTask(createEndpoint, pollEndpoint, params)`异步原语（对应backend统一的create→poll模式），单个工具只需声明端点和参数schema。

**权限分级（风险+成本两个维度）**：
1. 只读且不消耗配额的查询 —— 全自动执行。
2. **只读但消耗配额**（搜索、相似发现、评论拉取等，backend按quota计费）—— 自动执行前告知预估消耗，并设**单会话消耗上限**，超限需用户确认。"只读"不等于"免费"，这是从claude-code的cost-tracker借鉴的教训：不做这层，Agent一轮对话自动发起多次搜索就会静默烧掉用户积分。
3. 可逆写操作（存模板草稿、建追踪任务、收藏/打标）—— 自动执行，但记录到用户可见的"活动日志"。
4. 真正**发送邮件**（不可逆、面向真实达人）—— 必须走UI里的确认卡片，用户点确认后Agent才调用`send_outreach_batch`。批量发送场景借鉴claude-code的**计划模式（Plan Mode）**交互：Agent先产出"发给哪些人、用什么模板、何时跟进"的完整计划卡片，用户批准整个计划后才逐步执行——比逐条确认体验更好，也比单个确认按钮信息更充分。这直接落地"两者结合"的产品形态。

## 场景5（新增）：评论反馈分析 与 投放效果归因分析

现状痛点：投放效果监测目前只有纯数字（播放/点赞/评论数），评论区的真实用户反馈只能靠人工一屏一屏截图丢给AI看；合作视频比达人平时表现好/差，也没有工具去分析原因。

### 5.1 评论导出 + AI反馈分析

**backend现状核查**：
- **TikTok/YouTube**的API客户端（`api/tiktok.ts`、`api/youtube.ts`及`lib/youtube*.ts`）已有`getVideoComments()`方法，能拉到评论原文，但目前只在`ytbInfo.service.ts`/`ttInfo.service.ts`里被用来提取**评论者身份**（用于找相似达人），评论文本本身没有被持久化，也没有Comment数据模型，没有导出能力。
- **Instagram没有现成的评论拉取方法**（`lib/instagram*.ts`中无同类实现）——Instagram的评论导出是从零建设，不在"接水管"范围内。
- 结论：对TikTok/YouTube这不是从零建设，是"接上一段已经打通但被浪费掉的水管"——把已有的`getVideoComments()`调用扩展成分页拉全量评论、保留文本，再复用backend已有的Excel导出模式（`config/exportColumns/*.ts`，已用于kol/publication/competitor导出）新增一份`exportColumns/comments.ts`。**评论功能MVP范围定为TikTok/YouTube两个平台**，Instagram待backend补上拉取能力后接入。

**需要backend新增（中等工作量，非重写）**：
- 一个"拉取某视频全部评论"的create→poll任务接口（沿用统一的任务模式），返回`{author, text, likeCount, publishedAt}[]`
- 一个评论Excel导出接口（复用现成的导出基建）

**EK-Assistant侧**：
- `export_comments`工具：调用上面的接口，用户可以直接拿到Excel，或者
- `analyze_comments_feedback`工具：把评论文本喂给Agent，产出"用户对产品的正面反馈/负面反馈/高频问题"摘要——这一步纯粹是LLM能力，不需要backend再做NLP/情感分析

### 5.2 合作视频 vs 达人平时表现对比归因

**backend现状核查**：
- 合作视频的完整数据（`title`、`description`、`publishDate`、`views/likes/comments/favorites/shares`、`engagementRate`）已经存在`PublicationStatisticsSheetData`模型里，不缺字段。
- 达人自己近期视频的同维度数据也已经存在KOL记录里（`kol.tiktokUser.videos` / `kol.youtubeChannel.videos`，每条视频都有播放/点赞/评论等字段），可以直接算出"平时表现"基线，不用新抓数据。注意：视频明细是以**JSON数组字段**存储的（非规范化表），基线计算需在应用层解析这个数组，无法用SQL直接聚合——实现小成本，但要有预期。
- **意外发现**：backend已经有`POST /api/publicationAiAnalysis/batch`（"批量创建投放视频分析任务"），支持传入自定义`prompt`对视频做AI分析——目前主要给小红书/抖音/B站场景用来判断"提没提到播客/提了哪些权益点"，但"传自定义prompt+videoIds、AI分析视频"这个模式可以直接复用/扩展，不需要另起一套。

**EK-Assistant侧**：
- `compare_campaign_performance`工具：数值对比部分（合作视频指标 vs 达人历史视频中位数/百分位）用确定性代码计算，不让LLM猜数字；再把对比结果+视频标题/描述/发布时间等上下文一起交给LLM做"为什么表现更好/更差"的归因推理。
- 是否需要backend放开`publicationAiAnalysis/batch`的平台限制（目前偏小红书/抖音/B站）以支持TikTok/YouTube/Instagram，或者单独开一个不限平台的轻量分析接口，属于需要和backend同学对齐的实现细节，不影响EK-Assistant这一层的设计。

## EK 全量功能覆盖矩阵（"涵盖所有已知功能"的验收依据）

产品需求是EK-Assistant要涵盖现有EK的所有已知功能（admin除外）。为避免"既没覆盖、也没说不做、也没排期"的三不管地带，此处盘点easykol-web与efluns-browser-extension的**完整功能面**，每项归入四类：**A=MVP工具化**、**B=后续迭代（backend接口现成，工具化成本低）**、**C=有意保留手动UI**（"两者结合"形态中的确定性环节）、**D=明确不做（附理由）**。

### Web端

| 现有功能 | 归类 | 说明 |
|---|---|---|
| 智能搜索/AI搜索（`/webSearch`、`/intelligentSearch`） | A | `search_kols` |
| 找相似及细分搜索（关键词/标签/BGM/关注/粉丝列表） | A | `find_similar_kols`（细分模式作为工具参数暴露） |
| 质量筛选 | A | `check_kol_quality` |
| 邮件outreach全套（模板/批量/群发/明细/跟进） | A | `manage_email_template` / `send_outreach_batch` / `get_outreach_status` |
| 投放效果监控（`/dataManagement/easykolTrack`，含自动更新与AI分析） | A | `track_publications` / `get_tracking_results` |
| 任务列表 | A | `list_my_tasks` |
| KOL收藏库/项目分组/打标/成员分配（`/settings/exportCreators`） | A | `save_kols_to_project`——Agent找完人的自然下一步就是"存进项目、打标"，缺了这环链路会断；接口现成（`/api/kols/user/collects`、`/api/projects`、`/api/projectkol`、`/api/tags`），零backend改动 |
| 全自动找博主（`/auto-task`） | A | `manage_auto_kol_task`——直接封装backend现成`/api/copilot`托管任务，零backend改动 |
| 评论反馈分析、效果归因（场景5） | A | **已定：并入第一期MVP**；评论侧MVP覆盖TikTok/YouTube（Instagram待backend补拉取能力） |
| 竞品追踪（`/competitorTrack`） | B | backend走`/api/tasks/competitorTrack/*`，接口现成 |
| 批量查询（`/audience`）、链接转名单（`/search/web-list`） | B | "贴一堆链接帮我查"天然适合对话式，二期接入 |
| 博主去重（`/settings/excludeList`）、Excel/Google Sheet导出、达人详情页、分享页`/s/:id` | B | 现成接口逐步工具化 |
| KOL打款全套（打款管理/海外打款/看板/达人自助填表/Clip追踪审核） | C | 资金合规操作，强确定性，保留手动UI；后续最多给Agent开只读查询 |
| 配额充值/VIP/订阅支付 | C | 支付必须走UI；但Agent必须能**读**配额（Cost Meter的成本告知依赖它） |
| 邮箱OAuth授权 | C | 跳转式流程，保留手动UI（提案原有决策） |
| 企业/团队管理、CPM设置 | C | 低频管理配置，手动UI性价比更高 |
| 多语言（中/英） | 横切 | EK-Assistant自身的对话与UI需中英双语，与EK现状对齐 |
| admin端全部功能 | D | 需求明确排除 |

### 插件端

| 现有功能 | 归类 | 说明 |
|---|---|---|
| 侧边栏（找相似/AI搜索/建联采集） | B | 第一期只做Web对话界面；二期把Assistant对话嵌入插件侧边栏（对应"多渠道"迭代） |
| 页面注入能力：达人信息卡InfoCard、笔记卡、AI视觉筛选、Profile报告、TikTok Shop达人采集、8+平台（YouTube/TikTok/Instagram/Threads/X/Twitch/LinkedIn/TikTok Shop）注入采集、Google Sheet一键导出、悬浮按钮 | D | 这些是"浏览器内实时采集与页面增强"能力，本质依赖用户正在浏览的页面上下文，对话式Agent不适合也不应替代；插件继续独立存在，与EK-Assistant共用同一backend与账号体系 |

**结论**：MVP的4+1场景加上补入的`save_kols_to_project`、`manage_auto_kol_task`两个零成本工具后，Web端"找人→筛人→存人→建联→追踪"的高频完整工作流全部覆盖；B类均为接口现成的低成本迭代项；C类是有意保留的手动环节；D类给出明确理由。后续验收"是否涵盖所有已知功能"以本矩阵为准。

## 项目结构与工程约定

- 新建独立项目 `/Users/apple/Desktop/EK/EK-Assistant`，遵循EK现有惯例：**不用共享根workspace**，自己的`pnpm-workspace.yaml`（`apps/gateway`后端 + `apps/web`前端），自己的lockfile。
- 根目录新增 `start-assistant.sh` / `stop-assistant.sh`，仿照`start.sh`模式（起EK-Assistant自己的服务，同时依赖`talent-marking-backend`已在3000端口跑）。
- 建新分支开发，不动`main`；backend那1个新接口的改动单独走`talent-marking-backend`的分支+PR。
- Gateway用Fastify（和talent-marking-backend技术栈一致，团队已熟悉），Web前端用React+TS（是否复用easykol-web的AntD主题体系待定，倾向于保持独立轻量，不引入easykol-web整个主题系统）。
- Agent工具层的backend client用`pnpm openapi`同款方式从`/api/swagger/json`生成类型，不手写请求。
- 模型接入沿用backend `infras/ai`的做法：Vercel AI SDK + 统一模型编码 + 环境变量控制模型池与failover顺序（如`ASSISTANT_MODEL_FAILOVER_ORDER=gemini-x,deepseek-x`），换模型/调配比不改代码。

## 明确不做（MVP范围外）

- 抖音/小红书的KOL搜索发现（backend尚未支持，等backend补上）；Instagram的评论导出（backend无现成拉取能力，待补）
- 插件侧边栏对话、Slack/飞书等多渠道（第一期只做Web对话界面）；插件的页面注入类能力（信息卡/笔记卡/AI视觉筛选/各平台采集等）不由EK-Assistant替代，理由见覆盖矩阵D类
- 完整的OpenClaw式Skills动态加载平台（4个场景是确定的，工具注册表保持可扩展即可，不建复杂的插件系统——过度设计）
- 邮箱OAuth授权流程的对话化（保留现有手动UI）

## 待确认的开放问题

- ~~EK-Assistant要新建Git仓库吗？~~ **已定**：`git@github.com:iftechio/EK-Assistant.git`
- ~~场景5是并入第一期MVP还是fast-follow？~~ **已定：并入第一期MVP**。backend需同步排期评论拉取（create→poll）+评论Excel导出两个接口（TikTok/YouTube）。

## 验证方案

1. 本地跑通：`start.sh`起talent-marking-backend(3000)+easykol-web(3001)，新增`start-assistant.sh`起Gateway+Web。
2. 用测试Supabase账号登录EK-Assistant Web，跑一条端到端对话链路：
   - "帮我在YouTube上找10个美妆类相似达人" → `find_similar_kols`工具创建任务并轮询出结果
   - "筛掉不是优质博主的" → `check_kol_quality`逐个判定
   - "给筛出来的人发一封合作邀约邮件" → Agent先创建模板+准备收件人列表，弹出确认卡片，用户确认后才真正调`send_outreach_batch`
   - "这几个人发布之后帮我盯着数据" → `track_publications`建立追踪
   - "这条合作视频的评论都在说什么" → `export_comments`拉取评论 + `analyze_comments_feedback`产出正/负面反馈摘要
   - "这条视频比他平时表现好还是差，为什么" → `compare_campaign_performance`数值对比+归因分析
3. 核对每一步Agent调用的backend端点和参数与`talent-marking-backend`源码逻辑一致。
4. 确认高风险工具（发送邮件）在没有用户确认前不会被Agent自动触发——这是权限模型最核心的验证点。
5. 确认消耗配额的工具（搜索/相似发现/评论拉取）执行前展示了预估消耗，且单会话消耗达到上限后会要求用户确认——成本维度的验证点。
6. 长会话验证：连续多轮搜索把大量KOL结果塞进对话后，上下文压缩正常触发、会话不崩、历史结论仍可引用。
