<div align="center">

# OwnMem

**為 AI 程式 Agent 打造的 Git 原生記憶**

把 AI 程式 Agent 的專案記憶留在儲存庫：本機、確定、可審閱，而且沒有你提交就不會被寫入。

[![npm version](https://img.shields.io/npm/v/ownmem?style=flat-square&logo=npm&color=cb3837)](https://www.npmjs.com/package/ownmem)
[![npm downloads](https://img.shields.io/npm/dm/ownmem?style=flat-square&logo=npm&color=555)](https://www.npmjs.com/package/ownmem)
[![GitHub stars](https://img.shields.io/github/stars/grpcer/ownmem?style=flat-square&logo=github&color=e3b341)](https://github.com/grpcer/ownmem/stargazers)
[![release gates](https://img.shields.io/github/actions/workflow/status/grpcer/ownmem/ci.yml?branch=main&style=flat-square&label=release%20gates)](https://github.com/grpcer/ownmem/actions/workflows/ci.yml)
[![node >= 20.6](https://img.shields.io/badge/node-%E2%89%A5%2020.6-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![license Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-1d7afc?style=flat-square)](../../LICENSE)

[English](../../README.md) · [简体中文](./README.zh-CN.md) · **繁體中文** · [日本語](./README.ja.md) · [한국어](./README.ko.md) · [Español](./README.es.md) · [Français](./README.fr.md) · [Deutsch](./README.de.md) · [Português (BR)](./README.pt-BR.md)

</div>

## <a name="why-ownmem"></a>✨ 為什麼是 OwnMem

多數記憶方案先解決「記得更多」。OwnMem 先問另一件事：**專案知識由誰擁有，誰有權改變它，錯誤記憶如何在影響 Agent 行動前被攔下？**

| 優勢 | 對實際開發的意義 |
| --- | --- |
| **記憶歸儲存庫所有** | 記憶是 `.ownmem/` 中可讀的 Markdown，隨 Git 複製、審閱與回復；儲存庫裡的每個 Agent 讀的都是同一份。 |
| **預設召回確定且本機** | 不呼叫模型、不請求網路；相同查詢、設定與快照得到相同排序。 |
| **先驗證證據，再授予 authority** | 正文不能自證可信；獨立收據與即時證據核驗決定是否交付。 |
| **不知道就說不知道** | 交付分檔：引用記憶正文、給最多三條指標、或說明是哪道門拒的之後棄權。 |
| **淨零成長** | 條目數上限只降不升；往一個滿了的語料裡加一條，就得在同一次變更裡退役一條。 |

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/benchmark-dark.svg">
  <img alt="OwnMem 公開基準：40 種語言、128 條查詢的 Recall@1 為 100%，同一語料上 grep -F 為 3.9%；4200 個樣本的召回延遲 P50 0.46 ms、P95 1.05 ms，低於 5 ms 的發布門檻；MRR 1.000，對 40 條無關查詢全部棄權，不呼叫模型、不請求網路，兩個執行階段相依套件。" src="../assets/benchmark-light.svg" width="100%">
</picture>

<sub>在本儲存庫鎖定的 CC0 語料上實測。複製本儲存庫後執行 `npm run benchmark` 即可重現。</sub>

## <a name="how-it-compares"></a><a name="how-this-differs-from-claudemd-and-built-in-memory"></a>🆚 與同類方案比較

OwnMem 不取代 `CLAUDE.md` 或 `AGENTS.md`。那兩個檔案說的是「在這裡該怎麼做事」，每一輪都整份讀進去。OwnMem 回答的是另一個問題——這個專案踩過的坑裡，哪幾條值得**為目前這個任務**放到模型眼前——而且它有權回答「一條都不值得」。

|  | 專案指令檔 | 平台內建 memory | OwnMem |
| --- | --- | --- | --- |
| 誰來寫 | 你，手寫 | Agent，從你和它的對話裡擷取 | 你寫，像程式碼一樣被審閱 |
| 存在哪 | 儲存庫裡的一個檔案 | 廠商的帳號裡 | 你儲存庫裡的 Markdown |
| 每輪進模型的是什麼 | 整份，每一輪 | 它自己的召回挑中的那些 | 三檔之一，且受 token 預算約束 |
| 某條寫錯了會怎樣 | 你去改那個檔案 | 你可能永遠看不到那一條 | 證據漂移把它降級，並說明變的是什麼 |
| 每輪成本 | 整份檔案的 token | 一次檢索呼叫 | 零模型呼叫、零網路請求 |

## <a name="quick-start"></a>🚀 快速開始

需要 Node.js 20.6 或更新版本。在希望擁有專案記憶的儲存庫中執行：

```bash
npm install --save-dev ownmem
npx ownmem init --hook --hosts claude,codex
```

裝好後重新開啟 Agent。用 `--hosts` 列出你在用的宿主（`claude`、`codex`、`cursor`、`gemini`、`grok`）；這份清單會被記錄下來，之後增減宿主就是帶著新清單再執行一次。`init` 會建立 `.ownmem/` 與各宿主的配接檔，對 `CLAUDE.md` 這類指令檔只修改受管理的區塊，並把各宿主仍需完成的一次性步驟直接印出來。在同一條指令後加上 `--check` 可以先預覽；加上 `--locale auto`，產生的指令檔會使用系統語言。

| 宿主 | 怎麼召回 | 設定方式 |
| --- | --- | --- |
| Claude Code | 每次 Edit、Write 前由 hook 召回，也可以隨時要求 | `claude` |
| Codex | 每次套用修補檔前由 hook 召回，也可以隨時要求 | `codex`；hook 需要三步一次性信任設定，`init` 會逐條提示 |
| Grok CLI | 透過相容層讀取 Claude Code 的 hook 設定 | `grok`，若同時使用 Claude Code，一併寫上 `claude`；在 grok 裡執行一次 `/hooks-trust` 信任這個資料夾 |
| Cursor | 一律套用的規則檔，或 MCP server | `cursor`；MCP server 需要手動設定一步，見[外掛與宿主](../PLUGINS.md) |
| Gemini CLI | 指令檔，或 MCP server | `gemini`；MCP server 需要手動設定一步，見[外掛與宿主](../PLUGINS.md) |

> **⚠️ 從 0.6.0 升級？** 先用 `npm install --save-dev ownmem@latest` 升級套件，再執行一次 `npx ownmem init --update`，其他都往後放。0.6.0 裝的 hook 指向的子指令已經不存在，留著它們，Agent 每跑一條 Bash 都會觸發一個失敗的指令。更新會把它們移除，你自己寫的 hook 不會被更動。其餘事項（包括清理 `core.hooksPath`）見[升級指南](../UPDATING.md)。

## <a name="daily-use"></a>💬 日常使用

接下來照常用自然語言工作。你要 Agent 記下什麼，它就起草一條記憶，你像審程式碼一樣審它：

> 「記住：staging 部署逾時來自連線池上限，不是 worker 太少。下次兩者一起檢查。」

> 「修改前先看看專案記憶是否遇過同一種故障。」

召回會以三檔之一作答：引用記憶正文、給最多三條指標讓你去讀，或是棄權。一次真實執行：

```console
$ npx ownmem recall -- "staging deploy timed out again, should I add more workers?"
== staging deploy timed out again, should I add more workers? ==
  staging_timeout_pool_cap  [score=0.875 lanes=exact,bm25f,ngram fields=body,codePath,description,hooks,name,triggers]
      matched deploy,more,out,staging,staging deploy timed out,timed
      trust advisory authority · lifecycle advisory (not fully verified)
        Treat it as a lead to re-check against the code, not as an established fact.
      excerpt(body) **Why**: `DB_POOL_MAX` is 10 on staging. Adding workers only queues more requests behind the same ten connections, so the deploy health check times out sooner, not later.
      file .ownmem/staging_timeout_pool_cap.md
```

信任程度會明確標示，而非隱含。這條記憶目前沒有任何背書——沒有人複核確認過，也沒有引用權威文件或程式碼錨點——所以它以「需要回頭核對的線索」交付，而不是既定事實。

你自己會用到的幾條指令：

```bash
npx ownmem new staging_timeout_pool_cap   # scaffold one memory that already passes every gate
npx ownmem report --since 7d              # used? fast enough? right? what to do next
npx ownmem dashboard --open               # open the local console
npx ownmem mcp                            # serve recall and read to any MCP host over stdio
```

<img alt="OwnMem 本機主控台：以已知誤交付殘留率為主指標，旁邊是查找漏斗，下方是語料與證據健康度，側欄可切換效能、品質、治理與語意檢索。" src="../assets/console.png" width="100%">

`ownmem mcp` 是為沒有 hook 的宿主準備的。它只開放 `recall` 與 `read` 兩個工具，兩者都不能更動記憶；門禁指令（`audit`、`trust`、`compile`）與所有記憶寫入都不在這個介面上。怎麼註冊才能確保執行的是專案自己安裝的那一份，見[外掛與宿主](../PLUGINS.md)。

## <a name="how-it-works"></a><a name="architecture"></a><a name="how-ownmem-governs-ai-agent-memory"></a>🧩 運作原理

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/architecture-zh-TW-dark.svg">
  <img alt="OwnMem 總架構：儲存庫擁有的 Markdown 與獨立信任收據編譯成不可變快照；本機確定性召回經過四道交付門，並按三檔之一交付——引用記憶正文、給最多三條指標、或說明原因後棄權；本機回饋帳本、評測台與淨零成長配額約束語料的走向。" src="../assets/architecture-zh-TW-light.svg" width="100%">
</picture>

- **儲存庫是唯一事實來源。** L1 路由、L2 領域索引與 L3 topic 是可審閱 Markdown；信任收據獨立於它授權的正文。
- **編譯後再召回。** 經 schema、圖關係、生命週期與證據校驗後，產生內容定址的不可變快照。exact、BM25F、n-gram、fuzzy、graph 五路檢索通道在本機融合；embedding 是可選的第六路，本機 A/B 證據通過之前權重為 0。
- **四道門，三檔交付。** 相關性、認知有效性、任務適用性與動作風險各自按自己的理由拒絕。分數高於門檻（取自消融曲線）就引用記憶正文；低於門檻給最多三條**明確不是答案**的指標；一條合格的都沒有則棄權，並報出是哪道門拒的。
- **沒有無人值守寫入。** 沒有協調器、沒有晉升、沒有候選佇列。這個套件只負責量測、提議與拒絕；記憶的每一次變更都是某個人的一次提交，任何排序變更都要先過評測台。

機制、威脅模型與研究對應見[技術設計](../TECHNICAL.md)。

## <a name="privacy-and-boundaries"></a><a name="trust-and-automation-boundary"></a><a name="local-first-by-default"></a><a name="telemetry-and-the-daily-pass"></a>🔒 隱私與邊界

- **預設本機。** 排序只讀儲存庫檔案與本機快照：零 LLM 呼叫、零網路請求、沒有檢索 API 帳單。交付給 Agent 的摘錄仍會占用上下文視窗，並受設定的預算限制。
- **遙測不離開本機。** 執行事件存放在被 Git 忽略的目錄中，30 天後過期。每日封存（`ownmem daily`）把每個已結束的日子彙整成計數包，不含查詢原文、topic 正文與檔案路徑。沒有樣本就顯示「暫無」，不偽裝成 0%。
- **召回的文字只是資料。** 它不能覆寫宿主指令，也不能授權工具；Agent 的自歸因永遠不算使用者確認。
- **失敗看得見。** 正文未簽署或證據目標無法核驗的條目會被扣住；證據漂移會把條目降為 advisory，並說明變的是什麼。
- **祕密不進記憶。** 不該進入 Git 的金鑰、個人資料與正式環境資料，也不該進入記憶。

## <a name="when-to-use-it"></a><a name="where-it-fits"></a>🧭 適用情境

| 適合 OwnMem | 這些情況更適合其他系統 |
| --- | --- |
| 團隊希望專案知識與程式碼一起審閱、遷移。 | 需要跨儲存庫個人輪廓或全域使用者記憶。 |
| 同一儲存庫輪流使用多個程式 Agent。 | 希望無差別自動保存所有對話，不接受證據門與風險邊界。 |
| 重視本機、可重現且沒有檢索 API 帳單的召回。 | 需要大規模雲端向量搜尋或即時全域知識圖譜。 |
| 錯誤記憶必須可歸因、可拒絕、可撤銷。 | 記憶數量比治理更重要。 |

## <a name="documentation"></a><a name="research-lineage"></a>📚 文件

| 文件 | 內容 |
| --- | --- |
| [Architecture](../ARCHITECTURE.md) | 套件邊界、快照、信任與交付 |
| [Technical design](../TECHNICAL.md) | 機制、威脅模型與研究對應 |
| [Plugins](../PLUGINS.md) | 各宿主接入、外掛與授信步驟 |
| [Updating](../UPDATING.md) | 安全更新與版本遷移 |
| [Privacy](../PRIVACY.md) | 本機資料與可選通道邊界 |
| [Changelog](../../CHANGELOG.md) | 版本變更 |
| [Contributing](../../.github/CONTRIBUTING.md) | 回報 issue 與貢獻程式碼 |
| [Security](../../.github/SECURITY.md) | 回報安全漏洞 |
| [License](../../LICENSE) | Apache-2.0 |

<details>
<summary><b>研究脈絡</b></summary>

OwnMem 不把這些基礎概念冒充原創；它的貢獻是把它們組成儲存庫記憶的可執行協定：

- **Agent Memory 與反思學習：** [Reflexion (NeurIPS 2023)](https://papers.neurips.cc/paper_files/paper/2023/hash/1b44b878bb782e6954cd888628510e90-Abstract-Conference.html)、[MemGPT (2023)](https://arxiv.org/abs/2310.08560)
- **記憶與知識庫投毒：** [AgentPoison (NeurIPS 2024)](https://proceedings.neurips.cc/paper_files/paper/2024/hash/eb113910e9c3f6242541c1652e30dfd6-Abstract-Conference.html)、[PoisonedRAG (USENIX Security 2025)](https://www.usenix.org/conference/usenixsecurity25/presentation/zou-poisonedrag)
- **不可信資料與授權分離：** [CaMeL: Defeating Prompt Injections by Design (2025)](https://arxiv.org/abs/2503.18813)
- **獨立來源證明：** [in-toto (USENIX Security 2019)](https://www.usenix.org/conference/usenixsecurity19/presentation/torres-arias)
- **選擇性預測與棄答：** [Selective Classification (JMLR 2010)](https://jmlr.org/papers/v11/el-yaniv10a.html)
- **消融式驗證：** [Metamorphic Testing (1998)](https://www.cse.ust.hk/~scc/publ/CS98-01-metamorphictesting.pdf)
- **分維度檢索評測：** [ARES (NAACL 2024)](https://aclanthology.org/2024.naacl-long.20/)、[RAGChecker (2024)](https://arxiv.org/abs/2408.08067)

這些引用只說明研究脈絡，不表示相關論文實作了 OwnMem，也不表示 OwnMem 重現了論文實驗。

</details>

OwnMem 是開源專案，歡迎提交附可重現證據的 issue 與 pull request。
