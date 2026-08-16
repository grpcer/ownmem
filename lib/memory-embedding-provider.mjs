import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv/dist/2020.js';
import { stableJson } from './memory-index-store.mjs';

export const MEMORY_EMBEDDING_CONFIG_SCHEMA = 'ownmem-embedding-config/v1';
export const DEFAULT_MEMORY_EMBEDDING_DIRECTORY = '.local-test/memory-embedding';
export const MEMORY_EMBEDDING_BATCH_SIZE = 32;
export const MEMORY_EMBEDDING_MAX_RETRIES = 3;
/**
 * timeout_ms (800ms by default) is the query hot-path budget; recall should abandon the
 * semantic lane instead of blocking the user. Setup connectivity, bulk embedding, and A/B
 * vector preparation use batches and therefore need a wider operational timeout.
 */
export const MEMORY_EMBEDDING_SETUP_TIMEOUT_MS = 15_000;

/** Setup-time configuration copy that widens only the timeout. */
export function memoryEmbeddingSetupConfig(config, { timeoutMs = MEMORY_EMBEDDING_SETUP_TIMEOUT_MS } = {}) {
  return { ...config, timeout_ms: Math.max(config.timeout_ms, timeoutMs) };
}

const SCRIPT_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CONFIG_SCHEMA_PATH = path.join(SCRIPT_DIR, 'memory-embedding-config.schema.json');
const configSchema = JSON.parse(readFileSync(CONFIG_SCHEMA_PATH, 'utf8'));
const validateConfigSchema = new Ajv({ allErrors: true, strict: true }).compile(configSchema);

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export const MEMORY_EMBEDDING_PRESETS = deepFreeze({
  siliconflow: {
    id: 'siliconflow',
    label: 'SiliconFlow',
    tagline: 'bge-m3 handles mixed Chinese and English well; the set stays free for good, 8k input.',
    // trains_on_input drives the wizard warning and confirmation without provider-ID conditionals.
    trains_on_input: false,
    badges: [
      { text: 'no training on input', tone: 'ok' },
      { text: 'free indefinitely', tone: 'ok' },
      { text: 'needs a Chinese phone number', tone: '' },
    ],
    base_url: 'https://api.siliconflow.cn/v1',
    default_model: 'BAAI/bge-m3',
    models: ['BAAI/bge-m3'],
    apply_url: 'https://cloud.siliconflow.cn/account/ak',
    apply_steps: [
      'Register or sign in to the SiliconFlow console.',
      'Open the API keys page and create a new key.',
      'Copy the key. This tool only writes it to a local 0600 config file.',
    ],
    privacy_note: 'The published terms state that API request content is not stored and not used to train models.',
    quota_note: 'The BAAI/bge-m3 free allowance is whatever the console shows at the time; this preset uses the China-site endpoint.',
    extra_fields: [],
    verified_at: '2026-08-01',
  },
  cloudflare: {
    id: 'cloudflare',
    label: 'Cloudflare Workers AI',
    tagline: '10k neurons reset daily, effectively more than enough, and no card required.',
    trains_on_input: false,
    badges: [
      { text: 'no training on input', tone: 'ok' },
      { text: 'resets daily', tone: 'ok' },
      { text: 'works well outside China', tone: '' },
    ],
    base_url: 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1',
    default_model: '@cf/baai/bge-m3',
    models: ['@cf/baai/bge-m3'],
    apply_url: 'https://dash.cloudflare.com/',
    apply_steps: [
      'Sign in to the Cloudflare dashboard and pick an account.',
      'Copy the Account ID from the right side of the account home page.',
      'Go to Workers AI, choose Use REST API, click Create a Workers AI API Token and keep the prefilled permission template.',
      'Enter the Account ID and the token here.',
    ],
    privacy_note: 'Cloudflare states that Workers AI inference inputs and outputs are not used to train models.',
    quota_note: 'The Workers AI free quota resets daily; the dashboard is the authority on the actual allowance.',
    extra_fields: [{
      id: 'account_id',
      label: 'Cloudflare Account ID',
      required: true,
      placeholder: '32-character account id',
    }],
    verified_at: '2026-08-01',
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    tagline: 'Top-tier embedding quality, roughly 1,000 requests per day.',
    trains_on_input: true,
    badges: [
      { text: 'free tier data is used for training', tone: 'bad' },
      { text: 'top-tier quality', tone: '' },
    ],
    base_url: 'https://generativelanguage.googleapis.com/v1beta/openai',
    default_model: 'gemini-embedding-001',
    models: ['gemini-embedding-001'],
    apply_url: 'https://aistudio.google.com/apikey',
    apply_steps: [
      'Sign in to Google AI Studio.',
      'Open the API Keys page and create a key restricted to the Gemini API.',
      'Copy the key, then acknowledge the training-risk warning below to continue.',
    ],
    privacy_note: 'Warning: on the Gemini free tier your request content may be used to improve Google products, and the free tier cannot opt out.',
    quota_note: 'Free-tier rates and daily quotas change; the AI Studio project panel is the authority.',
    extra_fields: [],
    verified_at: '2026-08-01',
  },
  jina: {
    id: 'jina',
    label: 'Jina AI',
    tagline: 'Ready immediately: a new account gets a one-off 10M tokens.',
    trains_on_input: false,
    badges: [
      { text: 'no training on input', tone: 'ok' },
      { text: 'one-off allowance', tone: '' },
    ],
    base_url: 'https://api.jina.ai/v1',
    default_model: 'jina-embeddings-v3',
    models: ['jina-embeddings-v3'],
    apply_url: 'https://jina.ai/embeddings/',
    apply_steps: [
      'Sign in to Jina AI.',
      'Create or copy an API key on the Embeddings API page.',
      'Enter the key here and run the connectivity test.',
    ],
    privacy_note: 'How Jina handles API data depends on the current terms of service and your account plan.',
    quota_note: 'The trial allowance and rate limits for a new account are whatever the Jina console shows at the time.',
    extra_fields: [],
    verified_at: '2026-08-01',
  },
  custom: {
    id: 'custom',
    label: 'Custom endpoint',
    tagline: 'Any OpenAI-compatible /v1/embeddings, including a local Ollama later on.',
    trains_on_input: false,
    badges: [{ text: 'check the terms yourself', tone: 'warn' }],
    base_url: null,
    default_model: null,
    models: [],
    apply_url: null,
    apply_steps: [
      'Get an OpenAI-compatible base URL, an API key and an embedding model id from the provider.',
      'Confirm the endpoint accepts POST /embeddings and returns the OpenAI data[].embedding shape.',
      'Fill in the three fields and run the connectivity test.',
    ],
    privacy_note: 'Data handling is entirely up to the custom provider; check their terms yourself before connecting.',
    quota_note: 'Allowance and billing are set by the custom provider.',
    extra_fields: [],
    verified_at: '2026-08-01',
  },
});

