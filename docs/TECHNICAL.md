# OwnMem technical design and research lineage

OwnMem is not a claim to have invented retrieval, hashing, abstention, or
evaluation. Its contribution is the composition of those foundations into an
executable protocol for **repository-scoped agent memory**: retrieval is
deterministic and local, delivery is graded by how much the evidence supports,
and nothing is written into memory without a person committing it. Text being
retrieved never grants it authority to influence an action.

The cited work explains the research lineage and threat model. It does not
imply that those projects implement OwnMem or that OwnMem reproduces their
models or experiments.

## 1. Evidence-carrying memory

A memory topic cannot establish its own authority. OwnMem keeps trust outside
the text: a receipt binds the content hash, external evidence root, lifecycle,
applicability, action risk, verifier identity, and predecessor receipt. Recall
rechecks repository paths, symbol slices, tests, commits, canonical documents,
and user confirmations against the current repository.

This follows the supply-chain principle that an artifact cannot prove its own
production history. [in-toto](https://www.usenix.org/conference/usenixsecurity19/presentation/torres-arias)
uses independent layouts and link metadata to verify software supply-chain
steps. OwnMem applies the same separation to memory entries, then adds evidence
drift, task scope, lifecycle, and context-delivery state.

The important distinction is that integrity is not truth. A matching hash
proves that content and receipt agree; it does not prove the assertion is
correct. Receipt integrity, live evidence validity, and action authority are
therefore separate verdicts.

An anchor can also be wrong in a way that still verifies. When an evidence
slice matches a comment or a call site rather than a definition, the fingerprint
is stable and the receipt reads as healthy while vouching for the wrong block —
the sharpest case being a memory whose lesson is "this symbol must not exist",
anchored to the comment that says so. That shape is reported as
`symbol-not-a-definition` rather than silently re-signed, because refreshing it
only re-signs the comment.

## 2. Graded delivery instead of quote-or-silence

A retrieval protocol with two outcomes — quote the memory, or say nothing —
forces every borderline case into one of them, and quoting is the cheaper
mistake to make at the moment of choosing. The result is a system that answers
confidently on questions it has nothing to say about.

OwnMem grades delivery into three tiers, and the envelope names the tier it
used:

| Tier | Condition | What the agent receives |
| --- | --- | --- |
| `content` | top candidate at or above the content threshold **and** explaining at least `coverage_floor` of the query | the memory's own text, with provenance |
| `pointers` | qualified candidates below that threshold | up to three titles, one line each, and the command that opens the topic |
| `abstain` | no qualified candidate | nothing, plus the reason no answer was given |

The threshold is not a taste setting. It is read off the ablation curve
described in §4: the smallest value at which false delivery stops falling. A
pointer is explicitly not an answer, and every renderer — terminal, hook
preamble, MCP tool result — has to say so, because an agent that reads a
pointer as a conclusion has undone the tier.

Clearing the threshold is necessary and not sufficient, because a confidence
score answers a different question from the one that matters here. It says how
sure the ranker is about this memory; it does not say how much of the question
this memory accounts for. Over 336 quoted deliveries whose correctness is known,
the confidence score separates right from wrong with AUC 0.812, but only 0.667
once the self-proving smoke questions are removed — and those are the questions
written out of a memory's own summary, so their coverage is full by construction
and they flatter every metric. On the same hard cases, query coverage reaches
0.886. So the content tier also requires the top candidate to explain at least
`coverage_floor` of the query: character-span coverage for natural-language
queries, and the IDF-weighted coverage for identifier, path and error lookups,
because a one-token symbol query has a span coverage of exactly 0 or 1 with
nothing in between. The floor is the same constant the relevance gate already
used, deliberately not a second number to tune. Failing it costs the quotation
and nothing else: no relevance gate moved, so the memory still arrives as a
pointer.

Abstention carries its reason rather than a single "nothing matched", which
calls for the opposite response from the caller: `below-content-threshold`
means something was found and withheld, `blocked-validity` means the trust gate
refused it, `no-trusted-candidate` means the corpus has nothing. This mirrors
the risk–coverage trade-off in
[selective classification](https://jmlr.org/papers/v11/el-yaniv10a.html):
abstention is a first-class output, and the cost of a wrong answer is not the
same as the cost of no answer.

## 3. Four independent gates, and risk from the change surface

Relevance, epistemic validity, task applicability, and action risk are four
independent gates. A highly relevant result can still be downgraded to advisory
or withheld outright if its evidence or authority is insufficient, and the
refusing gate is named in the abstention reason rather than folded into the
others.

Risk is not inferred from what a memory talks about but from what acting on it
can affect. Retrieval metadata, prose knowledge, the active set, repository
instructions, and governance policy are different surfaces, and a memory cannot
lower its own risk class by asserting a lower one in its own text.

This is aligned with [CaMeL](https://arxiv.org/abs/2503.18813), which separates
untrusted data from control flow and capability. OwnMem places that refusal
boundary at context delivery: retrieved text is data, never an instruction and
never a capability.

## 4. Evaluation before ranking

No ranking, gate, or delivery change lands without passing the evaluation
harness first. Three properties make the harness worth gating on.

**Questions come from outside the memory.** A question written while reading
the memory it is supposed to retrieve tests nothing; it measures whether the
system can find text that was copied out of that text. Cases are harvested from
commit history, from the code the memory anchors to, and from real retrieval
receipts, and a leakage gate rejects a case whose wording overlaps its target —
including the area index and the topic's opening paragraph, which is where
self-proving questions are easiest to write by accident.

**Ablation is the primary metric.** For each case the harness removes the
correct memory from the corpus and reruns the query. Anything still delivered
as content is a false delivery: the system had nothing correct to say and said
something anyway. This is a metamorphic relation in the sense of
[metamorphic testing](https://www.cse.ust.hk/~scc/publ/CS98-01-metamorphictesting.pdf) —
the expected output is not known in advance, but the required *change* in output
under a known input transformation is. It is also what sets the content
threshold in §2: the curve is measured, and the threshold is the smallest value
at which it flattens.

**Tuning and reporting use different data.** Cases are split into a tuning set
and a holdout, topic groups never straddle the split, and the split method and
seed are recorded in a lock file. Thresholds are read off the tuning set;
reported numbers come from the holdout; and every number is reported with its
denominator, because a recall figure over an unnamed subset is not a measurement.

[ARES](https://aclanthology.org/2024.naacl-long.20/) and
[RAGChecker](https://arxiv.org/abs/2408.08067) decompose RAG quality into
separately measurable components rather than one score. OwnMem applies the same
decomposition to a corpus small enough that a single blended number would hide
everything worth knowing.

## 5. Memory poisoning is a first-class threat

[AgentPoison](https://proceedings.neurips.cc/paper_files/paper/2024/hash/eb113910e9c3f6242541c1652e30dfd6-Abstract-Conference.html)
and [PoisonedRAG](https://www.usenix.org/conference/usenixsecurity25/presentation/zou-poisonedrag)
show that a small amount of adversarial knowledge can steer agents or RAG
systems while leaving ordinary quality metrics apparently healthy. Retrieval
therefore cannot be a trust signal by itself.

External text cannot grant itself authority. Content drift, receipt tampering,
or a missing evidence target quarantines the entry and blocks injection. When
the target still exists but a symbol slice changed, the weaker evidence-drift
verdict downgrades the entry to advisory instead; this avoids treating every
refactor as an attack.

The defense does not ask the same language model to reread an entry and declare
it safe. It uses hashes, schemas, evidence resolvers, lifecycle graphs, and
action-risk rules — and, above all, the fact that no text enters memory without
a human commit.

## 6. Immutable snapshots and reproducible recall

OwnMem compiles Markdown, L1/L2/L3 graph relationships, trust state, ranking
identity, and provenance into a content-addressed snapshot. Excerpts come from
compiled bytes, not from rereading mutable files at query time, so the same
query against the same snapshot answers the same way. A source or
ranking-identity change rebuilds it, while the previous validated snapshot
stays available as a restore point.

This shares the reproducible-input and dependency-graph principles of
content-addressed build systems. It also overlaps with the context-management
goal of [MemGPT](https://arxiv.org/abs/2310.08560), but OwnMem governs the
validation state and delivery authority of repository knowledge rather than
paging an unbounded conversation memory.

Default recall uses no model and no query-time network call. The optional
embedding channel begins in observation mode with weight zero and may join
weighted ranking only after repository-local A/B evidence passes the safety
gate.

## 7. Three ledgers prevent metric substitution

OwnMem does not merge “a result was returned,” “the full topic was opened,”
“the agent called it useful,” and “a person adopted it” into one success rate:

1. retrieval feedback judges whether recall returned the right memory;
2. outcome receipts record only user- or trusted-host-confirmed results;
3. self-attribution is an agent-reported weak label and is reported as counts,
   never as an adoption rate.

`completed → delivered → consumed` is a delivery funnel, whereas confirmed
outcomes are a different measurement surface with a different denominator.
Missing data is shown as unavailable, never as zero or inferred accuracy. A
topic being opened proves it was read, not that it was used, and the report
refuses to let the first stand in for the second.

The middle tier was measured rather than assumed. Asking "do people ignore
pointers because they are noise, or because they are being ignored?" has opposite
remedies, so the pointers were labelled one by one against both the evaluation
corpus and the recorded feedback. Precision turns out to depend entirely on
whether an answer exists at all: where one does, the pointer set contains it
essentially always; where none does, every pointer is noise by construction, and
that is the larger population. No feature separates the two cases at the level of
a single pointer — the best reaches AUC 0.66 against 0.89 for the gate that
decides quoting — and the cost curve has no knee, so gating pointers would destroy
more correct answers than noise. The tier is therefore left alone and the finding
recorded, which is the outcome an evaluation is supposed to be allowed to have.

The headline number is therefore neither of those. It is the **known
false-delivery residual**: of every distinct query a wrong-delivery receipt was
recorded for, the share the current index still answers with prose. Both halves
are facts somebody already recorded, nothing new has to be collected for the
next reading to exist, and it falls only when retrieval improves. The rate a
memory system would most like to publish — how often its answers were actually
used — is reported as permanently unmeasured instead of approximated: only a user
or a trusted host may confirm an outcome, and a user judges the deliverable
rather than which memory was injected, so that numerator is not waiting on a
lower confirmation bar. The one surface that can produce it is a host
confirmation: a gate or test confirming the memory's own assertion.

## 8. Bounded growth without automation

Memory systems fail by accumulation long before they fail by retrieval. Writing
a well-formed entry costs nothing, so a corpus with quality gates but no flow
control grows until routing stops working and nobody trusts the index.

OwnMem's answer is a hard entry count on the active corpus that ratchets
downward only. `ownmem audit` fails when the corpus exceeds it, so adding an
entry to a full corpus means retiring one in the same change. There is no byte
budget beside it: a byte ceiling that is raised to match each new entry has
never refused anything, it has only added paperwork.

The deliberate omission is automation. There is no coordinator, no promotion,
no candidate queue, and no unattended write of any kind; the package measures
and proposes, and a person commits. That boundary is also why the MCP server
exposes exactly two read-only tools. The ambition behind
[Reflexion](https://papers.neurips.cc/paper_files/paper/2023/hash/1b44b878bb782e6954cd888628510e90-Abstract-Conference.html)
is long-horizon self-improvement from experience; OwnMem keeps the experience
ledgers and deliberately stops short of acting on them by itself, because the
cost of a wrong durable memory is paid by every future session and the evidence
for automating that decision does not exist yet.

## References

1. Chen et al. [AgentPoison: Red-teaming LLM Agents via Poisoning Memory or Knowledge Bases](https://proceedings.neurips.cc/paper_files/paper/2024/hash/eb113910e9c3f6242541c1652e30dfd6-Abstract-Conference.html). NeurIPS 2024.
2. Zou et al. [PoisonedRAG: Knowledge Corruption Attacks to Retrieval-Augmented Generation of Large Language Models](https://www.usenix.org/conference/usenixsecurity25/presentation/zou-poisonedrag). USENIX Security 2025.
3. Debenedetti et al. [Defeating Prompt Injections by Design](https://arxiv.org/abs/2503.18813). 2025.
4. Torres-Arias et al. [in-toto: Providing farm-to-table guarantees for bits and bytes](https://www.usenix.org/conference/usenixsecurity19/presentation/torres-arias). USENIX Security 2019.
5. El-Yaniv and Wiener. [On the Foundations of Noise-free Selective Classification](https://jmlr.org/papers/v11/el-yaniv10a.html). JMLR 2010.
6. Chen, Cheung, and Yiu. [Metamorphic Testing: A New Approach for Generating Next Test Cases](https://www.cse.ust.hk/~scc/publ/CS98-01-metamorphictesting.pdf). HKUST-CS98-01, 1998.
7. Saad-Falcon et al. [ARES: An Automated Evaluation Framework for Retrieval-Augmented Generation Systems](https://aclanthology.org/2024.naacl-long.20/). NAACL 2024.
8. Ru et al. [RAGChecker: A Fine-grained Framework for Diagnosing Retrieval-Augmented Generation](https://arxiv.org/abs/2408.08067). 2024.
9. Packer et al. [MemGPT: Towards LLMs as Operating Systems](https://arxiv.org/abs/2310.08560). 2023.
10. Shinn et al. [Reflexion: Language Agents with Verbal Reinforcement Learning](https://papers.neurips.cc/paper_files/paper/2023/hash/1b44b878bb782e6954cd888628510e90-Abstract-Conference.html). NeurIPS 2023.
