#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.dirname(fileURLToPath(import.meta.url));
mkdirSync(OUT, { recursive: true });

const THEMES = {
  light: {
    bg: '#f4f7ff', panel: '#ffffff', soft: '#f8fafc', ink: '#0f172a', muted: '#526176',
    border: '#cbd5e1', blue: '#2563eb', blueSoft: '#eff6ff', green: '#166534',
    greenSoft: '#f0fdf4', amber: '#9a3412', amberSoft: '#fff7ed', navy: '#0f172a',
    navyBox: '#1e293b', navyBorder: '#475569', navyText: '#f8fafc', navyMuted: '#cbd5e1',
  },
  dark: {
    bg: '#0b1020', panel: '#111827', soft: '#172033', ink: '#f8fafc', muted: '#a8b3c7',
    border: '#334155', blue: '#60a5fa', blueSoft: '#172554', green: '#86efac',
    greenSoft: '#132a22', amber: '#fdba74', amberSoft: '#352114', navy: '#060b16',
    navyBox: '#111827', navyBorder: '#334155', navyText: '#f8fafc', navyMuted: '#cbd5e1',
  },
};

const LOCALES = {
  en: {
    title: 'OwnMem architecture', subtitle: 'Repository-owned · local recall · evidence governance · no unattended writes',
    desc: 'Repository-owned Markdown and independent trust receipts compile into immutable snapshots. Five deterministic local candidate lanes and an optional embedding lane pass four delivery gates, and the envelope arrives in one of three tiers: the memory quoted, up to three pointers, or an abstention that names its reason. Local feedback ledgers, an evaluation harness and a net-zero quota bound what the corpus becomes, and nothing enters memory without a person committing it.',
    pill: 'Default recall: 0 model calls · 0 network calls', host: 'HOST LAYER', entry: 'Unified project entry', entryDesc: 'instructions · skills · commands · hook · MCP',
    repo: '01 · REPOSITORY SOURCE OF TRUTH', repoDesc: 'Human-readable · Git-reviewable · reversible',
    trustDesc: 'hash · evidence · lifecycle', auditDesc: 'quota · dedupe · schema',
    runtime: '02 · CANONICAL RUNTIME', compileDesc: 'schema · graph · receipts · live evidence',
    embed: 'Optional embedding: observe / weight 0 until local A/B passes', gatesDesc: 'relevance · validity · applicability · risk',
    delivery: '03 · GRADED DELIVERY', envelopeDesc: 'names its tier · ≤1 topic · 400 tokens',
    tierContent: 'content', tierContentDesc: 'the memory quoted, with provenance',
    tierPointers: 'pointers', tierPointersDesc: '≤3 · where to look, not an answer',
    tierAbstain: 'abstain', tierAbstainDesc: 'nothing, and the reason why',
    agentDesc: 'verify against current code and docs',
    governance: '04 · LOCAL FEEDBACK AND BOUNDED GROWTH', ledgerDesc: 'retrieval · confirmed outcome · self-attribution',
    evalTitle: 'Evaluation harness', evalDesc: 'outside questions · ablation · holdout',
    quotaTitle: 'Net-zero quota', quotaDesc: 'entry count · ratchets down only',
    noAuto: 'No unattended write', noAutoDesc: 'the package measures and proposes; a person commits',
  },
  'zh-CN': {
    title: 'OwnMem 总架构', subtitle: '仓库拥有 · 本地召回 · 证据治理 · 无人值守写入为零',
    desc: '仓库拥有的 Markdown 与独立信任收据编译成不可变快照。五路确定性本地候选和可选 embedding 通道经过四道交付门，信封按三档之一交付：引用记忆正文、给最多三条指针、或说明原因后弃权。本地反馈账本、评测台与净零增长配额约束语料的走向；没有人提交，任何内容都进不了记忆。',
    pill: '默认召回：0 模型调用 · 0 网络请求', host: '宿主层', entry: '统一项目入口', entryDesc: '项目指令 · skills · commands · hook · MCP',
    repo: '01 · 仓库真源', repoDesc: '人类可读 · Git 可审阅 · 可撤销', trustDesc: '内容哈希 · 证据 · 生命周期', auditDesc: '配额 · 去重 · Schema',
    runtime: '02 · 统一运行时', compileDesc: 'Schema · 图关系 · 收据 · 活体证据', embed: '可选 embedding：默认 observe / 权重 0，本地 A/B 过门后才加入', gatesDesc: '相关性 · 有效性 · 适用性 · 风险',
    delivery: '03 · 分档交付', envelopeDesc: '自报档位 · 最多 1 个 topic · 400 token',
    tierContent: 'content', tierContentDesc: '引用记忆正文，带出处',
    tierPointers: 'pointers', tierPointersDesc: '最多 3 条 · 是线索不是答案',
    tierAbstain: 'abstain', tierAbstainDesc: '什么都不给，并说明为什么',
    agentDesc: '再对照当前代码和文档复核',
    governance: '04 · 本地反馈与有界增长', ledgerDesc: '检索反馈 · 确认结局 · Agent 自归因',
    evalTitle: 'Evaluation harness', evalDesc: '外源出题 · 消融 · 留出集',
    quotaTitle: 'Net-zero quota', quotaDesc: '条目数上限 · 只降不升',
    noAuto: '没有无人值守写入', noAutoDesc: '这个包只度量和提议，提交由人来做',
  },
  'zh-TW': {
    title: 'OwnMem 總架構', subtitle: '儲存庫擁有 · 本機召回 · 證據治理 · 無人值守寫入為零',
    desc: '儲存庫擁有的 Markdown 與獨立信任收據編譯成不可變快照。五路確定性本機候選和可選 embedding 通道經過四道交付門，信封按三檔之一交付：引用記憶正文、給最多三條指標、或說明原因後棄權。本機回饋帳本、評測台與淨零成長配額約束語料的走向；沒有人提交，任何內容都進不了記憶。',
    pill: '預設召回：0 模型呼叫 · 0 網路請求', host: '宿主層', entry: '統一專案入口', entryDesc: '專案指令 · skills · commands · hook · MCP',
    repo: '01 · 儲存庫真源', repoDesc: '人類可讀 · Git 可審閱 · 可撤銷', trustDesc: '內容雜湊 · 證據 · 生命週期', auditDesc: '配額 · 去重 · Schema',
    runtime: '02 · 統一執行期', compileDesc: 'Schema · 圖關係 · 收據 · 即時證據', embed: '可選 embedding：預設 observe / 權重 0，本機 A/B 通過後才加入', gatesDesc: '相關性 · 有效性 · 適用性 · 風險',
    delivery: '03 · 分檔交付', envelopeDesc: '自報檔位 · 最多 1 個 topic · 400 token',
    tierContent: 'content', tierContentDesc: '引用記憶正文，帶出處',
    tierPointers: 'pointers', tierPointersDesc: '最多 3 條 · 是線索不是答案',
    tierAbstain: 'abstain', tierAbstainDesc: '什麼都不給，並說明為什麼',
    agentDesc: '再對照目前程式碼與文件複核',
    governance: '04 · 本機回饋與有界成長', ledgerDesc: '檢索回饋 · 確認結果 · Agent 自歸因',
    evalTitle: 'Evaluation harness', evalDesc: '外源出題 · 消融 · 留出集',
    quotaTitle: 'Net-zero quota', quotaDesc: '條目數上限 · 只降不升',
    noAuto: '沒有無人值守寫入', noAutoDesc: '這個套件只度量與提議，提交由人來做',
  },
  ja: {
    title: 'OwnMem アーキテクチャ', subtitle: 'リポジトリ所有 · ローカル想起 · 証拠ガバナンス · 無人書き込みなし',
    desc: 'リポジトリ所有の Markdown と独立した信頼 receipt を不変 snapshot にコンパイルする。5 本の決定的ローカル候補と任意の embedding lane が 4 つの配信 gate を通り、envelope は 3 つの tier のいずれかで届く。記憶本文の引用、最大 3 件のポインタ、または理由を明示した棄権である。ローカルの feedback 台帳、評価ハーネス、純増ゼロの quota がコーパスの行き先を縛る。人が commit しない限り、何も記憶には入らない。',
    pill: '既定 recall：モデル 0 · ネットワーク 0', host: 'HOST LAYER', entry: '統一プロジェクト入口', entryDesc: 'instructions · skills · commands · hook · MCP',
    repo: '01 · REPOSITORY SOURCE', repoDesc: '可読 · Git review · 取り消し可能', trustDesc: 'hash · evidence · lifecycle', auditDesc: 'quota · dedupe · Schema',
    runtime: '02 · CANONICAL RUNTIME', compileDesc: 'Schema · graph · receipts · live evidence', embed: '任意 embedding：observe / weight 0、local A/B 合格後のみ参加', gatesDesc: 'relevance · validity · applicability · risk',
    delivery: '03 · 段階的な配信', envelopeDesc: 'tier を自己申告 · 最大 1 topic · 400 token',
    tierContent: 'content', tierContentDesc: '記憶本文を出典つきで引用',
    tierPointers: 'pointers', tierPointersDesc: '最大 3 件 · 手がかりであって答えではない',
    tierAbstain: 'abstain', tierAbstainDesc: '何も返さず、理由を述べる',
    agentDesc: '現在の code と docs で再検証',
    governance: '04 · ローカル feedback と有界な成長', ledgerDesc: 'retrieval · confirmed outcome · self-attribution',
    evalTitle: 'Evaluation harness', evalDesc: '外部出題 · ablation · holdout',
    quotaTitle: 'Net-zero quota', quotaDesc: '件数上限 · 下げる方向のみ',
    noAuto: '無人の書き込みはしない', noAutoDesc: '計測と提案までが本パッケージ、commit は人が行う',
  },
  ko: {
    title: 'OwnMem 아키텍처', subtitle: '저장소 소유 · 로컬 회상 · 증거 거버넌스 · 무인 쓰기 없음',
    desc: '저장소가 소유한 Markdown과 독립 trust receipt를 불변 snapshot으로 compile한다. 5개의 결정적 로컬 후보 lane과 선택적 embedding lane이 4개의 전달 gate를 통과하고, envelope은 세 tier 중 하나로 도착한다. 기억 본문 인용, 최대 3개의 포인터, 또는 이유를 밝힌 기권이다. 로컬 feedback 원장, 평가 하네스, 순증가 0 quota가 코퍼스의 방향을 묶는다. 사람이 commit하지 않으면 어떤 것도 기억에 들어가지 않는다.',
    pill: '기본 recall: 모델 0 · 네트워크 0', host: 'HOST LAYER', entry: '통합 프로젝트 입구', entryDesc: 'instructions · skills · commands · hook · MCP',
    repo: '01 · REPOSITORY SOURCE', repoDesc: '읽기 가능 · Git review · 되돌리기 가능', trustDesc: 'hash · evidence · lifecycle', auditDesc: 'quota · dedupe · Schema',
    runtime: '02 · CANONICAL RUNTIME', compileDesc: 'Schema · graph · receipts · live evidence', embed: '선택적 embedding: observe / weight 0, local A/B 통과 후 참여', gatesDesc: 'relevance · validity · applicability · risk',
    delivery: '03 · 등급별 전달', envelopeDesc: 'tier를 스스로 밝힘 · 최대 1 topic · 400 token',
    tierContent: 'content', tierContentDesc: '기억 본문을 출처와 함께 인용',
    tierPointers: 'pointers', tierPointersDesc: '최대 3개 · 단서일 뿐 답이 아님',
    tierAbstain: 'abstain', tierAbstainDesc: '아무것도 주지 않고 이유를 밝힘',
    agentDesc: '현재 code와 docs로 다시 검증',
    governance: '04 · 로컬 feedback과 제한된 성장', ledgerDesc: 'retrieval · confirmed outcome · self-attribution',
    evalTitle: 'Evaluation harness', evalDesc: '외부 출제 · ablation · holdout',
    quotaTitle: 'Net-zero quota', quotaDesc: '항목 수 상한 · 낮추는 방향만',
    noAuto: '무인 쓰기는 없다', noAutoDesc: '이 패키지는 측정하고 제안할 뿐, commit은 사람이 한다',
  },
  es: {
    title: 'Arquitectura de OwnMem', subtitle: 'Propiedad del repositorio · recall local · evidencia · sin escrituras desatendidas',
    desc: 'El Markdown que pertenece al repositorio y los trust receipts independientes se compilan en snapshots inmutables. Cinco canales deterministas locales y un canal opcional de embeddings atraviesan cuatro puertas de entrega, y el sobre llega en uno de tres niveles: la memoria citada, hasta tres punteros, o una abstención que dice por qué. Los libros de feedback local, el banco de evaluación y una cuota de crecimiento neto cero acotan en qué se convierte el corpus; nada entra en la memoria sin que alguien lo confirme con un commit.',
    pill: 'Recall por defecto: 0 modelos · 0 red', host: 'CAPA DE HOSTS', entry: 'Entrada unificada del proyecto', entryDesc: 'instrucciones · skills · commands · hook · MCP',
    repo: '01 · FUENTE DEL REPOSITORIO', repoDesc: 'Legible · revisable en Git · reversible', trustDesc: 'hash · evidencia · ciclo', auditDesc: 'cuota · duplicados · Schema',
    runtime: '02 · RUNTIME CANÓNICO', compileDesc: 'Schema · grafo · receipts · evidencia viva', embed: 'embedding opcional: observe / peso 0 hasta superar A/B local', gatesDesc: 'relevancia · validez · aplicabilidad · riesgo',
    delivery: '03 · ENTREGA POR NIVELES', envelopeDesc: 'declara su nivel · ≤1 tema · 400 tokens',
    tierContent: 'content', tierContentDesc: 'la memoria citada, con procedencia',
    tierPointers: 'pointers', tierPointersDesc: '≤3 · dónde mirar, no la respuesta',
    tierAbstain: 'abstain', tierAbstainDesc: 'nada, y el motivo',
    agentDesc: 'verificar contra código y docs actuales',
    governance: '04 · FEEDBACK LOCAL Y CRECIMIENTO ACOTADO', ledgerDesc: 'retrieval · outcome confirmado · autoatribución',
    evalTitle: 'Evaluation harness', evalDesc: 'preguntas externas · ablación · holdout',
    quotaTitle: 'Net-zero quota', quotaDesc: 'número de entradas · solo baja',
    noAuto: 'Ninguna escritura desatendida', noAutoDesc: 'el paquete mide y propone; una persona hace el commit',
  },
  fr: {
    title: 'Architecture OwnMem', subtitle: 'Mémoire du dépôt · rappel local · preuves · aucune écriture automatique',
    desc: 'Le Markdown détenu par le dépôt et des trust receipts indépendants sont compilés en snapshots immuables. Cinq canaux locaux déterministes et un canal d’embeddings optionnel franchissent quatre portes de livraison, et l’enveloppe arrive selon l’un de trois niveaux : la mémoire citée, jusqu’à trois pointeurs, ou une abstention qui en donne la raison. Les registres de retour locaux, le banc d’évaluation et un quota à croissance nette nulle bornent ce que devient le corpus ; rien n’entre en mémoire sans qu’une personne le valide par un commit.',
    pill: 'Rappel par défaut : 0 modèle · 0 réseau', host: 'COUCHE HOST', entry: 'Entrée projet unifiée', entryDesc: 'instructions · skills · commands · hook · MCP',
    repo: '01 · SOURCE DU DÉPÔT', repoDesc: 'Lisible · révisable dans Git · réversible', trustDesc: 'hash · preuves · cycle', auditDesc: 'quota · doublons · Schema',
    runtime: '02 · RUNTIME CANONIQUE', compileDesc: 'Schema · graphe · receipts · preuves vivantes', embed: 'embedding optionnel : observe / poids 0 avant A/B local', gatesDesc: 'pertinence · validité · applicabilité · risque',
    delivery: '03 · LIVRAISON PAR NIVEAUX', envelopeDesc: 'annonce son niveau · ≤1 sujet · 400 tokens',
    tierContent: 'content', tierContentDesc: 'la mémoire citée, avec provenance',
    tierPointers: 'pointers', tierPointersDesc: '≤3 · où chercher, pas la réponse',
    tierAbstain: 'abstain', tierAbstainDesc: 'rien, et pourquoi',
    agentDesc: 'vérifier avec le code et les docs actuels',
    governance: '04 · RETOURS LOCAUX ET CROISSANCE BORNÉE', ledgerDesc: 'retrieval · outcome confirmé · auto-attribution',
    evalTitle: 'Evaluation harness', evalDesc: 'questions externes · ablation · holdout',
    quotaTitle: 'Net-zero quota', quotaDesc: 'nombre d’entrées · ne fait que baisser',
    noAuto: 'Aucune écriture automatique', noAutoDesc: 'le paquet mesure et propose ; une personne valide',
  },
  de: {
    title: 'OwnMem-Architektur', subtitle: 'Repository-eigen · lokaler Recall · Evidenz · keine unbeaufsichtigten Schreibvorgänge',
    desc: 'Repository-eigenes Markdown und unabhängige Trust Receipts werden zu unveränderlichen Snapshots kompiliert. Fünf deterministische lokale Kanäle und ein optionaler Embedding-Kanal passieren vier Auslieferungstore, und der Umschlag kommt in einer von drei Stufen an: die zitierte Erinnerung, bis zu drei Verweise oder eine Enthaltung mit Begründung. Lokale Feedback-Register, ein Evaluationsstand und eine Netto-Null-Quote begrenzen, wozu der Korpus wird; ohne den Commit eines Menschen gelangt nichts in die Erinnerung.',
    pill: 'Standard-Recall: 0 Modelle · 0 Netzwerk', host: 'HOST-SCHICHT', entry: 'Einheitlicher Projekteinstieg', entryDesc: 'Anweisungen · Skills · Commands · Hook · MCP',
    repo: '01 · REPOSITORY-QUELLE', repoDesc: 'Lesbar · Git-reviewbar · reversibel', trustDesc: 'Hash · Evidenz · Lifecycle', auditDesc: 'Quota · Duplikate · Schema',
    runtime: '02 · CANONICAL RUNTIME', compileDesc: 'Schema · Graph · Receipts · Live-Evidenz', embed: 'Optionales Embedding: observe / Gewicht 0 bis lokales A/B besteht', gatesDesc: 'Relevanz · Gültigkeit · Anwendbarkeit · Risiko',
    delivery: '03 · ABGESTUFTE AUSLIEFERUNG', envelopeDesc: 'nennt ihre Stufe · ≤1 Topic · 400 Tokens',
    tierContent: 'content', tierContentDesc: 'die Erinnerung zitiert, mit Herkunft',
    tierPointers: 'pointers', tierPointersDesc: '≤3 · wo zu suchen ist, keine Antwort',
    tierAbstain: 'abstain', tierAbstainDesc: 'nichts, und der Grund dafür',
    agentDesc: 'gegen aktuellen Code und Docs prüfen',
    governance: '04 · LOKALES FEEDBACK UND BEGRENZTES WACHSTUM', ledgerDesc: 'Retrieval · bestätigtes Outcome · Selbstzuordnung',
    evalTitle: 'Evaluation harness', evalDesc: 'externe Fragen · Ablation · Holdout',
    quotaTitle: 'Net-zero quota', quotaDesc: 'Anzahl Einträge · nur abwärts',
    noAuto: 'Kein unbeaufsichtigtes Schreiben', noAutoDesc: 'das Paket misst und schlägt vor; ein Mensch committet',
  },
  'pt-BR': {
    title: 'Arquitetura do OwnMem', subtitle: 'Memória do repositório · recall local · evidência · nenhuma escrita automática',
    desc: 'O Markdown que pertence ao repositório e trust receipts independentes são compilados em snapshots imutáveis. Cinco canais locais determinísticos e um canal opcional de embeddings passam por quatro portões de entrega, e o envelope chega em um de três níveis: a memória citada, até três ponteiros, ou uma abstenção que diz o motivo. Os livros de feedback local, o banco de avaliação e uma cota de crescimento líquido zero limitam no que o corpus se torna; nada entra na memória sem que alguém faça o commit.',
    pill: 'Recall padrão: 0 modelos · 0 rede', host: 'CAMADA DE HOSTS', entry: 'Entrada unificada do projeto', entryDesc: 'instruções · skills · commands · hook · MCP',
    repo: '01 · FONTE DO REPOSITÓRIO', repoDesc: 'Legível · revisável no Git · reversível', trustDesc: 'hash · evidência · ciclo', auditDesc: 'cota · duplicatas · Schema',
    runtime: '02 · RUNTIME CANÔNICO', compileDesc: 'Schema · grafo · receipts · evidência viva', embed: 'embedding opcional: observe / peso 0 até passar A/B local', gatesDesc: 'relevância · validade · aplicabilidade · risco',
    delivery: '03 · ENTREGA EM NÍVEIS', envelopeDesc: 'declara seu nível · ≤1 tópico · 400 tokens',
    tierContent: 'content', tierContentDesc: 'a memória citada, com procedência',
    tierPointers: 'pointers', tierPointersDesc: '≤3 · onde olhar, não a resposta',
    tierAbstain: 'abstain', tierAbstainDesc: 'nada, e o motivo',
    agentDesc: 'verificar com código e docs atuais',
    governance: '04 · FEEDBACK LOCAL E CRESCIMENTO LIMITADO', ledgerDesc: 'retrieval · outcome confirmado · autoatribuição',
    evalTitle: 'Evaluation harness', evalDesc: 'perguntas externas · ablação · holdout',
    quotaTitle: 'Net-zero quota', quotaDesc: 'número de entradas · só diminui',
    noAuto: 'Nenhuma escrita automática', noAutoDesc: 'o pacote mede e propõe; uma pessoa faz o commit',
  },
};

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Arial, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const esc = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function render(locale, themeName) {
  const t = LOCALES[locale];
  const c = THEMES[themeName];
  const lines = [];
  const push = (value) => lines.push(value);
  const rect = (x, y, width, height, radius, fill, stroke = null, extra = '') => push(`  <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="1.4"` : ''}${extra}/>`);
  const text = (x, y, value, size = 13, weight = 400, fill = c.ink, anchor = 'start', mono = false) => push(`  <text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${size}" font-weight="${weight}"${mono ? ` font-family="${MONO}"` : ''} fill="${fill}">${esc(value)}</text>`);
  const arrow = (d, blue = false, dash = false) => push(`  <path d="${d}" fill="none" stroke="${blue ? c.blue : c.muted}" stroke-width="2"${dash ? ' stroke-dasharray="7 6"' : ''} marker-end="url(#${blue ? 'arrowBlue' : 'arrow'})"/>`);
  const smallBox = (x, y, width, title, description, tone = 'plain') => {
    const fill = tone === 'blue' ? c.blueSoft : tone === 'green' ? c.greenSoft : tone === 'amber' ? c.amberSoft : c.soft;
    const stroke = tone === 'blue' ? c.blue : tone === 'green' ? c.green : tone === 'amber' ? c.amber : c.border;
    rect(x, y, width, 62, 11, fill, stroke);
    text(x + 16, y + 25, title, 13.5, 700, tone === 'blue' ? c.blue : tone === 'green' ? c.green : tone === 'amber' ? c.amber : c.ink);
    text(x + 16, y + 47, description, 11.5, 400, c.muted);
  };
  // One delivery tier: the machine-readable name on the left, what the agent actually receives on
  // the right. The three sit in one column because the reader has to see them as alternatives --
  // drawn as three separate cards they read as three things that happen, which is the exact
  // misreading the pointer tier exists to prevent.
  const tierRow = (x, y, width, label, description, tone) => {
    const fill = tone === 'blue' ? c.blueSoft : tone === 'amber' ? c.amberSoft : c.soft;
    const stroke = tone === 'blue' ? c.blue : tone === 'amber' ? c.amber : c.border;
    const accent = tone === 'blue' ? c.blue : tone === 'amber' ? c.amber : c.muted;
    rect(x, y, width, 34, 9, fill, stroke);
    text(x + 14, y + 22, label, 11.5, 700, accent, 'start', true);
    text(x + width - 14, y + 22, description, 10.5, 400, c.muted, 'end');
  };

  push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 980" role="img" aria-labelledby="title description" font-family="${FONT}">`);
  push(`  <title id="title">${esc(t.title)}</title>`);
  push(`  <desc id="description">${esc(t.desc)}</desc>`);
  push('  <defs>');
  push(`    <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1 L 8 5 L 0 9 z" fill="${c.muted}"/></marker>`);
  push(`    <marker id="arrowBlue" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1 L 8 5 L 0 9 z" fill="${c.blue}"/></marker>`);
  push('  </defs>');
  rect(0, 0, 1600, 980, 28, c.bg);
  text(52, 58, t.title, 27, 750);
  text(52, 88, t.subtitle, 14, 500, c.muted);
  rect(1130, 34, 418, 44, 22, c.blueSoft, c.blue);
  text(1339, 62, t.pill, 13, 650, c.blue, 'middle');

  rect(52, 120, 1496, 108, 18, c.panel, c.border);
  text(78, 150, t.host, 12, 750, c.muted);
  const hosts = [['Claude Code', 78, 160], ['Codex', 250, 136], ['Cursor', 402, 136], ['Gemini CLI', 554, 160], ['Other Agents', 730, 170]];
  for (const [label, x, width] of hosts) { rect(x, 168, width, 38, 10, c.soft, c.border); text(x + width / 2, 192, label, 12.5, 650, c.ink, 'middle'); }
  arrow('M 916 187 L 962 187');
  rect(982, 150, 536, 64, 13, c.blueSoft, c.blue);
  text(1250, 177, t.entry, 14, 700, c.blue, 'middle');
  text(1250, 199, t.entryDesc, 11.5, 400, c.muted, 'middle', true);
  arrow('M 800 228 L 800 258', true);

  rect(52, 274, 420, 420, 18, c.panel, c.border);
  text(78, 306, t.repo, 12, 750, c.muted);
  text(78, 342, '.ownmem/', 22, 750);
  text(78, 367, t.repoDesc, 12.5, 400, c.muted);
  smallBox(78, 394, 368, 'L1 · MEMORY.md', 'routing index · always-small contract');
  smallBox(78, 468, 368, 'L2 · MEMORY-<area>.md', 'area index · scoped loading');
  smallBox(78, 542, 368, 'L3 · topic.md', 'one lesson · triggers · evidence');
  smallBox(78, 620, 178, 'Trust receipt', t.trustDesc, 'amber');
  smallBox(268, 620, 178, 'Audit gates', t.auditDesc, 'green');

  rect(500, 274, 666, 420, 18, c.panel, c.blue);
  text(526, 306, t.runtime, 12, 750, c.blue);
  smallBox(526, 330, 614, 'Compile', t.compileDesc, 'blue');
  arrow('M 833 392 L 833 416', true);
  rect(724, 420, 218, 42, 11, c.blue, null);
  text(833, 446, 'Immutable snapshot', 13, 700, '#ffffff', 'middle');
  text(526, 490, 'Candidate recall', 14, 700);
  const lanes = ['exact', 'BM25F', 'n-gram', 'fuzzy', 'graph'];
  lanes.forEach((label, index) => { const x = 526 + index * 116; rect(x, 506, 104, 36, 9, c.soft, c.border); text(x + 52, 529, label, 11.5, 650, c.ink, 'middle', true); });
  rect(526, 552, 568, 36, 9, c.blueSoft, c.blue, ' stroke-dasharray="5 4"');
  text(810, 575, t.embed, 11.5, 600, c.blue, 'middle');
  smallBox(526, 606, 274, 'Fuse + rank', 'deterministic · dedupe · bounded');
  arrow('M 800 637 L 830 637');
  smallBox(846, 606, 294, 'Four delivery gates', t.gatesDesc, 'amber');

  rect(1194, 274, 354, 420, 18, c.panel, c.border);
  text(1220, 306, t.delivery, 12, 750, c.muted);
  smallBox(1220, 336, 302, 'Context envelope', t.envelopeDesc, 'blue');
  arrow('M 1166 486 L 1194 486', true);
  tierRow(1220, 412, 302, t.tierContent, t.tierContentDesc, 'blue');
  tierRow(1220, 452, 302, t.tierPointers, t.tierPointersDesc, 'amber');
  tierRow(1220, 492, 302, t.tierAbstain, t.tierAbstainDesc, 'plain');
  smallBox(1220, 542, 302, 'Coding agent', t.agentDesc);
  text(1371, 630, 'completed → delivered → consumed', 11.5, 500, c.muted, 'middle', true);

  rect(52, 736, 1496, 188, 18, c.navy);
  text(78, 770, t.governance, 12, 750, c.blue);
  const gov = [
    [78, 'Three ledgers', t.ledgerDesc],
    [382, t.evalTitle, t.evalDesc],
    [686, t.quotaTitle, t.quotaDesc],
  ];
  for (const [x, title, description] of gov) {
    rect(x, 792, 274, 96, 13, c.navyBox, c.navyBorder);
    text(x + 137, 824, title, 13.5, 700, c.navyText, 'middle');
    text(x + 137, 851, description, 11.2, 400, c.navyMuted, 'middle');
  }
  arrow('M 352 840 L 372 840', true);
  arrow('M 656 840 L 676 840', true);
  arrow('M 960 840 L 980 840', true);
  // The band ends at a person, not at a write-back arrow into the repository. An arrow closing that
  // loop is what the previous revision drew, and it is precisely the claim this package no longer
  // makes: measurement and nomination end here, and the next edit is somebody's commit.
  rect(990, 792, 532, 96, 13, c.blueSoft, c.blue);
  text(1256, 824, t.noAuto, 14, 750, c.blue, 'middle');
  text(1256, 851, t.noAutoDesc, 11.5, 500, c.muted, 'middle');
  text(1256, 874, 'recall → report → audit refuses → your commit', 10.8, 500, c.muted, 'middle', true);
  push('</svg>');
  return `${lines.join('\n')}\n`;
}

for (const locale of Object.keys(LOCALES)) {
  for (const theme of Object.keys(THEMES)) {
    const suffix = locale === 'en' ? '' : `-${locale}`;
    const name = `architecture${suffix}-${theme}.svg`;
    writeFileSync(path.join(OUT, name), render(locale, theme), 'utf8');
    process.stdout.write(`wrote ${name}\n`);
  }
}
