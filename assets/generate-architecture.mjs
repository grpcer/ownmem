#!/usr/bin/env node
// Generates the OwnMem README architecture diagram for 8 locales x 2 themes.
// One geometry template + per-locale string tables => no per-locale drift or overflow.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] || './out');
mkdirSync(OUT, { recursive: true });

const THEMES = {
  light: {
    bg: '#ffffff', panel: '#f6f8fa', box: '#ffffff',
    ink: '#0f172a', muted: '#57606a', border: '#d0d7de', arrow: '#64748b',
    blue: '#2563eb', blueSoft: '#eff6ff',
    green: '#15803d', greenSoft: '#f0fdf4',
    red: '#b42318', redSoft: '#fff1f0',
    amber: '#a16207', amberSoft: '#fffbeb',
  },
  dark: {
    bg: '#0d1117', panel: '#161b22', box: '#0d1117',
    ink: '#f0f6fc', muted: '#8b949e', border: '#30363d', arrow: '#8b949e',
    blue: '#58a6ff', blueSoft: '#0d2740',
    green: '#3fb950', greenSoft: '#102b1c',
    red: '#ff7b72', redSoft: '#321d1c',
    amber: '#d29922', amberSoft: '#2d240f',
  },
};

const LOCALES = {
  en: {
    title: 'How OwnMem turns a question into trusted context',
    subtitle: 'Repository-owned memory · deterministic by default · evidence before answers',
    desc: 'Three trust domains: the repository holds curated Markdown that passes governance gates and compiles into an immutable snapshot; the deterministic engine answers through six candidate lanes, ranking, a confidence gate and a 400-token envelope; the coding agent asks, verifies against live code, and writes new lessons that flow back through audit and compile.',
    pill: 'Default: 0 model calls · 0 network calls',
    repoChip: 'YOUR REPOSITORY', repoSub: 'plain Markdown · travels with git',
    engChip: 'OWNMEM ENGINE', engSub: 'deterministic · same query, same answer',
    agentChip: 'YOUR CODING AGENT', agentSub: 'the only place judgment happens',
    curatedTitle: 'Curated memory topics', curatedL1: 'lesson · triggers · evidence', curatedL2: 'L1 index · L2 areas · L3 topics',
    gatesTitle: 'Governance gates', gatesL1: 'schema · size caps · growth quota', gatesL2: 'SimHash + MinHash dedup',
    snapTitle: 'Immutable snapshot', snapL1: 'postings · exact map · graph · ranking', snapL2: 'safe previous-snapshot fallback',
    gitTitle: 'Reviewed like code', gitL1: 'diff · pull request · rollback',
    understandTitle: 'Query understanding', understandDesc: 'intent classified · script-aware tokenizer · 40 languages',
    lanesTitle: 'Six candidate lanes', lanesNote: 'each lane ranks candidates independently',
    fuseTitle: 'Fuse & judge', fuseDesc: 'RRF · authority · freshness · evidence · conflicts · MMR',
    gate: 'Confident?',
    abstainTitle: 'No → abstain', abstainLine: 'inject nothing',
    envT1: 'Yes → context envelope', envT2: '', envLine: '≤400 tokens · 1 topic',
    askTitle: 'Asks in plain words', askL1: 'a symptom in ordinary words', askL2: '2–3 phrasings, fused by the engine',
    verifyTitle: 'Verifies before trusting', verifyL1: 'opens the full topic file', verifyL2: 'checks against live code',
    fbTitle: 'correct · wrong · miss', fbLine: 'local feedback tunes triggers',
    writeTitle: 'Writes new lessons', writeL1: 'only when no doc, gate, or test fits', writeL2: 'plain Markdown, reviewed in PRs',
    loopLabel: 'new lesson or feedback → audit → compile → ready for the next recall',
    loadsLabel: 'loads',
    hostsTitle: 'One memory, every coding agent',
    hostsList: 'Claude Code · Codex · Gemini CLI · Cursor · Grok CLI',
    footnote: '* Optional embedding lane is isolated; failure keeps lexical results.',
  },
  'zh-CN': {
    title: 'OwnMem 如何把一个问题变成可信上下文',
    subtitle: '记忆属于仓库 · 默认确定性 · 先核证据，再回答',
    desc: '三个信任域：仓库持有精选 Markdown，经治理闸门编译为不可变快照；确定性引擎经六条候选通道、排序、可信度门与 400 token 信封作答；coding agent 提问、对照活代码复核，并把新教训经 audit 与 compile 写回仓库。',
    pill: '默认：0 次模型调用 · 0 次网络请求',
    repoChip: '你的仓库', repoSub: '纯 Markdown · 随 git 流转',
    engChip: 'OWNMEM 引擎', engSub: '确定性 · 同样的问题，同样的答案',
    agentChip: '你的 CODING AGENT', agentSub: '判断只发生在这里',
    curatedTitle: '精选记忆条目', curatedL1: '教训 · 触发词 · 证据', curatedL2: 'L1 索引 · L2 分区 · L3 条目',
    gatesTitle: '治理闸门', gatesL1: 'schema · 体积上限 · 增长配额', gatesL2: 'SimHash + MinHash 查重',
    snapTitle: '不可变快照', snapL1: 'postings · exact map · graph · ranking', snapL2: '可安全回退上一份快照',
    gitTitle: '像代码一样被评审', gitL1: 'diff · pull request · 回滚',
    understandTitle: '查询理解', understandDesc: '识别查询类型 · 文字系统感知分词 · 40 种语言',
    lanesTitle: '六条候选通道', lanesNote: '每条通道独立给出候选排名',
    fuseTitle: '融合与裁决', fuseDesc: 'RRF · 权威 · 新鲜度 · 证据 · 冲突 · MMR',
    gate: '足够可信？',
    abstainTitle: '否 → 弃权', abstainLine: '不注入任何记忆',
    envT1: '是 → 上下文信封', envT2: '', envLine: '≤400 tokens · 1 条记忆',
    askTitle: '用日常语言提问', askL1: '描述症状即可', askL2: '2–3 种说法，由引擎融合',
    verifyTitle: '先复核再采信', verifyL1: '打开记忆全文', verifyL2: '对照活代码验证',
    fbTitle: '正确 · 错误 · 漏召回', fbLine: '本地反馈持续改进触发词',
    writeTitle: '沉淀新教训', writeL1: '文档、闸门、测试都装不下才写', writeL2: '纯 Markdown，随 PR 评审',
    loopLabel: '新教训 / 反馈 → audit → compile → 服务下一次召回',
    loadsLabel: '读取',
    hostsTitle: '一份记忆，服务所有 coding agent',
    hostsList: 'Claude Code · Codex · Gemini CLI · Cursor · Grok CLI',
    footnote: '* 可选 embedding 通道完全隔离；失败仍保留词法结果。',
  },
  ja: {
    title: 'OwnMem が質問を信頼できるコンテキストに変えるまで',
    subtitle: 'リポジトリ所有 · デフォルトは決定的 · 回答より先に証拠を確認',
    desc: '3 つの信頼ドメイン：リポジトリは選別された Markdown を保持し、ガバナンス関門を経て不変 snapshot にコンパイル。決定的エンジンは 6 つの候補 channel、ランキング、確信度ゲート、400 token の envelope で回答。coding agent は質問し、現在の code と突き合わせて検証し、新しい教訓を audit と compile を通じて書き戻す。',
    pill: 'デフォルト：モデル呼び出し 0 · ネットワーク 0',
    repoChip: 'リポジトリ', repoSub: 'プレーンな Markdown · git とともに移動',
    engChip: 'OWNMEM ENGINE', engSub: '決定的 · 同じ質問には同じ答え',
    agentChip: 'CODING AGENT', agentSub: '判断はここだけで行う',
    curatedTitle: '選別されたメモリ topic', curatedL1: '教訓 · trigger · evidence', curatedL2: 'L1 索引 · L2 区分 · L3 topic',
    gatesTitle: 'ガバナンスの関門', gatesL1: 'schema · サイズ上限 · 増加 quota', gatesL2: 'SimHash + MinHash 重複排除',
    snapTitle: '不変の snapshot', snapL1: 'postings · exact map · graph · ranking', snapL2: '直前の snapshot へ安全に退避',
    gitTitle: 'コードと同じくレビュー', gitL1: 'diff · pull request · ロールバック',
    understandTitle: 'クエリ理解', understandDesc: '意図を分類 · 文字体系対応トークナイザ · 40 言語',
    lanesTitle: '6 つの候補 channel', lanesNote: '各 channel が独立に候補を順位付け',
    fuseTitle: '統合して判定', fuseDesc: 'RRF · authority · 鮮度 · evidence · conflict · MMR',
    gate: '十分に確か？',
    abstainTitle: 'いいえ → abstain', abstainLine: '何も注入しない',
    envT1: 'はい → context envelope', envT2: '', envLine: '≤400 tokens · 1 topic',
    askTitle: '日常語で質問する', askL1: '症状をそのまま書く', askL2: '2〜3 表現をエンジンが融合',
    verifyTitle: '信頼する前に検証', verifyL1: 'topic 全文を開く', verifyL2: '現在の code と突き合わせ',
    fbTitle: 'correct · wrong · miss', fbLine: 'ローカル feedback が trigger を改善',
    writeTitle: '新しい教訓を書き残す', writeL1: 'doc · ゲート · テストに収まらない時だけ', writeL2: 'プレーン Markdown を PR でレビュー',
    loopLabel: '新しい教訓 / feedback → audit → compile → 次の recall へ',
    loadsLabel: '読み込み',
    hostsTitle: '1 つのメモリを全 coding agent で共有',
    hostsList: 'Claude Code · Codex · Gemini CLI · Cursor · Grok CLI',
    footnote: '* 任意の embedding は分離；失敗しても語彙結果を維持。',
  },
  ko: {
    title: 'OwnMem이 질문을 신뢰할 수 있는 컨텍스트로 바꾸는 과정',
    subtitle: '저장소 소유 · 기본은 결정적 · 답변 전에 증거 확인',
    desc: '세 가지 신뢰 도메인: 저장소는 선별된 Markdown을 보유하고 거버넌스 게이트를 거쳐 불변 snapshot으로 컴파일됩니다. 결정적 엔진은 6개 후보 channel, 랭킹, 확신도 게이트, 400 token envelope로 답합니다. coding agent는 질문하고 현재 code와 대조해 검증하며 새 교훈을 audit과 compile을 통해 되돌려 씁니다.',
    pill: '기본값: 모델 호출 0 · 네트워크 호출 0',
    repoChip: '저장소', repoSub: '플레인 Markdown · git과 함께 이동',
    engChip: 'OWNMEM ENGINE', engSub: '결정적 · 같은 질문, 같은 답',
    agentChip: 'CODING AGENT', agentSub: '판단은 여기서만 일어남',
    curatedTitle: '선별된 메모리 topic', curatedL1: '교훈 · trigger · evidence', curatedL2: 'L1 색인 · L2 영역 · L3 topic',
    gatesTitle: '거버넌스 게이트', gatesL1: 'schema · 크기 상한 · 증가 quota', gatesL2: 'SimHash + MinHash 중복 제거',
    snapTitle: '불변 snapshot', snapL1: 'postings · exact map · graph · ranking', snapL2: '이전 snapshot으로 안전하게 대체',
    gitTitle: '코드처럼 리뷰', gitL1: 'diff · pull request · 롤백',
    understandTitle: '쿼리 이해', understandDesc: '의도 분류 · 문자 체계 인식 토크나이저 · 40개 언어',
    lanesTitle: '6개 후보 channel', lanesNote: '각 channel이 독립적으로 후보를 순위화',
    fuseTitle: '통합 및 판정', fuseDesc: 'RRF · authority · 최신성 · evidence · conflict · MMR',
    gate: '확실한가?',
    abstainTitle: '아니요 → abstain', abstainLine: '아무것도 주입하지 않음',
    envT1: '예 → context envelope', envT2: '', envLine: '≤400 tokens · topic 1개',
    askTitle: '일상 언어로 질문', askL1: '증상을 그대로 설명', askL2: '2–3개 표현을 엔진이 융합',
    verifyTitle: '신뢰 전에 검증', verifyL1: 'topic 전문을 열어', verifyL2: '현재 code와 대조',
    fbTitle: 'correct · wrong · miss', fbLine: '로컬 feedback이 trigger를 개선',
    writeTitle: '새 교훈 기록', writeL1: 'doc · 게이트 · 테스트로 안 될 때만', writeL2: '플레인 Markdown, PR에서 리뷰',
    loopLabel: '새 교훈 / feedback → audit → compile → 다음 recall 준비',
    loadsLabel: '로드',
    hostsTitle: '하나의 메모리, 모든 coding agent',
    hostsList: 'Claude Code · Codex · Gemini CLI · Cursor · Grok CLI',
    footnote: '* 선택적 embedding은 격리되며 실패해도 어휘 결과 유지.',
  },
  es: {
    title: 'Cómo OwnMem convierte una pregunta en contexto fiable',
    subtitle: 'Memoria del repositorio · determinista por defecto · evidencia antes de responder',
    desc: 'Tres dominios de confianza: el repositorio guarda Markdown curado que pasa puertas de gobierno y se compila en un snapshot inmutable; el motor determinista responde con seis canales candidatos, ranking, una puerta de confianza y un sobre de 400 tokens; el coding agent pregunta, verifica contra el código actual y escribe nuevas lecciones que vuelven por audit y compile.',
    pill: 'Por defecto: 0 llamadas a modelos · 0 llamadas de red',
    repoChip: 'TU REPOSITORIO', repoSub: 'Markdown plano · viaja con git',
    engChip: 'MOTOR OWNMEM', engSub: 'determinista · misma consulta, misma respuesta',
    agentChip: 'TU CODING AGENT', agentSub: 'el único lugar donde se juzga',
    curatedTitle: 'Temas de memoria curados', curatedL1: 'lección · triggers · evidencia', curatedL2: 'índice L1 · áreas L2 · temas L3',
    gatesTitle: 'Puertas de gobierno', gatesL1: 'schema · límites de tamaño · cuota', gatesL2: 'deduplicación SimHash + MinHash',
    snapTitle: 'Snapshot inmutable', snapL1: 'postings · exact map · graph · ranking', snapL2: 'respaldo seguro al anterior',
    gitTitle: 'Revisado como código', gitL1: 'diff · pull request · rollback',
    understandTitle: 'Comprensión de la consulta', understandDesc: 'clasifica la intención · tokenizador por escritura · 40 idiomas',
    lanesTitle: 'Seis canales candidatos', lanesNote: 'cada canal ordena candidatos por su cuenta',
    fuseTitle: 'Fusionar y decidir', fuseDesc: 'RRF · autoridad · frescura · evidencia · conflictos · MMR',
    gate: '¿Es fiable?',
    abstainTitle: 'No → abstenerse', abstainLine: 'no inyectar nada',
    envT1: 'Sí → sobre de contexto', envT2: '', envLine: '≤400 tokens · 1 tema',
    askTitle: 'Pregunta en lenguaje llano', askL1: 'un síntoma en palabras corrientes', askL2: '2–3 variantes, fusionadas por el motor',
    verifyTitle: 'Verifica antes de confiar', verifyL1: 'abre el tema completo', verifyL2: 'contrasta con el código actual',
    fbTitle: 'correcto · erróneo · omitido', fbLine: 'el feedback local mejora los triggers',
    writeTitle: 'Escribe nuevas lecciones', writeL1: 'solo si no cabe en doc, puerta o test', writeL2: 'Markdown plano, revisado en PRs',
    loopLabel: 'nueva lección o feedback → audit → compile → listo para el próximo recall',
    loadsLabel: 'carga',
    hostsTitle: 'Una memoria para todos los coding agents',
    hostsList: 'Claude Code · Codex · Gemini CLI · Cursor · Grok CLI',
    footnote: '* El embedding opcional está aislado; un fallo conserva lo léxico.',
  },
  fr: {
    title: 'Comment OwnMem transforme une question en contexte fiable',
    subtitle: 'Mémoire du dépôt · déterministe par défaut · les preuves avant la réponse',
    desc: "Trois domaines de confiance : le dépôt contient du Markdown sélectionné qui passe des portes de gouvernance et se compile en snapshot immuable ; le moteur déterministe répond via six canaux candidats, un classement, une porte de confiance et une enveloppe de 400 tokens ; le coding agent interroge, vérifie contre le code actuel et écrit de nouvelles leçons qui reviennent par audit et compile.",
    pill: 'Par défaut : 0 appel modèle · 0 appel réseau',
    repoChip: 'VOTRE DÉPÔT', repoSub: 'Markdown brut · voyage avec git',
    engChip: 'MOTEUR OWNMEM', engSub: 'déterministe · même question, même réponse',
    agentChip: 'VOTRE CODING AGENT', agentSub: "le seul endroit où l'on juge",
    curatedTitle: 'Sujets de mémoire sélectionnés', curatedL1: 'leçon · triggers · preuves', curatedL2: 'index L1 · zones L2 · sujets L3',
    gatesTitle: 'Portes de gouvernance', gatesL1: 'schema · limites de taille · quota', gatesL2: 'déduplication SimHash + MinHash',
    snapTitle: 'Snapshot immuable', snapL1: 'postings · exact map · graph · ranking', snapL2: 'repli sûr sur le précédent',
    gitTitle: 'Relu comme du code', gitL1: 'diff · pull request · rollback',
    understandTitle: 'Compréhension de la requête', understandDesc: 'intention classée · tokenizer par écriture · 40 langues',
    lanesTitle: 'Six canaux candidats', lanesNote: 'chaque canal classe ses candidats seul',
    fuseTitle: 'Fusionner et juger', fuseDesc: 'RRF · autorité · fraîcheur · preuves · conflits · MMR',
    gate: 'Fiable ?',
    abstainTitle: "Non → s'abstenir", abstainLine: 'ne rien injecter',
    envT1: 'Oui → enveloppe', envT2: 'de contexte', envLine: '≤400 tokens · 1 sujet',
    askTitle: 'Interroge en langage courant', askL1: 'un symptôme en mots ordinaires', askL2: '2–3 variantes, fusionnées par le moteur',
    verifyTitle: 'Vérifie avant de se fier', verifyL1: 'ouvre le sujet complet', verifyL2: 'confronte au code actuel',
    fbTitle: 'correct · erroné · manqué', fbLine: 'le feedback local affine les triggers',
    writeTitle: 'Écrit de nouvelles leçons', writeL1: 'si aucun doc, porte ou test ne convient', writeL2: 'Markdown brut, relu en PR',
    loopLabel: 'nouvelle leçon ou feedback → audit → compile → prêt pour le prochain recall',
    loadsLabel: 'charge',
    hostsTitle: 'Une mémoire pour tous les coding agents',
    hostsList: 'Claude Code · Codex · Gemini CLI · Cursor · Grok CLI',
    footnote: "* L'embedding optionnel est isolé ; un échec conserve le lexical.",
  },
  de: {
    title: 'Wie OwnMem eine Frage in vertrauenswürdigen Kontext verwandelt',
    subtitle: 'Repository-eigen · standardmäßig deterministisch · Belege vor Antworten',
    desc: 'Drei Vertrauensdomänen: Das Repository hält kuratiertes Markdown, das Governance-Gates passiert und zu einem unveränderlichen Snapshot kompiliert wird; die deterministische Engine antwortet über sechs Kandidatenkanäle, Ranking, ein Konfidenztor und einen 400-Token-Umschlag; der Coding Agent fragt, prüft gegen aktuellen Code und schreibt neue Lektionen, die über audit und compile zurückfließen.',
    pill: 'Standard: 0 Modellaufrufe · 0 Netzwerkaufrufe',
    repoChip: 'DEIN REPOSITORY', repoSub: 'reines Markdown · reist mit git',
    engChip: 'OWNMEM ENGINE', engSub: 'deterministisch · gleiche Frage, gleiche Antwort',
    agentChip: 'DEIN CODING AGENT', agentSub: 'nur hier wird geurteilt',
    curatedTitle: 'Kuratierte Memory-Themen', curatedL1: 'Lektion · Trigger · Belege', curatedL2: 'L1-Index · L2-Bereiche · L3-Themen',
    gatesTitle: 'Governance-Gates', gatesL1: 'Schema · Größenlimits · Wachstumsquote', gatesL2: 'SimHash + MinHash Deduplizierung',
    snapTitle: 'Unveränderlicher Snapshot', snapL1: 'postings · exact map · graph · ranking', snapL2: 'sicherer Rückfall auf den vorherigen',
    gitTitle: 'Wie Code reviewt', gitL1: 'diff · Pull Request · Rollback',
    understandTitle: 'Query-Verständnis', understandDesc: 'Absicht klassifiziert · schriftbewusster Tokenizer · 40 Sprachen',
    lanesTitle: 'Sechs Kandidatenkanäle', lanesNote: 'jeder Kanal rankt Kandidaten unabhängig',
    fuseTitle: 'Zusammenführen & prüfen', fuseDesc: 'RRF · Autorität · Frische · Belege · Konflikte · MMR',
    gate: 'Verlässlich?',
    abstainTitle: 'Nein → verzichten', abstainLine: 'nichts injizieren',
    envT1: 'Ja → Kontextumschlag', envT2: '', envLine: '≤400 Tokens · 1 Thema',
    askTitle: 'Fragt in Alltagssprache', askL1: 'ein Symptom in normalen Worten', askL2: '2–3 Varianten, deterministisch fusioniert',
    verifyTitle: 'Erst prüfen, dann vertrauen', verifyL1: 'öffnet das vollständige Thema', verifyL2: 'gleicht mit aktuellem Code ab',
    fbTitle: 'korrekt · falsch · verfehlt', fbLine: 'lokales Feedback schärft Trigger',
    writeTitle: 'Hält neue Lektionen fest', writeL1: 'nur wenn kein Doc, Gate oder Test passt', writeL2: 'reines Markdown, im PR reviewt',
    loopLabel: 'neue Lektion oder Feedback → audit → compile → bereit für den nächsten Recall',
    loadsLabel: 'lädt',
    hostsTitle: 'Ein Speicher für alle Coding Agents',
    hostsList: 'Claude Code · Codex · Gemini CLI · Cursor · Grok CLI',
    footnote: '* Optionales Embedding ist isoliert; lexikalische Treffer bleiben.',
  },
  'pt-BR': {
    title: 'Como o OwnMem transforma uma pergunta em contexto confiável',
    subtitle: 'Memória do repositório · determinística por padrão · evidência antes da resposta',
    desc: 'Três domínios de confiança: o repositório guarda Markdown curado que passa por portões de governança e é compilado em um snapshot imutável; o motor determinístico responde por seis canais candidatos, ranking, um portão de confiança e um envelope de 400 tokens; o coding agent pergunta, verifica contra o código atual e registra novas lições que voltam por audit e compile.',
    pill: 'Padrão: 0 chamadas de modelo · 0 chamadas de rede',
    repoChip: 'SEU REPOSITÓRIO', repoSub: 'Markdown puro · viaja com o git',
    engChip: 'MOTOR OWNMEM', engSub: 'determinístico · mesma pergunta, mesma resposta',
    agentChip: 'SEU CODING AGENT', agentSub: 'o único lugar onde se julga',
    curatedTitle: 'Tópicos de memória curados', curatedL1: 'lição · triggers · evidência', curatedL2: 'índice L1 · áreas L2 · tópicos L3',
    gatesTitle: 'Portões de governança', gatesL1: 'schema · limites de tamanho · cota', gatesL2: 'deduplicação SimHash + MinHash',
    snapTitle: 'Snapshot imutável', snapL1: 'postings · exact map · graph · ranking', snapL2: 'fallback seguro para o anterior',
    gitTitle: 'Revisado como código', gitL1: 'diff · pull request · rollback',
    understandTitle: 'Compreensão da consulta', understandDesc: 'classifica a intenção · tokenizador por escrita · 40 idiomas',
    lanesTitle: 'Seis canais candidatos', lanesNote: 'cada canal ranqueia candidatos sozinho',
    fuseTitle: 'Fundir e decidir', fuseDesc: 'RRF · autoridade · frescor · evidência · conflitos · MMR',
    gate: 'É confiável?',
    abstainTitle: 'Não → abster', abstainLine: 'não injetar nada',
    envT1: 'Sim → envelope', envT2: 'de contexto', envLine: '≤400 tokens · 1 tópico',
    askTitle: 'Pergunta em linguagem comum', askL1: 'um sintoma em palavras simples', askL2: '2–3 variações, fundidas pelo motor',
    verifyTitle: 'Verifica antes de confiar', verifyL1: 'abre o tópico completo', verifyL2: 'confere com o código atual',
    fbTitle: 'correto · errado · ausente', fbLine: 'feedback local melhora os triggers',
    writeTitle: 'Registra novas lições', writeL1: 'só quando doc, portão ou teste não cabem', writeL2: 'Markdown puro, revisado em PRs',
    loopLabel: 'nova lição ou feedback → audit → compile → pronto para o próximo recall',
    loadsLabel: 'carrega',
    hostsTitle: 'Uma memória para todos os coding agents',
    hostsList: 'Claude Code · Codex · Gemini CLI · Cursor · Grok CLI',
    footnote: '* Embedding opcional é isolado; falhas preservam o resultado lexical.',
  },
};

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', 'Helvetica Neue', Arial, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace";

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Rough width estimate for chip sizing only (labels are short uppercase / CJK).
function estWidth(text, fs, bold = false) {
  let w = 0;
  for (const ch of text) {
    if (/[⺀-鿿가-힯぀-ヿ＀-￯]/.test(ch)) w += fs * 1.02;
    else if (ch === ' ') w += fs * 0.3;
    else if (/[A-ZÀ-ÞÄÖÜ]/.test(ch)) w += fs * (bold ? 0.72 : 0.66);
    else w += fs * (bold ? 0.58 : 0.53);
  }
  return w;
}