function schemaErrorMessage(error) {
  const pointer = error.instancePath || '/';
  if (error.keyword === 'additionalProperties') {
    return `${pointer} contains unknown field "${error.params.additionalProperty}"`;
  }
  if (error.keyword === 'required') {
    return `${pointer} is missing required field "${error.params.missingProperty}"`;
  }
  return `${pointer} ${error.message}`;
}

function validateBaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('memory embedding base_url must be a valid HTTP(S) URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('memory embedding base_url must use HTTP or HTTPS');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('memory embedding base_url must not contain credentials, query, or fragment');
  }
  return parsed.toString().replace(/\/$/, '');
}

export function validateMemoryEmbeddingConfig(value) {
  if (!validateConfigSchema(value)) {
    const details = (validateConfigSchema.errors || []).slice(0, 5).map(schemaErrorMessage).join('; ');
    throw new Error(`memory embedding config is invalid: ${details}`);
  }
  const normalizedBaseUrl = validateBaseUrl(value.base_url);
  if (normalizedBaseUrl !== value.base_url.replace(/\/$/, '')) {
    throw new Error('memory embedding base_url must be normalized');
  }
  if (!Number.isFinite(Date.parse(value.updated_at))) {
    throw new Error('memory embedding updated_at must be a real ISO timestamp');
  }
  if (value.api_key !== value.api_key.trim() || /[\u0000-\u001f\u007f]/.test(value.api_key)) {
    throw new Error('memory embedding api_key must not contain surrounding whitespace or control characters');
  }
  if (value.model !== value.model.trim() || /[\u0000-\u001f\u007f]/.test(value.model)) {
    throw new Error('memory embedding model must not contain surrounding whitespace or control characters');
  }
  return value;
}

