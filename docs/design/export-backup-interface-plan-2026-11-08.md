# 文现：导出与备份界面，已确认的设计范围

最初草案阶段仅做设计；后续已按确认方案实施，验证记录见文末。延续当前暖白、深灰、紫色点缀、系统中文无衬线、细边框的产品风格。只设计导出菜单及备份菜单/对应窄屏面板，不重画整张图谱，不加装饰背景、logo 或整页营销 UI。

## 信息架构

顶栏有两个独立入口：「导出文献资料」「备份与恢复」。用同一界面方案的两种打开状态展示，不把二者误做一个大混合菜单。当前界面的截图是改造前参考。

### 导出文献资料

两组内容，第二组不继承第一组的范围选项。两个区块之间要有非常明确的分隔，控制属于哪一组一眼可辨。

第一组标题「文献列表」。说明「题名、作者、年份、DOI 等文献资料」。标注输出「文献文本资料」，不要让用户误认为是图谱文件。

有可见字段标签「导出哪些文献？」。默认值「当前筛选结果 · 23 篇」，另一个选项「当前图谱全部文献 · 50 篇」。不能只写“当前”或“所有”；“全部”只指当前图谱的成员，不能暗示所有历史项目或整个文献库。

可见标签「版本选择」。默认「每项研究仅导出当前展示版本」，另一项「导出所有符合条件的版本」。计数根据范围与版本选择变化。示例：当前筛选、展示版本为 23 条；当前图谱全部、展示版本为 50 条；当前筛选所有版本可用 27 条示例。不要把篇数和版本条目数混在一起。选项显示研究篇数，结果摘要显示实际文献记录条目数。

结果摘要「本次导出 23 条文献记录」，脚注「已排除的文献不导出」。下面三个行项目：
- 参考文献：BibTeX，动作「下载 .bib」「复制」
- 结构化资料：YAML，动作「下载 .yaml」「复制」
- 文献表格：动作「下载 .csv」「复制」，不展示 Markdown 格式说明；复制内容保持现有格式

第二组标题「单篇文献笔记」。明确「仅下方这一篇，不受列表范围影响」。小标签「当前选中的文献」，显示完整题名「The morphosyntax of verb stem alternation」，允许自然换行，不用省略号遮掉所有关键内容。未选中时小标签变成「种子文献」。说明「包含文献信息和阅读状态的 Markdown 笔记骨架」。动作「下载 .md」「复制笔记骨架」。插件内另有「写入 Obsidian 笔记」，仅作为可见说明/插件状态展示，不在网页版中冒充已有按钮。

### 备份与恢复

标题「当前工作区备份」，类型/用途标签「JSON · 用于恢复图谱」。说明「当前这一张图谱 + 全部保留的整理记录」。显示种子题名「Evidential Systems of Tibetan Languages」，示例「50 个节点 · 68 条关系」。

必须视觉分清包含范围：
- 当前图谱：文献节点与关系、收藏/排除、深挖、筛选与视角。
- 跨图保留的记录：全部阅读状态和版本记录。

醒目的主动作「下载工作区备份 .json」。邻近的简短说明「恢复时节点会重新排布，布局与视角会保留」。说明它是可恢复的数据备份，不是图谱截图；不要新增图片、SVG、PDF 导出。

下方分隔后是「从备份文件恢复…」。最底部以低调危险样式呈现「清空工作区…」。均进入现有确认流程，不要把普通下载画成危险操作。

## 响应式/交互

桌面菜单约 400–460px 宽，两组内容有层级，不做大型独立设置页。触屏/390px 窄屏使用全宽底部面板或小型页内面板，44px 左右触摸目标，可滚动，固定清晰标题和关闭按钮，底部动作不会被浏览器工具栏挡住。格式行在窄屏可标题一行、按钮下一行，不能挤成三列细字。桌面可保留紧凑同行动作。

在同一 draft 里做可点击演示：打开两个入口、切换范围和版本更新数量、显示选中文献/种子状态。下载/复制动作只能显示“设计演示”提示，不真的触发文件下载、剪贴板或数据清除。可附桌面与手机展示切换，以便用户在一个预览里检查相同方案，不是多种美术风格的变体。

不增加项目保存和切换、云同步、自动备份历史、节点坐标备份或图谱图片导出。页面注明「界面草案 · 示例数据」。

## 草案与验证（v3）

- 可交互预览：https://p.superdesign.dev/draft/69fe2811-5db0-4ec4-bff3-81ef8682de55
- 设计画布：https://superdesign.dev/teams/ba181599-d479-4ea1-b06c-02b497e7c282/projects/03973bb8-06c2-4b1f-977e-b974178b7938
- 桌面并排展示两个入口的打开状态，正式产品仍是两个独立入口，不会将两个菜单常驻展开。
- 验证：筛选结果/展示版本为 23 条；切换当前图谱全部 + 所有符合条件版本后显示 56 条；单篇题名不随列表范围改变，备份始终标明当前一张图谱和全部阅读/版本记录。数字仅为示例。
- 手机画布实测宽 390px，按钮触摸高度 44px；导出与备份面板可切换，关闭后可重新打开。
- 演示动作只提示，不触发真实下载、剪贴板、恢复或清空；未修改正式产品代码、插件或线上部署。
- 尚未在真实 iPhone Safari 内验证；这是界面设计评审，实际功能验证在实施后进行。

## 紧凑版调整（v5）

- 桌面导出菜单：同为 440px 宽，高度从 760.5px 降至 525px，减少约 31%。备份菜单从 482px 降至 398px。
- 减少面板内边距、分组留白及格式行高度；范围标签与选择器同行，单篇文献标签与题名同行并允许题名自然换行；没有删除分组、作用范围或条目数说明。
- 桌面和手机的文献表格行均只显示“下载 .csv”“复制”，没有 Markdown 提示；复制行为不变。手机面板不做密度压缩。
- 浏览器核对：切换完整图谱仍更新为 50 条，单篇文献仍独立；手机菜单文案已核对。本轮仍仅更新设计草案。


## Implementation verification — 2026-11-08

- Compact shared export sections implemented in Web and plugin, including embeds. Table copy label is simply 复制 / Copy.
- Web backup menu displays current graph identity and distinguishes graph data from all retained reading/version records.
- Both builds and npm test passed. Browser export/backup regression and plugin full browser regression passed. Workspace atomic replacement, storage isolation and secret checks passed.
- Web build `6d0e7f777455ba65`, bundle `web-WL7RBWNP.js`; live index.html entry verified. CDN root entry may briefly serve its previous cached HTML.
- Remote rollback backup: `/var/backups/graph-compact-export-20261108T033602Z/site`.
- Installed plugin assets backed up at `/Users/junwei/.codex/backups/research-connected-compact-export-20261108-113540`, replaced and plugin reloaded.
