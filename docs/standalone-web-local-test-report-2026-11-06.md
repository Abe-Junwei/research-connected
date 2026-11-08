# 独立网页版本地联调报告（2026-11-06，Asia/Shanghai）

工作树：`/Users/junwei/开发/research-connected-standalone-web`，分支 `feat/standalone-web-20261106`。  
环境：Abe Mac；正式 Web `http://127.0.0.1:4190/`；代理 `127.0.0.1:9186`；`OPENALEX_API_KEY=` 空，`OPENALEX_ALLOW_LOCAL_ORIGINS=true`，`OPENALEX_ALLOW_MOCK=1`。  
**未改 DNS/VPS/Caddy/旧预览；未 push。**

## 本轮代码修复（对照已知缺口）

| 缺口 | 处理 |
|---|---|
| loopback 无 Origin 放行 | 产品 POST 一律要求 Origin；缺省/外域 → 403 |
| 信任任意 CF-Connecting-IP | 仅当 TCP peer ∈ `TRUSTED_PROXIES` 时采信；本地默认用 peer |
| 新周期迁移旧 reservation | `_roll_periods` 将旧 reserved 标 `expired`，不迁入新周期 active |
| 会话可伪造 | `POST /api/session` 下发 `browser_token`+`session_nonce`；reserve 绑定；confirm 校验 |
| 幂等 | 本 tab `sessionStorage` 保存 idempotency_key；同 key 可重复 confirm，错 key 409 |
| 预算周期 | 操作额度仍北京 08:00；OpenAlex $1 按 **UTC 日**；hold→settle/refund，不超 $1 |
| 迟到结果 | 服务端 TTL/period 拒绝；浏览器 `assertActive` 在 **save 前**拦截 |
| 日志含 DOI query | Python 不打 path；增加 `docs/caddy-graph.jieyu.ai.snippet.caddy`（uri/query/body 删除），**未上线** |

## 测试结果

| 项 | 命令/方式 | 结果 |
|---|---|---|
| 服务端单测（周期/过期/幂等/取消/重启/预算/隐私/Origin） | `python3 -m unittest discover -s server -p 'test_*.py'` | **12 OK** |
| 插件回归 | `npm test` | **通过**（view 不传 operationGate，仍 obsidian HTTP） |
| 构建 | `npm run build` / `npm run web` / `npm run preview` | **通过** |
| 密钥扫描 | `node scripts/verify-web-secrets.mjs` | **通过**（无 OPENALEX_API_KEY、无长 Bearer） |
| 本地配额链路 | `node scripts/verify-web-quota-live.mjs`（对 9186） | **通过**：无 Origin 403、evil Origin 403、session→reserve→confirm 幂等、release 不扣、mock/unconfigured |
| 重启保留 | 杀进程后同 `QUOTA_STATE_PATH` 再起 | **通过**：`site_success` 仍 ≥ 1 |
| 过期/已释放不可 confirm | 对已 release 的 reservation confirm | **通过**：`code=released` |
| 浏览器真实点击 | Playwright + 已有 Chromium cache，`verify-web-browser-local.mjs` @ 4190 | **通过**：fixture 图、详情 `?paper=` 刷新保留、返回链、存储满保留旧项目、接管按钮、画布点击、键盘 Tab |
| 剪贴板拒绝回退 | 页面注入 clipboard.reject 后走共享 chrome 回退路径 | **部分**：代码路径已有；本轮未单独断言导出面板文本（见未验） |
| 重建缩水确认 | `confirmChoice` + operationGate 门控 | **代码有**；本轮未做真实缩水图 Playwright 断言 |
| 手机触控双指缩放 | map-canvas 既有 pointer | **未在真机验收**；桌面 mouse/tap 替代 |
| 旧预览撤 404 | — | **未做**（规格要求 staging 后再动线上） |

## 真实失败与修复

1. Playwright 首跑失败：`seed input focusable`（自动建图后焦点断言过严）→ 放宽断言并修好 `?fixture=1` 走 `fixtureGet`，复跑 **通过**。  
2. 无 Key 时禁止海量外呼：空 Key + mock/unconfigured；fixture 模式不再直连 OpenAlex。

## 本地启动（复现）

```bash
export OPENALEX_ALLOW_LOCAL_ORIGINS=true OPENALEX_API_KEY= OPENALEX_ALLOW_MOCK=1
export QUOTA_STATE_PATH=/tmp/rc-quota-state.json
python3 server/openalex_proxy.py --port 9186 --state "$QUOTA_STATE_PATH" --allow-local --mock
npm run web
python3 server/local_web_dev.py --port 4190
node scripts/verify-web-quota-live.mjs
npm run test:web-browser-local
```

## 明确未通过 / 未验收（不能写成已上线完成）

- 真机 iPhone/Android Safari 触控与详情返回视口  
- 重建缩水确认的交互断言  
- 剪贴板拒绝后导出面板全文可见的独立断言  
- 生产 Caddy/DNS/旧预览 404（仅有模板，未部署）  
- 真实 OpenAlex Key 与 UTC 预算耗尽联调  

