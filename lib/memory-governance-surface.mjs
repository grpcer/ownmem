// Where the governance panels get their numbers.
//
// `collectPromotionGovernance` next door is deliberately injectable: it knows how to present a
// surface honestly -- empty, absent, unreadable or malformed -- and knows nothing about where the
// observation windows and the quarantine rows come from. This module is the other half. It reads
// the two ledgers the tripwire owns and hands back exactly the shape that collector accepts.
//
// Two decisions here were made by measuring rather than by taste, and both are about the fact that
// `ownmem report` and the console are paths a person is waiting on:
//
//   1. The observation windows need delivery counts, and delivery counts mean reading the whole
//      local event directory -- 56.2 ms on this repository. That read is skipped entirely when the
//      promotion ledger holds no promotion, which is the state of every machine that has never
//      promoted anything. Today it costs nothing; the moment there is something to watch, it costs
//      what it costs and the panel is worth it.
//   2. The degrade signals are NOT evaluated here. `collectTrustTripwireSignals` re-resolves trust
//      for every watched memory (85.8 ms for three of them, because it loads the whole corpus
//      first), and running the ledger half without the trust half would print a partial hit set
//      that looks complete. So these panels report state -- what is being watched, what is not
//      being injected -- and `ownmem tripwire status` is what evaluates signals. Nothing is lost:
//      every quarantine row already names the signal that put it there.
//
// This module writes nothing. It reads two ledgers and, when there is something to watch, one event
// directory.

import {
  DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY,
  readMemoryObservabilityEvents,
} from './memory-observability.mjs';
import {
  DEFAULT_PROMOTION_LEDGER_FILE,
  readPromotionLedger,
} from './memory-promotion-receipt.mjs';
import {
  DEFAULT_QUARANTINE_FILE,
  quarantineFilePath,
  quarantineState,
  readQuarantineLedger,
} from './memory-quarantine.mjs';
import {
  TRIPWIRE_DEFAULT_OBSERVATIONS,
  TRIPWIRE_DEFAULT_SETTLE_HOURS,
  memoryDeliveries,
  promotionObservationWindows,
} from './memory-tripwire.mjs';
import {
  GOVERNANCE_PREVIEW_CAP,
  collectPromotionGovernance,
} from './memory-review-material.mjs';

const OBSERVATION_DENOMINATOR = 'promotion chains in the local ledger that opened an observation window. A window closes only when the memory has been delivered its required number of times AND the settle time has passed, so a promotion nobody has seen again stays under observation rather than ageing out unwatched. This panel reports which windows are open; ownmem tripwire status is what evaluates the degrade signals inside them';

const QUARANTINE_DENOMINATOR = 'rows in the local quarantine ledger. It is append only and the last row for a memory wins, so a memory quarantined, released and quarantined again is three rows and one entry; the entry count is what is not being injected right now';

const OBSERVATION_EMPTY = 'No promotion has opened an observation window on this machine. A window opens when a promotion is applied, and nothing is applied without a person, so this does not fill up on its own';

const QUARANTINE_EMPTY = 'Nothing has been quarantined on this machine. A row is written when a degrade signal fires against a promotion that armed it, so an empty ledger means no signal has fired, not that none was looked for';

/**
 * The observation-window surface, or a stated reason there is none.
 *
 * The event read is conditional and that is the whole performance story: with no promotion in the
 * ledger there is nothing whose exposures could matter, so the 56 ms is not spent to compute a zero.
 */
function observationWindowSurface({
  root,
  memoryDir,
  ledgerFile,
  observabilityDirectory,
  observations,
  settleHours,
  now,
}) {
  let ledger;
  try {
    ({ ledger } = readPromotionLedger({ root, memoryDir, fileName: ledgerFile }));
  } catch (error) {
    return { unreadable: `the promotion ledger could not be read: ${error.message}` };
  }
  const promotions = Object.keys(ledger.promotions || {});
  let deliveries = [];
  if (promotions.length > 0) {
    try {
      deliveries = memoryDeliveries(readMemoryObservabilityEvents({ root, directory: observabilityDirectory }).events);
    } catch {
      // No event directory yet, or it is unreadable. An observation period with no exposures stays
      // open, which is the conservative answer, so the panel degrades to "still watching" rather
      // than to a reason nobody can act on. The same choice the tripwire command makes.
      deliveries = [];
    }
  }
  const windows = promotionObservationWindows({
    ledger,
    deliveries,
    now,
    observationsRequired: observations,
    settleHours,
  });
  const open = windows.filter(window => window.open);
  return {
    // What is being watched right now, which is not the same number as how many windows exist.
    entries: open.length,
    denominator: promotions.length,
    denominator_definition: OBSERVATION_DENOMINATOR,
    sample: windows.length,
    empty_reason: windows.length === 0 ? OBSERVATION_EMPTY : null,
    items: windows.slice(0, GOVERNANCE_PREVIEW_CAP).map(window => ({
      promotion_id: window.promotion_id,
      memory_id: window.memory_id,
      open: window.open,
      observations: window.observations,
      observations_required: window.observations_required,
      opened_at: window.opened_at,
      settles_at: window.settles_at,
      closed_reason: window.closed_reason,
    })),
  };
}

