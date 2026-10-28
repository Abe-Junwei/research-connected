# S00–S40 落地审查

后续修复及当前未闭环项见[修复记录](./slice-fix-progress-2026-10-28.md)。下文保留审查时的发现，不用后来的局部通过覆盖历史结论。

审查日期：2026-10-28。对象为当前工作目录，不是历史提交差异。仅新增本报告，不修改生产代码、测试源码或路线图。原有未提交修改保留。

## 结论

当前产品已有可用的图谱、共享阅读、收藏/排除和 UI 修补，但尚未完成已确认首版合同。最大差距不是“只剩真实 Obsidian 验收”：S07–S34 多项能力仍停留在样本函数，生产入口保留旧身份聚合、按种子找项目、挂载内请求和撤销等规则。S39 应判为“部分接入且存在阻断缺陷”，S40 不可关闭。

路线图为 S00–S40，实际共 41 项（含基线）。按各片完整交付结果判断：

| 判定 | 数量 | 含义 |
| --- | ---: | --- |
| 已落地，限定证据范围 | 5 | S02、S03、S04、S06、S35；当前入口/离线或既有浏览器证据支持，不代表真实宿主全验 |
| 部分落地 | 19 | 有生产实现，但存在合同缺口、错误行为或集成验证不足 |
| 仅样本/未形成合同闭环 | 15 | 有函数及测试，核心新规则尚无实际产品路径 |
| 基线记录不足 | 1 | S00 未形成可恢复的当前脏代码快照 |
| 组合验收未完成 | 1 | S40；完整矩阵及真实宿主仍缺证据，且前置尚有缺口 |

这里的“仅样本”不等于代码没写，也不否认旧产品已有类似操作；它表示该片要求的新行为没有完成生产闭环。

## 审查口径、基线与证据

- 以[路线图](./implementation-roadmap-2026-10-28.md)和[整体方案第 4/11/12 节](./overall-improvement-plan-2026-10-27.md)为合同，结合本线程后来确认的 UI/安全行为。
- 后来确认的“收藏只改 staged、与阅读独立”“收藏/排除只留按钮和提示”“外改笔记暂停、确认后才写回一次”优先。没有把旧组合收藏菜单或外改自动写回当成缺失功能。
- 按单设备、多主面板、Reading view / Live Preview 的使用规模审查；跨设备并发、推荐请求、多种子、Canvas、Zotero 不属于本轮。
- Git CLI 因 Xcode command line tools 缺失无法执行。只读元数据得到当前分支 `slices/s02-s10`，ref 文件值 `847691adfa8b8c16b333f6d49da0b5c0f9bcf0ff`；这不是成功执行 Git 后确认的干净基线。路线图仍写 S00=`1599bf9`，两者不能混用。
- 当前 75 个文件的内容摘要：`a6c9edc0d749c24bbec9e5389c95d2e598875056ad1dd5db78e74ddf927caa37`。集合为排序后的根目录 package.json、esbuild.config.mjs、styles.css，src 下全部 .ts，scripts 下全部 .ts/.mjs；SHA-256 按“路径、NUL、内容、NUL”累计。摘要不是可恢复快照，也未覆盖 docs/preview/原始用户数据。
- 已追踪实际入口：[main](../src/main.ts)、[view](../src/view.ts)、[embed-block](../src/embed-block.ts)、[app](../src/app.ts)、[embed-mount](../src/embed-mount.ts)，并核对身份、项目状态、阅读、笔记写入、图谱构建、筛选、导出、详情、会话及对应验证脚本。没有逐行审查全部布局/相似度算法或所有第三方依赖。
- 使用 ponytail-audit 的只读审查流程；结论分别标明运行反例、调用链和缺失验收，不将搜索结果直接冒充行为验收。

### 本轮复跑

