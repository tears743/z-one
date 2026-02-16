import { LLMService } from "../model/llm-service";
import { ToolRegistry } from "../execution/tool-registry";
import { TaskManager } from "../control/manager";
import { TeamOrchestrator } from "../team/orchestrator";
import { Plan } from "../control/types";
import { logger } from "../logger";
import { AgentFactory } from "../agent/factory";
import { AgentMessage } from "../agent/types";
import { addMemory, searchMemory } from "../memory/manager";
import { TriageAgent } from "./triage";
import {
  generateOutputPrompt,
  generatePlannerPrompt,
  PLANNER_SYSTEM_PROMPT,
} from "../prompts/planner";

import { FileSessionStore } from "../memory/file-store";

export class Planner {
  private llmService: LLMService;
  private toolRegistry: ToolRegistry;
  private taskManager: TaskManager;
  private teamOrchestrator: TeamOrchestrator;
  private agentFactory: AgentFactory;
  private triageAgent: TriageAgent;
  public sessionStore: FileSessionStore;

  constructor(
    llmService: LLMService,
    toolRegistry: ToolRegistry,
    taskManager: TaskManager,
    teamOrchestrator: TeamOrchestrator,
  ) {
    this.llmService = llmService;
    this.toolRegistry = toolRegistry;
    this.taskManager = taskManager;
    this.teamOrchestrator = teamOrchestrator;
    this.agentFactory = new AgentFactory(llmService, toolRegistry);
    this.triageAgent = new TriageAgent(llmService);
    this.sessionStore = new FileSessionStore(llmService);
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
    onStream?: (chunk: string) => void,
    rawSessionId: string = "global",
  ): Promise<string> {
    const sessionId = rawSessionId || "global";

    // 1. Create Input Agent for this device
    const inputAgent = this.agentFactory.createInputAgent(deviceId);

    // Load History
    const history = await this.sessionStore.loadSession(sessionId);

    // RAG: Search Long-Term Memory
    let memoryContext = "";
    try {
      const textContent = typeof content === "string" ? content : "User Input";
      const relevantMemories = await searchMemory(textContent, {
        limit: 5,
        sessionId,
      });
      if (relevantMemories.length > 0) {
        memoryContext = `\n\n[Relevant Long-Term Memory]:\n${relevantMemories.map((m) => `- ${m.content} (Source: ${m.source})`).join("\n")}`;
      }
    } catch (e) {
      logger.warn("Failed to search memory", e);
    }

    if (history.length > 0 || memoryContext) {
      inputAgent.setHistory([
        {
          role: "system",
          content: inputAgent.config.systemPrompt + memoryContext,
        },
        ...history,
      ]);
    }

    // Pass model config to agent
    const internalConfig = { ...modelConfig, stream: false };
    inputAgent.config.modelConfig = internalConfig;

    // 2. Process raw input to understand intent
    const logContent =
      typeof content === "string" ? content : "Multimodal content";
    logger.info(`Processing input from ${deviceId}: ${logContent}`);

    // Emit initial status
    if (onStream) {
      onStream("\n*Thinking (Analyzing Request)...*\n");
    }

    // Persist user input to Memory (Vector) and File
    const textContent =
      typeof content === "string" ? content : "[Multimodal Content]";

    // Vector DB (RAG)
    try {
      if (textContent && textContent.trim().length > 0) {
        await addMemory(
          textContent,
          "user",
          "user",
          ["interaction", deviceId],
          sessionId,
        );
      }
    } catch (e) {
      logger.error("Failed to persist input to vector memory", e);
    }

    // File Session
    try {
      if (textContent && textContent.trim().length > 0) {
        await this.sessionStore.appendMessage(sessionId, {
          role: "user",
          content: content,
        });
      }
    } catch (e) {
      logger.error("Failed to persist input to file session", e);
    }

    const refinedIntent = await inputAgent.process(content);
    logger.info(`Refined intent: ${refinedIntent}`);

    // 3. Triage (Simple vs Complex)
    const contextHistory = history
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n");
    const fullContext = `User Device: ${deviceId}\nSession ID: ${sessionId}\n\nRecent History:\n${contextHistory}`;

    const triageResult = await this.triageAgent.evaluate(
      refinedIntent,
      fullContext,
      internalConfig,
    );

    logger.info(`Triage Result: ${JSON.stringify(triageResult)}`);

    if (!triageResult.isComplex) {
      // Direct Reply
      logger.info("Handling as simple task (Direct Reply)");
      const response = triageResult.directResponse || "I see.";

      if (onStream) {
        onStream(response);
      }

      // Persist to Vector Memory
      try {
        await addMemory(
          response,
          "user",
          "assistant",
          ["interaction", deviceId],
          sessionId,
        );
      } catch (e) {
        logger.error("Failed to persist simple response to vector memory", e);
      }

      // Persist to File Session
      try {
        await this.sessionStore.appendMessage(sessionId, {
          role: "assistant",
          content: response,
        });
      } catch (e) {
        logger.error("Failed to persist simple response to file session", e);
      }
      return response;
    }

    // 4. Complex Task -> Team Orchestrator (Swarm Mode)

    // Status callback wrapper
    const onStatusUpdate = (status: string) => {
      logger.info(`[TeamManager] ${status}`);
      if (onStream) {
        onStream(`\n*${status}*\n`);
      }
    };

    const onSwarmEvent = (event: any) => {
      if (onStream) {
        (onStream as any)(event);
      }
    };

    const teamResult = await this.teamOrchestrator.executeMission(
      refinedIntent,
      fullContext,
      internalConfig,
      onStatusUpdate,
      onSwarmEvent,
      sessionId,
      async (content) => {
        // Real-time logging to session file
        try {
          await this.sessionStore.appendMessage(sessionId, {
            role: "system",
            content: content,
          });
        } catch (e) {
          logger.error("Failed to append real-time log to session", e);
        }
      },
    );

    // Persist full execution trace to File Session (Summary)
    try {
      await this.sessionStore.appendMessage(sessionId, {
        role: "system",
        content: `### Team Execution Log\n\n${teamResult}`,
      });
    } catch (e) {
      logger.error("Failed to persist execution log to file session", e);
    }

    // Persist agent execution results to memory
    try {
      await addMemory(
        `Executed plan for goal: ${refinedIntent}. Results: ${teamResult}`,
        "user",
        "system",
        ["execution", deviceId],
        sessionId,
      );
    } catch (e) {
      logger.error("Failed to persist execution results", e);
    }

    // Here we can use the original config (if it had stream=true, we could stream output back)
    // But currently InteractionManager expects a Promise<string> return.
    // So we must force stream=false here too unless we change InteractionManager signature.
    const outputAgent = this.agentFactory.createOutputAgent(deviceId);

    // Inject history into Output Agent as well
    if (history.length > 0) {
      outputAgent.setHistory([
        { role: "system", content: outputAgent.config.systemPrompt },
        ...history,
      ]);
    }

    // If we support streaming, use the original config (which might have stream=true)
    // and pass the onStream callback.
    // However, if we stream, we might not get the full response back easily for persistence unless we collect it.
    // So we'll use a collector wrapper.
    outputAgent.config.modelConfig = modelConfig;

    const executionSummary = teamResult;
    const outputPrompt = generateOutputPrompt(refinedIntent, executionSummary);

    let finalResponse = "";

    await outputAgent.process(outputPrompt, (chunk) => {
      finalResponse += chunk;
      if (onStream) onStream(chunk);
    });

    logger.info(`Final response generated: ${finalResponse}`);

    // Persist system response to Vector Memory
    try {
      await addMemory(
        finalResponse,
        "user",
        "assistant",
        ["interaction", deviceId],
        sessionId,
      );
    } catch (e) {
      logger.error("Failed to persist output message to vector memory", e);
    }

    // Persist to File Session
    try {
      await this.sessionStore.appendMessage(sessionId, {
        role: "assistant",
        content: finalResponse,
      });
    } catch (e) {
      logger.error("Failed to persist output message to file session", e);
    }

    return finalResponse;
  }

  public async createPlanFromGoal(
    goal: string,
    modelConfig: any,
  ): Promise<Plan> {
    logger.info(`Planning for goal: ${goal}`);

    // 1. Get available tools
    const tools = await this.toolRegistry.getAllTools();
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
