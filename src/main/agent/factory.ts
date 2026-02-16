import { randomUUID } from "crypto";
import { AgentConfig } from "./types";
import { Agent } from "./agent";
import { LLMService } from "../model/llm-service";
import { ToolRegistry } from "../execution/tool-registry";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { getAppSettings } from "../db";
import {
  generateExecutorAgentSystemPrompt,
  generateInputAgentSystemPrompt,
  generateOutputAgentSystemPrompt,
} from "../prompts/agent";

export class AgentFactory {
  private llmService: LLMService;
  private toolRegistry: ToolRegistry;

  constructor(llmService: LLMService, toolRegistry: ToolRegistry) {
    this.llmService = llmService;
    this.toolRegistry = toolRegistry;
  }

  public createAgent(
    config: Omit<AgentConfig, "id" | "modelConfig"> & { modelConfig?: any },
  ): Agent {
    const settings = getAppSettings();

    // Default model config if not provided
    const modelConfig = config.modelConfig || {
      modelId: settings?.activeModelId || "default",
      provider: "openai", // Should resolve from DB model
      apiKey: "", // Should resolve from DB
      baseUrl: "",
    };

    // TODO: Resolve full model config from DB based on modelId

    const fullConfig: AgentConfig = {
      id: randomUUID(),
      ...config,
      modelConfig,
    };

    return new Agent(fullConfig, this.llmService, this.toolRegistry);
  }

  public createInputAgent(deviceId: string): Agent {
    return this.createAgent({
      name: `InputAgent-${deviceId}`,
      role: "input",
      description: `Handles raw input from device ${deviceId}`,
      systemPrompt: generateInputAgentSystemPrompt(deviceId),
      tools: [], // Input agents might not need tools, or maybe just 'forward_request'
    });
  }

  public createExecutorAgent(taskDescription: string, tools: string[]): Agent {
    return this.createAgent({
      name: `Executor-${randomUUID().slice(0, 8)}`,
      role: "executor",
      description: `Executes specific task: ${taskDescription}`,
      systemPrompt: generateExecutorAgentSystemPrompt(taskDescription, tools),
      tools: tools,
    });
  }

  public createOutputAgent(targetDeviceId: string): Agent {
    return this.createAgent({
      name: `OutputAgent-${targetDeviceId}`,
      role: "output",
      description: `Handles output generation for device ${targetDeviceId}`,
      systemPrompt: generateOutputAgentSystemPrompt(targetDeviceId),
      tools: [],
    });
  }

  public createCustomAgent(
    roleName: string,
    persona: string,
    tools: string[],
    allAvailableTools?: Tool[],
  ): Agent {
    const toolDefs = allAvailableTools
      ? allAvailableTools.filter((t) => tools.includes(t.name))
      : [];

    const toolSection =
      toolDefs.length > 0
        ? `\n\n## Available Tools\nYou have access to the following tools:\n${toolDefs
            .map(
              (t) =>
                `- **${t.name}**: ${t.description}\n  Schema: ${JSON.stringify(t.inputSchema)}`,
            )
            .join("\n")}\n\nUse them when necessary.`
        : "";

    return this.createAgent({
      name: `${roleName}`, // Cleaner name for display
      role: "executor", // Or maybe 'teammate'
      description: persona.substring(0, 100) + "...",
      systemPrompt: `You are ${roleName}.\n\n${persona}\n\n**Team Protocol:**\n- You are part of an elite AI squad.\n- Focus strictly on your domain.\n- Use tools effectively.\n- Report results clearly.${toolSection}`,
      tools: tools,
    });
  }
}