| 检查 | 结果与边界 |
| --- | --- |
| ESLint src/preview | 通过 |
| TypeScript --noEmit --skipLibCheck | 通过 |
| verify-architecture / verify-ui-contract | 通过；主要为依赖/源码结构约束，不证明新领域能力已接线 |
| 重建 verify bundle 后 verify --offline | 通过，UI 与 unit 均通过；malformed S2 日志是预设异常样本 |
| verify-plugin-state | 通过；内存假磁盘，覆盖迁移重读及串行保存，非真实 vault 恢复演练 |
| verify-reading-workflow | 通过；含部分同步、外改、改名后路径和重建服务，非真实宿主文件事件 |
| verify-feedback | 通过 |
| 浏览器页 | 本轮读取到既有 `controls=passed/result=passed`，未重新执行完整页面。上一轮在可见页面执行通过；不将其扩写为全宽度/主题/节点矩阵 |
| 生产构建 | 上一轮通过；本轮未重建生产包 |
| 新审查反例 | 通过内存 esbuild bundle 直接调用当前源码，见 F01/F02/F03/F04/F10/F13/F14 的实际输出 |

Node 检查通过 `OPENSSL_CONF=/dev/null node ...` 执行。没有连接真实学术 API、修改用户笔记、启动或操作真实 Obsidian。

## 逐片落地表

