<h1 align="center">Research Connected</h1>

<p align="center"><a href="https://github.com/Abe-Junwei/research-connected/blob/main/README.md">English</a> | <a href="https://github.com/Abe-Junwei/research-connected/blob/main/docs/zh-cn/README.md">简体中文</a> | <a href="https://github.com/Abe-Junwei/research-connected/blob/main/docs/zh-tw/README.md">繁體中文</a> | 日本語 | <a href="https://github.com/Abe-Junwei/research-connected/blob/main/docs/ko/README.md">한국어</a></p>

<p align="center"><img src="https://raw.githubusercontent.com/Abe-Junwei/research-connected/main/docs/images/logo.svg" width="96" height="96" alt="Research Connected のロゴ"></p>

<p align="center"><strong>一つの論文から、つながりのある研究へ。</strong><br>関連文献を見つけ、つながりの根拠を確かめ、Obsidian に文献ノートを蓄積します。</p>

<p align="center"><a href="https://github.com/Abe-Junwei/research-connected/blob/main/docs/ja/README.md#クイックスタート">クイックスタート</a> · <a href="https://github.com/Abe-Junwei/research-connected/blob/main/docs/USER_GUIDE.md">利用ガイド</a> · <a href="https://github.com/Abe-Junwei/research-connected/issues/new?template=bug_report.yml">不具合を報告</a> · <a href="https://github.com/Abe-Junwei/research-connected/issues/new?template=feature_request.yml">機能を提案</a></p>

<p align="center"><img src="https://img.shields.io/github/v/release/Abe-Junwei/research-connected?sort=semver" alt="GitHub リリース"> <img src="https://img.shields.io/badge/Obsidian-1.14.4%2B%20desktop-7c3aed" alt="Obsidian 1.14.4 以降のデスクトップ"> <img src="https://img.shields.io/github/license/Abe-Junwei/research-connected" alt="ライセンス"></p>

## 論文の研究領域を見渡す

<p><img src="../images/graph-pane.gif" width="100%" alt="開発版プレビュー（ライト）：シードから地図が開き、論文を選びレイアウトを切り替える"></p>
<p><img src="../images/graph-pane-dark.gif" width="100%" alt="開発版プレビュー（ダーク）：シードから地図が開き、論文を選びレイアウトを切り替える"></p>

*動画と静止画は現在のローカル開発版プレビューです。収録日：2026-10-29。Obsidian 本体での撮影や公開済みリリースの機能保証ではありません。例は “Deep learning”（2015）。公開メタデータは変化します。UI は英語で、対応言語は簡体字中国語と英語です。*

ノードか辺を選ぶと、共通の参考文献、共引用、直接の引用根拠を確認できます。右側パネル下部のタブにある「グラフ内で頻繁に引用される文献」は現在表示中の文献2件以上に引用された作品、「このグラフを引用する文献」は表示中の文献を2件以上引用している作品です。発表年の前後関係や思想的影響を意味しません。

## 発見・確認・蓄積の三つのワークフロー

- **関連研究を見つける。** 題名、DOI、または OpenAlex ID を入力してシード論文を指定し、サンプリングした類似地図を作ります。**Planar**、**Year**、**Radial** のレイアウトを切り替えられます。
- **つながりを確認する。** 参考文献と引用根拠を読みます。プラグインは OpenAlex、Semantic Scholar、Crossref から要約や参考文献データを取得しようとし、OpenCitations から引用根拠を追加することがあります。リクエスト失敗は、その情報がデータベースにないことを意味しません。
- **読書を整理する。** **Save paper** は個別の論文をプロジェクトの保存リストに追加し、**Save project** はプロジェクトを保存します。論文の **Reading status** を設定し、不要な論文を除外して、文献ノートの作成、グラフの埋め込み、BibTeX・YAML・Markdown の書き出しができます。

## クイックスタート

1. **インストールして有効にする。** Obsidian で**設定 → コミュニティプラグイン → 閲覧**を開き、**Research Connected** を検索して、インストールし有効にします。
2. **最初の地図を作る。** コマンドパレットから **Open Research Connected** を実行します。下の DOI を貼り付けるか、論文題名でシード論文を選んで **Build** を選びます。
3. **つながりを確認する。** 論文か辺を選び、地図にある理由を見ます。**Save project** でプロジェクトを保存し、**Save paper** で論文を個別に保存できます。

