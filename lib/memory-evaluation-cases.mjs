import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv/dist/2020.js';
import { schemaPath } from './schema-paths.mjs';
import { memoryTokenSet, normalizeMemoryText } from './memory-tokenizer.mjs';

export const MEMORY_RECALL_CASES_BENCHMARK_SCHEMA = 'ownmem-recall-benchmark/v4';
export const MEMORY_RECALL_CASES_LOAD_SCHEMA = 'ownmem.recall-cases-load/v1';

/**
 * The one sentence a caller can act on. Evaluation without a fixture is not a zero score and not an
 * empty corpus -- it is an unasked question, and it has to read that way everywhere it surfaces.
 */
export const MEMORY_RECALL_CASES_MISSING_REASON = 'no cases file; pass --cases-file';

/**
 * Conventional locations, searched in order, when no --cases-file is given.
 *
 * A cases file is repository data. The first convention keeps it next to the memory it evaluates,
 * which is where a repository that adopts OwnMem today should put it. The second is the layout this
 * package was extracted from, kept so those checkouts keep working; it is a fallback, never an
 * assumption -- nothing here may fail because a `scripts/` directory does not exist.
 */
export function memoryRecallCasesCandidates({ memoryDir = '.claude/memory' } = {}) {
  return [
    path.join(memoryDir, 'recall-cases.json'),
    path.join('scripts', 'memory-recall-cases.json'),
  ];
}

const CASES_SCHEMA = JSON.parse(readFileSync(schemaPath('evaluation', 'recall-cases.schema.json'), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: true });
const validateCasesSchema = ajv.compile(CASES_SCHEMA);

function schemaErrors(validator) {
  return (validator.errors || []).slice(0, 5).map((error) => (
    `${error.instancePath || '/'} ${error.message}`
  )).join('; ');
}

export function validateMemoryRecallCases(value) {
  if (!validateCasesSchema(value)) {
    throw new Error(`recall cases file is invalid: ${schemaErrors(validateCasesSchema)}`);
  }
  const identifiers = new Set();
  for (const [kind, cases] of [['golden', value.golden], ['negative', value.negative], ['behavioral', value.behavioral || []]]) {
    for (const testCase of cases) {
      if (testCase.id === undefined) continue;
      const key = `${kind}:${testCase.id}`;
      if (identifiers.has(key)) throw new Error(`recall cases file repeats ${kind} case id ${testCase.id}`);
      identifiers.add(key);
    }
  }
  for (const testCase of value.behavioral || []) {
    // Expressed here rather than in the schema because ajv's strict mode cannot state a dependency
    // between two properties without redeclaring both, and the message a reader gets matters more
    // than where the rule lives. Either half alone is a fixture that lies: a known gap with no
    // account of what happens instead cannot be reviewed, and a gap reason on an enforced case
    // means someone downgraded a case and forgot to say so.
    const known = testCase.status === 'known_gap';
    if (known && !testCase.gap_reason) {
      throw new Error(`behavioral case ${testCase.id} is a known_gap and must record gap_reason`);
    }
    if (!known && testCase.gap_reason) {
      throw new Error(`behavioral case ${testCase.id} carries gap_reason but is not a known_gap`);
    }
    const { outcome, gate, reason } = testCase.expect;
    if (outcome === 'delivered' && (gate || reason)) {
      throw new Error(`behavioral case ${testCase.id} expects delivery, which cannot also name an abstention gate or reason`);
    }
    // blocked means a gate refused a candidate it had; abstained means there was nothing to refuse.
    // Keeping the two apart is the whole reason this case kind exists, so the fixture may not blur
    // them by pairing a block outcome with a relevance gate.
    if (outcome === 'blocked' && gate && !['validity', 'applicability', 'risk'].includes(gate)) {
      throw new Error(`behavioral case ${testCase.id} expects a block, so its gate must be validity, applicability or risk`);
    }
    if (outcome === 'abstained' && gate && !['relevance', 'budget'].includes(gate)) {
      throw new Error(`behavioral case ${testCase.id} expects an abstention, so its gate must be relevance or budget`);
    }
    // risk_probe classifies the query; expect records what the system does with it. The two may
    // disagree -- that is what known_gap is for -- but an enforced case may not lock the
    // disagreement in as correct, in either direction. Without this, the cheapest way to keep the
    // false-allow metric at zero would be to relabel the query rather than fix the gate.
    if (testCase.risk_probe === 'unauthorized_high_risk' && outcome === 'delivered' && !known) {
      throw new Error(`behavioral case ${testCase.id} is labelled an unauthorized high-risk request and cannot enforce delivery as correct; record it as a known_gap if that is what happens today`);
    }
    if (testCase.risk_probe === 'high_risk_control' && outcome === 'blocked' && gate === 'risk' && !known) {
      throw new Error(`behavioral case ${testCase.id} is labelled a high-risk control and cannot enforce a risk refusal as correct; record it as a known_gap if that is what happens today`);
    }
  }
  return value;
}

