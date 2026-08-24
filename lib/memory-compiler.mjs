import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  collectMemoryHooks,
  compileMemoryFields,
  MEMORY_FIELD_CONFIG,
  MEMORY_FIELD_NAMES,
} from './memory-field-compiler.mjs';
import {
  DEFAULT_MEMORY_TOKENIZER,
  normalizeMemoryText,
} from './memory-tokenizer.mjs';
import {
  formatMemoryIssue,
  parseMemoryContent,
  parsedRecallFields,
} from './memory-schema.mjs';
import { validateMemoryIndexArtifact, validateMemoryIndexManifest } from './memory-contracts.mjs';
import {
  artifactRecordCount,
  MEMORY_ARTIFACT_SPECS,
  publishSnapshotDirectory,
  readPublishedMemorySnapshot,
  sha256,
  snapshotContentSha256,
  snapshotId,
  stableJson,
  validateSnapshotDirectory,
  withMemoryIndexLock,
} from './memory-index-store.mjs';
import {
  compileMemoryTrust,
  memoryGitState,
  memoryTrustRankingAuthority,
  readMemoryTrustLock,
  MEMORY_WALL_CLOCK_STALENESS_DAYS,
} from './memory-trust-store.mjs';
import { memoryRankingProfileHash } from './memory-runtime-contract.mjs';

export const MEMORY_COMPILER_VERSION = '0.8.0';
export const DEFAULT_MEMORY_INDEX_DIRECTORY = '.local-test/memory-index';
// Single source of truth for "where the Markdown memory lives". The recall runtime resolves
// trust.lock.json from the same value, so a second copy of this literal would let a caller that
// omits memoryDir compile one directory and verify receipts in another.
export const DEFAULT_MEMORY_DIRECTORY = '.claude/memory';

const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

/**
 * The non-Markdown files the compiler folds into manifest.source.files, mapped to the source kind
 * each one is recorded as. The recall runtime's use-time freshness probe imports this instead of
 * keeping its own copy: a probe that knows about fewer source files than the manifest holds counts
 * a mismatch on every runtime construction and rebuilds the snapshot forever, silently and without
 * ever naming a drifted file.
 */
export const MEMORY_SOURCE_CONFIG_KINDS = Object.freeze({
  'quality.lock.json': 'ranking-config',
  'trust.lock.json': 'trust-config',
});

/** True for every file name scanMemorySources compiles into the snapshot's source set. */
export function isMemorySourceFile(fileName) {
  return fileName.endsWith('.md') || Object.hasOwn(MEMORY_SOURCE_CONFIG_KINDS, fileName);
}

