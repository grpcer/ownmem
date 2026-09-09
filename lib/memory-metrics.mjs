/**
 * The counting rules the local report and the committed daily telemetry package both use.
 *
 * They live apart from either consumer for one reason: the daily package reduces a day to counts
 * that a later fleet report reads back, so a second definition of "attempt", "abstain rate" or
 * "P95" would produce two numbers carrying one name -- and the disagreement would surface months
 * later, in a table nobody can re-derive. One definition, imported by both.
 */

export function percentile(values, ratio) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

export function distribution(values) {
  const rounded = value => value === null ? null : Number(value.toFixed(3));
  return {
    samples: values.length,
    p50: rounded(percentile(values, 0.5)),
    p95: rounded(percentile(values, 0.95)),
    p99: rounded(percentile(values, 0.99)),
  };
}

// Cohorts split three ways (surface × execution × query shape), which is the right granularity for
// latency but too fine to read an abstain rate off. This one groups by surface alone.
export function summarizeRetrievalBySurface(attempts) {
  const bySurface = new Map();
  for (const event of attempts) {
    const surface = event.payload.surface || 'unknown';
    const entry = bySurface.get(surface) || { attempts: 0, abstained: 0 };
    entry.attempts += 1;
    if (event.payload.abstained) entry.abstained += 1;
    bySurface.set(surface, entry);
  }
  return Object.fromEntries([...bySurface.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'en'))
    .map(([surface, entry]) => [surface, {
      attempts: entry.attempts,
      abstained: entry.abstained,
      abstain_rate: ratio(entry.abstained, entry.attempts),
    }]));
}

/**
 * The same abstain rate split by both dimensions at once. Surface alone stopped being enough when
 * three hosts started sharing this ledger: `hook` is one entry point, but Claude, grok and Codex
 * reach it with different working habits, and a blended hook rate hides that.
 *
 * Two exclusions, both counted out loud rather than folded in. Rows written before the agent field
 * existed carry no honest answer -- those days genuinely were mixed -- so they are reported as
 * `legacy` and enter no agent's numerator or denominator. Rows whose environment showed markers
 * for more than one host are equally unattributable, so they are counted apart as well; the agent
 * they were filed under is this build's tie-break, not an observation.
 */
export function summarizeRetrievalBySurfaceAgent(attempts) {
  const buckets = new Map();
  const excluded = { legacy_attempts: 0, legacy_abstained: 0, nested_attempts: 0, nested_abstained: 0 };
  for (const event of attempts) {
    const abstained = Boolean(event.payload.abstained);
    if (typeof event.agent !== 'string') {
      excluded.legacy_attempts += 1;
      if (abstained) excluded.legacy_abstained += 1;
      continue;
    }
    if (event.nested === true) {
      excluded.nested_attempts += 1;
      if (abstained) excluded.nested_abstained += 1;
      continue;
    }
    const key = `${event.payload.surface || 'unknown'}/${event.agent}`;
    const entry = buckets.get(key) || { attempts: 0, abstained: 0 };
    entry.attempts += 1;
    if (abstained) entry.abstained += 1;
    buckets.set(key, entry);
  }
  return {
    buckets: Object.fromEntries([...buckets.entries()]
      .sort(([left], [right]) => left.localeCompare(right, 'en'))
      .map(([key, entry]) => [key, {
        attempts: entry.attempts,
        abstained: entry.abstained,
        abstain_rate: ratio(entry.abstained, entry.attempts),
      }])),
    ...excluded,
  };
}

export function ratio(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}
