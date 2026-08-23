#!/usr/bin/env node

import { createServer } from 'node:http';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createMemoryEmbeddingClient,
  createMemoryEmbeddingConfig,
  MEMORY_EMBEDDING_PRESETS,
  MemoryEmbeddingProviderError,
  publicMemoryEmbeddingConfig,
  readMemoryEmbeddingConfig,
  validateMemoryEmbeddingConfig,
  writeMemoryEmbeddingConfig,
} from '../lib/memory-embedding-provider.mjs';
import {
  cosineSimilarity,
  createMemoryEmbeddingArtifact,
  createMemoryEmbeddingText,
  decodeFloat32Vector,
  encodeFloat32Vector,
  loadMemoryEmbeddingCorpus,
  memoryEmbeddingArtifactPath,
  readMemoryEmbeddingArtifact,
  reconcileMemoryEmbeddingArtifact,
  topKMemoryEmbeddingMatches,
  validateMemoryEmbeddingArtifact,
} from '../lib/memory-embedding-store.mjs';
import { compileMemoryIndex } from '../lib/memory-compiler.mjs';
import {
  buildMemoryEmbeddings,
  inspectMemoryEmbeddingStatus,
  runCli,
} from '../lib/features/embedding.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertNear(actual, expected, message) {
  assert(Math.abs(actual - expected) < 1e-6, `${message}: expected ${expected}, got ${actual}`);
}

function assertThrows(callback, expectedMessage) {
  try {
    callback();
  } catch (error) {
    assert(error.message.includes(expectedMessage), `expected "${expectedMessage}", got "${error.message}"`);
    return error;
  }
  throw new Error(`expected error containing "${expectedMessage}"`);
}

async function assertRejects(callback, { category, message, absent } = {}) {
  try {
    await callback();
  } catch (error) {
    if (category) assert(error.category === category, `expected category ${category}, got ${error.category}`);
    if (message) assert(error.message.includes(message), `expected "${message}", got "${error.message}"`);
    if (absent) assert(!error.message.includes(absent), `error leaked secret ${absent}`);
    return error;
  }
  throw new Error('expected promise to reject');
}

let passed = 0;
async function test(label, callback) {
  await callback();
  passed += 1;
  process.stdout.write(`  PASS  ${label}\n`);
}

function topic(name, detail) {
  return `---
name: ${name}
description: "Embedding fixture ${name}"
metadata:
  node_type: memory
  type: lesson
  status: active
  scopes: [scripts]
  applies_to: [all]
  triggers: [${name}, "语义向量 ${name}"]
  last_verified: 2026-08-01
  expires_at: null
  authority: observed
  authority_docs: []
  history_docs: []
  supersedes: []
  code_evidence: []
  evidence: [test-fixture]
---

# ${name}

${detail}
`;
}

function writeFixture(root, count = 65) {
  const memoryDirectory = path.join(root, '.claude', 'memory');
  mkdirSync(memoryDirectory, { recursive: true });
  writeFileSync(path.join(memoryDirectory, 'MEMORY.md'), '# Memory fixture\n', 'utf8');
  const hooks = [];
  for (let index = 0; index < count; index += 1) {
    const name = `topic_${String(index).padStart(3, '0')}`;
    writeFileSync(path.join(memoryDirectory, `${name}.md`), topic(name, `Body version 1 for ${name}.`), 'utf8');
    hooks.push(`- [Topic ${index}](${name}.md) — Hook summary ${index}`);
  }
  writeFileSync(path.join(memoryDirectory, 'MEMORY-process.md'), `# Process\n\n${hooks.join('\n')}\n`, 'utf8');
  return memoryDirectory;
}

function jsonResponse(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(value));
}

