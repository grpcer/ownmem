/**
 * An MCP server over stdio, exposing exactly two tools: recall and read.
 *
 * Why two and not more. Every other command this package has is either a gate somebody runs on
 * purpose (`audit`, `trust`, `compile`) or a write (`init`, `new`, `outcome`). Exposing those as
 * tools would let a model run them because they were within reach, and a memory system whose
 * governance commands are one token away from an autonomous agent has no governance. `recall` and
 * `read` are the two operations that are read-only, idempotent and are the whole point of the
 * system being there.
 *
 * `read` is not a convenience wrapper around the filesystem. It is the only producer of
 * `recall.consumed` outside the Claude Read hook, which means it is how the full-text-open funnel --
 * and, since 2026-09-19, the pointer-to-open conversion beside it -- gets measured at all for a host
 * that has no tool-level hook (Codex CLI has none). Handing the model a
 * `read` tool is therefore also the cheapest honest way to collect that signal: compliance comes
 * from "you had to read it anyway" rather than from remembering to report.
 *
 * The protocol is hand-rolled rather than taken from the MCP SDK, for the same reason the retrieval
 * path takes no dependency: this package promises zero-model, zero-network recall, and a consumer
 * auditing that promise should not have to read a dependency tree to believe it. The surface used
 * here is small and stable -- initialize, tools/list, tools/call, plus notification handling -- and
 * every message is framed as one JSON object per line.
 *
 * Errors are returned as tool results with `isError`, never as JSON-RPC errors, whenever the failure
 * is about the request rather than the protocol. A model that receives a protocol error usually
 * cannot see it; a tool result it can read and act on.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

export const MCP_PROTOCOL_VERSION = '2024-11-05';
export const MCP_SERVER_NAME = 'ownmem';

// Kept in step with the CLI's own limit, so a model cannot get a wider envelope through MCP than a
// person gets through the terminal.
const MAX_QUERY_LENGTH = 512;
const MAX_MULTI_QUERIES = 3;

export function mcpToolDefinitions() {
  return [
    {
      name: 'recall',
      description: 'Search this repository\'s engineering memory. Local, deterministic, no model and '
        + 'no network call. Returns either quoted memories, pointers to read, or an explicit '
        + 'abstention -- an empty result means the corpus has no answer, not that the search failed.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['query'],
        properties: {
          query: {
            type: 'string',
            minLength: 1,
            maxLength: MAX_QUERY_LENGTH,
            description: 'A symptom in plain language, an identifier, an error code or a repository path.',
          },
          phrasings: {
            type: 'array',
            maxItems: MAX_MULTI_QUERIES,
            items: { type: 'string', minLength: 1, maxLength: MAX_QUERY_LENGTH },
            description: 'Optional alternative wordings of the same question, fused into one envelope. '
              + 'Use when the symptom and the technical term are different vocabularies.',
          },
        },
      },
    },
    {
      name: 'read',
      description: 'Read the full text of one memory by name, and record that it was actually opened. '
        + 'Use this rather than reading the file directly: the recorded open is the only measurement '
        + 'of whether memory is used, and reading around it makes the system unable to report on itself.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['name'],
        properties: {
          name: {
            type: 'string',
            pattern: '^[a-z0-9]+(?:_[a-z0-9]+)*$',
            description: 'The memory id, as returned by recall.',
          },
        },
      },
    },
  ];
}

function textResult(text, { isError = false } = {}) {
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) };
}

/**
 * Render an envelope for a model rather than for a terminal.
 *
 * The three delivery tiers are named explicitly, because the difference between them is the whole
 * contract: quoted prose is vouched for, a pointer is a place to look and explicitly not an answer,
 * and an abstention is the corpus saying it does not know. Collapsing them into "here are some
 * results" is what makes a model treat a pointer as a conclusion.
 */
export function renderEnvelopeForModel(envelope) {
  const results = envelope.results || [];
  const pointers = envelope.pointers || [];
  if (results.length === 0 && pointers.length === 0) {
    const reason = envelope.abstain?.reason || 'no-trusted-candidate';
    return `No memory answers this (abstained: ${reason}). Treat this as "nothing is written down about it", `
      + 'not as a failed search; proceed from the code.';
  }
  const lines = [];
  if (results.length > 0) {
    lines.push('Memories (quoted, and vouched for by a trust receipt):');
    for (const result of results) {
      lines.push(`- ${result.memory_id} (${result.path})`);
      if (result.excerpt?.text) lines.push(`  ${result.excerpt.text}`);
      const trust = result.trust || {};
      // Only when it says something. Nominal trust describes every healthy memory and printing it
      // trains the reader to skip the field entirely.
      if (trust.integrity && trust.integrity !== 'passed') {
        lines.push(`  trust: ${trust.integrity} (${trust.authority || 'observed'}) -- not fully verified, re-check before relying on it`);
      }
    }
  }
  if (pointers.length > 0) {
    lines.push('Pointers (a place to look, NOT an answer -- open them with the read tool before using them):');
    for (const pointer of pointers) {
      lines.push(`- ${pointer.memory_id}: ${pointer.summary}`);
    }
  }
  if (envelope.warnings?.length > 0) lines.push(`Warnings: ${envelope.warnings.join('; ')}`);
  return lines.join('\n');
}

