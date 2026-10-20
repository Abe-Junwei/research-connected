<h1 align="center">Research Connected</h1>

<p align="center"><a href="https://github.com/Abe-Junwei/research-connected/blob/main/README.md">English</a> | <a href="https://github.com/Abe-Junwei/research-connected/blob/main/docs/zh-cn/README.md">简体中文</a> | 繁體中文 | <a href="https://github.com/Abe-Junwei/research-connected/blob/main/docs/ja/README.md">日本語</a> | <a href="https://github.com/Abe-Junwei/research-connected/blob/main/docs/ko/README.md">한국어</a></p>

<p align="center"><img src="https://raw.githubusercontent.com/Abe-Junwei/research-connected/main/docs/images/logo.svg" width="96" height="96" alt="Research Connected 標誌"></p>

<p align="center">把相關論文畫成圖譜，查看每條關係的證據，並把閱讀整理成 Obsidian 裡相互連結的筆記。</p>

<p align="center"><a href="https://github.com/Abe-Junwei/research-connected/blob/main/docs/zh-tw/README.md#快速開始">快速開始</a> · <a href="https://github.com/Abe-Junwei/research-connected/blob/main/docs/USER_GUIDE.md">使用指南</a> · <a href="https://github.com/Abe-Junwei/research-connected/issues/new?template=bug_report.yml">回報問題</a> · <a href="https://github.com/Abe-Junwei/research-connected/issues/new?template=feature_request.yml">功能建議</a></p>

<p align="center"><img src="https://img.shields.io/github/v/release/Abe-Junwei/research-connected?sort=semver" alt="GitHub 發行版本"> <img src="https://img.shields.io/badge/Obsidian-1.14.4%2B%20desktop-7c3aed" alt="Obsidian 1.14.4 及以上桌面版"> <img src="https://img.shields.io/github/license/Abe-Junwei/research-connected" alt="授權"></p>

## 圖譜