async function startMockProvider(secret) {
  const state = {
    mode: 'success',
    requests: [],
    retryStatuses: [],
  };
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    state.requests.push({
      url: request.url,
      authorization: request.headers.authorization,
      count: Array.isArray(body.input) ? body.input.length : -1,
      body,
    });
    if (state.mode === 'auth') {
      jsonResponse(response, 401, { error: `bad token ${secret}` });
      return;
    }
    // An upstream that echoes the Authorization header back in its error text. Redacting only the
    // configured key is not enough: a proxy or gateway can quote a bearer token this side never
    // stored, and that text goes straight into the job error and the dashboard.
    if (state.mode === 'echo-auth') {
      jsonResponse(response, 401, {
        error: `rejected header Authorization: Bearer sk-upstream-echoed-9f2a, api_key=sk-query-echoed-4c1b`,
      });
      return;
    }
    if (state.mode === 'quota') {
      jsonResponse(response, 429, { error: 'quota exhausted' });
      return;
    }
    if (state.mode === 'server') {
      jsonResponse(response, 503, { error: 'temporarily unavailable' });
      return;
    }
    if (state.retryStatuses.length > 0) {
      const status = state.retryStatuses.shift();
      jsonResponse(response, status, { error: `retry ${status}` });
      return;
    }
    if (state.mode === 'contract') {
      jsonResponse(response, 200, { data: [] });
      return;
    }
    const inputs = Array.isArray(body.input) ? body.input : [body.input];
    jsonResponse(response, 200, {
      data: inputs.map((input, index) => ({
        index,
        embedding: [String(input).length, index + 1, 0.5],
      })),
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    state,
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

const root = mkdtempSync(path.join(tmpdir(), 'oriveo-memory-embedding-test-'));
const memoryDirectory = writeFixture(root);
const secret = 'sk-stage1-secret';
const mock = await startMockProvider(secret);
const baseConfig = createMemoryEmbeddingConfig({
  provider: 'custom',
  baseUrl: mock.baseUrl,
  apiKey: secret,
  model: 'fixture-embedding-v1',
  timeoutMs: 1000,
  now: new Date('2026-08-01T00:00:00.000Z'),
});

try {
  await test('provider presets expose one complete metadata source for all four clouds and custom', () => {
    assert(Object.keys(MEMORY_EMBEDDING_PRESETS).join(',') === 'siliconflow,cloudflare,gemini,jina,custom', 'preset ids drifted');
    for (const preset of Object.values(MEMORY_EMBEDDING_PRESETS)) {
      assert(Array.isArray(preset.apply_steps) && preset.apply_steps.length >= 2, `${preset.id} apply steps are missing`);
      assert(typeof preset.privacy_note === 'string' && preset.privacy_note.length > 0, `${preset.id} privacy note is missing`);
      assert(typeof preset.quota_note === 'string' && preset.quota_note.length > 0, `${preset.id} quota note is missing`);
      assert(Array.isArray(preset.extra_fields), `${preset.id} extra fields are missing`);
    }
    const cloudflare = createMemoryEmbeddingConfig({
      provider: 'cloudflare',
      accountId: 'account_123',
      apiKey: secret,
      now: new Date('2026-08-01T00:00:00.000Z'),
    });
    assert(cloudflare.base_url.includes('/accounts/account_123/ai/v1'), 'Cloudflare account id was not resolved');
    assert(cloudflare.model === '@cf/baai/bge-m3', 'Cloudflare model default drifted');
  });

  await test('config contract is closed and atomic writes keep the secret file at 0600', () => {
    assertThrows(() => validateMemoryEmbeddingConfig({ ...baseConfig, surprise: true }), 'unknown field');
    const file = writeMemoryEmbeddingConfig({ root }, baseConfig);
    assert((statSync(file).mode & 0o777) === 0o600, 'config file mode must be 0600');
    assert(readMemoryEmbeddingConfig({ root }).api_key === secret, 'config round trip failed');
    const publicConfig = publicMemoryEmbeddingConfig(baseConfig);
    assert(!('api_key' in publicConfig), 'public config exposed api_key');
    assert(publicConfig.api_key_masked === 'sk-****', 'key mask is not stable');
  });

  await test('parameter CLI reads the key from env without printing it', async () => {
    const cliDirectory = '.local-test/cli-config';
    let output = '';
    const sink = { write: (chunk) => { output += chunk; } };
    await runCli([
      'config', '--root', root, '--directory', cliDirectory, '--provider', 'custom',
      '--base-url', mock.baseUrl, '--model', 'cli-model', '--api-key-env', 'FIXTURE_KEY', '--json',
    ], {
      stdin: { isTTY: false }, stdout: sink, stderr: sink, env: { FIXTURE_KEY: secret },
    });
    assert(!output.includes(secret), 'CLI output leaked the API key');
    assert(readMemoryEmbeddingConfig({ root, directory: cliDirectory }).api_key === secret, 'CLI did not persist env key');
  });

  await test('provider batches at 32 inputs and preserves input order', async () => {
    mock.state.mode = 'success';
    mock.state.requests = [];
    const client = createMemoryEmbeddingClient(baseConfig);
    const result = await client.embed(Array.from({ length: 65 }, (_, index) => `input-${index}`));
    assert(mock.state.requests.map((request) => request.count).join(',') === '32,32,1', 'provider batch sizes are wrong');
    assert(mock.state.requests.every((request) => request.authorization === `Bearer ${secret}`), 'authorization header is wrong');
    assert(result.vectors.length === 65 && result.dimensions === 3, 'provider result shape is wrong');
    assert(result.vectors[32][1] === 1, 'batch-local response ordering was not preserved');
  });

  await test('429 and 5xx use bounded exponential retry before succeeding', async () => {
    mock.state.mode = 'success';
    mock.state.requests = [];
    mock.state.retryStatuses = [429, 503];
    const delays = [];
    const client = createMemoryEmbeddingClient(baseConfig, { sleepImpl: async (delay) => delays.push(delay) });
    const result = await client.embedBatch(['retry']);
    assert(result.dimensions === 3, 'retry did not return a vector');
    assert(mock.state.requests.length === 3, 'retry attempt count is wrong');
    assert(delays.join(',') === '200,400', 'retry delays are not exponential');
  });

  await test('provider errors are classified and raw keys are always redacted', async () => {
    const client = createMemoryEmbeddingClient(baseConfig, { sleepImpl: async () => {} });
    mock.state.mode = 'auth';
    await assertRejects(() => client.embedBatch(['auth']), { category: 'auth', absent: secret });
    mock.state.mode = 'quota';
    mock.state.requests = [];
    await assertRejects(() => client.embedBatch(['quota']), { category: 'quota' });
    assert(mock.state.requests.length === 4, 'quota must stop after three retries');
    mock.state.mode = 'server';
    await assertRejects(() => client.embedBatch(['server']), { category: 'network' });
    mock.state.mode = 'contract';
    await assertRejects(() => client.embedBatch(['contract']), { category: 'contract' });

    // Credentials this side never stored still have to be scrubbed. Redaction covers three shapes:
    // the configured key, a quoted bearer token, and a key=value pair -- an upstream or a proxy in
    // front of it can echo any of them, and the text lands in the job error and on the dashboard.
    mock.state.mode = 'echo-auth';
    let echoed = null;
    try {
      await client.embedBatch(['echo']);
    } catch (error) {
      echoed = error;
    }
    assert(echoed, 'the echoing upstream must still produce an error');
    assert(!echoed.message.includes('sk-upstream-echoed-9f2a'),
      `a bearer token quoted by the upstream must be redacted, got ${JSON.stringify(echoed.message)}`);
    assert(!echoed.message.includes('sk-query-echoed-4c1b'),
      `a key=value credential quoted by the upstream must be redacted, got ${JSON.stringify(echoed.message)}`);
    assert(/Bearer \*+/.test(echoed.message),
      `the redacted bearer must remain visible as a placeholder, got ${JSON.stringify(echoed.message)}`);

    mock.state.mode = 'success';
  });

  // base_url is dialled with the stored key attached, so it is a credential-egress decision, not a
  // formatting one. A non-HTTP scheme or an embedded userinfo pair both send that key somewhere the
  // masking on the page cannot reach.
  await test('base_url refuses schemes and shapes that would leak the stored key', () => {
    const draft = overrides => createMemoryEmbeddingConfig({
      provider: 'custom',
      model: 'fixture-embedding-v1',
      apiKey: secret,
      ...overrides,
    });
    assert(draft({ baseUrl: 'https://embedding.invalid/v1' }).base_url === 'https://embedding.invalid/v1',
      'a plain HTTPS endpoint must stay acceptable, or the rejections below prove nothing');
    assert(draft({ baseUrl: 'http://127.0.0.1:8080/v1' }).base_url === 'http://127.0.0.1:8080/v1',
      'plain HTTP must stay acceptable for local endpoints');

    for (const baseUrl of [
      'file:///etc/passwd',
      'ftp://embedding.invalid/v1',
      'data:text/plain,embedding',
      'javascript:fetch("https://embedding.invalid")',
    ]) {
      let refused = null;
      try {
        draft({ baseUrl });
      } catch (error) {
        refused = error;
      }
      assert(refused, `base_url ${JSON.stringify(baseUrl)} must be refused`);
      assert(/HTTP or HTTPS|valid HTTP\(S\) URL/.test(refused.message),
        `${baseUrl} must be refused for its scheme, got ${refused.message}`);
    }

    for (const baseUrl of [
      'https://user:password@embedding.invalid/v1',
      'https://token@embedding.invalid/v1',
      'https://embedding.invalid/v1?api_key=leaked',
      'https://embedding.invalid/v1#fragment',
    ]) {
      let refused = null;
      try {
        draft({ baseUrl });
      } catch (error) {
        refused = error;
      }
      assert(refused, `base_url ${JSON.stringify(baseUrl)} must be refused rather than stored`);
    }
  });

  await test('connectivity self-test reports latency and dimensions', async () => {
    const result = await createMemoryEmbeddingClient(baseConfig).test();
    assert(result.provider === 'custom' && result.model === 'fixture-embedding-v1', 'test identity is wrong');
    assert(result.dimensions === 3 && result.latency_ms >= 0, 'test result metrics are wrong');
  });

  await test('float32 little-endian codec and cosine Top-K are deterministic', () => {
    const vector = Float32Array.from([1.5, -2.25, 0.125]);
    const encoded = encodeFloat32Vector(vector);
    const decoded = decodeFloat32Vector(encoded, 3);
    decoded.forEach((value, index) => assertNear(value, vector[index], 'float32 round trip failed'));
    assertNear(cosineSimilarity(Float32Array.from([1, 0]), Float32Array.from([1, 0])), 1, 'cosine identity failed');
    const corpus = { text_recipe: 'v1', snapshot_id: 'a'.repeat(64) };
    const artifact = createMemoryEmbeddingArtifact({
      config: baseConfig,
      corpus,
      dimensions: 2,
      entries: {
        topic_b: { content_sha256: 'b'.repeat(64), vector_b64: encodeFloat32Vector([0, 1]) },
        topic_a: { content_sha256: 'a'.repeat(64), vector_b64: encodeFloat32Vector([1, 0]) },
      },
      builtAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    assert(topKMemoryEmbeddingMatches(artifact, Float32Array.from([1, 0]), { limit: 1 })[0].document_id === 'topic_a', 'Top-K order is wrong');
    assertThrows(() => validateMemoryEmbeddingArtifact({ ...artifact, surprise: true }), 'unknown field');
  });

  await test('text recipe includes high-signal fields and hashes exact recipe content', () => {
    const first = createMemoryEmbeddingText({
      description: 'description', triggers: ['trigger'], hooks: ['- hook'], body: 'body', bodyCharLimit: 4,
    });
    const second = createMemoryEmbeddingText({
      description: 'description', triggers: ['trigger'], hooks: ['- changed'], body: 'body', bodyCharLimit: 4,
    });
    assert(first.includes('description') && first.includes('trigger') && first.includes('- hook') && first.endsWith('body'), 'text recipe lost a field');
    assert(first !== second, 'hook change must change recipe content');
  });

  await test('compiled corpus binds all active topics, L2 hooks, and the current snapshot', () => {
    compileMemoryIndex({ root });
    const corpus = loadMemoryEmbeddingCorpus({ root });
    assert(corpus.documents.length === 65, 'compiled corpus topic count is wrong');
    assert(corpus.documents[0].text.includes('Hook summary 0'), 'compiled corpus lost the L2 hook');
    assert(corpus.documents[0].content_sha256.length === 64, 'compiled corpus content hash is missing');
    assert(corpus.snapshot_id.length === 64, 'compiled corpus snapshot id is missing');
  });

  await test('full build creates a valid artifact and status reports zero stale entries', async () => {
    mock.state.mode = 'success';
    mock.state.requests = [];
    const result = await buildMemoryEmbeddings({ root, config: baseConfig });
    assert(result.mode === 'full' && result.embedded === 65 && result.stale === 0, 'full build result is wrong');
    assert(mock.state.requests.map((request) => request.count).join(',') === '32,32,1', 'full build batching is wrong');
    const artifact = readMemoryEmbeddingArtifact({ root, config: baseConfig });
    assert(Object.keys(artifact.entries).length === 65 && artifact.dimensions === 3, 'artifact content is wrong');
    const status = inspectMemoryEmbeddingStatus({ root });
    assert(status.reconciliation.stale === 0 && status.reconciliation.deleted === 0, 'status must be fully reconciled');
    assert(!JSON.stringify(status).includes(secret), 'status leaked the API key');
  });

  await test('one changed topic re-embeds once and one deletion performs no network call', async () => {
    const changed = 'topic_010';
    writeFileSync(path.join(memoryDirectory, `${changed}.md`), topic(changed, 'Body version 2 changed exactly once.'), 'utf8');
    mock.state.requests = [];
    const changedResult = await buildMemoryEmbeddings({ root, config: baseConfig });
    assert(changedResult.mode === 'incremental' && changedResult.embedded === 1, 'single change did not stay incremental');
    assert(mock.state.requests.length === 1 && mock.state.requests[0].count === 1, 'single change made extra requests');

    unlinkSync(path.join(memoryDirectory, 'topic_064.md'));
    mock.state.requests = [];
    const deletedResult = await buildMemoryEmbeddings({ root, config: baseConfig });
    assert(deletedResult.embedded === 0 && deletedResult.deleted === 1, 'deletion reconciliation is wrong');
    assert(mock.state.requests.length === 0, 'deletion must not call the provider');
    assert(Object.keys(readMemoryEmbeddingArtifact({ root, config: baseConfig }).entries).length === 64, 'deleted vector survived');
  });

  await test('changing model forces a full rebuild', async () => {
    const nextConfig = createMemoryEmbeddingConfig({
      provider: 'custom', baseUrl: mock.baseUrl, apiKey: secret, model: 'fixture-embedding-v2', timeoutMs: 1000,
    });
    mock.state.requests = [];
    const result = await buildMemoryEmbeddings({ root, config: nextConfig });
    assert(result.mode === 'full' && result.embedded === 64, 'model change did not force a full rebuild');
    assert(mock.state.requests.map((request) => request.count).join(',') === '32,32', 'model rebuild batching is wrong');
  });

  await test('interrupted build checkpoints one batch and resumes only the remainder', async () => {
    const resumeConfig = createMemoryEmbeddingConfig({
      provider: 'custom', baseUrl: mock.baseUrl, apiKey: secret, model: 'fixture-embedding-resume', timeoutMs: 1000,
    });
    let calls = 0;
    const failSecondFetch = async (...args) => {
      calls += 1;
      if (calls === 2) throw new Error('simulated interruption');
      return fetch(...args);
    };
    const error = await assertRejects(
      () => buildMemoryEmbeddings({ root, config: resumeConfig, fetchImpl: failSecondFetch }),
      { category: 'network', message: 'simulated interruption' },
    );
    assert(error instanceof MemoryEmbeddingProviderError, 'interruption must preserve provider error type');
    const checkpoint = readMemoryEmbeddingArtifact({ root, config: resumeConfig });
    assert(Object.keys(checkpoint.entries).length === 32, 'first batch was not checkpointed');
    mock.state.requests = [];
    const resumed = await buildMemoryEmbeddings({ root, config: resumeConfig });
    assert(resumed.mode === 'incremental' && resumed.embedded === 32 && resumed.stale === 0, 'resume did not embed only the remainder');
    assert(mock.state.requests.length === 1 && mock.state.requests[0].count === 32, 'resume made the wrong request set');
  });

  await test('reconciliation detects recipe changes as full rebuilds', () => {
    const corpus = loadMemoryEmbeddingCorpus({ root });
    const resumeConfig = createMemoryEmbeddingConfig({
      provider: 'custom', baseUrl: mock.baseUrl, apiKey: secret, model: 'fixture-embedding-resume', timeoutMs: 1000,
    });
    const artifact = readMemoryEmbeddingArtifact({
      root,
      config: resumeConfig,
    });
    const changedRecipe = { ...corpus, text_recipe: 'v2' };
    const result = reconcileMemoryEmbeddingArtifact({ config: resumeConfig, corpus: changedRecipe, artifact });
    assert(result.requires_full_rebuild && result.pending.length === corpus.documents.length, 'recipe change did not force full rebuild');
  });

  await test('an in-flight incremental build must not claim the new corpus snapshot', async () => {
    // Regression: checkpoints start from the previous entries, so mid-build the artifact holds
    // vectors the new corpus already invalidated. staleState compares presence only when the
    // snapshot ids match, so claiming the new id early made those carried-over vectors read as
    // fresh -- the channel would report degraded_reason null and rank on knowingly stale vectors.
    const partialConfig = createMemoryEmbeddingConfig({
      provider: 'custom', baseUrl: mock.baseUrl, apiKey: secret, model: 'fixture-embedding-partial', timeoutMs: 1000,
    });
    mock.state.mode = 'success';
    await buildMemoryEmbeddings({ root, config: partialConfig });
    const before = readMemoryEmbeddingArtifact({ root, config: partialConfig });

    // Change enough topics to span more than one batch, so an interruption lands mid-build.
    const changedIds = [];
    for (let index = 0; index < 40; index += 1) {
      const name = `topic_${String(index).padStart(3, '0')}`;
      writeFileSync(path.join(memoryDirectory, `${name}.md`), topic(name, `Partial build body revision ${index}.`), 'utf8');
      changedIds.push(name);
    }

    let calls = 0;
    const failSecondFetch = async (...args) => {
      calls += 1;
      if (calls === 2) throw new Error('simulated interruption');
      return fetch(...args);
    };
    await assertRejects(
      () => buildMemoryEmbeddings({ root, config: partialConfig, fetchImpl: failSecondFetch }),
      { category: 'network', message: 'simulated interruption' },
    );

    const partial = readMemoryEmbeddingArtifact({ root, config: partialConfig });
    const currentSnapshot = loadMemoryEmbeddingCorpus({ root }).snapshot_id;
    assert(currentSnapshot !== before.corpus_snapshot_id, 'the fixture edits must actually move the corpus snapshot');
    assert(
      partial.corpus_snapshot_id === before.corpus_snapshot_id,
      'a partial incremental build must keep the previous snapshot id so the recall fast path cannot read carried-over vectors as fresh',
    );
    const carriedOver = changedIds.filter((id) => partial.entries[id]
      && partial.entries[id].content_sha256 === before.entries[id]?.content_sha256);
    assert(carriedOver.length > 0, 'the scenario requires at least one carried-over stale entry, otherwise it proves nothing');

    mock.state.mode = 'success';
    const finished = await buildMemoryEmbeddings({ root, config: partialConfig });
    assert(finished.stale === 0, 'the resumed build must leave nothing stale');
    assert(
      readMemoryEmbeddingArtifact({ root, config: partialConfig }).corpus_snapshot_id === currentSnapshot,
      'a completed build must claim the new snapshot id',
    );
  });

  await test('an artifact under a retired schema rebuilds instead of deadlocking status and build', async () => {
    const file = memoryEmbeddingArtifactPath({ root, config: baseConfig });
    const retired = { ...JSON.parse(readFileSync(file, 'utf8')), schema: 'retired.memory-embedding-vectors/v1' };
    writeFileSync(file, JSON.stringify(retired), 'utf8');

    const status = inspectMemoryEmbeddingStatus({ root });
    assert(status.configured && status.artifact === null, 'an unreadable artifact must report as never built while staying configured');
    assert((status.artifact_error || '').includes('schema'), 'status must report why the artifact is unusable');

    mock.state.mode = 'success';
    mock.state.requests = [];
    const rebuilt = await buildMemoryEmbeddings({ root, config: baseConfig });
    assert(rebuilt.mode === 'full' && rebuilt.stale === 0, 'an unreadable artifact must force a full rebuild');
    assert((rebuilt.discarded_artifact || '').includes('schema'), 'build must report the artifact it discarded');
    assert(readMemoryEmbeddingArtifact({ root, config: baseConfig }).schema === 'ownmem-embedding-vectors/v1', 'rebuild must overwrite the retired file');
  });
} finally {
  await mock.close();
  rmSync(root, { recursive: true, force: true });
}

process.stdout.write(`Memory embedding self-test: ${passed}/${passed} passed\n`);
