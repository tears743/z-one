import { randomUUID } from "crypto";
import { AgentConfig } from "./types";
import { Agent } from "./agent";
import { LLMService } from "../model/llm-service";
import { ToolRegistry } from "../execution/tool-registry";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { getAppSettings } from "../db";
import { buildAgentSystemPrompt, SystemPromptParams } from "../prompts/builder";

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

  public createInputAgent(deviceId: string, memoryContext?: string): Agent {
    const prompt = buildAgentSystemPrompt({
      role: "input",
      name: `InputAgent-${deviceId}`,
      mode: "input", // Use input mode to include memory and specific instructions
      tools: [], // No tools for input agent
      memoryContext,
      userInstructions: `You are an advanced Intent Analysis Agent. 
Your SOLE purpose is to analyze the user's raw input and transform it into a clear, detailed technical Task Description for the execution team.

RULES:
1. Do NOT reply to the user directly. You are an internal system component.
2. Do NOT use any tools. You have no tools available.
3. Output ONLY the refined task description.
4. If the user's request implies a complex task (coding, file manipulation, research), describe the task in detail.
5. If the user's request is a simple greeting or question, describe it as "User is asking/greeting: ...".
6. If the user refers to context (like "fix this"), use the provided Memory/Context to interpret "this".
7. NEVER apologize or explain your limitations. Just describe the task.

Example Input: "Fix the bug in main.ts"
Example Output: "Analyze main.ts for errors and apply fixes to resolve the reported bug."

Example Input: "Hello"
Example Output: "User is greeting the system."
`,
    });

    return this.createAgent({
      name: `InputAgent-${deviceId}`,
      role: "input",
      description: `Handles raw input from device ${deviceId}`,
      systemPrompt: prompt,
      tools: [], // Explicitly no tools
    });
  }

  public createExecutorAgent(
    taskDescription: string,
    tools: Tool[],
    memoryContext?: string,
  ): Agent {
    const prompt = buildAgentSystemPrompt({
      role: "executor",
      name: `Executor-${randomUUID().slice(0, 8)}`,
      mode: "full",
      tools: tools,
      memoryContext,
      userInstructions: `Execute the following task:\n${taskDescription}`,
    });

    return this.createAgent({
      name: `Executor-${randomUUID().slice(0, 8)}`,
      role: "executor",
      description: `Executes specific task: ${taskDescription}`,
      systemPrompt: prompt,
      tools: tools.map((t) => t.name),
    });
  }

  public createOutputAgent(
    targetDeviceId: string,
    memoryContext?: string,
  ): Agent {
    const prompt = buildAgentSystemPrompt({
      role: "output",
      name: `OutputAgent-${targetDeviceId}`,
      mode: "minimal",
      memoryContext,
      userInstructions: `Generate user-facing response for device ${targetDeviceId}. Be concise and helpful.`,
    });

    return this.createAgent({
      name: `OutputAgent-${targetDeviceId}`,
      role: "output",
      description: `Handles output generation for device ${targetDeviceId}`,
      systemPrompt: prompt,
      tools: [],
    });
  }

  public createCustomAgent(
    roleName: string,
    persona: string,
    tools: string[],
    allAvailableTools?: Tool[],
    memoryContext?: string,
    modelConfig?: any,
  ): Agent {
    const toolDefs = allAvailableTools
      ? allAvailableTools.filter((t) => tools.includes(t.name))
      : [];

    if (allAvailableTools) {
      const missingTools = tools.filter(
        (t) => !allAvailableTools.find((at) => at.name === t),
      );
      if (missingTools.length > 0) {
        console.warn(
          `[AgentFactory] Requested tools not found for agent ${roleName}: ${missingTools.join(", ")}`,
        );
      }
    }

    // Determine if we should use legacy tooling (JSON) based on model config
    // If enableThinking is true (Reasoning Model), use legacy tooling
    const useLegacyTooling = modelConfig?.enableThinking || false;

    const prompt = buildAgentSystemPrompt({
      role: "teammate",
      name: roleName,
      mode: "full",
      tools: toolDefs,
      memoryContext,
      userInstructions: `${persona}\n\n**Team Protocol:**\n- You are part of an elite AI squad.\n- Focus strictly on your domain.\n- Use tools effectively.\n- Report results clearly.`,
      useLegacyTooling,
    });

    return this.createAgent({
      name: roleName,
      role: "executor",
      description: persona.substring(0, 100) + "...",
      systemPrompt: prompt,
      tools: tools,
      modelConfig, // Pass the model config to the agent
    });
  }
}