function render(locale, themeName) {
  const t = LOCALES[locale];
  const c = THEMES[themeName];
  const W = 1600; const H = 872;
  const p = [];
  const push = (s) => p.push(s);

  const text = (x, y, s, { fs = 12, w = 400, fill = c.ink, anchor = 'start', ls = null, mono = false } = {}) => {
    if (!s) return;
    push(`  <text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${fs}" font-weight="${w}"${ls ? ` letter-spacing="${ls}"` : ''}${mono ? ` font-family="${MONO}"` : ''} fill="${fill}">${esc(s)}</text>`);
  };
  const rect = (x, y, w, h, r, fill, stroke, { sw = 1.4, dash = null } = {}) => {
    push(`  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="${sw}"` : ''}${dash ? ` stroke-dasharray="${dash}"` : ''}/>`);
  };
  const line = (d, { stroke = c.arrow, sw = 1.7, dash = null, marker = 'arrow' } = {}) => {
    push(`  <path d="${d}" fill="none" stroke="${stroke}" stroke-width="${sw}"${dash ? ` stroke-dasharray="${dash}"` : ''}${marker ? ` marker-end="url(#${marker})"` : ''}/>`);
  };

  push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="title description" font-family="${FONT}">`);
  push(`  <title id="title">${esc(t.title)}</title>`);
  push(`  <desc id="description">${esc(t.desc)}</desc>`);
  push('  <defs>');
  push(`    <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1 L 8 5 L 0 9 z" fill="${c.arrow}"/></marker>`);
  push(`    <marker id="accent" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1 L 8 5 L 0 9 z" fill="${c.blue}"/></marker>`);
  push('  </defs>');
  rect(0, 0, W, H, 18, c.bg, null);

  // Header
  text(40, 54, t.title, { fs: 24, w: 700 });
  text(40, 80, t.subtitle, { fs: 13.5, fill: c.muted });
  rect(1140, 36, 420, 32, 16, c.blueSoft, c.blue);
  text(1350, 57, t.pill, { fs: 12.5, w: 600, fill: c.blue, anchor: 'middle' });

  // Containers
  const CONT = { y: 120, h: 560 };
  const repo = { x: 40, w: 370 };
  const eng = { x: 470, w: 660 };
  const agent = { x: 1190, w: 370 };
  rect(repo.x, CONT.y, repo.w, CONT.h, 16, c.panel, c.border);
  rect(eng.x, CONT.y, eng.w, CONT.h, 16, c.panel, c.blue, { sw: 1.5 });
  rect(agent.x, CONT.y, agent.w, CONT.h, 16, c.panel, c.border);

  const chip = (cx, label, fill, stroke, color) => {
    const cw = Math.ceil(estWidth(label, 11.5, true) + 1.1 * label.length + 30);
    rect(cx + 20, 106, cw, 28, 14, fill, stroke);
    text(cx + 20 + cw / 2, 125, label, { fs: 11.5, w: 700, fill: color, anchor: 'middle', ls: 1 });
  };
  chip(repo.x, t.repoChip, c.box, c.border, c.ink);
  chip(eng.x, t.engChip, c.blueSoft, c.blue, c.blue);
  chip(agent.x, t.agentChip, c.box, c.border, c.ink);
  text(repo.x + 20, 154, t.repoSub, { fs: 11.5, fill: c.muted });
  text(eng.x + 20, 154, t.engSub, { fs: 11.5, fill: c.muted });
  text(agent.x + 20, 154, t.agentSub, { fs: 11.5, fill: c.muted });

  // Repo column
  const rb = (y, title, l1, l2, fill, stroke) => {
    rect(60, y, 330, 92, 12, fill, stroke);
    text(78, y + 30, title, { fs: 14, w: 650 });
    text(78, y + 54, l1, { fs: 11.5, fill: c.muted });
    text(78, y + 72, l2, { fs: 11.5, fill: c.muted });
  };
  rb(170, t.curatedTitle, t.curatedL1, t.curatedL2, c.box, c.border);
  line('M 225 262 L 225 286', {});
  text(235, 281, 'ownmem audit', { fs: 10.5, fill: c.muted, mono: true });
  rb(292, t.gatesTitle, t.gatesL1, t.gatesL2, c.box, c.border);
  line('M 225 384 L 225 408', {});
  text(235, 403, 'ownmem compile', { fs: 10.5, fill: c.muted, mono: true });
  rb(414, t.snapTitle, t.snapL1, t.snapL2, c.greenSoft, c.green);
  rect(60, 545, 330, 70, 12, c.box, c.border, { dash: '5 4' });
  text(78, 573, t.gitTitle, { fs: 12.5, w: 600 });
  text(78, 595, t.gitL1, { fs: 11, fill: c.muted });

  // loads arrow repo -> engine (label sits in the 60px gap between containers)
  text(440, 448, t.loadsLabel, { fs: 10.5, fill: c.muted, anchor: 'middle', mono: true });
  line('M 394 460 L 466 460', {});

  // Engine column
  rect(490, 170, 620, 74, 12, c.box, c.border);
  text(510, 200, t.understandTitle, { fs: 14, w: 650 });
  text(510, 226, t.understandDesc, { fs: 11.5, fill: c.muted });
  line('M 800 244 L 800 262', {});
  rect(490, 268, 620, 118, 12, c.box, c.border);
  text(510, 296, t.lanesTitle, { fs: 13.5, w: 650 });
  const lanes = ['Exact', 'BM25F', 'n-gram', 'Fuzzy', 'Graph', 'Embedding*'];
  lanes.forEach((label, i) => {
    const x = 510 + i * 96;
    const optional = label.startsWith('Embedding');
    rect(x, 312, 88, 30, 7, optional ? c.amberSoft : c.panel, optional ? c.amber : c.border, optional ? { dash: '4 3' } : {});
    text(x + 44, 331, label, { fs: 11.5, w: 600, fill: optional ? c.amber : c.ink, anchor: 'middle' });
  });
  text(800, 370, t.lanesNote, { fs: 10.5, fill: c.muted, anchor: 'middle' });
  line('M 800 386 L 800 404', {});
  rect(490, 410, 620, 74, 12, c.box, c.border);
  text(510, 440, t.fuseTitle, { fs: 14, w: 650 });
  text(510, 466, t.fuseDesc, { fs: 11.5, fill: c.muted });
  line('M 800 484 L 800 500', {});
  push(`  <polygon points="800,506 872,558 800,610 728,558" fill="${c.amberSoft}" stroke="${c.amber}" stroke-width="1.5"/>`);
  text(800, 563, t.gate, { fs: 12.5, w: 650, anchor: 'middle' });
  // abstain
  rect(500, 518, 200, 80, 11, c.redSoft, c.red);
  text(600, 548, t.abstainTitle, { fs: 13, w: 650, fill: c.red, anchor: 'middle' });
  text(600, 572, t.abstainLine, { fs: 11, fill: c.muted, anchor: 'middle' });
  line('M 724 558 L 706 558', {});
  // envelope
  rect(900, 518, 210, 80, 11, c.greenSoft, c.green);
  if (t.envT2) {
    text(1005, 542, t.envT1, { fs: 13, w: 650, fill: c.green, anchor: 'middle' });
    text(1005, 558, t.envT2, { fs: 13, w: 650, fill: c.green, anchor: 'middle' });
    text(1005, 580, t.envLine, { fs: 11, fill: c.muted, anchor: 'middle' });
  } else {
    text(1005, 548, t.envT1, { fs: 13, w: 650, fill: c.green, anchor: 'middle' });
    text(1005, 574, t.envLine, { fs: 11, fill: c.muted, anchor: 'middle' });
  }
  line('M 876 558 L 894 558', { marker: 'accent', stroke: c.blue });
  // envelope -> agent verify
  line('M 1110 558 L 1160 558 L 1160 338 L 1204 338', { marker: 'accent', stroke: c.blue });

  // Agent column
  const ab = (y, h, title, l1, l2, titleFs = 14) => {
    rect(1210, y, 330, h, 12, c.box, c.border);
    text(1228, y + 30, title, { fs: titleFs, w: 650 });
    if (l1) text(1228, y + 54, l1, { fs: 11.5, fill: c.muted });
    if (l2) text(1228, y + 72, l2, { fs: 11.5, fill: c.muted });
  };
  ab(170, 92, t.askTitle, t.askL1, t.askL2);
  ab(292, 92, t.verifyTitle, t.verifyL1, t.verifyL2);
  rect(1210, 414, 330, 64, 12, c.box, c.border);
  text(1228, 440, t.fbTitle, { fs: 12.5, w: 650 });
  text(1228, 462, t.fbLine, { fs: 11, fill: c.muted });
  ab(508, 92, t.writeTitle, t.writeL1, t.writeL2);

  // recall arrow agent -> engine (two-line label fits the 60px gap between containers)
  text(1160, 192, 'ownmem', { fs: 10.5, fill: c.muted, anchor: 'middle', mono: true });
  text(1160, 205, 'recall', { fs: 10.5, fill: c.muted, anchor: 'middle', mono: true });
  line('M 1204 216 L 1136 216 ', { marker: 'accent', stroke: c.blue });

  // write loop back to repository
  line('M 1375 600 L 1375 716 L 225 716 L 225 688', { dash: '6 6', sw: 1.5 });
  text(800, 706, t.loopLabel, { fs: 11, fill: c.muted, anchor: 'middle' });

  // hosts bar
  rect(40, 744, 1520, 64, 12, c.panel, c.border);
  text(800, 770, t.hostsTitle, { fs: 14, w: 650, anchor: 'middle' });
  text(800, 792, t.hostsList, { fs: 12, fill: c.muted, anchor: 'middle' });

  // footnote
  text(40, 840, t.footnote, { fs: 11, fill: c.muted });

  push('</svg>');
  return p.join('\n') + '\n';
}

for (const locale of Object.keys(LOCALES)) {
  for (const theme of Object.keys(THEMES)) {
    const suffix = locale === 'en' ? '' : `-${locale}`;
    const file = path.join(OUT, `architecture${suffix}-${theme}.svg`);
    writeFileSync(file, render(locale, theme), 'utf8');
    console.log('wrote', path.basename(file));
  }
}