| 片号 | 判定 | 实际落地、证据与剩余项 |
| --- | --- | --- |
| S00 基线 | 记录不足 | 路线图有历史短 SHA，本轮能读取 Git ref 及计算内容摘要，但没有当前全部脏改动的可恢复代码快照与数据格式基线。不能据此认定迁移前置通过。 |
| S01 账本/样本 | 部分 | [身份验证](../scripts/verify-work-identity.ts)、[阅读验证](../scripts/verify-reading-workflow.mjs)、[浏览器验证](../scripts/verify-review-browser.ts)已有大量样本；缺“合同→生产入口→运行证据”的完整闭环，多个样本正确却未接线，且 S15 样本含错误合同断言，见 F13。 |
| S02 标识/key | 已落地 | [resolveWorkQuery](../src/work-identity.ts)、[DOI 处理](../src/paper.ts)、[导出 key](../src/export-graph.ts)已被真实路径使用；DOI 中 w 数字、平衡括号、混合文本、BibTeX 冲突样本通过。导出范围缺口另归 S24，不反推本片失败。 |
| S03 采样准入 | 已落地 | [neighborhood](../src/neighborhood.ts)在初次、二层、深挖及恢复检查非研究/撤稿，嵌入取数 key 包含撤稿设置；现有流水线验证通过。保存起点后撤稿的暂停不在此片，S23 仍缺。 |
| S04 缓存/视图 | 已落地 | [引用服务缓存](../src/citation-sources.ts)、[嵌入 key](../src/embed-syntax.ts)、[画布](../src/map-canvas.ts)均有实际调用；失败重试、显示 key 隔离、.02/.25/1/4/8 恢复与选定缩放命中检查通过。尚非所有设备的真实指针验收。 |
| S05 证据终态 | 部分 | 来源合并、不循环重入、请求失败淘汰及最多三页已有测试；界面仍把来源缺失显示成 OpenAlex，终态/partial 在详情中不完整，见 F16。 |
| S06 笔记索引 | 已落地 | [vault-note](../src/vault-note.ts)按真实路径检查，索引失效后读取新路径/字段，重复匹配给 alternatives；创建缓存延迟、改名、删除、外改与多匹配离线样本通过。真实宿主事件另归 S39。 |
| S07 身份证据 | 部分 | [confirmedVersionRelation](../src/work-identity.ts)与旧 sameWork 已区分，但生产 workIndex 仍调用后者按完整书目自动合并不同 DOI；没有可信跨版本关系适配与全库归属，见 F02。 |
| S08 人工归属 | 部分 | 主面板/嵌入都有“保持分开”，[图编辑](../src/graph-edit.ts)保留原始记录；没有全库人工合并、持久决定来源及撤销人工决定的完整 UI/持久化路径。releaseSeparatedRecords 仅样本使用，拆分仍是局部图操作。 |
| S09 缺失/冲突 | 仅样本 | holdSourceRelation 的 missing/conflict/negated 测试通过；无数据源报告→持久状态→待处理→动作的生产链。旧 identityConflicts 是聚合状态冲突提示，不能替代来源关系冲突。 |
| S10 稳定项目身份 | 部分 | projectWriteKey/writeProject 能保护部分旧键写入；normalizeProjects 重启把 seedId 重置为 key，调用方仍靠种子找项目，见 F03/F05。 |
| S11 版本状态/整项排除 | 部分 | 收藏、排除、恢复和种子保护已接；生产 paperStates 仍以聚合代表节点操作，没有版本选择、整项规则、未来版本及恢复例外的闭环，见 F08。 |
| S12 归属变化的排除范围 | 仅样本 | splitExclusion/mergeExclusion/assignMergedVersion 及测试存在；生产仍执行 reconcileProjectIdentity 的字段归并，无范围确认与来源继承入口，见 F08/F09。 |
| S13 待处理 | 部分 | [workflow-library](../src/workflow-library.ts)真实清单支持阅读冲突、笔记失败与三档确认；只消费 getReadingIssues，身份/排除范围未纳入同一清单，见 F09。 |
| S14 全库阅读 | 部分 | [reading-workflow](../src/reading-workflow.ts)已由 main/view/embed 共享，串行提交、失败反馈、收藏独立及跨同版项目基本成立；稳定项目身份与已确认跨版本共享仍不闭合，见 F03/F13。 |
| S15 归属/阅读联动 | 仅样本 | confirmVersionReading/splitSharedReading 仅测试；没有合并事件驱动新旧记录协调。editAfterVersionMerge 样本还会阻止明确降级，与合同相反，见 F13。 |
| S16 笔记同步参与 | 部分 | readNoteReading、文件 revision/raw 核对和删除/无效/回声处理已接。按用户后续要求，外改先暂停确认的行为已有测试，应保留；原方案“有效外改立即更新共享值”的旧文案需同步。真实缓存/事件时序未验。 |
| S17 多笔记部分同步 | 部分 | synchronize 在共享保存之后逐份写入，部分失败不回退，失败记录及外改暂停有离线测试；真实 processFrontMatter、笔记写入后状态保存失败/崩溃重开仍缺组合证据。 |
| S18 有限重试 | 部分 | 自动重试有累计三次上限，但新服务不重置会话预算，手动重试不受预算限制；与样本 helper 的重开语义不同，见 F14。 |
| S19 只读迁移预演 | 仅样本 | previewMigration 可输出冲突/范围并停止无效输入；main 不使用这个预演结果，生产先 normalize/reconcile，可能丢弃状态或延续旧聚合，见 F02/F04。 |
| S20 落盘恢复 | 仅样本 | fresh/stepMigrationDrill 是内存阶段模拟；生产实际仅部分 v1 身份迁移走保存重读，固定旧备份被复用，未提供本次纯 v2/混合完整备份与真实恢复演练，见 F01。 |
| S21 展示版本 | 仅样本 | chooseDisplayVersion/expandDisplayVersion 无产品调用；workIndex 选代表不依当前版本筛选/排除择版，详情只是记录来源列表，见 F10。 |
| S22 研究关系投影 | 部分 | 现有 canonicalizeWorkGraph 能合并来源及本地重算；新 projectResearchRelations 无产品调用，归属仍可由旧启发式决定，自引/版本事实没有完整详情与全局传播，见 F02/F06/F10。 |
| S23 撤稿起点 | 仅样本 | admitRetraction 无实际调用；loadNeighborhood 没有保存起点后来撤稿时的暂停/明确例外分支，见 F10。普通候选撤稿过滤已在 S03 落地。 |
| S24 导出范围 | 仅样本 | selectExportVersions/omitSeedExceptionLinks 未接；实际三种导出重新 workIndex，没有 one/all 与起点例外选择，见 F10。 |
| S25 项目级请求 | 仅样本 | open/commit/fail/switchProjectGraph 未接；app/embed 各自 generation，graph-session 的深挖锁也只属于一次挂载，见 F06。 |
| S26 共享图/独立视图 | 部分 | 项目通知确会刷新别的面板，但深挖分支 applyGraph(saved, project.currentView) 把对方视图带入，新增证据又不一定被同步，见 F06。 |
| S27 图外查看/笔记选择 | 部分 | 列表查看只开详情，多匹配笔记能选文件；缺先选具体版本再选文件/创建的完整流程，现有 exportPane 从聚合节点直接生成，见 F10。 |
| S28 手动保留 | 仅样本 | keepManual/dropManual 只在样本；实际项目无独立手动保留字段及加入/取消入口。查看不加入已成立，不能代替显式保留交付，见 F12。 |
| S29 批次撤回 | 部分 | DeepDiveBatch 真实保存来源、数量及添加论文；无撤回该批生产入口，dropDiveBatch 仅样本；无法验两批/手动来源叠加，见 F12。 |
| S30 成员合成/上限 | 仅样本 | composeMembers 未接。实际 restoreGraftedMembers 截断到 maxNodes-1 并挤出自动节点，深挖也在到上限时拒绝，违反“自动上限不丢明确保留”，见 F12。 |
| S31 同项目换起点 | 仅样本 | openSeedSwap/commitSeedSwap 未接；菜单仍调用普通 buildResolved，新图按新种子寻找/保存项目，见 F05。 |
| S32 项目共用撤销 | 仅样本 | saveUndoPoint/undoProject 未接；真实 undoCheckpoint 局限挂载，恢复旧排除/批次且保存未等待，见 F07。现有“撤销”不能作为新合同完成证据。 |
| S33 嵌入选项目/关联 | 仅样本 | applyEmbedAction/reopenEmbed 未接；语法无持久关联字段，收藏/排除直接使用图种子 ID，无一次选择/创建/取消闭环，见 F11。 |
| S34 嵌入独立/排除种子 | 仅样本 | followSharedReading/resumeEmbed/acceptEmbedGraph 未接；关联暂停不存在，且共用采样函数会参考项目并替换代码块种子，见 F11。 |
| S35 重命名/摘要/空状态 | 已落地 | Enter/blur/Escape、失败回滚、短长摘要及 ResizeObserver、空图导出已在实际组件落地，既有浏览器回归通过；不包含 F15 的普通“保存项目”成功反馈。 |
| S36 窄容器 | 部分 | 按容器断点、覆盖详情/返回、400/559 主面板与 559 embed 有浏览器断言；所谓 pointerHits 是元素命中检测后 DOM .click，不是可信指针操作，全矩阵及真实宿主未验。 |
| S37 键盘/焦点 | 部分 | 默认全图、主动选择淡化、全图恢复、Shift+F10/Escape、阅读菜单已实现并有测试；缺失的新版本/关联/共用撤销入口无法验，真实 Tab 任务链仍需完成。 |
| S38 主题/生产样式 | 部分 | 生产 CSS 加载检查、年份文字浅深对比、暂停/reduced-motion、四标签有浏览器断言；未覆盖全部按钮/强调色、所有边界和 6/50/300 节点，也无完整截图证据。 |
| S39 入口集成 | 部分、阻断 | 阅读 API、笔记路径安全、事件不再自触发保存、身份迁移重读保护已接；但多数 B/C 规则未接，迁移保护本身也有 F01–F04，不能声称只剩宿主检查。 |
| S40 组合验收 | 待完成 | 自动检查及既有浏览器回归通过，前置仍有生产缺口；真实宿主、完整矩阵、真实恢复/中断/两面板操作证据未完成。结论：不发布。 |

