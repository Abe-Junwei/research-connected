# Web 载入优化：保留现有部署

后续已完成 Cloudflare 根因修复、首页边缘缓存、CSS 内联及更新缓存保护，详见 `web-edge-cache-2026-11-07.md`。本文保留第一轮诊断与测量，下面的“尚待解决”描述的是当时状态。

2026-11-07。用户已取消香港迁移。仅调整正式 Web 的构建、HTML 和 graph 专用 Caddy 路由；未更改共享图谱算法、插件、API 业务逻辑、密钥、额度账本、DNS 或系统代理。

## 诊断与依据

- rushi.app 的响应由 GitHub Pages/Fastly 提供，HTML 包含完整内容，无外部首页脚本。本次 HTML 有边缘缓存 HIT；并不意味着其所有资源始终命中缓存。
- graph 原 HTML 为 no-store，JS/CSS 为 1 小时缓存；公网静态响应均观察到 Cloudflare DYNAMIC。测量中暖访问资源已是零传输，但 HTML 仍需约 0.65 秒，挂载只增加约 20–30 毫秒。优先减少网络往返，不拆图谱核心或引入框架。
- 源码确认本地恢复已不等待 API，来源复核只针对质量版本变化或超过一天的记录。没有再次去掉质量检查，也没有把 API 失败伪装成成功。
- Cloudflare 默认不缓存 HTML，设置源站 max-age 不等于启用边缘缓存；DYNAMIC 静态资源仍需检查 Cache Rules、开发模式等，尚未证实具体原因。[官方缓存行为](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/)、[未缓存排查](https://developers.cloudflare.com/cache/troubleshooting/investigating-uncached-responses/)。

## 已实施

1. 公共 HTML 可缓存 60 秒，允许 stale-while-revalidate 300 秒。HTML 不含个人项目或会话数据；API、health、version.json 均保持 no-store。
2. 内容哈希 JS/CSS 设置一年 immutable；旧文件继续保留。新文件先上传，HTML 最后替换，不强制刷新正在使用的页面。已有版本兼容检查继续工作。
3. 主程序在 head 预加载，并以 defer 执行，下载与文档解析并行；回归确认只下载一次，不阻塞解析或依赖模块执行顺序。
4. HTML 自带启动说明与 noscript 提示，JS 延迟时不再只剩空容器。主界面挂载后替换说明。完整 CSS 仍是渲染阻塞资源，因此不宣称 HTML 一收到即可绘制。
5. Web CSS 用已有 esbuild 压缩，约 109 KB→92 KB；共享 styles.css 不改。
6. Node 内置 zlib 在构建时生成 Brotli/gzip 文件，Caddy file_server 优先提供预压缩资源。JS gzip 118,113 字节、Brotli 98,207 字节；CSS gzip 14,975 字节、Brotli 12,962 字节。公网实际编码由 Cloudflare 协商决定，不把文件体积当作每次必然传输量。[Caddy 文档](https://caddyserver.com/docs/caddyfile/directives/file_server)。
7. 非哈希静态资源单独匹配，缺失 JS/CSS 返回 404，不再把首页当作脚本返回。
8. 浏览器回归发现 info 点击区域仅 32px、外部点击可能被图谱停止冒泡；Web 适配层修复为 44px 透明图标区域和捕获阶段判断，保持无按钮外观。

## 测量方法与初步结果

`npm exec --package=playwright@1.48.2 -- node scripts/measure-web-startup.mjs`，相同机器、相同浏览器、新上下文首访加两次普通导航。fixture 仅用于界面测量，API 用 fetch 替身隔离，不消耗文献额度；没有用 Playwright route 测缓存，因为 route 会关闭 HTTP 缓存。秒数不是国内各运营商的服务承诺，也不是强制刷新的成绩。

| 指标 | 改前 | 第一轮上线后 |
|---|---:|---:|
| 首访 HTML 首字节 | 1.207秒 | 3.588秒 |
| 首访工作台挂载 | 2.041秒 | 4.469秒 |
| 再次访问工作台挂载 | 0.694 / 0.667秒 | 0.021 / 0.023秒 |
| 再次访问 JS/CSS 网络传输 | 均0字节 | 均0字节 |

首访样本变慢主要在 HTML 首字节等待；本轮不能声称首访速度已改善。暖访问省掉 HTML 回源得到明显改善。第一轮数据早于预压缩部署，最终构建 `2f0660d9e7b80b97` 复测首访 HTML 1.027秒、挂载1.545秒，再次访问0.015/0.019秒；公网主程序确认 Brotli 98,224字节，版本接口一致、缺失脚本404。原始数据保存于 `web-startup-before/after/final-2026-11-07.json`，不覆盖原始测量。

## 验证与发布保护

- `node scripts/verify-web-performance.mjs`：单一预加载脚本、CSS 压缩、预压缩文件解压逐字节一致。
- `VERIFY_STARTUP=1 npm exec --package=playwright@1.48.2 -- node scripts/measure-web-startup.mjs http://127.0.0.1:4190/?fixture=1`：JS 延迟1.5秒时启动说明可见，API 延迟3秒不阻止挂载，无 JS 异常、无双重下载。
- TypeScript、lint、密钥扫描、会话/版本、主题、存储、15项服务端测试及 Chrome UX 回归通过。
- 综合本地浏览器脚本初次因 B 在项目创建前打开、内存没有该项目而超时；修正夹具顺序，B 重新读取已保存项目后检查接管，完整脚本通过。没有因此更改项目锁业务逻辑。
- 原站与 Caddy 备份：`/var/backups/research-connected-perf-20261107/`；Caddy validate 后 reload，API 服务未重启、额度未清零，443 仍由 Xray 使用。

## 尚待解决

Cloudflare 公网仍返回 DYNAMIC，尚未落实仅 graph 静态内容的边缘缓存规则；不能对整个 jieyu.ai 开启 Cache Everything，否则可能影响 status 登录或产品 API。后台 UI 读取停留在旧内容，未能检查现有规则；本地 Wrangler 现有 OAuth 范围也没有缓存规则写权限，没有扩权或创建凭据。

下一步应先完成 graph 专用边缘缓存核查，再采集多个时段冷加载分布。真正文献建图仍受 OpenAlex/S2 等上游请求耗时与限流约束，本轮没有以真实大规模建图证明其速度改善。
