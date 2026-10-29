<h1 align="center">Research Connected</h1>

<p align="center"><a href="https://github.com/Abe-Junwei/research-connected/blob/main/README.md">English</a> | <a href="https://github.com/Abe-Junwei/research-connected/blob/main/docs/zh-cn/README.md">简体中文</a> | 繁體中文 | <a href="https://github.com/Abe-Junwei/research-connected/blob/main/docs/ja/README.md">日本語</a> | <a href="https://github.com/Abe-Junwei/research-connected/blob/main/docs/ko/README.md">한국어</a></p>

<p align="center"><img src="https://raw.githubusercontent.com/Abe-Junwei/research-connected/main/docs/images/logo.svg" width="96" height="96" alt="Research Connected 標誌"></p>

<p align="center"><strong>從一篇論文，走向有脈絡的研究閱讀。</strong><br>發現相關文獻，核查連結證據，在 Obsidian 中累積相互連結的文獻筆記。</p>

<p align="center"><a href="https://github.com/Abe-Junwei/research-connected/blob/main/docs/zh-tw/README.md#快速開始">快速開始</a> · <a href="https://github.com/Abe-Junwei/research-connected/blob/main/docs/USER_GUIDE.md">使用指南</a> · <a href="https://github.com/Abe-Junwei/research-connected/issues/new?template=bug_report.yml">回報問題</a> · <a href="https://github.com/Abe-Junwei/research-connected/issues/new?template=feature_request.yml">功能建議</a></p>

<p align="center"><img src="https://img.shields.io/github/v/release/Abe-Junwei/research-connected?sort=semver" alt="GitHub 發行版本"> <img src="https://img.shields.io/badge/Obsidian-1.14.4%2B%20desktop-7c3aed" alt="Obsidian 1.14.4 及以上桌面版"> <img src="https://img.shields.io/github/license/Abe-Junwei/research-connected" alt="授權"></p>

## 看清一篇論文的研究鄰域

<p><img src="../images/graph-pane.gif" width="100%" alt="開發版預覽（淺色）：圖譜從種子展開，選取論文並切換佈局"></p>
<p><img src="../images/graph-pane-dark.gif" width="100%" alt="開發版預覽（暗色）：圖譜從種子展開，選取論文並切換佈局"></p>

*動態演示與靜態圖均為目前本機開發版預覽，錄於 2026-10-29。不是 Obsidian 宿主畫面，也不代表最新發行版功能。範例為 “Deep learning”（2015）；即時公共中繼資料可能變動。介面為英文；外掛目前支援簡體中文與英文。*

選取節點或邊即可查看共同參考文獻、共被引和直接引用證據。右側底部的內容分頁中，**圖內常引文獻**指至少被兩篇目前可見文獻引用的作品；**引用本圖的文獻**指引用至少兩篇目前可見文獻的作品。這些名稱不表示發表先後或思想承襲。

## 發現、核查、累積：三個核心工作流程

- **發現相關研究。** 輸入題名、DOI 或 OpenAlex ID，指定種子文獻並產生取樣後的相似圖譜。可在平面、年份和放射佈局之間切換。
- **檢查每條關係。** 查看參考文獻和引用證據。外掛可能透過 OpenAlex、Semantic Scholar 或 Crossref 取得摘要與參考文獻資料，也可能透過 OpenCitations 補充引用證據；請求失敗不代表來源沒有紀錄。
- **整理閱讀。** **收藏文献**會將單篇論文加入專案的收藏清單，**保存项目**則保存專案。設定論文的**閱讀狀態**、排除干擾、撰寫文獻筆記、嵌入圖譜，或匯出 BibTeX、YAML 和 Markdown。

## 快速開始

