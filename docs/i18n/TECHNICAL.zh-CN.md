# OwnMem 0.3 技术设计与研究脉络

OwnMem 0.3 的价值不在于声称发明了检索、哈希、回滚或评测，而在于把这些基础机制组合成一套面向
**仓库级 Agent Memory** 的可执行协议：低风险变化可以无人值守，但自动写入必须可归因、可验证、
可隔离、可撤销；文本被检索到，不等于它有权影响行动。

下列文献用于说明研究脉络和威胁模型，不表示相关工作实现了 OwnMem，也不表示 OwnMem 复现了论文
中的模型或实验。

## 1. 证据携带记忆，而不是文本自证

记忆 topic 不能自授 authority。OwnMem 把信任放在正文之外：收据绑定内容哈希、外部证据根、
生命周期、适用范围、动作风险、核验器和前驱收据；召回时再核验仓库路径、代码符号、测试、commit、
权威文档、用户确认与 procedure replay。

这与软件供应链中“产物不能自己证明生产过程”的原则一致。[in-toto](https://www.usenix.org/conference/usenixsecurity19/presentation/torres-arias)
使用独立布局和链路元数据核验供应链步骤；OwnMem 将这种分离用于记忆，并增加 evidence drift、任务范围、
生命周期和上下文交付状态。

哈希一致只证明内容与记录一致，不证明内容正确。因此，收据完整性、外部证据有效性和行动 authority
始终是三项独立判定。

## 2. 反事实差分回放，而不是“改完能用”

R0 自动晋升必须同时证明：

1. 同一查询在基线语料中召回失败；
2. 加入候选变更后，只因为该变更而恢复；
3. 之前通过的评测语料没有回归。

如果基线本来就能召回，候选不能获得功劳。before / after 的执行证据会进入 promotion receipt，而不是
被压缩成一次模型判断。

这与[蜕变测试](https://www.cse.ust.hk/~scc/publ/CS98-01-metamorphictesting.pdf)和
[Delta Debugging](https://www.st.cs.uni-saarland.de/papers/tse2002/)的差分思想同源。
OwnMem 在隔离镜像中使用与生产相同的排序和信任门，并签发短命 trust delta；它既不污染真实仓库，
也不会因为沙箱缺少生产信任状态而产生假阴性。

## 3. 风险来自变更面，不来自提案者自评

OwnMem 不根据记忆“谈论什么”猜风险，而根据提案改变了什么、能影响什么来定级：检索元数据、正文知识、
active set、仓库指令或治理策略。只有经过回放证明、受配额约束且能精确撤销的 R0 变化可以自动生效；
提案者不能给自己的变化降级。

这与[选择性分类](https://jmlr.org/papers/v11/el-yaniv10a.html)的 risk–coverage 取舍，以及
[CaMeL](https://arxiv.org/abs/2503.18813)把不可信数据与控制流、能力授权分离的方向一致。
OwnMem 将拒绝权同时放在记忆交付和记忆演化两处。

相关性、事实有效性、任务适用性和动作风险是四道独立门。高度相关的候选仍可能因证据或权限不足而降级、
隔离或弃答。

## 4. 内容寻址的补偿回滚

自动 trigger 变更必须是纯 UTF-8 字节插入。promotion receipt 保存插入位置、长度、片段哈希、候选哈希和
原内容哈希。只有当前文件仍与该候选一致时才允许回滚；恢复后再次核验原哈希，追加 rollback receipt，
为恢复态重签 trust 并重编译快照。

如果 materialize 之后 trust、audit 或 compile 失败，协调器会按逆序补偿，而不是留下半完成状态。
这与 [Saga](https://doi.org/10.1145/38713.38742) 的补偿事务思想同源。

基础设施补偿与安全 tripwire 回滚相互独立：前者修复不完整事务，后者因为观察到 harmful 结局而先隔离。
机器只能撤销标记为 `automation: auto` 的收据，不能替人撤销人工决策。

## 5. 把记忆投毒作为一等威胁

[AgentPoison](https://proceedings.neurips.cc/paper_files/paper/2024/hash/eb113910e9c3f6242541c1652e30dfd6-Abstract-Conference.html)
和 [PoisonedRAG](https://www.usenix.org/conference/usenixsecurity25/presentation/zou-poisonedrag)
说明：少量恶意知识就可能稳定操纵 Agent 或 RAG，同时让普通质量指标看起来正常。因此，“能检索到”本身
不能成为信任依据。

候选默认进入 quarantine；Agent 自归因只是弱标签；外部文本不能自授 authority。正文漂移、收据篡改或
证据目标消失会阻止注入。如果目标仍在，只是代码符号内容变化，则降为 advisory，避免把普通重构误判为攻击。

这条防线不让同一个 LLM 再读一遍候选并宣布安全，而是依靠独立哈希、Schema、证据解析、生命周期图、
动作风险规则和生产路径回放。

## 6. 不可变快照与可复现召回

OwnMem 把 Markdown、L1/L2/L3 图关系、信任状态、排序身份和 provenance 编译成内容寻址快照；正文摘录
来自编译时字节，而不是查询时重读。源内容或排序身份变化会触发重建，上一份已验证快照保留为回退点。

这与内容寻址构建系统的可复现输入和依赖图原则同源，也与
[MemGPT](https://arxiv.org/abs/2310.08560)的上下文管理目标相关；但 OwnMem 管的是仓库知识的验证状态和
交付权限，而不是给无限对话记忆分页。

默认召回零模型调用、零查询期网络请求。可选 embedding 通道从 observe、权重 0 开始，只有仓库本地 A/B
证据通过安全门后才可进入 weighted 排序。

## 7. 三条账避免指标互相冒充

OwnMem 不把“返回了结果”“打开了全文”“Agent 说有用”和“用户真的采用”混成一个成功率：

1. retrieval feedback 只判断召回结果是否正确；
2. outcome receipt 只记录用户或受信宿主确认的结局；
3. self-attribution 是 Agent 自报弱标签，只报计数，不算采用率。

[ARES](https://aclanthology.org/2024.naacl-long.20/) 与
[RAGChecker](https://arxiv.org/abs/2408.08067)强调分解 RAG 的组件与质量维度。OwnMem 将这种分解延伸到
运行事件：`completed → delivered → consumed` 是交付漏斗，confirmed outcome 是另一条采集面；缺数据时
显示“暂无”，不拿 0、Recall@K 或打开次数冒充真实收益。

## 8. 有界自治与自抑制增长

轮末协调器受仓库级开关、跨进程锁、防抖窗口、单轮硬上限和单调状态账约束。它先检查 harmful tripwire，
再扫描新候选；重复或无效候选可以隔离，高风险提案生成复审材料，不阻塞安全路径。

通用知识仍受零净增长 topic 配额约束。自动 R0 元数据只能在现有语料总容量内消耗很小的字节预算，且不能
新增 topic。这让无人值守机制天然自限：嘈杂反馈不能把候选数量变成无限仓库增长。

这一目标与 [Reflexion](https://papers.neurips.cc/paper_files/paper/2023/hash/1b44b878bb782e6954cd888628510e90-Abstract-Conference.html)
的长时学习愿景相关，但 OwnMem 的边界不同：只有确定性证据能够证明且撤销的变化，才能改变持久仓库状态。

## 参考文献

1. Chen et al. [AgentPoison](https://proceedings.neurips.cc/paper_files/paper/2024/hash/eb113910e9c3f6242541c1652e30dfd6-Abstract-Conference.html). NeurIPS 2024.
2. Zou et al. [PoisonedRAG](https://www.usenix.org/conference/usenixsecurity25/presentation/zou-poisonedrag). USENIX Security 2025.
3. Debenedetti et al. [Defeating Prompt Injections by Design](https://arxiv.org/abs/2503.18813). 2025.
4. Torres-Arias et al. [in-toto](https://www.usenix.org/conference/usenixsecurity19/presentation/torres-arias). USENIX Security 2019.
5. El-Yaniv and Wiener. [Selective Classification](https://jmlr.org/papers/v11/el-yaniv10a.html). JMLR 2010.
6. Garcia-Molina and Salem. [Sagas](https://doi.org/10.1145/38713.38742). ACM SIGMOD 1987.
7. Chen, Cheung, and Yiu. [Metamorphic Testing](https://www.cse.ust.hk/~scc/publ/CS98-01-metamorphictesting.pdf). 1998.
8. Zeller and Hildebrandt. [Delta Debugging](https://www.st.cs.uni-saarland.de/papers/tse2002/). IEEE TSE 2002.
9. Saad-Falcon et al. [ARES](https://aclanthology.org/2024.naacl-long.20/). NAACL 2024.
10. Ru et al. [RAGChecker](https://arxiv.org/abs/2408.08067). 2024.
11. Packer et al. [MemGPT](https://arxiv.org/abs/2310.08560). 2023.
12. Shinn et al. [Reflexion](https://papers.neurips.cc/paper_files/paper/2023/hash/1b44b878bb782e6954cd888628510e90-Abstract-Conference.html). NeurIPS 2023.
