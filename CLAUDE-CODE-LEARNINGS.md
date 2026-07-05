# EK-Assistant vs claude-code 工程细节对比

> 调研日期：2026-07-05
> 对照对象：~/Desktop/claude-code 源码（1300+ 文件）vs EK-Assistant gateway/web
> 结论：EK-Assistant 的骨架方向是对的（forModel/display 双轨、权限分级、failover 熔断都有 claude-code 的影子），差距集中在**健壮性**（重试、看门狗、历史合法化）和**上下文工程**（缓存友好、压缩精度、错误回喂）这两类"细节堆出来的可靠感"上。

## P0 —— 直接影响"感觉不如 claude 稳"的问题

### 1. 没有 API 层重试，一个瞬时错误就废掉整轮

**claude-code**：`withRetry.ts` 默认重试 10 次，指数退避（500ms × 2^n + 25% 抖动，上限 32s），优先服从 `retry-after` header；408/429/5xx/overloaded/连接错误都重试；529 连续 3 次才切 fallback 模型。SDK 层 `maxRetries: 0`，重试完全自己控制。

**EK-Assistant**：`agent/loop.ts` 只有模型池 failover，池内单个 provider 零重试。且熔断条件（`textEmitted || toolStarted || persistedCount > 0`）意味着只要模型说过一个字或调过一次工具，后续任何瞬时 429/网络抖动都直接把整轮打死，用户看到"模型调用失败"。

**学**：在 `streamText` 之外包一层传输级重试——区分可重试错误（429/5xx/overloaded/连接中断）与不可重试错误（4xx 参数错），指数退避 + 抖动 + retry-after。重试发生在"本次 API 请求"粒度，不重放已执行的工具，与现有熔断不冲突。同时向前端 emit 一个 `retrying` 事件（claude-code 会透出 attempt/max_retries/delay），让用户看到"重试中"而不是卡死。

### 2. 没有流空闲看门狗，provider 挂住 = 整轮挂住

**claude-code**：`claude.ts` 流式空闲 90s 超时（`STREAM_IDLE_TIMEOUT_MS`），半程告警，超时 abort 后自动降级到非流式请求再试；事件间隔 >30s 记 stall 遥测。

**EK-Assistant**：`for await (part of result.fullStream)` 无任何超时。Gemini/OpenRouter 流挂住时，只能等客户端关页面触发 abort。

**学**：给 fullStream 消费加空闲计时器（每收到一个 part 重置），超时视为可重试错误进入上面的重试逻辑。

### 3. 长任务工具没有进度上报，卡片一"正在执行"就是几分钟

**claude-code**：`Tool.call(..., onProgress)` 回调链，Bash 每次有输出就 emit `{output, elapsedTimeSeconds, totalLines...}`，UI 实时渲染；进度消息只进 UI 不进模型上下文。

**EK-Assistant**：`search_kols` 等走 `pollTask` 轮询 backend 任务，动辄几分钟，期间前端只有一个静止的"正在执行"。`AgentEvent` 里根本没有 progress 事件类型。

**学**：加 `{ type: 'tool-progress'; toolName; data }` 事件，`pollTask` 每次轮询把 backend 返回的 status/message/耗时 emit 出去，前端卡片显示"已找到 32 个候选 / 视觉筛选中 / 已等待 1m20s"。这是用户感知差距最大、改造成本最低的一项。

### 4. 工具参数校验失败的回喂路径要焊死

**claude-code**：zod 校验失败不炸轮，格式化成祈使句错误（"The required parameter \`x\` is missing"）包在 `<tool_use_error>` 里、`is_error: true` 回给模型重试；注释直言 "surprisingly, the model is not great at generating valid input"。值级校验（validateInput）失败同样包法。

**EK-Assistant**：execute 内部抛错会被 loop.ts 捕获转成 `{ error }` 回喂——这条路是对的。但 **AI SDK 在 schema 层拒绝非法参数时走的是 stream error part → throw → 熔断**，等于模型手滑一次参数就废整轮。另外系统提示词第 11/15/16 条堆了一堆"参数名是 urls 不是 kolUrls"式的纠错规则，本质是在用 system prompt 补偿错误消息不够自解释。

