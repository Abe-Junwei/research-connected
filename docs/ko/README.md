<h1 align="center">Research Connected</h1>

<p align="center"><a href="https://github.com/Abe-Junwei/research-connected/blob/main/README.md">English</a> | <a href="https://github.com/Abe-Junwei/research-connected/blob/main/docs/zh-cn/README.md">简体中文</a> | <a href="https://github.com/Abe-Junwei/research-connected/blob/main/docs/zh-tw/README.md">繁體中文</a> | <a href="https://github.com/Abe-Junwei/research-connected/blob/main/docs/ja/README.md">日本語</a> | 한국어</p>

<p align="center"><img src="https://raw.githubusercontent.com/Abe-Junwei/research-connected/main/docs/images/logo.svg" width="96" height="96" alt="Research Connected 로고"></p>

<p align="center">관련 논문을 지도로 그리고, 연결마다 근거를 확인한 뒤, 읽은 내용을 Obsidian의 서로 연결된 노트로 남깁니다.</p>

<p align="center"><a href="https://github.com/Abe-Junwei/research-connected/blob/main/docs/ko/README.md#빠른-시작">빠른 시작</a> · <a href="https://github.com/Abe-Junwei/research-connected/blob/main/docs/USER_GUIDE.md">사용 안내</a> · <a href="https://github.com/Abe-Junwei/research-connected/issues/new?template=bug_report.yml">문제 보고</a> · <a href="https://github.com/Abe-Junwei/research-connected/issues/new?template=feature_request.yml">기능 제안</a></p>

<p align="center"><img src="https://img.shields.io/github/v/release/Abe-Junwei/research-connected?sort=semver" alt="GitHub 릴리스"> <img src="https://img.shields.io/badge/Obsidian-1.14.4%2B%20desktop-7c3aed" alt="Obsidian 1.14.4 이상 데스크톱"> <img src="https://img.shields.io/github/license/Abe-Junwei/research-connected" alt="라이선스"></p>

## 지도

