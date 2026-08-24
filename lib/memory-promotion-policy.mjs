// Promotion policy: how far a proposed change may travel without a person.
//
// Two independent questions live here, and holding them apart is the whole point of the file.
//
//   1. The risk matrix answers "what is the worst this could do if it turns out to be wrong". That
//      is a property of the change, not of how often it has worked, so it is decided by a table
//      that no caller may widen at call time. A perfect evidence set and a perfect observation
//      record do not move an R4 change one step: the ceiling is about blast radius.
//   2. The weak gate answers "have we in fact watched this hold". That is a property of the
//      observations, so it is decided by counting -- and on this repository, today, it counts to a
//      single-digit number of independent episodes and returns insufficient_evidence. That refusal
//      is the correct output, not a gap waiting to be filled.
//
// Nothing here touches the filesystem. A decision is a value, and the reason it landed where it did
// travels with it in plain English, so that "why was this not automatic" never requires reading
// this module.

import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import {
  MEMORY_ACTION_RISKS,
  MEMORY_LIFECYCLE_STATES,
  MEMORY_LOGICAL_TYPES,
  assertMemoryLifecycleTransition,
} from './memory-lifecycle.mjs';
import { schemaPath } from './schema-paths.mjs';

export const PROMOTION_DECISION_SCHEMA = 'ownmem-promotion-decision/v1';

/**
 * The identity a receipt records when it says which policy graded it.
 *
 * It lives beside the matrix rather than in the receipt module because it names *this* file: the
 * version has to move when the matrix or the gate moves, and an identity kept somewhere else is an
 * identity that stops matching the thing it identifies. A receipt issued under an older matrix then
 * stays readable as such instead of being silently reinterpreted under the current one.
 */
export const PROMOTION_POLICY_ID = 'promotion-risk-matrix-v1';
export const PROMOTION_POLICY_VERSION = '1.0.0';

/**
 * This module never states how likely a promotion is to be correct, and this constant exists so a
 * caller can assert that rather than take a comment's word for it.
 *
 * The lower bound below is a bound, and a bound computed from a handful of episodes recorded by one
 * person on one machine says only "we have not watched this fail, and it is probably not terrible".
 * Presenting it as anything stronger is the failure mode this whole design was written against, so
 * the flag is exported, pinned false, and asserted by the self-test.
 */
export const PROMOTION_STATISTICS_CLAIMS_RELIABILITY = false;

/** What a decision permits. Ordered from most to least autonomy. */
export const PROMOTION_AUTOMATION_LEVELS = Object.freeze(['auto', 'review', 'pr-only', 'forbidden']);

/**
 * The lifecycle states a promotion can aim at, in order.
 *
 * `stale`, `deprecated`, `rejected` and `superseded` are deliberately absent: they are demotions
 * and retirements, and this policy grades promotions. Aiming at one is answered with `review`
 * rather than silently graded on the promotion ladder, where "further along" would mean the
 * opposite of what the caller asked for.
 */
const PROMOTION_LADDER = Object.freeze(['observed', 'candidate', 'shadow', 'advisory', 'active']);

/**
 * The machine-verifiable checks a tier may require.
 *
 * Closed on purpose: a caller passing `machine_reciept_complete` would otherwise read as false and
 * quietly block a promotion that had every right to happen, and a caller passing a check this
 * policy has never heard of would think it was being counted. Both are refused loudly.
 */
export const PROMOTION_EVIDENCE_CHECKS = Object.freeze([
  // The recall regression suite ran green against the change. Gates R0's step from shadow to a
  // materialized, non-authoritative metadata edit.
  'regression_gate_passed',
  // A content-bound trust receipt covering every anchor the memory claims. Gates all of R1.
  'machine_receipt_complete',
  // The procedure replayed in an isolated sandbox, not in a production or release environment.
  'sandbox_replay_passed',
  // The procedure declares how to undo itself.
  'rollback_defined',
  // The procedure declares where it applies, so "it worked" cannot be read as "it works anywhere".
  'scope_declared',
]);

