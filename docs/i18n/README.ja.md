<div align="center">

# OwnMem

**AI コーディングエージェントのための Git ネイティブな記憶**

AI コーディングエージェントのプロジェクト記憶をリポジトリに置く。ローカル、決定的、レビュー可能で、あなたの commit なしに書き換わることはない。

[![npm version](https://img.shields.io/npm/v/ownmem?style=flat-square&logo=npm&color=cb3837)](https://www.npmjs.com/package/ownmem)
[![npm downloads](https://img.shields.io/npm/dm/ownmem?style=flat-square&logo=npm&color=555)](https://www.npmjs.com/package/ownmem)
[![GitHub stars](https://img.shields.io/github/stars/grpcer/ownmem?style=flat-square&logo=github&color=e3b341)](https://github.com/grpcer/ownmem/stargazers)
[![release gates](https://img.shields.io/github/actions/workflow/status/grpcer/ownmem/ci.yml?branch=main&style=flat-square&label=release%20gates)](https://github.com/grpcer/ownmem/actions/workflows/ci.yml)
[![node >= 20.6](https://img.shields.io/badge/node-%E2%89%A5%2020.6-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![license Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-1d7afc?style=flat-square)](../../LICENSE)

[English](../../README.md) · [简体中文](./README.zh-CN.md) · [繁體中文](./README.zh-TW.md) · **日本語** · [한국어](./README.ko.md) · [Español](./README.es.md) · [Français](./README.fr.md) · [Deutsch](./README.de.md) · [Português (BR)](./README.pt-BR.md)

</div>

## <a name="why-ownmem"></a>✨ なぜ OwnMem なのか

多くの記憶システムは「より多く覚える」ことを最適化します。OwnMem は先に、**プロジェクト知識を誰が所有し、誰が変更でき、誤った記憶を行動の前にどう止めるか**を問います。

| 強み | 実開発での意味 |
| --- | --- |
| **記憶はリポジトリ所有** | `.ownmem/` の可読 Markdown がコードと一緒に clone、review、rollback され、リポジトリ内のどの Agent も同じ情報源を読みます。 |
| **既定で決定的なローカル想起** | モデルもネットワークも呼ばず、同じクエリ・設定・snapshot なら同じ順位です。 |
| **authority より先に証拠** | 本文は自分を信頼済みにできません。独立 receipt と生きた証拠検証が配信を決めます。 |
| **知らないときは知らないと言う** | 配信は段階的です。記憶本文の引用、最大 3 件のポインタ、または拒んだ gate を明示した棄権。 |
| **純増ゼロの成長** | 件数上限は下がる方向にしか動きません。満杯のコーパスに一件足すなら、同じ変更で一件退役させます。 |

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/benchmark-dark.svg">
  <img alt="OwnMem の公開ベンチマーク：40 言語・128 クエリで Recall@1 は 100%、同じコーパスで grep -F は 3.9%。4,200 サンプルの想起レイテンシは P50 0.46 ms、P95 1.05 ms で、リリース基準の 5 ms を下回る。MRR 1.000、無関係なクエリ 40 件すべてで棄権、モデル・ネットワーク呼び出しはゼロ、ランタイム依存は 2 つ。" src="../assets/benchmark-light.svg" width="100%">
</picture>

<sub>このリポジトリに固定された CC0 コーパスで計測。クローンして `npm run benchmark` を実行すれば再現できます。</sub>

## <a name="how-it-compares"></a><a name="how-this-differs-from-claudemd-and-built-in-memory"></a>🆚 類似手法との比較

OwnMem は `CLAUDE.md` や `AGENTS.md` の代わりではありません。この 2 つは「ここではどう進めるか」を書いたもので、毎 turn 全文が読まれます。OwnMem が答えるのは別の問いです。このプロジェクトが痛い目を見て学んだことのうち、**この作業のために**モデルの目の前に置く価値があるのはどれか。そして「どれでもない」と答える権利があります。

|  | プロジェクト指示ファイル | 組み込みの agent memory | OwnMem |
| --- | --- | --- | --- |
| 誰が書くか | あなたが手で書く | agent が会話から | あなたが書き、コードと同じくレビューされる |
| どこにあるか | リポジトリ内の 1 ファイル | ベンダーのアカウント | あなたのリポジトリ内の Markdown |
| 毎 turn 何がモデルに届くか | 全文が毎回 | その recall が選んだもの | 3 tier のいずれか、token 予算の範囲で |
| 内容が間違っていたら | ファイルを直す | その項目を目にしないかもしれない | evidence drift が格下げし、何が動いたかを示す |
| 1 turn あたりのコスト | ファイル全体の token | retrieval 1 回 | モデル呼び出し 0、ネットワーク 0 |

## <a name="quick-start"></a>🚀 クイックスタート

Node.js 20.6 以上が必要です。記憶を所有させるリポジトリで実行します。

```bash
npm install --save-dev ownmem
npx ownmem init --hook --hosts claude,codex
```

インストール後は Agent を再起動してください。使っている host を `--hosts` に列挙します（`claude`、`codex`、`cursor`、`gemini`、`grok`）。この一覧は記録され、あとから host を増減するときは新しい一覧でもう一度実行します。`init` は `.ownmem/` と各 host のアダプタを作り、`CLAUDE.md` のような指示ファイルは管理ブロックの中だけを編集し、host ごとに残っている一度きりの手順があれば表示します。同じコマンドに `--check` を付ければ事前に確認でき、`--locale auto` を付ければ生成される指示文がシステムの言語になります。

| Host | 想起のしかた | セットアップ |
| --- | --- | --- |
| Claude Code | Edit と Write の前に毎回 hook で想起。依頼時にも想起 | `claude` |
| Codex | パッチを適用する前に毎回 hook で想起。依頼時にも想起 | `codex`。hook には一度きりの信頼手順が 3 つ必要（`init` が表示） |
| Grok CLI | 互換レイヤー経由で Claude Code の hook 設定を読む | `grok`（Claude Code も使うなら `claude` も併記）。grok 内で `/hooks-trust` を一度実行してフォルダを信頼 |
| Cursor | 常に適用されるルール、または MCP サーバー | `cursor`。MCP サーバーは手動の手順が 1 つ必要（[Plugins](../PLUGINS.md) 参照） |
| Gemini CLI | 指示ファイル、または MCP サーバー | `gemini`。MCP サーバーは手動の手順が 1 つ必要（[Plugins](../PLUGINS.md) 参照） |

> **⚠️ 0.6.0 から更新する場合** まず `npm install --save-dev ownmem@latest` でパッケージを更新し、ほかの作業より先に `npx ownmem init --update` を一度実行してください。0.6.0 が入れた hook の参照先サブコマンドはもう存在しないため、残したままだと Bash を実行するたびに失敗するコマンドが走ります。更新はそれらを取り除き、自分で書いた hook には触れません。`core.hooksPath` の後始末を含む残りの手順は [Updating](../UPDATING.md) を参照してください。

## <a name="daily-use"></a>💬 日常の使い方

あとは普段どおりの言葉で作業します。頼めば Agent が記憶を下書きし、あなたはそれをコードと同じようにレビューします。

> 「覚えておいて。staging deploy の timeout は worker 不足ではなく pool cap が原因。次回は両方確認する。」

> 「変更前に、同じ障害をプロジェクト記憶で経験していないか確認して。」

想起は 3 つの tier のいずれかで答えます。記憶本文の引用、読みに行くべきポインタ最大 3 件、または棄権です。実際の実行例：

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

信頼度は暗黙ではなく明示されます。この項目にはまだ裏付けがありません。レビューで確認されておらず、authority 文書もコードアンカーも引用していないため、確定した事実ではなく、確かめ直すべき手がかりとして届きます。

自分で使うことになるコマンド：

```bash
npx ownmem new staging_timeout_pool_cap   # scaffold one memory that already passes every gate
npx ownmem report --since 7d              # used? fast enough? right? what to do next
npx ownmem dashboard --open               # open the local console
npx ownmem mcp                            # serve recall and read to any MCP host over stdio
```

<img alt="OwnMem のローカルコンソール。既知の誤配信残存率を主指標に、その横に検索ファネル、下にコーパスと証拠の健全性を表示し、サイドバーからパフォーマンス・品質・ガバナンス・セマンティック検索に切り替えられる。" src="../assets/console.png" width="100%">

`ownmem mcp` は hook を持たない host のためのものです。公開するのは `recall` と `read` の 2 つだけで、どちらも記憶を変更できません。gate 系コマンド（`audit`、`trust`、`compile`）や記憶への書き込みはこの経路からは使えません。プロジェクト自身にインストールされたものを確実に動かす登録方法は [Plugins](../PLUGINS.md) を参照してください。

## <a name="how-it-works"></a><a name="architecture"></a><a name="how-ownmem-governs-ai-agent-memory"></a>🧩 仕組み

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/architecture-ja-dark.svg">
  <img alt="OwnMem の全体構成。リポジトリ所有の Markdown と独立した信頼 receipt を不変 snapshot にコンパイルし、決定的ローカル想起を 4 つの配信 gate に通し、3 つの tier のいずれかで届ける。記憶本文の引用、最大 3 件のポインタ、理由を明示した棄権である。ローカルの feedback 台帳、評価ハーネス、純増ゼロの quota がコーパスの行き先を縛る。" src="../assets/architecture-ja-light.svg" width="100%">
</picture>

- **リポジトリが唯一の情報源。** L1 routing、L2 area index、L3 topic は review 可能な Markdown。trust receipt は本文と分離されます。
- **compile してから recall。** Schema、graph、lifecycle、evidence gate が content-addressed な不変 snapshot を作ります。exact、BM25F、n-gram、fuzzy、graph の 5 本の決定的 lane をローカルで融合し、embedding は任意の第 6 lane として、ローカルの A/B 証拠が通るまで重み 0 です。
- **4 つの gate、3 つの tier。** relevance、epistemic validity、task applicability、action risk はそれぞれ独自の理由で拒みます。ablation 曲線から読み取った閾値以上なら記憶本文を引用し、それ未満なら**答えではないと明記した**ポインタを最大 3 件示し、合格候補がなければ拒んだ gate を名指しして棄権します。
- **無人の書き込みはしない。** coordinator も昇格も候補キューもありません。このパッケージは計測し、提案し、拒むだけで、記憶の変更はすべて誰かの commit です。ranking の変更は評価ハーネスを通らない限り入りません。

仕組み、脅威モデル、研究との対応は [Technical design](../TECHNICAL.md) にあります。

## <a name="privacy-and-boundaries"></a><a name="trust-and-automation-boundary"></a><a name="local-first-by-default"></a><a name="telemetry-and-the-daily-pass"></a>🔒 プライバシーと境界

- **既定でローカル。** ranking はリポジトリのファイルとローカル snapshot だけを読み、LLM 呼び出しもネットワークリクエストも retrieval API 課金もありません。それでも Agent に渡す抜粋はコンテキストウィンドウを使い、設定された予算で制限されます。
- **テレメトリはマシンから出ない。** 実行時イベントは Git-ignore されたディレクトリに置かれ、30 日で失効します。日次処理（`ownmem daily`）は終わった日を集計パッケージにまとめ、クエリ本文、topic 本文、ファイルパスは含めません。サンプルがなければ 0% ではなく「データなし」と表示します。
- **想起された本文はデータ。** host の指示を上書きすることも tool を許可することもできず、Agent の self-attribution がユーザー確認として数えられることもありません。
- **失敗は見える形で。** 本文が未署名の項目や、evidence を検証できない項目は配信しません。evidence drift は項目を advisory に下げ、何が動いたかを示します。
- **秘密は入れない。** Git に置くべきでない secret、個人情報、本番データは記憶にも置きません。

## <a name="when-to-use-it"></a><a name="where-it-fits"></a>🧭 向いている場面

| OwnMem が合う | 別のシステムが合う |
| --- | --- |
| プロジェクト知識をコードと一緒に review・移行したい。 | リポジトリ横断の個人 profile や global user memory が必要。 |
| 同じリポジトリで複数の coding Agent を使う。 | 証拠や risk boundary なしで全会話を自動保存したい。 |
| ローカルで再現可能、retrieval API 課金なしの recall が重要。 | 大規模 cloud vector search や realtime global knowledge graph が必要。 |
| 誤った記憶を追跡、拒否、撤回できる必要がある。 | governance より記憶量を優先する。 |

## <a name="documentation"></a><a name="research-lineage"></a>📚 ドキュメント

| 文書 | 内容 |
| --- | --- |
| [Architecture](../ARCHITECTURE.md) | パッケージ境界、snapshot、trust、配信 |
| [Technical design](../TECHNICAL.md) | 仕組み、脅威モデル、研究との対応 |
| [Plugins](../PLUGINS.md) | host ごとのセットアップ、plugin、信頼手順 |
| [Updating](../UPDATING.md) | 安全な更新とバージョン移行 |
| [Privacy](../PRIVACY.md) | ローカルデータと任意チャネルの境界 |
| [Changelog](../../CHANGELOG.md) | バージョン履歴 |
| [Contributing](../../.github/CONTRIBUTING.md) | issue の報告と変更の送り方 |
| [Security](../../.github/SECURITY.md) | 脆弱性の報告 |
| [License](../../LICENSE) | Apache-2.0 |

<details>
<summary><b>研究上の系譜</b></summary>

OwnMem は基礎技術の発明を主張しません。貢献は、それらをリポジトリ記憶の実行可能 protocol に組み合わせることです。

- **Agent memory と reflection:** [Reflexion (NeurIPS 2023)](https://papers.neurips.cc/paper_files/paper/2023/hash/1b44b878bb782e6954cd888628510e90-Abstract-Conference.html), [MemGPT (2023)](https://arxiv.org/abs/2310.08560)
- **Memory / knowledge-base poisoning:** [AgentPoison (NeurIPS 2024)](https://proceedings.neurips.cc/paper_files/paper/2024/hash/eb113910e9c3f6242541c1652e30dfd6-Abstract-Conference.html), [PoisonedRAG (USENIX Security 2025)](https://www.usenix.org/conference/usenixsecurity25/presentation/zou-poisonedrag)
- **Untrusted data と authority の分離:** [CaMeL: Defeating Prompt Injections by Design (2025)](https://arxiv.org/abs/2503.18813)
- **独立 provenance:** [in-toto (USENIX Security 2019)](https://www.usenix.org/conference/usenixsecurity19/presentation/torres-arias)
- **Selective prediction と abstention:** [Selective Classification (JMLR 2010)](https://jmlr.org/papers/v11/el-yaniv10a.html)
- **Ablation による検証:** [Metamorphic Testing (1998)](https://www.cse.ust.hk/~scc/publ/CS98-01-metamorphictesting.pdf)
- **分解された retrieval evaluation:** [ARES (NAACL 2024)](https://aclanthology.org/2024.naacl-long.20/), [RAGChecker (2024)](https://arxiv.org/abs/2408.08067)

引用は研究上の系譜を示すもので、各論文が OwnMem を実装した、または OwnMem が実験を再現したという意味ではありません。

</details>

OwnMem はオープンソースです。再現可能な issue と pull request を歓迎します。
