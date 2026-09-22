<div align="center">

# OwnMem

**AI 코딩 에이전트를 위한 Git 네이티브 메모리**

AI 코딩 에이전트의 프로젝트 메모리를 저장소에 둡니다. 로컬·결정적·검토 가능하고, 당신의 commit 없이는 아무것도 쓰이지 않습니다.

[![npm version](https://img.shields.io/npm/v/ownmem?style=flat-square&logo=npm&color=cb3837)](https://www.npmjs.com/package/ownmem)
[![npm downloads](https://img.shields.io/npm/dm/ownmem?style=flat-square&logo=npm&color=555)](https://www.npmjs.com/package/ownmem)
[![GitHub stars](https://img.shields.io/github/stars/grpcer/ownmem?style=flat-square&logo=github&color=e3b341)](https://github.com/grpcer/ownmem/stargazers)
[![release gates](https://img.shields.io/github/actions/workflow/status/grpcer/ownmem/ci.yml?branch=main&style=flat-square&label=release%20gates)](https://github.com/grpcer/ownmem/actions/workflows/ci.yml)
[![node >= 20.6](https://img.shields.io/badge/node-%E2%89%A5%2020.6-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![license Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-1d7afc?style=flat-square)](../../LICENSE)

[English](../../README.md) · [简体中文](./README.zh-CN.md) · [繁體中文](./README.zh-TW.md) · [日本語](./README.ja.md) · **한국어** · [Español](./README.es.md) · [Français](./README.fr.md) · [Deutsch](./README.de.md) · [Português (BR)](./README.pt-BR.md)

</div>

## <a name="why-ownmem"></a>✨ 왜 OwnMem인가

대부분의 메모리 시스템은 “더 많이 기억하기”를 최적화합니다. OwnMem은 먼저 **프로젝트 지식을 누가 소유하고, 누가 바꿀 수 있으며, 잘못된 메모리를 행동 전에 어떻게 막을지** 묻습니다.

| 장점 | 실제 개발에서의 의미 |
| --- | --- |
| **메모리는 저장소 소유** | `.ownmem/`의 읽을 수 있는 Markdown이 코드와 함께 clone, review, rollback 되며, 저장소의 모든 Agent가 같은 원본을 읽습니다. |
| **기본 회상은 결정적·로컬** | 모델이나 네트워크를 호출하지 않고 같은 query·config·snapshot에 같은 순위를 냅니다. |
| **authority보다 증거가 먼저** | 본문은 스스로 신뢰를 부여하지 못하며 독립 receipt와 실시간 evidence 검증이 전달을 결정합니다. |
| **모를 때는 모른다고 말합니다** | 전달은 등급별입니다. 기억 본문 인용, 최대 3개의 포인터, 또는 어느 gate가 거절했는지 밝힌 기권. |
| **순증가 0 성장** | 항목 수 상한은 낮아지기만 합니다. 가득 찬 코퍼스에 하나를 더하려면 같은 변경에서 하나를 퇴역시켜야 합니다. |

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/benchmark-dark.svg">
  <img alt="OwnMem 공개 벤치마크: 40개 언어, 128개 질의에서 Recall@1 100%, 같은 코퍼스에서 grep -F는 3.9%. 4,200개 샘플의 회상 지연은 P50 0.46 ms, P95 1.05 ms로 릴리스 기준 5 ms 이내. MRR 1.000, 무관한 질의 40개 모두에서 기권, 모델·네트워크 호출 0회, 런타임 의존성 2개." src="../assets/benchmark-light.svg" width="100%">
</picture>

<sub>이 저장소에 고정된 CC0 코퍼스에서 측정했습니다. 저장소를 클론한 뒤 `npm run benchmark`로 재현할 수 있습니다.</sub>

## <a name="how-it-compares"></a><a name="how-this-differs-from-claudemd-and-built-in-memory"></a>🆚 다른 방식과의 비교

OwnMem은 `CLAUDE.md`나 `AGENTS.md`를 대체하지 않습니다. 그 파일들은 “여기서는 이렇게 일한다”를 적은 것이고 매 turn 전문이 읽힙니다. OwnMem이 답하는 질문은 다릅니다. 이 프로젝트가 어렵게 배운 것들 가운데 **이번 작업을 위해** 모델 앞에 둘 만한 것이 무엇인가. 그리고 “하나도 없다”고 답할 권리가 있습니다.

|  | 프로젝트 지시 파일 | 내장 agent memory | OwnMem |
| --- | --- | --- | --- |
| 누가 쓰나 | 당신이 손으로 | agent가 대화에서 뽑아서 | 당신이 쓰고 코드처럼 검토받는다 |
| 어디에 있나 | 저장소 안의 파일 하나 | 벤더의 계정 | 당신 저장소 안의 Markdown |
| 매 turn 무엇이 모델에 닿나 | 전문이 매번 | 그 recall이 고른 것 | 세 tier 중 하나, token 예산 안에서 |
| 항목이 틀렸을 때 | 파일을 고친다 | 그 항목을 영영 못 볼 수도 있다 | evidence drift가 등급을 낮추고 무엇이 바뀌었는지 밝힌다 |
| turn당 비용 | 파일 전체의 token | retrieval 호출 한 번 | 모델 호출 0, 네트워크 0 |

## <a name="quick-start"></a>🚀 빠른 시작

Node.js 20.6 이상이 필요합니다. 메모리를 소유할 저장소에서 실행하세요.

```bash
npm install --save-dev ownmem
npx ownmem init --hook --hosts claude,codex
```

설치가 끝나면 Agent를 다시 시작하세요. 사용하는 host(`claude`, `codex`, `cursor`, `gemini`, `grok`)를 `--hosts`에 나열합니다. 이 목록은 기록되며, 나중에 host를 추가하거나 빼려면 새 목록으로 다시 실행하면 됩니다. `init`은 `.ownmem/`과 각 host의 어댑터를 만들고, `CLAUDE.md` 같은 지침 파일은 관리되는 블록 안에서만 수정하며, host마다 남은 일회성 단계가 있으면 출력해 줍니다. 같은 명령에 `--check`를 붙이면 미리 볼 수 있고, `--locale auto`를 붙이면 생성되는 지침이 시스템 언어로 작성됩니다.

| Host | 회상 방식 | 설정 |
| --- | --- | --- |
| Claude Code | 매번 Edit·Write 전에 hook으로 회상, 요청 시에도 회상 | `claude` |
| Codex | 매번 패치를 적용하기 전에 hook으로 회상, 요청 시에도 회상 | `codex`. hook에는 일회성 신뢰 단계 세 가지가 필요(`init`이 안내) |
| Grok CLI | 호환 계층을 통해 Claude Code의 hook 설정을 읽음 | `grok`(Claude Code도 쓴다면 `claude`도 함께). grok에서 `/hooks-trust`를 한 번 실행해 폴더를 신뢰 |
| Cursor | 항상 적용되는 규칙 파일, 또는 MCP 서버 | `cursor`. MCP 서버는 수동 설정 한 단계가 필요([Plugins](../PLUGINS.md) 참고) |
| Gemini CLI | 지침 파일, 또는 MCP 서버 | `gemini`. MCP 서버는 수동 설정 한 단계가 필요([Plugins](../PLUGINS.md) 참고) |

> **⚠️ 0.6.0에서 업그레이드하나요?** 먼저 `npm install --save-dev ownmem@latest`로 패키지를 올린 뒤, 다른 작업보다 앞서 `npx ownmem init --update`를 한 번 실행하세요. 0.6.0이 설치한 hook은 이제 존재하지 않는 하위 명령을 가리키므로, 그대로 두면 Bash를 실행할 때마다 실패하는 명령이 돌아갑니다. 업데이트는 이를 제거하고 직접 작성한 hook은 건드리지 않습니다. `core.hooksPath` 정리를 포함한 나머지는 [Updating](../UPDATING.md)을 참고하세요.

## <a name="daily-use"></a>💬 일상 사용

이제 평소처럼 자연어로 일하면 됩니다. 기억해 달라고 하면 Agent가 메모리 초안을 쓰고, 그 초안을 코드처럼 검토합니다:

> “기억해 둬. staging 배포 timeout은 worker 부족이 아니라 pool cap 때문이야. 다음에는 둘 다 확인해.”

> “바꾸기 전에 프로젝트 메모리에 같은 장애가 있었는지 확인해.”

회상은 세 tier 중 하나로 답합니다. 기억 본문 인용, 가서 읽어 볼 포인터 최대 3개, 또는 기권입니다. 실제 실행 결과:

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

신뢰 수준은 암묵적으로 넘어가지 않고 명시됩니다. 이 항목은 아직 뒷받침이 없습니다. 리뷰로 확인되지 않았고 authority 문서나 코드 앵커도 인용하지 않으므로, 확정된 사실이 아니라 다시 확인해야 할 단서로 전달됩니다.

직접 쓰게 될 명령:

```bash
npx ownmem new staging_timeout_pool_cap   # scaffold one memory that already passes every gate
npx ownmem report --since 7d              # used? fast enough? right? what to do next
npx ownmem dashboard --open               # open the local console
npx ownmem mcp                            # serve recall and read to any MCP host over stdio
```

<img alt="OwnMem 로컬 콘솔: 알려진 오전달 잔존율을 주 지표로, 옆에는 조회 퍼널, 아래에는 코퍼스와 증거 상태를 보여 주며, 사이드바에서 성능·품질·거버넌스·의미 검색으로 이동할 수 있습니다." src="../assets/console.png" width="100%">

`ownmem mcp`는 hook이 없는 host를 위한 것입니다. 노출하는 도구는 `recall`과 `read` 두 개뿐이며 둘 다 메모리를 바꿀 수 없습니다. gate 명령(`audit`, `trust`, `compile`)과 모든 메모리 쓰기는 이 경로로는 노출되지 않습니다. 프로젝트에 설치된 사본이 실행되도록 등록하는 방법은 [Plugins](../PLUGINS.md)에 있습니다.

## <a name="how-it-works"></a><a name="architecture"></a><a name="how-ownmem-governs-ai-agent-memory"></a>🧩 작동 방식

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/architecture-ko-dark.svg">
  <img alt="OwnMem 전체 아키텍처. 저장소 소유 Markdown과 독립 trust receipt를 불변 snapshot으로 compile하고 결정적 로컬 recall을 네 전달 gate에 통과시켜 세 tier 중 하나로 전달한다. 기억 본문 인용, 최대 3개의 포인터, 이유를 밝힌 기권이다. 로컬 feedback 원장, 평가 하네스, 순증가 0 quota가 코퍼스의 방향을 묶는다." src="../assets/architecture-ko-light.svg" width="100%">
</picture>

- **저장소가 진실의 원천.** L1 routing, L2 area index, L3 topic은 검토 가능한 Markdown이며 trust receipt는 본문과 분리됩니다.
- **compile 후 recall.** Schema, graph, lifecycle, evidence gate가 content-addressed 불변 snapshot을 만듭니다. exact, BM25F, n-gram, fuzzy, graph 5개 결정적 lane을 로컬에서 융합하며, embedding은 선택적 6번째 lane으로 로컬 A/B 증거가 통과하기 전에는 가중치 0입니다.
- **4개 gate, 3개 tier.** relevance, epistemic validity, task applicability, action risk는 각자의 근거로 거절합니다. ablation 곡선에서 읽은 임계값 이상이면 메모리 본문을 인용하고, 그 아래면 **답이 아님을 명시한** 포인터를 최대 3개, 적격 후보가 없으면 거절한 gate를 밝히고 기권합니다.
- **무인 쓰기 없음.** coordinator도, 승격도, 후보 큐도 없습니다. 이 패키지는 측정하고 제안하고 거절할 뿐이며, 메모리의 모든 변경은 누군가의 commit입니다. ranking 변경은 평가 하네스를 거치지 않고는 들어가지 않습니다.

작동 원리, 위협 모델, 연구와의 대응은 [Technical design](../TECHNICAL.md)에 있습니다.

## <a name="privacy-and-boundaries"></a><a name="trust-and-automation-boundary"></a><a name="local-first-by-default"></a><a name="telemetry-and-the-daily-pass"></a>🔒 프라이버시와 경계

- **기본은 로컬입니다.** ranking은 저장소 파일과 로컬 snapshot만 읽으므로 LLM 호출도, 네트워크 요청도, retrieval API 비용도 없습니다. 그래도 Agent에 전달되는 발췌문은 컨텍스트 창을 사용하며 설정된 예산으로 제한됩니다.
- **텔레메트리는 머신을 벗어나지 않습니다.** 런타임 이벤트는 Git-ignore된 디렉터리에 저장되고 30일 뒤 만료됩니다. 일일 집계(`ownmem daily`)는 끝난 하루를 횟수만 담은 패키지로 줄이며, 질의 원문·topic 본문·파일 경로는 담지 않습니다. 샘플이 없으면 0%가 아니라 “없음”으로 표시합니다.
- **회상된 텍스트는 데이터입니다.** host 지시를 덮어쓰거나 도구를 허가할 수 없으며, Agent의 self-attribution은 결코 사용자 확인으로 간주되지 않습니다.
- **실패는 드러납니다.** 본문이 서명되지 않았거나 evidence를 검증할 수 없는 항목은 전달하지 않습니다. evidence drift는 항목을 advisory로 낮추고 무엇이 바뀌었는지 밝힙니다.
- **비밀은 넣지 않습니다.** Git에 두어서는 안 되는 secret, 개인정보, 운영 데이터는 메모리에도 두지 않습니다.

## <a name="when-to-use-it"></a><a name="where-it-fits"></a>🧭 언제 쓰면 좋은가

| OwnMem이 잘 맞음 | 다른 시스템이 더 맞음 |
| --- | --- |
| 프로젝트 지식을 코드와 함께 검토·이동하고 싶다. | 저장소를 넘는 개인 profile이나 global user memory가 필요하다. |
| 한 저장소에서 여러 coding Agent를 번갈아 쓴다. | 증거·risk boundary 없이 모든 대화를 자동 저장하고 싶다. |
| 로컬·재현 가능하고 retrieval API 비용이 없는 recall이 중요하다. | 대규모 cloud vector search나 realtime global knowledge graph가 필요하다. |
| 잘못된 메모리를 추적·거절·철회할 수 있어야 한다. | governance보다 메모리 양이 중요하다. |

## <a name="documentation"></a><a name="research-lineage"></a>📚 문서

| 문서 | 내용 |
| --- | --- |
| [Architecture](../ARCHITECTURE.md) | 패키지 경계, snapshot, trust, 전달 |
| [Technical design](../TECHNICAL.md) | 작동 원리, 위협 모델, 연구와의 대응 |
| [Plugins](../PLUGINS.md) | host별 설정, plugin, 신뢰 단계 |
| [Updating](../UPDATING.md) | 안전한 업데이트와 버전 마이그레이션 |
| [Privacy](../PRIVACY.md) | 로컬 데이터와 선택적 채널의 경계 |
| [Changelog](../../CHANGELOG.md) | 버전 기록 |
| [Contributing](../../.github/CONTRIBUTING.md) | issue 보고와 변경 제안 방법 |
| [Security](../../.github/SECURITY.md) | 보안 취약점 신고 |
| [License](../../LICENSE) | Apache-2.0 |

<details>
<summary><b>연구 계보</b></summary>

OwnMem은 기초 기술을 발명했다고 주장하지 않습니다. 기여는 이를 저장소 메모리의 실행 가능한 protocol로 조합한 데 있습니다.

- **Agent memory와 reflection:** [Reflexion (NeurIPS 2023)](https://papers.neurips.cc/paper_files/paper/2023/hash/1b44b878bb782e6954cd888628510e90-Abstract-Conference.html), [MemGPT (2023)](https://arxiv.org/abs/2310.08560)
- **Memory / knowledge-base poisoning:** [AgentPoison (NeurIPS 2024)](https://proceedings.neurips.cc/paper_files/paper/2024/hash/eb113910e9c3f6242541c1652e30dfd6-Abstract-Conference.html), [PoisonedRAG (USENIX Security 2025)](https://www.usenix.org/conference/usenixsecurity25/presentation/zou-poisonedrag)
- **Untrusted data와 authority 분리:** [CaMeL: Defeating Prompt Injections by Design (2025)](https://arxiv.org/abs/2503.18813)
- **독립 provenance:** [in-toto (USENIX Security 2019)](https://www.usenix.org/conference/usenixsecurity19/presentation/torres-arias)
- **Selective prediction과 abstention:** [Selective Classification (JMLR 2010)](https://jmlr.org/papers/v11/el-yaniv10a.html)
- **Ablation 기반 검증:** [Metamorphic Testing (1998)](https://www.cse.ust.hk/~scc/publ/CS98-01-metamorphictesting.pdf)
- **분해된 retrieval evaluation:** [ARES (NAACL 2024)](https://aclanthology.org/2024.naacl-long.20/), [RAGChecker (2024)](https://arxiv.org/abs/2408.08067)

인용은 연구 계보를 설명할 뿐 해당 논문이 OwnMem을 구현했거나 OwnMem이 실험을 재현했다는 뜻이 아닙니다.

</details>

OwnMem은 오픈 소스입니다. 재현 가능한 issue와 pull request를 환영합니다.