## 具体发现与最小修复建议

以下不是风格建议。P1 表示阻断已确认首版的正确性/数据安全问题；P2 表示行为或验收缺口。样本层错误会单独说明，避免误报为用户已可触达的故障。

### F01 · P1 · 本次迁移可复用历史备份，纯 v2 又绕过重读门槛

位置：[main.loadSettings](../src/main.ts:100)、[内存迁移演练](../src/project-state.ts:686)、[插件验证](../scripts/verify-plugin-state.mjs:17)。涉及 S19/S20/S39。

运行反例：已有固定身份备份内容 `OLDER BACKUP`，载入本次 v1 数据，得到 `newBackups=0,dataWrites=1`；纯 v2 且已有 readingWorkflow 时得到 `newBackups=0,dataWrites=0`。生产以“存在任意 v1 snapshot”控制迁移保存/重读，而不是本轮身份/范围/阅读合同的迁移状态；固定备份存在就跳过，不验证它是否对应本次输入。

最小修复：把现有预演接到真正切换前，创建本次完整且不覆盖旧文件的备份，记录本次迁移标识；对 v1/v2/混合统一执行一次迁移状态判断、写入及重读。补从真实磁盘输出重启、已有旧备份和各中断点的验证。无需新建迁移平台。不修会出现“有备份文件，但恢复不到本次迁移前数据”。

