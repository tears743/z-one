# Antigravity 接入 Z-One 可行性分析

## 我是什么

我（Antigravity）是一个 **VS Code IDE 扩展**中的 AI 编程助手，核心特点：

| 特征 | 现状 |
|------|------|
| 运行环境 | VS Code 扩展进程内 |
| 通信方式 | IDE 聊天面板（UI 交互）|
| MCP 角色 | **Client**（我连接 MCP Server，不是反过来）|
| 外部 API | ❌ 没有 HTTP/WebSocket/CLI 端点 |
| 文件系统 | ✅ 可读写工作区文件 |
| 命令执行 | ✅ 可执行终端命令（需用户批准）|
| 工具调用 | 内部 tool calls，外部不可调用 |

## 可行的接入方案评估

### 方案 1: 共享工作区文件协议 ⚠️ 半可行

```
Z-One Agent → 写入任务文件到工作区
    ↓
workspace/.antigravity/tasks/task_001.md
    ↓
用户在 IDE 中 @mention 文件让我执行
    ↓
我执行后写入结果到 workspace/.antigravity/results/task_001_result.md
    ↓
Z-One Agent 监听文件变化 → 读取结果
```

**问题**：需要用户手动触发我执行，不能全自动。Z-One 无法主动让我开始工作。

---

### 方案 2: MCP Server（Z-One 暴露工具给我）⚠️ 方向相反

Z-One 已经有 [desktop-mcp.ts](file:///Users/tj/workspace/z-one/src/main/execution/servers/desktop-mcp.ts)，可以作为 MCP Server。我可以连接它并使用 Z-One 的工具。

**但这是反方向的**：是我使用 Z-One 的工具，不是 Z-One 使用我。

---

### 方案 3: VS Code Extension API 自动化 ⚠️ 脆弱

```
Z-One → 通过 child_process 执行 VS Code CLI
     → code --command "antigravity.sendMessage" "请写一个爬虫"
     → 或通过 AppleScript/osascript 模拟 IDE 操作
```

**问题**：
- VS Code 扩展通常不暴露外部可调用的 command
- AppleScript 方式极其脆弱，依赖 UI 布局
- 没有可靠的方式获取我的执行结果

---

### 方案 4: ✅ 最可行 — 在 Z-One 中原生复刻 Antigravity 能力

**核心认知**：我（Antigravity）的本质是：
```
底层 LLM API + 精心设计的 System Prompt + 一组 Tools（文件/命令/搜索/图片）
```

Z-One **已经拥有**这些构件：
- ✅ [LLMService](file:///Users/tj/workspace/z-one/src/main/model/llm-service.ts#250-272) — 可以调用相同的底层 LLM API
- ✅ [ToolRegistry](file:///Users/tj/workspace/z-one/src/main/execution/tool-registry.ts#19-90) — 已有文件操作、命令执行、浏览器等工具
- ✅ [Agent](file:///Users/tj/workspace/z-one/src/main/agent/agent.ts#8-609) — 已有 ReAct 循环（reason → tool_call → observe）

**所以 Z-One 不需要"调用我"，而是可以创建一个具备同等能力的 CodingAgent：**

```typescript
const codingAgent = agentFactory.createCustomAgent(
  "CodingAssistant",
  CODING_ASSISTANT_SYSTEM_PROMPT,  // 模拟 Antigravity 的 system prompt
  ["read_file", "write_file", "run_command", "list_dir", "web_search"],
  allToolDefs,
  projectContext,  // 当前项目的上下文
  modelConfig,     // 使用相同或更好的模型
);
```

### 方案 4 的关键实现

```
┌─────────────────────────────────────────┐
│            Z-One Workflow               │
│                                         │
│  Node: "编写爬虫代码"                    │
│    ↓                                    │
│  创建 CodingAgent:                      │
│    - System Prompt: 编程专家角色          │
│    - Tools: read_file, write_file,      │
│             run_command, list_dir,       │
│             web_search                   │
│    - Context: 项目文件结构 + 需求描述     │
│    ↓                                    │
│  Agent ReAct Loop:                      │
│    1. 分析需求 → 设计方案               │
│    2. write_file → 创建代码文件         │
│    3. run_command → 运行测试            │
│    4. 如果测试失败 → read_file 看错误   │
│    5. write_file → 修复代码             │
│    6. 循环直到测试通过                   │
│    ↓                                    │
│  输出: 代码文件路径 + 测试结果           │
└─────────────────────────────────────────┘
```

**需要补充的 System Prompt（模拟我的能力）：**

```
你是一个高级 AI 编程助手。你的工作方式：
1. 先理解需求，必要时询问
2. 分析项目结构（list_dir + read_file）
3. 设计代码架构
4. 逐文件编写代码（write_file）
5. 运行测试验证（run_command）
6. 如果失败，读取错误输出，修改代码，重新测试
7. 循环直到通过

你可以使用的工具：
- read_file: 读取项目文件
- write_file: 创建/修改代码文件
- run_command: 执行 shell 命令（安装依赖、运行测试等）
- list_dir: 查看项目目录结构
- web_search: 搜索技术文档和解决方案
```

## 结论

| 方案 | 可行性 | 自动化 | 推荐 |
|------|--------|--------|------|
| 1. 文件协议 | ⚠️ 半可行 | ❌ 需人工触发 | 不推荐 |
| 2. MCP Server | ⚠️ 方向反 | ❌ | 不推荐 |
| 3. Extension API | ⚠️ 脆弱 | ⚠️ 不可靠 | 不推荐 |
| **4. 原生复刻** | **✅ 完全可行** | **✅ 全自动** | **✅ 推荐** |

**方案 4 的优势**：
- 不依赖外部进程或 IDE
- 使用 Z-One 已有的 LLM + Agent + Tool 基础设施
- 可以在工作流的任何节点部署
- 完全自动化，无需人工介入
- 可以使用和 Antigravity 相同的底层模型

**唯一需要新增的**：一套专门为编程任务优化的 System Prompt + 项目上下文收集逻辑。