/**
 * The risk matrix, one row per risk level, transcribed from the plan and not widened anywhere else.
 *
 * `tiers` is ascending and each entry states what it costs to reach that lifecycle automatically.
 * A tier with `repo_policy_grant: true` is off until the repository authorizes it by name; a tier
 * without one is granted by the matrix itself and is therefore the floor, not a setting. The two
 * rows with no tiers at all are the point of the table: no evidence set and no repository
 * configuration can produce automation for them.
 *
 * `without_automation` is what a request falls to when it does not qualify -- a person may still
 * approve it for the first four rows, and may not for the last two.
 */
export const PROMOTION_RISK_MATRIX = Object.freeze({
  // Trigger suggestions, duplicate hints, review reminders. Wrong metadata costs a reader some
  // attention; it cannot authorize anything or change what a memory asserts.
  R0: Object.freeze({
    label: 'metadata',
    without_automation: 'review',
    requires_statistics: false,
    tiers: Object.freeze([
      Object.freeze({ lifecycle: 'shadow', evidence: Object.freeze([]), repo_policy_grant: false }),
      Object.freeze({ lifecycle: 'advisory', evidence: Object.freeze(['regression_gate_passed']), repo_policy_grant: false }),
    ]),
  }),
  // Paths, scripts, stable platform constraints. Machine-checkable in full, which is why advisory
  // is reachable with no human in the loop -- but only with the receipt that does the checking.
  R1: Object.freeze({
    label: 'verified fact',
    without_automation: 'review',
    requires_statistics: false,
    tiers: Object.freeze([
      Object.freeze({ lifecycle: 'shadow', evidence: Object.freeze(['machine_receipt_complete']), repo_policy_grant: false }),
      Object.freeze({ lifecycle: 'advisory', evidence: Object.freeze(['machine_receipt_complete']), repo_policy_grant: false }),
      Object.freeze({ lifecycle: 'active', evidence: Object.freeze(['machine_receipt_complete']), repo_policy_grant: true }),
    ]),
  }),
  // Debug root causes and cross-task lessons. Generating and checking one is automatic; becoming
  // something the agent is shown is not, because a lesson is prose and no machine check reads it.
  R2: Object.freeze({
    label: 'engineering lesson',
    without_automation: 'review',
    requires_statistics: false,
    tiers: Object.freeze([
      Object.freeze({ lifecycle: 'shadow', evidence: Object.freeze([]), repo_policy_grant: false }),
    ]),
  }),
  // Commands, configuration edits, automatic repairs. The only row where observations are required
  // as well as evidence: a procedure is the one kind of memory that has an outcome to observe.
  R3: Object.freeze({
    label: 'procedural action',
    without_automation: 'review',
    requires_statistics: true,
    tiers: Object.freeze([
      Object.freeze({ lifecycle: 'shadow', evidence: Object.freeze(['sandbox_replay_passed']), repo_policy_grant: true }),
      Object.freeze({
        lifecycle: 'advisory',
        evidence: Object.freeze(['sandbox_replay_passed', 'rollback_defined', 'scope_declared']),
        repo_policy_grant: true,
      }),
    ]),
  }),
  // Permissions, secrets, deployment, repository-wide rules. Never promoted by machine; the only
  // output allowed is material a person reviews and merges themselves.
  R4: Object.freeze({
    label: 'normative, security or release',
    without_automation: 'pr-only',
    requires_statistics: false,
    tiers: Object.freeze([]),
  }),
  // Policy, evaluation gates, permissions, and this system's own code. A system that can promote
  // changes to its own promotion policy has no ceiling at all, so this row has no path to taking
  // effect from inside: it goes through the ordinary release process like any other code.
  R5: Object.freeze({
    label: 'control plane',
    without_automation: 'forbidden',
    requires_statistics: false,
    tiers: Object.freeze([]),
  }),
});