### F02 · P1 · 不同 DOI 的旧启发式仍自动成为同一研究

位置：[sameWork/workIndex](../src/work-identity.ts:26)、[canonicalizeWorkGraph](../src/graph-edit.ts:113)、[restoreGraphSnapshot](../src/project-state.ts:1178)。涉及 S07–S09/S19/S22/S39。

运行反例：当前 Nichols 旧快照包含两份不同 DOI、相同期刊题录记录，无可信跨版本关系；`restoreGraphSnapshot` 把 `input=2` 自动变成 `restored=1`。测试本身还要求这种自动合并。新增 confirmedVersionRelation 的注释明确说“不被 workIndex 使用”。

最小修复：生产身份映射区分同版本重复、确认的版本关系、人工决定及未确认旧聚合；不同 DOI 的书目匹配只能提示/待确认，旧原值继续保留。先修生产归属及旧测试预期，再接全库传播。只改 UI 文案不能解决阅读/排除/关系的错误归并。

### F03 · P1 · 换过起点的项目在重读后被改回旧 key

位置：[normalizeProjects](../src/project-state.ts:1243)、[projectWriteKey](../src/project-state.ts:201)、[主面板项目列表](../src/app.ts:911)。涉及 S10/S31/S39。

运行反例：`{W1:{seedId:'W9', ...有效项目数据}}` 经 normalizeProjects 后得到 `{W1:{seedId:'W1'}}`。内存中按 W9 写旧键的保护通过，不代表重启后成立。列表另有按 seedId 生成选择值，再用 `projects[seedId]` 读取的旧逻辑。

最小修复：归一化保留并验证 project.seedId，key 继续作为稳定身份；列表和动作传实际 project key，不把当前起点当索引。补“换起点→保存→新插件实例→列表选择→继续状态修改”的一条回归。不修会读错起点或让原项目不可选。

### F04 · P1 · 无效阅读字段会丢掉整条收藏/排除状态

位置：[normalizeProjects 状态过滤](../src/project-state.ts:1231)、[loadSettings](../src/main.ts:117)。涉及 S19/S39。

运行反例：一条 staged=true 的 W4245234602 状态仅把 reading 改为无效字符串，归一化前 key 为 `[W4245234602]`，之后 `paperStates=[]`。如果还有有效 snapshot，迁移检查只看项目还在，不会发现状态已丢；后续保存可能覆盖原记录。预演要求无效值明确停止，但生产没有消费其停止结果。

最小修复：迁移时保留该原始行并进入待处理，或在写入前明确停止；不能用 continue 丢整条版本状态。补“合法收藏/排除 + 无效阅读值 + 有效快照”的生产 loadSettings 反例。

### F05 · P1 · “设为种子”仍是打开/新建另一项目

位置：[seedItem click](../src/app.ts:1523)、[buildResolved](../src/app.ts:1417)、[persistProject](../src/app.ts:867)。涉及 S10/S25/S31。

具体路径：项目 A 中选 W2 设种子，调用普通 buildResolved(W2)，之后按新种子查项目并保存；没有把 A 的稳定 key、保留来源及状态作为这次换起点提交对象。若 W2 已有项目，会打开那个项目；否则可生成另一项目。

最小修复：将此入口接入现有项目级换起点提交，携带 A 的实际 key，最新完整结果成功后才替换 A；普通“打开另一个项目”仍保留独立路径。补 W2 已有/没有项目、连续两次换起点和失败三类入口测试。

