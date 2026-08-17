<div align="center">

# OwnMem

**Dein Projekt. Sein eigenes Gedächtnis.**

Lokales, deterministisches, git-natives Gedächtnis für Coding Agents.<br>
Ein Satz Dateien bedient Claude Code · Codex · Gemini CLI · Cursor · Grok CLI.

[![npm version](https://img.shields.io/npm/v/ownmem?style=flat-square&logo=npm&color=cb3837)](https://www.npmjs.com/package/ownmem)
[![node >= 20](https://img.shields.io/badge/node-%E2%89%A5%2020-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![license Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-1d7afc?style=flat-square)](./LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/grpcer/ownmem/ci.yml?branch=main&style=flat-square&logo=githubactions&logoColor=white&label=CI)](https://github.com/grpcer/ownmem/actions/workflows/ci.yml)
[![recall P95 2.46 ms](https://img.shields.io/badge/recall%20P95-2.46%20ms-8250df?style=flat-square)](#benchmarks)
[![model calls 0](https://img.shields.io/badge/model%20calls-0-8250df?style=flat-square)](#benchmarks)

[English](./README.md) · [简体中文](./README.zh-CN.md) · [日本語](./README.ja.md) · [한국어](./README.ko.md) · [Español](./README.es.md) · [Français](./README.fr.md) · **Deutsch** · [Português (BR)](./README.pt-BR.md)

</div>

OwnMem gibt Claude Code, Codex und anderen Coding Agents ein Gedächtnis, das
im Repository selbst lebt: schlichtes Markdown in `.ownmem/`, gerankt von
einer deterministischen, Unicode-Schriftsystem-bewussten BM25F-Engine. Recall
ruft nie ein Modell auf, berührt nie das Netzwerk und verbraucht kein einziges
Token zur Abfragezeit — dieselbe Frage liefert dieselbe Antwort, in rund zwei
Millisekunden.

OwnMem besteht aus zwei Teilen. Das **npm-Paket** ist der Motor: Es lebt in
jedem Repository als geprüfte `devDependency` und verwaltet das Gedächtnis
dieses Repositories in `.ownmem/`. Das **Agent-Plugin** ist eine optionale
Komfortschicht, einmal pro Maschine installiert: Es bringt deinem Agent bei,
den Motor zu bedienen — einschließlich der Begleitung durch die Einrichtung
pro Repository.

> **Hinweis:** Ein Repository ist bereit, sobald es das Paket und `.ownmem/`
> hat — egal, auf welchem Weg. Beginne mit einem der beiden Teile.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./assets/architecture-de-dark.svg">
  <img alt="OwnMem-Architektur von Ende zu Ende, drei Vertrauensdomänen: Das Repository hält kuratiertes Markdown, das Governance-Gates passiert und zu einem unveränderlichen Snapshot kompiliert wird; die deterministische Engine antwortet über sechs Kandidatenkanäle, Ranking, ein Konfidenztor und einen 400-Token-Umschlag; der Coding Agent fragt, prüft gegen aktuellen Code und schreibt neue Lektionen, die über audit und compile zurückfließen" src="./assets/architecture-de-light.svg" width="100%">
</picture>

## Schnellstart

OwnMem benötigt Node.js 20 oder neuer. Führe im Repository, das sich seinen
eigenen Kontext merken soll, Folgendes aus:

```bash
npm install --save-dev ownmem
npx ownmem init --locale auto --hosts claude,codex --layers dashboard --hook
```

Das ist die empfohlene, unkomplizierte Einrichtung: Claude Code und Codex
funktionieren sofort, die lokale Konsole ist ebenfalls dabei. Öffne deinen
Agenten nach der Initialisierung neu und arbeite danach wie gewohnt — im Alltag
musst du keinen weiteren Einrichtungsbefehl ausführen.

Du nutzt nur einen Agenten? Ersetze `--hosts claude,codex` durch
`--hosts claude` oder `--hosts codex`. Gemini CLI und Cursor werden mit
`--hosts gemini,cursor` unterstützt; für andere Agenten gibt es
`--hosts generic`.

Die Initialisierung erstellt `.ownmem/` und ergänzt die Projektanweisungen des
Agenten um einen kleinen OwnMem-Abschnitt. Text außerhalb der markierten
Grenzen bleibt unverändert.

## Täglicher Gebrauch

Nach der Einrichtung musst du dir nur zwei Dinge merken.

**1. Sprich einfach mit deinem Agenten.** Wenn du etwas lernst, das später
nützlich sein könnte, sag es in ganz normalen Worten:

> „Merk dir das — der Timeout kommt vom Pool-Limit, nicht von der
> Worker-Zahl. Nie die Worker erhöhen, ohne den Pool zu erhöhen."

Später fragst du so natürlich wie immer:

> „Das Staging-Deployment hängt wieder. Prüfe zuerst den Projektspeicher,
> bevor du etwas änderst."

Der Agent kümmert sich um Schreiben, Prüfen und Abrufen. Du musst weder
`.ownmem/` öffnen noch selbst `audit` oder `recall` ausführen.

**2. Öffne die Konsole, wenn du einen Überblick möchtest.** Sie zeigt
Nutzung, Recall-Qualität, Latenz und Zustand des Speichers für dieses
Repository und ist nur auf deinem Computer unter 127.0.0.1 erreichbar:

```bash
npx ownmem dashboard --open
```

<img alt="OwnMem Console — Adoptions-Funnel, Recall-Qualität, Korpus und Governance, alles lokal" src="./assets/console.png" width="100%">

Das ist der gesamte Alltagsablauf. `audit`, manuelles `recall` und die
Feedback-Befehle sind für CI und Fehlersuche gedacht; normale Nutzer müssen
sie sich nicht merken.

## Wie OwnMem entstanden ist

Ich baue Oriveo, einen BYOK-Multi-Modell-AI-Client für iOS, Android, Web und Desktop — eine große Codebasis, an der ich täglich mit Coding-Agents arbeite und dabei zwischen Claude Code und Codex wechsle. In jedem Repository sammelten sich hart erarbeitete Lektionen an: Debugging-Ursachen, Toolchain-Fallen, Timing-Races. Und bei jedem Wechsel von Agent, Maschine oder Teamkollege gingen sie leise verloren, weil sie im Gedächtnis eines einzelnen Tools auf einer einzelnen Maschine lebten.

Vektor- und Cloud-Memory-Dienste fühlten sich dafür nie richtig an: Wissen über ein Repository sollte weder ein Konto noch einen Server noch eine Abrechnung pro Abfrage brauchen. Also zog das Gedächtnis ins Repository selbst. OwnMem ist das System, das ich täglich in der Oriveo-Codebasis betreibe — hunderte kuratierte Erinnerungen, durch Quoten und Audits in Form gehalten — herausgelöst und als saubere, öffentliche Engine neu aufgebaut.

## Warum OwnMem

OwnMem geht vier Wetten ein, und jede Design-Entscheidung folgt aus ihnen:

- **Gedächtnis gehört ins Repository.** Überprüfbares Markdown, das mit git
  reist, in Pull Requests erscheint und wie jeder andere Code zurückgerollt
  werden kann. Repo klonen, Gedächtnis dabei — kein Konto, kein Sync-Dienst,
  kein Export-Schritt.
- **Recall muss kostenlos und deterministisch sein.** Dieselbe Abfrage
  liefert dasselbe Ranking — ohne Modellaufruf, ohne Latenzsteuer, ohne
  Rechnung pro Frage: 100 % Recall@1 bei einem P95 von 2.46 ms im gesperrten
  öffentlichen Benchmark.
- **Gedächtnis muss jedes einzelne Tool überleben.** Dieselben Dateien
  bedienen Claude Code, Codex, Gemini CLI, Cursor und Grok CLI — ein
  Agentenwechsel bedeutet also nie, das Gelernte des Teams zu verlieren.
- **Gedächtnis muss klein bleiben, um vertrauenswürdig zu bleiben.** Eine
  Quote mit null Nettowachstum, ein reines Node-Audit sowie Beinahe-Duplikat-
  und Drift-Gates halten es schlank und aktuell, statt es zu einem zweiten
  Wiki werden zu lassen, das niemand beschneidet.

### Was OwnMem nicht ist

- **Keine Vektordatenbank.** Wer unscharfe semantische Suche über große
  Gedächtnisbestände will, ist mit einem Vektor- oder
  Wissensgraph-Gedächtnisdienst besser bedient.
- **Keine automatische Erfassung.** Schreibvorgänge sind bewusst und
  kuratiert — das Review ist das Qualitäts-Gate. Eingebaute
  Agent-Gedächtnisse sind bequemer, um den Preis von Tool-Bindung und
  fehlender Überprüfbarkeit.
- **Nicht repository-übergreifend, nicht cloud-synchronisiert.** Das
  Gedächtnis reist mit der Git-Historie des Repositories — wer das Repository
  klont, hat es. Es wird aber nie über Repositories hinweg geteilt und läuft
  nie durch einen Gedächtnisdienst — mit Absicht.

## Ein Blick in `.ownmem/`: das dreistufige Gedächtnis

Der immer geladene Teil bleibt winzig; alles andere wird bei Bedarf gelesen:

| Stufe | Datei | Wann sie gelesen wird |
| --- | --- | --- |
| **L1** | `MEMORY.md` | Der Index — wird zu Beginn jeder Session geladen |
| **L2** | `MEMORY-<area>.md` | Bereichs-Subindizes — geöffnet, wenn der Bereich berührt wird |
| **L3** | eine Datei pro Topic | Eine Lektion pro Datei — von `recall` geliefert, wenn ihre Trigger passen |

Eine Topic-Datei ist reines Markdown mit striktem, schema-geprüftem
Frontmatter — Symptome und Formulierungen in `triggers`, Belege in
`evidence` (hier gekürzt; `ownmem init` legt ein vollständiges Beispiel
an):

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

Genau diese Struktur macht Recall kostenlos: Der Index ist klein genug, um
immer geladen zu bleiben, und BM25F muss nur kleine, gut beschriftete
Topic-Dateien ranken.

## OwnMem im Vergleich

Jede Spalte unten löst ein echtes Problem — die Tabelle zeigt, welche
Kompromisse die jeweilige Lösung eingeht, unsere eingeschlossen.

| | OwnMem | [Mem0 (OSS)](https://github.com/mem0ai/mem0) | [Zep / Graphiti](https://github.com/getzep/graphiti) | [claude-mem](https://github.com/thedotmack/claude-mem) | Eingebautes Auto-Gedächtnis¹ |
| --- | :---: | :---: | :---: | :---: | :---: |
| Gedächtnis lebt in deinem Repo, reist mit git und PRs | ✅ | ❌ | ❌ | ❌ | ❌ |
| Menschenlesbares, überprüfbares Markdown | ✅ | ❌ | ❌ | ❌ | ⚠️² |
| Recall ohne Modell- oder Netzwerkaufrufe | ✅ | ❌³ | ❌ | ❌ | — |
| Deterministisches, reproduzierbares Ranking | ✅ | ❌ | ❌ | ❌ | — |
| Ein Gedächtnis über Claude Code, Codex, Gemini CLI, Cursor, Grok CLI hinweg | ✅ | ⚠️⁴ | ⚠️⁴ | ⚠️⁴ | ❌ |
| Anti-Bloat-Governance (Wachstumsquote, Audit, Drift-Gates) | ✅ | ❌ | ❌ | ❌ | ⚠️⁵ |
| Semantische Paraphrasensuche | ⚠️⁶ | ✅ | ✅ | ✅ | ❌ |
| Vollautomatische Erfassung | ❌⁷ | ✅ | ✅ | ✅ | ✅ |
| Repository-übergreifendes Gedächtnis auf Nutzerebene | ❌⁷ | ✅ | ✅ | ⚠️ | ❌ |

¹ Claude Code Auto-Memory und Codex Memories: Dateien in deinem
Home-Verzeichnis — maschinenlokal, tool-gebunden, außerhalb des Repositories.
Cursor hat Memories in 2.1 zugunsten von Rules eingestellt; Windsurf-Memories
bleiben auf einer Maschine und werden nie committet.
² Editierbares Markdown, das aber außerhalb des Repos liegt und deshalb nie
in einem Pull Request auftaucht.
³ Mem0s Apache-2.0-Bibliothek läuft lokal, benötigt aber trotzdem ein LLM und
ein Embedding-Modell (standardmäßig einen OpenAI-Key, oder lokale Modelle via
Ollama), um Gedächtnis zu schreiben und abzufragen.
⁴ Über einen MCP-Server oder eine eigene API — das Gedächtnis ist nutzer-
oder app-bezogen, kein Satz Dateien, der deinem Repository gehört.
⁵ Claude Code deckelt seinen ständig geladenen Index (200 Zeilen / 25 KB);
dahinter steht keine Quote, kein Audit, kein Duplikat-Gate.
⁶ Optionale Embedding-Spur, standardmäßig aus; sie fließt erst ins Ranking
ein, wenn deine lokalen A/B-Belege das Sicherheits-Gate bestehen.
⁷ Mit Absicht. OwnMem setzt auf kuratierte, geprüfte Schreibvorgänge und den
Ein-Repository-Zuschnitt; wer automatische Erfassung oder app-übergreifendes
Gedächtnis auf Nutzerebene will, ist mit diesen Tools tatsächlich besser
bedient.

Fakten geprüft im August 2026 gegen die öffentliche Dokumentation der
Projekte: [Mem0](https://docs.mem0.ai), [Zep / Graphiti](https://help.getzep.com/graphiti/getting-started/overview),
[claude-mem](https://github.com/thedotmack/claude-mem),
[Claude-Code-Auto-Memory](https://code.claude.com/docs/en/memory),
[Codex memories](https://developers.openai.com/codex/memories),
[Cursor rules](https://cursor.com/docs/context/rules),
[Windsurf memories](https://docs.devin.ai/desktop/cascade/memories) — Korrekturen willkommen.

## Benchmarks

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./assets/benchmark-dark.svg">
  <img alt="OwnMem-Benchmark: 100 % Recall@1 gegenüber 3.1 % bei naivem grep, Recall-Latenz 1.17 ms P50 / 2.46 ms P95 bei einem Release-Gate von 5 ms" src="./assets/benchmark-light.svg" width="100%">
</picture>

Jedes Release muss ein gesperrtes öffentliches Benchmark bestehen: ein
CC0-Korpus mit 40 Themen über 40 BCP-47-Sprachtags und 25
Schriftsystemgruppen, mit 128 positiven Abfragen und 40 themenfremden
Negativen. Die Zahlen unten stammen aus einem Lauf in Release-Qualität
(25 gemessene Iterationen pro Abfrage):

| Metrik | Ergebnis | Release-Gate |
| --- | --- | --- |
| Recall@1 / Recall@5 (128 positive Abfragen) | **100 % / 100 %** | = 100 % |
| MRR | **1.000** | = 1.000 |
| Enthaltung bei 40 themenfremden Abfragen | **40 / 40** | = 100 % |
| Recall-Latenz P50 / P95 (4,200 gemessene Stichproben) | **1.17 ms / 2.46 ms** | P95 ≤ 5 ms |
| Sprachen / Schriftsysteme unter denselben Gates | 40 Tags / 25 Schriftsysteme | P95 pro Sprache & pro Schriftsystem ≤ 5 ms |
| Modellaufrufe / Netzwerkaufrufe während des Recalls | **0 / 0** | = 0 |
| Laufzeitabhängigkeiten | 2 (`ajv`, `yaml` — reines JS) | gesperrt |
| Zusätzlicher Speicher während des Laufs (RSS-Delta) | < 2 MB | — |

Auf demselben Korpus erreicht ein case-insensitives Fixed-String-grep 3.1 %
Recall@1. Lexikalisch und deterministisch zu bleiben ist für sich genommen
noch nicht der Trick — das Unicode-Schriftsystem-bewusste BM25F-Ranking ist
es.

Reproduziere es selbst:

```bash
git clone https://github.com/grpcer/ownmem
cd ownmem && npm ci && npm run benchmark
```

> **Hinweis:** Gemessen auf einem Apple M5 Pro mit Node 25. Korpus-Hash,
> Rankings und Schwellwerte sind gesperrt, und der Lauf wird mit umgekehrter
> Themenreihenfolge wiederholt, um Determinismus zu beweisen. Diese
> synthetischen Metriken sind Regressionsbelege, keine Behauptung über die
> Genauigkeit bei echten Nutzern.

## Agent-Plugin installieren (optional, einmal pro Maschine)

**Musst du es installieren? Nein — auch ohne funktioniert alles.**
`ownmem init` hat die Disziplin bereits in die Agent-Anweisungen des
Repositories geschrieben; jeder Agent, der das Repository öffnet, folgt ihr.
Das Plugin ist Komfort auf Maschinenebene: Es bringt `/ownmem:recall` und
`/ownmem:init` in jedes Repository der Maschine — auch in solche ohne
`.ownmem/`, wo der init-Skill den Agenten durch die Engine-Einrichtung
führt. Dieses Repository ist zugleich der Plugin-Marketplace; die
Plugin-Befehle routen nur zu `npx ownmem`, ein Plugin-Update schreibt dein
Gedächtnis also nie um.

Claude Code:

```
/plugin marketplace add grpcer/ownmem
/plugin install ownmem@ownmem
```

Das fügt die Befehle `/ownmem:recall` und `/ownmem:init` samt ihrer
modell-ausgelösten Skills hinzu. Aktiviere die automatische Aktualisierung
des Marketplace unter `/plugin` → Marketplaces, um neue Versionen automatisch
zu erhalten.

Codex CLI:

```
codex plugin marketplace add grpcer/ownmem
codex plugin add ownmem@ownmem
```

Das installiert die Skills `$ownmem` und `$ownmem-init`. Später aktualisieren
mit `codex plugin marketplace upgrade ownmem`.

Gemini CLI:

```
gemini extensions install https://github.com/grpcer/ownmem
```

Das fügt den Befehl `/ownmem` und dieselben zwei Skills hinzu. Aktualisieren
mit `gemini extensions update ownmem`.

## Sichere automatische Updates

OwnMem ist für überprüfbare Abhängigkeits-Updates gebaut, nicht für stilles
Umschreiben im Hintergrund. Aktiviere Dependabot oder Renovate für
npm-Abhängigkeiten. Öffnet eines davon einen OwnMem-Upgrade-Pull-Request,
sollte die CI Folgendes ausführen:

```bash
npx ownmem init --update
npx ownmem init --check
npx ownmem audit
```

`init --update` erneuert nur die von OwnMem verwalteten Grenzen und bewahrt
das Projektgedächtnis. `init --check` schlägt fehl, wenn generierte Adapter
abdriften. Das Committen von `package-lock.json` hält jeden Agent und jeden
CI-Job auf der geprüften Version.

Für ein manuelles Update:

```bash
npm install --save-dev ownmem@latest
npx ownmem init --update
npx ownmem init --check
npx ownmem audit
```

Vermeide ein schwebendes `npx ownmem@latest` in Produktions-Repositories: für
den ersten Blick bequem, macht es Ausführungen aber nicht reproduzierbar.

## Schichten

Wähle selbst, wie viel Maschinerie du willst — jede Schicht enthält die
vorherige:

| Schicht | Fügt hinzu |
| --- | --- |
| `core` | Initialisierung, striktes Schema, Unicode-Schriftsystem-bewusster BM25F-Recall, deterministische Mehrfachabfrage-Fusion, Wachstumsquote |
| `gates` | Reines Node-Audit und Beinahe-Duplikat-Gate |
| `compiler` | Unveränderliche Snapshots, residente stdio-Laufzeit, optionaler Claude-Code-Hook |
| `dashboard` | OwnMem Console und die optionale Embedding-Evaluationsspur |

Alle Schichten nutzen ausschließlich die reinen
JavaScript-Laufzeitabhängigkeiten `ajv` und `yaml`. Die OwnMem Console
liefert vollständige Kataloge für Englisch, vereinfachtes und traditionelles
Chinesisch, Japanisch, Koreanisch, Spanisch, Französisch, Deutsch,
brasilianisches Portugiesisch, Arabisch, Hindi, Indonesisch, Russisch, Thai,
Türkisch und Vietnamesisch.

## Mitwirken

Issues und Pull Requests sind willkommen — die Grundregeln stehen in
[CONTRIBUTING.md](./CONTRIBUTING.md): den Standard-Recall deterministisch,
lokal und modellfrei halten, für jede Retrieval-Änderung einen
Regressionsfall ergänzen und vor dem Review `npm test` sowie
`npm run benchmark:release` ausführen. Sicherheitsmeldungen laufen über
[SECURITY.md](./SECURITY.md).

## Sicherheit und Belege

- Gedächtnisdateien bleiben inspizierbares Markdown im Repository.
- Schema-, Quoten-, Beinahe-Duplikat-Prüfungen und die Prüfung generierter Grenzen laufen lokal.
- `recall.consumed` ist der Nordstern der Adoption; Recall@K ist eine Prozessmetrik.
- Die Standardinstallation lädt niemals ein Modell herunter und ruft keines auf.
- Die optionale Embedding-Spur bleibt aus dem Ranking, bis lokale A/B-Belege ihr Sicherheits-Gate bestehen.

OwnMem ist unter Apache-2.0 lizenziert. Lies `PRIVACY.md`, `SECURITY.md` und
`RELEASE.md`, bevor du Artefakte teilst oder ein Release veröffentlichst.