**学**：①确认/接管 AI SDK 的非法参数路径（`experimental_repairToolCall` 或把 schema 错误转成 tool result），保证参数错永远回喂而不是炸轮；②错误消息学 claude 的写法——祈使句、点名字段、给出正确形态（"参数名是 \`urls\`，收到的 \`kolUrls\` 不存在"），错误自解释之后，系统提示词里第 15/16 条参数映射规则大部分可以删掉。

## P1 —— 上下文工程与提示词

### 5. 系统提示词不缓存友好，且职责放错了层

**claude-code**：对 prompt cache 有洁癖——每请求恰好一个消息级 cache 断点；AgentTool 曾因把动态 agent 列表写进 description 导致全队 10.2% 的 cache_creation 浪费，专门改成 attachment 注入。工具的使用指引写在各工具自己的 `prompt()` 里（Usage notes、"When NOT to use"、边界条件），system prompt 不管单工具细节。

**EK-Assistant**：①system prompt 里嵌了 `quotaSpent/quotaCap`，每轮都变 → 每轮都打穿 provider 的隐式缓存（Gemini/DeepSeek 都有 context caching，省的是真钱）；②18 条行为准则里 8/13/15/16/17 都是单工具参数指引，堆在全局提示词里，模型调工具时注意力未必在那。

**学**：①把配额等波动数据从 system prompt 挪到消息尾部（如每轮追加一条轻量 system-reminder 风格的 user 侧注入），system prompt 保持逐字稳定；②单工具规则下沉到各工具 description（search_kols 的 description 已经这么做了，把 15/16 条也搬下去）；③"何时不用这个工具"是 claude 工具描述里最值得抄的段落——比如 `send_outreach_batch` 的 description 里直接写清和 `send_single_email` 的分工。

### 6. 上下文压缩全面粗糙

**claude-code** 是三层防线：
- **microcompact**：先把旧 tool_result 原地替换成 `[Old tool result content cleared]`（保留最近 5 个），不动其他消息、不打 LLM——最便宜的一层；
- **autocompact**：token 逼近阈值（有效窗口 − 13k）才全量总结。总结 prompt 是 9 段式结构（用户所有显式请求、文件/代码、错误与修复、所有用户消息、未完成任务、当前工作、下一步且必须逐字引用最近请求防漂移），先写 `<analysis>` 草稿再输出 `<summary>`，并强制 "TEXT ONLY 不许调工具"；
- 压缩后重注入状态（最近读的文件 5 个/50k 预算、plan、skills），continuation 指令明确 "Resume directly — do not acknowledge the summary, do not recap"；
- 连续失败 3 次熔断，不再空烧 API；token 计数用"最近一次 API usage + 之后消息估算"的混合法。

**EK-Assistant**（`agent/compact.ts`）：纯 chars/4 估算（streamText 明明每步返回真实 usage，没用）；只有一层全量 LLM 总结；摘要 prompt 一句话、600 字上限；压缩失败只 console.error，下轮还会再试再失败；无 continuation 指令（模型压缩后容易复述摘要或重新问用户）。

**学**（按性价比排序）：
1. 每轮把 `result.usage` 落到 session 上，压缩触发用真实 token 数；
2. 加 microcompact 层：超过阈值先把旧 tool 消息 content 替换为 `[早期工具结果已清理，完整数据见界面卡片]`（EK 天然适合——完整数据本来就在 display 里），多数会话根本走不到 LLM 总结；
3. 摘要 prompt 结构化分段（用户目标与偏好 / 已找到的 KOL 与 projectId / 已建任务 ID / 邮件模板与发送状态 / 待确认操作 / 当前正在做什么 / 下一步逐字引用用户最近的要求）；
4. 摘要注入历史时带上 "直接继续当前任务，不要复述摘要、不要重新向用户确认已确认过的事"；
5. 压缩连续失败 N 次后本会话停试。

### 7. 大结果与空结果的处理约定

**claude-code**：超大 tool_result 落盘，只回 `<persisted-output>` 预览 + 完整文件路径，模型需要时可再读；空结果注入 `(<tool> completed with no output)` 占位——有事故记录（空 tool_result 会让某些模型误触 stop 提前结束）。

**EK-Assistant**：compactKol 语义截断是对的思路（比 claude 的暴力截断更懂业务），但截断后模型没有"取回完整数据"的途径；工具返回空数组时直接原样回喂。