### F06 · P1 · 多面板没有项目级提交，收到深挖通知还会覆盖自己的视图

位置：[挂载内 generation](../src/app.ts:1441)、[graph-session 深挖锁](../src/graph-session.ts:89)、[onProject](../src/app.ts:1660)、[view.saveProject](../src/view.ts:78)。涉及 S25/S26/S39。

具体路径：A/B 同项目分别请求，两个 generation 互不知晓，旧面板的晚到响应仍可保存；保存队列只保证磁盘写入顺序，不保证最新用户请求胜出。B 收到 A 的深挖数组变化时执行 `applyGraph(saved, project.currentView,...)`，把共享快照中的缩放/筛选/选择带入 B；仅证据变化而数组不变时，又没有完整采用新证据图。

最小修复：接入项目 key 所有的请求代次/完整结果提交；通知带项目身份，B 更新图和证据时保留 B 的本地视图，禁止拿共享 currentView 覆盖。用两个真实 mount 和可控延迟响应验证，不能继续用 publishSharedGraph 的纯函数样本代替。

### F07 · P1 · 真实撤销会回退排除/批次，且未保存就宣布成功

位置：[undoCheckpoint](../src/app.ts:220)、[undoEdit](../src/app.ts:1121)、[applyEdit](../src/app.ts:1090)。涉及 S29/S32/S39。

具体路径：建检查点后修改排除或撤回来源，再撤销，undoEdit 从旧 checkpoint 写回 excluded/deepDives；这与“只恢复上一组起点和采样图，应用最新状态/来源”相反。检查点只在当前 mount；另一主面板不可用。调用 applyGraph/persistSettings 没有等待成功，先清检查点并显示“已撤销”。

最小修复：用现有项目共用检查点保存起点/采样图，不恢复旧 paperStates/deepDives；撤销时合成最新排除与保留来源，保存成功再消耗检查点/显示成功，失败可重试。补两面板、检查点后改排除、来源撤回及失败反例。

### F08 · P1 · 聚合节点排除仍是一键排掉代表项，没有版本/整项语义

位置：[changeExclusion](../src/app.ts:1154)、[omitNode](../src/graph-edit.ts:30)、[updateProjectPaperState](../src/project-state.ts:336)、[嵌入 setExcluded](../src/embed-mount.ts:288)。涉及 S11/S12。

具体路径：多记录节点点击排除，omitNode 移掉整个代表节点，状态落到代表 id；没有选择具体版本，也没有“整项研究”、未来版本规则及单版恢复例外。reconcileProjectIdentity 的字段时间归并无法表达这些范围。

最小修复：在现有动作入口先确定具体版本或明确整项范围，接入已验证的 VersionScope 规则及其持久数据；恢复保留整项规则和单版例外。收藏仍保持独立，仅改所选版本 staged，不能重新加回组合收藏菜单。

### F09 · P1 · 待处理只接阅读问题，身份/排除范围无统一处置路径

位置：[pending 分支](../src/workflow-library.ts:58)、[getReadingIssues](../src/reading-workflow.ts:195)、[PendingItem 样本](../src/project-state.ts:316)。涉及 S09/S12/S13/S39。

具体路径：身份报告为 conflict 或新版本归属范围不明，appendPending/operationBlocked 没有实际调用，清单也只消费阅读问题。详情中的“已核对状态”只是清 identityConflicts，不能解决版本关系或范围。

最小修复：把这两类生产事件写入同一清单，展示原值、来源和具体选择；只阻断被点名的操作。浏览、阅读和收藏不应因无关身份问题全局停用。

### F10 · P1 · 版本筛选、起点例外、撤稿暂停与导出还没接入

位置：[nodeVisible/edgeVisible](../src/graph-filter.ts:33)、[exportPane](../src/app.ts:637)、[三种导出重新 workIndex](../src/export-graph.ts:8)、[loadNeighborhood](../src/neighborhood.ts:184)。涉及 S21–S24/S27。

