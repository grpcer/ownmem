import { performance } from 'node:perf_hooks';
import {
  createMemoryEmbeddingClient,
  MemoryEmbeddingProviderError,
} from './memory-embedding-provider.mjs';

function timeoutError() {
  const error = new Error('memory embedding query timed out');
  error.memoryEmbeddingDegradedReason = 'timeout';
  return error;
}

export function memoryEmbeddingQueryFailureReason(error) {
  if (error?.memoryEmbeddingDegradedReason) return error.memoryEmbeddingDegradedReason;
  if (error instanceof MemoryEmbeddingProviderError) return error.category;
  return 'contract';
}

export async function executeMemoryEmbeddingQueryBatch(config, queries, {
  fetchImpl = globalThis.fetch,
  sleepImpl,
} = {}) {
  if (!Array.isArray(queries) || queries.length < 1 || queries.length > 3) {
    throw new Error('memory embedding query batch requires 1-3 queries');
  }
  const controller = new AbortController();
  const startedAt = performance.now();
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      const error = timeoutError();
      controller.abort(error);
      reject(error);
    }, config.timeout_ms);
  });
  try {
    const client = createMemoryEmbeddingClient(config, {
      fetchImpl,
      sleepImpl,
      maxRetries: 0,
    });
    const result = await Promise.race([
      client.embedBatch(queries, { signal: controller.signal }),
      timeout,
    ]);
    return {
      vectors: result.vectors,
      latencyMs: performance.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