/**
 * How many independent episodes before the weak gate will look at a bound at all.
 *
 * Ten, from the plan, and it is worth being honest that at zero failures it is never the binding
 * constraint: the bound itself does not clear the threshold below until eleven. It stays because it
 * is the rule that survives someone lowering the threshold -- without it, a threshold edit alone
 * would re-admit samples of three.
 */
export const PROMOTION_MIN_INDEPENDENT_EPISODES = 10;

/**
 * Where the weak gate puts its line.
 *
 * Eight tenths, because that is the number the plan says a single user's sample cannot establish,
 * so it is the honest place to draw a gate that claims nothing beyond "not obviously worse than
 * this". With no observed failure the bound reaches it at n=11 (0.802595) and not at n=10
 * (0.787058), which is what makes the gate refuse rather than round up.
 *
 * It is a threshold, not an increment. Nothing in this module adds to or subtracts from a score
 * when something is used again or goes unused for a while: repetition can be a procedure being run
 * on a schedule, and disuse can be the task distribution moving, and neither is evidence about
 * whether the thing works.
 */
export const PROMOTION_WEAK_GATE_LOWER_BOUND = 0.8;

/**
 * The one-sided 95% normal quantile.
 *
 * Wilson rather than Jeffreys, for one reason that matters here: Wilson is closed form, so the
 * number this file produces can be recomputed by hand from the source and locked in a test as a
 * literal, whereas a Beta quantile would need either an iterative solver or a dependency -- and a
 * gate whose output nobody can reproduce on paper is exactly the kind of statistic this design
 * refuses to trust. The two agree closely in the all-success regime that this gate actually sees.
 *
 * Recomputed values at zero failures: n=5 gives 0.648883, which is the plan's own illustration that
 * five successes cannot support a claim of four-in-five; n=10 gives 0.787058; n=11 gives 0.802595;
 * n=12 gives 0.816019.
 */
const ONE_SIDED_95_Z = 1.6448536269514722;

const ajv = new Ajv({ allErrors: true, strict: true });
let compiledDecisionSchema = null;

function validationMessage(errors) {
  return (errors || []).slice(0, 8).map(error => {
    if (error.keyword === 'additionalProperties') {
      return `${error.instancePath || '/'} contains unknown field "${error.params.additionalProperty}"`;
    }
    return `${error.instancePath || '/'} ${error.message}`;
  }).join('; ');
}

/**
 * The gate every promotion decision has to pass on its way out.
 *
 * It sits at the exit rather than inside the one function that builds decisions today, for the same
 * reason the candidate schema sits at the writer: the shape has to hold for producers that do not
 * exist yet -- a host adapter, a model-backed proposer -- and those will not remember a rule that
 * only lives in a function they never call. The schema also carries the invariants that must not
 * depend on this file being correct: an R4 or R5 decision cannot be encoded as automatic at all,
 * and an automatic decision cannot carry a blocker.
 *
 * Re-exported from memory-contracts.mjs, which is where every other contract validator is found.
 * It is implemented here because this module sits a layer below that one and may not import it.
 */
export function validateMemoryPromotionDecision(decision) {
  if (!compiledDecisionSchema) {
    compiledDecisionSchema = ajv.compile(JSON.parse(readFileSync(schemaPath('promotion', 'decision.schema.json'), 'utf8')));
  }
  if (!compiledDecisionSchema(decision)) {
    throw new Error(`memory promotion decision is invalid: ${validationMessage(compiledDecisionSchema.errors)}`);
  }
  return decision;
}

function wilsonLowerBound(successes, trials) {
  const observed = successes / trials;
  const zSquared = ONE_SIDED_95_Z * ONE_SIDED_95_Z;
  const denominator = 1 + zSquared / trials;
  const centre = (observed + zSquared / (2 * trials)) / denominator;
  const halfWidth = (ONE_SIDED_95_Z / denominator)
    * Math.sqrt((observed * (1 - observed)) / trials + zSquared / (4 * trials * trials));
  return centre - halfWidth;
}

