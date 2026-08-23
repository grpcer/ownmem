#!/usr/bin/env node

/**
 * Guards the instrumentation health checker itself: it must catch placeholder fields and components
 * that never ran, while leaving legitimately varying fields alone. This layer closes out the
 * 2026-08-01 investigation: four structurally distorted metrics survived 24 self-tests because nobody
 * ever tested whether the producer could emit a second value.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectInstrumentationHealth,
  detectConstantPayloadFields,
  detectSilentComponents,
  EXPECTED_MEMORY_COMPONENTS,
  EXPLAINED_CONSTANT_FIELDS,
  formatInstrumentationHealth,
} from '../lib/memory-instrumentation-health.mjs';

const PACKAGE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

let passed = 0;
function test(label, callback) {
  callback();
  passed += 1;
  process.stdout.write(`  PASS  ${label}\n`);
}

function event({ name = 'recall.completed', component = 'memory-recall-snapshot', payload }) {
  return { event: name, process: { component }, payload };
}

// Reproduce the real defect shape: cache_hit constantly false (a placeholder) while execution
// alternates hot and cold (a genuine measurement).
function recallEvents(count) {
  return Array.from({ length: count }, (_, index) => event({
    payload: {
      cache_hit: false,
      episode_id: null,
      execution: index % 4 === 0 ? 'cold' : 'hot',
      estimated_tokens: 300 + (index % 7),
      abstained: index % 3 === 0,
    },
  }));
}

try {
  process.stdout.write('Scenario 1: placeholder fields must be caught\n');

  test('a constant scalar field is flagged once there are enough samples', () => {
    const findings = detectConstantPayloadFields(recallEvents(40), { minimumSamples: 30 });
    const cacheHit = findings.find((item) => item.anchor === 'recall.completed.cache_hit');
    assert(cacheHit, `a constantly false cache_hit must be caught, actually caught ${JSON.stringify(findings.map((f) => f.anchor))}`);
    assert(cacheHit.value === false && cacheHit.samples === 40, 'it must report the constant value and the sample count, so a placeholder can be told from a broken producer');
  });

  test('a field that genuinely varies must not be flagged', () => {
    const findings = detectConstantPayloadFields(recallEvents(40), { minimumSamples: 30 }).map((item) => item.field);
    for (const field of ['execution', 'estimated_tokens', 'abstained']) {
      assert(!findings.includes(field), `${field} varies, so it must not be treated as a placeholder`);
    }
  });

  test('it stays silent below the sample floor instead of concluding from a handful of events', () => {
    assert(detectConstantPayloadFields(recallEvents(10), { minimumSamples: 30 }).length === 0, 'below the threshold it must report nothing');
  });

  test('the warning disappears on its own once a field starts varying, with no manual removal', () => {
    const events = recallEvents(40);
    events[0].payload.cache_hit = true;
    const findings = detectConstantPayloadFields(events, { minimumSamples: 30 }).map((item) => item.field);
    assert(!findings.includes('cache_hit'), 'once cache_hit takes a second value it must stop warning');
  });

  test('a legitimate constant can be ignored explicitly, but only by being listed in ignore', () => {
    const events = recallEvents(40);
    const withoutIgnore = detectConstantPayloadFields(events, { minimumSamples: 30 });
    const withIgnore = detectConstantPayloadFields(events, {
      minimumSamples: 30,
      ignore: ['recall.completed.cache_hit'],
    });
    assert(withoutIgnore.length - withIgnore.length === 1, 'ignore must take effect precisely, and must never be the default');
  });

  process.stdout.write('Scenario 2: code paths that never ran must be named\n');

  test('an expected component that never appears is listed as silent', () => {
    const result = detectSilentComponents([
      event({ component: 'memory-recall-snapshot', payload: { a: 1 } }),
      event({ component: 'memory-hook', payload: { a: 1 } }),
    ]);
    assert(
      result.silent.includes('memory-recall-fallback'),
      'a degradation path with zero events must be named: it is the last safety net, and never having run is the same as not existing',
    );
    assert(result.observed.includes('memory-hook'), 'components that did appear must be listed honestly');
  });

  test('a component outside the list prompts an update rather than passing silently', () => {
    const result = detectSilentComponents([event({ component: 'memory-brand-new', payload: { a: 1 } })]);
    assert(result.unexpected.includes('memory-brand-new'), 'an unregistered component must prompt adding it to EXPECTED_MEMORY_COMPONENTS');
  });

  test('the expected list itself must be neither empty nor duplicated', () => {
    assert(EXPECTED_MEMORY_COMPONENTS.length > 0, 'the list must not be empty');
    assert(new Set(EXPECTED_MEMORY_COMPONENTS).size === EXPECTED_MEMORY_COMPONENTS.length, 'the list must contain no duplicates');
  });

  process.stdout.write('Scenario 3: constants that are constant by contract are stated, not filed as defects\n');

  test('a declared constant leaves the findings list but is still reported, with its reason', () => {
    const events = recallEvents(40);
    const health = collectInstrumentationHealth(events, {
      minimumSamples: 30,
      explained: { 'recall.completed.cache_hit': 'production recall has no result cache' },
    });
    assert(
      !health.constant_fields.some((item) => item.anchor === 'recall.completed.cache_hit'),
      'a declared constant must not sit in the same list as a possibly broken producer',
    );
    const stated = health.explained_constant_fields.find((item) => item.anchor === 'recall.completed.cache_hit');
    assert(stated, 'a declared constant must still be reported, never silently dropped');
    assert(stated.reason && stated.value === false, 'the reason and the observed value must both survive into the report');
    assert(
      formatInstrumentationHealth(health).includes('constant by design'),
      'the printed report must show the declared constant in its own register',
    );
  });

  test('declaring a constant does not weaken the check on everything else', () => {
    const events = recallEvents(40);
    events.forEach((item) => { item.payload.episode_id = null; });
    const health = collectInstrumentationHealth(events, {
      minimumSamples: 30,
      explained: { 'recall.completed.cache_hit': 'production recall has no result cache' },
    });
    assert(
      health.constant_fields.some((item) => item.anchor === 'recall.completed.episode_id'),
      'an undeclared constant must still be caught while a declared one is excused',
    );
  });

  test('every declared constant carries a non-empty reason', () => {
    for (const [anchor, reason] of Object.entries(EXPLAINED_CONSTANT_FIELDS)) {
      assert(
        typeof reason === 'string' && reason.trim().length > 0,
        `${anchor} must state why a second value is impossible; an unexplained exemption is just a silenced check`,
      );
    }
  });

  test('every payload field the event schema pins to a const is declared', () => {
    // Drift guard: a new schema `const` would otherwise surface later as a phantom zero-variance
    // finding, and the fix for that finding would be to make a contractual constant vary.
    const schema = JSON.parse(readFileSync(
      path.join(PACKAGE_ROOT, 'schemas', 'observability', 'events.schema.json'),
      'utf8',
    ));
    // Only payload defs matter: the detector reads event.payload, so a const elsewhere in the
    // envelope (process.runtime, for one) can never surface as a zero-variance payload finding.
    const payloadDefs = new Set();
    const collectPayloadRefs = (node) => {
      if (Array.isArray(node)) { node.forEach(collectPayloadRefs); return; }
      if (!node || typeof node !== 'object') return;
      const ref = node.properties?.payload?.$ref;
      if (typeof ref === 'string') payloadDefs.add(ref.replace('#/$defs/', ''));
      Object.values(node).forEach(collectPayloadRefs);
    };
    collectPayloadRefs(schema);
    const pinned = [];
    for (const defName of payloadDefs) {
      for (const [field, spec] of Object.entries(schema.$defs?.[defName]?.properties || {})) {
        if (spec && typeof spec === 'object' && 'const' in spec) pinned.push({ defName, field });
      }
    }
    assert(payloadDefs.size > 0, 'no payload defs were resolved, so this guard would pass vacuously');
    for (const { defName, field } of pinned) {
      const declared = Object.keys(EXPLAINED_CONSTANT_FIELDS).some((anchor) => anchor.endsWith(`.${field}`));
      assert(declared, `${defName}.${field} is a schema const but is not in EXPLAINED_CONSTANT_FIELDS`);
    }
  });

  test('every expected component is actually emitted somewhere in the source', () => {
    // Drift guard: `memory-recall-runtime` sat on this list with no producer anywhere, so it was
    // reported as a never-run code path on every single run. A name with no emitter is a permanent
    // false alarm, which is how a real silent component gets lost in the noise.
    const sources = [];
    for (const directory of [path.join(PACKAGE_ROOT, 'lib'), path.join(PACKAGE_ROOT, 'lib', 'features'), path.join(PACKAGE_ROOT, 'bin'), path.join(PACKAGE_ROOT, 'test'), path.join(PACKAGE_ROOT, 'benchmarks')]) {
      let entries = [];
      try { entries = readdirSync(directory); } catch { continue; }
      for (const entry of entries) {
        if (!entry.endsWith('.mjs') || entry === 'memory-instrumentation-health.mjs'
          || entry === 'instrumentation-health-self-test.mjs') continue;
        try { sources.push(readFileSync(path.join(directory, entry), 'utf8')); } catch { /* unreadable file is not evidence */ }
      }
    }
    assert(sources.length > 0, 'the source scan found no files, so this guard would pass vacuously');
    for (const component of EXPECTED_MEMORY_COMPONENTS) {
      assert(
        sources.some((source) => source.includes(`'${component}'`)),
        `${component} is expected to emit events but no source file names it; remove it or wire up its producer`,
      );
    }
  });

  process.stdout.write('Scenario 4: with no samples it says so honestly instead of concluding\n');

  test('zero events must not be reported as all clear', () => {
    const health = collectInstrumentationHealth([]);
    assert(health.samples === 0 && health.constant_fields.length === 0, 'zero samples must produce no field conclusion');
    assert(
      formatInstrumentationHealth(health).includes('no event samples'),
      'zero samples must say plainly that it cannot be measured, rather than rendering as a clean bill of health',
    );
  });

  process.stdout.write(`\n==== instrumentation health self-test: ${passed} passed / 0 failed ====\n`);
} catch (error) {
  process.stderr.write(`\n==== instrumentation health self-test FAILED: ${error.message} ====\n`);
  process.exitCode = 1;
}
