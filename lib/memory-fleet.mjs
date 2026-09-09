import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import { commitsOnDay, daysBetween, readFleetArchives } from './memory-archive.mjs';
import { schemaPath } from './schema-paths.mjs';

/**
 * The view across machines, built from the daily packages in Git rather than any one machine's
 * expiring event files.
 *
 * It is a separate module from the archive for the same reason it is a separate schema from the
 * local report: it answers a different question from a different source. The archive writes what
 * one machine saw in one day; this reads what all of them saw across a window, and its first duty
 * is to say which days nobody saw at all.
 */
const FLEET_SCHEMA = JSON.parse(readFileSync(schemaPath('observability', 'fleet.schema.json'), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: true });
const validateFleetSchema = ajv.compile(FLEET_SCHEMA);

export function validateFleetReport(report) {
  if (!validateFleetSchema(report)) {
    const details = (validateFleetSchema.errors || [])
      .map(error => `${error.instancePath || '/'} ${error.message}`)
      .join('; ');
    throw new Error(`ownmem fleet report is invalid: ${details}`);
  }
  return report;
}

function mergeInto(target, rows, keyFields, countFields = ['count']) {
  for (const row of rows || []) {
    // NUL-joined, like the other composite keys in this codebase: a separator that cannot occur
    // inside a surface, agent or reason name is the only one that cannot silently merge two buckets.
    const key = keyFields.map(field => String(row[field])).join('\0');
    const entry = target.get(key)
      || {
        ...Object.fromEntries(keyFields.map(field => [field, row[field]])),
        ...Object.fromEntries(countFields.map(field => [field, 0])),
      };
    for (const field of countFields) entry[field] += row[field] || 0;
    target.set(key, entry);
  }
}

function sortedBuckets(map, keyFields) {
  return [...map.values()].sort((left, right) => {
    for (const field of keyFields) {
      const comparison = String(left[field]).localeCompare(String(right[field]), 'en');
      if (comparison !== 0) return comparison;
    }
    return 0;
  });
}

/**
 * Every machine's packages read together, with the days nobody covered named out loud.
 *
 * The merge is the easy half. The half that matters is the coverage matrix: this repository's
 * telemetry was split across machines with no way to notice it, so a report run at home spoke
 * confidently about a week in which the other machine did most of the work. A day with commits and
 * no package is therefore not a gap in a chart, it is a finding, and it is printed with how much
 * work it hid.
 *
 * Two installations on the same day stay two installations. Their counts are added into the merged
 * totals, and their per-day rows stay side by side; neither is folded into the other.
 */
