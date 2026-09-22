<div align="center">

# OwnMem

**Memória nativa do Git para agentes de programação com IA**

Memória de projeto para agentes de programação no repositório: local, determinística, revisável e nunca escrita sem o seu commit.

[![npm version](https://img.shields.io/npm/v/ownmem?style=flat-square&logo=npm&color=cb3837)](https://www.npmjs.com/package/ownmem)
[![npm downloads](https://img.shields.io/npm/dm/ownmem?style=flat-square&logo=npm&color=555)](https://www.npmjs.com/package/ownmem)
[![GitHub stars](https://img.shields.io/github/stars/grpcer/ownmem?style=flat-square&logo=github&color=e3b341)](https://github.com/grpcer/ownmem/stargazers)
[![release gates](https://img.shields.io/github/actions/workflow/status/grpcer/ownmem/ci.yml?branch=main&style=flat-square&label=release%20gates)](https://github.com/grpcer/ownmem/actions/workflows/ci.yml)
[![node >= 20.6](https://img.shields.io/badge/node-%E2%89%A5%2020.6-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![license Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-1d7afc?style=flat-square)](../../LICENSE)

[English](../../README.md) · [简体中文](./README.zh-CN.md) · [繁體中文](./README.zh-TW.md) · [日本語](./README.ja.md) · [한국어](./README.ko.md) · [Español](./README.es.md) · [Français](./README.fr.md) · [Deutsch](./README.de.md) · **Português (BR)**

</div>

## <a name="why-ownmem"></a>✨ Por que o OwnMem

A maioria dos sistemas otimiza “lembrar mais”. O OwnMem começa por outra pergunta: **quem possui o conhecimento do projeto, quem pode alterá-lo e como impedir uma memória errada antes que ela mude as ações do agente?**

| Vantagem | O que significa na prática |
| --- | --- |
| **A memória pertence ao repositório** | Markdown legível em `.ownmem/` acompanha o código em clone, revisão e rollback, e todos os agentes do repositório leem a mesma fonte. |
| **Recall local e determinístico** | Sem modelo ou rede; mesma consulta, configuração e snapshot geram a mesma ordem. |
| **Evidência antes da autoridade** | O conteúdo não pode se declarar confiável; receipts independentes e evidência viva decidem. |
| **Diz quando não sabe** | A entrega é em níveis: a memória citada, até três ponteiros, ou uma abstenção que nomeia o portão que recusou. |
| **Crescimento líquido zero** | O número de entradas só diminui: acrescentar a um corpus cheio obriga a aposentar algo na mesma mudança. |

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/benchmark-dark.svg">
  <img alt="Benchmark público do OwnMem: Recall@1 de 100% em 128 consultas em 40 idiomas, contra 3,9% do grep -F no mesmo corpus; latência de recall de 0,46 ms no P50 e 1,05 ms no P95 em 4.200 amostras, abaixo do limite de publicação de 5 ms; MRR 1,000, abstenção nas 40 consultas não relacionadas, nenhuma chamada de modelo ou de rede e duas dependências de execução." src="../assets/benchmark-light.svg" width="100%">
</picture>

<sub>Medido no corpus CC0 fixado neste repositório. Para reproduzir, rode `npm run benchmark` em um clone.</sub>

## <a name="how-it-compares"></a><a name="how-this-differs-from-claudemd-and-built-in-memory"></a>🆚 Comparação

O OwnMem não substitui `CLAUDE.md` nem `AGENTS.md`. Esses arquivos dizem como se trabalha aqui e são lidos por inteiro a cada turno. O OwnMem responde a outra pergunta: de tudo o que este projeto aprendeu na marra, o que vale colocar diante do modelo **para esta tarefa** — e ele tem o direito de responder “nada”.

|  | Arquivos de instruções | Memória embutida do agente | OwnMem |
| --- | --- | --- | --- |
| Quem escreve | você, à mão | o agente, a partir das suas conversas | você, revisado como código |
| Onde vive | um arquivo no repositório | a conta do fornecedor | Markdown no seu repositório |
| O que chega ao modelo | tudo, a cada turno | o que o recall dele escolheu | um de três níveis, sob um orçamento de tokens |
| Quando uma entrada está errada | você edita o arquivo | talvez você nunca veja aquela entrada | o drift de evidência a rebaixa e diz o que mudou |
| Custo por turno | o arquivo inteiro em tokens | uma chamada de recuperação | nenhuma chamada de modelo nem de rede |

## <a name="quick-start"></a>🚀 Início rápido

Requer Node.js 20.6 ou mais recente. Execute no repositório que deve possuir a memória:

```bash
npm install --save-dev ownmem
npx ownmem init --hook --hosts claude,codex
```

Depois, reabra o agente. Liste em `--hosts` os hosts que você usa (`claude`, `codex`, `cursor`, `gemini`, `grok`); a lista fica registrada, e para adicionar ou remover um host depois basta passá-la de novo. O `init` cria `.ownmem/` e os adaptadores de cada host, em arquivos de instruções como `CLAUDE.md`, só altera o que está dentro de blocos gerenciados e mostra qualquer etapa de configuração, feita uma única vez, que ainda falte para um host. Adicione `--check` ao mesmo comando para ver antes o que ele faz, e `--locale auto` para gerar as instruções no idioma do sistema.

| Host | Como o recall acontece | Configuração |
| --- | --- | --- |
| Claude Code | Um hook antes de cada Edit e Write, e quando você pedir | `claude` |
| Codex | Um hook antes de cada patch que ele aplica, e quando você pedir | `codex`; os hooks exigem três passos de confiança feitos uma única vez, que o `init` mostra |
| Grok CLI | Lê a configuração de hooks do Claude Code pela sua camada de compatibilidade | `grok`, junto com `claude` se você usa os dois; marque a pasta como confiável uma vez com `/hooks-trust` |
| Cursor | Uma regra sempre aplicada ou o servidor MCP | `cursor`; o servidor MCP exige um passo manual, veja [Plugins](../PLUGINS.md) |
| Gemini CLI | Instruções ou o servidor MCP | `gemini`; o servidor MCP exige um passo manual, veja [Plugins](../PLUGINS.md) |

> **⚠️ Vindo do 0.6.0?** Atualize o pacote com `npm install --save-dev ownmem@latest` e, antes de qualquer outra coisa, rode `npx ownmem init --update`. O 0.6.0 instalou hooks cujos subcomandos não existem mais, então uma instalação que os mantém executa um comando que falha a cada chamada de Bash. A atualização os remove e nunca mexe nos hooks que você mesmo escreveu. [Updating](../UPDATING.md) explica o resto, incluindo a limpeza do `core.hooksPath`.

## <a name="daily-use"></a>💬 Uso diário

Continue trabalhando em linguagem natural. Seu agente rascunha uma memória quando você pedir, e você a revisa como código:

> “Lembre: o timeout de staging vem do limite do pool, não de poucos workers. Verifique os dois na próxima vez.”

> “Antes de mudar, veja se a memória do projeto já encontrou a mesma falha.”

O recall responde em um de três níveis: a memória citada, até três ponteiros para ir ler ou uma abstenção. Uma execução real:

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

A confiança é declarada, não presumida. Nada sustenta esta entrada ainda — nenhuma revisão a confirmou e ela não cita documento de autoridade nem âncora de código —, então ela chega como uma pista a verificar de novo, não como um fato estabelecido.

Os comandos que você mesmo vai usar:

```bash
npx ownmem new staging_timeout_pool_cap   # scaffold one memory that already passes every gate
npx ownmem report --since 7d              # used? fast enough? right? what to do next
npx ownmem dashboard --open               # open the local console
npx ownmem mcp                            # serve recall and read to any MCP host over stdio
```

<img alt="O console local do OwnMem: o resíduo conhecido de entregas erradas como número principal, o funil de buscas ao lado, a saúde do corpus e das evidências abaixo e a navegação para desempenho, qualidade, governança e recuperação semântica." src="../assets/console.png" width="100%">

`ownmem mcp` existe para hosts sem hooks. Ele expõe exatamente duas ferramentas, `recall` e `read`, e nenhuma pode alterar uma memória; os comandos de controle (`audit`, `trust`, `compile`) e qualquer escrita de memória não ficam acessíveis por essa via. [Plugins](../PLUGINS.md) mostra como registrá-lo para que rode a cópia instalada no projeto.

## <a name="how-it-works"></a><a name="architecture"></a><a name="how-ownmem-governs-ai-agent-memory"></a>🧩 Como funciona

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/architecture-pt-BR-dark.svg">
  <img alt="Arquitetura do OwnMem: Markdown pertencente ao repositório e trust receipts independentes são compilados em snapshots imutáveis; o recall local determinístico passa por quatro portões de entrega e chega em um de três níveis — a memória citada, até três ponteiros, ou uma abstenção que diz o motivo — enquanto os livros de feedback local, o banco de avaliação e uma cota de crescimento líquido zero limitam no que o corpus se torna." src="../assets/architecture-pt-BR-light.svg" width="100%">
</picture>

- **O repositório é a fonte.** Rotas L1, índices L2 e tópicos L3 são Markdown revisável; trust receipts ficam fora do texto autorizado.
- **Compile antes do recall.** Os portões de schema, grafo, ciclo de vida e evidência geram um snapshot imutável endereçado por conteúdo. Cinco canais determinísticos — exact, BM25F, n-gram, fuzzy e graph — são fundidos localmente; embedding é um sexto canal opcional com peso 0 até ser aprovado na avaliação A/B local.
- **Quatro portões, três níveis.** Relevância, validade epistêmica, aplicabilidade à tarefa e risco da ação recusam cada um por motivo próprio. Acima de um limiar tirado de uma curva de ablação, a memória é citada; abaixo dele, até três ponteiros que explicitamente não são respostas; sem candidato apto, uma abstenção que nomeia o portão que recusou.
- **Nenhuma escrita sem supervisão.** Não há coordenador, nem promoção, nem fila de candidatos. O pacote mede, propõe e recusa; cada mudança na memória é um commit que alguém faz, e nenhuma mudança de ranking entra sem passar pelo banco de avaliação.

Mecanismos, modelo de ameaças e relação com a pesquisa: [Technical design](../TECHNICAL.md).

## <a name="privacy-and-boundaries"></a><a name="trust-and-automation-boundary"></a><a name="local-first-by-default"></a><a name="telemetry-and-the-daily-pass"></a>🔒 Privacidade e limites

- **Local por padrão.** O ranking lê apenas arquivos do repositório e snapshots locais: zero chamadas LLM, zero requisições de rede e nenhuma cobrança de API de recuperação. Os trechos entregues ainda usam o contexto do agente, dentro do orçamento configurado.
- **A telemetria não sai da máquina.** Eventos de execução ficam em um diretório ignorado pelo Git e expiram em trinta dias. A rotina diária (`ownmem daily`) reduz cada dia encerrado a um pacote de contagens sem texto de consulta, corpo dos tópicos ou caminhos de arquivo. Sem amostras, aparece “indisponível”, nunca 0%.
- **Texto recuperado é tratado como dado.** Ele não se sobrepõe às instruções do host nem autoriza ferramentas, e a autoatribuição de um agente nunca conta como confirmação do usuário.
- **Falhas ficam visíveis.** Uma entrada com conteúdo não assinado ou alvo de evidência não verificável fica retida; o drift de evidência a rebaixa para advisory e diz o que mudou.
- **Nada de segredos.** Segredos e dados pessoais ou de produção que não pertencem ao Git também não pertencem à memória.

## <a name="when-to-use-it"></a><a name="where-it-fits"></a>🧭 Quando usar

| OwnMem é adequado | Prefira outro sistema |
| --- | --- |
| O conhecimento deve ser revisado e migrar com o código. | Você precisa de perfil pessoal ou memória global entre repositórios. |
| Vários agentes se alternam em um repositório. | Você quer capturar toda conversa sem limites de evidência ou risco. |
| Recall local e reproduzível sem cobrança de API de recuperação importa. | Você precisa de busca vetorial cloud em escala ou grafo global em tempo real. |
| Memória errada deve ser atribuível, rejeitável e reversível. | Quantidade importa mais que governança. |

## <a name="documentation"></a><a name="research-lineage"></a>📚 Documentação

| Documento | Conteúdo |
| --- | --- |
| [Architecture](../ARCHITECTURE.md) | Limites, snapshots, confiança e entrega |
| [Technical design](../TECHNICAL.md) | Mecanismos, ameaças e pesquisa |
| [Plugins](../PLUGINS.md) | Configuração por host, plugins e passos de confiança |
| [Updating](../UPDATING.md) | Atualização segura e migrações de versão |
| [Privacy](../PRIVACY.md) | Dados locais e canais opcionais |
| [Changelog](../../CHANGELOG.md) | Histórico de versões |
| [Contributing](../../.github/CONTRIBUTING.md) | Como reportar issues e enviar mudanças |
| [Security](../../.github/SECURITY.md) | Como reportar uma vulnerabilidade |
| [License](../../LICENSE) | Apache-2.0 |

<details>
<summary><b>Fundamentos de pesquisa</b></summary>

O OwnMem não reivindica essas bases como invenções. Sua contribuição é combiná-las em um protocolo executável para memória de repositório:

- **Memória de agentes e reflexão:** [Reflexion (NeurIPS 2023)](https://papers.neurips.cc/paper_files/paper/2023/hash/1b44b878bb782e6954cd888628510e90-Abstract-Conference.html), [MemGPT (2023)](https://arxiv.org/abs/2310.08560)
- **Poisoning de memória e conhecimento:** [AgentPoison (NeurIPS 2024)](https://proceedings.neurips.cc/paper_files/paper/2024/hash/eb113910e9c3f6242541c1652e30dfd6-Abstract-Conference.html), [PoisonedRAG (USENIX Security 2025)](https://www.usenix.org/conference/usenixsecurity25/presentation/zou-poisonedrag)
- **Dados não confiáveis separados da autoridade:** [CaMeL: Defeating Prompt Injections by Design (2025)](https://arxiv.org/abs/2503.18813)
- **Proveniência independente:** [in-toto (USENIX Security 2019)](https://www.usenix.org/conference/usenixsecurity19/presentation/torres-arias)
- **Predição seletiva e abstenção:** [Selective Classification (JMLR 2010)](https://jmlr.org/papers/v11/el-yaniv10a.html)
- **Validação por ablação:** [Metamorphic Testing (1998)](https://www.cse.ust.hk/~scc/publ/CS98-01-metamorphictesting.pdf)
- **Avaliação de retrieval decomposta:** [ARES (NAACL 2024)](https://aclanthology.org/2024.naacl-long.20/), [RAGChecker (2024)](https://arxiv.org/abs/2408.08067)

As citações mostram a linhagem; não significam que esses trabalhos implementem o OwnMem nem que o OwnMem reproduza seus experimentos.

</details>

OwnMem é código aberto. Issues e pull requests reproduzíveis são bem-vindos.