**学**：①截断的 forModel 里带上明确标记和取回方式（"共 500 条，此处仅前 50 条摘要；如需检查更多条目请用 projectId=xxx 翻页/查询"）；②空结果统一占位（"搜索完成，0 个结果"而不是 `[]`），顺带告诉模型可以怎么调整条件。

## P2 —— 交互与健壮性细节

### 8. 用户拒绝确认卡片后，模型是聋的

**claude-code**：拒绝立即变成 `is_error: true` 的 tool_result 回喂，文案明确到行为层面——"The user doesn't want to proceed... STOP what you are doing and wait for the user to tell you how to proceed"，还支持用户附带拒绝理由（模型下一步直接按理由调整）。

**EK-Assistant**：pending action 的批准/拒绝走轮后的 REST（`routes/actions.ts`），模型本轮早已结束；拒绝这件事**不写入会话历史**，下轮模型完全不知道用户拒过、为什么拒，很可能再次发起同样操作。

**学**：拒绝时往会话历史 append 一条系统性 user 消息（"用户拒绝了操作 X，理由：...，除非用户主动重提，不要再发起"），UI 上允许拒绝时填一句理由。批准执行的结果同样应该落回历史（现在批准后的执行结果模型下轮也看不到）。

### 9. 同会话并发消息：409 拒绝 vs 排队

**claude-code**：运行中用户继续输入 → 进优先级队列（now/next/later），每个工具迭代间隙 drain 进上下文，模型下一步就能看到追加指令；ESC 还能把排队消息拉回输入框编辑；`now` 优先级可直接抢占打断当前轮。

**EK-Assistant**：`routes/chat.ts` 直接 409 "请等它完成"。搜索一跑几分钟，用户中途想补一句"只要美国的"只能干等。

**学**：最小版本：运行中收到的消息入队存库，本轮工具间隙（AI SDK 的 `prepareStep`/onStepFinish 时机）注入为追加 user 消息；做不到注入就先做"排队 + 本轮结束自动发出"，也比 409 好。

### 10. 历史合法化兜底

**claude-code**：resume 时 `ensureToolResultPairing` 双向修复——孤儿 tool_result 剥离、孤儿 tool_use 补 `[Tool use interrupted]`；中断路径保证每个 tool_use 都有配对结果。

**EK-Assistant**：增量落库设计得不错（onStepFinish 原子落一步），孤儿概率低，但进程崩溃/部分写入仍可能留下断链，目前只有 compact 切分点处理了孤儿 tool 消息，`loadHistory` 不做校验——一旦出现孤儿 tool_use，该会话每轮必被 API 拒绝，永久变砖。

**学**：`loadHistory` 加一个配对检查：assistant 的 tool call 后面没有对应 tool result 的，补一条合成的 error tool result（"执行被中断"）；开头是孤儿 tool 消息的剥掉。一次性小函数，换来会话永不变砖。

### 11. 中断时保留已生成的部分文本

**claude-code**：ESC 时把已流出的文本保留为 assistant 消息 + `[Request interrupted by user]` 标记，历史里能看到断在哪。

**EK-Assistant**：abort 直接 return，本步已流出的文本既不落库也无标记（前端可能显示过，刷新即消失）。

**学**：abort 分支把已累积的 text-delta 拼成 assistant 消息落库，附中断标记。

## 不建议照抄的

- **并发工具执行 / StreamingToolExecutor**：EK 工具都是 backend 任务型，串行 + pollTask 足够，并发编排收益小、复杂度大。
- **权限规则引擎**（allow/deny 规则匹配、settings 落盘）：EK 的四级 tier 是领域化设计，比通用规则引擎更贴合；最多补一个"本会话内同类操作不再重复确认"（对应 claude 的 accept-session）。
- **cache_control 手工断点**：EK 走的 provider（Gemini/DeepSeek）是隐式缓存，做好第 5 条的"提示词稳定"就够了，不需要手打断点。

## 优先级建议

| 批次 | 内容 | 理由 |
|---|---|---|
| 第一批 | #1 重试退避、#2 流看门狗、#3 工具进度、#4 参数错误回喂 | 全是"稳不稳"的直接来源，改动都收敛在 loop.ts/gate.ts/sse 事件 |
| 第二批 | #5 提示词分层与缓存稳定、#6 压缩升级、#8 拒绝回喂 | 上下文质量决定长会话表现 |
| 第三批 | #7 截断约定、#9 消息排队、#10 历史合法化、#11 中断保留 | 锦上添花的细节 |