/**
 * The quarantine surface, or a stated reason there is none.
 *
 * A broken ledger is reported as unreadable rather than as empty, which is the opposite of what the
 * recall path does with the same file and deliberately so: recall must keep answering with a
 * corrupt local file, and a panel whose job is to say what is currently unsafe must never quietly
 * render a file it could not read as "nothing is unsafe".
 */
function quarantineSurface({ root, quarantineFile }) {
  const file = quarantineFilePath({ root, file: quarantineFile });
  const ledger = readQuarantineLedger(file);
  if (ledger.errors.length > 0) {
    return {
      unreadable: `the quarantine ledger has ${ledger.errors.length} unreadable row(s) and cannot be used to say what is currently unsafe: ${ledger.errors.slice(0, 2).join('; ')}`,
    };
  }
  const state = [...quarantineState(ledger.entries).values()];
  const active = state.filter(entry => entry.action === 'quarantine');
  return {
    entries: active.length,
    denominator: ledger.entries.length,
    denominator_definition: QUARANTINE_DENOMINATOR,
    sample: state.length,
    empty_reason: state.length === 0 ? QUARANTINE_EMPTY : null,
    items: active.slice(0, GOVERNANCE_PREVIEW_CAP).map(entry => ({
      memory_id: entry.memory_id,
      signal: entry.signal ?? null,
      recorded_at: entry.recorded_at,
      source: entry.source ?? null,
      promotion_id: entry.promotion_id ?? null,
    })),
  };
}

/**
 * Both tripwire-owned surfaces, in the shape the presentation collector accepts.
 *
 * Separated from the call below so a caller that already has one of them -- a test pinning a
 * fixture, a host that collects its own -- can supply it without this module reading anything.
 */
export function collectTripwireGovernanceSurfaces({
  root,
  memoryDir = '.claude/memory',
  ledgerFile = DEFAULT_PROMOTION_LEDGER_FILE,
  quarantineFile = DEFAULT_QUARANTINE_FILE,
  observabilityDirectory = DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY,
  observations = TRIPWIRE_DEFAULT_OBSERVATIONS,
  settleHours = TRIPWIRE_DEFAULT_SETTLE_HOURS,
  now = new Date(),
} = {}) {
  if (!root) throw new Error('collectTripwireGovernanceSurfaces requires a repository root');
  return {
    observation_window: observationWindowSurface({
      root, memoryDir, ledgerFile, observabilityDirectory, observations, settleHours, now,
    }),
    quarantine: quarantineSurface({ root, quarantineFile }),
  };
}

/**
 * The whole governance surface with every collector this build has, wired in.
 *
 * One function for both readers -- the report and the console -- so the panel and the report line
 * can never be computed two different ways. An explicitly supplied surface wins, and supplying both
 * means nothing is read here at all.
 */
export function collectMemoryGovernance({
  root,
  memoryDir = '.claude/memory',
  candidateDirectory = undefined,
  ledgerFile = DEFAULT_PROMOTION_LEDGER_FILE,
  quarantineFile = DEFAULT_QUARANTINE_FILE,
  observabilityDirectory = DEFAULT_MEMORY_OBSERVABILITY_DIRECTORY,
  observation_window: observationWindow = null,
  quarantine = null,
  now = new Date(),
} = {}) {
  const collected = observationWindow !== null && quarantine !== null
    ? { observation_window: null, quarantine: null }
    : collectTripwireGovernanceSurfaces({
      root, memoryDir, ledgerFile, quarantineFile, observabilityDirectory, now,
    });
  return collectPromotionGovernance({
    root,
    memoryDir,
    ...(candidateDirectory === undefined ? {} : { candidateDirectory }),
    observation_window: observationWindow ?? collected.observation_window,
    quarantine: quarantine ?? collected.quarantine,
    now,
  });
}
