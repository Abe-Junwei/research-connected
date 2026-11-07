# Obsidian 插件取消启动自动联网

本轮作用于插件工作树 `/Users/junwei/开发/research-connected`，未更新独立Web工作树或线上网页。

已移除：插件onload的在线来源复核及来源复核备份写入；打开详情时的自动元数据核对与摘要补查；笔记代码块挂载时的自动建图/引用增强。

现在启动直接加载本地项目。代码块优先复用内存缓存或关联/同种子项目快照，没有本地图谱时显示手动重新加载提示。用户明确点击构建、重新加载、深挖、获取摘要等动作时，才请求对应来源。摘要筛查、导出警示、阅读状态、本地身份和项目数据继续保留。已有来源复核备份未删除。

验证：npm test、lint、构建、preview及完整浏览器回归通过。新增浏览器分支 `review-check.html?manual-only=1` 验证主图（含缺失摘要）、有快照嵌入、无快照嵌入启动均零请求；手动摘要及重新加载仍能发起请求。插件onload单测核实requestUrl调用数不增加。

已安装并重载 `/Users/junwei/Obsremote/.obsidian/plugins/research-connected/main.js`。CLI重载命令约3.34秒（包含CLI/IPC开销，不等同于精确onload耗时），插件保持启用。重载前后data.json SHA-256一致，5个项目、394个快照节点保持不变。旧来源复核备份仍为2份。

更新前完整备份位于 `/Users/junwei/Obsremote/.obsidian/plugin-backups/research-connected-manual-startup-20261106T213113/`，包含原main.js、manifest.json、styles.css、data.json。未发布新版本标签或推送远端。
