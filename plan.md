# z-one 架构演进计划 (Architecture Evolution Plan)

本计划旨在将 `z-one` 升级为支持 **Agent Teams** 协作、拥有 **三层工具体系** (Tools/Skills/MCP) 并具备 **健壮内存与实时交互** 能力的下一代智能 IDE 助手。

## 1. Agent Teams (团队协作架构)

基于 [Claude Code Agent Teams](https://code.claude.com/docs/zh-CN/agent-teams) 理念，从单体 Agent 转向多 Agent 协作。

### 1.1 核心组件

- **TeamManager (Leader)**:
  - **职责**: 组建团队、拆解任务、分发工单、同步状态。
  - **逻辑**: 接收用户 Prompt -> 生成 Plan -> 创建/唤醒特定角色的 Agent -> 监控进度 -> 汇总结果。
- **Teammates (Members)**:
  - **独立性**: 每个 Agent 拥有独立的 Context Window 和 System Prompt。
  - **动态角色 (Dynamic Roles)**: 角色不再硬编码，而是由 Manager 根据任务需求动态定义或从配置中加载。
  - **Manager Prompt Framework**: 为 TeamManager 设计一套 System Prompt 框架，使其具备以下能力：
    - **Role Definition**: 动态定义所需角色的名称、职责和工具权限 (e.g., "你需要一个 SQL Expert 来优化查询")。
    - **Task Assignment**: 将大任务拆解并精准分发给对应角色。
    - **Orchestration**: 监控进度，协调角色间的依赖关系。
- **Shared Board (通信与共享)**:
  - 建立共享黑板（Shared Context），存放 Project Info、Global Plan 和 Key Findings。
  - 支持 Agent 间直接通信 (`sendMessage`)。

## 2. 三层工具体系 (Tri-Hybrid Capabilities)

改造现有的纯 MCP 模式，建立更灵活的能力分层。

### 2.1 Native Tools (本地/内核工具)

- **定义**: 内置于 `z-one` 核心的高频、高性能工具。
- **范围**: 文件读写 (Read/Write)、文件搜索 (Grep/Glob)、系统命令 (RunCommand)、AST 分析等。
- **优势**: 无需 MCP 协议开销，直接在进程内调用，响应极快。

### 2.2 Skills (技能/经验)

- **定义**: 基于 [Claude Code Skills](https://code.claude.com/docs/en/skills) 标准的轻量级能力扩展。
- **实现**:
  - 支持读取 `.claude/skills/` 或项目内 `SKILL.md` 文件。
  - **Prompt-based**: 本质是预定义的 Prompt 模板和流程（如 "Explain Code", "Generate Test"）。
  - **动态注入**: 在 Runtime 动态注入到 Agent 的 System Prompt 或 Tool Definition 中。
- **用途**: 用户自定义的工作流、团队规范、特定领域的最佳实践。

### 2.3 MCP (扩展生态)

- **定义**: Model Context Protocol，作为**用户可扩展配置**的插件体系。
- **用途**: 连接外部服务（GitHub, Slack, PostgreSQL）、特定语言服务器或其他第三方工具。
- **配置**: 允许用户在 `settings.json` 中配置自定义的 MCP Server。

## 3. 内存系统修复与增强 (Memory System)

修复当前内存系统的严重 Bug，并实现分层记忆。

### 3.1 缺陷修复 (Bug Fixes)

- **Model History Bug**: 修复 Model 无法正确获取当前聊天历史的问题。
  - _原因分析_: `Agent` 构建 Prompt 时可能未正确包含 `history`，或 Context Window 截断逻辑有误。
  - _行动_: 重写 `Agent.process` 中的 Context 组装逻辑，确保 Short-term Memory (Conversation History) 完整且正确地传递给 LLM。
- **Memory Retrieval**:
  - 在 Agent 思考循环中，增加主动检索 Long-term Memory 的步骤（RAG）。

### 3.2 架构分层

- **Short-term (Session)**: 当前会话的上下文窗口（RAM）。
- **Working (Team)**: Team Shared Board，任务执行期间的临时共享状态。
- **Long-term (Project/User)**: 向量数据库 + 全文检索 (SQLite/FTS)，持久化存储项目知识和用户偏好。

## 4. 实时交互与 UI 修复 (Interaction & UI)

修复流式传输问题，提升用户体验。

### 4.1 流式传输修复 (Streaming Fix)

- **当前问题**: 消息需等待完整生成后才返回，或前端逐字模拟（伪流式）。
- **配置一致性 (Config Consistency)**: 解决 LLM `stream` 标志与数据库 Settings 中配置不一致的问题。确保在 Agent 运行时，正确读取并应用用户的 Stream 偏好，且在代码层面强制对齐 `onChunk` 回调与 Stream 模式。
- **目标**: 实现真正的 Token-level Real-time Streaming。
- **改造路径**:
- `LLMService`: 确保 `onChunk` 回调在收到 LLM 数据包时立即触发。
- `Agent`: 确保 `process` 方法透传 `onChunk`。
- `InteractionManager`: 优化 WebSocket 消息频率，支持 `isChunk` 标志的高频推送。
- `Renderer (Frontend)`: 重写消息渲染逻辑，支持追加式（Append）渲染，而非全量替换。

### 4.2 团队视图 (Team UI)

- **Split View**: 参考 Agent Teams 设计，前端支持分栏显示。
  - **主栏**: Leader 与用户的对话、全局进度。
  - **侧栏/子窗口**: 各个 Teammate 的独立思考过程、工具调用日志和中间输出。
- **状态感知**: 实时显示每个 Agent 的状态 (Thinking, Acting, Waiting)。

## 5. 实施路线图 (Implementation Roadmap)

### Phase 1: 基础修复与内核重构 (Fix & Core)

1.  **Fix Streaming**: 打通 LLM -> Frontend 的流式链路。
2.  **Fix Memory**: 修正 Context 组装逻辑，确保对话历史正常。
3.  **Refactor Tools**: 剥离核心工具为 Native Tools，保留 MCP 接口。

### Phase 2: 团队与技能引擎 (Teams & Skills)

1.  **Impl TeamManager**: 实现基础的团队编排逻辑。
2.  **Impl SkillLoader**: 实现 `SKILL.md` 解析与注入引擎。
3.  **Agent Communication**: 实现 Agent 间的消息总线。

### Phase 3: 体验升级 (UI & Advanced)

1.  **Team UI**: 开发分栏视图和状态面板。
2.  **Memory RAG**: 深度集成向量检索到 Agent 思考流中。
3.  **User Config**: 完善 MCP 和 Skills 的用户配置界面。