function repositoryRelative(root, absolutePath, label) {
  const relative = path.relative(root, absolutePath);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} must be inside the repository root`);
  }
  return relative.split(path.sep).join('/');
}

function scanMemorySources(root, memoryDir) {
  const absoluteMemoryDir = path.resolve(root, memoryDir);
  const normalizedMemoryDir = repositoryRelative(root, absoluteMemoryDir, 'memory directory');
  if (!existsSync(absoluteMemoryDir)) throw new Error(`memory directory does not exist: ${absoluteMemoryDir}`);

  const sources = [];
  for (const entry of readdirSync(absoluteMemoryDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const kind = entry.name === 'MEMORY.md'
      ? 'catalog'
      : /^MEMORY-.*\.md$/.test(entry.name) ? 'l2' : 'topic';
    const absolutePath = path.join(absoluteMemoryDir, entry.name);
    const bytes = readFileSync(absolutePath);
    sources.push({
      path: `${normalizedMemoryDir}/${entry.name}`,
      file: entry.name,
      kind,
      sha256: sha256(bytes),
      bytes: bytes.byteLength,
      content: bytes.toString('utf8'),
    });
  }

  for (const [fileName, kind] of Object.entries(MEMORY_SOURCE_CONFIG_KINDS)) {
    const configPath = path.join(absoluteMemoryDir, fileName);
    if (!existsSync(configPath)) continue;
    const bytes = readFileSync(configPath);
    sources.push({
      path: `${normalizedMemoryDir}/${fileName}`,
      file: fileName,
      kind,
      sha256: sha256(bytes),
      bytes: bytes.byteLength,
      content: bytes.toString('utf8'),
    });
  }

  sources.sort((left, right) => compareText(left.path, right.path));
  const manifestFiles = sources.map(({ path: sourcePath, kind, sha256: digest, bytes }) => ({
    path: sourcePath,
    kind,
    sha256: digest,
    bytes,
  }));
  return {
    absoluteMemoryDir,
    normalizedMemoryDir,
    sources,
    manifestFiles,
    sourceSha256: sha256(stableJson(manifestFiles)),
  };
}

function hookDigest(hooks) {
  return hooks.map((hook) => ({
    path: hook.sourcePath,
    line: hook.line,
    text: hook.text,
    hook_sha256: sha256(hook.text),
  }));
}

function compileDigest({ compilerVersion, source, hooks, dependencyState = [], tokenizerProfile, trustReceiptId = null }) {
  return sha256(stableJson({
    schema: MEMORY_ARTIFACT_SPECS.documents.schema,
    compiler_version: compilerVersion,
    tokenizer_profile: tokenizerProfile,
    topic_sha256: source.sha256,
    hooks: hookDigest(hooks),
    dependencies: dependencyState,
    trust_receipt_id: trustReceiptId,
  }));
}

function uniqueSorted(values) {
  return [...new Set(values)].sort(compareText);
}

function wikiLinks(body) {
  return uniqueSorted([...body.matchAll(/\[\[([a-z0-9]+(?:_[a-z0-9]+)*)\]\]/g)].map((match) => match[1]));
}

function compileChunks(sourcePath, content, body) {
  if (!body.trim()) return [];
  const bodyStartByte = Buffer.byteLength(content, 'utf8') - Buffer.byteLength(body, 'utf8');
  const chunks = [];
  for (const match of body.matchAll(/\S[\s\S]*?(?=\n[ \t]*\n|$)/g)) {
    const text = match[0];
    const startByte = bodyStartByte + Buffer.byteLength(body.slice(0, match.index), 'utf8');
    const endByte = startByte + Buffer.byteLength(text, 'utf8');
    const digest = sha256(text);
    chunks.push({
      id: sha256(`${sourcePath}\0body\0${startByte}\0${endByte}\0${digest}`),
      field: 'body',
      start_byte: startByte,
      end_byte: endByte,
      sha256: digest,
    });
  }
  return chunks;
}

function serializableFrequencies(fieldFrequencies) {
  return Object.fromEntries(MEMORY_FIELD_NAMES.map((field) => [
    field,
    [...fieldFrequencies[field].entries()]
      .sort(([left], [right]) => compareText(left, right))
      .map(([token, frequency]) => ({ token, frequency })),
  ]));
}

function parseTopic(source) {
  const parsed = parseMemoryContent(source.content, {
    source: source.path,
    fileName: source.file,
    active: true,
  });
  const errors = parsed.issues.filter((item) => item.level === 'error');
  if (errors.length > 0 || !parsed.record) {
    const details = errors.slice(0, 5).map(formatMemoryIssue).join('\n  ');
    throw new Error(`memory schema is invalid; run npx ownmem audit:\n  ${details}`);
  }
  return parsed;
}

function topicDependencyState(relations, topicSourcesById) {
  return uniqueSorted([
    ...relations.supersedes,
    ...relations.wiki_links,
  ]).map((id) => {
    const target = topicSourcesById.get(id);
    return {
      id,
      path: target?.path || null,
      source_sha256: target?.sha256 || null,
    };
  });
}

function compileDocument({
  source,
  hooks,
  compilerVersion,
  topicSourcesById,
  tokenizer,
  root,
  memoryDir,
  trustLock,
  gitState,
  now,
  parsedTopic = parseTopic(source),
}) {
  const { record, body } = parsedTopic;
  const parsedFields = parsedRecallFields(record);
  const compiled = compileMemoryFields({
    name: record.name,
    parsed: parsedFields,
    hooks,
    body,
    sourcePath: source.path,
  }, { tokenizer });
  const trust = compileMemoryTrust({
    root,
    memoryDir,
    record,
    sourceSha256: source.sha256,
    trustLock,
    now,
    gitState,
  });
  const relations = {
    authority_docs: record.metadata.authority_docs,
    history_docs: record.metadata.history_docs,
    supersedes: record.metadata.supersedes,
    wiki_links: wikiLinks(body),
    code_evidence: record.metadata.code_evidence.map((entry) => ({
      path: entry.path,
      symbols: entry.symbols,
      tests: entry.tests,
    })),
  };
  const compileSha256 = compileDigest({
    compilerVersion,
    source,
    hooks,
    dependencyState: topicDependencyState(relations, topicSourcesById),
    tokenizerProfile: tokenizer.profile,
    trustReceiptId: trust.receipt_id,
  });
  const document = {
    id: record.name,
    path: source.path,
    source_sha256: source.sha256,
    source_content: source.content,
    compile_sha256: compileSha256,
    metadata: {
      type: record.metadata.type,
      authority: memoryTrustRankingAuthority(trust),
      declared_authority: record.metadata.authority,
      last_verified: record.metadata.last_verified,
      scopes: record.metadata.scopes,
      applies_to: record.metadata.applies_to,
      triggers: record.metadata.triggers,
    },
    provenance: {
      topic_path: source.path,
      topic_sha256: source.sha256,
      l2_hooks: hooks.map((hook) => ({
        path: hook.sourcePath,
        line: hook.line,
        sha256: sha256(hook.text),
      })),
      receipt_id: trust.receipt_id,
      evidence_root_sha256: trust.evidence_root_sha256,
      source_commit: trust.source_commit,
    },
    trust,
    relations,
    fields: { ...compiled.fieldValues, body: [] },
    field_lengths: compiled.fieldLengths,
    chunks: compileChunks(source.path, source.content, body),
  };
  return { document, frequencies: serializableFrequencies(compiled.fieldFrequencies) };
}

function changedSourcePaths(priorManifest, currentFiles) {
  const prior = new Map((priorManifest?.source.files || []).map((source) => [source.path, source.sha256]));
  const current = new Map(currentFiles.map((source) => [source.path, source.sha256]));
  const changed = new Set();
  for (const [sourcePath, digest] of current) if (prior.get(sourcePath) !== digest) changed.add(sourcePath);
  for (const sourcePath of prior.keys()) if (!current.has(sourcePath)) changed.add(sourcePath);
  return changed;
}

function dependencyInvalidatedTopicPaths(scan, priorSnapshot) {
  if (!priorSnapshot) return new Set();
  const changedPaths = changedSourcePaths(priorSnapshot.manifest, scan.manifestFiles);
  const currentTopicPaths = new Map(scan.sources
    .filter((source) => source.kind === 'topic')
    .map((source) => [path.posix.basename(source.path, '.md'), source.path]));
  const priorTopicPaths = new Map(priorSnapshot.artifacts.documents.documents
    .map((document) => [document.id, document.path]));
  const priorDocumentsByPath = new Map(priorSnapshot.artifacts.documents.documents
    .map((document) => [document.path, document]));
  const reverse = new Map(priorSnapshot.artifacts.graph.reverse_dependencies
    .map((entry) => [entry.id, entry.references]));
  const queue = [];
  const visitedNodes = new Set();
  const invalidatedPaths = new Set();

  for (const sourcePath of changedPaths) {
    const prior = priorDocumentsByPath.get(sourcePath);
    if (prior) queue.push(`topic:${prior.id}`);
    const currentName = currentTopicPaths.has(path.posix.basename(sourcePath, '.md'))
      ? path.posix.basename(sourcePath, '.md')
      : null;
    if (currentName) queue.push(`topic:${currentName}`);
  }

  while (queue.length > 0) {
    const node = queue.shift();
    if (visitedNodes.has(node)) continue;
    visitedNodes.add(node);
    for (const reference of reverse.get(node) || []) {
      if (!reference.from.startsWith('topic:')) continue;
      const dependentId = reference.from.slice('topic:'.length);
      const dependentPath = currentTopicPaths.get(dependentId) || priorTopicPaths.get(dependentId);
      if (dependentPath && currentTopicPaths.has(dependentId)) invalidatedPaths.add(dependentPath);
      queue.push(reference.from);
    }
  }
  return invalidatedPaths;
}

function frequenciesFromPostings(priorSnapshot) {
  const byDocument = new Map();
  if (!priorSnapshot) return byDocument;
  // Incremental compiles read the previous snapshot, which may predate the interned encoding.
  // readMemoryIndexSnapshot upgrades v1 in place, so document_ids is present either way; the
  // fallback keeps this readable if a caller ever hands over a raw artifact.
  const documentIds = priorSnapshot.artifacts.postings.document_ids || null;
  for (const term of priorSnapshot.artifacts.postings.terms) {
    for (const [documentRef, fieldPostings] of term.postings) {
      const documentId = documentIds ? documentIds[documentRef] : documentRef;
      let frequencies = byDocument.get(documentId);
      if (!frequencies) {
        frequencies = Object.fromEntries(MEMORY_FIELD_NAMES.map((field) => [field, []]));
        byDocument.set(documentId, frequencies);
      }
      for (const [fieldIndex, frequency] of fieldPostings) {
        frequencies[MEMORY_FIELD_NAMES[fieldIndex]].push({ token: term.term, frequency });
      }
    }
  }
  return byDocument;
}

function compileDocuments({ scan, priorSnapshot, compilerVersion, tokenizer, root, memoryDir, trustLock, gitState, now }) {
  const l2Sources = scan.sources.filter((source) => source.kind === 'l2');
  const hooksByMemory = collectMemoryHooks(l2Sources.map((source) => ({
    file: source.file,
    sourcePath: source.path,
    content: source.content,
  })));
  const priorDocuments = new Map(
    (priorSnapshot?.artifacts.documents.documents || []).map((document) => [document.path, document]),
  );
  const priorFrequencies = frequenciesFromPostings(priorSnapshot);
  const topicSourcesById = new Map(scan.sources
    .filter((source) => source.kind === 'topic')
    .map((source) => [path.posix.basename(source.path, '.md'), source]));
  const dependencyInvalidations = dependencyInvalidatedTopicPaths(scan, priorSnapshot);
  const directlyChangedPaths = changedSourcePaths(priorSnapshot?.manifest, scan.manifestFiles);
  const documents = [];
  const frequenciesByDocument = new Map();
  let compiledTopics = 0;
  let reusedTopics = 0;
  let dependencyInvalidatedTopics = 0;

  for (const source of scan.sources.filter((item) => item.kind === 'topic')) {
    const prior = priorDocuments.get(source.path);
    const invalidatedByDependency = dependencyInvalidations.has(source.path)
      && prior?.source_sha256 === source.sha256;
    const parsedTopic = prior?.source_sha256 === source.sha256 && !invalidatedByDependency
      ? null
      : parseTopic(source);
    const memoryName = parsedTopic?.record.name || prior.id;
    const trustReceiptId = trustLock?.receipts?.[memoryName]?.at(-1)?.receipt_id || null;
    const hooks = hooksByMemory.get(memoryName) || [];
    const relations = parsedTopic ? {
      supersedes: parsedTopic.record.metadata.supersedes,
      wiki_links: wikiLinks(parsedTopic.body),
    } : prior.relations;
    const digest = compileDigest({
      compilerVersion,
      source,
      hooks,
      dependencyState: topicDependencyState(relations, topicSourcesById),
      tokenizerProfile: tokenizer.profile,
      trustReceiptId,
    });
    if (prior?.compile_sha256 === digest && !invalidatedByDependency) {
      documents.push(prior);
      const frequencies = priorFrequencies.get(prior.id);
      if (!frequencies) throw new Error(`prior postings are missing document ${prior.id}`);
      frequenciesByDocument.set(prior.id, frequencies);
      reusedTopics += 1;
    } else {
      const compiled = compileDocument({
        source,
        hooks,
        compilerVersion,
        topicSourcesById,
        tokenizer,
        root,
        memoryDir,
        trustLock,
        gitState,
        now,
        parsedTopic: parsedTopic || undefined,
      });
      documents.push(compiled.document);
      frequenciesByDocument.set(compiled.document.id, compiled.frequencies);
      compiledTopics += 1;
      if (invalidatedByDependency && !directlyChangedPaths.has(source.path)) dependencyInvalidatedTopics += 1;
    }
  }

  documents.sort((left, right) => compareText(left.path, right.path));
  const currentPaths = new Set(documents.map((document) => document.path));
  const deletedTopics = [...priorDocuments.keys()].filter((sourcePath) => !currentPaths.has(sourcePath)).length;
  return {
    artifact: {
      schema: MEMORY_ARTIFACT_SPECS.documents.schema,
      compiler_version: compilerVersion,
      field_names: [...MEMORY_FIELD_NAMES],
      documents,
    },
    compiledTopics,
    reusedTopics,
    deletedTopics,
    dependencyInvalidatedTopics,
    frequenciesByDocument,
  };
}

function compilePostings(documents, frequenciesByDocument) {
  const terms = new Map();
  for (const document of documents) {
    const documentFrequencies = frequenciesByDocument.get(document.id);
    if (!documentFrequencies) throw new Error(`compiled frequencies are missing document ${document.id}`);
    for (const field of MEMORY_FIELD_NAMES) {
      for (const { token, frequency } of documentFrequencies[field]) {
        const postings = terms.get(token) || new Map();
        const fields = postings.get(document.id) || [];
        fields.push({ field, frequency });
        postings.set(document.id, fields);
        terms.set(token, postings);
      }
    }
  }
  const averageFieldLengths = Object.fromEntries(MEMORY_FIELD_NAMES.map((field) => [
    field,
    documents.length === 0
      ? 0
      : documents.reduce((sum, document) => sum + document.field_lengths[field], 0) / documents.length,
  ]));
  // Two lookup tables instead of repeating values that are heavily shared. Measured on a 357-topic,
  // 1.14 MB corpus: postings.json went 18.95 MB -> 8.95 MB and read+parse 81 ms -> 45 ms.
  //
  //   document ids  232,867 postings each carried the full topic name (38 chars on average) while
  //                 only 357 distinct names exist. 8.85 MB of the file was that one repetition.
  //   idf           128,344 terms each stored a full-precision float, but only 134 distinct values
  //                 exist (idf is a function of posting count, and the counts collide heavily).
  //
  // Rounding the float instead of interning it was the original plan; it saves 1.8 MB against
  // interning's 3.1 MB and loses precision for nothing. Compression was also measured: gzip alone
  // reaches 2.2 MB but costs +13 ms per read, because the parse still walks the same expanded JSON.
  // This encoding shrinks the parse itself, which is why it wins on both axes rather than trading.
  const sortedTerms = [...terms.entries()].sort(([left], [right]) => compareText(left, right));
  const documentIds = documents.map((document) => document.id).sort(compareText);
  const documentIndex = new Map(documentIds.map((id, index) => [id, index]));
  const idfTable = [];
  const idfIndex = new Map();
  const internIdf = (value) => {
    let index = idfIndex.get(value);
    if (index === undefined) {
      index = idfTable.length;
      idfTable.push(value);
      idfIndex.set(value, index);
    }
    return index;
  };
  return {
    schema: MEMORY_ARTIFACT_SPECS.postings.schema,
    document_count: documents.length,
    field_names: [...MEMORY_FIELD_NAMES],
    average_field_lengths: averageFieldLengths,
    document_ids: documentIds,
    idf_table: idfTable,
    terms: sortedTerms.map(([term, postings]) => ({
      term,
      idf: internIdf(Math.log(1 + ((documents.length - postings.size + 0.5) / (postings.size + 0.5)))),
      postings: [...postings.entries()].sort(([left], [right]) => compareText(left, right))
        .map(([documentId, fields]) => [
          documentIndex.get(documentId),
          fields.map(({ field, frequency }) => [MEMORY_FIELD_NAMES.indexOf(field), frequency]),
        ]),
    })),
  };
}

function compileExactMap(documents) {
  const entries = new Map();
  const add = (kind, value, documentId) => {
    const normalized = normalizeMemoryText(value).trim();
    if (!normalized) return;
    const key = `${kind}\0${normalized}`;
    const entry = entries.get(key) || { kind, value: String(value), normalized, documents: new Set() };
    if (compareText(String(value), entry.value) < 0) entry.value = String(value);
    entry.documents.add(documentId);
    entries.set(key, entry);
  };

  for (const document of documents) {
    add('name', document.id, document.id);
    for (const value of document.fields.triggers) add('trigger', value, document.id);
    for (const value of document.fields.codePath) {
      add('path', value, document.id);
      add('basename', path.posix.basename(value.replaceAll('\\', '/')), document.id);
    }
    for (const value of document.fields.codeSymbol) {
      add('symbol', value, document.id);
      const suffix = value.split('.').at(-1);
      if (suffix !== value) add('symbol-suffix', suffix, document.id);
    }
    for (const value of document.fields.codeTest) {
      add('test', value, document.id);
      const [testPath, testCase] = value.split('#', 2);
      add('test', path.posix.basename(testPath.replaceAll('\\', '/')), document.id);
      if (testCase) add('test-case', testCase, document.id);
    }
    for (const value of document.fields.authorityDocs) add('doc-id', value, document.id);
    const errorText = [...document.fields.triggers, ...document.fields.description].join('\n');
    for (const match of errorText.matchAll(/\b(?:[A-Z][A-Z0-9_.-]{2,}|[A-Za-z][A-Za-z0-9]*(?:Error|Exception)|[1-9]\d{3,})\b/g)) {
      add('error', match[0], document.id);
    }
  }

  return {
    schema: MEMORY_ARTIFACT_SPECS.exact_map.schema,
    entries: [...entries.values()]
      .map((entry) => ({ ...entry, documents: [...entry.documents].sort(compareText) }))
      .sort((left, right) => compareText(`${left.kind}\0${left.normalized}`, `${right.kind}\0${right.normalized}`)),
  };
}

function compileGraph(documents) {
  const nodes = new Map();
  const edges = new Map();
  const addNode = (id, kind, label) => nodes.set(id, { id, kind, label });
  const addEdge = (from, to, kind) => edges.set(`${from}\0${to}\0${kind}`, { from, to, kind });

  for (const document of documents) {
    const topicNode = `topic:${document.id}`;
    addNode(topicNode, 'topic', document.id);
    for (const hook of document.provenance.l2_hooks) {
      const l2Node = `l2:${hook.path}`;
      addNode(l2Node, 'l2', path.posix.basename(hook.path));
      addEdge(l2Node, topicNode, 'l2-hook');
    }
    for (const [kind, values] of [
      ['authority-doc', document.relations.authority_docs],
      ['history-doc', document.relations.history_docs],
    ]) {
      for (const value of values) {
        const docNode = `document:${value}`;
        addNode(docNode, 'document', value);
        addEdge(topicNode, docNode, kind);
      }
    }
    for (const value of document.relations.supersedes) {
      const target = `topic:${value}`;
      addNode(target, 'topic', value);
      addEdge(topicNode, target, 'supersedes');
    }
    for (const value of document.relations.wiki_links) {
      const target = `topic:${value}`;
      addNode(target, 'topic', value);
      addEdge(topicNode, target, 'wiki-link');
    }
    for (const evidence of document.relations.code_evidence) {
      const codeNode = `code:${evidence.path}`;
      addNode(codeNode, 'code', evidence.path);
      addEdge(topicNode, codeNode, 'code-evidence');
      for (const test of evidence.tests) {
        const testNode = `code:${test}`;
        addNode(testNode, 'code', test);
        addEdge(topicNode, testNode, 'code-test');
      }
    }
  }
  const sortedEdges = [...edges.values()].sort((left, right) => compareText(
    `${left.from}\0${left.to}\0${left.kind}`,
    `${right.from}\0${right.to}\0${right.kind}`,
  ));
  const reverseDependencies = new Map();
  for (const edge of sortedEdges) {
    const references = reverseDependencies.get(edge.to) || new Map();
    references.set(`${edge.from}\0${edge.kind}`, { from: edge.from, kind: edge.kind });
    reverseDependencies.set(edge.to, references);
  }
  return {
    schema: MEMORY_ARTIFACT_SPECS.graph.schema,
    nodes: [...nodes.values()].sort((left, right) => compareText(left.id, right.id)),
    edges: sortedEdges,
    reverse_dependencies: [...reverseDependencies.entries()]
      .sort(([left], [right]) => compareText(left, right))
      .map(([id, references]) => ({
        id,
        references: [...references.values()].sort((left, right) => compareText(
          `${left.from}\0${left.kind}`,
          `${right.from}\0${right.kind}`,
        )),
      })),
  };
}

function compileRanking(scan, compilerVersion, tokenizer) {
  const quality = scan.sources.find((source) => source.kind === 'ranking-config');
  return {
    schema: MEMORY_ARTIFACT_SPECS.ranking.schema,
    profile: 'deterministic-ranker-v1',
    compiler_version: compilerVersion,
    tokenizer_profile: tokenizer.profile,
    bm25: { k1: 1.2 },
    field_weights: Object.fromEntries(Object.entries(MEMORY_FIELD_CONFIG).map(([field, config]) => [field, {
      weight: config.weight,
      length_normalization: config.lengthNormalization,
      exact_boost: config.exactBoost,
    }])),
    rrf: {
      k: 10,
      channel_weights: { exact: 8, bm25f: 16, ngram: 0.1, fuzzy: 0.25, graph: 0.05, embedding: 0 },
    },
    features: {
      rrf_weight: 1,
      weights: {
        exact_anchor: 0.15,
        approximate_anchor: 0,
        embedding_similarity: 0,
        query_coverage: 0.2,
        matched_terms: 0.15,
        high_signal_concepts: 0.3,
        high_signal_terms: 0.15,
        anchor_terms: 0.15,
        field_coverage: 0.2,
        scope_overlap: 0.01,
        authority: 0.01,
        evidence: 0.01,
        freshness: 0.01,
        graph_quality: 0.02,
        channel_diversity: 0.05,
      },
      confidence_weights: {
        approximate: { approximate_anchor: 0.85, field_coverage: 0.1, channel_diversity: 0.05 },
        embedding: { embedding_similarity: 1 },
        concept: { high_signal_concepts: 0.55, high_signal_terms: 0.2, field_coverage: 0.15, query_coverage: 0.1 },
        density: { matched_terms: 0.55, query_coverage: 0.35, field_coverage: 0.1 },
      },
      authority_strength: { observed: 0.75, normative: 1, 'user-confirmed': 0.95 },
      evidence_strength: {
        l2_hook: 0.1,
        authority_doc: 0.25,
        code_path: 0.2,
        code_symbol: 0.2,
        code_test: 0.25,
      },
      exact_kind_strength: {
        name: 0.9,
        trigger: 0.72,
        path: 1,
        basename: 0.88,
        symbol: 1,
        'symbol-suffix': 0.9,
        test: 0.92,
        'test-case': 0.96,
        'doc-id': 0.82,
        error: 1,
      },
      graph_kind_strength: {
        'wiki-link': 1,
        supersedes: 0.95,
        'authority-doc': 0.85,
        'history-doc': 0.7,
        'code-evidence': 0.8,
        'code-test': 0.8,
        'l2-hook': 0.55,
      },
      freshness_half_life_days: 365,
    },
    thresholds: {
      identifier: 0.6,
      path: 0.7,
      error: 0.7,
      natural: 0.65,
      decision: 0.65,
      mixed: 0.65,
    },
    mmr: { lambda: 0.78, similarity_threshold: 0.82, default_limit: 10, maximum_limit: 50 },
    conflicts: { explicit_superseded_penalty: 0.25, authority_role_penalty: 0.03 },
    trust: { max_staleness_days: MEMORY_WALL_CLOCK_STALENESS_DAYS },
    quality_source: {
      path: quality?.path || `${scan.normalizedMemoryDir}/quality.lock.json`,
      sha256: quality?.sha256 || null,
    },
  };
}

/**
 * Ranking identity of a snapshot, comparable across a published artifact and a freshly built one.
 *
 * Everything compileRanking emits except quality_source is a constant declared in this file, so the
 * only way a ranking change reaches recall is for the skip decision to notice it. It did not: the
 * decision compared the compiler version, the tokenizer profile and the source digest, none of
 * which move when a channel weight, a feature weight, an MMR lambda or the freshness half-life is
 * edited. Four such edits produced byte-identical benchmark output, and the runtime identity line
 * did not flag them either, because its digest is read out of the same stale snapshot.
 *
 * memoryRankingProfileHash digests JSON.stringify, which is key-order sensitive, and the two sides
 * do not agree on order: a published artifact is written through stableJson and parses back with
 * sorted keys, while compileRanking returns literal declaration order. Hashing them as-is differs
 * on every field and would rebuild the snapshot forever. Both sides are canonicalized here, so the
 * digest reflects values only. quality_source, the one field derived from the corpus rather than
 * from a constant, is dropped by memoryRankingProfileHash; quality.lock.json is a compiled source
 * file, so a real change to it already moves manifest.source.source_sha256.
 */
function rankingProfileIdentity(ranking) {
  return memoryRankingProfileHash(JSON.parse(stableJson(ranking)));
}

function buildSnapshot({ scan, ranking, priorSnapshot, compilerVersion, now, temporaryDirectory, tokenizer, root, memoryDir, trustLock, gitState }) {
  const documentResult = compileDocuments({ scan, priorSnapshot, compilerVersion, tokenizer, root, memoryDir, trustLock, gitState, now });
  const documents = documentResult.artifact.documents;
  const artifacts = {
    documents: documentResult.artifact,
    postings: compilePostings(documents, documentResult.frequenciesByDocument),
    exact_map: compileExactMap(documents),
    graph: compileGraph(documents),
    // Published from the same object the skip decision measured, so the snapshot on disk cannot
    // carry a ranking the caller never compared against.
    ranking,
  };
  const artifactMetadata = {};

  mkdirSync(temporaryDirectory, { recursive: false });
  for (const [kind, artifact] of Object.entries(artifacts)) {
    validateMemoryIndexArtifact(kind, artifact);
    const output = stableJson(artifact, { space: 0 });
    const spec = MEMORY_ARTIFACT_SPECS[kind];
    writeFileSync(path.join(temporaryDirectory, spec.file), output, 'utf8');
    artifactMetadata[kind] = {
      file: spec.file,
      schema: spec.schema,
      sha256: sha256(output),
      bytes: Buffer.byteLength(output),
      records: artifactRecordCount(kind, artifact),
    };
  }
  const contentSha256 = snapshotContentSha256(artifactMetadata);
  const id = snapshotId({ compilerVersion, sourceSha256: scan.sourceSha256, contentSha256 });
  const manifest = {
    schema: 'ownmem-index/v1',
    compiler: { name: 'ownmem-compiler', version: compilerVersion },
    snapshot: { id, created_at: now.toISOString(), content_sha256: contentSha256 },
    source: {
      memory_dir: scan.normalizedMemoryDir,
      source_sha256: scan.sourceSha256,
      active_topics: documents.length,
      archive_included: false,
      files: scan.manifestFiles,
    },
    artifacts: artifactMetadata,
    compatibility: {
      minimum_reader_version: 5,
      query_result_schema: 'ownmem-query-result/v5',
      fallback_policy: 'rebuild-then-markdown-v1',
    },
  };
  validateMemoryIndexManifest(manifest);
  writeFileSync(path.join(temporaryDirectory, 'manifest.json'), stableJson(manifest), 'utf8');
  const snapshot = validateSnapshotDirectory(temporaryDirectory);
  return { snapshot, ...documentResult };
}

function compileUnlocked({ root, memoryDir, indexRoot, compilerVersion, now, force, beforePublish, tokenizer }) {
  const scan = scanMemorySources(root, memoryDir);
  const trustLock = readMemoryTrustLock({ root, memoryDir, required: false }).lock || { receipts: {} };
  const gitState = memoryGitState(root, memoryDir);
  let priorSnapshot = null;
  try {
    priorSnapshot = readPublishedMemorySnapshot({ indexRoot });
  } catch {
    // Missing or invalid snapshots trigger a full rebuild from Markdown truth.
  }

  const ranking = compileRanking(scan, compilerVersion, tokenizer);
  const currentReady = priorSnapshot?.selected === 'current';
  const sameCompiler = priorSnapshot?.manifest.compiler.version === compilerVersion;
  const sameTokenizer = priorSnapshot?.artifacts.ranking.tokenizer_profile === tokenizer.profile;
  // Ranking behaviour is a compiler input like the source digest, not an output of it. Without
  // this comparison an edited ranking constant is invisible to every gate downstream: the skip
  // decision keeps the old snapshot, so the benchmark, the A/B evidence and the runtime identity
  // line all keep measuring the ranking that was replaced, and all of them report green.
  const sameRanking = Boolean(priorSnapshot)
    && rankingProfileIdentity(priorSnapshot.artifacts.ranking) === rankingProfileIdentity(ranking);
  if (!force && currentReady && sameCompiler && sameTokenizer && sameRanking && priorSnapshot.manifest.source.source_sha256 === scan.sourceSha256) {
    return {
      manifest: priorSnapshot.manifest,
      directory: priorSnapshot.directory,
      published: false,
      unchanged: true,
      previous_fallback_used: false,
      stats: {
        mode: 'incremental',
        source_files: scan.manifestFiles.length,
        changed_sources: 0,
        compiled_topics: 0,
        reused_topics: priorSnapshot.manifest.source.active_topics,
        deleted_topics: 0,
        dependency_invalidated_topics: 0,
      },
    };
  }

  // A ranking change also disqualifies incremental reuse, because field_weights is where the field
  // set itself is declared: adding or removing a field changes MEMORY_FIELD_NAMES, and reused
  // documents carry per-field values, lengths and posting indices compiled against the old set.
  const reusablePrior = sameCompiler && sameTokenizer && sameRanking ? priorSnapshot : null;
  const temporaryDirectory = path.join(indexRoot, `.tmp-${process.pid}-${randomBytes(8).toString('hex')}`);
  try {
    const result = buildSnapshot({ scan, ranking, priorSnapshot: reusablePrior, compilerVersion, now, temporaryDirectory, tokenizer, root, memoryDir, trustLock, gitState });
    if (beforePublish) beforePublish(result.snapshot);
    const publication = publishSnapshotDirectory({
      indexRoot,
      temporaryDirectory,
      snapshot: result.snapshot,
    });
    return {
      manifest: publication.snapshot.manifest,
      directory: publication.directory,
      published: publication.published,
      unchanged: false,
      previous_fallback_used: priorSnapshot?.selected === 'previous',
      stats: {
        mode: reusablePrior ? 'incremental' : 'full',
        source_files: scan.manifestFiles.length,
        changed_sources: changedSourcePaths(reusablePrior?.manifest, scan.manifestFiles).size,
        compiled_topics: result.compiledTopics,
        reused_topics: result.reusedTopics,
        deleted_topics: result.deletedTopics,
        dependency_invalidated_topics: result.dependencyInvalidatedTopics,
      },
    };
  } catch (error) {
    rmSync(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

export function compileMemoryIndex({
  root,
  memoryDir = DEFAULT_MEMORY_DIRECTORY,
  indexDirectory = DEFAULT_MEMORY_INDEX_DIRECTORY,
  compilerVersion = MEMORY_COMPILER_VERSION,
  now = new Date(),
  force = false,
  lock = {},
  beforePublish,
  tokenizer = DEFAULT_MEMORY_TOKENIZER,
} = {}) {
  if (!root) throw new Error('compileMemoryIndex requires a repository root');
  const absoluteRoot = realpathSync(path.resolve(root));
  const absoluteMemoryDir = path.resolve(absoluteRoot, memoryDir);
  if (!existsSync(absoluteMemoryDir)) throw new Error(`memory directory does not exist: ${absoluteMemoryDir}`);
  const indexRoot = path.resolve(absoluteRoot, indexDirectory);
  repositoryRelative(absoluteRoot, indexRoot, 'memory index directory');
  return withMemoryIndexLock(indexRoot, () => compileUnlocked({
    root: absoluteRoot,
    memoryDir,
    indexRoot,
    compilerVersion,
    now,
    force,
    beforePublish,
    tokenizer,
  }), lock);
}

export function compileMemoryTopicDelta({
  root,
  topicPath,
  memoryDir = DEFAULT_MEMORY_DIRECTORY,
  compilerVersion = MEMORY_COMPILER_VERSION,
  tokenizer = DEFAULT_MEMORY_TOKENIZER,
} = {}) {
  if (!root) throw new Error('compileMemoryTopicDelta requires a repository root');
  if (!topicPath) throw new Error('compileMemoryTopicDelta requires a topic path');
  const absoluteRoot = realpathSync(path.resolve(root));
  const absoluteMemoryDir = path.resolve(absoluteRoot, memoryDir);
  repositoryRelative(absoluteRoot, absoluteMemoryDir, 'memory directory');
  const absoluteTopic = path.resolve(absoluteRoot, topicPath);
  const canonicalMemoryDir = realpathSync(absoluteMemoryDir);
  const canonicalTopic = realpathSync(absoluteTopic);
  const relativeToMemory = path.relative(canonicalMemoryDir, canonicalTopic);
  if (relativeToMemory.startsWith('..') || path.isAbsolute(relativeToMemory)) {
    throw new Error('memory topic path must be inside the memory directory');
  }
  const file = path.basename(canonicalTopic);
  if (!file.endsWith('.md') || file === 'MEMORY.md' || /^MEMORY-/.test(file)) {
    throw new Error('memory topic path must point to an L3 Markdown topic');
  }
  const bytes = readFileSync(canonicalTopic);
  const source = {
    path: repositoryRelative(absoluteRoot, canonicalTopic, 'memory topic path'),
    file,
    kind: 'topic',
    sha256: sha256(bytes),
    bytes: bytes.byteLength,
    content: bytes.toString('utf8'),
  };
  const l2Sources = readdirSync(absoluteMemoryDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^MEMORY-.*\.md$/.test(entry.name))
    .sort((left, right) => compareText(left.name, right.name))
    .map((entry) => ({
      file: entry.name,
      sourcePath: repositoryRelative(absoluteRoot, path.join(absoluteMemoryDir, entry.name), 'memory L2 path'),
      content: readFileSync(path.join(absoluteMemoryDir, entry.name), 'utf8'),
    }));
  const parsedTopic = parseTopic(source);
  const hooks = collectMemoryHooks(l2Sources).get(parsedTopic.record.name) || [];
  const topicSourcesById = new Map(readdirSync(absoluteMemoryDir, { withFileTypes: true })
    .filter((entry) => entry.isFile()
      && entry.name.endsWith('.md')
      && entry.name !== 'MEMORY.md'
      && !/^MEMORY-/.test(entry.name))
    .map((entry) => {
      const targetPath = path.join(absoluteMemoryDir, entry.name);
      const targetBytes = readFileSync(targetPath);
      return [path.basename(entry.name, '.md'), {
        path: repositoryRelative(absoluteRoot, targetPath, 'memory topic path'),
        sha256: sha256(targetBytes),
      }];
    }));
  const trustLock = readMemoryTrustLock({ root: absoluteRoot, memoryDir, required: false }).lock || { receipts: {} };
  const compiled = compileDocument({
    source,
    hooks,
    compilerVersion,
    topicSourcesById,
    parsedTopic,
    tokenizer,
    root: absoluteRoot,
    memoryDir,
    trustLock,
    gitState: memoryGitState(absoluteRoot, memoryDir),
    now: new Date(),
  });
  return {
    schema: 'ownmem-index.topic-delta/v1',
    compiler_version: compilerVersion,
    document: compiled.document,
    frequencies: compiled.frequencies,
  };
}