export function collectFleetReport({
  root,
  memoryDir = '.claude/memory',
  fromDay,
  toDay,
  requested = null,
} = {}) {
  const fleet = readFleetArchives({ root, memoryDir });
  const window = daysBetween(fromDay, toDay);
  const registered = fleet.registry.installations;

  const eventBuckets = new Map();
  const retrievalBuckets = new Map();
  const abstainReasons = new Map();
  const feedbackVerdicts = new Map();
  const attributionLabels = new Map();
  const outcomeOutcomes = new Map();
  const merged = {
    packages: 0,
    events: 0,
    legacy_events: 0,
    nested_events: 0,
    unreadable_events: 0,
    retrieval_attempts: 0,
    retrieval_abstained: 0,
    legacy_attempts: 0,
    legacy_abstained: 0,
    nested_attempts: 0,
    nested_abstained: 0,
    produced_traces: 0,
    delivered_traces: 0,
    consumed_traces: 0,
    feedback_rows: 0,
    attribution_rows: 0,
    outcome_rows: 0,
  };

  const installations = fleet.installations.map(({ installation_id: installationId, packages }) => {
    const byDay = new Map(packages.map(item => [item.day, item]));
    const days = window.map(day => {
      const item = byDay.get(day);
      return {
        day,
        present: Boolean(item),
        partial_day: item ? item.partial_day === true : null,
        events: item ? item.events.total : null,
      };
    });
    const inWindow = window.map(day => byDay.get(day)).filter(Boolean);
    for (const item of inWindow) {
      merged.packages += 1;
      merged.events += item.events.total;
      merged.legacy_events += item.events.legacy;
      merged.nested_events += item.events.nested;
      merged.unreadable_events += item.events.unreadable;
      mergeInto(eventBuckets, item.events.buckets, ['event', 'surface', 'agent', 'nested']);
      merged.retrieval_attempts += item.retrieval.attempts;
      merged.retrieval_abstained += item.retrieval.abstained;
      merged.legacy_attempts += item.retrieval.legacy_attempts;
      merged.legacy_abstained += item.retrieval.legacy_abstained;
      merged.nested_attempts += item.retrieval.nested_attempts;
      merged.nested_abstained += item.retrieval.nested_abstained;
      mergeInto(retrievalBuckets, item.retrieval.buckets, ['surface', 'agent'], ['attempts', 'abstained']);
      mergeInto(abstainReasons, item.retrieval.abstain_reasons, ['surface', 'agent', 'reason']);
      merged.produced_traces += item.funnel.produced_traces;
      merged.delivered_traces += item.funnel.delivered_traces;
      merged.consumed_traces += item.funnel.consumed_traces;
      merged.feedback_rows += item.ledgers.feedback.rows;
      merged.attribution_rows += item.ledgers.attribution.rows;
      merged.outcome_rows += item.ledgers.outcome.rows;
      mergeInto(feedbackVerdicts, item.ledgers.feedback.by_verdict, ['verdict']);
      mergeInto(attributionLabels, item.ledgers.attribution.by_label, ['label']);
      mergeInto(outcomeOutcomes, item.ledgers.outcome.by_outcome, ['outcome']);
    }
    return {
      installation_id: installationId,
      alias: registered[installationId]?.alias ?? null,
      first_seen: registered[installationId]?.first_seen ?? null,
      registered: Object.hasOwn(registered, installationId),
      packages_in_window: inWindow.length,
      packages_total: packages.length,
      days,
      missing_days: days.filter(entry => !entry.present).map(entry => entry.day),
      partial_days: days.filter(entry => entry.partial_day === true).map(entry => entry.day),
      unreleased_delta_days: inWindow.filter(item => item.unreleased_delta === true).length,
      undetermined_delta_days: inWindow.filter(item => item.unreleased_delta === null).length,
      stack_versions: [...new Set(inWindow.map(item => item.stack_version).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right, 'en')),
      released_versions: [...new Set(inWindow.map(item => item.released_version).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right, 'en')),
      // Latency stays with the machine that measured it. Percentiles from two machines cannot be
      // added, and the worst of them is the only honest one-number summary of the pair.
      latency: inWindow.length === 0 ? null : {
        samples: inWindow.reduce((sum, item) => sum + item.latency.samples, 0),
        worst_p95: inWindow.map(item => item.latency.total_ms.p95).filter(value => value !== null)
          .reduce((worst, value) => (worst === null || value > worst ? value : worst), null),
      },
    };
  });

  const commitCache = new Map();
  const commitsFor = day => {
    if (!commitCache.has(day)) commitCache.set(day, commitsOnDay(root, day));
    return commitCache.get(day);
  };
  const missing = [];
  for (const installation of installations) {
    for (const day of installation.missing_days) {
      missing.push({ installation_id: installation.installation_id, day, commits: commitsFor(day) });
    }
  }
  const silentDays = window
    .filter(day => installations.every(item => !item.days.find(entry => entry.day === day)?.present))
    .map(day => ({ day, commits: commitsFor(day) }))
    .filter(entry => entry.commits === null || entry.commits > 0);

  const report = {
    schema: 'ownmem-fleet-report/v1',
    window: { requested, from_day: fromDay, to_day: toDay, days: window.length },
    telemetry_dir: fleet.telemetry_dir,
    registry_valid: fleet.registry.valid,
    installations,
    missing,
    // Days on which work landed and not one machine archived anything. This is the finding the
    // whole fleet view exists to produce; it is the shape the split-telemetry failure takes.
    silent_days: silentDays,
    merged: {
      ...merged,
      event_buckets: sortedBuckets(eventBuckets, ['event', 'surface', 'agent', 'nested']),
      retrieval_buckets: sortedBuckets(retrievalBuckets, ['surface', 'agent']),
      abstain_reasons: sortedBuckets(abstainReasons, ['surface', 'agent', 'reason']),
      feedback_verdicts: sortedBuckets(feedbackVerdicts, ['verdict']),
      attribution_labels: sortedBuckets(attributionLabels, ['label']),
      outcome_outcomes: sortedBuckets(outcomeOutcomes, ['outcome']),
      // Stated rather than omitted: a merged P95 would be a percentile of percentiles, which is a
      // percentile of nothing. Latency stays per installation.
      latency_mergeable: false,
      latency_unmergeable_reason: 'a percentile cannot be recovered from other percentiles, so latency stays per installation and is never pooled here',
    },
  };
  return validateFleetReport(report);
}

