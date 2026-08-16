import { parentPort, workerData } from 'node:worker_threads';
import {
  executeMemoryEmbeddingQueryBatch,
  memoryEmbeddingQueryFailureReason,
} from './memory-embedding-query.mjs';

if (!parentPort) throw new Error('memory embedding query worker requires a parent port');

try {
  const result = await executeMemoryEmbeddingQueryBatch(workerData.config, workerData.queries);
  const message = {
    schema: 'ownmem-embedding-query-worker-result/v1',
    ok: true,
    vectors: result.vectors,
    latency_ms: result.latencyMs,
    degraded_reason: null,
  };
  parentPort.postMessage(message, result.vectors.map((vector) => vector.buffer));
} catch (error) {
  parentPort.postMessage({
    schema: 'ownmem-embedding-query-worker-result/v1',
    ok: false,
    vectors: null,
    latency_ms: null,
    degraded_reason: memoryEmbeddingQueryFailureReason(error),
  });
} finally {
  parentPort.close();
}
