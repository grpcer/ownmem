<div align="center">

# OwnMem

**Une mémoire native Git pour les agents de code IA**

La mémoire de projet des agents de code reste dans le dépôt : locale, déterministe, révisable, et jamais écrite sans votre commit.

[![npm version](https://img.shields.io/npm/v/ownmem?style=flat-square&logo=npm&color=cb3837)](https://www.npmjs.com/package/ownmem)
[![npm downloads](https://img.shields.io/npm/dm/ownmem?style=flat-square&logo=npm&color=555)](https://www.npmjs.com/package/ownmem)
[![GitHub stars](https://img.shields.io/github/stars/grpcer/ownmem?style=flat-square&logo=github&color=e3b341)](https://github.com/grpcer/ownmem/stargazers)
[![release gates](https://img.shields.io/github/actions/workflow/status/grpcer/ownmem/ci.yml?branch=main&style=flat-square&label=release%20gates)](https://github.com/grpcer/ownmem/actions/workflows/ci.yml)
[![node >= 20.6](https://img.shields.io/badge/node-%E2%89%A5%2020.6-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![license Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-1d7afc?style=flat-square)](../../LICENSE)

[English](../../README.md) · [简体中文](./README.zh-CN.md) · [繁體中文](./README.zh-TW.md) · [日本語](./README.ja.md) · [한국어](./README.ko.md) · [Español](./README.es.md) · **Français** · [Deutsch](./README.de.md) · [Português (BR)](./README.pt-BR.md)

</div>

## <a name="why-ownmem"></a>✨ Pourquoi OwnMem

La plupart des mémoires cherchent d’abord à « retenir plus ». OwnMem pose une autre question : **qui possède le savoir du projet, qui peut le modifier et comment arrêter un mauvais souvenir avant qu’il influence l’agent ?**

| Avantage | Conséquence pratique |
| --- | --- |
| **Le dépôt possède la mémoire** | Le Markdown lisible de `.ownmem/` voyage avec le code lors du clone, de la revue et du rollback, et tous les agents du dépôt lisent la même source. |
| **Rappel local et déterministe** | Aucun modèle ni réseau ; mêmes requête, configuration et snapshot, même classement. |
| **Les preuves avant l’autorité** | Le texte ne peut pas s’auto-déclarer fiable ; receipts indépendants et preuves vivantes décident. |
| **Il dit quand il ne sait pas** | La livraison est graduée : la mémoire citée, jusqu’à trois pointeurs, ou une abstention qui nomme la porte ayant refusé. |
| **Croissance nette nulle** | Le nombre d’entrées ne peut que baisser : ajouter à un corpus plein oblige à en retirer une dans le même changement. |

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/benchmark-dark.svg">
  <img alt="Benchmark public d’OwnMem : Recall@1 de 100 % sur 128 requêtes en 40 langues, contre 3,9 % pour grep -F sur le même corpus ; latence de rappel de 0,46 ms au P50 et 1,05 ms au P95 sur 4 200 échantillons, sous le seuil de publication de 5 ms ; MRR 1,000, abstention sur les 40 requêtes hors sujet, aucun appel à un modèle ni au réseau, deux dépendances d’exécution." src="../assets/benchmark-light.svg" width="100%">
</picture>

<sub>Mesuré sur le corpus CC0 figé dans ce dépôt. Pour le reproduire, lancez `npm run benchmark` dans un clone.</sub>

## <a name="how-it-compares"></a><a name="how-this-differs-from-claudemd-and-built-in-memory"></a>🆚 Comparaison

OwnMem ne remplace ni `CLAUDE.md` ni `AGENTS.md`. Ces fichiers disent comment on travaille ici, et ils sont lus en entier à chaque tour. OwnMem répond à une autre question : parmi tout ce que ce projet a appris à la dure, qu’est-ce qui mérite d’être mis sous les yeux du modèle **pour cette tâche** — avec le droit de répondre « rien ».

|  | Fichiers d’instructions | Mémoire intégrée de l’agent | OwnMem |
| --- | --- | --- | --- |
| Qui l’écrit | vous, à la main | l’agent, depuis vos conversations | vous, relu comme du code |
| Où elle vit | un fichier du dépôt | le compte de l’éditeur | du Markdown dans votre dépôt |
| Ce qui atteint le modèle | tout, à chaque tour | ce que son propre rappel a choisi | l’un de trois niveaux, sous un budget de tokens |
| Quand une entrée est fausse | vous éditez le fichier | vous ne verrez peut-être jamais l’entrée | la dérive de preuve la rétrograde et dit ce qui a bougé |
| Coût par tour | le fichier entier en tokens | un appel de récupération | aucun appel de modèle ni de réseau |

## <a name="quick-start"></a>🚀 Démarrage rapide

Node.js 20.6 ou plus récent est requis. Exécutez ceci dans le dépôt qui doit posséder la mémoire :

```bash
npm install --save-dev ownmem
npx ownmem init --hook --hosts claude,codex
```

Rouvrez ensuite l’agent. Indiquez dans `--hosts` les hosts que vous utilisez (`claude`, `codex`, `cursor`, `gemini`, `grok`) ; la liste est enregistrée, et c’est en la repassant plus tard qu’on ajoute ou retire un host. `init` crée `.ownmem/` et les adaptateurs de chaque host, ne modifie les fichiers d’instructions comme `CLAUDE.md` qu’à l’intérieur de blocs gérés, et affiche toute étape ponctuelle qu’il reste à faire pour un host. Ajoutez `--check` à la même commande pour la prévisualiser, et `--locale auto` pour générer les instructions dans la langue du système.

| Host | Déclenchement du rappel | Installation |
| --- | --- | --- |
| Claude Code | Un hook avant chaque Edit et Write, et à la demande | `claude` |
| Codex | Un hook avant chaque patch qu’il applique, et à la demande | `codex` ; les hooks demandent trois étapes de confiance ponctuelles, qu’`init` affiche |
| Grok CLI | Lit la configuration des hooks de Claude Code via sa couche de compatibilité | `grok`, avec `claude` si vous utilisez les deux ; approuvez le dossier une fois avec `/hooks-trust` |
| Cursor | Une règle toujours appliquée ou le serveur MCP | `cursor` ; le serveur MCP demande une étape manuelle, voir [Plugins](../PLUGINS.md) |
| Gemini CLI | Instructions ou le serveur MCP | `gemini` ; le serveur MCP demande une étape manuelle, voir [Plugins](../PLUGINS.md) |

> **⚠️ Vous venez de la 0.6.0 ?** Mettez le paquet à jour avec `npm install --save-dev ownmem@latest`, puis lancez `npx ownmem init --update` avant toute autre chose. La 0.6.0 a installé des hooks dont les sous-commandes n’existent plus : une installation qui les garde exécute une commande qui échoue à chaque appel Bash. La mise à jour les retire et ne touche jamais aux hooks que vous avez écrits. [Updating](../UPDATING.md) détaille le reste, dont le nettoyage de `core.hooksPath`.

## <a name="daily-use"></a>💬 Usage quotidien

Continuez à travailler en langage courant. Votre agent rédige une mémoire quand vous le lui demandez, et vous la relisez comme du code :

> « Mémorise ceci : le timeout de staging vient de la limite du pool, pas d’un manque de workers. Vérifie les deux la prochaine fois. »

> « Avant de modifier, regarde si la mémoire du projet a déjà rencontré la même panne. »

Le rappel répond selon l’un des trois niveaux : la mémoire citée, jusqu’à trois pointeurs à aller lire ou une abstention. Une exécution réelle :

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

La confiance est affichée, jamais sous-entendue. Rien n’étaye encore cette entrée — aucune revue ne l’a confirmée et elle ne cite ni document d’autorité ni ancre de code : elle arrive donc comme une piste à revérifier, pas comme un fait établi.

Les commandes que vous lancerez vous-même :

```bash
npx ownmem new staging_timeout_pool_cap   # scaffold one memory that already passes every gate
npx ownmem report --since 7d              # used? fast enough? right? what to do next
npx ownmem dashboard --open               # open the local console
npx ownmem mcp                            # serve recall and read to any MCP host over stdio
```

<img alt="La console locale d’OwnMem : le résidu connu de livraisons erronées en chiffre principal, l’entonnoir des recherches à côté, l’état du corpus et des preuves en dessous, et la navigation vers performances, qualité, gouvernance et recherche sémantique." src="../assets/console.png" width="100%">

`ownmem mcp` est destiné aux hosts sans hooks. Il expose exactement deux outils, `recall` et `read`, et aucun ne peut modifier une mémoire ; les commandes de contrôle (`audit`, `trust`, `compile`) et toute écriture en mémoire ne sont pas accessibles par cette voie. [Plugins](../PLUGINS.md) montre comment le déclarer pour qu’il exécute la copie installée dans le projet.

## <a name="how-it-works"></a><a name="architecture"></a><a name="how-ownmem-governs-ai-agent-memory"></a>🧩 Fonctionnement

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/architecture-fr-dark.svg">
  <img alt="Architecture OwnMem : le Markdown détenu par le dépôt et des receipts de confiance indépendants sont compilés en snapshots immuables ; le rappel local déterministe franchit quatre portes de livraison et arrive selon l’un de trois niveaux — la mémoire citée, jusqu’à trois pointeurs, ou une abstention qui en donne la raison — tandis que les registres de retour locaux, le banc d’évaluation et un quota à croissance nette nulle bornent ce que devient le corpus." src="../assets/architecture-fr-light.svg" width="100%">
</picture>

- **Le dépôt est la source.** Routage L1, index L2 et sujets L3 sont du Markdown révisable ; les trust receipts sont extérieurs au texte autorisé.
- **Compiler avant le rappel.** Les portes de schéma, de graphe, de cycle de vie et de preuve produisent un snapshot immuable adressé par contenu. Cinq canaux déterministes — exact, BM25F, n-gram, fuzzy et graph — fusionnent localement ; embedding est un sixième canal optionnel, à poids 0 tant que la preuve A/B locale n’est pas faite.
- **Quatre portes, trois niveaux.** Pertinence, validité épistémique, applicabilité à la tâche et risque de l’action refusent chacune pour un motif propre. Au-dessus d’un seuil lu sur une courbe d’ablation, la mémoire est citée ; en dessous, jusqu’à trois pointeurs qui ne sont explicitement pas des réponses ; sans candidat qualifié, une abstention qui nomme la porte ayant refusé.
- **Aucune écriture sans supervision.** Ni coordinateur, ni promotion, ni file de candidats. Le paquet mesure, propose et refuse ; chaque changement de la mémoire est un commit fait par quelqu’un, et aucun changement de classement n’entre sans passer par le banc d’évaluation.

Mécanismes, modèle de menaces et correspondance avec la recherche : [Technical design](../TECHNICAL.md).

## <a name="privacy-and-boundaries"></a><a name="trust-and-automation-boundary"></a><a name="local-first-by-default"></a><a name="telemetry-and-the-daily-pass"></a>🔒 Confidentialité et limites

- **Local par défaut.** Le classement ne lit que les fichiers du dépôt et les snapshots locaux : aucun appel LLM, aucune requête réseau, aucune facture d’API de récupération. Les extraits livrés occupent tout de même le contexte de l’agent, dans la limite du budget configuré.
- **La télémétrie reste sur la machine.** Les événements d’exécution vivent dans un dossier ignoré par Git et expirent au bout de trente jours. La passe quotidienne (`ownmem daily`) réduit chaque journée terminée à un paquet de compteurs, sans texte de requête, corps de sujet ni chemin de fichier. Faute d’échantillon, l’interface affiche « indisponible », jamais 0 %.
- **Le texte rappelé est traité comme une donnée.** Il ne peut ni prendre le pas sur les instructions du host ni autoriser un outil, et l’auto-attribution d’un agent ne vaut jamais confirmation de l’utilisateur.
- **Les échecs restent visibles.** Une entrée au contenu non signé ou à la cible de preuve invérifiable n’est pas livrée ; la dérive de preuve la fait passer en advisory et dit ce qui a bougé.
- **Pas de secrets.** Secrets et données personnelles ou de production interdits dans Git le sont aussi dans la mémoire.

## <a name="when-to-use-it"></a><a name="where-it-fits"></a>🧭 Quand OwnMem convient

| OwnMem convient | Préférer un autre système |
| --- | --- |
| Le savoir doit être relu et migrer avec le code. | Il faut un profil personnel ou une mémoire globale entre dépôts. |
| Plusieurs agents alternent sur un même dépôt. | Toute conversation doit être capturée sans limite de preuve ni de risque. |
| Le rappel local et reproductible sans facture d’API de retrieval compte. | Il faut une recherche vectorielle cloud massive ou un graphe mondial temps réel. |
| Une mauvaise mémoire doit être traçable, rejetable et réversible. | Le volume prime sur la gouvernance. |

## <a name="documentation"></a><a name="research-lineage"></a>📚 Documentation

| Document | Contenu |
| --- | --- |
| [Architecture](../ARCHITECTURE.md) | Frontières, snapshots, confiance et livraison |
| [Technical design](../TECHNICAL.md) | Mécanismes, menaces et recherche |
| [Plugins](../PLUGINS.md) | Installation par host, plugins et étapes de confiance |
| [Updating](../UPDATING.md) | Mise à jour sûre et migrations de version |
| [Privacy](../PRIVACY.md) | Données locales et canaux optionnels |
| [Changelog](../../CHANGELOG.md) | Historique des versions |
| [Contributing](../../.github/CONTRIBUTING.md) | Signaler un problème et proposer des changements |
| [Security](../../.github/SECURITY.md) | Signaler une vulnérabilité |
| [License](../../LICENSE) | Apache-2.0 |

<details>
<summary><b>Filiation scientifique</b></summary>

OwnMem ne revendique pas ces fondations. Sa contribution est leur composition en protocole exécutable pour la mémoire de dépôt :

- **Mémoire agent et réflexion :** [Reflexion (NeurIPS 2023)](https://papers.neurips.cc/paper_files/paper/2023/hash/1b44b878bb782e6954cd888628510e90-Abstract-Conference.html), [MemGPT (2023)](https://arxiv.org/abs/2310.08560)
- **Empoisonnement de mémoire et de connaissances :** [AgentPoison (NeurIPS 2024)](https://proceedings.neurips.cc/paper_files/paper/2024/hash/eb113910e9c3f6242541c1652e30dfd6-Abstract-Conference.html), [PoisonedRAG (USENIX Security 2025)](https://www.usenix.org/conference/usenixsecurity25/presentation/zou-poisonedrag)
- **Données non fiables séparées de l’autorité :** [CaMeL: Defeating Prompt Injections by Design (2025)](https://arxiv.org/abs/2503.18813)
- **Provenance indépendante :** [in-toto (USENIX Security 2019)](https://www.usenix.org/conference/usenixsecurity19/presentation/torres-arias)
- **Prédiction sélective et abstention :** [Selective Classification (JMLR 2010)](https://jmlr.org/papers/v11/el-yaniv10a.html)
- **Validation par ablation :** [Metamorphic Testing (1998)](https://www.cse.ust.hk/~scc/publ/CS98-01-metamorphictesting.pdf)
- **Évaluation décomposée du retrieval :** [ARES (NAACL 2024)](https://aclanthology.org/2024.naacl-long.20/), [RAGChecker (2024)](https://arxiv.org/abs/2408.08067)

Ces citations indiquent une filiation ; elles ne signifient ni que ces travaux implémentent OwnMem ni qu’OwnMem reproduit leurs expériences.

</details>

OwnMem est open source. Les issues et pull requests reproductibles sont bienvenues.
