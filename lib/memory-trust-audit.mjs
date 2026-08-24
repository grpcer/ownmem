import { createHash } from 'node:crypto';
import { loadMemoryTopics } from './memory-schema.mjs';
import { EVIDENCE_UNVERIFIABLE_REASON, TEST_EXECUTION_REASONS } from './memory-evidence-verifier.mjs';
import {
  formatTestExecutionSummary,
  readTestExecutionLedger,
  summarizeTestExecution,
} from './memory-test-execution-ledger.mjs';
import {
  memoryGitState,
  readMemoryTrustLock,
  resolveMemoryTrust,
} from './memory-trust-store.mjs';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

function issue(level, code, message, details = []) {
  return { level, code, message, details };
}

// `receipt-missing` and `content-drift` are the two states an ordinary day of writing memory
// produces: a new topic has no receipt yet, an edited one no longer matches its last receipt.
// Reporting them without the command that clears them turns the gate into a dead end, so the
// remediation travels with the finding. The default spelling is the public CLI; a host that
// installs its own entry point passes the spelling its users actually type.
const REPAIRABLE_BY_ISSUE = new Set(['receipt-missing', 'content-drift']);
const DEFAULT_ISSUE_COMMAND = 'ownmem trust issue';

export function collectMemoryTrustAudit({
  root,
  memoryDir = '.ownmem',
  strictWorkingTree = false,
  now = new Date(),
  catalogPath = null,
  issueCommand = DEFAULT_ISSUE_COMMAND,
} = {}) {
  const output = [];
  let lock;
  try {
    lock = readMemoryTrustLock({ root, memoryDir }).lock;
  } catch (error) {
    // An install that predates trust receipts has no lock at all. `init --update` writes one, but an
    // upgraded repository whose next command happens to be `audit` would otherwise read a bare
    // "lock is missing" and have nowhere to go, so the bootstrap spelling travels with the finding.
    const bootstrapCommand = `${issueCommand.replace(/\s+issue$/u, '')} bootstrap`;
    const message = /is missing/u.test(error.message)
      ? `${error.message}; run: ${bootstrapCommand}`
      : error.message;
    return {
      schema: 'ownmem-trust-audit/v1',
      issues: [issue('error', 'trust-lock-invalid', message)],
      summary: {
        topics: 0,
        schema_valid: 0,
        evidence_valid: 0,
        active: 0,
        advisory: 0,
        quarantined: 0,
        drifted: 0,
        test_execution: summarizeTestExecution([], null),
      },
      quota_utility: {
        schema: 'ownmem-quota-utility/v1',
        automatic_deletions: 0,
        signals_available: [],
        signals_unavailable: ['trust-lock-invalid'],
        review_proposals: [],
      },
    };
  }
  const loaded = loadMemoryTopics({ root, memoryDir });
  const topics = loaded.filter(topic => topic.record);
  // Schema validity and evidence validity answer different questions -- "is this file well formed"
  // versus "does what it points at still hold" -- and collapsing them into one number hides which
  // of the two is actually broken. They are counted and reported separately.
  const schemaValid = topics.filter(topic => !topic.issues.some(item => item.level === 'error')).length;
  const topicNames = new Set(topics.map(topic => topic.record.name));
  const git = memoryGitState(root, memoryDir);
  // Loaded once and handed to every resolution: the ledger is one file for the whole corpus.
  const testLedger = readTestExecutionLedger({ root, memoryDir }).ledger;
  const testChecks = [];
  let active = 0;
  let advisory = 0;
  let quarantined = 0;
  let drifted = 0;
  let evidenceValid = 0;
  const utilityProposals = [];
  for (const topic of topics) {
    const document = {
      id: topic.record.name,
      source_sha256: sha256(topic.content),
      metadata: { last_verified: topic.record.metadata.last_verified },
    };
    const trust = resolveMemoryTrust({
      root,
      memoryDir,
      document,
      trustLock: lock,
      now,
      strictWorkingTree,
      catalogPath,
      gitState: git,
      // Same rule as compileMemoryTrust: the audit is a static, query-independent check, so it has
      // no platform or environment to judge valid_for against. Evaluating it here would read blank
      // values and report a receipt scoped to any platform as quarantined on every machine.
      // Applicability is answered at query time, by the caller that actually holds a context.
      evaluateApplicability: false,
      testLedger,
    });
    testChecks.push(trust.evidence.checks);
    const lifecycle = trust.receipt?.lifecycle || 'missing';
    if (lifecycle === 'active') active += 1;
    if (lifecycle === 'advisory') advisory += 1;
    // No receipt means there is nothing to verify against, which is not the same as verified.
    if (trust.receipt && trust.evidence.blocking.length === 0) evidenceValid += 1;
    if (!trust.valid) {
      quarantined += 1;
      const structural = trust.reasons.some(reason => ['receipt-missing', 'receipt-tampered', 'content-drift', 'evidence-root-tampered'].includes(reason));
      const level = structural || lifecycle === 'active' ? 'error' : 'warning';
      const repairable = trust.reasons.some(reason => REPAIRABLE_BY_ISSUE.has(reason));
      // `--refresh-evidence` is the wrong advice here and saying nothing is worse: an anchor that
      // vanished cannot be re-signed, it has to be pointed at where the thing lives now (or the
      // memory retired). Naming that separately is what keeps this reason distinguishable from the
      // advisory drift below, which the same command does clear.
      const unverifiable = trust.reasons.includes(EVIDENCE_UNVERIFIABLE_REASON);
      const remedy = repairable
        ? `; run: ${issueCommand} ${topic.record.name}`
        : unverifiable
          ? '; its evidence anchor is gone or was tampered with, so re-signing cannot clear it: point the memory at where the anchor lives now, then re-issue'
          : '';
      output.push(issue(level, 'trust-quarantined', `${topic.record.name} is quarantined: ${trust.reasons.join(', ')}${remedy}`, trust.evidence.failures.map(item => `${item.kind}:${item.locator}:${item.reason}`)));
    } else if (trust.advisory_reasons?.length > 0) {
      // Code moved but is still there: warn and keep the memory injectable at advisory authority.
      // Failing the gate here would make it red almost permanently and hide the real errors.
      // The remedy travels with it for the same reason it does above: without a command that clears
      // it, the downgrade is permanent and every memory eventually ends up advisory.
      const driftReasons = trust.advisory_reasons.filter(reason => !TEST_EXECUTION_REASONS.includes(reason));
      const executionReasons = trust.advisory_reasons.filter(reason => TEST_EXECUTION_REASONS.includes(reason));
      if (driftReasons.length > 0) {
        drifted += 1;
        output.push(issue('warning', 'trust-evidence-drift', `${topic.record.name} evidence drifted, downgraded to advisory: ${driftReasons.join(', ')}; if it still holds, run: ${issueCommand} ${topic.record.name} --refresh-evidence`, trust.evidence.advisory.filter(item => !TEST_EXECUTION_REASONS.includes(item.reason)).map(item => `${item.kind}:${item.locator}:${item.reason}`)));
      }
      if (executionReasons.length > 0) {
        // Deliberately not the same remedy: re-signing evidence would not make a red test green,
        // and a stale record is cleared by running that suite again and ingesting the output.
        // The detail lines come from the checks' execution status, not from their `reason`: an
        // anchor that drifted *and* went stale reports the drift as its reason, and filtering on
        // that would print a warning with an empty body.
        const details = trust.evidence.checks
          .filter(check => check.kind === 'test' && ['failed', 'stale'].includes(check.execution?.status))
          .map(check => `${check.kind}:${check.locator}:test-execution-${check.execution.status}`);
        output.push(issue('warning', 'trust-test-execution', `${topic.record.name} cites a test whose last observed run does not vouch for it, downgraded to advisory: ${executionReasons.join(', ')}; re-run that suite and ingest its output`, details));
      }
    }
    if (lifecycle === 'advisory' || !trust.valid) {
      utilityProposals.push({
        memory_id: topic.record.name,
        lifecycle,
        authority: trust.receipt?.authority || 'unreceipted',
        recommendation: !trust.valid ? 'repair-or-quarantine' : 'review-for-merge-or-promotion',
        reasons: trust.valid ? ['advisory-only'] : trust.reasons,
      });
    }
  }
  for (const memoryId of Object.keys(lock.receipts)) {
    if (!topicNames.has(memoryId)) output.push(issue('error', 'trust-orphan-receipt', `trust receipt points to a non-active topic: ${memoryId}`));
  }
  if (strictWorkingTree && git.working_tree !== 'clean') {
    output.push(issue('error', 'trust-working-tree', `strict trust audit requires clean memory topic sources; state=${git.working_tree}`, git.entries));
  }
  return {
    schema: 'ownmem-trust-audit/v1',
    issues: output,
    summary: {
      topics: topics.length,
      schema_valid: schemaValid,
      evidence_valid: evidenceValid,
      active,
      advisory,
      quarantined,
      drifted,
      test_execution: summarizeTestExecution(testChecks, testLedger),
    },
    quota_utility: {
      schema: 'ownmem-quota-utility/v1',
      automatic_deletions: 0,
      signals_available: ['lifecycle', 'evidence-validity', 'wall-clock-freshness'],
      signals_unavailable: ['recall-frequency', 'wrong-feedback', 'consumption', 'applicability-rejection-rate'],
      review_proposals: utilityProposals.sort((left, right) => compareText(left.memory_id, right.memory_id)),
    },
  };
}

