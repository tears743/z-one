/**
 * Shared Workflow Types — Renderer-safe copy
 * Keep in sync with src/main/workflow/types.ts
 */

export type WorkflowNodeType = 'task' | 'condition' | 'loop' | 'gateway';
export type WorkflowStatus = 'draft' | 'active' | 'paused' | 'completed' | 'failed' | 'archived';
export type NodeRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'paused' | 'waiting_input';
export type RunStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export interface SubAgentConfig {
  name: string;
  persona: string;
  tools: string[];
  modelConfig?: Record<string, any>;
  injectedMessages?: { role: 'system' | 'user' | 'assistant'; content: string; timestamp: number; source?: string }[];
}

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  label: string;
  description?: string;
  position: { x: number; y: number };
  agentConfig?: SubAgentConfig;
  condition?: string;
  loopConfig?: { maxIterations: number; exitCondition?: string };
  gatewayMode?: 'parallel' | 'join' | 'race';
  timeout?: number;
  retryConfig?: { maxRetries: number; retryDelayMs: number };
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  conditionLabel?: string;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description?: string;
  version: number;
  status: WorkflowStatus;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  sourceDeviceId?: string;
  sourceSessionId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface NodeRun {
  id: string;
  runId: string;
  nodeId: string;
  status: NodeRunStatus;
  iteration: number;
  startedAt?: number;
  completedAt?: number;
  output?: string;
  error?: string;
  logs: string[];
  messageQueue: any[];
  agentHistory?: string;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  status: RunStatus;
  context: Record<string, any>;
  nodeStates: Record<string, NodeRun>;
  workflowVersion: number;
  startedAt: number;
  completedAt?: number;
  sourceDeviceId?: string;
  sourceSessionId?: string;
}

export type WorkflowEventType =
  | 'run:started' | 'run:completed' | 'run:failed' | 'run:paused'
  | 'node:started' | 'node:completed' | 'node:failed' | 'node:log'
  | 'node:waiting_input' | 'node:message_injected' | 'context:updated';

export interface WorkflowEvent {
  type: WorkflowEventType;
  runId: string;
  nodeId?: string;
  data?: any;
  timestamp: number;
}
