<div align="center">

# OwnMem

**AI 코딩 에이전트의 프로젝트 메모리를 저장소에 둡니다. 로컬·결정적·검토 가능하며 안전한 범위에서 스스로 개선됩니다.**

`Git 네이티브` · `로컬 회상` · `멀티 에이전트` · `증거 거버넌스` · `Apache-2.0`

[![npm version](https://img.shields.io/npm/v/ownmem?style=flat-square&logo=npm&color=cb3837)](https://www.npmjs.com/package/ownmem)
[![node >= 20.6](https://img.shields.io/badge/node-%E2%89%A5%2020.6-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![license Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-1d7afc?style=flat-square)](../../LICENSE)

[English](../../README.md) · [简体中文](./README.zh-CN.md) · [繁體中文](./README.zh-TW.md) · [日本語](./README.ja.md) · **한국어** · [Español](./README.es.md) · [Français](./README.fr.md) · [Deutsch](./README.de.md) · [Português (BR)](./README.pt-BR.md)

</div>

## 왜 OwnMem인가

대부분의 메모리 시스템은 “더 많이 기억하기”를 최적화합니다. OwnMem은 먼저 **프로젝트 지식을 누가 소유하고, 누가 바꿀 수 있으며, 잘못된 메모리를 행동 전에 어떻게 막을지** 묻습니다.

| 장점 | 실제 개발에서의 의미 |
| --- | --- |
| **메모리는 저장소 소유** | `.ownmem/`의 읽을 수 있는 Markdown이 코드와 함께 clone, review, rollback 됩니다. |
| **하나의 메모리를 여러 Agent가 공유** | Claude Code, Codex, Cursor, Gemini CLI, Grok CLI 등이 동일한 지식 원본을 사용합니다. |
| **기본 회상은 결정적·로컬** | 모델이나 네트워크를 호출하지 않고 같은 query·config·snapshot에 같은 순위를 냅니다. |
| **authority보다 증거가 먼저** | 본문은 스스로 신뢰를 부여하지 못하며 독립 receipt와 실시간 evidence 검증이 전달을 결정합니다. |
| **제한된 성장** | Schema, quota, 중복, lifecycle, audit가 방치된 두 번째 Wiki가 되는 것을 막습니다. |
| **저위험은 자동, 고영향은 검토** | replay로 입증된 R0 검색 metadata만 무인 진화할 수 있습니다. |

## 전체 아키텍처

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/architecture-ko-dark.svg">
  <img alt="OwnMem 전체 아키텍처. 저장소 소유 Markdown과 독립 trust receipt를 불변 snapshot으로 compile하고 결정적 로컬 recall을 네 전달 gate에 통과시킨다. 제한된 evolution coordinator는 저위험 변경을 replay, 승격, 관찰, 격리하고 정확히 rollback한다." src="../assets/architecture-ko-light.svg" width="100%">
</picture>

OwnMem은 “경험을 기록하는 일”과 “Agent에게 전달하는 일”을 분리합니다.

- **저장소가 진실의 원천.** L1 routing, L2 area index, L3 topic은 검토 가능한 Markdown이며 trust receipt는 본문과 분리됩니다.
- **compile 후 recall.** Schema, graph, lifecycle, evidence gate가 content-addressed 불변 snapshot을 만듭니다.
- **5개 결정적 후보 lane.** exact, BM25F, n-gram, fuzzy, graph를 로컬에서 융합합니다. embedding은 선택적 6번째 lane이며 A/B 증거 전에는 가중치 0입니다.
- **전달 전 4개 gate.** relevance, factual validity, task applicability, action risk가 정상 전달, advisory, quarantine, abstention을 정합니다.
- **제한된 무인 진화.** turn 종료 coordinator는 replay 입증·quota 내·정확히 되돌릴 수 있는 R0만 자동 승격하고 R1–R5는 검토로 보냅니다.

## 0.3의 차별점

차이는 하나의 ranking 공식이 아닙니다. OwnMem 0.3은 Agent Memory를 검증 가능한 진화 프로토콜로 만듭니다.

| 메커니즘 | OwnMem 0.3의 동작 |
| --- | --- |
| **증거를 지닌 메모리** | content hash, evidence root, lifecycle, applicability, risk, predecessor receipt가 context 진입을 결정합니다. |
| **반사실 promotion gate** | baseline miss, 후보로만 복구, 기존 통과 corpus의 무회귀를 증명해야 합니다. |
| **변경 면에서 위험 산정** | 무엇을 바꾸고 어디에 영향 주는지로 정하며 Agent는 자신의 제안을 낮은 위험으로 바꿀 수 없습니다. |
| **content-addressed 보상 rollback** | 자동 변경은 검증 가능한 역연산을 갖고 실패나 harmful outcome 시 이전 byte를 정확히 복구합니다. |
| **memory poisoning 격리** | candidate, content, authority, evidence는 다른 trust domain이며 검색됨은 권한이 아닙니다. |
| **선택적 전달** | 증거가 부족하면 advisory, quarantine, abstention하고 신뢰도를 꾸며내지 않습니다. |
| **불변 compiled snapshot** | Markdown, graph, ranking identity, trust state를 재현 가능한 runtime input으로 만듭니다. |
| **서로 섞지 않는 세 ledger** | 검색 정오, user/host outcome, Agent self-attribution을 분리 기록합니다. |

자세한 내용은 [technical design and research mapping](../TECHNICAL.md)을 참고하세요.

## 3분 만에 시작

Node.js 20.6 이상이 필요합니다. 메모리를 소유할 저장소에서 실행하세요.

```bash
npm install --save-dev ownmem
npx ownmem init --locale auto --hosts claude,codex --layers dashboard --hook
```

초기화 뒤 Agent를 다시 여세요. OwnMem은 `.ownmem/`을 만들고 host 파일의 관리 marker 내부만 수정합니다. adapter 하나만 필요하면 `--hosts claude`, `--hosts codex`, `--hosts cursor`, `--hosts gemini`를 사용하고 `npx ownmem init --check`로 미리 볼 수 있습니다.

## 일상 사용

설치 후에는 자연어로 계속 작업합니다.

> “기억해 둬. staging 배포 timeout은 worker 부족이 아니라 pool cap 때문이야. 다음에는 둘 다 확인해.”

> “바꾸기 전에 프로젝트 메모리에 같은 장애가 있었는지 확인해.”

host는 관련 작업 전 recall하고 turn 끝에 lock·debounce가 적용된 evolution을 한 번 예약합니다. promotion, trust, audit, compile을 수동으로 연결할 필요는 보통 없습니다. 로컬 console이나 coordinator status로 확인할 수 있습니다.

```bash
npx ownmem dashboard --open
npx ownmem evolve status
npx ownmem evolve run --force
```

## 신뢰와 자동화 경계

OwnMem이 자동화하는 것은 “기계가 증명할 수 있는 부분”이지 “그럴듯한 부분”이 아닙니다.

- **자동:** 결정적 recall, candidate scan, tripwire, 반사실 replay, R0 trigger backfill, machine trust receipt, audit, compile, 관찰, 격리, 정확한 rollback.
- **검토로 승격:** 새 본문 지식, policy, active set, conflict, 증거 부족, R1–R5, publish.
- **고정 경계:** candidate는 memory가 아니고 self-attribution은 user confirmation이 아니며 recall된 텍스트는 host 지시나 tool 권한을 덮을 수 없습니다.
- **실패 동작:** unsigned content와 검증 불가 evidence는 격리, evidence drift는 advisory, transaction failure는 직전 검증 상태로 복구합니다.

## 적합한 경우

| OwnMem이 잘 맞음 | 다른 시스템이 더 맞음 |
| --- | --- |
| 프로젝트 지식을 코드와 함께 검토·이동하고 싶다. | 저장소를 넘는 개인 profile이나 global user memory가 필요하다. |
| 한 저장소에서 여러 coding Agent를 번갈아 쓴다. | 증거·risk boundary 없이 모든 대화를 자동 저장하고 싶다. |
| 로컬·재현 가능·query cost 0 recall이 중요하다. | 대규모 cloud vector search나 realtime global knowledge graph가 필요하다. |
| 잘못된 메모리를 추적·거절·철회할 수 있어야 한다. | governance보다 메모리 양이 중요하다. |

## 기본은 로컬 우선

- 기본 recall은 저장소 파일과 local snapshot만 읽어 LLM·network·query token cost가 0입니다.
- runtime event는 Git-ignore된 local directory에 저장됩니다. outcome sample이 없으면 0%가 아니라 “없음”으로 표시합니다.
- Git에 둘 수 없는 secret, 개인정보, production data는 memory에도 두지 않습니다.
- embedding lane은 선택적·격리형입니다. repository-local A/B evidence가 safety gate를 통과해야 weighted ranking에 참여합니다.

## 연구 계보

OwnMem은 기초 기술을 발명했다고 주장하지 않습니다. 기여는 이를 저장소 메모리의 실행 가능한 protocol로 조합한 데 있습니다.

- **Agent memory와 reflection:** [Reflexion (NeurIPS 2023)](https://papers.neurips.cc/paper_files/paper/2023/hash/1b44b878bb782e6954cd888628510e90-Abstract-Conference.html), [MemGPT (2023)](https://arxiv.org/abs/2310.08560)
- **Memory / knowledge-base poisoning:** [AgentPoison (NeurIPS 2024)](https://proceedings.neurips.cc/paper_files/paper/2024/hash/eb113910e9c3f6242541c1652e30dfd6-Abstract-Conference.html), [PoisonedRAG (USENIX Security 2025)](https://www.usenix.org/conference/usenixsecurity25/presentation/zou-poisonedrag)
- **Untrusted data와 authority 분리:** [CaMeL: Defeating Prompt Injections by Design (2025)](https://arxiv.org/abs/2503.18813)
- **독립 provenance:** [in-toto (USENIX Security 2019)](https://www.usenix.org/conference/usenixsecurity19/presentation/torres-arias)
- **Selective prediction과 abstention:** [Selective Classification (JMLR 2010)](https://jmlr.org/papers/v11/el-yaniv10a.html)
- **Differential validation과 compensation:** [Metamorphic Testing (1998)](https://www.cse.ust.hk/~scc/publ/CS98-01-metamorphictesting.pdf), [Sagas (SIGMOD 1987)](https://doi.org/10.1145/38713.38742)
- **분해된 retrieval evaluation:** [ARES (NAACL 2024)](https://aclanthology.org/2024.naacl-long.20/), [RAGChecker (2024)](https://arxiv.org/abs/2408.08067)

인용은 연구 계보를 설명할 뿐 해당 논문이 OwnMem을 구현했거나 OwnMem이 실험을 재현했다는 뜻이 아닙니다.

## 문서

| 문서 | 내용 |
| --- | --- |
| [Architecture](../ARCHITECTURE.md) | package 경계, snapshot, trust, evolution |
| [Technical design](../TECHNICAL.md) | mechanism, threat model, research mapping |
| [Plugins](../PLUGINS.md) | 선택적 host plugin 설치 |
| [Updating](../UPDATING.md) | 안전한 업데이트와 0.2 → 0.3 migration |
| [Privacy](../PRIVACY.md) | local data와 optional channel |
| [Changelog](../../CHANGELOG.md) | version history |
| [License](../../LICENSE) | Apache-2.0 |

OwnMem은 오픈 소스입니다. 재현 가능한 issue와 pull request를 환영합니다.
