/**
 * Read one memory's full text, and record that it was actually opened.
 *
 * This lives in `lib/` rather than next to the CLI because it is a capability, not an entry point:
 * the terminal (`memory-read.mjs`) and the MCP `read` tool are two callers of the same thing, and
 * the MCP server ships in the public package while that CLI does not. A second implementation would
 * have been the obvious shortcut and the wrong one -- the consumption receipt written here is the
 * only measurement of whether memory is used at all, so two copies means two chances for a caller
 * to quietly stop producing it.
 *
 * Recording is never an error path. A read that does not pair with a recall is recorded as unpaired
 * rather than dropped: the read may be direct, or the recall may have aged out of the ledger, and
 * neither makes the read untrue.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { MemoryRecallLedger } from './memory-recall-ledger.mjs';
import { recordMemoryConsumption } from './memory-observability.mjs';

const TOPIC_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

export function resolveMemoryFile({ root, memoryDir, name }) {
  if (!TOPIC_PATTERN.test(name)) {
    throw new Error(`not a valid memory name: ${name} (lowercase letters, digits and underscores only, for example android_old_runtime_compat_crash)`);
  }
  const directory = path.resolve(root, memoryDir);
  const file = path.join(directory, `${name}.md`);
  if (path.dirname(file) !== directory) throw new Error('memory name must resolve inside the memory directory');
  return file;
}

export function readMemoryTopic(options) {
  const file = resolveMemoryFile(options);
  if (!existsSync(file)) {
    throw new Error(`memory not found: ${options.name} (run bash scripts/memory-recall.sh '<anchor>' to confirm the name, or it may have been archived)`);
  }
  const content = readFileSync(file, 'utf8');
  let consumption = null;
  if (options.record) {
    try {
      const ledger = new MemoryRecallLedger({ root: options.root, directory: options.directory });
      const match = ledger.consume({ sessionId: options.sessionId, memoryId: options.name });
      if (match) {
        recordMemoryConsumption({
          root: options.root,
          directory: options.directory,
          traceId: match.traceId,
          snapshotId: match.snapshotId,
          topics: [options.name],
          authorityFollowed: options.authorityFollowed,
          component: 'memory-read',
          via: 'cli',
          match: match.match,
        });
        consumption = { recorded: true, trace_id: match.traceId, match: match.match, recall_source: match.via ?? null };
      } else {
        // Not pairing with a recall is not an error: the read may be direct, or the recall may have
        // fallen outside the ledger TTL. Record it honestly as unpaired.
        consumption = { recorded: false, trace_id: null, match: null, recall_source: null };
      }
    } catch (error) {
      consumption = { recorded: false, trace_id: null, match: null, recall_source: null, error: error.message };
    }
  }
  return { file: path.relative(path.resolve(options.root), file), content, consumption };
}
