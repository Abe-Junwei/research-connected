# 文现网页版：交付与验证索引

截至 2026-11-08 的整理记录。中文名为「文现」，英文名保留 Research Connected。

## 已交付

- 正式入口：[graph.jieyu.ai](https://graph.jieyu.ai/)。最近一次部署验证 build 为 `a6852e7f0d8135e0`；API 协议版本 2。
- 文献导出与工作区备份（`a6852e7f0d8135e0`）：Web 与插件主视图/嵌入图统一导出范围、版本计数及下载/复制，新增 CSV，表格复制保持 Markdown；插件保留独立写入笔记。仅 Web 提供工作区 JSON 备份、预览确认恢复及清空前可选备份。恢复整体替换、不合并，校验/存储/编辑权/过期预览失败保留原状态；恢复后来源查询保持关闭，主动建图后再启用。正式 API、HTML 与界面已验证。服务端静态站点备份：`/var/backups/graph-export-backup-20261108T025349Z/site`；插件原资产备份：`/Users/junwei/.codex/backups/research-connected-export-20261108-074139`。详见 [验证记录](export-workspace-backup-2026-11-08.md)。
- 单工作区（`e529b4b38f753a69`，2026-11-08）：独立 Web 移除命名、项目菜单和手动保存，保留自动恢复、导出及确认清空。首次使用新存储命名空间从空白开始，删除旧项目存储及旧来源备份；阅读/版本记录不迁移。新图取得邻居且持久化成功才替换旧图，失败保留原图及视角。单工作区固定编辑锁保留只读/接管，并覆盖后台来源复核。升级与清空保留主题、浏览器身份和额度。新增存储与浏览器专项通过；线上页面确认无项目菜单/保存按钮。已安装 Obsidian 插件与原工作区 main.js 哈希一致，未更新插件。回滚目录：`/var/backups/graph-single-workspace-20261107T221955Z/site`。详细范围及验证见 [单工作区记录](web-single-workspace-2026-11-08.md)。
- 文献语言与项目恢复优化（`2853db376f34c9b3`）：连接词按文献 language 选择中文“和/等”或英文 and/et al.，缺语言时按标题文字回退。恢复项目的平面布局从重复计算三次改为一次，无节点筛选时跳过重复投影；恢复不重播展开动画，保留保存的视角。150 节点固定浏览器用例从 525–532 ms 降至 269–289 ms；覆盖年份布局、筛选、两帧后的缩放及恢复期间零文献接口请求。基础测试、构建、安全扫描及插件完整浏览器回归通过；线上页面确认英文引用使用 et al.；插件已安装重载。回滚目录：`/var/backups/graph-project-switch-20261107T214249Z/site`。
- 署名补查状态与连接词（`e1646346fd6b3649`）：OpenAlex 缺署名但有 DOI 的节点显示“署名待查”，详情异步补查时显示“正在查询署名”；仅在 Crossref 确认无贡献者后记录缺失，失败保留重试。两位图谱署名用“和”/and，三位以上用中文逗号/英文逗号连接前两位并加“等”/et al.。基础测试、构建与状态/格式专项浏览器回归通过；插件已同步安装重载。回滚目录：`/var/backups/graph-contributor-states-20261107T125038Z/site`。
- 多人图谱署名与坐标稳定修复（`41f339175459e0bd`）：两位作者/编者显示两位姓氏，超过两位显示前两位及“等”/et al.，保留编者角色；长署名换行并保留角色、等及年份。相同成员的图谱刷新不再无条件 reheat，避免保存/视图更新触发节点微移；新增节点和主动拖动仍保留正常物理调整。基础测试、构建与专项浏览器检查通过，正式站版本及多人署名已复验。回滚目录：`/var/backups/graph-labels-stable-nodes-20261107T124038Z/site`。
- 手机空图布局修复已发布（`598c870d140a7bb9`）：侧栏拖拽只写 CSS 变量，避免桌面内联宽度覆盖窄屏；折叠栏固定 40px，并移除隐藏 tabs 的网格占位。390/640/779px 空图与桌面键盘缩放专项通过，完整基础测试及构建通过。综合浏览器套件的既有“新项目标题”断言失败，在修改前的侧栏代码与样式上同样复现。真实 iPhone Safari 未复验。回滚目录：`/var/backups/graph-mobile-layout-20261107T123102Z/site`。
- 本次静态发布加入作者缺失时的 Crossref 编者补查、角色显示和导出修正，以及图谱交互性能优化。正式站已实际查询 `W2596888301` 并显示 Lauren Gawne · Nathan W. Hill（编）；版本接口与公网脚本 SHA-256 均核对一致。发布前完整站点备份：`/var/backups/graph-contributors-performance-20261107T121911Z/site`。
- 保留当前 VPS。Cloudflare 回源使用 Caddy 9443，8443 保留兼容；443 的 Xray 不动。静态文件位于 `/var/www/graph.jieyu.ai`，Web API 仅监听回环 9186，S2 服务为 9185。
- HTML 短时缓存，哈希资源长期缓存并提供 Brotli/gzip；API、health、版本信息不缓存。界面显示不等待额度或文献接口。
- Web 项目保存采用浏览器写锁和变更合并；保存失败保留旧数据；接管和取消使旧任务失效；重建失败保留旧图；保存后的扣次确认在有效期内幂等重试。
- 手机独立论文详情、返回图谱、单篇本地优先查询、复制失败时的可选文本回退。
- 文现名称、明暗载入页及持续 SVG 动效；减少动态效果时静态显示，不增加强制等待。

## 规格、部署与证据

| 内容 | 记录 |
| --- | --- |
| 已确认需求与 Web/插件边界 | [实施规格](standalone-web-spec-2026-11-06.md) |
| 部署配置与 CDN 缓存、回滚 | [边缘缓存记录](web-edge-cache-2026-11-07.md)、[Caddy 片段](caddy-graph.jieyu.ai.snippet.caddy) |
| 运行、功能、额度与存储排错 | [完整检查报告](full-audit-2026-11-07.md) |
| Safari 来源复核存储超限 | [专项修复](web-safari-source-storage-2026-11-07.md) |
| 首屏优化与数据 | [性能记录](web-performance-2026-11-07.md)、[最终审计测量](web-full-audit-startup-final-2026-11-07.json) |
| 真实数据源建图及扣次 | [线上建图结果](web-full-audit-live-build-2026-11-07.json) |
| 网络连接与传输分解 | [默认网络](web-full-audit-network-2026-11-07.json)、[浏览器直连](web-full-audit-network-direct-2026-11-07.json) |

旧的[部署准备](standalone-web-deploy-prep-2026-11-06.md)是上线前的历史快照；其 NXDOMAIN 和 8443 回源描述不作为当前状态。腾讯静态托管、香港部署研究保留供追溯，未采用迁移方案。

## 验证入口

基础回归为 `npm test`、`npm run build`、`npm run web` 和 `npm run test:web-quota`。Web 专项脚本位于 `scripts/verify-web-{storage,project-store,quota-client,session,theme,performance,secrets}.mjs`。

浏览器专项为 `verify-web-browser-local.mjs`、`verify-web-chrome-ux.mjs`、`verify-web-operations.mjs`、`verify-web-boot.mjs`，通过 Playwright 执行，默认需要本地 4190 静态服务。启动页脚本延迟真实 bundle，检查 12 秒多轮播放、后半轮持续变化、减少动态效果和挂载交接。生产建图脚本需显式设置 `WEB_SMOKE_DOI`，会使用真实来源额度及一次成功操作，不能混入普通离线回归。

## 边界与未完成事项

- 插件取消启动自动联网的改动位于另一工作区、分支 `slices/s02-s10`，单独提交；此 Web 分支不覆盖插件安装或合并另一分支。
- 本轮图例核查确认 Web 和插件均缺少高被引提示说明：旧提交移除了该行，但判定、计数和图上标记仍在。只完成核查，尚未恢复图例项。
- Safari 和真实移动设备尚未逐一实机验收；Chromium 桌面及触控模拟已检查。
- 首次连接和传输仍有网络波动；缓存命中不等于各地区均低延迟。S2 匿名访问仍可能限流。
- 完整 npm 审计存在开发期 lint 链的中等级告警；运行依赖审计为 0。未进行破坏性生产故障注入或耗尽公开额度的压力测试。


### 2026-11-08 compact export menu

Published build `6d0e7f777455ba65` (`web-WL7RBWNP.js`). Compact list/single-note grouping shared with plugin and embeds; table copy label simplified. Web-only backup menu explains current graph plus all retained records. Both builds and npm test passed; export/backup browser checks and plugin full browser suite passed. 390px iframe layout checked for scroll and sticky close; physical phone not checked. Production `/index.html?v=6d0e7f777455ba65` visibly verified; CDN root cached HTML has a short stale window. Rollback: `/var/backups/graph-compact-export-20261108T033602Z/site`.


### 2026-11-08 autosave status completion fix

Build `758bcc5425ada2af`, bundle `web-PDMR2XRR.js`, published and browser script URL verified. The Web store normalizes and dispatches the project event before returning; this can replace the current graph object, causing persistProject's completion identity guard to leave saving status stuck after successful writes. Single-workspace completion now also accepts the same seed in the same task generation and active slot, preserving revision/error checks. Plugin source and installed plugin unchanged. Regression now uses the real Web settings store and its project event; newly built graph autosave previously failed the completion assertion, now passes including save failures, retry and restore. Build, npm test and secrets checks passed. Actual fixture Web layout change showed autosaving then cleared it. Physical user browser was not inspected. Rollback site: `/var/backups/graph-autosave-20261108T035906Z/site`.
