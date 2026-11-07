# 文现网页版：交付与验证索引

截至 2026-11-07 的整理记录。中文名为「文现」，英文名保留 Research Connected。

## 已交付

- 正式入口：[graph.jieyu.ai](https://graph.jieyu.ai/)。最近一次部署验证 build 为 `a76aa6e1a5a8614c`；API 协议版本 2。
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
