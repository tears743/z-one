# Z-One 高级工作流引擎 (Advanced Workflow Engine)

## 背景

当前 Z-One 的 TeamOrchestrator 只支持线性顺序执行。本方案设计一个支持循环、条件分支、长时后台任务、人在回路交互、隐私保护的完整工作流引擎。

---

## 一、对话式创建 + 自我迭代优化

工作流通过对话创建，Planner 在执行后自省并持续优化：

```
用户描述需求 → Planner 追问确认 → 生成 v1
    → 执行 → 反馈 → Planner 自省 → 修改 v2
    → 用户随时追加需求 → 生成 v3 ...
```

#### [NEW] `src/main/workflow/planner.ts`

```typescript
class WorkflowPlanner {
  planOrRefine(request, history, existingWorkflow?, feedback?)
    → { needsClarification, workflow?, version }

  reflectAndRefine(workflow, run)  // 执行后自省优化
    → { shouldRefine, refinedWorkflow?, reasoning }
}
```

版本管理：`workflow_versions` 表记录每次变更。

---

## 二、设备隐私保险箱 (Privacy Vault)

每设备独立加密文件夹，访问需安全问答验证，一次性授权（当前迭代有效）。

#### [NEW] `src/main/workflow/privacy-vault.ts`

- **存储**: AES-256-GCM 加密数据，SHA-256+salt 存答案哈希
- **验证**: Agent 请求 → 发问到设备 → 用户答对 → 授权一轮迭代
- **工具**: `read_private_data` / `store_private_data` NativeTool

---

## 三、数据模型

#### [NEW] `src/main/workflow/types.ts`

| 类型 | 说明 |
|------|------|
| `WorkflowDefinition` | DAG 图定义（nodes + edges + 版本 + sourceDevice/Session）|
| `WorkflowNode` | 4 种：`task` / `condition` / `loop` / `gateway` |
| `WorkflowRun` | 运行实例（status + context + nodeStates）|
| `NodeRun` | 节点状态 + 日志 + messageQueue |

---

## 四、执行引擎

#### [NEW] `src/main/workflow/engine.ts`

- DAG 拓扑排序 → 依赖驱动执行
- 循环/条件分支/网关逻辑
- 消息注入：pending 节点追加上下文，running 节点下轮迭代读取
- 完成后推送到 `sourceDeviceId` 的 `sourceSessionId`

---

## 五、持久化

#### [NEW] `src/main/workflow/store.ts`

新增 6 张 SQLite 表：`workflows`, `workflow_versions`, `workflow_runs`, `node_runs`, `privacy_vault`, `privacy_access_log`

---

## 六、CLI 集成

> [!IMPORTANT]
> CLI 是工作流引擎的重要交互和测试通道。