```text
10.1038/nature14539
```

この例は、LeCun、Bengio、Hinton が 2015 年に発表した “Deep learning” です。元データベースが更新されると、結果は変わり得ます。

**手動インストール。** [最新リリース](https://github.com/Abe-Junwei/research-connected/releases/latest)から `main.js`、`manifest.json`、`styles.css` をダウンロードし、`<vault>/.obsidian/plugins/research-connected/` に置きます。Obsidian を再読み込みして、プラグインを有効にします。

## 時間軸で研究を見る

<p><img src="../images/timeline.gif" width="100%" alt="開発版プレビュー（ライト）：Year レイアウトで年の帯が発表年を再生する"></p>
<p><img src="../images/timeline-dark.gif" width="100%" alt="開発版プレビュー（ダーク）：Year レイアウトで年の帯が発表年を再生する"></p>

**Year** レイアウトに切り替えます。グラフ下部の年の帯で、発表年に基づいて表示範囲を絞り込めます。

## ノートのそばにグラフを置く

<p><img src="../images/note-embed.png" width="100%" alt="開発版プレビュー（ライト）：読書ノートのページに埋め込んだ操作可能な時間軸グラフ"></p>
<p><img src="../images/note-embed-dark.png" width="100%" alt="開発版プレビュー（ダーク）：読書ノートのページに埋め込んだ操作可能な時間軸グラフ"></p>

次のブロックをノートに追加します。リーディングビューとライブプレビューで表示されます。

````markdown
```research-connected
doi: 10.1038/nature14539
height: 520
layout: temporal
```
````

論文を選び、**Export → Write to note** で文献ノートを作ります。プラグインは DOI または OpenAlex ID で既存のノートを認識します。Reading status は関連ノートと同期できます。状態が競合する場合は確認が必要です。フォルダ、ファイル名、本文テンプレート、DOI プロパティは設定で指定します。

埋め込みオプション、ノートのプロパティ（YAML frontmatter）、サンプリング、アルゴリズムは[利用ガイド](https://github.com/Abe-Junwei/research-connected/blob/main/docs/USER_GUIDE.md)にあります。古い埋め込み名 `connected-papers` も使えます。

## 開発状況

<details>
<summary>未リリース機能と検証範囲</summary>

現在の [`slices/s02-s10`](https://github.com/Abe-Junwei/research-connected/tree/slices/s02-s10) の開発は [PR #10](https://github.com/Abe-Junwei/research-connected/pull/10) で追跡しています。実際の Obsidian 環境での総合検証は未完了です。公開版の機能はリリースを参照してください。

- 同じ論文と確認済みの版グループで読書状態を共有し、Save paper と除外はプロジェクトごとに管理します。状態の競合や外部編集は明示的な解決、再試行、同期停止が可能です。
- 版の統合は出典の確認または手動の判断に基づき、タイトルからは推測しません。出力に版の出典を残します。
- 候補診断と引用経路では証拠不足と観測値ゼロを区別します。MMR が関連性と多様性を調整し、意味的情報が構造的根拠を補います。
- ノードの大きさは被引用数の対数に基づきます。高被引用インジケーターは説明付きの目安であり、権威的な評価ではありません。動きは OS の設定に従います。

</details>

## 始める前に

- **デスクトップ。** Obsidian 1.14.4 以降。モバイルは実機での確認待ちです。
- **ネットワーク。** 地図を作ると、外部の学術サービスへ問い合わせます。プロジェクトと読書状態は保管庫に残ります。送信データは下のプライバシー説明を確認してください。
- **サービスキー。** OpenAlex API キーは任意で、設定を推奨します。[OpenAlex の設定](https://openalex.org/settings/api)で作成できます。手順は[ガイド](https://github.com/Abe-Junwei/research-connected/blob/main/docs/USER_GUIDE.md)にあります。
- **サンプリング。** 地図は引用の近傍から取った標本であり、シード論文を引用するすべての論文ではありません。
- **ノート。** 文献ノートを認識するため、ノートのプロパティ（YAML frontmatter）を読みます。ノートのファイルが変わるのは、書き込むときか読書状態を変えるときだけです。
- **AI。** 研究の筋書きは初期状態でオフです。地図を見るのに言語モデルは不要です。
- **表示言語。** 中国語の環境では簡体字、それ以外（日本語を含む）では英語です。上のコマンドとボタン名は、そのため英語のままです。

## 通信とプライバシー

- **OpenAlex** は、入力した DOI、OpenAlex ID、検索文、設定した API キーと任意の連絡先メールアドレスを受け取ります。メールアドレスは Crossref に連絡先情報としても送られます。リクエスト枠の増加は保証されません。
- **Semantic Scholar**、**Crossref**、**OpenCitations** は論文の識別子を受け取ります。キーやトークンは、それが属するサービスにだけ送られます。
- **言語モデルのエンドポイント**は、研究の筋書きを有効にして **Generate research narrative** を押したあとだけ、選んだ論文とその引用根拠を受け取ります。要約が含まれるのは、そのオプションがオンのときだけです。

既存の文献ノートを照合するため、プラグインは Markdown のパスを列挙し、ノートのプロパティ（YAML frontmatter）を読みます。コピーと書き出しはシステムのクリップボードへ書きます。プラグインはクリップボードを読みません。文献ノートを書く、または読書状態を変えると、その保管庫のファイルが更新されます。

プロジェクト、読書状態、保存した論文、サービスの資格情報は、この保管庫のプラグイン `data.json` に保存されます。資格情報は**暗号化されません**。保管庫の同期・バックアップツールがこのファイルを複製する場合があります。プラグインは利用統計を送らず、文献ノートのプロパティ以外のノート内容は読みません。

## 制限

- 地図は**標本**であり、完全な引用索引ではありません。被引用数の多い論文については、それを引用している論文のうち被引用数が多いものだけが入り、すべてではありません。
- 意味的類似度には、互換性のあるベクトルだけでなくローカルのテキストやトピック情報も使われる場合があります。研究の質を示すものではありません。重要な主張は原論文で確認してください。
- OpenAlex には既知の欠けがあります。要約がない、参考文献リストが不完全、著者の名寄せの誤りです。[利用ガイド](https://github.com/Abe-Junwei/research-connected/blob/main/docs/USER_GUIDE.md#data-quality-known-openalex-issues)が、それぞれの欠けとプラグインの扱いを挙げています。

## ヘルプとフィードバック

- **うまく動かない。** [不具合を報告](https://github.com/Abe-Junwei/research-connected/issues/new?template=bug_report.yml)してください。プラグインと Obsidian のバージョン、システム、手順、期待した結果と実際の結果を書きます。論文データの問題には、公開された DOI または OpenAlex ID があると助かります。
- **研究の手順を変えたい。** [機能を提案](https://github.com/Abe-Junwei/research-connected/issues/new?template=feature_request.yml)してください。作業、妨げ、必要な結果を書きます。
- **設定の助け。** [利用ガイド](https://github.com/Abe-Junwei/research-connected/blob/main/docs/USER_GUIDE.md)を読み、[既存の issue](https://github.com/Abe-Junwei/research-connected/issues)を確認してください。

英語か中国語で受け付けます。送信には GitHub アカウントが必要で、報告は公開されます。API キー、個人のノート、未公開の研究、保管庫一式、`data.json` は含めないでください。機能の提案は、実装や提供日を約束するものではありません。

## 更新とライセンス

変更点は[リリースノート](https://github.com/Abe-Junwei/research-connected/releases)にあります。予定は[ロードマップ](https://github.com/Abe-Junwei/research-connected/blob/main/ROADMAP.md)にあります。コードとドキュメントへの貢献は[貢献ガイド](https://github.com/Abe-Junwei/research-connected/blob/main/CONTRIBUTING.md)に従います。

[AGPL-3.0](https://github.com/Abe-Junwei/research-connected/blob/main/LICENSE)。Research Connected は独立したプロジェクトであり、Connected Papers とは関係ありません。
