<div align="center">

# OwnMem

**Memoria nativa de Git para agentes de programación con IA**

Memoria de proyecto en el repositorio para agentes de programación: local, determinista, revisable y que nunca se escribe sin tu commit.

[![npm version](https://img.shields.io/npm/v/ownmem?style=flat-square&logo=npm&color=cb3837)](https://www.npmjs.com/package/ownmem)
[![npm downloads](https://img.shields.io/npm/dm/ownmem?style=flat-square&logo=npm&color=555)](https://www.npmjs.com/package/ownmem)
[![GitHub stars](https://img.shields.io/github/stars/grpcer/ownmem?style=flat-square&logo=github&color=e3b341)](https://github.com/grpcer/ownmem/stargazers)
[![release gates](https://img.shields.io/github/actions/workflow/status/grpcer/ownmem/ci.yml?branch=main&style=flat-square&label=release%20gates)](https://github.com/grpcer/ownmem/actions/workflows/ci.yml)
[![node >= 20.6](https://img.shields.io/badge/node-%E2%89%A5%2020.6-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![license Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-1d7afc?style=flat-square)](../../LICENSE)

[English](../../README.md) · [简体中文](./README.zh-CN.md) · [繁體中文](./README.zh-TW.md) · [日本語](./README.ja.md) · [한국어](./README.ko.md) · **Español** · [Français](./README.fr.md) · [Deutsch](./README.de.md) · [Português (BR)](./README.pt-BR.md)

</div>

## <a name="why-ownmem"></a>✨ Por qué OwnMem

La mayoría de los sistemas optimiza «recordar más». OwnMem empieza por otra pregunta: **¿quién posee el conocimiento del proyecto, quién puede cambiarlo y cómo se detiene un recuerdo erróneo antes de que altere las acciones del agente?**

| Ventaja | Qué significa en la práctica |
| --- | --- |
| **La memoria pertenece al repositorio** | Markdown legible en `.ownmem/` viaja con el código al clonar, revisar y revertir, y todos los agentes del repositorio leen la misma fuente. |
| **Recall local y determinista** | Sin modelo ni red; la misma consulta, configuración y snapshot producen el mismo orden. |
| **Evidencia antes que autoridad** | El contenido no puede declararse fiable; receipts independientes y evidencia viva deciden la entrega. |
| **Avisa cuando no lo sabe** | La entrega es por niveles: la memoria citada, hasta tres punteros, o una abstención que nombra la puerta que se negó. |
| **Crecimiento neto cero** | El número de entradas solo puede bajar: añadir a un corpus lleno obliga a retirar algo en el mismo cambio. |

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/benchmark-dark.svg">
  <img alt="Benchmark público de OwnMem: Recall@1 del 100 % en 128 consultas de 40 idiomas, frente al 3,9 % de grep -F sobre el mismo corpus; latencia de recall de 0,46 ms en P50 y 1,05 ms en P95 en 4200 muestras, por debajo del umbral de publicación de 5 ms; MRR 1,000, abstención en las 40 consultas no relacionadas, ninguna llamada a modelos ni a la red y dos dependencias en tiempo de ejecución." src="../assets/benchmark-light.svg" width="100%">
</picture>

<sub>Medido sobre el corpus CC0 fijado en este repositorio. Para reproducirlo, ejecuta `npm run benchmark` en un clon.</sub>

## <a name="how-it-compares"></a><a name="how-this-differs-from-claudemd-and-built-in-memory"></a>🆚 Comparativa

OwnMem no sustituye a `CLAUDE.md` ni a `AGENTS.md`. Esos archivos dicen cómo se trabaja aquí y se leen enteros en cada turno. OwnMem responde otra pregunta: de todo lo que este proyecto aprendió a golpes, qué merece ponerse delante del modelo **para esta tarea** — y tiene permiso para responder «nada».

|  | Archivos de instrucciones | Memoria integrada del agente | OwnMem |
| --- | --- | --- | --- |
| Quién lo escribe | tú, a mano | el agente, desde tus conversaciones | tú, revisado como código |
| Dónde vive | un archivo del repositorio | la cuenta del proveedor | Markdown en tu repositorio |
| Qué llega al modelo | todo, en cada turno | lo que eligió su propio recall | uno de tres niveles, bajo un presupuesto de tokens |
| Cuando una entrada está mal | editas el archivo | puede que nunca veas esa entrada | el drift de evidencia la degrada y dice qué se movió |
| Coste por turno | el archivo entero en tokens | una llamada de recuperación | sin llamada a modelo ni a la red |

## <a name="quick-start"></a>🚀 Inicio rápido

Requiere Node.js 20.6 o posterior. Ejecútalo en el repositorio que debe poseer la memoria:

```bash
npm install --save-dev ownmem
npx ownmem init --hook --hosts claude,codex
```

Después, vuelve a abrir el agente. Indica en `--hosts` los hosts que usas (`claude`, `codex`, `cursor`, `gemini`, `grok`); la lista queda registrada, y para añadir o quitar un host basta con volver a pasar la lista completa. `init` crea `.ownmem/` y los adaptadores de cada host, en archivos de instrucciones como `CLAUDE.md` solo modifica lo que hay dentro de bloques gestionados y muestra los pasos puntuales que aún necesite algún host. Añade `--check` al mismo comando para previsualizarlo, y `--locale auto` para generar las instrucciones en el idioma de tu sistema.

| Host | Cómo se activa el recall | Configuración |
| --- | --- | --- |
| Claude Code | Un hook antes de cada Edit y Write, y cuando se lo pides | `claude` |
| Codex | Un hook antes de cada parche que aplica, y cuando se lo pides | `codex`; los hooks necesitan tres pasos de confianza que solo se hacen una vez, y `init` los muestra |
| Grok CLI | Lee la configuración de hooks de Claude Code mediante su capa de compatibilidad | `grok`, junto con `claude` si usas ambos; marca la carpeta como de confianza una vez con `/hooks-trust` |
| Cursor | Una regla que se aplica siempre o el servidor MCP | `cursor`; el servidor MCP requiere un paso manual, ver [Plugins](../PLUGINS.md) |
| Gemini CLI | Instrucciones o el servidor MCP | `gemini`; el servidor MCP requiere un paso manual, ver [Plugins](../PLUGINS.md) |

> **⚠️ ¿Vienes de la 0.6.0?** Actualiza el paquete con `npm install --save-dev ownmem@latest` y, antes que nada, ejecuta `npx ownmem init --update`. La 0.6.0 instaló hooks cuyos subcomandos ya no existen, así que una instalación que los conserve ejecuta un comando que falla en cada llamada a Bash. La actualización los elimina y nunca toca los hooks que escribiste tú. [Updating](../UPDATING.md) explica el resto, incluida la limpieza de `core.hooksPath`.

## <a name="daily-use"></a>💬 Uso diario

Sigue trabajando en lenguaje natural. Tu agente redacta una memoria cuando se lo pides, y tú la revisas como si fuera código:

> «Recuerda: el timeout de staging viene del límite del pool, no de pocos workers. Comprueba ambos la próxima vez.»

> «Antes de cambiar esto, revisa si la memoria del proyecto ya vio el mismo fallo.»

El recall responde en uno de tres niveles: la memoria citada, hasta tres punteros para ir a leer o una abstención. Una ejecución real:

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

La confianza se declara, no se presupone. Nada respalda todavía esta entrada —ninguna revisión la ha confirmado y no cita ningún documento de autoridad ni ancla de código—, así que llega como una pista que hay que volver a comprobar, no como un hecho establecido.

Los comandos que usarás tú mismo:

```bash
npx ownmem new staging_timeout_pool_cap   # scaffold one memory that already passes every gate
npx ownmem report --since 7d              # used? fast enough? right? what to do next
npx ownmem dashboard --open               # open the local console
npx ownmem mcp                            # serve recall and read to any MCP host over stdio
```

<img alt="La consola local de OwnMem: el residuo conocido de entregas erróneas como cifra principal, el embudo de búsquedas a su lado, el estado del corpus y de la evidencia debajo, y la navegación a rendimiento, calidad, gobernanza y recuperación semántica." src="../assets/console.png" width="100%">

`ownmem mcp` existe para los hosts sin hooks. Expone exactamente dos herramientas, `recall` y `read`, y ninguna puede modificar una memoria; los comandos de control (`audit`, `trust`, `compile`) y cualquier escritura de memoria quedan fuera de su alcance. [Plugins](../PLUGINS.md) explica cómo registrarlo para que ejecute la copia instalada en el proyecto.

## <a name="how-it-works"></a><a name="architecture"></a><a name="how-ownmem-governs-ai-agent-memory"></a>🧩 Cómo funciona

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/architecture-es-dark.svg">
  <img alt="Arquitectura de OwnMem: Markdown propiedad del repositorio y receipts de confianza independientes se compilan en snapshots inmutables; el recall local determinista pasa cuatro puertas de entrega y llega en uno de tres niveles — la memoria citada, hasta tres punteros, o una abstención que dice por qué — mientras los libros de feedback local, el banco de evaluación y una cuota de crecimiento neto cero acotan en qué se convierte el corpus." src="../assets/architecture-es-light.svg" width="100%">
</picture>

- **El repositorio es la fuente.** Rutas L1, índices L2 y temas L3 son Markdown revisable; los trust receipts viven fuera del texto autorizado.
- **Compilar antes de recordar.** Las puertas de schema, grafo, ciclo de vida y evidencia producen un snapshot inmutable y direccionado por contenido. Cinco canales deterministas —exact, BM25F, n-gram, fuzzy y graph— se fusionan localmente; embedding es un sexto canal opcional con peso 0 hasta superar la prueba A/B local.
- **Cuatro puertas, tres niveles.** Relevancia, validez epistémica, aplicabilidad a la tarea y riesgo de la acción se niegan cada una por su propio motivo. Por encima de un umbral que sale de una curva de ablación se cita la memoria; por debajo, hasta tres punteros que explícitamente no son respuestas; sin candidatos aptos, una abstención que nombra la puerta que se negó.
- **Ninguna escritura desatendida.** No hay coordinador, ni promoción, ni cola de candidatos. El paquete mide, propone y se niega; cada cambio en la memoria es un commit que hace una persona, y ningún cambio de ranking entra sin pasar por el banco de evaluación.

Mecanismos, modelo de amenazas y relación con la investigación: [Technical design](../TECHNICAL.md).

## <a name="privacy-and-boundaries"></a><a name="trust-and-automation-boundary"></a><a name="local-first-by-default"></a><a name="telemetry-and-the-daily-pass"></a>🔒 Privacidad y límites

- **Local por defecto.** El ranking solo lee archivos del repositorio y snapshots locales: cero llamadas LLM, cero peticiones de red y ninguna factura de API de recuperación. Los extractos entregados sí ocupan contexto del agente, dentro del presupuesto configurado.
- **La telemetría no sale de la máquina.** Los eventos de ejecución viven en un directorio ignorado por Git y caducan a los treinta días. La pasada diaria (`ownmem daily`) reduce cada día terminado a un paquete de recuentos sin texto de consultas, cuerpo de los temas ni rutas de archivo. Si faltan muestras, aparece «no disponible», nunca un 0 %.
- **El texto recuperado se trata como datos.** No puede anular las instrucciones del host ni autorizar una herramienta, y la autoatribución de un agente nunca cuenta como confirmación del usuario.
- **Los fallos son visibles.** Una entrada con contenido sin firmar o con un objetivo de evidencia no verificable se retiene; el drift de evidencia la baja a advisory y dice qué se movió.
- **Nada de secretos.** Secretos y datos personales o de producción que no deben ir a Git tampoco deben ir a memoria.

## <a name="when-to-use-it"></a><a name="where-it-fits"></a>🧭 Cuándo encaja

| OwnMem encaja | Mejor otro sistema |
| --- | --- |
| El conocimiento debe revisarse y migrar con el código. | Necesitas un perfil personal o memoria global entre repositorios. |
| Varios agentes trabajan por turnos en un repositorio. | Quieres capturar toda conversación sin límites de evidencia o riesgo. |
| Importa el recall local y reproducible sin factura de API de recuperación. | Necesitas búsqueda vectorial cloud masiva o un grafo global en tiempo real. |
| La memoria errónea debe poder atribuirse, rechazarse y revertirse. | La cantidad importa más que el gobierno. |

## <a name="documentation"></a><a name="research-lineage"></a>📚 Documentación

| Documento | Contenido |
| --- | --- |
| [Architecture](../ARCHITECTURE.md) | Límites, snapshots, confianza y entrega |
| [Technical design](../TECHNICAL.md) | Mecanismos, amenazas e investigación |
| [Plugins](../PLUGINS.md) | Configuración por host, plugins y pasos de confianza |
| [Updating](../UPDATING.md) | Actualización segura y migraciones de versión |
| [Privacy](../PRIVACY.md) | Datos locales y canales opcionales |
| [Changelog](../../CHANGELOG.md) | Historial de versiones |
| [Contributing](../../.github/CONTRIBUTING.md) | Cómo reportar issues y enviar cambios |
| [Security](../../.github/SECURITY.md) | Cómo reportar una vulnerabilidad |
| [License](../../LICENSE) | Apache-2.0 |

<details>
<summary><b>Antecedentes de investigación</b></summary>

OwnMem no presenta estas bases como invenciones; su aportación es componerlas en un protocolo ejecutable para memoria de repositorio:

- **Memoria de agentes y reflexión:** [Reflexion (NeurIPS 2023)](https://papers.neurips.cc/paper_files/paper/2023/hash/1b44b878bb782e6954cd888628510e90-Abstract-Conference.html), [MemGPT (2023)](https://arxiv.org/abs/2310.08560)
- **Poisoning de memoria y conocimiento:** [AgentPoison (NeurIPS 2024)](https://proceedings.neurips.cc/paper_files/paper/2024/hash/eb113910e9c3f6242541c1652e30dfd6-Abstract-Conference.html), [PoisonedRAG (USENIX Security 2025)](https://www.usenix.org/conference/usenixsecurity25/presentation/zou-poisonedrag)
- **Datos no fiables separados de autoridad:** [CaMeL: Defeating Prompt Injections by Design (2025)](https://arxiv.org/abs/2503.18813)
- **Procedencia independiente:** [in-toto (USENIX Security 2019)](https://www.usenix.org/conference/usenixsecurity19/presentation/torres-arias)
- **Predicción selectiva y abstención:** [Selective Classification (JMLR 2010)](https://jmlr.org/papers/v11/el-yaniv10a.html)
- **Validación por ablación:** [Metamorphic Testing (1998)](https://www.cse.ust.hk/~scc/publ/CS98-01-metamorphictesting.pdf)
- **Evaluación descompuesta de retrieval:** [ARES (NAACL 2024)](https://aclanthology.org/2024.naacl-long.20/), [RAGChecker (2024)](https://arxiv.org/abs/2408.08067)

Las citas describen el linaje; no implican que esos trabajos implementen OwnMem ni que OwnMem reproduzca sus experimentos.

</details>

OwnMem es código abierto. Se agradecen issues y pull requests reproducibles.
