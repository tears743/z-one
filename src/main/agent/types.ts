
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ModelConfig } from "../../renderer/src/types/settings";

export interface AgentConfig {
  id: string;
  name: string;
  role: string; // 'input' | 'planner' | 'executor' | 'critic'
  description: string;
  modelConfig: ModelConfig;
  systemPrompt: string;
  tools: string[]; // Tool names available to this agent
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
}