/**
 * What the observation record supports, counted over independent episodes.
 *
 * The caller hands over episode identity rather than a success count and a failure count, and that
 * is the whole reason this function has the signature it does. A count cannot be checked for
 * independence: eight triggers of the same procedure inside one turn arrive as "8 successes", the
 * interval computed from them is far too narrow, and nothing downstream can tell. So the unit is
 * the episode, repeats inside one collapse to a single data point, and the number that collapsed is
 * returned so the collapsing is visible rather than quiet.
 *
 * An episode counts as failed if any observation in it failed. Erring toward failure is deliberate:
 * this feeds a circuit breaker, and a breaker that resolves disagreement in favour of success is
 * not a breaker.
 *
 * `independent_sessions` is reported and nothing gates on it. Twelve episodes spread over one long
 * session are weaker evidence than twelve over twelve days, and a reader should see that -- but no
 * measurement here says how much weaker, and inventing a second threshold to express a hunch is the
 * move this module exists to avoid.
 */
export function evaluatePromotionStatistics(observations) {
  if (!Array.isArray(observations)) throw new Error('promotion statistics require an array of observations');
  const episodes = new Map();
  const sessions = new Set();
  let collapsed = 0;
  let unattributable = 0;
  for (const observation of observations) {
    if (observation?.outcome !== 'passed' && observation?.outcome !== 'failed') {
      throw new Error(`promotion observation outcome must be "passed" or "failed", got ${JSON.stringify(observation?.outcome)}`);
    }
    if (observation.session_id === undefined || observation.episode_id === undefined) {
      throw new Error('promotion observation must state episode_id and session_id, using null where there genuinely is none');
    }
    if (!observation.episode_id) {
      // No turn identity, so nothing can say whether this is a fresh situation or the same one
      // seen again. Dropped from the count and reported, never folded in as a free data point.
      unattributable += 1;
      continue;
    }
    if (observation.session_id) sessions.add(observation.session_id);
    // Keyed on the episode alone. If one turn id ever appeared under two sessions that is a bug in
    // whatever wrote it, and a composite key would answer that bug by counting the turn twice --
    // the one direction a sample size must never fail in.
    if (episodes.has(observation.episode_id)) collapsed += 1;
    const failed = episodes.get(observation.episode_id) || false;
    episodes.set(observation.episode_id, failed || observation.outcome === 'failed');
  }

  const independent = episodes.size;
  const failed = [...episodes.values()].filter(Boolean).length;
  const lowerBound = independent === 0 ? null : wilsonLowerBound(independent - failed, independent);
  const result = {
    verdict: 'insufficient_evidence',
    independent_episodes: independent,
    failed_episodes: failed,
    independent_sessions: sessions.size,
    observations_collapsed: collapsed,
    observations_unattributable: unattributable,
    lower_bound: lowerBound,
    // Stamped on every result, including the ones that pass. The number above is a floor under an
    // unbroken run, and this field is what stops a later reader from quoting it as anything else.
    interpretation: 'weak-gate-only',
    reason: '',
  };

  if (failed > 0) {
    // A breaker, not a test. It trips on the first observed failure however good the bound looks,
    // because "it worked twenty times and then broke" is a description of something broken.
    result.verdict = 'circuit_broken';
    result.reason = `${failed} of ${independent} independent episodes failed; a single observed failure trips the breaker regardless of the bound`;
    return result;
  }
  if (independent < PROMOTION_MIN_INDEPENDENT_EPISODES) {
    result.reason = `${independent} independent episodes is below the floor of ${PROMOTION_MIN_INDEPENDENT_EPISODES}; no bound from this few episodes supports anything`;
    return result;
  }
  if (lowerBound < PROMOTION_WEAK_GATE_LOWER_BOUND) {
    result.reason = `the one-sided 95% lower bound is ${lowerBound.toFixed(6)}, below the weak gate at ${PROMOTION_WEAK_GATE_LOWER_BOUND}`;
    return result;
  }
  result.verdict = 'weak_pass';
  result.reason = `no failure across ${independent} independent episodes, one-sided 95% lower bound ${lowerBound.toFixed(6)}; this means "not seen to fail and not obviously bad", nothing more`;
  return result;
}