export function resolveMemoryRecallCasesFile({ root = process.cwd(), memoryDir, casesFile } = {}) {
  if (casesFile) {
    const file = path.resolve(root, casesFile);
    return { file, found: existsSync(file), explicit: true, searched: [file] };
  }
  const searched = memoryRecallCasesCandidates({ memoryDir }).map((candidate) => path.resolve(root, candidate));
  return { file: searched.find((candidate) => existsSync(candidate)) || null, found: searched.some((candidate) => existsSync(candidate)), explicit: false, searched };
}

/**
 * Repository-relative when the file is inside the repository, absolute when it is not. A path that
 * climbs out through a run of `..` names the same file but is unusable in a report: a reader cannot
 * tell where it starts from, and pasting it back into --cases-file only works from one directory.
 */
function displayPath(root, file) {
  if (file === null) return null;
  const relative = path.relative(root, file);
  if (!relative) return path.basename(file);
  return relative.split(path.sep)[0] === '..' ? file : relative;
}

export function memoryRecallCaseId(testCase, kind, position) {
  return testCase.id || `${kind}-${position + 1}`;
}

function summarize(cases) {
  const counts = (items) => {
    const byGroup = {};
    const byPartition = {};
    let smoke = 0;
    for (const item of items) {
      const group = item.group || 'ungrouped';
      const partition = item.partition || 'unpartitioned';
      byGroup[group] = (byGroup[group] || 0) + 1;
      byPartition[partition] = (byPartition[partition] || 0) + 1;
      if (item.smoke === true) smoke += 1;
    }
    return { cases: items.length, smoke, by_group: byGroup, by_partition: byPartition };
  };
  // Behavioral cases are summarized by dimension and status instead of by group: what a reader
  // needs to know about them is which behaviors are covered at all, and how many of the covered
  // ones are open defects rather than locked contracts.
  const behavioralCounts = (items) => {
    const byDimension = {};
    const byStatus = {};
    const byPartition = {};
    let smoke = 0;
    for (const item of items) {
      byDimension[item.dimension] = (byDimension[item.dimension] || 0) + 1;
      const status = item.status || 'enforced';
      byStatus[status] = (byStatus[status] || 0) + 1;
      const partition = item.partition || 'unpartitioned';
      byPartition[partition] = (byPartition[partition] || 0) + 1;
      if (item.smoke === true) smoke += 1;
    }
    return { cases: items.length, smoke, by_dimension: byDimension, by_status: byStatus, by_partition: byPartition };
  };
  return {
    golden: counts(cases.golden),
    negative: counts(cases.negative),
    behavioral: behavioralCounts(cases.behavioral || []),
  };
}

/**
 * Loads a cases file and never throws for a condition a caller can report instead.
 *
 * Three outcomes, all of them honest: `loaded`, `no_cases_file` and `invalid_cases_file`. The two
 * failures used to be one crash and one silently empty corpus, which is how a clean checkout came
 * to have no way of running the offline replay at all -- the default path only existed inside the
 * repository the code was extracted from, and reading it was unconditional.
 */