const COVERAGE_PRESENT = '●';
const COVERAGE_PARTIAL = '◐';
const COVERAGE_ABSENT = '○';
const WINDOW_ARROW = '→';
const ALERT = '⚠';

function coverageGlyph(entry) {
  if (!entry.present) return COVERAGE_ABSENT;
  return entry.partial_day ? COVERAGE_PARTIAL : COVERAGE_PRESENT;
}

function shortDay(day) {
  return day.slice(5);
}

/**
 * The coverage matrix comes first, before any total.
 *
 * A merged number read before its coverage is a number about an unknown fraction of the fleet, and
 * that is precisely the mistake this report was built to stop. The reader sees which machine
 * covered which day, then the days nobody covered, and only then what the packages add up to.
 */
export function formatFleetReport(report) {
  const width = Math.max(12, ...report.installations.map(item => (item.alias || item.installation_id).length));
  const lines = [`Fleet coverage ${report.window.from_day} ${WINDOW_ARROW} ${report.window.to_day} (UTC)`];
  if (report.installations.length === 0) {
    lines.push('  no installation has archived anything yet');
  }
  for (const installation of report.installations) {
    const name = (installation.alias || installation.installation_id).padEnd(width, ' ');
    if (installation.packages_total === 0) {
      lines.push(`  ${name}   (no packages yet)`);
      continue;
    }
    const matrix = installation.days.map(coverageGlyph).join('');
    const missing = report.missing.filter(item => item.installation_id === installation.installation_id);
    const detail = missing.length === 0
      ? 'complete'
      : `missing ${missing.map(item => shortDay(item.day)).join(', ')}`
        + ` (${missing.map(item => (item.commits === null ? 'unknown' : item.commits)).join(', ')} commits)`;
    lines.push(`  ${name}   ${matrix}   ${detail}`);
  }
  for (const day of report.silent_days) {
    lines.push(`  ${ALERT} ${shortDay(day.day)}: ${day.commits === null ? 'commit count unknown' : `${day.commits} commits`}, 0 packages from any installation`);
  }
  lines.push(`Merged over ${report.merged.packages} package(s): ${report.merged.events} event(s),`
    + ` legacy ${report.merged.legacy_events}, nested ${report.merged.nested_events},`
    + ` unreadable ${report.merged.unreadable_events}`);
  lines.push(`Merged retrieval: ${report.merged.retrieval_abstained}/${report.merged.retrieval_attempts} abstained;`
    + ` legacy ${report.merged.legacy_abstained}/${report.merged.legacy_attempts} and`
    + ` nested ${report.merged.nested_abstained}/${report.merged.nested_attempts} counted apart, in no agent's denominator`);
  lines.push(`Merged funnel: produced ${report.merged.produced_traces} -> delivered ${report.merged.delivered_traces}`
    + ` -> confirmed full-text opens ${report.merged.consumed_traces} (each package pairs within its own UTC day)`);
  lines.push(`Merged ledgers: ${report.merged.feedback_rows} retrieval verdict(s),`
    + ` ${report.merged.attribution_rows} weak label(s), ${report.merged.outcome_rows} outcome receipt(s)`);
  lines.push(`Latency is not merged: ${report.merged.latency_unmergeable_reason}`);
  for (const installation of report.installations) {
    if (installation.packages_in_window === 0) continue;
    const name = installation.alias || installation.installation_id;
    lines.push(`  ${name}: stack ${installation.stack_versions.join(', ') || 'unknown'},`
      + ` released ${installation.released_versions.join(', ') || 'unknown'},`
      + ` ${installation.unreleased_delta_days} day(s) ran an unreleased tree`
      + `${installation.undetermined_delta_days > 0 ? `, ${installation.undetermined_delta_days} undetermined` : ''},`
      + ` worst P95 ${installation.latency?.worst_p95 ?? 'n/a'}ms over ${installation.latency?.samples ?? 0} recall(s)`);
  }
  return `${lines.join('\n')}\n`;
}
