/**
 * Instrumentation self-checks find scalar fields that look measured but remain constant and
 * declared producers that never emit. Consumer-only fixtures cannot prove that a production
 * path can produce more than its placeholder value, so sufficient real samples with one scalar
 * value raise a warning. The warning expires automatically once the producer varies. Legitimate
 * constants exist, so these findings never become hard failures by themselves.
 */

import { MEMORY_RECALL_COMPONENTS } from './memory-observability.mjs';

// Register every event-producing component so a path that never runs remains observable.
// Recall degradation components expand from their shared registry to avoid duplicate inventories.
export const EXPECTED_MEMORY_COMPONENTS = Object.freeze([
  'memory-compile',
  'memory-hook',
  'memory-maintenance',
  'memory-observe',
  'memory-read',
  'memory-recall-cli',
  'memory-recall-runtime',
  ...MEMORY_RECALL_COMPONENTS,
].sort((left, right) => left.localeCompare(right, 'en')));

export const DEFAULT_CONSTANT_FIELD_MINIMUM_SAMPLES = 30;

function isScalar(value) {
  return value === null || ['boolean', 'number', 'string'].includes(typeof value);
}

/** Find scalar payload fields with only one value after minimumSamples events of a type. */
export function detectConstantPayloadFields(events, {
  minimumSamples = DEFAULT_CONSTANT_FIELD_MINIMUM_SAMPLES,
  ignore = [],
} = {}) {
  const ignored = new Set(ignore);
  const byEvent = new Map();
  for (const event of events) {
    let fields = byEvent.get(event.event);
    if (!fields) {
      fields = { samples: 0, values: new Map() };
      byEvent.set(event.event, fields);
    }
    fields.samples += 1;
    for (const [key, value] of Object.entries(event.payload || {})) {
      if (!isScalar(value)) continue;
      let seen = fields.values.get(key);
      if (!seen) {
        seen = new Set();
        fields.values.set(key, seen);
      }
        // Once a second value appears the field is not constant; stop retaining more values.
      if (seen.size <= 1) seen.add(JSON.stringify(value));
    }
  }

  const findings = [];
  for (const [eventName, fields] of byEvent) {
    if (fields.samples < minimumSamples) continue;
    for (const [field, values] of fields.values) {
      const anchor = `${eventName}.${field}`;
      if (values.size !== 1 || ignored.has(anchor)) continue;
      findings.push({ event: eventName, field, anchor, value: JSON.parse([...values][0]), samples: fields.samples });
    }
  }
  return findings.sort((left, right) => left.anchor.localeCompare(right.anchor, 'en'));
}

/** Return declared event producers absent from the observed event batch. */
export function detectSilentComponents(events, { expected = EXPECTED_MEMORY_COMPONENTS } = {}) {
  const observed = new Set(events.map((event) => event.process?.component).filter(Boolean));
  return {
    observed: [...observed].sort((left, right) => left.localeCompare(right, 'en')),
    silent: expected.filter((component) => !observed.has(component)),
    unexpected: [...observed].filter((component) => !expected.includes(component))
      .sort((left, right) => left.localeCompare(right, 'en')),
  };
}

export function collectInstrumentationHealth(events, options = {}) {
  const constantFields = detectConstantPayloadFields(events, options);
  const components = detectSilentComponents(events, options);
  return {
    samples: events.length,
    minimum_samples: options.minimumSamples ?? DEFAULT_CONSTANT_FIELD_MINIMUM_SAMPLES,
    constant_fields: constantFields,
    observed_components: components.observed,
    silent_components: components.silent,
    unexpected_components: components.unexpected,
  };
}

export function formatInstrumentationHealth(health) {
  if (health.samples === 0) return 'Instrumentation health: no event samples, so it cannot tell whether a field is only a placeholder.';
  const lines = [];
  if (health.constant_fields.length > 0) {
    lines.push(`Instrumentation health: ${health.constant_fields.length} field(s) with zero variance (a placeholder, or the producer is broken)`);
    for (const item of health.constant_fields) {
      lines.push(`  ${item.anchor} is always ${JSON.stringify(item.value)} (${item.samples} sample(s))`);
    }
  }
  if (health.silent_components.length > 0) {
    lines.push(`Instrumentation health: ${health.silent_components.length} component(s) never emitted an event (the code path may never actually run)`);
    for (const component of health.silent_components) lines.push(`  ${component}`);
  }
  if (health.unexpected_components.length > 0) {
    lines.push(`Instrumentation health: ${health.unexpected_components.length} component(s) are not on the expected list; update EXPECTED_MEMORY_COMPONENTS`);
    for (const component of health.unexpected_components) lines.push(`  ${component}`);
  }
  return lines.length === 0
    ? `Instrumentation health: ${health.samples} sample(s), no zero-variance fields, every expected component emitted events.`
    : lines.join('\n');
}