![以 “Deep learning” 為中心的圖譜：左側是相關論文，右側是所選論文的關係證據](https://raw.githubusercontent.com/Abe-Junwei/research-connected/main/docs/images/graph-pane.png)

選取一個節點或一條邊，即可看到共同參考文獻、共被引和直接引用證據。

## 能做什麼

- **發現相關研究。** 輸入題名、DOI 或 OpenAlex ID，產生一張取樣後的相似圖譜。可在平面、時間和放射佈局之間切換。
- **檢查每條關係。** 查看一條關係背後的參考文獻和引用證據。Semantic Scholar、Crossref 和 OpenCitations 補上缺口，並標出不相符的紀錄。
- **整理閱讀。** 暫存論文，標記待讀或已讀，排除干擾，並儲存命名視圖。可以寫文獻筆記、嵌入圖譜，或匯出 BibTeX、YAML 和 Markdown。

## 快速開始

1. **安裝並啟用。** 在 Obsidian 中打開**設定 → 第三方外掛 → 瀏覽**，搜尋 **Research Connected**，然後安裝並啟用。
2. **建立第一張圖譜。** 從命令面板執行**打开 Research Connected**。貼上下面的 DOI，或輸入論文題名，然後選擇**构建**。
3. **檢查一條關係。** 選取一篇論文或一條邊，查看它為什麼出現在圖譜上。使用**保存视图**，以便以後回到這次排列。

```text
10.1038/nature14539
```

這個例子是 LeCun、Bengio 和 Hinton 在 2015 年發表的 “Deep learning”。來源資料庫更新後，結果可能改變。

**手動安裝。** 從[最新發行](https://github.com/Abe-Junwei/research-connected/releases/latest)下載 `main.js`、`manifest.json` 和 `styles.css`，放入 `<vault>/.obsidian/plugins/research-connected/`，重新載入 Obsidian 後啟用外掛。

## 按時間查看研究

![按發表年份排列的時間佈局，帶有佈局控制項和年份滑桿](https://raw.githubusercontent.com/Abe-Junwei/research-connected/main/docs/images/timeline.png)

切換到**时间**。年份滑桿縮小可見範圍，已儲存的視圖可以回到某次有用的選擇。

## 把圖譜放在筆記旁邊

![閱讀筆記中，段落之間嵌入了 Research Connected 圖譜](https://raw.githubusercontent.com/Abe-Junwei/research-connected/main/docs/images/note-embed.png)

把下面的程式碼區塊放進筆記。它會在閱讀視圖和即時預覽中顯示。

````markdown
```research-connected
doi: 10.1038/nature14539
height: 520
layout: temporal
```
````

選取一篇論文，然後選擇**导出 → 写入笔记**，即可建立文獻筆記。外掛可以根據 DOI 或 OpenAlex ID 辨識既有筆記，並在閱讀狀態改變時同步 `rc-status`。目標資料夾、檔名、正文範本和 DOI 屬性在設定中調整。

嵌入選項、前言、取樣和演算法見[使用指南](https://github.com/Abe-Junwei/research-connected/blob/main/docs/USER_GUIDE.md)。舊的 `connected-papers` 嵌入名稱仍然可用。

## 使用前須知

- **桌面版。** 需要 Obsidian 1.14.4 或更新版本。行動版尚待裝置測試。
- **網路。** 建立圖譜會查詢外部學術服務。專案和閱讀狀態保存在儲存庫中。
- **服務金鑰。** OpenAlex API 金鑰可省略，建議填寫。可在 [OpenAlex 設定](https://openalex.org/settings/api)建立，設定方式見[使用指南](https://github.com/Abe-Junwei/research-connected/blob/main/docs/USER_GUIDE.md)。
- **取樣。** 圖譜是引用鄰域的樣本，不是引用該種子的全部論文。
- **筆記。** 外掛讀取文獻筆記的前言以辨識既有筆記。只有在寫入筆記或更改閱讀狀態時才會改動筆記檔案。
- **人工智慧。** 研究脈絡預設關閉。瀏覽圖譜不需要語言模型。
- **介面語言。** 所有中文環境（含繁體中文）目前顯示簡體中文，其他環境顯示英文。上文的指令與按鈕名稱因此保留簡體。

## 網路使用與隱私

- **OpenAlex** 會收到你輸入的 DOI、OpenAlex ID 或搜尋文字，以及你設定的 API 金鑰。
- **Semantic Scholar**、**Crossref** 和 **OpenCitations** 會收到論文識別碼。金鑰或權杖只傳給對應的服務。
- **語言模型端點** 只在啟用研究脈絡並按下**生成研究脉络**後，收到所選論文及其引用證據。只有打開對應選項時才會包含摘要。

為辨識既有文獻筆記，外掛會列出 Markdown 路徑並讀取快取的前言。複製和匯出寫入系統剪貼簿；外掛不讀取剪貼簿。寫入文獻筆記或更改其閱讀狀態時，會更新對應的儲存庫檔案。

專案、閱讀狀態、已儲存視圖和服務憑證保存在這個儲存庫外掛的 `data.json` 中。憑證**未加密**。外掛不傳送遙測資料，除文獻筆記的前言外不讀取筆記。

## 限制

- 圖譜是**樣本**，不是完整的引用索引。高被引論文貢獻的是被引最多的施引文獻，不是全部施引文獻。
- 相似度和社群顏色用於探索。重要論點請對照原始論文核對。
- OpenAlex 有已知缺口：缺少摘要、參考文獻清單不完整，以及作者消歧義錯誤。[使用指南](https://github.com/Abe-Junwei/research-connected/blob/main/docs/USER_GUIDE.md#data-quality-known-openalex-issues)列出了每一項以及外掛的處理方式。

## 幫助與回饋

- **無法正常運作。** [回報問題](https://github.com/Abe-Junwei/research-connected/issues/new?template=bug_report.yml)。請寫上外掛版本、Obsidian 版本、系統、步驟，以及預期結果和實際結果。論文資料問題可以附上公開的 DOI 或 OpenAlex ID。
- **某個研究流程需要改變。** [提出功能建議](https://github.com/Abe-Junwei/research-connected/issues/new?template=feature_request.yml)。請說明正在做的任務、目前受阻的地方，以及希望得到的結果。
- **安裝幫助。** 閱讀[使用指南](https://github.com/Abe-Junwei/research-connected/blob/main/docs/USER_GUIDE.md)，並[查看既有問題](https://github.com/Abe-Junwei/research-connected/issues)。

可以使用中文或英文。提交需要 GitHub 帳戶，回饋公開可見。請勿附上 API 金鑰、私人筆記、未公開的研究材料、整個儲存庫或 `data.json`。功能建議不代表一定會實現，也不代表有交付時間。

## 更新與授權

變更見[版本說明](https://github.com/Abe-Junwei/research-connected/releases)，規劃中的工作見[路線圖](https://github.com/Abe-Junwei/research-connected/blob/main/ROADMAP.md)。程式碼和文件貢獻見[貢獻指南](https://github.com/Abe-Junwei/research-connected/blob/main/CONTRIBUTING.md)。

[MIT](https://github.com/Abe-Junwei/research-connected/blob/main/LICENSE)。Research Connected 是獨立專案，與 Connected Papers 沒有隸屬關係。