export function memoryEmbeddingPaths({
  root,
  directory = DEFAULT_MEMORY_EMBEDDING_DIRECTORY,
} = {}) {
  if (!root) throw new Error('memory embedding paths require a repository root');
  const absoluteRoot = path.resolve(root);
  const baseDirectory = path.resolve(absoluteRoot, directory);
  const relative = path.relative(absoluteRoot, baseDirectory);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('memory embedding directory must be inside the repository root');
  }
  if (relative !== '.local-test' && !relative.startsWith(`.local-test${path.sep}`)) {
    throw new Error('memory embedding directory must stay under the gitignored .local-test directory');
  }
  return {
    directory: baseDirectory,
    config: path.join(baseDirectory, 'config.json'),
    vectors: path.join(baseDirectory, 'vectors'),
  };
}

function atomicPrivateJson(file, value) {
  const directory = path.dirname(file);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `.tmp-${process.pid}-${randomBytes(8).toString('hex')}`);
  let descriptor;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    writeFileSync(descriptor, stableJson(value), 'utf8');
    closeSync(descriptor);
    descriptor = undefined;
    chmodSync(temporary, 0o600);
    renameSync(temporary, file);
    chmodSync(file, 0o600);
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporary, { force: true });
    throw error;
  }
}

export function readMemoryEmbeddingConfig(options = {}) {
  const file = memoryEmbeddingPaths(options).config;
  if (!existsSync(file)) return null;
  let value;
  try {
    value = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`memory embedding config is unreadable: ${error.message}`);
  }
  validateMemoryEmbeddingConfig(value);
  return value;
}

export function writeMemoryEmbeddingConfig(options = {}, value) {
  validateMemoryEmbeddingConfig(value);
  const file = memoryEmbeddingPaths(options).config;
  atomicPrivateJson(file, value);
  if ((statSync(file).mode & 0o777) !== 0o600) {
    throw new Error('memory embedding config permissions must be 0600');
  }
  return file;
}

