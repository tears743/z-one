import { LLMService } from "../model/llm-service";
import { McpHub } from "../control/mcp-hub";
import { TaskManager } from "../control/manager";
import { Plan } from "../control/types";
import { logger } from "../logger";
import { AgentFactory } from "../agent/factory";
import {
  generateOutputPrompt,
  generatePlannerPrompt,
  PLANNER_SYSTEM_PROMPT,
} from "../prompts/planner";
import { addMemory } from "../memory/manager"; // Import persistence function

export class Planner {
  private llmService: LLMService;
  private mcpHub: McpHub;
  private taskManager: TaskManager;
  private agentFactory: AgentFactory;

  constructor(
    llmService: LLMService,
    mcpHub: McpHub,
    taskManager: TaskManager,
  ) {
    this.llmService = llmService;
    this.mcpHub = mcpHub;
    this.taskManager = taskManager;
    this.agentFactory = new AgentFactory(llmService, mcpHub);
  }

  public async processInput(
    deviceId: string,
    content:
      | string
      | Array<
          | { type: "text"; text: string }
          | { type: "image_url"; image_url: { url: string } }
        >,
    modelConfig: any,
    onStream?: (chunk: string) => void, // Add streaming callback support
  ): Promise<string> {
    // 1. Create Input Agent for this device
    const inputAgent = this.agentFactory.createInputAgent(deviceId);

    // Pass model config to agent (IMPORTANT FIX)
    // Force stream=false for internal processing to avoid async complexity in current flow
    // The Planner needs the full response to proceed.
    const internalConfig = { ...modelConfig, stream: false };
    inputAgent.config.modelConfig = internalConfig;

    // 2. Process raw input to understand intent
    // Note: Logging full content might be too verbose if it contains base64 images
    const logContent =
      typeof content === "string" ? content : "Multimodal content";
    logger.info(`Processing input from ${deviceId}: ${logContent}`);

    // Persist user input to DB (Memory)
    try {
      const textContent =
        typeof content === "string" ? content : "[Multimodal Content]";
      // Ensure content is not empty string
      if (textContent && textContent.trim().length > 0) {
        await addMemory(textContent, "user", "user", ["interaction", deviceId]);
      }
    } catch (e) {
      logger.error("Failed to persist input message", e);
    }

    const refinedIntent = await inputAgent.process(content);
    logger.info(`Refined intent: ${refinedIntent}`);

    // 3. Create Plan based on refined intent
    // Also use non-streaming config for planner
    const plan = await this.createPlanFromGoal(refinedIntent, internalConfig);

    // 4. Execute Plan
    logger.info(`Executing plan for goal: ${plan.goal}`);

    // Notify device about execution start (optional)
    // this.mcpHub.sendToDevice(deviceId, { type: 'status', payload: { status: 'executing', plan: plan.goal } });

    const results = await this.taskManager.executePlan();

    // Send intermediate results back if needed?
    // For now, we rely on the final Output Agent to summarize.

    // Debug execution results
    logger.debug(`Plan execution results: ${JSON.stringify(results)}`);

    // Persist agent execution results to memory (optional but useful for context)
    // Maybe store as a system thought/action log?
    try {
      await addMemory(
        `Executed plan: ${plan.goal}. Results: ${JSON.stringify(results)}`,
        "user",
        "system",
        ["execution", deviceId],
      );
    } catch (e) {
      logger.error("Failed to persist execution results", e);
    }

    // 5. Output Processing (Output Agent)
    // Create Output Agent for the source device (default strategy: reply to sender)
    // Here we can use the original config (if it had stream=true, we could stream output back)
    // But currently InteractionManager expects a Promise<string> return.
    // So we must force stream=false here too unless we change InteractionManager signature.
    const outputAgent = this.agentFactory.createOutputAgent(deviceId);

    // If we support streaming, use the original config (which might have stream=true)
    // and pass the onStream callback.
    // However, if we stream, we might not get the full response back easily for persistence unless we collect it.
    // So we'll use a collector wrapper.
    outputAgent.config.modelConfig = modelConfig;

    const executionSummary = JSON.stringify(results);
    const outputPrompt = generateOutputPrompt(refinedIntent, executionSummary);

    let finalResponse = "";

    await outputAgent.process(outputPrompt, (chunk) => {
      finalResponse += chunk;
      if (onStream) onStream(chunk);
    });

    logger.info(`Final response generated: ${finalResponse}`);

    // Persist system response to DB
    try {
      await addMemory(finalResponse, "user", "assistant", [
        "interaction",
        deviceId,
      ]);
    } catch (e) {
      logger.error("Failed to persist output message", e);
    }

    return finalResponse;
  }

  public async createPlanFromGoal(
    goal: string,
    modelConfig: any,
  ): Promise<Plan> {
    logger.info(`Planning for goal: ${goal}`);

    // 1. Get available tools
    const tools = await this.mcpHub.getAllTools();
    const toolsDesc = tools
      .map((t) => `- ${t.name}: ${t.description}`)
      .join("\n");

    // 2. Construct Prompt
    const prompt = generatePlannerPrompt(goal, toolsDesc);

    // 3. Call LLM
    // Note: This assumes LLMService has a simple generate method.
    // Since streamChatCompletionViaSSE is for streaming, we might need a non-streaming wrapper or collect the stream.
    // For now, let's assume we can collect the stream.

    let fullResponse = "";
    // Using false for jsonMode since we manually parse, and no stream callback needed here if we wait.
    // However, LLMService.generateCompletion returns the full string if stream is false.
    // We already passed stream: false in modelConfig via internalConfig.

    const response = await this.llmService.generateCompletion(
      [
        {
          role: "system",
          content: PLANNER_SYSTEM_PROMPT,
        },
        { role: "user", content: prompt },
      ],
      modelConfig,
    );

    fullResponse = response || "";

    // 4. Parse JSON
    let tasksData: any[] = [];
    try {
      // Clean markdown code blocks if present
      const cleanJson = fullResponse.replace(/```json\n?|\n?```/g, "").trim();
      tasksData = JSON.parse(cleanJson);
    } catch (e) {
      logger.error("Failed to parse plan JSON", e);
      throw new Error("Failed to generate a valid plan.");
    }

    // 5. Create Plan in TaskManager
    const plan = this.taskManager.createPlan(goal);

    for (const taskData of tasksData) {
      // Create an Executor Agent for this specific task
      const toolName =
        taskData.toolName === "null" ? undefined : taskData.toolName;
      const executorAgent = this.agentFactory.createExecutorAgent(
        taskData.description,
        toolName ? [toolName] : [],
      );

      // Assign the agent to the task (Conceptually - TaskManager needs update to support Agents)
      // For now, we stick to the existing task structure but maybe store the agent config?
      this.taskManager.addTask(
        taskData.description,
        toolName,
        taskData.toolArgs,
      );
      // TODO: In future, TaskManager should delegate execution to executorAgent.process()
    }

    logger.info(`Plan created with ${plan.tasks.length} tasks.`);
    return plan;
  }
}
