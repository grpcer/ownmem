<div align="center">

# OwnMem

**Git-natives Gedächtnis für KI-Coding-Agents**

Projektgedächtnis für Coding Agents im Repository: lokal, deterministisch, reviewbar und nie ohne deinen Commit geschrieben.

[![npm version](https://img.shields.io/npm/v/ownmem?style=flat-square&logo=npm&color=cb3837)](https://www.npmjs.com/package/ownmem)
[![npm downloads](https://img.shields.io/npm/dm/ownmem?style=flat-square&logo=npm&color=555)](https://www.npmjs.com/package/ownmem)
[![GitHub stars](https://img.shields.io/github/stars/grpcer/ownmem?style=flat-square&logo=github&color=e3b341)](https://github.com/grpcer/ownmem/stargazers)
[![release gates](https://img.shields.io/github/actions/workflow/status/grpcer/ownmem/ci.yml?branch=main&style=flat-square&label=release%20gates)](https://github.com/grpcer/ownmem/actions/workflows/ci.yml)
[![node >= 20.6](https://img.shields.io/badge/node-%E2%89%A5%2020.6-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![license Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-1d7afc?style=flat-square)](../../LICENSE)

[English](../../README.md) · [简体中文](./README.zh-CN.md) · [繁體中文](./README.zh-TW.md) · [日本語](./README.ja.md) · [한국어](./README.ko.md) · [Español](./README.es.md) · [Français](./README.fr.md) · **Deutsch** · [Português (BR)](./README.pt-BR.md)

</div>

## <a name="why-ownmem"></a>✨ Warum OwnMem

Die meisten Memory-Systeme optimieren „mehr erinnern“. OwnMem fragt zuerst: **Wem gehört Projektwissen, wer darf es ändern und wie stoppen wir eine falsche Erinnerung, bevor sie Agent-Aktionen beeinflusst?**

| Vorteil | Praktische Bedeutung |
| --- | --- |
| **Das Repository besitzt das Memory** | Lesbares Markdown in `.ownmem/` reist beim Clone, Review und Rollback mit dem Code, und jeder Agent im Repository liest dieselbe Quelle. |
| **Deterministischer lokaler Recall** | Kein Modell, kein Netzwerk; gleiche Query, Config und Snapshot ergeben dieselbe Rangfolge. |
| **Evidenz vor Autorität** | Text kann sich nicht selbst vertrauenswürdig nennen; unabhängige Receipts und Live-Prüfung entscheiden. |
| **Es sagt, wenn es nichts weiß** | Die Auslieferung ist abgestuft: die zitierte Erinnerung, bis zu drei Verweise, oder eine Enthaltung mit dem Gate, das abgelehnt hat. |
| **Netto-Null-Wachstum** | Die Anzahl der Einträge kann nur sinken: Wer einem vollen Korpus etwas hinzufügt, mustert im selben Schritt etwas aus. |

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/benchmark-dark.svg">
  <img alt="Öffentlicher OwnMem-Benchmark: Recall@1 von 100 % bei 128 Abfragen in 40 Sprachen, gegenüber 3,9 % für grep -F auf demselben Korpus; Abruflatenz 0,46 ms (P50) und 1,05 ms (P95) aus 4.200 Stichproben, unter dem Release-Gate von 5 ms; MRR 1,000, Enthaltung bei allen 40 themenfremden Abfragen, keine Modell- oder Netzwerkaufrufe, zwei Laufzeitabhängigkeiten." src="../assets/benchmark-light.svg" width="100%">
</picture>

<sub>Gemessen auf dem festgeschriebenen CC0-Korpus dieses Repositorys. Reproduzierbar in einem Klon mit `npm run benchmark`.</sub>

## <a name="how-it-compares"></a><a name="how-this-differs-from-claudemd-and-built-in-memory"></a>🆚 Im Vergleich

OwnMem ersetzt weder `CLAUDE.md` noch `AGENTS.md`. Diese Dateien sagen, wie hier gearbeitet wird, und werden in jedem Turn vollständig gelesen. OwnMem beantwortet eine andere Frage: Was von dem, was dieses Projekt schmerzhaft gelernt hat, gehört **für diese Aufgabe** vor das Modell — und es darf „nichts davon“ antworten.

|  | Anweisungsdateien | Eingebautes Agent-Gedächtnis | OwnMem |
| --- | --- | --- | --- |
| Wer schreibt es | du, von Hand | der Agent, aus euren Gesprächen | du, reviewt wie Code |
| Wo es liegt | eine Datei im Repository | im Konto des Anbieters | Markdown in deinem Repository |
| Was beim Modell ankommt | alles, in jedem Turn | was sein eigener Recall ausgewählt hat | eine von drei Stufen, innerhalb eines Token-Budgets |
| Wenn ein Eintrag falsch ist | du änderst die Datei | du siehst den Eintrag womöglich nie | Evidenzdrift stuft ihn herab und nennt, was sich bewegt hat |
| Kosten pro Turn | die ganze Datei in Tokens | ein Retrieval-Aufruf | kein Modellaufruf, kein Netzwerk |

## <a name="quick-start"></a>🚀 Schnellstart

Erfordert Node.js 20.6 oder neuer. Im Repository ausführen, das das Memory besitzen soll:

```bash
npm install --save-dev ownmem
npx ownmem init --hook --hosts claude,codex
```

Öffne danach den Agenten neu. Nenne in `--hosts` die Hosts, die du nutzt (`claude`, `codex`, `cursor`, `gemini`, `grok`); die Liste wird gespeichert, und willst du später einen Host hinzufügen oder entfernen, übergib sie einfach erneut. `init` legt `.ownmem/` und die Host-Adapter an, ändert Anweisungsdateien wie `CLAUDE.md` nur innerhalb verwalteter Blöcke und gibt jeden einmaligen Schritt aus, der einem Host noch fehlt. Mit `--check` am selben Befehl siehst du vorab, was passiert; mit `--locale auto` werden die generierten Anweisungen in deiner Systemsprache geschrieben.

| Host | Wie der Abruf ausgelöst wird | Einrichtung |
| --- | --- | --- |
| Claude Code | Ein Hook vor jedem Edit und Write, dazu auf Anfrage | `claude` |
| Codex | Ein Hook vor jedem Patch, den Codex anwendet, dazu auf Anfrage | `codex`; die Hooks brauchen drei einmalige Vertrauensschritte, die `init` ausgibt |
| Grok CLI | Liest die Hook-Konfiguration von Claude Code über seine Kompatibilitätsschicht | `grok`, zusammen mit `claude`, wenn du beide nutzt; markiere den Ordner einmal mit `/hooks-trust` als vertrauenswürdig |
| Cursor | Eine immer aktive Regel oder der MCP-Server | `cursor`; der MCP-Server braucht einen manuellen Schritt, siehe [Plugins](../PLUGINS.md) |
| Gemini CLI | Anweisungen oder der MCP-Server | `gemini`; der MCP-Server braucht einen manuellen Schritt, siehe [Plugins](../PLUGINS.md) |

> **⚠️ Update von 0.6.0?** Aktualisiere das Paket mit `npm install --save-dev ownmem@latest` und führe dann vor allem anderen `npx ownmem init --update` aus. 0.6.0 hat Hooks installiert, deren Unterbefehle es nicht mehr gibt; eine Installation, die sie behält, startet bei jedem Bash-Aufruf einen fehlschlagenden Befehl. Das Update entfernt sie und rührt selbst geschriebene Hooks nie an. [Updating](../UPDATING.md) beschreibt den Rest, einschließlich des Aufräumens von `core.hooksPath`.

## <a name="daily-use"></a>💬 Tägliche Nutzung

Arbeite einfach in normaler Sprache weiter. Dein Agent entwirft eine Erinnerung, wenn du darum bittest, und du prüfst sie wie Code:

> „Merke dir: Das Staging-Timeout kommt vom Pool-Cap, nicht von zu wenigen Workern. Prüfe nächstes Mal beides.“

> „Bevor du das änderst, prüfe, ob das Projektgedächtnis denselben Fehler kennt.“

Der Abruf antwortet in einer von drei Stufen: die zitierte Erinnerung, bis zu drei Verweise zum Nachlesen oder eine Enthaltung. Ein echter Lauf:

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

Vertrauen wird ausgewiesen, nicht unterstellt. Diesen Eintrag stützt noch nichts – kein Review hat ihn bestätigt, und er verweist weder auf ein Autoritätsdokument noch auf einen Code-Anker –, deshalb kommt er als Hinweis zum Nachprüfen an, nicht als feststehende Tatsache.

Die Befehle, die du selbst brauchst:

```bash
npx ownmem new staging_timeout_pool_cap   # scaffold one memory that already passes every gate
npx ownmem report --since 7d              # used? fast enough? right? what to do next
npx ownmem dashboard --open               # open the local console
npx ownmem mcp                            # serve recall and read to any MCP host over stdio
```

<img alt="Die lokale OwnMem-Konsole: der bekannte Rest an Fehlauslieferungen als Leitkennzahl, daneben der Abruftrichter, darunter der Zustand von Korpus und Evidenz, dazu die Navigation zu Leistung, Qualität, Governance und semantischem Abruf." src="../assets/console.png" width="100%">

`ownmem mcp` ist für Hosts ohne Hooks gedacht. Er bietet genau zwei Werkzeuge, `recall` und `read`, und keines kann eine Erinnerung ändern; die Gate-Befehle (`audit`, `trust`, `compile`) und alle Schreibvorgänge am Gedächtnis sind über diese Schnittstelle nicht erreichbar. Wie du ihn so registrierst, dass die im Projekt installierte Kopie läuft, steht unter [Plugins](../PLUGINS.md).

## <a name="how-it-works"></a><a name="architecture"></a><a name="how-ownmem-governs-ai-agent-memory"></a>🧩 So funktioniert es

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/architecture-de-dark.svg">
  <img alt="OwnMem-Architektur: Repository-eigenes Markdown und unabhängige Trust Receipts werden zu unveränderlichen Snapshots kompiliert; deterministischer lokaler Recall passiert vier Auslieferungstore und kommt in einer von drei Stufen an — die zitierte Erinnerung, bis zu drei Verweise oder eine Enthaltung mit Begründung — während lokale Feedback-Register, ein Evaluationsstand und eine Netto-Null-Quote begrenzen, wozu der Korpus wird." src="../assets/architecture-de-light.svg" width="100%">
</picture>

- **Das Repository ist die Quelle.** L1-Routing, L2-Indizes und L3-Topics sind reviewbares Markdown; Trust Receipts stehen außerhalb des autorisierten Textes.
- **Erst kompilieren, dann erinnern.** Schema-, Graph-, Lifecycle- und Evidenz-Gates erzeugen einen inhaltsadressierten, unveränderlichen Snapshot. Fünf deterministische Kanäle – exact, BM25F, n-gram, fuzzy und graph – werden lokal fusioniert; embedding ist ein optionaler sechster Kanal mit Gewicht 0 bis zum lokalen A/B-Nachweis.
- **Vier Gates, drei Stufen.** Relevanz, epistemische Gültigkeit, Anwendbarkeit auf die Aufgabe und Handlungsrisiko lehnen jeweils aus eigenem Grund ab. Über einem Schwellwert aus einer Ablationskurve wird die Erinnerung zitiert; darunter kommen bis zu drei Verweise, die ausdrücklich keine Antwort sind; ohne geeigneten Kandidaten eine Enthaltung, die das ablehnende Gate nennt.
- **Keine unbeaufsichtigten Schreibvorgänge.** Kein Koordinator, keine Promotion, keine Kandidatenschlange. Das Paket misst, schlägt vor und lehnt ab; jede Änderung am Gedächtnis ist ein Commit, den ein Mensch macht, und keine Ranking-Änderung landet ohne den Evaluationsstand.

Mechanismen, Bedrohungsmodell und Forschungsbezug: [Technical design](../TECHNICAL.md).

## <a name="privacy-and-boundaries"></a><a name="trust-and-automation-boundary"></a><a name="local-first-by-default"></a><a name="telemetry-and-the-daily-pass"></a>🔒 Datenschutz und Grenzen

- **Standardmäßig lokal.** Das Ranking liest nur Repository-Dateien und lokale Snapshots: keine LLM-Aufrufe, keine Netzwerkanfragen, keine Retrieval-API-Rechnung. Gelieferte Auszüge belegen weiterhin Platz im Kontextfenster des Agenten, begrenzt durch das konfigurierte Budget.
- **Telemetrie bleibt auf dem Rechner.** Laufzeitereignisse liegen in einem von Git ignorierten Ordner und verfallen nach dreißig Tagen. Der tägliche Durchlauf (`ownmem daily`) verdichtet jeden abgeschlossenen Tag zu einem Paket aus reinen Zählwerten, ohne Abfragetext, Topic-Inhalte oder Dateipfade. Fehlende Stichproben erscheinen als „nicht verfügbar“, nie als 0 %.
- **Abgerufener Text gilt als Daten.** Er überschreibt keine Host-Anweisungen und autorisiert kein Werkzeug, und die Selbstzuordnung eines Agenten zählt nie als Bestätigung durch den Nutzer.
- **Fehler bleiben sichtbar.** Ein Eintrag mit unsigniertem Inhalt oder unprüfbarem Evidenzziel wird zurückgehalten; Evidenzdrift stuft ihn auf advisory herab und nennt, was sich geändert hat.
- **Keine Secrets.** Secrets sowie persönliche oder Produktionsdaten, die nicht in Git gehören, gehören auch nicht ins Memory.

## <a name="when-to-use-it"></a><a name="where-it-fits"></a>🧭 Wann es passt

| OwnMem passt | Anderes System wählen |
| --- | --- |
| Projektwissen soll mit Code reviewt und migriert werden. | Repository-übergreifendes persönliches Profil oder globales User Memory ist nötig. |
| Mehrere Coding Agents wechseln sich in einem Repository ab. | Alle Gespräche sollen ohne Evidenz- oder Risikogrenze automatisch gespeichert werden. |
| Lokaler, reproduzierbarer Recall ohne Retrieval-API-Rechnung zählt. | Große Cloud-Vektorsuche oder globaler Echtzeitgraph ist nötig. |
| Falsches Memory muss zurechenbar, ablehnbar und reversibel sein. | Menge ist wichtiger als Governance. |

## <a name="documentation"></a><a name="research-lineage"></a>📚 Dokumentation

| Dokument | Inhalt |
| --- | --- |
| [Architecture](../ARCHITECTURE.md) | Grenzen, Snapshots, Trust und Auslieferung |
| [Technical design](../TECHNICAL.md) | Mechanismen, Bedrohungen und Forschung |
| [Plugins](../PLUGINS.md) | Einrichtung pro Host, Plugins und Vertrauensschritte |
| [Updating](../UPDATING.md) | Sicheres Update und Versionsmigrationen |
| [Privacy](../PRIVACY.md) | Lokale Daten und optionale Kanäle |
| [Changelog](../../CHANGELOG.md) | Versionsverlauf |
| [Contributing](../../.github/CONTRIBUTING.md) | Issues melden und Änderungen einreichen |
| [Security](../../.github/SECURITY.md) | Sicherheitslücken melden |
| [License](../../LICENSE) | Apache-2.0 |

<details>
<summary><b>Forschungsgrundlagen</b></summary>

OwnMem beansprucht diese Grundlagen nicht als Erfindung. Der Beitrag ist ihre Kombination zu einem ausführbaren Protokoll für Repository Memory:

- **Agent Memory und Reflexion:** [Reflexion (NeurIPS 2023)](https://papers.neurips.cc/paper_files/paper/2023/hash/1b44b878bb782e6954cd888628510e90-Abstract-Conference.html), [MemGPT (2023)](https://arxiv.org/abs/2310.08560)
- **Memory- und Wissens-Poisoning:** [AgentPoison (NeurIPS 2024)](https://proceedings.neurips.cc/paper_files/paper/2024/hash/eb113910e9c3f6242541c1652e30dfd6-Abstract-Conference.html), [PoisonedRAG (USENIX Security 2025)](https://www.usenix.org/conference/usenixsecurity25/presentation/zou-poisonedrag)
- **Untrusted Data getrennt von Authority:** [CaMeL: Defeating Prompt Injections by Design (2025)](https://arxiv.org/abs/2503.18813)
- **Unabhängige Provenance:** [in-toto (USENIX Security 2019)](https://www.usenix.org/conference/usenixsecurity19/presentation/torres-arias)
- **Selektive Vorhersage und Abstention:** [Selective Classification (JMLR 2010)](https://jmlr.org/papers/v11/el-yaniv10a.html)
- **Validierung durch Ablation:** [Metamorphic Testing (1998)](https://www.cse.ust.hk/~scc/publ/CS98-01-metamorphictesting.pdf)
- **Zerlegte Retrieval-Evaluation:** [ARES (NAACL 2024)](https://aclanthology.org/2024.naacl-long.20/), [RAGChecker (2024)](https://arxiv.org/abs/2408.08067)

Die Zitate zeigen die Forschungslinie; sie bedeuten weder, dass diese Arbeiten OwnMem implementieren, noch dass OwnMem ihre Experimente reproduziert.

</details>

OwnMem ist Open Source. Reproduzierbare Issues und Pull Requests sind willkommen.
