
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ModelConfig } from "../../renderer/src/types/settings";
import type { FileSessionStore } from "../memory/file-store";

export interface AgentConfig {
  id: string;
  name: string;
  role: string; // 'input' | 'planner' | 'executor' | 'critic'
  description: string;
  modelConfig: ModelConfig;
  systemPrompt: string;
  tools: string[]; // Tool names available to this agent
  sessionId?: string; // Session ID for file-based history compression
  fileSessionStore?: FileSessionStore; // Optional file store for persisting compressed history
}

export interface AgentState {
  id: string;
  status: 'idle' | 'thinking' | 'acting' | 'completed' | 'failed';
  memory: any[]; // Working memory for this agent
  currentTask?: string;
}

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> | null;
  name?: string; // For tool outputs or multi-agent chat
  tool_calls?: any[];
  tool_call_id?: string;
  reasoning_content?: string; // For thinking/reasoning models (e.g. kimi-k2.5)
}
