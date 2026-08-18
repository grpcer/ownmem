<div align="center">

# OwnMem — 面向 AI 程式開發 Agent 的 Git 原生專案記憶

**記憶歸儲存庫所有：留在本機、結果確定、全程可審閱。**

開源的 AI 記憶系統，專為程式開發 Agent 與程式碼儲存庫而設計。<br>
同一份長期專案記憶可供 Claude Code · Codex · Antigravity · Cursor · Gemini CLI · Grok CLI 使用。

[![npm version](https://img.shields.io/npm/v/ownmem?style=flat-square&logo=npm&color=cb3837)](https://www.npmjs.com/package/ownmem)
[![node >= 20](https://img.shields.io/badge/node-%E2%89%A5%2020-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![license Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-1d7afc?style=flat-square)](../../LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/grpcer/ownmem/ci.yml?branch=main&style=flat-square&logo=githubactions&logoColor=white&label=CI)](https://github.com/grpcer/ownmem/actions/workflows/ci.yml)
[![recall P95 2.46 ms](https://img.shields.io/badge/recall%20P95-2.46%20ms-8250df?style=flat-square)](#benchmarks)
[![model calls 0](https://img.shields.io/badge/model%20calls-0-8250df?style=flat-square)](#benchmarks)

[English](../../README.md) · [简体中文](./README.zh-CN.md) · **繁體中文** · [日本語](./README.ja.md) · [한국어](./README.ko.md) · [Español](./README.es.md) · [Français](./README.fr.md) · [Deutsch](./README.de.md) · [Português (BR)](./README.pt-BR.md)

</div>

## OwnMem 是什麼？

OwnMem 是一套開源的 **AI Agent 記憶系統**，讓 Claude Code、Codex 與其他
程式開發 Agent 共用保存在儲存庫中的**長期專案記憶**。它不把 **Claude Code 記憶**
或 **Codex 記憶**鎖在單一工具，而是將同一份可審閱的純 Markdown
存放在 `.ownmem/`，再由支援多種 Unicode 文字系統的確定性 BM25F 引擎排序。
對於相同的查詢、設定與已編譯快照，預設召回會傳回相同排序，不呼叫模型、不傳送
網路請求，也不消耗查詢時 Token；在鎖定的公開基準中，約兩毫秒即可完成。

OwnMem 由兩個部分組成。**npm 套件**是核心引擎：以可審閱並能鎖定版本的
`devDependency` 安裝在每個儲存庫中，管理該儲存庫 `.ownmem/` 裡的記憶。
**Agent 外掛**則是選用的便利層，每台電腦只需安裝一次；它會教 Agent 如何
執行引擎，也會引導你完成每個儲存庫的設定。

> **注意：** 儲存庫只要同時擁有套件與 `.ownmem/` 就已準備完成，無論你先從
> 哪一個部分開始都可以。

## OwnMem 一覽

| 項目 | 事實 |
| --- | --- |
| 類別 | 歸儲存庫所有的 AI 程式開發 Agent 專案記憶 |
| 範圍 | 單一儲存庫 |
| 儲存 | `.ownmem/` 中可審閱的 Markdown，由 Git 版本控管 |
| 預設檢索 | 確定性 BM25F；召回時 0 次模型呼叫、0 次網路呼叫 |
| 公開基準 | v0.2.0 鎖定合成基準：Recall@1 100%、P95 2.46 ms；這是回歸證據，不代表實際使用準確率 |
| 授權 | Apache-2.0 |

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/architecture-dark.svg">
  <img alt="OwnMem 端對端架構，分為三個信任範圍：儲存庫保存精選的 Markdown，通過治理檢查後編譯為不可變快照；確定性引擎透過六條候選管道、排序、信心門檻與 400 Token 上下文封套回答；程式開發 Agent 提問、對照目前程式碼驗證，並將新經驗經由 audit 與 compile 寫回儲存庫" src="../assets/architecture-light.svg" width="100%">
</picture>

<a id="quick-start"></a>

## 快速開始

OwnMem 需要 Node.js 20 或更新版本。請在你想加入記憶的儲存庫內完成以下三個
步驟。

**步驟 1——安裝引擎。** 它會成為一般的 `devDependency`，可以像其他相依套件
一樣接受審閱並鎖定版本：

```bash
npm install --save-dev ownmem
```

**步驟 2——初始化此儲存庫。** 這會建立 `.ownmem/` 與各 Agent 的轉接檔案：

```bash
npx ownmem init --locale auto --hosts claude,codex --layers dashboard --hook
```

**步驟 3——重新開啟 Agent。** Agent 會在工作階段開始時探索命令，因此下列
功能會出現在下一個工作階段，而不是剛才執行 init 的工作階段。

這是建議設定：Claude Code 與 Codex 可直接使用，也會一併安裝本機控制台。
重新開啟後，你會得到：

- **Claude Code** 會新增專案命令：`/ownmem <anything you want the
  memory to do>`。
- **Codex 與 Grok CLI** 會自動探索儲存庫內的 `ownmem` skill。
- **Antigravity** 會讀取相同的專案指示（`AGENTS.md`、`GEMINI.md`），因此也會
  遵守記憶規範；其他會讀取這些檔案的 Agent 亦同。
- **控制台**是終端機命令，不是斜線命令：`npx ownmem dashboard --open`。
  （下方的選用外掛會另外加入 `/ownmem:dashboard`。）

日常使用不需要再執行任何設定命令，照常工作即可。每個需要獨立記憶的儲存庫，
都只要執行一次上述三個步驟。

只使用一種 Agent？請將 `--hosts claude,codex` 改為 `--hosts claude` 或
`--hosts codex`。Antigravity 與 Grok CLI 會讀取和 Codex 相同的 `AGENTS.md`
檔案（Grok 也會讀取 `.agents/skills/`），因此 `--hosts codex` 也涵蓋這兩者。
Cursor 使用 `--hosts cursor`，傳統 Gemini CLI 設定使用 `--hosts gemini`，
其他 Agent 則可使用 `--hosts generic`。

初始化會建立 `.ownmem/`，並在 Agent 的專案指示中加入一小段 OwnMem 內容；
它絕不會更動標記範圍之外的文字。

## 日常使用

設定完成後，只需要記得兩件事。

**1. 直接和 Agent 對話。** 當你學到值得保留的經驗時，用平常說話的方式告訴它：

> 「記住這件事——逾時是連線池上限造成的，不是 worker 數量不足。除非同時
> 提高連線池上限，否則絕對不要增加 worker。」

之後照平常的方式提問即可：

> 「測試環境的部署又卡住了。修改任何內容之前，先查一下專案記憶。」

Agent 會處理寫入、驗證與召回。你不需要開啟 `.ownmem/`，也不必自行執行
`audit` 或 `recall`。偏好明確的命令嗎？`/ownmem <request>`（Claude Code）和
`ownmem` skill（Codex）會將同一項要求交給記憶處理。

**2. 想掌握全貌時再開啟控制台。** 控制台會顯示此儲存庫的採用情形、召回品質、
延遲與記憶健康狀態，而且只能從你自己的電腦透過 127.0.0.1 存取：

```bash
npx ownmem dashboard --open
```

<img alt="OwnMem 控制台——採用漏斗、召回品質、語料庫與治理狀態，全部在本機" src="../assets/console.png" width="100%">

日常流程就只有這些。`audit`、手動 `recall` 與意見回饋命令是提供給 CI 和疑難
排解使用的，一般使用者不需要記住它們。

## 專案緣起

我正在開發 Oriveo，這是一款採 BYOK 模式的多模型 AI 用戶端，支援 iOS、
Android、Web 與桌面平台。這個大型程式碼庫每天都由我和程式開發 Agent 一起
維護，我也經常在 Claude Code 與 Codex 之間切換。每個儲存庫都會累積得來不易的
經驗：除錯根因、工具鏈陷阱與時序競爭。然而每次更換 Agent、電腦或協作者，這些
經驗就會悄悄消失，因為它們只存在某個工具、某台電腦的記憶裡。

向量與雲端記憶服務一直不適合這個情境：關於儲存庫的知識，不該需要帳號、伺服器，
也不該按查詢次數計費。因此，記憶搬進了儲存庫本身。OwnMem 正是我每天在 Oriveo
程式碼庫中使用的系統——數百條經過整理的記憶，由配額與稽核維持品質——再抽離並
重建為乾淨的公開引擎。

## 為什麼選擇 OwnMem

OwnMem 建立在四項原則上，所有設計決策都由此而來：

- **記憶屬於儲存庫。** 可審閱的 Markdown 隨 Git 流動、出現在 PR 中，也能像
  任何程式碼一樣回復版本。複製儲存庫就能取得記憶，不需要帳號、同步服務或匯出
  步驟。
- **召回必須免費且具確定性。** 相同查詢會得到相同排序，預設召回沒有模型呼叫、
  額外網路延遲或按次計費；在鎖定的公開基準中，Recall@1 為 100%，P95 為
  2.46 ms。
- **記憶必須比任何單一工具更長久。** 同一組檔案可供 Claude Code、Codex、
  Antigravity、Cursor 與 Grok CLI 使用，因此切換 Agent 不再代表失去團隊累積的
  知識。
- **記憶必須保持精簡，才值得信任。** 零淨成長配額、純 Node 稽核、近似重複與
  漂移檢查會讓內容保持精簡且符合現況，而不是變成無人整理的第二套 Wiki。

### OwnMem 不適合哪些情境

- **它不是向量資料庫。** 如果你要對大型記憶池進行模糊語意搜尋，向量或知識圖譜
  記憶服務會更合適。
- **它不會自動擷取所有內容。** 寫入是刻意且經過篩選的，審閱就是品質關卡。
  工具內建記憶更方便，但代價是綁定單一工具且不易審閱。
- **它不是跨儲存庫或雲端同步記憶。** 記憶隨儲存庫自己的 Git 歷史移動；複製
  儲存庫即可取得。但依設計，它不會在儲存庫之間共用，也不會經過記憶服務。

## `.ownmem/` 內部：三層記憶

固定載入的部分維持極小，其餘內容則按需讀取：

| 層級 | 檔案 | 讀取時機 |
| --- | --- | --- |
| **L1** | `MEMORY.md` | 總索引——每個工作階段開始時載入 |
| **L2** | `MEMORY-<area>.md` | 領域子索引——處理該領域時開啟 |
| **L3** | 每個主題一個檔案 | 每個檔案只記錄一項經驗——觸發條件吻合時由 `recall` 傳回 |

主題檔案是具有嚴格 schema 檢查之 frontmatter 的純 Markdown；症狀與不同說法
寫在 `triggers`，證據則寫在 `evidence`（此處為節錄；`ownmem init` 會建立完整
範例）：

```markdown
---
name: pool_cap_timeout
description: staging deploys time out when workers exceed the pool cap
metadata:
  type: lesson
  triggers: ["staging deploy timeout", "pool cap exceeded"]
  evidence: [deploy-2026-08-12.log]
---

Raising the worker count without raising the connection pool cap exhausts
the pool, and every deploy waits until it times out. Raise both together.
```

這個結構讓預設召回不需要模型成本：索引小到足以固定載入，BM25F 只需要排序
體積小且標示清楚的主題檔案。

<a id="how-ownmem-compares"></a>

## OwnMem 與其他方案的比較

下表中的每一欄都在解決真實問題；表格呈現各自的取捨，也包括 OwnMem 本身。

| | OwnMem | [Mem0 (OSS)](https://github.com/mem0ai/mem0) | [Zep / Graphiti](https://github.com/getzep/graphiti) | [claude-mem](https://github.com/thedotmack/claude-mem) | 工具內建自動記憶¹ |
| --- | :---: | :---: | :---: | :---: | :---: |
| 記憶位於你的儲存庫中，隨 Git 與 PR 流動 | ✅ | ❌ | ❌ | ❌ | ❌ |
| 人類可讀、可審閱的 Markdown | ✅ | ❌ | ❌ | ❌ | ⚠️² |
| 預設召回不需要模型或網路呼叫 | ✅ | ❌³ | ❌ | ❌ | — |
| 確定且可重現的排序 | ✅ | ❌ | ❌ | ❌ | — |
| 一份記憶供 Claude Code、Codex、Antigravity、Cursor、Gemini CLI、Grok CLI 使用 | ✅ | ⚠️⁴ | ⚠️⁴ | ⚠️⁴ | ❌ |
| 防止膨脹的治理（成長配額、稽核、漂移檢查） | ✅ | ❌ | ❌ | ❌ | ⚠️⁵ |
| 語意改寫搜尋 | ⚠️⁶ | ✅ | ✅ | ✅ | ❌ |
| 完全自動擷取 | ❌⁷ | ✅ | ✅ | ✅ | ✅ |
| 跨儲存庫、使用者層級記憶 | ❌⁷ | ✅ | ✅ | ⚠️ | ❌ |

¹ Claude Code 自動記憶與 Codex Memories 的檔案位於使用者家目錄中，只存在
單機、綁定單一工具，而且不在儲存庫內。Cursor 已在 2.1 版淘汰 Memories，改用
Rules；Windsurf 記憶則保留在單一電腦上，永遠不會提交。
² 它是可編輯的 Markdown，但位於儲存庫之外，因此永遠不會出現在 PR 中。
³ Mem0 的 Apache-2.0 程式庫可以在本機執行，但寫入與查詢記憶仍需要 LLM 和
embedding 模型（預設需要 OpenAI 金鑰，也可以透過 Ollama 使用本機模型）。
⁴ 透過 MCP server 或本身的 API 使用；記憶範圍以使用者或應用程式為單位，
並不是由儲存庫擁有的一組檔案。
⁵ Claude Code 限制固定載入索引的大小（200 行 / 25 KB），但背後沒有配額、
稽核或重複內容檢查。
⁶ 選用的 embedding 管道預設關閉；只有本機 A/B 證據通過安全門檻後才會加入
排序。
⁷ 這是刻意的設計。OwnMem 選擇經過整理與審閱的寫入，以及單一儲存庫範圍；
若你需要自動擷取或跨應用程式的使用者層級記憶，其他工具確實更合適。

以上事實於 2026 年 8 月依各專案的公開文件查核：[Mem0](https://docs.mem0.ai)、
[Zep / Graphiti](https://help.getzep.com/graphiti/getting-started/overview)、
[claude-mem](https://github.com/thedotmack/claude-mem)、
[Claude Code auto memory](https://code.claude.com/docs/en/memory)、
[Codex memories](https://developers.openai.com/codex/memories)、
[Cursor rules](https://cursor.com/docs/context/rules)、
[Windsurf memories](https://docs.devin.ai/desktop/cascade/memories)；歡迎提出修正。

<a id="benchmarks"></a>

## 效能評測

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/benchmark-dark.svg">
  <img alt="OwnMem 效能評測：Recall@1 為 100%，固定字串 grep 為 3.1%；召回延遲 P50 為 1.17 ms、P95 為 2.46 ms，發布門檻為 5 ms" src="../assets/benchmark-light.svg" width="100%">
</picture>

每次發布都必須通過鎖定的公開基準：一套涵蓋 40 個主題、40 個 BCP 47 語言標籤
與 25 個文字系統群組的 CC0 語料庫，其中有 128 個正向查詢與 40 個無關負向查詢。
下列數據來自發布等級的執行結果（每個查詢進行 25 次計時迭代）：

| 指標 | 結果 | 發布門檻 |
| --- | --- | --- |
| Recall@1 / Recall@5（128 個正向查詢） | **100% / 100%** | = 100% |
| MRR | **1.000** | = 1.000 |
| 對 40 個無關查詢棄答 | **40 / 40** | = 100% |
| 召回延遲 P50 / P95（4,200 個計時樣本） | **1.17 ms / 2.46 ms** | P95 ≤ 5 ms |
| 在相同門檻下測試的語言 / 文字系統 | 40 個標籤 / 25 個文字系統 | 每種語言與文字系統的 P95 ≤ 5 ms |
| 召回期間的模型呼叫 / 網路呼叫 | **0 / 0** | = 0 |
| 執行階段相依套件 | 2 個（`ajv`、`yaml`——純 JS） | 鎖定 |
| 執行期間的額外記憶體（RSS 差值） | < 2 MB | — |

在相同語料庫上，不區分大小寫的固定字串 grep 之 Recall@1 為 3.1%。單靠詞彙式與
確定性並不是關鍵，真正發揮作用的是能辨識 Unicode 文字系統的 BM25F 排序。

你可以自行重現：

```bash
git clone https://github.com/grpcer/ownmem
cd ownmem && npm ci && npm run benchmark
```

> **注意：** 測量環境為 Apple M5 Pro 與 Node 25。語料庫雜湊、排序與門檻均已
> 鎖定，而且執行時會以相反的主題順序重跑，以證明結果具確定性。這些合成指標是
> 回歸測試證據，不代表真實使用者環境中的準確率。

## 參考文獻

排序公式並非自行發明；引擎中的每一項技術都是經過發表與實務驗證的方法。
OwnMem 的貢獻在於將它們組合成一個具確定性、僅使用少量相依套件的引擎：

| 在 OwnMem 中的用途 | 技術 | 文獻 |
| --- | --- | --- |
| `bm25f` 管道 | 欄位加權 BM25 排序 | Robertson & Zaragoza (2009), *[The Probabilistic Relevance Framework: BM25 and Beyond](https://doi.org/10.1561/1500000019)*; Robertson, Zaragoza & Taylor (2004), *[Simple BM25 extension to multiple weighted fields](https://doi.org/10.1145/1031171.1031181)* |
| 管道與多查詢融合 | Reciprocal Rank Fusion | Cormack, Clarke & Büttcher (2009), *[Reciprocal rank fusion outperforms Condorcet and individual rank learning methods](https://doi.org/10.1145/1571941.1572114)* |
| 結果多樣性 | Maximal Marginal Relevance | Carbonell & Goldstein (1998), *[The use of MMR, diversity-based reranking for reordering documents and producing summaries](https://doi.org/10.1145/290941.291025)* |
| `ngram` 管道 | 字元 n-gram 相似度（Dice） | Dice (1945), *[Measures of the amount of ecologic association between species](https://doi.org/10.2307/1932409)* |
| `fuzzy` 管道 | 有界編輯距離 | Levenshtein (1966), *Binary codes capable of correcting deletions, insertions, and reversals*, Soviet Physics Doklady 10(8) |
| 近似重複檢查 | SimHash | Charikar (2002), *[Similarity estimation techniques from rounding algorithms](https://doi.org/10.1145/509907.509965)*; Manku, Jain & Das Sarma (2007), *[Detecting near-duplicates for web crawling](https://doi.org/10.1145/1242572.1242592)* |
| 近似重複檢查 | MinHash | Broder (1997), *[On the resemblance and containment of documents](https://doi.org/10.1109/SEQUEN.1997.666900)* |
| Tokenizer | 能辨識文字系統的分段 | *[UAX #24: Unicode Script Property](https://unicode.org/reports/tr24/)*; *[UAX #29: Unicode Text Segmentation](https://unicode.org/reports/tr29/)* |

## 安裝 Agent 外掛（選用，每台電腦一次）

**一定要安裝嗎？不需要；略過外掛，所有功能仍可運作。** `ownmem init` 已將記憶
規範寫入儲存庫的 Agent 指示，因此任何開啟儲存庫的 Agent 都會遵守它。外掛提供
的是整台電腦的便利功能：它會將相同的三項 skill 加到電腦上的每個儲存庫，包括
尚未擁有 `.ownmem/` 的儲存庫；此時 init skill 會引導 Agent 完成引擎設定。
此儲存庫同時也是外掛 marketplace，而外掛命令只會轉交給 `npx ownmem`，因此
更新外掛絕不會重寫你的記憶。

一個外掛、三項 skill、同一組名稱：

| Skill | Claude Code | Codex CLI | 功能 |
| --- | --- | --- | --- |
| `recall` | `/ownmem:recall` | `ownmem:recall` | 修改程式碼前先召回記憶 |
| `init` | `/ownmem:init` | `ownmem:init` | 在儲存庫中設定或更新 OwnMem |
| `dashboard` | `/ownmem:dashboard` | `ownmem:dashboard` | 開啟本機控制台 |

**Claude Code**——依序執行以下兩個命令：第一個命令會將此儲存庫登錄為外掛
marketplace（只需一次），第二個命令則從中安裝外掛：

```
/plugin marketplace add grpcer/ownmem
/plugin install ownmem@ownmem
```

接著重新啟動 Claude Code。外掛命令會在工作階段開始時載入，因此會出現在下一個
工作階段，而不是剛才安裝外掛的工作階段。若要自動取得新版本，請在 `/plugin` →
Marketplaces 中為該 marketplace 啟用自動更新。

**Codex CLI**——同樣依序執行兩個步驟：先登錄 marketplace，再加入外掛：

```
codex plugin marketplace add grpcer/ownmem
codex plugin add ownmem@ownmem
```

Skill 同樣會在工作階段開始時載入；你可以在 `$` skill 選擇器中找到它們。之後
如需更新，請先執行 `codex plugin marketplace upgrade ownmem`，再執行
`codex plugin add ownmem@ownmem`。

**Grok CLI**——同樣依序執行兩個命令：先登錄 marketplace，再進行安裝；Grok
要求明確加上 `--trust`。如果 Grok 已匯入你的 Claude Code marketplaces，可略過
第一個命令：

```
grok plugin marketplace add grpcer/ownmem
grok plugin install ownmem@ownmem --trust
```

這會安裝相同的三項 skill。若未加命名空間的 skill 名稱已被使用，Grok 會自動
加上命名空間；由於它內建 dashboard，我們的版本會顯示為 `/ownmem:dashboard`。
更新時請執行 `grok plugin update ownmem`。

**Antigravity**——只需要一個命令，不需經過 marketplace：

```
agy plugin install https://github.com/grpcer/ownmem
```

這會匯入 `ownmem`、`ownmem-init` 與 `ownmem-dashboard` skill；重新執行相同命令
即可更新。（採用 API 金鑰、Vertex AI 或企業授權的傳統 Gemini CLI 設定，仍可用
`gemini extensions install https://github.com/grpcer/ownmem` 安裝同一個儲存庫。）

## 安全的自動更新

OwnMem 的設計重點是可審閱的相依套件更新，而不是在背景無聲重寫。請為 npm 相依
套件啟用 Dependabot 或 Renovate。當它建立 OwnMem 升級 PR 時，CI 應依序執行
以下三個命令：

```bash
npx ownmem init --update
npx ownmem init --check
npx ownmem audit
```

`init --update` 只會更新由 OwnMem 管理的標記範圍，並保留專案記憶；產生的轉接
檔案若發生漂移，`init --check` 就會失敗。提交 `package-lock.json` 可確保每個
Agent 與 CI 工作都使用已審閱的版本。

若要手動更新，請依序執行全部四個命令：

```bash
npm install --save-dev ownmem@latest
npx ownmem init --update
npx ownmem init --check
npx ownmem audit
```

請避免在正式環境的儲存庫中使用版本浮動的 `npx ownmem@latest`。它適合初次試用，
但會讓執行結果無法重現。

## 功能層級

你可以選擇需要多少機制；每個層級都包含前一個層級：

| 層級 | 新增功能 |
| --- | --- |
| `core` | 初始化、嚴格 schema、可辨識 Unicode 文字系統的 BM25F 召回、確定性多查詢融合、成長配額 |
| `gates` | 純 Node 稽核與近似重複檢查 |
| `compiler` | 不可變快照、stdio 常駐執行階段、選用的 Claude Code hook |
| `dashboard` | OwnMem 控制台與選用的 embedding 評估管道 |

所有層級只使用純 JavaScript 的 `ajv` 與 `yaml` 兩個執行階段相依套件。OwnMem
控制台內建完整的英語、簡體中文、繁體中文、日語、韓語、西班牙語、法語、德語、
巴西葡萄牙語、阿拉伯語、印地語、印尼語、俄語、泰語、土耳其語與越南語語系。

## AI Agent 記憶系統常見問題

### 什麼是 AI Agent 記憶系統？

AI Agent 記憶系統會儲存 Agent 可在不同工作或工作階段中重複使用的知識。
OwnMem 專注於程式碼儲存庫：它保存經過審閱的工程經驗，而不是聊天記錄或使用者
個人資料。

### 如何讓 Claude Code 或 Codex 擁有持久專案記憶？

在每個儲存庫中完成一次[快速開始](#quick-start)，再重新開啟 Agent。Claude Code、
Codex、Antigravity、Cursor、Gemini CLI 與 Grok CLI 可以讀取相同的 `.ownmem/`
檔案，不必各自維護彼此隔離的記憶。

### 記憶儲存在哪裡？團隊成員如何共用？

記憶是 `.ownmem/` 下的純 Markdown。將適合共用的記憶提交至 Git 後，它們便會
透過儲存庫原有的複製、PR、存取控制與版本回復流程流動；請勿記錄不應放進儲存庫
的機密資料。

### OwnMem 是否需要 LLM、embedding API、向量資料庫或網路？

預設召回完全不需要這些服務：它是在本機執行的詞彙式檢索，僅使用兩個小型的純
JavaScript 執行階段相依套件。安裝套件時可能需要網路，而選用的 embedding 管道
在本機 A/B 證據通過安全門檻前會保持停用。

### OwnMem 和 Mem0、Graphiti、claude-mem 或工具內建記憶有何不同？

OwnMem 以單一儲存庫為範圍，內容經過整理，召回具確定性，而且能在 Git 中審閱。
如果你需要自動擷取、大型資料庫的語意搜尋、使用者層級記憶、知識圖譜或雲端同步，
其他方案會更合適；詳情請參閱[方案比較與有來源依據的限制](#how-ownmem-compares)。

## 參與貢獻

歡迎提出 issue 與 pull request。基本規範請參閱
[CONTRIBUTING.md](../../.github/CONTRIBUTING.md)：讓預設召回保持確定性、在本機執行且不使用
模型；每項檢索變更都要加入回歸測試案例；送出審閱要求前，請執行 `npm test` 與
`npm run benchmark:release`。安全性問題請透過 [SECURITY.md](../../.github/SECURITY.md) 回報。

## 安全性與證據

- 記憶檔案始終是儲存庫內可檢查的 Markdown。
- Schema、配額、產生內容邊界與近似重複檢查都在本機執行。
- `recall.consumed` 是衡量採用情形的核心指標；Recall@K 是流程指標。
- 預設安裝永遠不會下載或呼叫模型。
- 選用的 embedding 管道在本機 A/B 證據通過安全門檻之前，不會參與排序。

OwnMem 採用 Apache-2.0 授權。分享成品或發布版本前，請先閱讀 `docs/PRIVACY.md`、
`.github/SECURITY.md` 與 `docs/RELEASE.md`。

## 致謝

- [LINUX DO](https://linux.do/)
