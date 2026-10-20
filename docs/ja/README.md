<h1 align="center">Research Connected</h1>

<p align="center"><a href="https://github.com/Abe-Junwei/research-connected/blob/main/README.md">English</a> | <a href="https://github.com/Abe-Junwei/research-connected/blob/main/docs/zh-cn/README.md">简体中文</a> | <a href="https://github.com/Abe-Junwei/research-connected/blob/main/docs/zh-tw/README.md">繁體中文</a> | 日本語 | <a href="https://github.com/Abe-Junwei/research-connected/blob/main/docs/ko/README.md">한국어</a></p>

<p align="center"><img src="https://raw.githubusercontent.com/Abe-Junwei/research-connected/main/docs/images/logo.svg" width="96" height="96" alt="Research Connected のロゴ"></p>

<p align="center">関連する論文を地図にし、つながりごとの根拠を確認して、読んだ内容を Obsidian のリンクされたノートにします。</p>

<p align="center"><a href="https://github.com/Abe-Junwei/research-connected/blob/main/docs/ja/README.md#クイックスタート">クイックスタート</a> · <a href="https://github.com/Abe-Junwei/research-connected/blob/main/docs/USER_GUIDE.md">利用ガイド</a> · <a href="https://github.com/Abe-Junwei/research-connected/issues/new?template=bug_report.yml">不具合を報告</a> · <a href="https://github.com/Abe-Junwei/research-connected/issues/new?template=feature_request.yml">機能を提案</a></p>

<p align="center"><img src="https://img.shields.io/github/v/release/Abe-Junwei/research-connected?sort=semver" alt="GitHub リリース"> <img src="https://img.shields.io/badge/Obsidian-1.14.4%2B%20desktop-7c3aed" alt="Obsidian 1.14.4 以降のデスクトップ"> <img src="https://img.shields.io/github/license/Abe-Junwei/research-connected" alt="ライセンス"></p>

## 地図

