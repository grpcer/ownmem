# OwnMem 0.3 technical design and research lineage

OwnMem 0.3 is not a claim to have invented retrieval, hashing, rollback, or
evaluation. Its contribution is the composition of those foundations into an
executable protocol for **repository-scoped agent memory**: low-risk changes
may run unattended, but every automatic write must be attributable,
verifiable, quarantinable, and reversible. Text being retrieved never grants
it authority to influence an action.

The cited work explains the research lineage and threat model. It does not
imply that those projects implement OwnMem or that OwnMem reproduces their
models or experiments.

## 1. Evidence-carrying memory

A memory topic cannot establish its own authority. OwnMem keeps trust outside
the text: a receipt binds the content hash, external evidence root, lifecycle,
applicability, action risk, verifier identity, and predecessor receipt. Recall
rechecks repository paths, symbol slices, tests, commits, canonical documents,
user confirmations, and procedure replays against the current repository.

This follows the supply-chain principle that an artifact cannot prove its own
production history. [in-toto](https://www.usenix.org/conference/usenixsecurity19/presentation/torres-arias)
uses independent layouts and link metadata to verify software supply-chain
steps. OwnMem applies the same separation to memory entries, then adds evidence
drift, task scope, lifecycle, and context-delivery state.

The important distinction is that integrity is not truth. A matching hash
proves that content and receipt agree; it does not prove the assertion is
correct. Receipt integrity, live evidence validity, and action authority are
therefore separate verdicts.

## 2. Counterfactual promotion, not a successful-looking rerun

An automatic R0 promotion must prove all three conditions:

1. the production query fails against the baseline corpus;
2. the same query succeeds only after applying the candidate change;
3. every previously passing evaluation case remains passing.

If the baseline already succeeds, the candidate receives no credit. The
before/after relation is stored in the promotion receipt rather than reduced
to a model judgment.

This is related to [metamorphic testing](https://www.cse.ust.hk/~scc/publ/CS98-01-metamorphictesting.pdf)
and failure-inducing difference isolation in
[delta debugging](https://www.st.cs.uni-saarland.de/papers/tse2002/). OwnMem's
replay uses the same ranking and trust gates as production, but inside an
isolated mirror with an ephemeral trust delta. The mirror neither changes the
real repository nor produces false negatives merely because the sandbox lacks
the production trust store.

## 3. Risk derives from the change surface

OwnMem does not infer risk from what a memory talks about. It derives risk from
what the proposal changes and what that surface can influence: retrieval
metadata, prose knowledge, the active set, repository instructions, or
governance policy. Only replay-proven and precisely reversible R0 changes are
eligible for automatic materialization. The proposer cannot lower its own risk
class.

This is aligned with the risk–coverage trade-off in
[selective classification](https://jmlr.org/papers/v11/el-yaniv10a.html) and
with [CaMeL](https://arxiv.org/abs/2503.18813), which separates untrusted data
from control flow and capability. OwnMem places that refusal boundary both at
context delivery and at memory evolution.

Relevance, epistemic validity, task applicability, and action risk remain four
independent gates. A highly relevant result can still become advisory,
quarantined, or withheld if its evidence or authority is insufficient.

## 4. Content-addressed compensating rollback

An automatic trigger edit must be a pure UTF-8 byte insertion. Its promotion
receipt records the insertion offset and length, inserted-fragment hash,
candidate hash, and original-content hash. Rollback runs only while the current
file still matches the promoted candidate, verifies the restored hash, appends
a rollback receipt, reissues trust for the restored state, and recompiles.

If trust issuance, audit, or compilation fails after materialization, the
coordinator compensates the transaction in reverse order. This follows the
compensating-transaction idea from
[Sagas](https://doi.org/10.1145/38713.38742), adapted to content-addressed
repository edits.

Infrastructure compensation and safety-tripwire rollback are distinct. The
former repairs an incomplete transaction; the latter quarantines first because
a harmful outcome was observed. Automation may reverse only receipts marked
`automation: auto`; it cannot undo a human decision.

## 5. Memory poisoning is a first-class threat

[AgentPoison](https://proceedings.neurips.cc/paper_files/paper/2024/hash/eb113910e9c3f6242541c1652e30dfd6-Abstract-Conference.html)
and [PoisonedRAG](https://www.usenix.org/conference/usenixsecurity25/presentation/zou-poisonedrag)
show that a small amount of adversarial knowledge can steer agents or RAG
systems while leaving ordinary quality metrics apparently healthy. Retrieval
therefore cannot be a trust signal by itself.

Candidates enter quarantine. Self-attribution is only a weak label. External
text cannot grant itself authority. Content drift, receipt tampering, or a
missing evidence target blocks injection. When the target still exists but a
symbol slice changed, the weaker evidence-drift verdict becomes advisory; this
avoids treating every refactor as an attack.

The defense does not ask the same language model to reread a candidate and
declare it safe. It uses hashes, schemas, evidence resolvers, lifecycle graphs,
action-risk rules, and replay through the production runtime.

## 6. Immutable snapshots and reproducible recall

OwnMem compiles Markdown, L1/L2/L3 graph relationships, trust state, ranking
identity, and provenance into a content-addressed snapshot. Excerpts come from
compiled bytes, not from rereading mutable files at query time. A source or
ranking-identity change triggers rebuilding, while the previous validated
snapshot remains available as a rollback point.

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

[ARES](https://aclanthology.org/2024.naacl-long.20/) and
[RAGChecker](https://arxiv.org/abs/2408.08067) decompose RAG quality into
separate components. OwnMem extends that separation to runtime events and
product metrics: `completed → delivered → consumed` is a delivery funnel,
whereas confirmed outcomes are a different measurement surface. Missing data
is shown as unavailable, never as zero or inferred accuracy.

## 8. Bounded autonomy and self-suppressing growth

The end-of-turn evolution coordinator runs under a repository-local enable
switch, cross-process lock, debounce window, hard per-run limits, and monotonic
state ledger. It checks harmful tripwires before scanning new work. Repeated or
invalid candidates can be quarantined, while higher-risk proposals become
review material instead of blocking the safe path.

General knowledge remains under a zero-net-growth topic quota. Automatic R0
metadata may spend only a small byte budget inside the existing hard corpus
cap and may not create a topic. This makes the unattended mechanism
self-limiting: a noisy feedback producer cannot turn candidate volume into
unbounded repository growth.

The design goal resembles the long-horizon learning ambition behind
[Reflexion](https://papers.neurips.cc/paper_files/paper/2023/hash/1b44b878bb782e6954cd888628510e90-Abstract-Conference.html),
but the learning boundary is deliberately different. OwnMem evolves durable
repository state only when deterministic evidence can justify and reverse the
change.

## References

1. Chen et al. [AgentPoison: Red-teaming LLM Agents via Poisoning Memory or Knowledge Bases](https://proceedings.neurips.cc/paper_files/paper/2024/hash/eb113910e9c3f6242541c1652e30dfd6-Abstract-Conference.html). NeurIPS 2024.
2. Zou et al. [PoisonedRAG: Knowledge Corruption Attacks to Retrieval-Augmented Generation of Large Language Models](https://www.usenix.org/conference/usenixsecurity25/presentation/zou-poisonedrag). USENIX Security 2025.
3. Debenedetti et al. [Defeating Prompt Injections by Design](https://arxiv.org/abs/2503.18813). 2025.
4. Torres-Arias et al. [in-toto: Providing farm-to-table guarantees for bits and bytes](https://www.usenix.org/conference/usenixsecurity19/presentation/torres-arias). USENIX Security 2019.
5. El-Yaniv and Wiener. [On the Foundations of Noise-free Selective Classification](https://jmlr.org/papers/v11/el-yaniv10a.html). JMLR 2010.
6. Garcia-Molina and Salem. [Sagas](https://doi.org/10.1145/38713.38742). ACM SIGMOD 1987.
7. Chen, Cheung, and Yiu. [Metamorphic Testing: A New Approach for Generating Next Test Cases](https://www.cse.ust.hk/~scc/publ/CS98-01-metamorphictesting.pdf). HKUST-CS98-01, 1998.
8. Zeller and Hildebrandt. [Simplifying and Isolating Failure-Inducing Input](https://www.st.cs.uni-saarland.de/papers/tse2002/). IEEE TSE 2002.
9. Saad-Falcon et al. [ARES: An Automated Evaluation Framework for Retrieval-Augmented Generation Systems](https://aclanthology.org/2024.naacl-long.20/). NAACL 2024.
10. Ru et al. [RAGChecker: A Fine-grained Framework for Diagnosing Retrieval-Augmented Generation](https://arxiv.org/abs/2408.08067). 2024.
11. Packer et al. [MemGPT: Towards LLMs as Operating Systems](https://arxiv.org/abs/2310.08560). 2023.
12. Shinn et al. [Reflexion: Language Agents with Verbal Reinforcement Learning](https://papers.neurips.cc/paper_files/paper/2023/hash/1b44b878bb782e6954cd888628510e90-Abstract-Conference.html). NeurIPS 2023.