function ladderIndex(lifecycle) {
  return PROMOTION_LADDER.indexOf(lifecycle);
}

function assertMember(value, allowed, label) {
  if (!allowed.includes(value)) throw new Error(`${label} must be one of ${allowed.join(', ')}, got ${JSON.stringify(value)}`);
}

/**
 * The highest lifecycle this request may reach with nobody watching, plus why it stopped there.
 *
 * Walks the tiers in order and keeps the last one that fully qualifies, so a partially satisfied
 * higher tier never lifts the ceiling. The first tier that fails is described in full -- which
 * checks were missing, whether the repository had authorized it -- because "why was this not
 * automatic" is the question this whole return value exists to answer.
 */
function automaticCeiling(entry, risk, evidence, repoPolicy) {
  const authorized = repoPolicy.automatic?.[risk] ?? null;
  let ceiling = null;
  const reasons = [];
  const blocked = [];
  for (const tier of entry.tiers) {
    const missing = tier.evidence.filter(check => evidence[check] !== true);
    const grantMissing = tier.repo_policy_grant
      && (authorized === null || ladderIndex(authorized) < ladderIndex(tier.lifecycle));
    if (missing.length === 0 && !grantMissing) {
      ceiling = tier.lifecycle;
      continue;
    }
    for (const check of missing) {
      blocked.push(`evidence-missing:${check}`);
      reasons.push(`${risk} cannot reach ${tier.lifecycle} automatically because the ${check} check did not hold.`);
    }
    if (grantMissing) {
      blocked.push(`repo-policy-not-authorized:${risk}:${tier.lifecycle}`);
      reasons.push(`${risk} may only reach ${tier.lifecycle} automatically where the repository has authorized it by name, and it has not.`);
    }
    break;
  }
  return { ceiling, reasons, blocked };
}

/**
 * Grade one promotion request.
 *
 * The order is not cosmetic. The lifecycle graph is consulted first and settles the question on its
 * own when the answer is no, so a request that could never be legal is never graded on evidence --
 * a decision that reported "blocked on a missing receipt" for a transition the state machine
 * rejects outright would send its reader to fix the wrong thing. Risk comes next and can end it
 * too. Evidence, repository authorization and observations only ever narrow what is left.
 *
 * The transition itself is asserted with the lifecycle module's own function, and its message is
 * copied into the reasons verbatim. There is exactly one state machine in this system and this file
 * is not a second one; quoting it rather than paraphrasing keeps that true after someone edits it.
 */
