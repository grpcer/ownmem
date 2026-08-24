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
    title: 'OwnMem architecture', subtitle: 'Repository-owned · local recall · evidence governance · bounded autonomy',
    desc: 'Repository-owned Markdown and independent trust receipts compile into immutable snapshots. Five deterministic local candidate lanes and an optional embedding lane pass four delivery gates. An end-of-turn coordinator replays, promotes, observes, quarantines, and precisely rolls back low-risk R0 changes while higher-risk changes remain review material.',
    pill: 'Default recall: 0 model calls · 0 network calls', host: 'HOST LAYER', entry: 'Unified project entry', entryDesc: 'instructions · skills · commands · hook',
    repo: '01 · REPOSITORY SOURCE OF TRUTH', repoDesc: 'Human-readable · Git-reviewable · reversible',
    trustDesc: 'content hash · evidence · lifecycle', auditDesc: 'quota · dedupe · schema',
    runtime: '02 · CANONICAL RUNTIME', compileDesc: 'schema · graph · receipts · live evidence',
    embed: 'Optional embedding: observe / weight 0 until local A/B passes', gatesDesc: 'relevance · validity · applicability · risk',
    delivery: '03 · TRUSTED DELIVERY', envelopeDesc: '≤1 topic · 400 tokens · provenance', agentDesc: 'verify against current code and docs', obsDesc: 'confirmed adoption is a separate outcome',
    governance: '04 · LOCAL FEEDBACK AND BOUNDED EVOLUTION', ledgerDesc: 'retrieval · confirmed outcome · self-attribution', candidateDesc: 'candidate ≠ memory · quarantine by default', riskDesc: 'replay · regression · quota · tripwire',
    auto: 'R0 auto-write · R1–R5 review', autoDesc: 'failures quarantine and restore exact previous bytes',
  },
  'zh-CN': {
    title: 'OwnMem 总架构', subtitle: '仓库拥有 · 本地召回 · 证据治理 · 有界自治',
    desc: '仓库拥有的 Markdown 与独立信任收据编译成不可变快照。五路确定性本地候选和可选 embedding 通道经过四道交付门。轮末协调器对低风险 R0 变化进行回放、晋升、观察、隔离和精确回滚，高风险变化进入复审。',
    pill: '默认召回：0 模型调用 · 0 网络请求', host: '宿主层', entry: '统一项目入口', entryDesc: '项目指令 · skills · commands · hook',
    repo: '01 · 仓库真源', repoDesc: '人类可读 · Git 可审阅 · 可撤销', trustDesc: '内容哈希 · 证据 · 生命周期', auditDesc: '配额 · 去重 · Schema',
    runtime: '02 · 统一运行时', compileDesc: 'Schema · 图关系 · 收据 · 活体证据', embed: '可选 embedding：默认 observe / 权重 0，本地 A/B 过门后才加入', gatesDesc: '相关性 · 有效性 · 适用性 · 风险',
    delivery: '03 · 可信交付', envelopeDesc: '最多 1 个 topic · 400 token · 来源', agentDesc: '再对照当前代码和文档复核', obsDesc: '真实采用只认独立 outcome',
    governance: '04 · 本地反馈与有界演化', ledgerDesc: '检索反馈 · 确认结局 · Agent 自归因', candidateDesc: 'candidate ≠ memory · 默认隔离', riskDesc: '回放 · 回归 · 配额 · tripwire',
    auto: 'R0 自动写回 · R1–R5 复审', autoDesc: '失败先隔离，再精确恢复原字节',
  },
  'zh-TW': {
    title: 'OwnMem 總架構', subtitle: '儲存庫擁有 · 本機召回 · 證據治理 · 有界自治',
    desc: '儲存庫擁有的 Markdown 與獨立信任收據編譯成不可變快照。五路確定性本機候選和可選 embedding 通道經過四道交付門。輪末協調器對低風險 R0 變更進行回放、晉升、觀察、隔離與精確回復，高風險變更進入複審。',
    pill: '預設召回：0 模型呼叫 · 0 網路請求', host: '宿主層', entry: '統一專案入口', entryDesc: '專案指令 · skills · commands · hook',
    repo: '01 · 儲存庫真源', repoDesc: '人類可讀 · Git 可審閱 · 可撤銷', trustDesc: '內容雜湊 · 證據 · 生命週期', auditDesc: '配額 · 去重 · Schema',
    runtime: '02 · 統一執行期', compileDesc: 'Schema · 圖關係 · 收據 · 即時證據', embed: '可選 embedding：預設 observe / 權重 0，本機 A/B 通過後才加入', gatesDesc: '相關性 · 有效性 · 適用性 · 風險',
    delivery: '03 · 可信交付', envelopeDesc: '最多 1 個 topic · 400 token · 來源', agentDesc: '再對照目前程式碼與文件複核', obsDesc: '真實採用只認獨立 outcome',
    governance: '04 · 本機回饋與有界演化', ledgerDesc: '檢索回饋 · 確認結果 · Agent 自歸因', candidateDesc: 'candidate ≠ memory · 預設隔離', riskDesc: '回放 · 回歸 · 配額 · tripwire',
    auto: 'R0 自動寫回 · R1–R5 複審', autoDesc: '失敗先隔離，再精確恢復原位元組',
  },
  ja: {
    title: 'OwnMem アーキテクチャ', subtitle: 'リポジトリ所有 · ローカル想起 · 証拠ガバナンス · 制限付き自律',
    desc: 'リポジトリ所有の Markdown と独立した信頼 receipt を不変 snapshot にコンパイルする。5 本の決定的ローカル候補と任意の embedding lane が 4 つの配信 gate を通る。turn 終了 coordinator は低リスク R0 を replay、昇格、観測、隔離し正確に rollback し、高リスク変更は review に残す。',
    pill: '既定 recall：モデル 0 · ネットワーク 0', host: 'HOST LAYER', entry: '統一プロジェクト入口', entryDesc: 'instructions · skills · commands · hook',
    repo: '01 · REPOSITORY SOURCE', repoDesc: '可読 · Git review · rollback 可能', trustDesc: 'content hash · evidence · lifecycle', auditDesc: 'quota · dedupe · Schema',
    runtime: '02 · CANONICAL RUNTIME', compileDesc: 'Schema · graph · receipts · live evidence', embed: '任意 embedding：observe / weight 0、local A/B 合格後のみ参加', gatesDesc: 'relevance · validity · applicability · risk',
    delivery: '03 · TRUSTED DELIVERY', envelopeDesc: '最大 1 topic · 400 token · provenance', agentDesc: '現在の code と docs で再検証', obsDesc: 'confirmed adoption は別 outcome',
    governance: '04 · LOCAL FEEDBACK / BOUNDED EVOLUTION', ledgerDesc: 'retrieval · confirmed outcome · self-attribution', candidateDesc: 'candidate ≠ memory · 既定 quarantine', riskDesc: 'replay · regression · quota · tripwire',
    auto: 'R0 自動書き戻し · R1–R5 review', autoDesc: '失敗は隔離し以前の byte を正確に復元',
  },
  ko: {
    title: 'OwnMem 아키텍처', subtitle: '저장소 소유 · 로컬 회상 · 증거 거버넌스 · 제한된 자율성',
    desc: '저장소 소유 Markdown과 독립 trust receipt를 불변 snapshot으로 compile한다. 5개 결정적 로컬 후보 lane과 선택적 embedding lane이 4개 전달 gate를 통과한다. turn 종료 coordinator는 저위험 R0를 replay, 승격, 관찰, 격리하고 정확히 rollback하며 고위험 변경은 검토로 남긴다.',
    pill: '기본 recall: 모델 0 · 네트워크 0', host: 'HOST LAYER', entry: '통합 프로젝트 입구', entryDesc: 'instructions · skills · commands · hook',
    repo: '01 · REPOSITORY SOURCE', repoDesc: '읽기 가능 · Git review · rollback', trustDesc: 'content hash · evidence · lifecycle', auditDesc: 'quota · dedupe · Schema',
    runtime: '02 · CANONICAL RUNTIME', compileDesc: 'Schema · graph · receipts · live evidence', embed: '선택적 embedding: observe / weight 0, local A/B 통과 후 참여', gatesDesc: 'relevance · validity · applicability · risk',
    delivery: '03 · TRUSTED DELIVERY', envelopeDesc: '최대 1 topic · 400 token · provenance', agentDesc: '현재 code와 docs로 다시 검증', obsDesc: 'confirmed adoption은 별도 outcome',
    governance: '04 · LOCAL FEEDBACK / BOUNDED EVOLUTION', ledgerDesc: 'retrieval · confirmed outcome · self-attribution', candidateDesc: 'candidate ≠ memory · 기본 quarantine', riskDesc: 'replay · regression · quota · tripwire',
    auto: 'R0 자동 쓰기 · R1–R5 검토', autoDesc: '실패는 격리 후 이전 byte를 정확히 복구',
  },
  es: {
    title: 'Arquitectura de OwnMem', subtitle: 'Propiedad del repositorio · recall local · evidencia · autonomía acotada',
    desc: 'Markdown propiedad del repositorio y trust receipts independientes se compilan en snapshots inmutables. Cinco canales deterministas locales y embedding opcional pasan cuatro puertas de entrega. Un coordinador al final del turno reproduce, promueve, observa, aísla y revierte con precisión cambios R0 de bajo riesgo; los cambios de mayor riesgo quedan para revisión.',
    pill: 'Recall por defecto: 0 modelos · 0 red', host: 'CAPA DE HOSTS', entry: 'Entrada unificada del proyecto', entryDesc: 'instrucciones · skills · commands · hook',
    repo: '01 · FUENTE DEL REPOSITORIO', repoDesc: 'Legible · revisable en Git · reversible', trustDesc: 'hash · evidencia · ciclo de vida', auditDesc: 'cuota · duplicados · Schema',
    runtime: '02 · RUNTIME CANÓNICO', compileDesc: 'Schema · grafo · receipts · evidencia viva', embed: 'embedding opcional: observe / peso 0 hasta superar A/B local', gatesDesc: 'relevancia · validez · aplicabilidad · riesgo',
    delivery: '03 · ENTREGA CONFIABLE', envelopeDesc: '≤1 tema · 400 tokens · procedencia', agentDesc: 'verificar contra código y docs actuales', obsDesc: 'la adopción confirmada es otro outcome',
    governance: '04 · FEEDBACK LOCAL Y EVOLUCIÓN ACOTADA', ledgerDesc: 'retrieval · outcome confirmado · autoatribución', candidateDesc: 'candidate ≠ memory · cuarentena por defecto', riskDesc: 'replay · regresión · cuota · tripwire',
    auto: 'R0 automático · R1–R5 a revisión', autoDesc: 'los fallos aíslan y restauran los bytes exactos',
  },
  fr: {
    title: 'Architecture OwnMem', subtitle: 'Mémoire du dépôt · rappel local · preuves · autonomie bornée',
    desc: 'Le Markdown détenu par le dépôt et des trust receipts indépendants sont compilés en snapshots immuables. Cinq canaux locaux déterministes et un embedding optionnel passent quatre portes de livraison. En fin de tour, un coordinateur rejoue, promeut, observe, isole et annule précisément les changements R0 à faible risque ; les autres restent à relire.',
    pill: 'Rappel par défaut : 0 modèle · 0 réseau', host: 'COUCHE HOST', entry: 'Entrée projet unifiée', entryDesc: 'instructions · skills · commands · hook',
    repo: '01 · SOURCE DU DÉPÔT', repoDesc: 'Lisible · révisable dans Git · réversible', trustDesc: 'hash · preuves · cycle de vie', auditDesc: 'quota · doublons · Schema',
    runtime: '02 · RUNTIME CANONIQUE', compileDesc: 'Schema · graphe · receipts · preuves vivantes', embed: 'embedding optionnel : observe / poids 0 avant A/B local', gatesDesc: 'pertinence · validité · applicabilité · risque',
    delivery: '03 · LIVRAISON FIABLE', envelopeDesc: '≤1 sujet · 400 tokens · provenance', agentDesc: 'vérifier avec le code et les docs actuels', obsDesc: 'l’adoption confirmée est un outcome distinct',
    governance: '04 · FEEDBACK LOCAL ET ÉVOLUTION BORNÉE', ledgerDesc: 'retrieval · outcome confirmé · auto-attribution', candidateDesc: 'candidate ≠ memory · quarantaine par défaut', riskDesc: 'replay · régression · quota · tripwire',
    auto: 'R0 automatique · R1–R5 relu', autoDesc: 'un échec isole puis restaure les octets exacts',
  },
  de: {
    title: 'OwnMem-Architektur', subtitle: 'Repository-eigen · lokaler Recall · Evidenz · begrenzte Autonomie',
    desc: 'Repository-eigenes Markdown und unabhängige Trust Receipts werden zu unveränderlichen Snapshots kompiliert. Fünf deterministische lokale Kanäle und optionales Embedding passieren vier Auslieferungstore. Ein Coordinator replayt, promotet, beobachtet, isoliert und rollt risikoarme R0-Änderungen exakt zurück; höheres Risiko bleibt im Review.',
    pill: 'Standard-Recall: 0 Modelle · 0 Netzwerk', host: 'HOST-SCHICHT', entry: 'Einheitlicher Projekteinstieg', entryDesc: 'Anweisungen · Skills · Commands · Hook',
    repo: '01 · REPOSITORY-QUELLE', repoDesc: 'Lesbar · Git-reviewbar · reversibel', trustDesc: 'Hash · Evidenz · Lifecycle', auditDesc: 'Quota · Duplikate · Schema',
    runtime: '02 · CANONICAL RUNTIME', compileDesc: 'Schema · Graph · Receipts · Live-Evidenz', embed: 'Optionales Embedding: observe / Gewicht 0 bis lokales A/B besteht', gatesDesc: 'Relevanz · Gültigkeit · Anwendbarkeit · Risiko',
    delivery: '03 · VERTRAUENSWÜRDIGE LIEFERUNG', envelopeDesc: '≤1 Topic · 400 Tokens · Provenance', agentDesc: 'gegen aktuellen Code und Docs prüfen', obsDesc: 'bestätigte Nutzung ist eigenes Outcome',
    governance: '04 · LOKALES FEEDBACK UND BEGRENZTE EVOLUTION', ledgerDesc: 'Retrieval · bestätigtes Outcome · Selbstzuordnung', candidateDesc: 'candidate ≠ memory · standardmäßig Quarantäne', riskDesc: 'Replay · Regression · Quota · Tripwire',
    auto: 'R0 automatisch · R1–R5 Review', autoDesc: 'Fehler isolieren und stellen exakte Bytes wieder her',
  },
  'pt-BR': {
    title: 'Arquitetura do OwnMem', subtitle: 'Memória do repositório · recall local · evidência · autonomia limitada',
    desc: 'Markdown pertencente ao repositório e trust receipts independentes são compilados em snapshots imutáveis. Cinco canais locais determinísticos e embedding opcional passam por quatro portões de entrega. No fim do turno, um coordenador reproduz, promove, observa, isola e reverte com precisão mudanças R0 de baixo risco; riscos maiores ficam para revisão.',
    pill: 'Recall padrão: 0 modelos · 0 rede', host: 'CAMADA DE HOSTS', entry: 'Entrada unificada do projeto', entryDesc: 'instruções · skills · commands · hook',
    repo: '01 · FONTE DO REPOSITÓRIO', repoDesc: 'Legível · revisável no Git · reversível', trustDesc: 'hash · evidência · ciclo de vida', auditDesc: 'cota · duplicatas · Schema',
    runtime: '02 · RUNTIME CANÔNICO', compileDesc: 'Schema · grafo · receipts · evidência viva', embed: 'embedding opcional: observe / peso 0 até passar A/B local', gatesDesc: 'relevância · validade · aplicabilidade · risco',
    delivery: '03 · ENTREGA CONFIÁVEL', envelopeDesc: '≤1 tópico · 400 tokens · proveniência', agentDesc: 'verificar com código e docs atuais', obsDesc: 'adoção confirmada é um outcome separado',
    governance: '04 · FEEDBACK LOCAL E EVOLUÇÃO LIMITADA', ledgerDesc: 'retrieval · outcome confirmado · autoatribuição', candidateDesc: 'candidate ≠ memory · quarentena por padrão', riskDesc: 'replay · regressão · cota · tripwire',
    auto: 'R0 automático · R1–R5 revisão', autoDesc: 'falhas isolam e restauram os bytes exatos',
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
  smallBox(1220, 430, 302, 'Coding agent', t.agentDesc);
  smallBox(1220, 524, 302, 'Honest observability', t.obsDesc, 'green');
  text(1371, 626, 'completed → delivered → consumed', 11.5, 500, c.muted, 'middle', true);

  rect(52, 736, 1496, 188, 18, c.navy);
  text(78, 770, t.governance, 12, 750, c.blue);
  const gov = [
    [78, 'Three ledgers', t.ledgerDesc],
    [382, 'Candidate queue', t.candidateDesc],
    [686, 'Risk + observation', t.riskDesc],
  ];
  for (const [x, title, description] of gov) {
    rect(x, 792, 274, 96, 13, c.navyBox, c.navyBorder);
    text(x + 137, 824, title, 13.5, 700, c.navyText, 'middle');
    text(x + 137, 851, description, 11.2, 400, c.navyMuted, 'middle');
  }
  arrow('M 352 840 L 372 840', true);
  arrow('M 656 840 L 676 840', true);
  arrow('M 960 840 L 980 840', true);
  rect(990, 792, 532, 96, 13, c.blueSoft, c.blue);
  text(1256, 824, t.auto, 14, 750, c.blue, 'middle');
  text(1256, 851, t.autoDesc, 11.5, 500, c.muted, 'middle');
  text(1256, 874, 'trust → audit → compile → tripwire → rollback receipt', 10.8, 500, c.muted, 'middle', true);
  arrow('M 1256 792 C 1256 718, 262 734, 262 694', true, true);
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