// One line per report, shared by `trust check` and the memory audit, so the two never drift into
// describing the same corpus differently.
export function formatMemoryTrustSummary(summary, quotaUtility) {
  const proposals = quotaUtility?.review_proposals.length ?? 0;
  // `automatic_deletions` stays in the JSON, where a consumer can assert it is zero and prove the
  // quota report is proposal-only. It is not rendered as a count: it is a design invariant, not a
  // measurement, and printing "automatic deletions=0" reads like an observed number that could
  // one day be non-zero. Nothing counts up to it, so the human line states the policy instead.
  return [
    `Memory trust: topics=${summary.topics} active=${summary.active} advisory=${summary.advisory} quarantined=${summary.quarantined} evidence-drifted=${summary.drifted ?? 0}; quota proposals=${proposals} (review only; memory is never deleted automatically)`,
    `Memory validity: schema valid=${summary.schema_valid ?? 0}/${summary.topics}, evidence valid=${summary.evidence_valid ?? 0}/${summary.topics} (drift is reported separately and does not invalidate).`,
    // Coverage of "was this cited test ever observed to run". Counts only, never a percentage of a
    // measurement that has not been taken: an unconnected runner reads as unconnected, not as zero.
    formatTestExecutionSummary(summary.test_execution || summarizeTestExecution([], null)),
  ];
}

export function formatMemoryTrustAudit(report) {
  const lines = report.issues.map(item => `${item.level === 'error' ? 'ERROR' : 'WARN'}: ${item.message}`);
  lines.push(...formatMemoryTrustSummary(report.summary, report.quota_utility));
  const errors = report.issues.filter(item => item.level === 'error').length;
  lines.push(errors > 0 ? `Memory trust failed with ${errors} error(s).` : 'Memory trust passed.');
  return `${lines.join('\n')}\n`;
}