运行反例：2020 起点 + 1990 普通节点，筛选 yearTo=2000；输出仍有起点、起点到合格节点的 edgeVisible=true，BibTeX 仍含 2020。实际没有“包含起点例外”和 one/all 版本范围选择；普通代表节点也不随版本筛选换成符合条件的正式版。已保存起点后来撤稿时，没有暂停重建/明确例外入口。

最小修复：让已有 chooseDisplayVersion/selectExportVersions/admitRetraction/关系投影的结果成为实际画布、统计、笔记及导出的输入；导出不再重新决定归属。分开“仅展示的起点”和“参与关系计算的版本”，为已保存撤稿起点保留旧图并提供明确决定。

### F11 · P1 · 未关联嵌入直接写同种子项目，自己的种子也可能被项目替换

位置：[EmbedSpec](../src/embed-syntax.ts:62)、[embed commit/setExcluded](../src/embed-mount.ts:283)、[嵌入加载](../src/embed-mount.ts:750)、[loadNeighborhood 项目起点替换](../src/neighborhood.ts:188)。涉及 S33/S34。

具体路径：无关联代码块的收藏/排除直接把图 seedId 传给项目写入，不先选择项目；多个同种子项目时只是拒绝/歧义，没有选择 UI。语法没有持久项目关联，排除种子暂停/恢复/解除也没有实际分支。共用 loadNeighborhood 又会读取同 key 或书目匹配项目，并把 seed 换为其 seedId，违背嵌入始终使用代码块种子。

最小修复：嵌入操作显式携带一次选择或持久 project key，未选时不写；只把项目状态用于明确关联的嵌入。取数函数接受明确的是否沿用项目起点语义，嵌入保持代码块起点，关联排除种子时先暂停在途提交。

### F12 · P1 · 手动保留/批次撤回尚无产品入口，恢复还会截断明确成果

位置：[ResearchProject](../src/project-state.ts:79)、[expandPaper](../src/app.ts:1215)、[restoreGraftedMembers](../src/neighborhood.ts:649)、[样本成员合成](../src/project-state.ts:935)。涉及 S28–S30。

具体路径：现有批次记录只有 additions；没有独立手动保留、取消来源、撤回批次闭环。恢复时 requested 被截为 maxNodes-1，余下 omitted；还从已有自动节点里挤掉成员，深挖在 maxNodes 时直接停止。合同要求上限只约束自动采样，明确保留可超额且需说明数量。

最小修复：先持久化现有已验证的成员来源，给两个实际动作入口；重建/撤销统一消费 composeMembers 或等价规则，自动采样先限额，再合成明确保留。同步检查现有 restoreGraphSnapshot 的 300 总节点硬限，否则保存后重开仍可能丢整个图。

### F13 · P1 · S15 样本把“明确降进度”误写成必须待确认

位置：[editAfterVersionMerge](../src/project-state.ts:445)、[S15 样本](../scripts/verify-work-identity.ts)、[collect](../src/reading-workflow.ts:74)。涉及 S15/S39。

样本反例：`editAfterVersionMerge('read','unread')` 返回 `{reading:'read',pending:true}`；合同明确要求合并后的直接修改立即采用最新意图，待处理的是后来合入的新版本旧值冲突。当前生产 collect 又只 find 第一个重叠记录，未执行初次合并最高值及后续新旧值协调。实测 W1=unread、W2=read，传入合并节点读取仍为 unread。

最小修复：区分“用户明确修改”和“新版本带旧值加入”两个事件；前者直接提交，后者依据合并历史决定初次最高/冲突。修正样本断言后再接身份事件；不能把当前错误样本当作已确认规则。

### F14 · P2 · 实际重试预算与样本不一致

位置：[synchronize](../src/reading-workflow.ts:143)、[retryReading](../src/reading-workflow.ts:208)、[样本重试状态](../src/project-state.ts:525)。涉及 S18。

运行反例：笔记持续失败，一次提交后手动重试五次，实际 `attempts=6,writes=6`。上限只在 auto=true 时检查，手动不受限；同一持久失败记录新建服务后又继续保留 attempts，未实现样本描述的“重开重新计数”。没有自动无限循环，但合同中的有限重试与重开预算尚未成立。