/**
 * One request in, one response out. Exported separately from the transport so the whole protocol
 * surface is testable without spawning a process or opening a socket.
 */
export async function handleMcpRequest(message, context) {
  const { id, method, params } = message;
  const reply = (result) => ({ jsonrpc: '2.0', id, result });
  const fail = (code, msg) => ({ jsonrpc: '2.0', id, error: { code, message: msg } });

  if (method === 'initialize') {
    return reply({
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: MCP_SERVER_NAME, version: context.version },
    });
  }
  if (method === 'tools/list') return reply({ tools: mcpToolDefinitions() });
  if (method === 'ping') return reply({});
  if (method !== 'tools/call') return fail(-32601, `unknown method: ${method}`);

  const name = params?.name;
  const args = params?.arguments || {};
  if (name === 'recall') {
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (!query) return reply(textResult('recall requires a non-empty query', { isError: true }));
    if (query.length > MAX_QUERY_LENGTH) {
      return reply(textResult(`query exceeds ${MAX_QUERY_LENGTH} characters`, { isError: true }));
    }
    const phrasings = Array.isArray(args.phrasings)
      ? args.phrasings.map((item) => String(item || '').trim()).filter(Boolean).slice(0, MAX_MULTI_QUERIES - 1)
      : [];
    try {
      const envelope = await context.recall([query, ...phrasings]);
      return reply(textResult(renderEnvelopeForModel(envelope)));
    } catch (error) {
      return reply(textResult(`recall failed: ${error.message}`, { isError: true }));
    }
  }
  if (name === 'read') {
    const topic = typeof args.name === 'string' ? args.name.trim() : '';
    if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/u.test(topic)) {
      return reply(textResult('read requires a memory id such as sheet_detent_lazy_container', { isError: true }));
    }
    try {
      const result = await context.read(topic);
      if (!result.found) return reply(textResult(`no memory named ${topic}`, { isError: true }));
      return reply(textResult(result.content));
    } catch (error) {
      return reply(textResult(`read failed: ${error.message}`, { isError: true }));
    }
  }
  return reply(textResult(`unknown tool: ${name}`, { isError: true }));
}

/**
 * Line-delimited JSON over stdio.
 *
 * Notifications (a message with no `id`) get no response at all -- answering one is a protocol
 * violation that some clients treat as fatal, and `notifications/initialized` arrives on every
 * single session, so getting this wrong breaks every connection rather than an occasional one.
 */
export async function serveMcp({ input, output, context }) {
  let buffer = '';
  for await (const chunk of input) {
    buffer += chunk.toString('utf8');
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        output.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } })}\n`);
        continue;
      }
      if (message.id === undefined || message.id === null) continue;
      const response = await handleMcpRequest(message, context);
      output.write(`${JSON.stringify(response)}\n`);
    }
  }
}

export function readMemoryTopicFile({ root, memoryDir, name }) {
  const file = path.resolve(root, memoryDir, `${name}.md`);
  try {
    return { found: true, content: readFileSync(file, 'utf8'), path: file };
  } catch {
    return { found: false, content: '', path: file };
  }
}

/**
 * The production context: the same recall runtime and the same read path the CLI uses.
 *
 * Both go through the real entry points rather than reimplementing anything, which is what makes
 * the consumption receipt land -- `readMemoryTopic` is where `recall.consumed` is written, and an
 * MCP `read` that bypassed it would quietly make full-text opens unobservable for exactly the hosts
 * that need this server most.
 */
export async function createMcpContext({ root, memoryDir, indexDirectory }) {
  // Both from lib/, because this server ships in the public package and the repository-only CLI
  // entries do not. `memory-topic-read.mjs` exists for exactly this reason.
  const [{ createMemoryRecallRuntime, queryMemoryRuntime, queryMemoryRuntimeMulti, MEMORY_RECALL_RUNTIME_VERSION, memoryRecallTrustContext },
    { readMemoryTopic }] = await Promise.all([
    import('./features/recall.mjs'),
    import('./memory-topic-read.mjs'),
  ]);
  const runtime = createMemoryRecallRuntime({
    root,
    memoryDir,
    ...(indexDirectory ? { indexDirectory } : {}),
    trustContext: memoryRecallTrustContext(root),
  });
  return {
    version: MEMORY_RECALL_RUNTIME_VERSION,
    async recall(queries) {
      const result = queries.length > 1
        ? queryMemoryRuntimeMulti(runtime, queries, { surface: 'mcp' })
        : queryMemoryRuntime(runtime, queries[0], { surface: 'mcp' });
      return result.envelope;
    },
    async read(name) {
      try {
        // record: true on purpose -- see the module comment. This is the measurement, not a side effect.
        const result = readMemoryTopic({ root, memoryDir, name, record: true });
        return { found: true, content: result.content };
      } catch {
        return { found: false, content: '' };
      }
    },
  };
}
