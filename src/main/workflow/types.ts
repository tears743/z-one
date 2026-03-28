/**
 * Workflow Engine — Data Models
 *
 * Core types for the DAG-based workflow engine.
 * Each workflow is a directed acyclic graph of nodes connected by edges.
 * Nodes can be: task (agent execution), condition (branching), loop (iteration), gateway (parallel/join).
 */

// ─── Node Types ─────────────────────────────────────────────

export type WorkflowNodeType = 'task' | 'condition' | 'loop' | 'gateway';
export type WorkflowStatus = 'draft' | 'active' | 'paused' | 'completed' | 'failed' | 'archived';
export type NodeRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'paused' | 'waiting_input';
export type RunStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type GatewayMode = 'parallel' | 'join' | 'race';

// ─── Agent Config for Task Nodes ────────────────────────────

/**
 * SubAgentConfig: organized prompt/tools for each task node's agent.
 * Designed to support future conversation injection into sub-agent contexts.
 */
export interface SubAgentConfig {
  /** Agent display name (e.g. "Price Monitor", "Data Analyst") */
  name: string;
  /** Agent persona / system prompt describing their role */
  persona: string;
  /** List of tool names this agent is allowed to use */
  tools: string[];
  /** Optional model config override (model ID, temperature, etc.) */
  modelConfig?: Record<string, any>;
  /** Conversation history injected into this agent's context */
  injectedMessages?: AgentContextMessage[];
}

/** A message that can be injected into a sub-agent's conversation context */
export interface AgentContextMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp: number;
  source?: string; // who injected it: 'user', 'workflow', 'cli', etc.
}

// ─── Workflow Node ──────────────────────────────────────────

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  label: string;
  description?: string;

  // Position for visualization (x, y in the flow graph)
  position: { x: number; y: number };

  // ── Type-specific config ──

  /** For 'task' nodes: agent configuration */
  agentConfig?: SubAgentConfig;

  /** For 'condition' nodes: JS expression evaluated against workflow context */
  condition?: string;

  /** For 'loop' nodes: max iterations + exit condition */
  loopConfig?: {
    maxIterations: number;
    exitCondition?: string; // JS expression, break if true
  };

  /** For 'gateway' nodes: parallel/join/race mode */
  gatewayMode?: GatewayMode;

  /** Timeout in ms (0 = no timeout) */
  timeout?: number;

  /** Retry config */
  retryConfig?: {
    maxRetries: number;
    retryDelayMs: number;
  };
}

// ─── Workflow Edge ──────────────────────────────────────────

export interface WorkflowEdge {
  id: string;
  source: string; // node ID
  target: string; // node ID
  /** Optional condition label (for condition node branches, e.g. "true" / "false") */
  conditionLabel?: string;
}

// ─── Workflow Definition ────────────────────────────────────

export interface WorkflowDefinition {
  id: string;
  name: string;
  description?: string;
  version: number;
  status: WorkflowStatus;

  nodes: WorkflowNode[];
  edges: WorkflowEdge[];

  /** Device that created this workflow */
  sourceDeviceId?: string;
  /** Session where this workflow was created */
  sourceSessionId?: string;

  createdAt: number;
  updatedAt: number;
}

// ─── Workflow Version (for version history) ─────────────────

export interface WorkflowVersion {
  id: string;
  workflowId: string;
  version: number;
  /** Snapshot of the workflow definition at this version */
  snapshot: string; // JSON-serialized WorkflowDefinition
  changelog?: string;
  createdAt: number;
}

// ─── Runtime: Node Run ──────────────────────────────────────

export interface NodeRun {
  id: string;
  runId: string;
  nodeId: string;
  status: NodeRunStatus;

  /** Iteration count (for loop nodes) */
  iteration: number;

  /** Start/end timestamps */
  startedAt?: number;
  completedAt?: number;

  /** Agent output / result */
  output?: string;
  error?: string;

  /** Execution logs (agent thoughts, tool calls, etc.) */
  logs: string[];

  /** Message queue: messages injected by users/other nodes, delivered on next iteration */
  messageQueue: AgentContextMessage[];

  /** The sub-agent's conversation history snapshot (for resuming/reviewing) */
  agentHistory?: string; // JSON-serialized AgentMessage[]
}

// ─── Runtime: Workflow Run ──────────────────────────────────

export interface WorkflowRun {
  id: string;
  workflowId: string;
  status: RunStatus;

  /** Workflow context: shared key-value store accessible by all nodes */
  context: Record<string, any>;

  /** Per-node runtime states */
  nodeStates: Record<string, NodeRun>;

  /** Which version of the workflow is being executed */
  workflowVersion: number;

  startedAt: number;
  completedAt?: number;

  /** Source device/session to push results back to */
  sourceDeviceId?: string;
  sourceSessionId?: string;
}

// ─── Events (for real-time UI updates) ──────────────────────

export type WorkflowEventType =
  | 'run:started'
  | 'run:completed'
  | 'run:failed'
  | 'run:paused'
  | 'node:started'
  | 'node:completed'
  | 'node:failed'
  | 'node:log'
  | 'node:waiting_input'
  | 'node:message_injected'
  | 'context:updated';

export interface WorkflowEvent {
  type: WorkflowEventType;
  runId: string;
  nodeId?: string;
  data?: any;
  timestamp: number;
}
