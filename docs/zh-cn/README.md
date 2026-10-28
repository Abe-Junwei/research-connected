<h1 align="center">Research Connected</h1>

<p align="center"><a href="https://github.com/Abe-Junwei/research-connected/blob/main/README.md">English</a> | 简体中文 | <a href="https://github.com/Abe-Junwei/research-connected/blob/main/docs/zh-tw/README.md">繁體中文</a> | <a href="https://github.com/Abe-Junwei/research-connected/blob/main/docs/ja/README.md">日本語</a> | <a href="https://github.com/Abe-Junwei/research-connected/blob/main/docs/ko/README.md">한국어</a></p>

<p align="center"><img src="https://raw.githubusercontent.com/Abe-Junwei/research-connected/main/docs/images/logo.svg" width="96" height="96" alt="Research Connected 标志"></p>

<p align="center">把相关论文画成图谱，查看每条关系的证据，并把阅读整理成 Obsidian 里相互链接的笔记。</p>

<p align="center"><a href="https://github.com/Abe-Junwei/research-connected/blob/main/docs/zh-cn/README.md#快速开始">快速开始</a> · <a href="https://github.com/Abe-Junwei/research-connected/blob/main/docs/USER_GUIDE.md">使用指南</a> · <a href="https://github.com/Abe-Junwei/research-connected/issues/new?template=bug_report.yml">报告问题</a> · <a href="https://github.com/Abe-Junwei/research-connected/issues/new?template=feature_request.yml">功能建议</a></p>

<p align="center"><img src="https://img.shields.io/github/v/release/Abe-Junwei/research-connected?sort=semver" alt="GitHub 发布版本"> <img src="https://img.shields.io/badge/Obsidian-1.14.4%2B%20desktop-7c3aed" alt="Obsidian 1.14.4 及以上桌面版"> <img src="https://img.shields.io/github/license/Abe-Junwei/research-connected" alt="许可"></p>

## 当前开发分支（尚未发布）

