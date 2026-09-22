# OwnMem 技术设计与研究脉络

OwnMem 的价值不在于声称发明了检索、哈希、弃权或评测，而在于把这些基础机制组合成一套面向
**仓库级 Agent Memory** 的可执行协议：检索确定、本地、可复现；交付按证据强度分档；任何内容进入
记忆都要有人提交。文本被检索到，不等于它有权影响行动。

下列文献用于说明研究脉络和威胁模型，不表示相关工作实现了 OwnMem，也不表示 OwnMem 复现了论文
中的模型或实验。

## 1. 证据携带记忆，而不是文本自证

记忆 topic 不能自授 authority。OwnMem 把信任放在正文之外：收据绑定内容哈希、外部证据根、
生命周期、适用范围、动作风险、核验器和前驱收据；召回时再核验仓库路径、代码符号、测试、commit、
权威文档与用户确认。

这与软件供应链中“产物不能自己证明生产过程”的原则一致。[in-toto](https://www.usenix.org/conference/usenixsecurity19/presentation/torres-arias)
使用独立布局和链路元数据核验供应链步骤；OwnMem 将这种分离用于记忆，并增加 evidence drift、任务范围、
生命周期和上下文交付状态。

哈希一致只证明内容与记录一致，不证明内容正确。因此，收据完整性、外部证据有效性和行动 authority
始终是三项独立判定。

还有一种锚点是错的，但核验照样通过：证据切片匹配到的是注释或调用点而不是定义，指纹于是很稳定，
收据看起来完全健康，实际上在给错误的代码块背书。最尖锐的一例是“这个符号不得存在”的教训——
它的锚点只能落在说明“不得存在”的那行注释上。这种形态会被单列为 `symbol-not-a-definition`
报出来，而不是重新签一遍：refresh 只会把那行注释再签一次。

## 2. 分档交付，取代“要么引用、要么沉默”

一个只有两种结局的检索协议——引用记忆正文，或者什么都不说——会把所有拿不准的情况逼进其中一边，
而在做选择的那一刻，引用是代价更小的那个错误。结果就是一个在自己毫无话可说的问题上照样自信作答的
系统。

OwnMem 把交付分成三档，信封会写明自己走的是哪一档：

| 档位 | 条件 | Agent 拿到什么 |
| --- | --- | --- |
| `content` | 首位候选达到或超过正文阈值，**并且**解释了查询的 `coverage_floor` 以上 | 记忆正文本身，带出处 |
| `pointers` | 有合格候选，但都低于该阈值 | 最多三条“标题 + 一句话 + 打开该 topic 的命令” |
| `abstain` | 没有合格候选 | 什么都不给，并说明为什么没有答案 |

阈值不是口味设定，它读自 §4 的消融曲线：误交付率不再下降的最小取值。**指针明确不是答案**，
终端、hook 前言、MCP 工具结果每一个渲染面都必须说清这一点——一个把指针读成结论的 agent，
等于把这一档白做了。

过阈值是必要条件，不是充分条件，因为置信分回答的根本是另一个问题：它说的是排序器对这条记忆有多确定，
没说这条记忆解释了问题的多少。在 336 条已知对错的正文交付上，置信分区分对错的 AUC 是 0.812，
去掉自证型冒烟题后只剩 0.667——那些题的题面抄自记忆自己的摘要，覆盖率天然满分，会把每个指标都
抬高。同一批难样本上，查询覆盖率能到 0.886。所以正文档还要求首位候选解释查询的 `coverage_floor`
以上：自然语言查询看字符跨度覆盖率，identifier / path / error 查找看 IDF 加权覆盖率——单 token 的
符号查询，跨度覆盖率只有 0 或 1，中间没有值。这个下限就是相关性门早已在用的同一个常数，
故意不再多加一个要调的数字。没过只会失去这次引用，别的什么都不失去：相关性门一条没动，
这条记忆仍然以指针的形式到达。

弃权会带上自己的原因，而不是统一报一句“没匹配到”——那对调用方意味着完全相反的下一步动作：
`below-content-threshold` 是“找到了但压住没给”，`blocked-validity` 是“信任门拦下了”，
`no-trusted-candidate` 才是“语料里根本没有”。这正是
[选择性分类](https://jmlr.org/papers/v11/el-yaniv10a.html)里的 risk–coverage 取舍：
弃权是一等输出，答错的代价和不答的代价本来就不是一回事。

## 3. 四道独立的门，风险来自变更面

相关性、认知有效性、任务适用性、动作风险是四道互相独立的门。一条高度相关的结果，仍然可能因为
证据或 authority 不足而被降为 advisory 或整条扣住；是哪道门拒的会写进弃权原因，而不是被并成
同一句。

风险不是从“这条记忆在谈什么”推出来的，而是从“照它做会影响到什么”推出来的。检索元数据、散文
知识、活跃集、仓库指令、治理策略是不同的变更面；一条记忆不能靠在自己正文里声明一个更低的风险级别
来给自己降级。

这与 [CaMeL](https://arxiv.org/abs/2503.18813) 把不可信数据同控制流与能力分开的思路一致。
OwnMem 把这条拒绝边界放在上下文交付处：被检索出来的文本是数据，永远不是指令，也永远不是能力。

## 4. 评测先行

任何排序、门或交付改动，先过评测台才允许合入。这套台子值得当门用，靠三条性质。

**题目来自记忆之外。** 一边读着某条记忆一边给它出的题，什么也没测——它测的是系统能不能找回一段
从那条记忆里抄出来的文字。题目从提交历史、记忆锚定的那段代码、真实检索回执里采集；泄漏门会拒收
与目标内容措辞重叠的题，**包括 L2 索引行和 topic 正文首段**——最容易在无意间写出自证题的正是这两处。

**消融是首要指标。** 对每道题，评测台把正确的那条记忆从语料里剔除，再跑一次同样的查询；此时仍然
以 `content` 档交付的，就是一次误交付：系统手上没有正确答案，却照样说了话。这是
[蜕变测试](https://www.cse.ust.hk/~scc/publ/CS98-01-metamorphictesting.pdf)意义上的蜕变关系——
期望输出事先并不知道，但在一次已知的输入变换下，输出**必须怎么变**是知道的。§2 的正文阈值也由它
定出：曲线是量出来的，阈值取它开始走平的最小值。

**调参和报数用不同的数据。** 题目切成调参集与留出集，同一 topic 的题不得跨集，切法与随机种子写进
lock 文件。阈值只看调参集，对外报的数只来自留出集；每个数字都必须连分母一起报——一个没说清分母的
召回率不是测量结果。

[ARES](https://aclanthology.org/2024.naacl-long.20/) 和
[RAGChecker](https://arxiv.org/abs/2408.08067) 把 RAG 质量拆成可分别测量的分量，而不是一个总分。
OwnMem 对一个小到“一个混合数字会把所有值得知道的事都盖住”的语料，采用同样的拆法。

## 5. 记忆投毒是一等威胁

[AgentPoison](https://proceedings.neurips.cc/paper_files/paper/2024/hash/eb113910e9c3f6242541c1652e30dfd6-Abstract-Conference.html)
与 [PoisonedRAG](https://www.usenix.org/conference/usenixsecurity25/presentation/zou-poisonedrag)
都表明：少量对抗性知识就足以操纵 agent 或 RAG，而常规质量指标看上去一切正常。所以“被检索到”
本身不能构成信任信号。

外部文本不能自授 authority。内容漂移、收据被篡改、证据目标消失，都会隔离该条目并阻断注入。
若目标仍在、只是符号切片变了，则走更弱的 evidence-drift 判定、降为 advisory——否则每一次重构都会
被当成攻击。

这套防御不靠“让同一个语言模型再读一遍候选、然后宣布它安全”，而是靠哈希、schema、证据解析器、
生命周期图和动作风险规则；最根本的一条是：没有人提交，任何文本都进不了记忆。

## 6. 不可变快照与可复现召回

OwnMem 把 Markdown、L1/L2/L3 图关系、信任状态、排序身份和来源编译成内容寻址快照。正文摘录取自
编译时的字节，而不是查询时再去读会变的文件——同一个查询打在同一个快照上，答案逐字节相同。
源或排序身份变化会触发重建，上一份通过校验的快照仍然保留为可回退点。

它与内容寻址构建系统的“输入可复现、依赖成图”原则同源，也与 [MemGPT](https://arxiv.org/abs/2310.08560)
的上下文管理目标有交集；区别在于 OwnMem 治理的是仓库知识的校验状态与交付权限，而不是给一段
无界对话做分页。

默认召回不调用任何模型，查询期零网络。可选的 embedding 通道以 observe 模式、权重 0 起步，
只有在本机 A/B 证据过安全门之后才能进入加权排序。

## 7. 三本账，防止指标互相冒充

“返回了一条结果”“正文被完整打开”“agent 说它有用”“人真的采纳了”——OwnMem 不把这四件事
并成一个成功率：

1. 检索反馈只回答召回返回得对不对；
2. outcome 收据只记用户或可信宿主明确确认过的结局；
3. 自归因是 agent 自报的弱标签，只报计数，永远不算采用率。

`completed → delivered → consumed` 是一条交付漏斗，而确认结局是另一张测量面、另一个分母。
数据缺失就显示“暂无”，绝不渲染成 0 或推算出来的准确率。一条 topic 被打开只证明它被读过，
不证明它被用过；报告拒绝让前者顶替后者。

中间那一档是量过的，不是拍的。「指针没人开，是因为它们本来就是噪声，还是因为它们被忽略了」——这两种病的药完全相反，所以每一条指针都被逐个标注，语料与真实回执两边都测。结论是精确度**完全取决于这个问题到底有没有答案**：有答案时，指针集合几乎总是装着它；没有答案时，每一条指针按定义都是噪声，而后者是更大的那一群。在单条指针这个粒度上没有任何特征能把两者分开——最好的一个 AUC 0.66，而决定「要不要引用」那道门是 0.89——代价曲线上也没有拐点，给指针设门销毁掉的正确答案会多于拦下的噪声。所以这一档原样保留、把结论记下来，这本来就是评测该被允许得出的结果之一。

所以摆在最前面的数字不是上面任何一个，而是**已知误交付残留率**：凡是被记过一条「交付错了」回执的
查询，现在还有多少仍以正文作答。分子分母都是别人早就记下来的事实，下一次读数不需要任何人再做新的
事，而它只会因为检索真的变好才下降。一个记忆系统最想公布的那个数——它的答案到底有多少次真被采纳——
被如实标成长期无法测量，而不是拿别的数近似：只有用户或可信宿主才能确认一次结局，而用户评价的是
交付物，不是哪条记忆被注入，所以那个分子不是在等一个更低的确认门槛。唯一能产出它的面是宿主确认：
门禁或测试证实了这条记忆自己的断言。

## 8. 有界增长，但不靠自动化

记忆系统死于堆积，通常远早于死于检索。写一条格式合规的条目成本为零，所以一个有质量门、却没有
流量门的语料会一直长到路由失效、没人再信任索引为止。

OwnMem 的答案是给活跃语料一个只降不升的条目数硬上限。语料超限时 `ownmem audit` 直接失败——
往一个已经满了的语料里加一条，就意味着同一次改动里要退役一条。旁边不再有字节上限。那条上限每次
快要拦住东西时就被抬到刚好等于现状，从来没真正拒绝过什么，只是在每条新记忆前面加了一道写理由的
手续。

被刻意省掉的是自动化。这里没有协调器、没有晋升、没有候选队列，也没有任何形式的无人值守写入；
这个包只负责度量和提议，提交由人来做。MCP server 之所以只暴露两个只读工具，用的也是同一条边界。
[Reflexion](https://papers.neurips.cc/paper_files/paper/2023/hash/1b44b878bb782e6954cd888628510e90-Abstract-Conference.html)
所代表的长程自我改进是一种野心；OwnMem 保留经验账本，但刻意停在“不自己据此行动”这一步——
一条错误的长期记忆，代价由此后每一个会话分摊，而“把这个决定交给自动化”所需的证据目前并不存在。

## 参考文献

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