### 当前状态
[cli.ts](file:///Users/tj/workspace/z-one/src/main/cli.ts) 已有 REPL + 单命令模式，但作为**独立 Electron 进程**运行，与 GUI 应用隔离。

### 目标架构

```
┌──── GUI App (Electron) ──────────────────────┐
│  index.ts (main process)                      │
│    ├─ InteractionManager (WebSocket Server)   │
│    ├─ Planner + WorkflowEngine               │
│    └─ CLI Server (IPC/Unix Socket)  ← NEW    │
│         ↑                                     │
└─────────┼─────────────────────────────────────┘
          │ Unix Domain Socket
┌─────────┼──────────┐
│  CLI Client (独立进程) │
│  z-one "message"    │
│  z-one workflow ls  │
│  z-one workflow run │
└─────────────────────┘
```

### 互启机制

| 场景 | 行为 |
|------|------|
| GUI 启动 → CLI 可用 | GUI 启动时开启 Unix Socket Server，CLI 连接即可 |
| CLI 启动 → GUI 未运行 | CLI 检测 Socket 不存在 → 启动 GUI App（headless 或后台）→ 等待 Socket ready |
| 两者共享 | 同一个 DB + Planner + WorkflowEngine 实例 |

### 工作流 CLI 命令

#### [MODIFY] [src/main/cli.ts](file:///Users/tj/workspace/z-one/src/main/cli.ts)

```bash
# 对话（已有）
z-one "帮我监控竞品价格"

# 工作流管理（新增）
z-one workflow ls                    # 列出所有工作流
z-one workflow status <id>           # 查看工作流状态
z-one workflow start <id>            # 启动工作流
z-one workflow pause <id>            # 暂停
z-one workflow resume <id>           # 恢复
z-one workflow inject <id> <nodeId> "message"  # 注入消息
z-one workflow logs <id> <nodeId>    # 查看节点日志
z-one workflow delete <id>           # 删除

# JSON 输出（用于自动化测试）
z-one --json workflow ls
z-one --json workflow status <id>
```

#### [NEW] `src/main/cli-server.ts`

- GUI 应用内嵌的 Unix Socket Server
- 接受 CLI Client 的 JSON-RPC 请求
- 转发到 Planner / WorkflowEngine

#### [MODIFY] [src/main/index.ts](file:///Users/tj/workspace/z-one/src/main/index.ts)

- 应用启动时同时启动 CLI Server
- Socket 路径: `/tmp/z-one-cli.sock`

### 测试验证方式

```bash
# 1. 通过 CLI 创建工作流
z-one --json "帮我每小时检查某网页价格"
# → 返回 { workflowId: "xxx" }

# 2. 查看状态
z-one --json workflow status xxx
# → 返回节点状态 JSON

# 3. 截图 GUI 验证流程图显示正确
# 4. 注入消息
z-one workflow inject xxx node_2 "增加竞品B"

# 5. 查看日志
z-one workflow logs xxx node_2
```

---

## 七、前端 UI

### 侧栏入口 → 列表页 → 详情页（React Flow 流程图）

- **列表页**: 名称、状态、进度、版本号
- **详情页**: DAG 可视化 + 节点状态着色 + 底部面板（日志/消息注入）
- **依赖**: `@xyflow/react`

---

## 八、IPC 通信

#### [MODIFY] [src/main/index.ts](file:///Users/tj/workspace/z-one/src/main/index.ts) + [src/preload/index.ts](file:///Users/tj/workspace/z-one/src/preload/index.ts)

```
workflow:create / list / get / delete
workflow:start / pause / resume
workflow:injectMessage / getNodeLogs
workflow:stateUpdate (实时推送)
```

---

## 九、分阶段实施

### Phase 1: 核心后端
- `workflow/types.ts`
- `workflow/store.ts`
- `workflow/engine.ts`
- `workflow/planner.ts`

### Phase 2: 隐私保险箱
- `workflow/privacy-vault.ts`
- 注册 NativeTool

### Phase 3: 集成 + CLI
- 修改 [triage.ts](file:///Users/tj/workspace/z-one/src/main/intelligence/triage.ts) — 新增 workflow mode
- 修改 [planner.ts](file:///Users/tj/workspace/z-one/src/main/prompts/planner.ts) — workflow 分支
- `cli-server.ts` — Unix Socket Server
- 修改 [cli.ts](file:///Users/tj/workspace/z-one/src/main/cli.ts) — workflow 子命令
- 修改 [index.ts](file:///Users/tj/workspace/z-one/src/main/index.ts) — 启动 CLI Server + IPC handlers

### Phase 4: 前端 UI
- `WorkflowListPage.tsx`
- `WorkflowDetailPage.tsx` + React Flow
- `NodeDetailPanel.tsx`
- 修改 [Sidebar.tsx](file:///Users/tj/workspace/z-one/src/renderer/src/components/Sidebar.tsx) + [App.tsx](file:///Users/tj/workspace/z-one/src/renderer/src/App.tsx)

### Phase 5: 打磨
- 版本回退 UI
- 节点状态动画
- CLI ↔ GUI 互启
- 端到端集成测试（CLI + 截图交叉验证）

---

## 十、验证计划

| 场景 | CLI 验证 | GUI 验证 |
|------|----------|----------|
| 创建工作流 | `z-one --json "任务描述"` → 返回 workflowId | 侧栏出现新工作流 |
| 查看状态 | `z-one --json workflow status <id>` | 流程图节点着色 |
| 消息注入 | `z-one workflow inject <id> <node> "msg"` | 节点面板显示消息 |
| 节点日志 | `z-one workflow logs <id> <node>` | 底部面板日志内容 |
| 自省优化 | 节点失败后 `workflow status` 看到版本升级 | 流程图结构变化 |
