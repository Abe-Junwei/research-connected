# graph.jieyu.ai 部署准备（本轮未执行）

日期：2026-11-06，北京时间。本文件只记录准备项；**不要在本轮改 DNS、VPS、Caddy 或线上预览。**

## 端口与代理边界

| 端口 | 用途 | 本轮 |
|---|---|---|
| 443 | Xray / VPN，绝不能动 | 禁止改动 |
| 8443 | Cloudflare 回源 HTTPS（既有模式） | 上线时用 Origin Rule 指向此端口上的 Caddy/站点 |
| 9185 | 现有 S2 代理 `research-connected-s2` | 不动 |
| 9186 | 新 OpenAlex+额度代理 | 仅回环，Caddy 反代 `/api/openalex` 与 `/api/quota/*` |

Cloudflare：`graph.jieyu.ai` 橙云 → Origin Rule：`http.host eq graph.jieyu.ai` → Destination Port `8443`。SSL 模式 Full / Full (strict)。不要把站点抢到 443。

## 上线前清单（代码就绪后另开一轮）

1. 在 VPS 创建 `/etc/research-connected-web.env`（从 `server/research-connected-web.env.example`），填入免费 OpenAlex Key，权限 0600；不写进 Git/bundle。
2. 安装 `server/openalex_proxy.py`、`quota.py` 到 `/opt/research-connected/server/`，启用 `research-connected-web.service`。
3. 发布 `web/dist/` 静态资源到专用站点根（不是旧 `/research-connected/preview/`）。
4. Caddy：为 `graph.jieyu.ai` 反代 API 到 `127.0.0.1:9186`，静态走新目录；旧预览路径改为直接 404，不重定向；status 登录保护保留。
5. DNS：新增 `graph.jieyu.ai` 橙云记录（当前公开 DNS 仍为 NXDOMAIN）。
6. 回归：`npm test`、`npm run build`、`npm run web`、`npm run test:web-quota`，再做真实浏览器建图与额度确认。

## 回滚

保留上一版 `web/dist` 与 Caddy 片段；停掉 `research-connected-web` 不影响 9185 S2 与 Xray。