以下能力已在 [`slices/s02-s10`](https://github.com/Abe-Junwei/research-connected/tree/slices/s02-s10) 实现，由 [PR #10](https://github.com/Abe-Junwei/research-connected/pull/10) 跟踪；不代表最新发布版已包含这些功能。真实 Obsidian 宿主的完整验收尚未完成。下方截图用于展示工作流程，与目前星图外观可能不同。

- **共享阅读进度，独立项目管理。** 同一论文及已确认的版本组跨项目共享阅读进度；暂存和排除仍属于各项目。进度冲突、笔记外部编辑会进入待处理，可明确解决、重试或停止笔记同步。
- **版本感知。** 按来源确认的版本关系和手动合并／拆分决策归组，不按标题猜测。可处理身份及排除范围歧义、选择可用版本，并在导出中保留版本来源。
- **可检查的证据。** 查看引用路径、候选筛选诊断与结构相似度；缺少证据与实测为零分别呈现。MMR 平衡候选相关性与多样性，语义信号补充结构证据。
- **更易读的星图。** 节点半径按累计被引量对数缩放，缺失数值标为未知。成熟且有影响的论文获得启发式经典标记和自然闪烁，详情解释命中理由；这不是学术权威认定。动态效果遵循操作系统的减少动态效果偏好。
- **恢复研究现场。** 保存命名视图，明确关联嵌入图谱与项目。主图和嵌入图复用阅读及证据流程；交互优化减少重复图谱投影，并合并拖拽、缩放帧。

## 图谱

![以 “Deep learning” 为中心的图谱：左侧是相关论文，右侧是所选论文的关系证据](https://raw.githubusercontent.com/Abe-Junwei/research-connected/main/docs/images/graph-pane.png)

选中一个节点或一条边，即可看到共同参考文献、共被引和直接引用证据。

## 能做什么

- **发现相关研究。** 输入题名、DOI 或 OpenAlex ID，生成一张采样后的相似图谱。可在平面、时间和放射布局之间切换。
- **检查每条关系。** 查看一条关系背后的参考文献和引用证据。Semantic Scholar、Crossref 和 OpenCitations 补全缺口，并标出不匹配的记录。
- **整理阅读。** 暂存论文，标记待读或已读，排除干扰，并保存命名视图。可以写文献笔记、嵌入图谱，或导出 BibTeX、YAML 和 Markdown。

## 快速开始

1. **安装并启用。** 在 Obsidian 中打开**设置 → 第三方插件 → 浏览**，搜索 **Research Connected**，然后安装并启用。
2. **构建第一张图谱。** 从命令面板运行**打开 Research Connected**。粘贴下面的 DOI，或输入论文题名，然后选择**构建**。
3. **检查一条关系。** 选中一篇论文或一条边，查看它为什么出现在图谱上。使用**保存视图**，以便以后回到这次排列。

```text
10.1038/nature14539
```

这个例子是 LeCun、Bengio 和 Hinton 在 2015 年发表的 “Deep learning”。来源数据库更新后，结果可能变化。

**手动安装。** 从[最新发布](https://github.com/Abe-Junwei/research-connected/releases/latest)下载 `main.js`、`manifest.json` 和 `styles.css`，放入 `<vault>/.obsidian/plugins/research-connected/`，重新加载 Obsidian 后启用插件。

## 按时间查看研究

![按发表年份排列的时间布局，带有布局控件和年份滑块](https://raw.githubusercontent.com/Abe-Junwei/research-connected/main/docs/images/timeline.png)

切换到**时间**。图谱下方的年份带缩小可见范围，并标出当前样本每年有多少篇。已保存的视图可以回到某次有用的选择。

## 把图谱放在笔记旁边

![阅读笔记中，段落之间嵌入了 Research Connected 图谱](https://raw.githubusercontent.com/Abe-Junwei/research-connected/main/docs/images/note-embed.png)

把下面的代码块放进笔记。它会在阅读视图和实时预览中显示。

````markdown
```research-connected
doi: 10.1038/nature14539
height: 520
layout: temporal
```
````

选中一篇论文，然后选择**导出 → 写入笔记**，即可创建文献笔记。插件可以根据 DOI 或 OpenAlex ID 识别已有笔记，并在阅读状态改变时同步 `rc-status`。目标文件夹、文件名、正文模板和 DOI 属性在设置中配置。

嵌入选项、前言、采样和算法见[使用指南](https://github.com/Abe-Junwei/research-connected/blob/main/docs/USER_GUIDE.md)。旧的 `connected-papers` 嵌入名称仍然可用。

## 使用前须知

- **桌面端。** 需要 Obsidian 1.14.4 或更高版本。移动端尚待设备测试。
- **网络。** 构建图谱会查询外部学术服务。项目和阅读状态保存在库中。
- **服务密钥。** OpenAlex API 密钥可选，建议填写。可在 [OpenAlex 设置](https://openalex.org/settings/api)创建，配置方法见[使用指南](https://github.com/Abe-Junwei/research-connected/blob/main/docs/USER_GUIDE.md)。
- **采样。** 图谱是引文邻域的样本，不是引用该种子的全部论文。
- **笔记。** 插件读取文献笔记的前言以识别已有笔记。只有在写入笔记或更改阅读状态时才会改动笔记文件。
- **人工智能。** 研究脉络默认关闭。浏览图谱不需要语言模型。
- **界面语言。** 中文环境使用简体中文，其他环境使用英文。

## 网络使用与隐私

- **OpenAlex** 会收到你输入的 DOI、OpenAlex ID 或检索文本，以及你设置的 API 密钥。
- **Semantic Scholar**、**Crossref** 和 **OpenCitations** 会收到论文标识。密钥或令牌只发送给对应的服务。
- **语言模型端点** 只在启用研究脉络并按下**生成研究脉络**后，收到所选论文及其引用证据。只有打开相应选项时才会包含摘要。

为识别已有文献笔记，插件会列出 Markdown 路径并读取缓存的前言。复制和导出写入系统剪贴板；插件不读取剪贴板。写入文献笔记或更改其阅读状态时，会更新对应的库文件。

项目、阅读状态、已保存视图和服务凭据保存在本库插件的 `data.json` 中。凭据**未加密**。插件不发送遥测数据，除文献笔记的前言外不读取笔记。

## 限制

- 图谱是**样本**，不是完整的引文索引。高被引论文贡献的是被引最多的施引文献，不是全部施引文献。
- 相似度和社群颜色用于探索。重要论断请对照原始论文核对。
- OpenAlex 有已知缺口：缺少摘要、参考文献列表不完整，以及作者消歧错误。[使用指南](https://github.com/Abe-Junwei/research-connected/blob/main/docs/USER_GUIDE.md#data-quality-known-openalex-issues)列出了每一项以及插件的处理方式。

## 帮助与反馈

- **无法正常工作。** [报告问题](https://github.com/Abe-Junwei/research-connected/issues/new?template=bug_report.yml)。请写上插件版本、Obsidian 版本、系统、步骤，以及预期结果和实际结果。论文数据问题可以附上公开的 DOI 或 OpenAlex ID。
- **某个研究流程需要改变。** [提出功能建议](https://github.com/Abe-Junwei/research-connected/issues/new?template=feature_request.yml)。请说明正在做的任务、目前受阻的地方，以及希望得到的结果。
- **安装帮助。** 阅读[使用指南](https://github.com/Abe-Junwei/research-connected/blob/main/docs/USER_GUIDE.md)，并[查看已有问题](https://github.com/Abe-Junwei/research-connected/issues)。

可以使用中文或英文。提交需要 GitHub 账户，反馈公开可见。请勿附上 API 密钥、私人笔记、未公开的研究材料、整个库或 `data.json`。功能建议不代表一定会实现，也不代表有交付时间。

## 更新与许可

变更见[发布说明](https://github.com/Abe-Junwei/research-connected/releases)，计划中的工作见[路线图](https://github.com/Abe-Junwei/research-connected/blob/main/ROADMAP.md)。代码和文档贡献见[贡献指南](https://github.com/Abe-Junwei/research-connected/blob/main/CONTRIBUTING.md)。

[MIT](https://github.com/Abe-Junwei/research-connected/blob/main/LICENSE)。Research Connected 是独立项目，与 Connected Papers 没有隶属关系。