![「Deep learning」を中心にしたグラフ。左が関連論文、右が選択した論文の関係の根拠](https://raw.githubusercontent.com/Abe-Junwei/research-connected/main/docs/images/graph-pane.png)

ノードか辺を選ぶと、共通の参考文献、共引用、直接の引用根拠が表示されます。

## できること

- **関連研究を見つける。** 題名、DOI、または OpenAlex ID を入力し、サンプリングした類似地図を作ります。Planar、Timeline、Radial のレイアウトを切り替えられます。
- **つながりを確認する。** 関係の背後にある参考文献と引用根拠を読みます。Semantic Scholar、Crossref、OpenCitations が欠けを補い、一致しない記録を示します。
- **読書を整理する。** 論文を仮置きし、読む予定か既読かを付け、ノイズを外し、名前付きビューを保存します。文献ノートを書いたり、グラフを埋め込んだり、BibTeX、YAML、Markdown を書き出したりできます。

## クイックスタート

1. **インストールして有効にする。** Obsidian で**設定 → コミュニティプラグイン → 閲覧**を開き、**Research Connected** を検索して、インストールし有効にします。
2. **最初の地図を作る。** コマンドパレットから **Open Research Connected** を実行します。下の DOI を貼り付けるか、論文題名を入力して **Build** を選びます。
3. **つながりを確認する。** 論文か辺を選び、地図にある理由を見ます。**Save view** で、その配置に戻れます。

```text
10.1038/nature14539
```

この例は、LeCun、Bengio、Hinton が 2015 年に発表した “Deep learning” です。元データベースが更新されると、結果は変わり得ます。

**手動インストール。** [最新リリース](https://github.com/Abe-Junwei/research-connected/releases/latest)から `main.js`、`manifest.json`、`styles.css` をダウンロードし、`<vault>/.obsidian/plugins/research-connected/` に置きます。Obsidian を再読み込みして、プラグインを有効にします。

## 時間軸で研究を見る

![発表年で並べた Timeline。レイアウトの操作と年のスライダーがある](https://raw.githubusercontent.com/Abe-Junwei/research-connected/main/docs/images/timeline.png)

**Timeline** に切り替えます。年のスライダーで見える範囲を狭め、保存したビューで役立つ選択に戻れます。

## ノートのそばにグラフを置く

![段落のあいだに Research Connected のグラフを埋め込んだ読書ノート](https://raw.githubusercontent.com/Abe-Junwei/research-connected/main/docs/images/note-embed.png)

次のブロックをノートに追加します。リーディングビューとライブプレビューで表示されます。

````markdown
```research-connected
doi: 10.1038/nature14539
height: 520
layout: temporal
```
````

論文を選び、**Export → Write to note** で文献ノートを作ります。プラグインは DOI または OpenAlex ID で既存のノートを認識し、読書状態が変わると `rc-status` を同期します。フォルダ、ファイル名、本文テンプレート、DOI プロパティは設定で指定します。

埋め込みオプション、フロントマター、サンプリング、アルゴリズムは[利用ガイド](https://github.com/Abe-Junwei/research-connected/blob/main/docs/USER_GUIDE.md)にあります。古い埋め込み名 `connected-papers` も使えます。

## 始める前に

- **デスクトップ。** Obsidian 1.14.4 以降。モバイルは実機での確認待ちです。
- **ネットワーク。** 地図を作ると、外部の学術サービスへ問い合わせます。プロジェクトと読書状態は保管庫に残ります。
- **サービスキー。** OpenAlex API キーは任意で、設定を推奨します。[OpenAlex の設定](https://openalex.org/settings/api)で作成できます。手順は[ガイド](https://github.com/Abe-Junwei/research-connected/blob/main/docs/USER_GUIDE.md)にあります。
- **サンプリング。** 地図は引用の近傍から取った標本であり、起点を引用するすべての論文ではありません。
- **ノート。** 文献ノートを認識するため、フロントマターを読みます。ノートのファイルが変わるのは、書き込むときか読書状態を変えるときだけです。
- **AI。** 研究の筋書きは初期状態でオフです。地図を見るのに言語モデルは不要です。
- **表示言語。** 中国語の環境では簡体字、それ以外（日本語を含む）では英語です。上のコマンドとボタン名は、そのため英語のままです。

## 通信とプライバシー

- **OpenAlex** は、入力した DOI、OpenAlex ID、検索文、そして設定した API キーを受け取ります。
- **Semantic Scholar**、**Crossref**、**OpenCitations** は論文の識別子を受け取ります。キーやトークンは、それが属するサービスにだけ送られます。
- **言語モデルのエンドポイント**は、研究の筋書きを有効にして **Generate research narrative** を押したあとだけ、選んだ論文とその引用根拠を受け取ります。要約が含まれるのは、そのオプションがオンのときだけです。

既存の文献ノートを照合するため、プラグインは Markdown のパスを列挙し、キャッシュされたフロントマターを読みます。コピーと書き出しはシステムのクリップボードへ書きます。プラグインはクリップボードを読みません。文献ノートを書く、または読書状態を変えると、その保管庫のファイルが更新されます。

プロジェクト、読書状態、保存したビュー、サービスの資格情報は、この保管庫のプラグイン `data.json` に保存されます。資格情報は**暗号化されません**。プラグインは利用統計を送らず、文献ノートのフロントマター以外のノートは読みません。

## 制限

- 地図は**標本**であり、完全な引用索引ではありません。被引用数の多い論文については、それを引用している論文のうち被引用数が多いものだけが入り、すべてではありません。
- 類似度とコミュニティの色は探索用です。重要な主張は原論文で確認してください。
- OpenAlex には既知の欠けがあります。要約がない、参考文献リストが不完全、著者の名寄せの誤りです。[利用ガイド](https://github.com/Abe-Junwei/research-connected/blob/main/docs/USER_GUIDE.md#data-quality-known-openalex-issues)が、それぞれの欠けとプラグインの扱いを挙げています。

## ヘルプとフィードバック

- **うまく動かない。** [不具合を報告](https://github.com/Abe-Junwei/research-connected/issues/new?template=bug_report.yml)してください。プラグインと Obsidian のバージョン、システム、手順、期待した結果と実際の結果を書きます。論文データの問題には、公開された DOI または OpenAlex ID があると助かります。
- **研究の手順を変えたい。** [機能を提案](https://github.com/Abe-Junwei/research-connected/issues/new?template=feature_request.yml)してください。作業、妨げ、必要な結果を書きます。
- **設定の助け。** [利用ガイド](https://github.com/Abe-Junwei/research-connected/blob/main/docs/USER_GUIDE.md)を読み、[既存の issue](https://github.com/Abe-Junwei/research-connected/issues)を確認してください。

英語か中国語で受け付けます。送信には GitHub アカウントが必要で、報告は公開されます。API キー、個人のノート、未公開の研究、保管庫一式、`data.json` は含めないでください。機能の提案は、実装や提供日を約束するものではありません。

## 更新とライセンス

変更点は[リリースノート](https://github.com/Abe-Junwei/research-connected/releases)にあります。予定は[ロードマップ](https://github.com/Abe-Junwei/research-connected/blob/main/ROADMAP.md)にあります。コードとドキュメントへの貢献は[貢献ガイド](https://github.com/Abe-Junwei/research-connected/blob/main/CONTRIBUTING.md)に従います。

[MIT](https://github.com/Abe-Junwei/research-connected/blob/main/LICENSE)。Research Connected は独立したプロジェクトであり、Connected Papers とは関係ありません。
