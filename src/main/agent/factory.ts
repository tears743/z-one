
import { randomUUID } from 'crypto';
import { AgentConfig } from './types';
import { Agent } from './agent';
import { LLMService } from '../model/llm-service';
import { McpHub } from '../control/mcp-hub';
import { getAppSettings } from '../db';
import {
  generateExecutorAgentSystemPrompt,
  generateInputAgentSystemPrompt,
  generateOutputAgentSystemPrompt,
} from '../prompts/agent';

export class AgentFactory {
  private llmService: LLMService;
  private mcpHub: McpHub;

  constructor(llmService: LLMService, mcpHub: McpHub) {
    this.llmService = llmService;
    this.mcpHub = mcpHub;
  }

  public createAgent(config: Omit<AgentConfig, 'id' | 'modelConfig'> & { modelConfig?: any }): Agent {
    const settings = getAppSettings();
    
    // Default model config if not provided
    const modelConfig = config.modelConfig || {
      modelId: settings.models.defaultChatModel,
      provider: 'openai', // Should resolve from DB model
      apiKey: '', // Should resolve from DB
      baseUrl: ''
    };
    
    // TODO: Resolve full model config from DB based on modelId

    const fullConfig: AgentConfig = {
      id: randomUUID(),
      ...config,
      modelConfig
    };

    return new Agent(fullConfig, this.llmService, this.mcpHub);
  }

  public createInputAgent(deviceId: string): Agent {
    return this.createAgent({
      name: `InputAgent-${deviceId}`,
      role: 'input',
      description: `Handles raw input from device ${deviceId}`,
      systemPrompt: generateInputAgentSystemPrompt(deviceId),
      tools: [] // Input agents might not need tools, or maybe just 'forward_request'
    });
  }

  public createExecutorAgent(taskDescription: string, tools: string[]): Agent {
    return this.createAgent({
      name: `Executor-${randomUUID().slice(0, 8)}`,
      role: 'executor',
      description: `Executes specific task: ${taskDescription}`,
      systemPrompt: generateExecutorAgentSystemPrompt(taskDescription, tools),
      tools: tools
    });
  }

  public createOutputAgent(targetDeviceId: string): Agent {
    return this.createAgent({
      name: `OutputAgent-${targetDeviceId}`,
      role: 'output',
      description: `Handles output generation for device ${targetDeviceId}`,
      systemPrompt: generateOutputAgentSystemPrompt(targetDeviceId),
      tools: []
    });
  }
}