function requireText(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

export function createMemoryEmbeddingConfig({
  provider,
  baseUrl,
  apiKey,
  model,
  dimensions = null,
  accountId,
  timeoutMs = 800,
  now = new Date(),
} = {}) {
  const preset = MEMORY_EMBEDDING_PRESETS[provider];
  if (!preset) throw new Error(`unknown memory embedding provider: ${provider}`);
  let resolvedBaseUrl = String(baseUrl || preset.base_url || '').trim();
  if (resolvedBaseUrl.includes('{account_id}')) {
    const resolvedAccountId = requireText(accountId, 'Cloudflare account_id');
    if (!/^[A-Za-z0-9_-]+$/.test(resolvedAccountId)) {
      throw new Error('Cloudflare account_id contains invalid characters');
    }
    resolvedBaseUrl = resolvedBaseUrl.replace('{account_id}', resolvedAccountId);
  }
  const config = {
    schema: MEMORY_EMBEDDING_CONFIG_SCHEMA,
    provider,
    base_url: validateBaseUrl(requireText(resolvedBaseUrl, 'base_url')),
    api_key: requireText(apiKey, 'api_key'),
    model: requireText(model || preset.default_model, 'model'),
    dimensions: dimensions === null || dimensions === undefined ? null : Number(dimensions),
    enabled: false,
    rrf_weight: 0,
    confidence_contribution: true,
    timeout_ms: Number(timeoutMs),
    updated_at: now.toISOString(),
    last_ab_report: null,
  };
  return validateMemoryEmbeddingConfig(config);
}

export function maskMemoryEmbeddingKey(apiKey) {
  const value = String(apiKey || '');
  if (!value) return '****';
  const prefixMatch = value.match(/^[A-Za-z0-9]{1,4}-/);
  if (prefixMatch) return `${prefixMatch[0]}****`;
  return `${value.slice(0, Math.min(4, value.length))}****`;
}

export function publicMemoryEmbeddingConfig(config) {
  if (!config) return null;
  validateMemoryEmbeddingConfig(config);
  const { api_key: apiKey, ...safe } = config;
  return { ...safe, api_key_masked: maskMemoryEmbeddingKey(apiKey) };
}

function redactMessage(message, apiKey) {
  let safe = String(message || 'memory embedding request failed');
  if (apiKey) safe = safe.split(apiKey).join(maskMemoryEmbeddingKey(apiKey));
  safe = safe.replace(/(Bearer\s+)[^\s"']+/gi, '$1****');
  safe = safe.replace(/((?:api[_-]?key|token)\s*[:=]\s*)[^\s,"']+/gi, '$1****');
  return safe.slice(0, 1000);
}

export class MemoryEmbeddingProviderError extends Error {
  constructor(category, message, { status = null, retryable = false, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'MemoryEmbeddingProviderError';
    this.category = category;
    this.status = status;
    this.retryable = retryable;
  }
}

function embeddingEndpoint(baseUrl) {
  return `${baseUrl.replace(/\/+$/, '')}/embeddings`;
}

function responseCategory(status) {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'quota';
  if (status >= 500) return 'network';
  return 'contract';
}

function retryDelay(attempt) {
  return 200 * (2 ** attempt);
}

function defaultSleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function combinedAbortSignal(timeoutMs, externalSignal) {
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(new Error('request timed out')), timeoutMs);
  const signal = externalSignal && typeof AbortSignal.any === 'function'
    ? AbortSignal.any([timeoutController.signal, externalSignal])
    : timeoutController.signal;
  return { signal, dispose: () => clearTimeout(timer) };
}

function validateEmbeddingResponse(value, expectedCount, configuredDimensions) {
  if (!value || !Array.isArray(value.data) || value.data.length !== expectedCount) {
    throw new Error(`response data must contain exactly ${expectedCount} embedding item(s)`);
  }
  const allIndexed = value.data.every((item) => Number.isInteger(item?.index));
  const noIndexed = value.data.every((item) => item?.index === undefined);
  if (!allIndexed && !noIndexed) throw new Error('response data indexes must be consistently present or absent');
  const ordered = allIndexed ? [...value.data].sort((left, right) => left.index - right.index) : value.data;
  if (allIndexed && ordered.some((item, index) => item.index !== index)) {
    throw new Error('response data indexes must cover every input exactly once');
  }
  let dimensions = configuredDimensions;
  const vectors = ordered.map((item, index) => {
    if (!Array.isArray(item?.embedding) || item.embedding.length === 0) {
      throw new Error(`response data[${index}].embedding must be a non-empty array`);
    }
    const vector = item.embedding.map(Number);
    if (vector.some((number) => !Number.isFinite(number))) {
      throw new Error(`response data[${index}].embedding must contain only finite numbers`);
    }
    dimensions ??= vector.length;
    if (vector.length !== dimensions) throw new Error('response embedding dimensions are inconsistent');
    return Float32Array.from(vector);
  });
  return { vectors, dimensions };
}

async function responseBody(response) {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return '';
  }
}

function normalizeEmbeddingBatch(inputs) {
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > MEMORY_EMBEDDING_BATCH_SIZE) {
    throw new Error(`memory embedding batch must contain 1-${MEMORY_EMBEDDING_BATCH_SIZE} inputs`);
  }
  return inputs.map((input) => requireText(input, 'embedding input'));
}

async function fetchEmbeddingResponse(config, payload, { fetchImpl, signal }) {
  const requestAbort = combinedAbortSignal(config.timeout_ms, signal);
  try {
    return await fetchImpl(embeddingEndpoint(config.base_url), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.api_key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: requestAbort.signal,
    });
  } catch (error) {
    throw new MemoryEmbeddingProviderError(
      'network',
      redactMessage(`network request failed: ${error.message}`, config.api_key),
      { cause: error },
    );
  } finally {
    requestAbort.dispose();
  }
}

async function parseEmbeddingResponse(config, response, expectedCount) {
  let body;
  try {
    body = await response.json();
  } catch (error) {
    throw new MemoryEmbeddingProviderError(
      'contract',
      redactMessage(`embedding provider returned invalid JSON: ${error.message}`, config.api_key),
      { status: response.status, cause: error },
    );
  }
  try {
    return validateEmbeddingResponse(body, expectedCount, config.dimensions);
  } catch (error) {
    throw new MemoryEmbeddingProviderError(
      'contract',
      redactMessage(`embedding provider contract error: ${error.message}`, config.api_key),
      { status: response.status, cause: error },
    );
  }
}

async function requestMemoryEmbeddingBatch(config, inputs, {
  fetchImpl,
  sleepImpl,
  signal,
  maxRetries = MEMORY_EMBEDDING_MAX_RETRIES,
}) {
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > MEMORY_EMBEDDING_MAX_RETRIES) {
    throw new Error(`memory embedding maxRetries must be between 0 and ${MEMORY_EMBEDDING_MAX_RETRIES}`);
  }
  const normalizedInputs = normalizeEmbeddingBatch(inputs);
  const payload = { model: config.model, input: normalizedInputs };
  if (config.dimensions !== null) payload.dimensions = config.dimensions;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const response = await fetchEmbeddingResponse(config, payload, { fetchImpl, signal });
    if (response.ok) return parseEmbeddingResponse(config, response, normalizedInputs.length);
    const body = redactMessage(await responseBody(response), config.api_key);
    const canRetry = (response.status === 429 || response.status >= 500)
      && attempt < maxRetries;
    if (canRetry) {
      await sleepImpl(retryDelay(attempt));
      continue;
    }
    throw new MemoryEmbeddingProviderError(
      responseCategory(response.status),
      `embedding provider returned HTTP ${response.status}${body ? `: ${body}` : ''}`,
      { status: response.status, retryable: false },
    );
  }
  throw new Error('memory embedding retry loop exhausted unexpectedly');
}

