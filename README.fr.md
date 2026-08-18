<div align="center">

# OwnMem — Mémoire de projet native Git pour les agents de développement IA

**Dans le dépôt. Déterministe. Révisable.**

Un système de mémoire open source pour les agents IA dans les dépôts logiciels.<br>
Une mémoire de projet persistante pour Claude Code · Codex · Antigravity · Cursor · Gemini CLI · Grok CLI.

[![npm version](https://img.shields.io/npm/v/ownmem?style=flat-square&logo=npm&color=cb3837)](https://www.npmjs.com/package/ownmem)
[![node >= 20](https://img.shields.io/badge/node-%E2%89%A5%2020-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![license Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-1d7afc?style=flat-square)](./LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/grpcer/ownmem/ci.yml?branch=main&style=flat-square&logo=githubactions&logoColor=white&label=CI)](https://github.com/grpcer/ownmem/actions/workflows/ci.yml)
[![recall P95 2.46 ms](https://img.shields.io/badge/recall%20P95-2.46%20ms-8250df?style=flat-square)](#benchmarks)
[![model calls 0](https://img.shields.io/badge/model%20calls-0-8250df?style=flat-square)](#benchmarks)

[English](./README.md) · [简体中文](./README.zh-CN.md) · [繁體中文](./README.zh-TW.md) · [日本語](./README.ja.md) · [한국어](./README.ko.md) · [Español](./README.es.md) · **Français** · [Deutsch](./README.de.md) · [Português (BR)](./README.pt-BR.md)

</div>

## Qu’est-ce qu’OwnMem ?

OwnMem est un système de mémoire open source, local et natif de Git pour les
agents de développement IA. Il conserve les décisions, les contraintes et les
enseignements de débogage du projet sous forme de Markdown révisable dans le
dépôt. Cette mémoire de projet persistante fonctionne d'un agent et d'une
session à l'autre, voyage avec Git et se restaure avec le code qu'elle décrit.

Son moteur BM25F déterministe, adapté aux systèmes d'écriture Unicode, classe
la mémoire dans `.ownmem/`. À requête, configuration et instantané compilé
identiques, la recherche par défaut renvoie le même classement, sans appel de
modèle, requête réseau ni coût en tokens au moment de la recherche — environ
deux millisecondes dans le benchmark public.

OwnMem se compose de deux éléments. Le **paquet npm** est le moteur : il vit
dans chaque dépôt comme une `devDependency` révisée et gère la mémoire de ce dépôt
dans `.ownmem/`. Le **plugin d'agent** est une couche de confort optionnelle,
installée une fois par machine : elle apprend à votre agent à piloter le
moteur, y compris en vous guidant dans la configuration par dépôt.

> **Remarque :** un dépôt est prêt dès qu'il a le paquet et `.ownmem/`, peu
> importe le chemin suivi. Vous pouvez commencer par l'un ou l'autre élément.

## OwnMem en bref

| Attribut | Fait |
| --- | --- |
| Catégorie | Mémoire de projet appartenant au dépôt pour les agents de développement IA |
| Portée | Un dépôt |
| Stockage | Markdown révisable dans `.ownmem/`, versionné avec Git |
| Recherche par défaut | BM25F déterministe, **0 appel de modèle / 0 appel réseau** |
| Benchmark public | Benchmark synthétique figé de la v0.1.2 : **100 % de Recall@1**, **P95 de 2,46 ms** ; il ne mesure pas la précision auprès d'utilisateurs réels |
| Licence | Apache-2.0 |

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./assets/architecture-fr-dark.svg">
  <img alt="Architecture de bout en bout d'OwnMem, trois domaines de confiance : le dépôt contient du Markdown sélectionné qui passe les contrôles de gouvernance et se compile en un instantané immuable ; le moteur déterministe répond via six canaux candidats, un classement, un seuil de confiance et une enveloppe de 400 tokens ; l'agent de développement interroge, vérifie le code actuel et écrit de nouvelles leçons qui reviennent par audit et compile" src="./assets/architecture-fr-light.svg" width="100%">
</picture>

## Démarrage rapide

OwnMem nécessite Node.js 20 ou plus récent. Trois étapes, toutes dans le
dépôt auquel vous voulez donner une mémoire.

**Étape 1 — installez le moteur.** Il devient une `devDependency` normale,
révisée et épinglée comme n'importe quelle autre :

```bash
npm install --save-dev ownmem
```

**Étape 2 — initialisez ce dépôt.** Cela crée `.ownmem/` et les fichiers
adaptateurs pour chaque agent :

```bash
npx ownmem init --locale auto --hosts claude,codex --layers dashboard --hook
```

**Étape 3 — rouvrez votre agent.** Les agents découvrent les commandes au
démarrage de session, donc tout ce qui suit apparaît dans la session
suivante, pas dans celle qui a exécuté l'initialisation.

C'est la configuration recommandée — Claude Code et Codex sont prêts à
l'emploi, et la console locale est incluse. Voici ce dont vous disposez après
la réouverture :

- **Claude Code** gagne une commande de projet : `/ownmem <tout ce que vous
  voulez que la mémoire fasse>`.
- **Codex et Grok CLI** découvrent automatiquement la compétence `ownmem` du
  dépôt.
- **Antigravity** charge les mêmes instructions de projet (`AGENTS.md`,
  `GEMINI.md`) et suit donc lui aussi la discipline de mémoire — comme tout
  autre agent qui les lit.
- **La console** est une commande de terminal, pas une commande à barre oblique :
  `npx ownmem dashboard --open`. (Le plugin optionnel ci-dessous ajoute
  `/ownmem:dashboard`.)

Aucune commande de configuration n'est nécessaire au quotidien — travaillez
simplement comme d'habitude. Répétez les trois étapes une fois pour chaque
dépôt qui doit avoir sa propre mémoire.

Vous n'utilisez qu'un seul agent ? Remplacez `--hosts claude,codex` par
`--hosts claude` ou `--hosts codex`. Antigravity et Grok CLI lisent les
mêmes fichiers `AGENTS.md` (et, pour Grok, `.agents/skills/`) que Codex,
donc `--hosts codex` couvre les deux. Cursor utilise `--hosts cursor`, les
installations Gemini CLI classiques utilisent `--hosts gemini`, et
`--hosts generic` fonctionne avec les autres agents.

L'initialisation crée `.ownmem/` et ajoute une petite section OwnMem aux
instructions du projet. Elle ne modifie jamais le texte situé en dehors de ses
limites balisées.

## Usage quotidien

Après l'installation, il n'y a que deux choses à retenir.

**1. Parlez simplement à votre agent.** Lorsque vous apprenez quelque chose
qui mérite d'être conservé, dites-le avec vos mots :

> « Retiens ceci : le délai d'attente vient de la limite du pool de
> connexions, pas du nombre de processus. N'augmente jamais les processus
> sans augmenter le pool. »

Plus tard, posez votre question aussi naturellement que d'habitude :

> « Le déploiement de préproduction est encore bloqué. Consulte d'abord la mémoire
> du projet avant de modifier quoi que ce soit. »

L'agent s'occupe de l'écriture, de la validation et du rappel. Vous n'avez pas
besoin d'ouvrir `.ownmem/` ni d'exécuter vous-même `audit` ou `recall`. Vous
préférez une commande explicite ? `/ownmem <requête>` (Claude Code) et la
compétence `ownmem` (Codex) acheminent la même requête à travers la mémoire.

**2. Ouvrez la console quand vous voulez une vue d'ensemble.** Elle affiche
l'utilisation, la qualité du rappel, la latence et l'état de la mémoire de ce
dépôt, uniquement sur votre ordinateur via 127.0.0.1 :

```bash
npx ownmem dashboard --open
```

<img alt="OwnMem Console : entonnoir d'adoption, qualité du rappel, corpus et gouvernance, le tout en local" src="./assets/console.png" width="100%">

C'est tout pour l'usage quotidien. `audit`, le rappel manuel et les commandes
de retour servent à la CI et au diagnostic ; un utilisateur normal n'a pas
à les mémoriser.

## Pourquoi ce projet existe

Je développe Oriveo, un client IA multi-modèles BYOK pour iOS, Android, le Web et les ordinateurs de bureau — une base de code volumineuse sur laquelle je travaille chaque jour avec des agents de développement, en alternant entre Claude Code et Codex. Chaque dépôt accumulait des leçons durement acquises : causes profondes des erreurs, pièges de la chaîne d'outils et problèmes de synchronisation. À chaque changement d'agent, de machine ou de coéquipier, ces leçons disparaissaient en silence, parce qu'elles vivaient dans la mémoire d'un seul outil, sur une seule machine.

Les services de mémoire vectorielle ou dans le cloud ne m'ont jamais semblé adaptés ici : la connaissance d'un dépôt ne devrait exiger ni compte, ni serveur, ni facturation à la requête. La mémoire a donc rejoint le dépôt lui-même. OwnMem est le système que j'utilise chaque jour dans la base de code d'Oriveo — des centaines de mémoires soigneusement sélectionnées, tenues par des quotas et des audits — extrait et reconstruit en un moteur public propre.

## Pourquoi OwnMem

OwnMem fait quatre paris, et chaque décision de conception en découle :

- **La mémoire appartient au dépôt.** Du Markdown révisable qui voyage avec
  Git, apparaît dans les demandes de fusion et se rétablit comme n'importe quel
  autre code. Clonez le dépôt, la mémoire vient avec — pas de compte, pas de
  service de synchronisation, pas d'étape d'export.
- **La recherche doit être gratuite et déterministe.** La même requête renvoie le
  même classement, sans appel de modèle, sans taxe de latence, sans facture à
  la question : 100 % de Recall@1 avec un P95 de 2,46 ms sur le benchmark
  public figé.
- **La mémoire doit survivre à chaque outil pris isolément.** Les mêmes
  fichiers servent Claude Code, Codex, Antigravity, Cursor, Gemini CLI et Grok CLI, donc
  changer d'agent ne signifie jamais perdre ce que l'équipe a appris.
- **La mémoire doit rester petite pour rester digne de confiance.** Un quota à
  croissance nette nulle, un audit en Node pur, des contrôles anti quasi-doublons
  et anti-dérive la gardent concise et à jour, au lieu d'en faire un second
  wiki que personne n'élague.

### Ce qu'OwnMem n'est pas

- **Pas une base vectorielle.** Si vous voulez une recherche sémantique floue
  sur de grands ensembles de souvenirs, un service de mémoire vectorielle ou
  en graphe de connaissances conviendra mieux.
- **Pas de capture automatique.** Les écritures sont délibérées et curées —
  la revue est le contrôle de qualité. Les mémoires intégrées des agents sont
  plus commodes, au prix d'un verrouillage sur un outil et d'une absence de
  révisabilité.
- **Ni inter-dépôts, ni synchronisé dans le cloud.** La mémoire voyage avec
  l'historique git du dépôt lui-même : clonez le dépôt et elle est là. Mais
  elle n'est jamais partagée entre dépôts et ne transite jamais par un service
  de mémoire, par conception.

## À l'intérieur de `.ownmem/` : la mémoire à trois niveaux

La partie toujours chargée reste minuscule ; tout le reste est lu à la
demande :

| Niveau | Fichier | Quand il est lu |
| --- | --- | --- |
| **L1** | `MEMORY.md` | L'index — chargé au début de chaque session |
| **L2** | `MEMORY-<area>.md` | Sous-index par domaine — ouverts quand ce domaine est concerné |
| **L3** | un fichier par sujet | Une leçon par fichier — renvoyée par `recall` quand ses déclencheurs correspondent |

Un fichier de sujet est du Markdown pur avec des métadonnées initiales strictes validées par
schéma — symptômes et formulations dans `triggers`, preuves dans
`evidence` (extrait ; `ownmem init` génère un exemple complet) :

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

C'est cette structure qui rend le rappel gratuit : l'index est assez petit
pour rester chargé, et BM25F n'a qu'à classer de petits fichiers de sujet
bien étiquetés.

## Comment OwnMem se compare

Chaque colonne ci-dessous résout un vrai problème — le tableau montre les
compromis que fait chacune, les nôtres compris.

| | OwnMem | [Mem0 (OSS)](https://github.com/mem0ai/mem0) | [Zep / Graphiti](https://github.com/getzep/graphiti) | [claude-mem](https://github.com/thedotmack/claude-mem) | Mémoire auto intégrée¹ |
| --- | :---: | :---: | :---: | :---: | :---: |
| La mémoire vit dans votre dépôt, voyage avec Git et les demandes de fusion | ✅ | ❌ | ❌ | ❌ | ❌ |
| Markdown lisible et révisable par un humain | ✅ | ❌ | ❌ | ❌ | ⚠️² |
| Recall sans appel de modèle ni réseau | ✅ | ❌³ | ❌ | ❌ | — |
| Classement déterministe et reproductible | ✅ | ❌ | ❌ | ❌ | — |
| Une seule mémoire pour Claude Code, Codex, Antigravity, Cursor, Gemini CLI et Grok CLI | ✅ | ⚠️⁴ | ⚠️⁴ | ⚠️⁴ | ❌ |
| Maîtrise de la croissance (quota, audit, contrôles anti-dérive) | ✅ | ❌ | ❌ | ❌ | ⚠️⁵ |
| Recherche sémantique par paraphrase | ⚠️⁶ | ✅ | ✅ | ✅ | ❌ |
| Capture entièrement automatique | ❌⁷ | ✅ | ✅ | ✅ | ✅ |
| Mémoire inter-dépôts, au niveau utilisateur | ❌⁷ | ✅ | ✅ | ⚠️ | ❌ |

¹ Mémoire automatique de Claude Code et Memories de Codex : des fichiers sous
votre répertoire personnel — locaux à la machine, liés à l'outil,
hors du dépôt. Cursor a retiré Memories en 2.1 au profit des Rules ; les
mémoires de Windsurf restent locales à une machine et ne sont jamais
incluses dans un commit.
² Du Markdown éditable, mais il vit hors du dépôt et n'apparaît donc jamais
dans une demande de fusion.
³ La bibliothèque Apache-2.0 de Mem0 tourne en local, mais exige toujours un
LLM et un modèle d'embedding (une clé OpenAI par défaut, ou des modèles locaux
via Ollama) pour écrire et interroger la mémoire.
⁴ Via un serveur MCP ou sa propre API — la mémoire a une portée utilisateur
ou application, ce n'est pas un jeu de fichiers appartenant à votre dépôt.
⁵ Claude Code plafonne son index chargé en permanence (200 lignes / 25 KB) ;
derrière, il n'y a ni quota, ni audit, ni contrôle anti-doublons.
⁶ Voie d'embeddings optionnelle, désactivée par défaut ; elle ne rejoint le
classement qu'une fois vos preuves A/B locales validées par le contrôle de
sécurité.
⁷ Par conception. OwnMem parie sur des écritures curées et révisées et sur
une portée limitée à un dépôt ; si vous voulez une capture automatique ou une
mémoire au niveau utilisateur partagée entre applications, ces outils
conviennent sincèrement mieux.

Faits vérifiés en août 2026 sur la documentation publique de chaque projet :
[Mem0](https://docs.mem0.ai), [Zep / Graphiti](https://help.getzep.com/graphiti/getting-started/overview),
[claude-mem](https://github.com/thedotmack/claude-mem),
[mémoire automatique de Claude Code](https://code.claude.com/docs/en/memory),
[Codex memories](https://developers.openai.com/codex/memories),
[Cursor rules](https://cursor.com/docs/context/rules),
[Windsurf memories](https://docs.devin.ai/desktop/cascade/memories) — corrections bienvenues.

## Benchmarks

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./assets/benchmark-dark.svg">
  <img alt="Benchmark d'OwnMem : 100 % de Recall@1 contre 3,1 % pour un grep naïf, et une latence de recherche de 1,17 ms P50 / 2,46 ms P95 face à un seuil de publication de 5 ms" src="./assets/benchmark-light.svg" width="100%">
</picture>

Chaque version doit réussir un benchmark public figé : un corpus CC0 de
40 sujets couvrant 40 étiquettes de langue BCP 47 et 25 groupes d'écritures,
avec 128 requêtes positives et 40 négatives sans rapport. Les chiffres
ci-dessous proviennent d'une exécution apte à la publication (25 itérations
chronométrées par requête) :

| Métrique | Résultat | Critère de publication |
| --- | --- | --- |
| Recall@1 / Recall@5 (128 requêtes positives) | **100 % / 100 %** | = 100 % |
| MRR | **1,000** | = 1,000 |
| Abstention sur 40 requêtes sans rapport | **40 / 40** | = 100 % |
| Latence de recherche P50 / P95 (4 200 échantillons chronométrés) | **1,17 ms / 2,46 ms** | P95 ≤ 5 ms |
| Langues / écritures sous les mêmes portes | 40 étiquettes / 25 écritures | P95 par langue et par écriture ≤ 5 ms |
| Appels de modèle / appels réseau pendant la recherche | **0 / 0** | = 0 |
| Dépendances d'exécution | 2 (`ajv`, `yaml` — JS pur) | verrouillées |
| Mémoire supplémentaire pendant l'exécution (delta RSS) | < 2 MB | — |

Sur le même corpus, un grep de chaîne fixe insensible à la casse obtient
3,1 % de Recall@1. Rester lexical et déterministe n'est pas l'astuce en soi —
c'est le classement BM25F sensible aux systèmes d'écriture Unicode qui l'est.

Reproduisez-le vous-même :

```bash
git clone https://github.com/grpcer/ownmem
cd ownmem && npm ci && npm run benchmark
```

> **Remarque :** mesures réalisées sur un Apple M5 Pro avec Node 25. L'empreinte du corpus,
> les classements et les seuils sont figés, et l'exécution se répète avec
> l'ordre des sujets inversé pour prouver le déterminisme. Ces métriques
> synthétiques sont des preuves de régression, pas une prétention de précision
> en usage réel.

## Références

Rien dans les mathématiques du classement n'est inventé maison : chaque
technique du moteur est une méthode publiée et éprouvée. L'apport d'OwnMem est
de les combiner dans un moteur déterministe doté de deux petites dépendances
d'exécution en JavaScript pur :

| Dans OwnMem | Technique | Littérature |
| --- | --- | --- |
| Canal `bm25f` | BM25 pondéré par champs | Robertson & Zaragoza (2009), *[The Probabilistic Relevance Framework: BM25 and Beyond](https://doi.org/10.1561/1500000019)*; Robertson, Zaragoza & Taylor (2004), *[Simple BM25 extension to multiple weighted fields](https://doi.org/10.1145/1031171.1031181)* |
| Fusion des canaux et requêtes | Reciprocal Rank Fusion | Cormack, Clarke & Büttcher (2009), *[Reciprocal rank fusion outperforms Condorcet and individual rank learning methods](https://doi.org/10.1145/1571941.1572114)* |
| Diversité des résultats | Maximal Marginal Relevance | Carbonell & Goldstein (1998), *[The use of MMR, diversity-based reranking for reordering documents and producing summaries](https://doi.org/10.1145/290941.291025)* |
| Canal `ngram` | Similarité de n-grammes (Dice) | Dice (1945), *[Measures of the amount of ecologic association between species](https://doi.org/10.2307/1932409)* |
| Canal `fuzzy` | Distance d'édition bornée | Levenshtein (1966), *Binary codes capable of correcting deletions, insertions, and reversals*, Soviet Physics Doklady 10(8) |
| Contrôle anti-doublons | SimHash | Charikar (2002), *[Similarity estimation techniques from rounding algorithms](https://doi.org/10.1145/509907.509965)*; Manku, Jain & Das Sarma (2007), *[Detecting near-duplicates for web crawling](https://doi.org/10.1145/1242572.1242592)* |
| Contrôle anti-doublons | MinHash | Broder (1997), *[On the resemblance and containment of documents](https://doi.org/10.1109/SEQUEN.1997.666900)* |
| Tokenizer | Segmentation par écriture | *[UAX #24: Unicode Script Property](https://unicode.org/reports/tr24/)*; *[UAX #29: Unicode Text Segmentation](https://unicode.org/reports/tr29/)* |

## Installer le plugin d'agent (optionnel, une fois par machine)

**Faut-il l'installer ? Non — sans lui, tout fonctionne déjà.**
`ownmem init` a déjà écrit la discipline dans les instructions d'agent du
dépôt : tout agent qui ouvre le dépôt la suit. Le plugin apporte le confort à
l'échelle de la machine : il ajoute les trois mêmes compétences à tous les dépôts
de la machine — y compris ceux qui n'ont pas encore de
`.ownmem/`, où la compétence d'initialisation guide l'agent dans l'installation du moteur.
Ce dépôt fait aussi office de marketplace du plugin ; ses commandes ne font
que router vers `npx ownmem`, donc une mise à jour du plugin ne réécrit
jamais votre mémoire.

Un plugin, trois compétences, un seul jeu de noms :

| Compétence | Claude Code | Codex CLI | Rôle |
| --- | --- | --- | --- |
| `recall` | `/ownmem:recall` | `ownmem:recall` | Consulter la mémoire avant de modifier le code |
| `init` | `/ownmem:init` | `ownmem:init` | Installer ou mettre à jour OwnMem dans un dépôt |
| `dashboard` | `/ownmem:dashboard` | `ownmem:dashboard` | Ouvrir la console locale |

**Claude Code** — exécutez les deux commandes, dans l'ordre : la première
enregistre ce dépôt comme marketplace de plugins (nécessaire une seule fois),
la seconde y installe le plugin :

```
/plugin marketplace add grpcer/ownmem
/plugin install ownmem@ownmem
```

Redémarrez ensuite Claude Code : les commandes du plugin se chargent au
démarrage de session, elles apparaissent donc dans la session suivante, pas
dans celle qui les a installées. Activez la mise à jour automatique du
marketplace dans `/plugin` → Marketplaces pour recevoir les nouvelles versions
automatiquement.

**Codex CLI** — les deux mêmes étapes dans l'ordre : enregistrez le
marketplace, puis ajoutez le plugin :

```
codex plugin marketplace add grpcer/ownmem
codex plugin add ownmem@ownmem
```

Ici aussi, les compétences se chargent au démarrage de session ; retrouvez-les
dans le sélecteur `$`. Mettez-les ensuite à jour avec
`codex plugin marketplace upgrade ownmem` suivi de
`codex plugin add ownmem@ownmem`.

**Grok CLI** — là encore les deux commandes dans l'ordre : enregistrez le
marketplace, puis installez (Grok exige le `--trust` explicite). Sautez la
première commande si Grok a déjà importé vos marketplaces Claude Code :

```
grok plugin marketplace add grpcer/ownmem
grok plugin install ownmem@ownmem --trust
```

Cela installe les trois mêmes compétences. Quand un nom simple est déjà pris,
Grok lui ajoute un espace de noms — sa console intégrée fait de la
nôtre `/ownmem:dashboard`. Mettez à jour avec `grok plugin update ownmem`.

**Antigravity** — une seule commande, sans étape de marketplace :

```
agy plugin install https://github.com/grpcer/ownmem
```

Cela importe les compétences `ownmem`, `ownmem-init` et `ownmem-dashboard` ;
mettez à jour en réexécutant la même commande. (Les installations Gemini CLI
classiques — clé API, Vertex AI ou licence entreprise — peuvent toujours
installer le même dépôt avec
`gemini extensions install https://github.com/grpcer/ownmem`.)

## Mises à jour automatiques sûres

OwnMem est conçu pour des mises à jour de dépendances révisables, pas pour des
réécritures silencieuses en arrière-plan. Activez Dependabot ou Renovate pour
les dépendances npm. Quand il ouvre une demande de fusion pour la montée de version
d'OwnMem, la CI devrait exécuter ces trois commandes dans l'ordre :

```bash
npx ownmem init --update
npx ownmem init --check
npx ownmem audit
```

`init --update` ne rafraîchit que les limites gérées par OwnMem et préserve la
mémoire du projet. `init --check` échoue quand les adaptateurs générés
dérivent. Inclure `package-lock.json` dans les commits garde chaque agent et chaque tâche CI
sur la version révisée.

Pour une mise à jour manuelle, exécutez les quatre dans l'ordre :

```bash
npm install --save-dev ownmem@latest
npx ownmem init --update
npx ownmem init --check
npx ownmem audit
```

Évitez un `npx ownmem@latest` flottant dans les dépôts de production :
pratique pour un premier essai, mais il rend les exécutions non
reproductibles.

## Couches

Choisissez votre dose de machinerie — chaque couche contient la précédente :

| Couche | Ajoute |
| --- | --- |
| `core` | Initialisation, schéma strict, recherche BM25F adaptée aux systèmes d'écriture Unicode, fusion multi-requêtes déterministe, quota de croissance |
| `gates` | Audit en Node pur et contrôle anti quasi-doublons |
| `compiler` | Instantanés immuables, environnement d'exécution résident via stdio, point d'entrée Claude Code optionnel |
| `dashboard` | OwnMem Console et la voie optionnelle d'évaluation des embeddings |

Toutes les couches n'utilisent que les dépendances d'exécution en JavaScript pur
`ajv` et `yaml`. OwnMem Console embarque des catalogues complets pour
l'anglais, le chinois simplifié et traditionnel, le japonais, le coréen,
l'espagnol, le français, l'allemand, le portugais du Brésil, l'arabe, l'hindi,
l'indonésien, le russe, le thaï, le turc et le vietnamien.

## FAQ sur la mémoire des agents IA

### Qu'est-ce qu'un système de mémoire pour agents IA ?

Un tel système conserve des connaissances qu'un agent peut réutiliser d'une
tâche ou d'une session à l'autre. OwnMem applique ce principe aux dépôts
logiciels et garde des enseignements techniques révisés, pas l'historique des
conversations ni des profils utilisateur.

### Comment donner une mémoire de projet persistante à Claude Code ou Codex ?

Suivez le [démarrage rapide](#démarrage-rapide) une fois dans chaque dépôt,
puis rouvrez l'agent. Claude Code, Codex, Antigravity, Cursor, Gemini CLI et
Grok CLI peuvent alors lire les mêmes fichiers `.ownmem/`.

### Où la mémoire est-elle stockée et comment la partager en équipe ?

La mémoire est du Markdown brut sous `.ownmem/`. Ajoutez à Git les souvenirs
appropriés pour qu'ils suivent les mécanismes habituels de clonage, demande de
fusion, contrôle d'accès et restauration ; n'y placez aucun secret.

### OwnMem exige-t-il un LLM, une API d'embeddings, une base vectorielle ou le réseau ?

La recherche par défaut n'en exige aucun : elle est lexicale, locale et
n'utilise que deux petites dépendances d'exécution en JavaScript pur.
L'installation des paquets peut nécessiter le réseau ; la voie d'embeddings
optionnelle reste désactivée tant que les preuves A/B locales n'ont pas validé
son contrôle de sécurité.

### Quelle différence avec Mem0, Graphiti, claude-mem ou la mémoire intégrée ?

OwnMem est limité au dépôt, sélectionné, déterministe et révisable dans Git.
Ces alternatives conviennent mieux à la capture automatique, à la recherche
sémantique dans de grands volumes, à la mémoire utilisateur, aux graphes de
connaissances ou à la synchronisation cloud ; voir le [comparatif](#comment-ownmem-se-compare).

## Contribuer

Les tickets et demandes de fusion sont les bienvenus — voir
[CONTRIBUTING.md](./CONTRIBUTING.md) pour les règles de base : garder la
recherche par défaut déterministe, locale et sans modèle, ajouter un cas de
régression pour chaque changement de recherche, et lancer `npm test` puis
`npm run benchmark:release` avant de demander une revue. Les signalements de
sécurité passent par [SECURITY.md](./SECURITY.md).

## Sécurité et preuves

- Les fichiers de mémoire restent du Markdown inspectable dans le dépôt.
- Les contrôles de schéma, quota, limites générées et quasi-doublons s'exécutent en local.
- `recall.consumed` est l'étoile polaire de l'adoption ; Recall@K n'est qu'une métrique de processus.
- L'installation par défaut ne télécharge ni n'invoque jamais de modèle.
- La voie optionnelle d'embeddings reste hors du classement tant que les preuves A/B locales n'ont pas validé le contrôle de sécurité.

OwnMem est sous licence Apache-2.0. Consultez `PRIVACY.md`, `SECURITY.md` et
`RELEASE.md` avant de partager des artefacts ou de publier une version.

## Remerciements

- [LINUX DO](https://linux.do/)
