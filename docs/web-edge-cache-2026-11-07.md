# Cloudflare 缓存根因与第二轮载入优化

2026-11-07，继续保留美国 VPS 与 graph.jieyu.ai，不迁移香港，不改插件、共享图谱算法或额度业务逻辑。

## 根因与验证

Cloudflare Free 的 Origin Rule 把 graph 请求送往8443。官方将8443列为支持代理但默认禁用缓存的端口；启用该受限端口缓存的设置只向Enterprise提供。[端口说明](https://developers.cloudflare.com/fundamentals/reference/network-ports/)、[缓存端口设置](https://developers.cloudflare.com/cache/how-to/cache-rules/settings/#caching-on-port-enterprise-only)。

后台确认开发模式关闭、Caching Level为Standard；现有缓存绕过规则只匹配wenxian-pilot.jieyu.ai。因而没有修改全站缓存设置或删除WebDAV保护规则。

在同一源站增加graph专用9443 HTTPS监听，用现有可信证书验证通过。保留8443用于回退；新增9443防火墙规则只允许当前Cloudflare官方IP段（15个IPv4及7个IPv6段），不对其他来源开放。API原有来源、Origin、会话和客户端版本检查保留。

只修改graph Origin Rule，规则ID `6dc7bd424f2e4a7f8ac477fa309ed917`，条件仍是 `http.host eq "graph.jieyu.ai"`，目的端口8443→9443，Host/SNI/DNS保持原值。443仍由同一Xray进程监听，status及go/go-ws的规则保持原值。

不改静态内容与缓存头，仅切换端口后，实际主程序响应立即从DYNAMIC变成MISS→HIT→HIT，并出现Age。由此确认端口是本次静态资源不缓存的原因；不是仅凭文档推断。

## 首页规则

新增 `graph public HTML — respect origin TTL`，仅匹配：

```text
(http.host eq "graph.jieyu.ai" and http.request.method in {"GET" "HEAD"} and http.request.uri.path in {"/" "/index.html"})
```

Eligible for cache；Edge TTL使用源站Cache-Control、缺失则绕过；Browser TTL明确Respect origin TTL。未配置忽略查询字符串或自定义缓存键。实际首页MISS→HIT，保持 `public, max-age=60, stale-while-revalidate=300`，没有被全站4小时Browser TTL覆盖。

API、health、version.json不匹配此规则，继续no-store。只有公开静态HTML被共享缓存，没有服务器个人项目数据。

## CSS对照与保留的改动

在同一源站用相同JS创建两个临时HTML：原独立CSS、将相同压缩CSS内联。两条实验URL都不匹配首页规则，HTML都回源，JS相同且边缘缓存可用。顺序为外链→内联→内联→外链，每次新浏览器上下文；fixture及fetch替身隔离外部数据请求。实验文件随后从站点移除；原始结果为 `web-css-experiment-2026-11-07.json`。

| 版本 | HTML接收完成 | 首次显示内容FCP | 工作台就绪 | HTML到FCP |
|---|---:|---:|---:|---:|
| 独立CSS 1 | 1786ms | 2704ms | 2720ms | 918ms |
| 内联CSS 1 | 1792ms | 1848ms | 2569ms | 56ms |
| 内联CSS 2 | 1420ms | 1476ms | 2417ms | 56ms |
| 独立CSS 2 | 1439ms | 1960ms | 1963ms | 521ms |

保留CSS内联：使用原有esbuild压缩结果，无样式或交互重设计，消除首屏的外部CSS请求和渲染阻塞。首次可见显著提前；工作台就绪还依赖JS下载，不能把FCP收益全称为交互速度收益。代价是HTML压缩后增加约14KB；短时本地缓存和条件重验证仍可复用HTML。旧CSS和旧JS继续保留给旧页面。

## 版本更新保护

首页进入边缘缓存后，单纯reload可能再次拿到旧HTML。更新按钮改为在当前URL设置 `v=<新build>` 并replace导航，保留paper/doi参数与hash；Cloudflare保持默认查询字符串缓存键，使新版本URL首次回源。活动任务仍阻止更新，不强制刷新。针对旧URL `?paper=W1&v=old-build#node` 的回归先失败、修复后通过，确认新build参数和论文定位均保留。

## 验证与测量边界

- 新增 `python3 scripts/verify-web-edge-cache.py`，实际验证首页及资源HIT、API/version/health及类似脚本后缀的API错误均no-store，会话及额度状态有效、POST首页不缓存；不查询文献、不预留或扣除操作次数。
- `node scripts/verify-web-session.mjs`、`verify-web-performance.mjs`、密钥扫描、TypeScript及lint通过；真实浏览器延迟启动、工具栏主题、综合桌面/移动浏览器流程通过。
- 暖访问仍约11–18ms；端口与规则切换后、CSS内联前的3轮首次工作台就绪1680/2463/2971ms，见 `web-startup-edge-2026-11-07.json`。即便资源HIT，客户端到Cloudflare的DNS/TLS和网络往返仍有波动，不承诺首访稳定秒开。
- Caddy/Web/S2均active，status首页仍302；未重启Web/S2或清空额度，443保持Xray。

## 回退

改端口前完整Caddy备份：`/var/backups/research-connected-cache-port-20261107/Caddyfile`。最后静态发布前的站点与配置备份：`/var/backups/research-connected-edge-20261107/`。旧静态哈希文件保留。

若9443路径异常，先把graph Origin Rule端口改回8443（原监听仍在），验证后再移除9443监听及其22条Cloudflare专用防火墙规则。首页规则可单独停用，不影响API、status或WebDAV规则。回退静态HTML时同步version.json，保留旧资源；缓存最多短时保留原页面，显式更新用版本URL绕过旧键。

未验证大陆多运营商与晚高峰；未改变用户系统代理或VPN。外部文献建图仍受数据源耗时、额度与限流约束。

## 最终上线复核

最终构建 `874aaed91ae83a37`，主程序 `web-KU3YU37L.js`。默认 `/` 与 `/?v=874aaed91ae83a37` 均已确认返回新版内联CSS的HTML，首页和主程序公网HIT；API/version/health及404接口仍不缓存，会话和额度状态200，POST首页405且不缓存。

最后3轮新浏览器上下文的FCP为1932/2500/1588ms，HTML接收完成1869/2466/1552ms，因此HTML到首次可见约34–63ms；主界面就绪2421/3308/2591ms。原始数据见 `web-startup-edge-inline-2026-11-07.json`。这组结果没有证明首访总耗时稳定下降，明确改善的是消除源站回源、CSS请求和CSS渲染阻塞；客户端到海外边缘的连接及网络抖动仍占显著部分。不能用短时暖访问的毫秒数宣称首次访问也能达到同样速度。
