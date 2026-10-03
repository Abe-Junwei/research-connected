# 性能基线（阶段 0）

- 日期：2026-10-03
- 机器：Apple M3 Pro（arm64），Node v26.10.0
- 数据：scripts/perf-fixture.ts 生成的确定性合成图（mulberry32，seed=42），无网络
- 方法：每项 7 轮取中位数，含 1 轮预热；`npm run perf` 复现

| N | nodes | edges | select+similarity | force2d | temporal | radial | aggregates |
| - | ----- | ----- | ----------------- | ------- | -------- | ------ | ---------- |
| 50 | 50 | 77 | 2.3 ms | 14.0 ms | 0.0 ms | 0.0 ms | 0.2 ms |
| 150 | 150 | 237 | 42.2 ms | 97.8 ms | 0.1 ms | 0.1 ms | 0.5 ms |
| 300 | 300 | 476 | 266 ms | 375 ms | 0.1 ms | 0.2 ms | 1.0 ms |

说明：

- select+similarity = `selectNeighbors` + 引用集构建 + `buildSimilarity`（O(N²) 对评分）。
- force2d = `placeLayout("force2d")`（320 轮力导向 + 每轮 O(N²) 避让），是 300 节点下最贵的单项。
- aggregates = `priorWorks` + `derivativeWorks`，可见集为全部节点。
- 交互渲染帧率需在 preview 中人工确认，本脚本只覆盖计算耗时。
- 窄屏为人工验收场景，本阶段不做 CSS 改动。