export function decideMemoryPromotion({
  risk,
  logical_type: logicalType = null,
  current_lifecycle: currentLifecycle = null,
  target_lifecycle: targetLifecycle,
  evidence = {},
  statistics = null,
  repo_policy: repoPolicy = {},
} = {}) {
  assertMember(risk, MEMORY_ACTION_RISKS, 'promotion risk');
  assertMember(logicalType, [...MEMORY_LOGICAL_TYPES, null], 'promotion logical_type');
  assertMember(currentLifecycle, [...MEMORY_LIFECYCLE_STATES, null], 'promotion current_lifecycle');
  assertMember(targetLifecycle, MEMORY_LIFECYCLE_STATES, 'promotion target_lifecycle');
  for (const check of Object.keys(evidence)) {
    if (!PROMOTION_EVIDENCE_CHECKS.includes(check)) {
      throw new Error(`unknown promotion evidence check "${check}"; known checks are ${PROMOTION_EVIDENCE_CHECKS.join(', ')}`);
    }
  }
  if (statistics !== null && !['weak_pass', 'insufficient_evidence', 'circuit_broken'].includes(statistics?.verdict)) {
    throw new Error(`promotion statistics must carry a verdict, got ${JSON.stringify(statistics?.verdict)}`);
  }

  const decision = {
    schema: PROMOTION_DECISION_SCHEMA,
    risk,
    logical_type: logicalType,
    current_lifecycle: currentLifecycle,
    target_lifecycle: targetLifecycle,
    ceiling: null,
    automation: 'forbidden',
    reasons: [],
    blocked_by: [],
    statistics,
  };

  try {
    assertMemoryLifecycleTransition(currentLifecycle, targetLifecycle);
  } catch (error) {
    decision.reasons.push(`${error.message}.`);
    decision.blocked_by.push('lifecycle-transition-not-allowed');
    return validateMemoryPromotionDecision(decision);
  }

  const entry = PROMOTION_RISK_MATRIX[risk];
  if (entry.tiers.length === 0) {
    decision.automation = entry.without_automation;
    decision.blocked_by.push(entry.without_automation === 'forbidden' ? 'risk-forbids-automation' : 'risk-allows-review-material-only');
    decision.reasons.push(entry.without_automation === 'forbidden'
      ? `${risk} is the ${entry.label}: this system may not put it into effect at all, and it goes through the ordinary release process.`
      : `${risk} is ${entry.label}: it is never promoted automatically, and the only output allowed is material a person reviews.`);
    return validateMemoryPromotionDecision(decision);
  }

  if (!PROMOTION_LADDER.includes(targetLifecycle)) {
    // Answered before the ceiling is computed, and the ceiling stays null: a number describing how
    // far this could be promoted says nothing about a request to retire it, and printing one next
    // to a demotion would read as if the demotion had been graded.
    decision.automation = 'review';
    decision.blocked_by.push('target-is-not-a-promotion');
    decision.reasons.push(`${targetLifecycle} is a demotion or a retirement, and this policy only grades promotions.`);
    return validateMemoryPromotionDecision(decision);
  }

  const ceiling = automaticCeiling(entry, risk, evidence, repoPolicy);
  decision.ceiling = ceiling.ceiling;

  if (entry.requires_statistics && statistics === null) {
    decision.blocked_by.push('statistics-missing');
    decision.reasons.push(`${risk} is ${entry.label}, so it has an outcome that can be observed and one has to be, but no observation record was supplied.`);
  } else if (statistics !== null && statistics.verdict !== 'weak_pass') {
    decision.blocked_by.push(`statistics-${statistics.verdict.replace(/_/gu, '-')}`);
    decision.reasons.push(`The observation record returned ${statistics.verdict}: ${statistics.reason}.`);
  }

  if (ceiling.ceiling === null || ladderIndex(targetLifecycle) > ladderIndex(ceiling.ceiling)) {
    // Why the ceiling stopped where it did is only reported when it actually stands in this
    // request's way. A request that asked for shadow does not need to hear which check would have
    // been required for advisory, and listing it would put a blocker on a decision nothing blocked.
    decision.reasons.push(...ceiling.reasons);
    decision.blocked_by.push(...ceiling.blocked);
    decision.blocked_by.push('above-automatic-ceiling');
    decision.reasons.push(ceiling.ceiling === null
      ? `Nothing is automatic for this request, so reaching ${targetLifecycle} needs a person.`
      : `${targetLifecycle} is beyond the automatic ceiling of ${ceiling.ceiling} for ${risk}, so it needs a person.`);
  }

  if (decision.blocked_by.length === 0) {
    decision.automation = 'auto';
    decision.reasons.push(`${targetLifecycle} is at or below the automatic ceiling of ${ceiling.ceiling} for ${risk}, with every required check satisfied.`);
  } else {
    decision.automation = entry.without_automation;
  }
  return validateMemoryPromotionDecision(decision);
}