async function embedMemoryInputs(config, inputs, dependencies, { signal, onBatch } = {}) {
  if (!Array.isArray(inputs) || inputs.length === 0) throw new Error('memory embedding inputs must not be empty');
  const vectors = [];
  let dimensions = config.dimensions;
  for (let offset = 0; offset < inputs.length; offset += MEMORY_EMBEDDING_BATCH_SIZE) {
    const batchInputs = inputs.slice(offset, offset + MEMORY_EMBEDDING_BATCH_SIZE);
    const result = await requestMemoryEmbeddingBatch(config, batchInputs, { ...dependencies, signal });
    dimensions ??= result.dimensions;
    if (result.dimensions !== dimensions) {
      throw new MemoryEmbeddingProviderError('contract', 'embedding dimensions changed between batches');
    }
    vectors.push(...result.vectors);
    await onBatch?.({ offset, inputs: batchInputs, vectors: result.vectors, dimensions });
  }
  return { vectors, dimensions };
}

async function testMemoryEmbeddingConnection(config, dependencies, { signal } = {}) {
  const started = performance.now();
  const result = await requestMemoryEmbeddingBatch(
    config,
    ['OwnMem memory embedding connectivity test'],
    { ...dependencies, signal },
  );
  return {
    schema: 'ownmem-embedding-test-result/v1',
    provider: config.provider,
    model: config.model,
    dimensions: result.dimensions,
    latency_ms: Number((performance.now() - started).toFixed(3)),
  };
}

export function createMemoryEmbeddingClient(config, {
  fetchImpl = globalThis.fetch,
  sleepImpl = defaultSleep,
  maxRetries = MEMORY_EMBEDDING_MAX_RETRIES,
} = {}) {
  validateMemoryEmbeddingConfig(config);
  if (typeof fetchImpl !== 'function') throw new Error('memory embedding client requires fetch');
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > MEMORY_EMBEDDING_MAX_RETRIES) {
    throw new Error(`memory embedding maxRetries must be between 0 and ${MEMORY_EMBEDDING_MAX_RETRIES}`);
  }
  const dependencies = { fetchImpl, sleepImpl, maxRetries };
  return {
    embedBatch: (inputs, options) => requestMemoryEmbeddingBatch(config, inputs, { ...dependencies, ...options }),
    embed: (inputs, options) => embedMemoryInputs(config, inputs, dependencies, options),
    test: (options) => testMemoryEmbeddingConnection(config, dependencies, options),
  };
}