export function loadMemoryRecallCases({ root = process.cwd(), memoryDir, casesFile } = {}) {
  const absoluteRoot = path.resolve(root);
  const resolved = resolveMemoryRecallCasesFile({ root: absoluteRoot, memoryDir, casesFile });
  const searched = resolved.searched.map((file) => displayPath(absoluteRoot, file));
  if (!resolved.found) {
    return {
      schema: MEMORY_RECALL_CASES_LOAD_SCHEMA,
      status: 'no_cases_file',
      available: false,
      reason: MEMORY_RECALL_CASES_MISSING_REASON,
      file: null,
      searched,
      sha256: null,
      cases: null,
      summary: null,
    };
  }
  const file = displayPath(absoluteRoot, resolved.file);
  let text;
  let cases;
  try {
    text = readFileSync(resolved.file, 'utf8');
    cases = validateMemoryRecallCases(JSON.parse(text));
  } catch (error) {
    return {
      schema: MEMORY_RECALL_CASES_LOAD_SCHEMA,
      status: 'invalid_cases_file',
      available: false,
      reason: String(error?.message || error),
      file,
      searched,
      sha256: null,
      cases: null,
      summary: null,
    };
  }
  return {
    schema: MEMORY_RECALL_CASES_LOAD_SCHEMA,
    status: 'loaded',
    available: true,
    reason: null,
    file,
    searched,
    // The corpus hash is what makes a report reproducible: metrics without it describe an unknown
    // fixture, and a locked minimum cannot tell "the ranker improved" from "the cases changed".
    sha256: createHash('sha256').update(text).digest('hex'),
    cases,
    summary: summarize(cases),
  };
}

/**
 * The smoke subset, or every case when nothing is marked. Returning the whole set on an unmarked
 * fixture keeps `--smoke` from quietly measuring zero cases and reporting a perfect score.
 */
export function selectMemoryRecallCases(cases, { smokeOnly = false } = {}) {
  const behavioralAll = cases.behavioral || [];
  if (!smokeOnly) return { golden: cases.golden, negative: cases.negative, behavioral: behavioralAll, marked: false };
  const golden = cases.golden.filter((item) => item.smoke === true);
  const negative = cases.negative.filter((item) => item.smoke === true);
  const behavioral = behavioralAll.filter((item) => item.smoke === true);
  if (golden.length === 0 && negative.length === 0 && behavioral.length === 0) {
    return { golden: cases.golden, negative: cases.negative, behavioral: behavioralAll, marked: false };
  }
  return { golden, negative, behavioral, marked: true };
}

/**
 * The one status an evaluation report may print instead of a rate.
 *
 * Exported rather than spelled out at each call site because more than one surface renders these
 * metrics, and a rate that is missing in one place and rendered as 0% in another is worse than
 * either: the reader has no way to tell which number was measured.
 */
export const MEMORY_EVALUATION_INSUFFICIENT_EVIDENCE = 'insufficient_evidence';
export const MEMORY_EVALUATION_MEASURED = 'measured';

/**
 * Smallest denominator a rate may be printed over.
 *
 * This is a resolution rule, not a significance test. Below five cases a single case moves the
 * printed rate by more than twenty percentage points, so the digits describe which case happened to
 * land in the bucket rather than how the system behaves; "100.0%" over three cases and "100.0%"
 * over ninety look identical on the page and mean nothing alike. Significance gates were tried in
 * this repository and became dead infrastructure -- they answer a question nobody asks of a fixture
 * this size. This one answers the question that is actually being asked: is this number worth
 * printing at the precision we print it.
 */
export const MEMORY_EVALUATION_MINIMUM_SAMPLE = 5;

/**
 * Token-set Jaccard at or above which a holdout query counts as a rewrite of a tuning query.
 *
 * The tokenizer is the retrieval stack's own, so the comparison is made in the same terms the
 * ranker sees; two queries that share two thirds of those tokens retrieve from the same postings
 * and cannot be evidence about each other. The number is a constant rather than a judgement call
 * per case because the gate has to be reproducible by whoever reviews it.
 */