1. **安裝並啟用。** 在 Obsidian 中打開**設定 → 第三方外掛 → 瀏覽**，搜尋 **Research Connected**，然後安裝並啟用。
2. **建立第一張圖譜。** 從命令面板執行**打开 Research Connected**。貼上下面的 DOI，或輸入論文題名以選擇**種子文獻**，然後選擇**构建**。
3. **檢查一條關係。** 選取一篇論文或一條邊，查看它為什麼出現在圖譜上。使用**保存项目**保存專案；使用**收藏文献**將單篇論文加入收藏清單。

```text
10.1038/nature14539
```

這個例子是 LeCun、Bengio 和 Hinton 在 2015 年發表的 “Deep learning”。來源資料庫更新後，結果可能改變。

**手動安裝。** 從[最新發行](https://github.com/Abe-Junwei/research-connected/releases/latest)下載 `main.js`、`manifest.json` 和 `styles.css`，放入 `<vault>/.obsidian/plugins/research-connected/`，重新載入 Obsidian 後啟用外掛。

## 按時間查看研究

<p><img src="../images/timeline.gif" width="100%" alt="開發版預覽（淺色）：年份佈局下年份帶依發表年份播放"></p>
<p><img src="../images/timeline-dark.gif" width="100%" alt="開發版預覽（暗色）：年份佈局下年份帶依發表年份播放"></p>

切換到**年份**佈局。圖譜下方的年份帶可依發表年份縮小可見範圍。

## 把圖譜放在筆記旁邊

<p><img src="../images/note-embed.png" width="100%" alt="開發版預覽（淺色）：在閱讀筆記頁面中嵌入可互動的時間圖譜"></p>
<p><img src="../images/note-embed-dark.png" width="100%" alt="開發版預覽（暗色）：在閱讀筆記頁面中嵌入可互動的時間圖譜"></p>

把下面的程式碼區塊放進筆記。它會在閱讀視圖和即時預覽中顯示。

````markdown
```research-connected
doi: 10.1038/nature14539
height: 520
layout: temporal
```
````

選取一篇論文，然後選擇**导出 → 写入笔记**，即可建立文獻筆記。外掛可以根據 DOI 或 OpenAlex ID 辨識既有筆記。閱讀狀態可與關聯筆記同步；狀態衝突需要核對。目標資料夾、檔名、正文範本和 DOI 屬性在設定中調整。

嵌入選項、筆記屬性（YAML frontmatter）、取樣和演算法見[使用指南](https://github.com/Abe-Junwei/research-connected/blob/main/docs/USER_GUIDE.md)。舊的 `connected-papers` 嵌入名稱仍然可用。

## 開發狀態

<details>
<summary>尚未發布的功能與驗證邊界</summary>

目前 [`slices/s02-s10`](https://github.com/Abe-Junwei/research-connected/tree/slices/s02-s10) 的工作由 [PR #10](https://github.com/Abe-Junwei/research-connected/pull/10) 追蹤。真實 Obsidian 宿主的完整驗收尚待完成；發行版功能以正式版本為準。

- 同一論文及已確認版本組跨專案共用閱讀狀態，收藏文獻與排除仍按專案管理。狀態衝突與外部編輯需明確解決、重試或停止同步。
- 依來源確認或手動決定的關係整合版本，不按標題猜測；匯出保留版本來源。
- 候選診斷與引用路徑區分缺少證據與實測為零；MMR 平衡相關性與多樣性，語義訊號補充結構證據。
- 節點大小按引用量對數縮放；高被引提示是啟發式指標，並非權威評定。動畫遵循減少動態效果偏好。

</details>

## 使用前須知

- **桌面版。** 需要 Obsidian 1.14.4 或更新版本。行動版尚待裝置測試。
- **網路。** 建立圖譜會查詢外部學術服務。專案和閱讀狀態保存在儲存庫中；資料流詳見下方隱私說明。
- **服務金鑰。** OpenAlex API 金鑰可省略，建議填寫。可在 [OpenAlex 設定](https://openalex.org/settings/api)建立，設定方式見[使用指南](https://github.com/Abe-Junwei/research-connected/blob/main/docs/USER_GUIDE.md)。
- **取樣。** 圖譜是引用鄰域的樣本，不是引用種子文獻的全部論文。
- **筆記。** 外掛讀取筆記屬性（YAML frontmatter）以辨識文獻筆記。只有在寫入筆記或更改閱讀狀態時才會改動筆記檔案。
- **人工智慧。** 研究脈絡預設關閉。瀏覽圖譜不需要語言模型。
- **介面語言。** 所有中文環境（含繁體中文）目前顯示簡體中文，其他環境顯示英文。上文的指令與按鈕名稱因此保留簡體。

## 網路使用與隱私

- **OpenAlex** 會收到你輸入的 DOI、OpenAlex ID 或搜尋文字，以及設定的 API 金鑰和選填聯絡電子郵件。該電子郵件也會作為聯絡資訊傳送給 Crossref；不保證提高請求額度。
- **Semantic Scholar**、**Crossref** 和 **OpenCitations** 會收到論文識別碼。金鑰或權杖只傳給對應的服務。
- **語言模型端點** 只在啟用研究脈絡並按下**生成研究脉络**後，收到所選論文及其引用證據。只有打開對應選項時才會包含摘要。

為辨識既有文獻筆記，外掛會列出 Markdown 路徑並讀取筆記屬性（YAML frontmatter）。複製和匯出寫入系統剪貼簿；外掛不讀取剪貼簿。寫入文獻筆記或更改其閱讀狀態時，會更新對應的儲存庫檔案。

專案、閱讀狀態、收藏文獻和服務憑證保存在這個儲存庫外掛的 `data.json` 中。憑證**未加密**；儲存庫同步或備份工具可能會複製此檔案。外掛不傳送遙測資料，也不讀取文獻筆記屬性以外的筆記內容。

## 限制

- 圖譜是**樣本**，不是完整的引用索引。高被引論文貢獻的是被引最多的施引文獻，不是全部施引文獻。
- 語義相似度可能使用相容向量以及本機文字和主題訊號；它用於探索，不代表研究品質。重要論點請對照原始論文核對。
- OpenAlex 有已知缺口：缺少摘要、參考文獻清單不完整，以及作者消歧義錯誤。[使用指南](https://github.com/Abe-Junwei/research-connected/blob/main/docs/USER_GUIDE.md#data-quality-known-openalex-issues)列出了每一項以及外掛的處理方式。

## 幫助與回饋

- **無法正常運作。** [回報問題](https://github.com/Abe-Junwei/research-connected/issues/new?template=bug_report.yml)。請寫上外掛版本、Obsidian 版本、系統、步驟，以及預期結果和實際結果。論文資料問題可以附上公開的 DOI 或 OpenAlex ID。
- **某個研究流程需要改變。** [提出功能建議](https://github.com/Abe-Junwei/research-connected/issues/new?template=feature_request.yml)。請說明正在做的任務、目前受阻的地方，以及希望得到的結果。
- **安裝幫助。** 閱讀[使用指南](https://github.com/Abe-Junwei/research-connected/blob/main/docs/USER_GUIDE.md)，並[查看既有問題](https://github.com/Abe-Junwei/research-connected/issues)。

可以使用中文或英文。提交需要 GitHub 帳戶，回饋公開可見。請勿附上 API 金鑰、私人筆記、未公開的研究材料、整個儲存庫或 `data.json`。功能建議不代表一定會實現，也不代表有交付時間。

## 更新與授權

變更見[版本說明](https://github.com/Abe-Junwei/research-connected/releases)，規劃中的工作見[路線圖](https://github.com/Abe-Junwei/research-connected/blob/main/ROADMAP.md)。程式碼和文件貢獻見[貢獻指南](https://github.com/Abe-Junwei/research-connected/blob/main/CONTRIBUTING.md)。

[AGPL-3.0](https://github.com/Abe-Junwei/research-connected/blob/main/LICENSE)。Research Connected 是獨立專案，與 Connected Papers 沒有隸屬關係。