最小修复：明确并统一自动/手动每轮预算和新会话恢复规则，保留失败记录但不混用累计展示次数与当前轮预算；每次重试继续核对新修改。用 createReadingWorkflow 的实际返回 API 验证，不只测 SyncRetry helper。

### F15 · P2 · 普通“保存项目”未等待完成就显示已保存

位置：[persistProject](../src/app.ts:867)、[保存按钮](../src/app.ts:895)、[view.saveProject](../src/view.ts:78)。涉及 S14 的保存反馈原则及 S39。

具体路径：保存按钮调用返回 void 的 persistProject，立即改标签/样式为“已保存”；实际 deps.saveProject 尚未完成，失败以后只在 status 改提示。view 先把项目写进内存再等待落盘，失败不恢复这次项目图更新。上一轮修复捕获同步抛错，并未修正这个提前成功行为。

最小修复：现有 persistProject 返回 Promise，显式保存按钮等待成功后显示成功，失败保留错误；调用方按动作需要决定内存回滚或标未保存。补一个延迟后 reject 的实际按钮回归，不能只测回调同步抛错。

### F16 · P2 · 来源缺失仍伪装 OpenAlex，证据终态展示不完整

位置：[edgeSourcesText](../src/detail-cards.ts:437)、[loadSelectedEdgeEvidence](../src/app.ts:822)、[referenceEvidence](../src/citation-sources.ts:225)。涉及 S05/S22。

具体路径：旧直接边无 citationEvidence，来源文案 fallback 为“OpenAlex 采样”；相似边详情也可能经过该来源文案，不能由缺失事实推出服务确认。referenceEvidence 返回 partial，但 app 解构后只留 data；已完成空结果与未请求在 edgePairNeedingS2Context 仍都是“无 intents/contexts”。缓存防住了网络重复，却没有完整 UI 终态/局部重试说明。

最小修复：已知来源继续显示，缺失来源显示未知/待获取；每对关系保留请求状态与 partial，只有显式重试重新加载。复用现有请求 Map，不扩成通用任务框架。

## 为什么全绿不能关闭这些切片

1. [verify-work-identity](../scripts/verify-work-identity.ts)将许多新领域函数直接传入对象测试，不经过 main/view/app/embed 的生产动作；测试通过只证明样本规则可运行。
2. S15 的降级样本和旧启发式合并测试有合同偏差，继续沿用会把错误语义固化。
3. [verify-plugin-state](../scripts/verify-plugin-state.mjs)验证固定备份不覆盖，但没有证明“已有旧备份时创建本次备份”；正向断言不能替代这条反例。
4. [verify-ui-contract](../scripts/verify-ui-contract.mjs)不少检查基于字符串/正则，只能证明按钮/代码片段存在；不能证明项目身份、并发及提交语义正确。
5. [verify-review-browser](../scripts/verify-review-browser.ts)目前有效覆盖了一组真实渲染回归，但主面板窄宽仅 400/559、嵌入主要 559；elementFromPoint + DOM click 不是真实指针矩阵，也没有真实 Obsidian 文件/生命周期。

## 建议收束顺序

1. **先收回 S39“基本集成完成”的判断**：修 F01–F04，固定可恢复基线和完整迁移；保留现有阅读/收藏分离与 UI 修改，不边审边扩大界面范围。
2. **补齐身份/状态生产闭环**：S07–S15、S19–S24，先修错误样本，再接版本、范围、待处理、展示和导出。同一规则必须由主面板和嵌入共用。
3. **补齐项目动作及嵌入**：S25–S34，用两个实际 mount 验请求失效、独立视图、换起点、最新来源合成与共用撤销；不再用纯函数示例代替入口验收。
4. **再做 S39/S40 真组合验收**：验收库备份恢复、中断重启、真实笔记改名/外改、Reading view/Live Preview、多窗格，以及既定宽度/主题/节点矩阵。

没有实施以上修复，也没有提交或发布。未检查真实用户库、真实服务在线行为和完整视觉矩阵；现阶段缺口涉及迁移恢复与用户状态，不能将当前全绿解释为可安全切换整套首版合同。
