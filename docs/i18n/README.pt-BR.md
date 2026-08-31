<div align="center">

# OwnMem

**Memória de projeto para agentes de programação no repositório: local, determinística, revisável e capaz de evoluir dentro de limites seguros.**

`Nativo do Git` · `recall local` · `multiagente` · `governado por evidência` · `Apache-2.0`

[![npm version](https://img.shields.io/npm/v/ownmem?style=flat-square&logo=npm&color=cb3837)](https://www.npmjs.com/package/ownmem)
[![npm downloads](https://img.shields.io/npm/dm/ownmem?style=flat-square&logo=npm&color=555)](https://www.npmjs.com/package/ownmem)
[![release gates](https://img.shields.io/github/actions/workflow/status/grpcer/ownmem/ci.yml?branch=main&style=flat-square&label=release%20gates)](https://github.com/grpcer/ownmem/actions/workflows/ci.yml)
[![node >= 20.6](https://img.shields.io/badge/node-%E2%89%A5%2020.6-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![license Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-1d7afc?style=flat-square)](../../LICENSE)

[English](../../README.md) · [简体中文](./README.zh-CN.md) · [繁體中文](./README.zh-TW.md) · [日本語](./README.ja.md) · [한국어](./README.ko.md) · [Español](./README.es.md) · [Français](./README.fr.md) · [Deutsch](./README.de.md) · **Português (BR)**

</div>

## Por que OwnMem

A maioria dos sistemas otimiza “lembrar mais”. O OwnMem começa por outra pergunta: **quem possui o conhecimento do projeto, quem pode alterá-lo e como impedir uma memória errada antes que ela mude as ações do agente?**

| Vantagem | O que significa na prática |
| --- | --- |
| **A memória pertence ao repositório** | Markdown legível em `.ownmem/` acompanha o código em clone, revisão e rollback. |
| **Uma memória para vários agentes** | Claude Code, Codex, Cursor, Gemini CLI, Grok CLI e outros hosts compartilham uma fonte. |
| **Recall local e determinístico** | Sem modelo ou rede; mesma consulta, configuração e snapshot geram a mesma ordem. |
| **Evidência antes da autoridade** | O conteúdo não pode se declarar confiável; receipts independentes e evidência viva decidem. |
| **Crescimento limitado** | Schema, cotas, duplicatas, ciclo de vida e auditoria evitam outro wiki abandonado. |
| **Baixo risco automático, alto impacto revisado** | Somente metadata R0 comprovada por replay evolui sem intervenção. |

## Arquitetura

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/architecture-pt-BR-dark.svg">
  <img alt="Arquitetura do OwnMem: Markdown pertencente ao repositório e trust receipts independentes são compilados em snapshots imutáveis; recall local determinístico passa por quatro portões de entrega, enquanto um coordenador limitado reproduz, promove, observa, isola e reverte com precisão mudanças de baixo risco." src="../assets/architecture-pt-BR-light.svg" width="100%">
</picture>

O OwnMem separa “registrar a experiência” de “entregá-la a um agente”:

- **O repositório é a fonte.** Rotas L1, índices L2 e tópicos L3 são Markdown revisável; trust receipts ficam fora do texto autorizado.
- **Compile antes do recall.** Schema, grafo, ciclo de vida e evidência geram um snapshot imutável endereçado por conteúdo.
- **Cinco canais determinísticos.** exact, BM25F, n-gram, fuzzy e graph são fundidos localmente. embedding é um sexto canal opcional com peso 0 até passar A/B.
- **Quatro portões de entrega.** relevância, validade factual, aplicabilidade e risco resultam em entrega, advisory, quarentena ou abstenção.
- **Evolução autônoma limitada.** No fim do turno, só R0 comprovado, dentro da cota e exatamente reversível é promovido; R1–R5 vai para revisão.

## Como o OwnMem governa memória de agentes de IA

O diferencial não é uma fórmula de ranking. O OwnMem transforma memória de agentes de programação em um protocolo verificável de recuperação e evolução:

| Mecanismo | Como é aplicado |
| --- | --- |
| **Memória com evidência** | Hash, raiz de evidência, ciclo de vida, aplicabilidade, risco e receipts anteriores decidem a entrada no contexto. |
| **Portão contrafactual de promoção** | É preciso provar falha na base, recuperação só pelo candidato e zero regressão no corpus aprovado. |
| **Risco pela superfície alterada** | Deriva do que mudou e do impacto possível; o agente não pode rebaixar a própria proposta. |
| **Rollback compensatório endereçado** | Mudanças automáticas carregam uma inversa verificada e restauram bytes exatos sem apagar histórico. |
| **Quarentena contra poisoning** | Candidato, conteúdo, autoridade e evidência são domínios separados; ser recuperado não concede permissão. |
| **Entrega seletiva** | Evidência insuficiente gera advisory, quarentena ou abstenção, nunca confiança inventada. |
| **Snapshots compilados imutáveis** | Markdown, grafo, identidade de ranking e confiança formam uma entrada de runtime reproduzível. |
| **Três registros sem mistura** | Correção do recall, outcomes confirmados e autoatribuição do agente permanecem separados. |

Leia o [design técnico e o mapeamento de pesquisa](../TECHNICAL.md).

## Comece em três minutos

Requer Node.js 20.6 ou mais recente. Execute no repositório que deve possuir a memória:

```bash
npm install --save-dev ownmem
npx ownmem init --locale auto --hosts claude,codex --layers dashboard --hook
```

Reabra o agente após inicializar. O OwnMem cria `.ownmem/` e altera apenas áreas marcadas como gerenciadas. Para um adaptador use `--hosts claude`, `--hosts codex`, `--hosts cursor` ou `--hosts gemini`; veja antes com `npx ownmem init --check`.

## Uso diário

Depois, continue trabalhando em linguagem natural:

> “Lembre: o timeout de staging vem do limite do pool, não de poucos workers. Verifique os dois na próxima vez.”

> “Antes de mudar, veja se a memória do projeto já encontrou a mesma falha.”

O host faz recall antes do trabalho relevante e agenda uma evolução bloqueada e com debounce ao fim do turno. Normalmente não é preciso encadear promotion, trust, audit e compile. Use o console local ou o status do coordenador para acompanhar:

```bash
npx ownmem dashboard --open
npx ownmem evolve status
npx ownmem evolve run --force
```

## Limite entre confiança e automação

O OwnMem automatiza o que a máquina consegue provar, não o que apenas parece plausível.

- **Automático:** recall determinístico, varredura, tripwire, replay contrafactual, backfill R0, receipt de máquina, audit, compile, observação, quarentena e rollback exato.
- **Para revisão:** nova prosa, política, active set, conflitos, evidência insuficiente, mudanças R1–R5 e publicação.
- **Limite rígido:** candidate não é memory; autoatribuição não é confirmação; texto recuperado não substitui instruções nem autoriza ferramentas.
- **Em falhas:** conteúdo não assinado ou evidência não verificável é isolado; drift vira advisory; falha transacional restaura o estado validado anterior.

## Quando usar

| OwnMem é adequado | Prefira outro sistema |
| --- | --- |
| O conhecimento deve ser revisado e migrar com o código. | Você precisa de perfil pessoal ou memória global entre repositórios. |
| Vários agentes se alternam em um repositório. | Você quer capturar toda conversa sem limites de evidência ou risco. |
| Recall local e reproduzível sem cobrança de API de recuperação importa. | Você precisa de busca vetorial cloud em escala ou grafo global em tempo real. |
| Memória errada deve ser atribuível, rejeitável e reversível. | Quantidade importa mais que governança. |

## Local por padrão

- O ranking padrão lê apenas arquivos e snapshots locais: zero chamadas LLM, zero rede e nenhuma cobrança de API de recuperação. Os trechos entregues ainda usam o contexto do agente e são limitados pelo orçamento configurado.
- Eventos ficam em diretório local ignorado pelo Git. Sem outcomes, aparece “indisponível”, nunca 0% inventado.
- Segredos e dados pessoais ou de produção que não pertencem ao Git também não pertencem à memória.
- embedding é opcional e isolado; só entra no ranking weighted após evidência A/B local.

## Linhagem de pesquisa

O OwnMem não reivindica essas bases como invenções. Sua contribuição é combiná-las em um protocolo executável para memória de repositório:

- **Memória de agentes e reflexão:** [Reflexion (NeurIPS 2023)](https://papers.neurips.cc/paper_files/paper/2023/hash/1b44b878bb782e6954cd888628510e90-Abstract-Conference.html), [MemGPT (2023)](https://arxiv.org/abs/2310.08560)
- **Poisoning de memória e conhecimento:** [AgentPoison (NeurIPS 2024)](https://proceedings.neurips.cc/paper_files/paper/2024/hash/eb113910e9c3f6242541c1652e30dfd6-Abstract-Conference.html), [PoisonedRAG (USENIX Security 2025)](https://www.usenix.org/conference/usenixsecurity25/presentation/zou-poisonedrag)
- **Dados não confiáveis separados da autoridade:** [CaMeL: Defeating Prompt Injections by Design (2025)](https://arxiv.org/abs/2503.18813)
- **Proveniência independente:** [in-toto (USENIX Security 2019)](https://www.usenix.org/conference/usenixsecurity19/presentation/torres-arias)
- **Predição seletiva e abstenção:** [Selective Classification (JMLR 2010)](https://jmlr.org/papers/v11/el-yaniv10a.html)
- **Validação diferencial e compensação:** [Metamorphic Testing (1998)](https://www.cse.ust.hk/~scc/publ/CS98-01-metamorphictesting.pdf), [Sagas (SIGMOD 1987)](https://doi.org/10.1145/38713.38742)
- **Avaliação de retrieval decomposta:** [ARES (NAACL 2024)](https://aclanthology.org/2024.naacl-long.20/), [RAGChecker (2024)](https://arxiv.org/abs/2408.08067)

As citações mostram a linhagem; não significam que esses trabalhos implementem o OwnMem nem que o OwnMem reproduza seus experimentos.

## Documentação

| Documento | Conteúdo |
| --- | --- |
| [Architecture](../ARCHITECTURE.md) | Limites, snapshots, confiança e evolução |
| [Technical design](../TECHNICAL.md) | Mecanismos, ameaças e pesquisa |
| [Plugins](../PLUGINS.md) | Instalação opcional de plugins |
| [Updating](../UPDATING.md) | Atualização segura e migrações de versão |
| [Privacy](../PRIVACY.md) | Dados locais e canais opcionais |
| [Changelog](../../CHANGELOG.md) | Histórico de versões |
| [License](../../LICENSE) | Apache-2.0 |

OwnMem é código aberto. Issues e pull requests reproduzíveis são bem-vindos.