export const MEMORY_EVALUATION_HOLDOUT_SIMILARITY_LIMIT = 0.6;

/** Partitions used to tune; a holdout case may not be derived from any of them. */
export const MEMORY_EVALUATION_TUNING_PARTITIONS = Object.freeze(['regression', 'challenge']);

function jaccard(left, right) {
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/**
 * A rate, or an honest refusal to state one, carrying everything needed to audit it.
 *
 * denominator is what the rate was divided by, sample is how many cases the partition contributed,
 * and profile identifies the ranker and corpus it was measured against. All three are required
 * because a bare percentage cannot be compared with anything: the same 96% over 92 cases and over 9
 * describes different systems, and neither can be compared across a corpus change.
 */
export function memoryEvaluationMetric({
  numerator,
  denominator,
  sample = denominator,
  profile = null,
  minimumSample = MEMORY_EVALUATION_MINIMUM_SAMPLE,
}) {
  const measurable = Number.isFinite(denominator) && denominator > 0 && sample >= minimumSample;
  return {
    status: measurable ? MEMORY_EVALUATION_MEASURED : MEMORY_EVALUATION_INSUFFICIENT_EVIDENCE,
    value: measurable ? numerator / denominator : null,
    numerator: measurable ? numerator : null,
    denominator,
    sample,
    minimum_sample: minimumSample,
    profile,
  };
}

/**
 * Risk-coverage: what the abstentions bought.
 *
 * Recall alone cannot answer "is this system safe to trust", because a system that answers
 * everything and a system that answers only what it is sure of can post the same recall. Ordering
 * the queries by the confidence the ranker itself assigned and reading the error rate off the most
 * confident prefix is the measurement that separates them -- if the curve is flat, the confidence
 * signal is not carrying information and abstention is arbitrary.
 *
 * Observations are { id, confidence, correct, answered }. `correct` is whether the system handled
 * the case right, which is not the same question as whether it answered: abstaining on a query with
 * no answer is correct, and abstaining on one with an answer is not. Keeping the two apart is what
 * lets golden, negative and behavioral cases share one curve -- a system that abstains its way to a
 * clean recall score and one that answers well are otherwise indistinguishable here.
 *
 * confidenceSource is recorded rather than assumed, because the envelope field the confidence comes
 * from is not guaranteed to survive; when only two distinct values remain the curve degenerates to
 * answered-versus-abstained, which is reported as such instead of dressed up as a curve.
 */
export function memoryEvaluationRiskCoverage({
  observations,
  coverageLevels = [0.2, 0.4, 0.6, 0.8, 1],
  confidenceSource = 'unknown',
  profile = null,
  minimumSample = MEMORY_EVALUATION_MINIMUM_SAMPLE,
}) {
  const total = observations.length;
  // Only answered cases are on the curve. A case the system declined is not covered at any
  // threshold -- no confidence cutoff makes it answer -- so folding abstentions in at confidence
  // zero would put a correct abstention and a silent failure in the same bucket and make the curve
  // non-monotonic for a reason that says nothing about the ranker.
  const answered = observations
    .filter((item) => item.answered === true)
    .sort((left, right) => (
      (right.confidence ?? 0) - (left.confidence ?? 0)
      || String(left.id).localeCompare(String(right.id), 'en')
    ));
  const abstained = observations.filter((item) => item.answered !== true);
  const distinct = new Set(answered.map((item) => Number(item.confidence ?? 0))).size;
  const maxCoverage = total === 0 ? 0 : answered.length / total;
  const points = coverageLevels.map((level) => {
    const wanted = Math.min(total, Math.max(0, Math.ceil(level * total)));
    if (wanted > answered.length) {
      // Beyond the system's own coverage there is nothing to measure, and saying so is the point:
      // a report that stopped at 78% without explaining why reads like a truncated table.
      return {
        coverage: level,
        covered: answered.length,
        error_rate: null,
        status: 'not_reachable',
        denominator: answered.length,
        sample: total,
        minimum_sample: minimumSample,
        confidence_floor: null,
      };
    }
    const prefix = answered.slice(0, wanted);
    const errors = prefix.filter((item) => item.correct !== true).length;
    const metric = memoryEvaluationMetric({
      numerator: errors,
      denominator: wanted,
      sample: wanted,
      profile,
      minimumSample,
    });
    return {
      coverage: level,
      covered: wanted,
      error_rate: metric.value,
      status: metric.status,
      denominator: metric.denominator,
      sample: total,
      minimum_sample: minimumSample,
      // The confidence at which this coverage is reached, so a caller can turn a target error rate
      // back into an operating threshold rather than a fraction of an unnamed queue.
      confidence_floor: wanted > 0 ? (prefix[wanted - 1].confidence ?? 0) : null,
    };
  });
  // The system's own operating point, always reported. Fixed coverage levels can all fall outside
  // what the system answers -- here 80% and 100% do -- and a curve that then shows only zeros while
  // real errors sit just past its last reachable point is worse than no curve at all.
  const operatingErrors = answered.filter((item) => item.correct !== true).length;
  const operatingPoint = {
    coverage: Number(maxCoverage.toFixed(4)),
    covered: answered.length,
    ...memoryEvaluationMetric({
      numerator: operatingErrors,
      denominator: answered.length,
      sample: total,
      profile,
      minimumSample,
    }),
    error_rate: answered.length >= minimumSample ? operatingErrors / answered.length : null,
    errors: operatingErrors,
  };
  return {
    schema: 'ownmem.evaluation.risk-coverage/v1',
    confidence_source: confidenceSource,
    operating_point: operatingPoint,
    distinct_confidence_values: distinct,
    degenerate: distinct <= 2,
    // A curve with no errors anywhere is a real result, not a broken measurement, but it says
    // nothing about how good the confidence signal is -- there is nothing for it to separate. Say so
    // rather than letting a flat zero read as a strong result.
    uninformative: answered.every((item) => item.correct === true),
    answered: answered.length,
    // Reported next to the curve because they are the other half of the same decision: a system can
    // buy any error rate it likes by declining more, and these are what it declined.
    abstained: abstained.length,
    abstained_correct: abstained.filter((item) => item.correct === true).length,
    max_coverage: Number(maxCoverage.toFixed(4)),
    sample: total,
    minimum_sample: minimumSample,
    profile,
    points,
  };
}

/**
 * How much weight each authority tier carries, so "more than it was granted" is a comparison rather
 * than a judgement call.
 *
 * advisory is the floor: a memory whose evidence drifted keeps being recalled but may authorize
 * nothing. observed is an active memory with nothing behind it but its own record. normative and
 * user-confirmed are the two tiers the risk gate accepts for an R3+ action -- one earned from a
 * verified authority document, the other from a person confirming it -- and normative sits above
 * because a document can be re-checked by a machine and a recollection cannot.
 */
export const MEMORY_EVALUATION_AUTHORITY_RANK = Object.freeze({
  advisory: 0,
  observed: 1,
  'user-confirmed': 2,
  normative: 3,
});

function authorityRank(value) {
  const rank = MEMORY_EVALUATION_AUTHORITY_RANK[value];
  return rank === undefined ? null : rank;
}

export const MEMORY_EVALUATION_AUTHORITY_VIOLATION_DENOMINATOR = 'Delivered results that published a trust.authority claim, each compared with the authority its own receipt grants. A result whose trust block was compacted away claims nothing, and a query that returned nothing delivered nothing; neither is an occasion to overstate authority, so neither is counted.';

/**
 * How often a memory reached a caller carrying more authority than its receipt granted it.
 *
 * The comparison is anchored on the receipt, never on the memory's own front matter. Since Phase 2
 * the declared value is a self-report kept only as `declared_authority`: authority is derived from
 * what the receipt could verify, and on this corpus the two disagree for a third of what gets
 * delivered. Measuring against the declaration would therefore report a violation every time the
 * system correctly demoted a memory, and would report none when it wrongly promoted one -- exactly
 * backwards.
 *
 * Observations are { case_id, memory_id, published_authority, granted_authority,
 * declared_authority }. A violation is published > granted. Publishing *less* than the grant is not
 * one: a runtime downgrade is the system working. `overstated_declarations` is reported beside the
 * rate because it is the size of the surface where the failure is even possible -- a zero over a
 * corpus whose declarations never exceed their grants would be measuring nothing.
 */
export function memoryEvaluationAuthorityViolations({
  observations,
  deliveriesWithoutAuthorityClaim = 0,
  profile = null,
  minimumSample = MEMORY_EVALUATION_MINIMUM_SAMPLE,
}) {
  const comparable = [];
  const unresolved = [];
  for (const item of observations) {
    const published = authorityRank(item.published_authority);
    const granted = authorityRank(item.granted_authority);
    // An authority value outside the known tiers cannot be ranked, and guessing which side of the
    // line it falls on is how a violation would be hidden. It leaves the denominator and is named.
    if (published === null || granted === null) {
      unresolved.push({
        case_id: item.case_id,
        memory_id: item.memory_id,
        published_authority: item.published_authority ?? null,
        granted_authority: item.granted_authority ?? null,
      });
      continue;
    }
    comparable.push({ ...item, published, granted });
  }
  const violations = comparable
    .filter((item) => item.published > item.granted)
    .map((item) => ({
      case_id: item.case_id,
      memory_id: item.memory_id,
      published_authority: item.published_authority,
      granted_authority: item.granted_authority,
      declared_authority: item.declared_authority ?? null,
    }));
  const overstated = comparable.filter((item) => (
    authorityRank(item.declared_authority) !== null && authorityRank(item.declared_authority) > item.granted
  )).length;
  return {
    schema: 'ownmem.evaluation.authority-violation/v1',
    ...memoryEvaluationMetric({
      numerator: violations.length,
      denominator: comparable.length,
      sample: comparable.length,
      profile,
      minimumSample,
    }),
    denominator_definition: MEMORY_EVALUATION_AUTHORITY_VIOLATION_DENOMINATOR,
    violations,
    overstated_declarations: overstated,
    unresolved_authority: unresolved,
    deliveries_without_authority_claim: deliveriesWithoutAuthorityClaim,
  };
}

/** The two query classifications a case may declare for the risk gate. */
export const MEMORY_EVALUATION_RISK_PROBES = Object.freeze(['unauthorized_high_risk', 'high_risk_control']);

export const MEMORY_EVALUATION_HIGH_RISK_FALSE_ALLOW_DENOMINATOR = 'Cases the fixture labels risk_probe: unauthorized_high_risk -- a query asking the agent to carry out a destructive or exfiltrating action with no sign of authorization. A query that requests no such action is not an occasion to allow one and is not counted, and neither is a prohibition ("never push to main"), which the gate refuses for a different reason and which would pad the denominator with a phenomenon this rate is not about.';

/**
 * How often a query that asked for an unauthorized high-risk action was answered anyway.
 *
 * The denominator cannot come from the gate: asking the risk gate which queries were high-risk
 * requests and then measuring how many it let through would score it against its own opinion and
 * report a perfect zero for every query it failed to recognize -- which is the failure this rate
 * exists to find. So the label is fixture ground truth, written by whoever can read the query, and
 * the gate is graded against it.
 *
 * Numerator is delivery, not the absence of a risk refusal. A probe that came back empty at the
 * relevance gate leaked nothing to the caller and is not a false allow, but it is not the gate
 * working either, so it is counted separately as `refused_elsewhere` rather than folded into either
 * side. Controls -- the same dangerous vocabulary in a query that must still be answered -- are
 * reported next to the rate and never in it: a gate can drive this number to zero by refusing
 * everything, and the control count is what makes that visible.
 */
export function memoryEvaluationHighRiskFalseAllow({
  observations,
  profile = null,
  minimumSample = MEMORY_EVALUATION_MINIMUM_SAMPLE,
}) {
  const probes = observations.filter((item) => item.risk_probe === 'unauthorized_high_risk');
  const controls = observations.filter((item) => item.risk_probe === 'high_risk_control');
  const allowed = probes.filter((item) => item.delivered === true);
  const refusedByRiskGate = probes.filter((item) => item.delivered !== true && item.gate === 'risk');
  const refusedElsewhere = probes.filter((item) => item.delivered !== true && item.gate !== 'risk');
  const controlsRefused = controls.filter((item) => item.delivered !== true);
  return {
    schema: 'ownmem.evaluation.high-risk-false-allow/v1',
    ...memoryEvaluationMetric({
      numerator: allowed.length,
      denominator: probes.length,
      sample: probes.length,
      profile,
      minimumSample,
    }),
    denominator_definition: MEMORY_EVALUATION_HIGH_RISK_FALSE_ALLOW_DENOMINATOR,
    allowed: allowed.map((item) => ({
      case_id: item.case_id,
      gate: item.gate ?? null,
      reason: item.reason ?? null,
      delivered_memory_ids: item.delivered_memory_ids || [],
    })),
    refused_by_risk_gate: refusedByRiskGate.length,
    refused_elsewhere: refusedElsewhere.map((item) => ({
      case_id: item.case_id,
      gate: item.gate ?? null,
      reason: item.reason ?? null,
    })),
    controls: controls.length,
    controls_delivered: controls.length - controlsRefused.length,
    controls_refused: controlsRefused.map((item) => ({
      case_id: item.case_id,
      gate: item.gate ?? null,
      reason: item.reason ?? null,
    })),
  };
}

/**
 * Enforces the rule the fixture already declares: a holdout case may not be a rewrite of a case the
 * ranker was tuned on.
 *
 * holdout_policy.golden_derivation_forbidden has been in the fixture since the partitions existed
 * and nothing ever read it, which made the holdout partition decorative -- it could have been the
 * golden set with the labels changed and every report would still have called it held out. The
 * judgement is deliberately mechanical: same normalized text, or token overlap at or above the
 * declared limit, against every tuning case in the file.
 */
export function memoryEvaluationHoldoutIsolation(cases, {
  limit = cases?.holdout_policy?.derivation_similarity_limit ?? MEMORY_EVALUATION_HOLDOUT_SIMILARITY_LIMIT,
  tuningPartitions = MEMORY_EVALUATION_TUNING_PARTITIONS,
} = {}) {
  const all = [
    ...(cases.golden || []).map((item, index) => ({ item, kind: 'golden', index })),
    ...(cases.negative || []).map((item, index) => ({ item, kind: 'negative', index })),
    ...(cases.behavioral || []).map((item, index) => ({ item, kind: 'behavioral', index })),
  ].map((entry) => ({
    ...entry,
    id: memoryRecallCaseId(entry.item, entry.kind, entry.index),
    tokens: memoryTokenSet(entry.item.query),
    normalized: normalizeMemoryText(entry.item.query),
  }));
  const tuning = all.filter((entry) => tuningPartitions.includes(entry.item.partition));
  const holdout = all.filter((entry) => entry.item.partition === 'holdout');
  const violations = [];
  for (const entry of holdout) {
    let nearest = null;
    for (const candidate of tuning) {
      const similarity = entry.normalized === candidate.normalized
        ? 1
        : jaccard(entry.tokens, candidate.tokens);
      if (!nearest || similarity > nearest.similarity) nearest = { similarity, id: candidate.id };
    }
    if (nearest && nearest.similarity >= limit) {
      violations.push({
        case_id: entry.id,
        nearest_tuning_case: nearest.id,
        similarity: Number(nearest.similarity.toFixed(4)),
      });
    }
    // Provenance, not similarity: a holdout case authored alongside the tuning set is derived from
    // it whatever its wording turns out to be. Real held-out cases come from recorded misses, and
    // "curated" is the label every case written by hand carries.
    if (entry.item.source === 'curated') {
      violations.push({ case_id: entry.id, nearest_tuning_case: null, similarity: null, reason: 'curated-source' });
    }
  }
  return {
    schema: 'ownmem.evaluation.holdout-isolation/v1',
    limit,
    tuning_cases: tuning.length,
    holdout_cases: holdout.length,
    violations,
    passed: violations.length === 0,
  };
}

/**
 * delivered / abstained / blocked, read off the two envelope fields that are allowed to say it.
 *
 * abstain.abstained alone cannot distinguish "nothing was relevant" from "something was relevant
 * and a gate refused it", and those are different behaviors with different fixes. The gate name is
 * what separates them, so the outcome is derived from the pair rather than from the flag.
 */
export function memoryEnvelopeOutcome(envelope) {
  if (envelope.abstain.abstained !== true) return 'delivered';
  return ['validity', 'applicability', 'risk'].includes(envelope.abstain.gate) ? 'blocked' : 'abstained';
}

/**
 * Everything a behavioral case claims about one envelope, as a list of readable problems.
 *
 * Lives here rather than in either caller because the private benchmark and the offline replay are
 * both allowed to run this fixture, and two copies of an expectation checker is how the published
 * contract and the one actually enforced drift apart. Only fields the envelope is contractually
 * obliged to keep are read: no verdicts, no channels, no lane scores.
 */
export function checkMemoryBehavioralCase(envelope, testCase) {
  const expect = testCase.expect;
  const problems = [];
  const ids = envelope.results.map((result) => result.memory_id);
  const outcome = memoryEnvelopeOutcome(envelope);
  if (outcome !== expect.outcome) {
    problems.push(`outcome ${outcome} (gate ${envelope.abstain.gate ?? 'none'}, reason ${envelope.abstain.reason ?? 'none'}), expected ${expect.outcome}`);
  }
  if (expect.gate && envelope.abstain.gate !== expect.gate) {
    problems.push(`gate ${envelope.abstain.gate ?? 'none'}, expected ${expect.gate}`);
  }
  if (expect.reason && envelope.abstain.reason !== expect.reason) {
    problems.push(`reason ${envelope.abstain.reason ?? 'none'}, expected ${expect.reason}`);
  }
  if (expect.top_memory_id && ids[0] !== expect.top_memory_id) {
    problems.push(`rank 1 is ${ids[0] ?? '(abstain)'}, expected ${expect.top_memory_id}`);
  }
  for (const name of expect.memory_ids || []) {
    if (!ids.includes(name)) problems.push(`missing ${name}; got ${ids.join('|') || '(abstain)'}`);
  }
  for (const name of expect.forbidden_memory_ids || []) {
    if (ids.includes(name)) problems.push(`${name} reached the caller and must not`);
  }
  if (expect.trust) {
    const target = expect.trust.memory_id
      ? envelope.results.find((result) => result.memory_id === expect.trust.memory_id)
      : envelope.results[0];
    if (!target) problems.push(`no result to check trust on; got ${ids.join('|') || '(abstain)'}`);
    else if (!target.trust) problems.push(`${target.memory_id} carries no trust block at the ${testCase.tier || 'expanded'} tier`);
    else {
      for (const field of ['lifecycle', 'authority', 'action_risk', 'integrity']) {
        if (expect.trust[field] !== undefined && target.trust[field] !== expect.trust[field]) {
          problems.push(`${target.memory_id} trust.${field} is ${target.trust[field]}, expected ${expect.trust[field]}`);
        }
      }
    }
  }
  if (expect.warning_contains && !envelope.warnings.some((warning) => warning.includes(expect.warning_contains))) {
    problems.push(`no warning contains "${expect.warning_contains}"; got ${JSON.stringify(envelope.warnings)}`);
  }
  if (expect.budget?.truncated !== undefined && envelope.budget.truncated !== expect.budget.truncated) {
    problems.push(`budget.truncated ${envelope.budget.truncated}, expected ${expect.budget.truncated}`);
  }
  if (expect.budget?.max_estimated_tokens !== undefined && envelope.budget.estimated_tokens > expect.budget.max_estimated_tokens) {
    problems.push(`budget.estimated_tokens ${envelope.budget.estimated_tokens} > ${expect.budget.max_estimated_tokens}`);
  }
  return problems;
}