![“Deep learning”을 중심으로 한 그래프. 왼쪽은 관련 논문, 오른쪽은 선택한 논문의 관계 근거](https://raw.githubusercontent.com/Abe-Junwei/research-connected/main/docs/images/graph-pane.png)

노드나 간선을 선택하면 공통 참고문헌, 동시 인용, 직접 인용 근거를 볼 수 있습니다.

## 할 수 있는 일

- **관련 연구를 찾습니다.** 제목, DOI 또는 OpenAlex ID를 입력해 표본으로 뽑은 유사도 지도를 만듭니다. Planar, Timeline, Radial 레이아웃을 바꿀 수 있습니다.
- **연결을 확인합니다.** 관계 뒤의 참고문헌과 인용 근거를 읽습니다. Semantic Scholar, Crossref, OpenCitations가 빈틈을 메우고, 맞지 않는 기록을 표시합니다.
- **읽기를 정리합니다.** 논문을 잠시 두고, 읽을 예정이나 읽음으로 표시하고, 불필요한 항목을 빼고, 이름 있는 보기를 저장합니다. 문헌 노트를 쓰거나, 그래프를 넣거나, BibTeX, YAML, Markdown으로 내보낼 수 있습니다.

## 빠른 시작

1. **설치하고 켭니다.** Obsidian에서 **설정 → 커뮤니티 플러그인 → 탐색**을 열고 **Research Connected**를 검색한 다음 설치하고 활성화합니다.
2. **첫 지도를 만듭니다.** 명령어 팔레트에서 **Open Research Connected**를 실행합니다. 아래 DOI를 붙여 넣거나 논문 제목을 입력한 뒤 **Build**를 선택합니다.
3. **연결을 확인합니다.** 논문이나 간선을 선택해 지도에 있는 이유를 봅니다. **Save view**로 그 배치로 돌아갑니다.

```text
10.1038/nature14539
```

이 예는 LeCun, Bengio, Hinton이 2015년에 발표한 “Deep learning”입니다. 원본 데이터베이스가 갱신되면 결과가 달라질 수 있습니다.

**수동 설치.** [최신 릴리스](https://github.com/Abe-Junwei/research-connected/releases/latest)에서 `main.js`, `manifest.json`, `styles.css`를 받아 `<vault>/.obsidian/plugins/research-connected/`에 넣습니다. Obsidian을 다시 불러온 뒤 플러그인을 켭니다.

## 시간 순으로 보기

![발표 연도별로 늘어선 Timeline. 레이아웃 조작과 연도 슬라이더가 있다](https://raw.githubusercontent.com/Abe-Junwei/research-connected/main/docs/images/timeline.png)

**Timeline**으로 바꿉니다. 연도 슬라이더로 보이는 범위를 좁히고, 저장한 보기로 유용했던 선택으로 돌아갑니다.

## 노트 옆에 그래프 두기

![문단 사이에 Research Connected 그래프가 들어간 읽기 노트](https://raw.githubusercontent.com/Abe-Junwei/research-connected/main/docs/images/note-embed.png)

아래 블록을 노트에 넣습니다. 읽기 화면과 실시간 미리보기에서 나타납니다.

````markdown
```research-connected
doi: 10.1038/nature14539
height: 520
layout: temporal
```
````

논문을 선택한 뒤 **Export → Write to note**를 고르면 문헌 노트가 만들어집니다. 플러그인은 DOI 또는 OpenAlex ID로 기존 노트를 알아보고, 읽기 상태가 바뀌면 `rc-status`를 맞춥니다. 폴더, 파일 이름, 본문 템플릿, DOI 속성은 설정에서 지정합니다.

임베드 옵션, 프론트매터, 표본 추출, 알고리즘은 [사용 안내](https://github.com/Abe-Junwei/research-connected/blob/main/docs/USER_GUIDE.md)에 있습니다. 예전 임베드 이름 `connected-papers`도 동작합니다.

## 시작하기 전에

- **데스크톱.** Obsidian 1.14.4 이상. 모바일은 기기 확인을 기다립니다.
- **네트워크.** 지도를 만들면 외부 학술 서비스에 질의합니다. 프로젝트와 읽기 상태는 보관함에 남습니다.
- **서비스 키.** OpenAlex API 키는 선택 사항이며, 설정을 권합니다. [OpenAlex 설정](https://openalex.org/settings/api)에서 만들 수 있습니다. 방법은 [안내](https://github.com/Abe-Junwei/research-connected/blob/main/docs/USER_GUIDE.md)에 있습니다.
- **표본.** 지도는 인용 이웃의 표본이며, 기준 논문을 인용한 모든 논문이 아닙니다.
- **노트.** 문헌 노트를 알아보려고 프론트매터를 읽습니다. 노트 파일은 노트를 쓰거나 읽기 상태를 바꿀 때만 바뀝니다.
- **AI.** 연구 서사는 기본적으로 꺼져 있습니다. 지도를 보는 데 언어 모델은 필요 없습니다.
- **인터페이스 언어.** 중국어 환경에서는 간체, 그 밖(한국어 포함)에서는 영어입니다. 위의 명령과 버튼 이름이 영어인 이유입니다.

## 네트워크 사용과 개인정보

- **OpenAlex**는 입력한 DOI, OpenAlex ID, 검색 텍스트와 설정한 API 키를 받습니다.
- **Semantic Scholar**, **Crossref**, **OpenCitations**는 논문 식별자를 받습니다. 키나 토큰은 해당 서비스에만 보냅니다.
- **언어 모델 엔드포인트**는 연구 서사를 켜고 **Generate research narrative**를 누른 뒤에만 선택한 논문과 인용 근거를 받습니다. 초록은 그 옵션이 켜져 있을 때만 포함됩니다.

기존 문헌 노트를 맞추려고 플러그인은 Markdown 경로를 나열하고 캐시된 프론트매터를 읽습니다. 복사와 내보내기는 시스템 클립보드에 씁니다. 플러그인은 클립보드를 읽지 않습니다. 문헌 노트를 쓰거나 읽기 상태를 바꾸면 그 보관함 파일이 갱신됩니다.

프로젝트, 읽기 상태, 저장한 보기, 서비스 자격 증명은 이 보관함 플러그인의 `data.json`에 저장됩니다. 자격 증명은 **암호화되지 않습니다**. 플러그인은 원격 측정을 보내지 않으며, 문헌 노트 프론트매터 밖의 노트는 읽지 않습니다.

## 한계

- 지도는 **표본**이며 완전한 인용 색인이 아닙니다. 인용이 많은 논문은, 그 논문을 인용한 문헌 가운데 인용 수가 많은 것만 들어가며 전부가 아닙니다.
- 유사도와 커뮤니티 색은 탐색용입니다. 중요한 주장은 원논문과 대조하세요.
- OpenAlex에는 알려진 빈틈이 있습니다. 초록 누락, 참고문헌 목록 불완전, 저자 식별 오류입니다. [사용 안내](https://github.com/Abe-Junwei/research-connected/blob/main/docs/USER_GUIDE.md#data-quality-known-openalex-issues)에 각 빈틈과 플러그인의 처리가 있습니다.

## 도움과 피드백

- **동작하지 않습니다.** [문제를 보고](https://github.com/Abe-Junwei/research-connected/issues/new?template=bug_report.yml)하세요. 플러그인과 Obsidian 버전, 시스템, 단계, 기대한 결과와 실제 결과를 적습니다. 논문 데이터 문제에는 공개 DOI 또는 OpenAlex ID가 도움이 됩니다.
- **연구 절차를 바꿔야 합니다.** [기능을 제안](https://github.com/Abe-Junwei/research-connected/issues/new?template=feature_request.yml)하세요. 작업, 막힌 지점, 필요한 결과를 적습니다.
- **설치 도움.** [사용 안내](https://github.com/Abe-Junwei/research-connected/blob/main/docs/USER_GUIDE.md)를 읽고 [기존 이슈](https://github.com/Abe-Junwei/research-connected/issues)를 확인하세요.

영어와 중국어로 받을 수 있습니다. 제출에는 GitHub 계정이 필요하고, 보고는 공개됩니다. API 키, 개인 노트, 미공개 연구, 보관함 전체, `data.json`은 넣지 마세요. 기능 제안이 구현이나 제공 시점을 약속하지는 않습니다.

## 업데이트와 라이선스

변경은 [릴리스 노트](https://github.com/Abe-Junwei/research-connected/releases)에 있습니다. 예정된 작업은 [로드맵](https://github.com/Abe-Junwei/research-connected/blob/main/ROADMAP.md)에 있습니다. 코드와 문서 기여는 [기여 안내](https://github.com/Abe-Junwei/research-connected/blob/main/CONTRIBUTING.md)를 따릅니다.

[MIT](https://github.com/Abe-Junwei/research-connected/blob/main/LICENSE). Research Connected는 독립 프로젝트이며 Connected Papers와 관련이 없습니다.
