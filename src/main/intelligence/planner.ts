import { LLMService } from "../model/llm-service";
import { ToolRegistry } from "../execution/tool-registry";
import { TaskManager } from "../control/manager";
import { TeamOrchestrator } from "../team/orchestrator";
import { Plan } from "../control/types";
import { logger } from "../logger";
import { AgentFactory } from "../agent/factory";
import { AgentMessage } from "../agent/types";
// import { addMemory, searchMemory } from "../memory/manager"; // Temporarily disabled vector DB
import { TriageAgent } from "./triage";
import { WorkflowPlanner } from "../workflow/planner";
import { WorkflowEngine } from "../workflow/engine";
import {
  generateOutputPrompt,
  generatePlannerPrompt,
  PLANNER_SYSTEM_PROMPT,
  PLANNER_CONVERSATION_PROMPT,
  TRIAGE_PLANNER_CONTEXT,
} from "../prompts/planner";

import { FileSessionStore } from "../memory/file-store";

export class Planner {
  public llmService: LLMService;
  private toolRegistry: ToolRegistry;
  private taskManager: TaskManager;
  private teamOrchestrator: TeamOrchestrator;
  private agentFactory: AgentFactory;
  private triageAgent: TriageAgent;
  private workflowPlanner: WorkflowPlanner;
  private workflowEngine: WorkflowEngine | null = null;
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
    this.workflowPlanner = new WorkflowPlanner(llmService, toolRegistry);
    this.sessionStore = new FileSessionStore(llmService);
  }

  /** Set the workflow engine (created externally after store init) */
  public setWorkflowEngine(engine: WorkflowEngine) {
    this.workflowEngine = engine;
  }

  /** Get the workflow engine */
  public getWorkflowEngine(): WorkflowEngine | null {
    return this.workflowEngine;
  }

  /** Get the workflow planner */
  public getWorkflowPlanner(): WorkflowPlanner {
    return this.workflowPlanner;
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
    signal?: AbortSignal,
  ): Promise<string> {
    const sessionId = rawSessionId || "global";

    // RAG: Search Long-Term Memory (Temporarily disabled)
    let memoryContext = "";
    // try {
    //   const textContent = typeof content === "string" ? content : "User Input";
    //   const relevantMemories = await searchMemory(textContent, {
    //     limit: 5,
    //     sessionId,
    //   });
    //   if (relevantMemories.length > 0) {
    //     memoryContext = relevantMemories
    //       .map((m) => `- ${m.content} (Source: ${m.source})`)
    //       .join("\n");
    //   }
    // } catch (e) {
    //   logger.warn("Failed to search memory", e);
    // }

    // 1. Create Input Agent for this device
    // const inputAgent = this.agentFactory.createInputAgent(
    //   deviceId,
    //   memoryContext,
    // );

    // Load History
    let history = await this.sessionStore.loadSession(sessionId);

    // Check and compress file-level history if it exceeds 85% of max tokens
    if (modelConfig?.inputMaxTokens && history.length > 0) {
      history = await this.sessionStore.checkAndCompressIfNeeded(
        sessionId,
        history,
        modelConfig.inputMaxTokens,
        modelConfig,
        0.85,
        onStream, // Notify device about compression status
      );
    }

    // if (history.length > 0) {
    //   inputAgent.setHistory(history);
    // }

    // Pass model config to agent
    const internalConfig = { ...modelConfig, stream: false };
    // inputAgent.config.modelConfig = internalConfig;

    // 2. Process raw input to understand intent
    const logContent =
      typeof content === "string" ? content : "Multimodal content";
    logger.info(`Processing input from ${deviceId}: ${logContent}`);

    // Emit initial status
    if (onStream) {
      onStream("\n*Thinking (Analyzing Request)...*\n");
    }

    // Persist user input to File Session
    const textContent =
      typeof content === "string" ? content : "[Multimodal Content]";

    // Vector DB (RAG) - Temporarily disabled
    // try {
    //   if (textContent && textContent.trim().length > 0) {
    //     await addMemory(
    //       textContent,
    //       "user",
    //       "user",
    //       ["interaction", deviceId],
    //       sessionId,
    //     );
    //   }
    // } catch (e) {
    //   logger.error("Failed to persist input to vector memory", e);
    // }

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

    // Skip InputAgent LLM processing - treat raw input as refined intent
    // const refinedIntent = await inputAgent.process(content);

    let refinedIntent = "";
    if (typeof content === "string") {
      refinedIntent = content;
    } else {
      // Extract text parts from multimodal content for intent analysis
      refinedIntent = content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n");
      if (!refinedIntent) refinedIntent = "[Multimodal Content]";
    }

    logger.info(`Refined intent (raw pass-through): ${refinedIntent}`);

    // 3. Triage (Simple vs Complex)
    const contextHistory = history
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n");

    let fullContext = `User Device: ${deviceId}\nSession ID: ${sessionId}`;

    if (memoryContext) {
      fullContext += `\n\n[Relevant Long-Term Memory]:\n${memoryContext}`;
    }

    fullContext += `\n\nRecent History:\n${contextHistory}`;

    fullContext += `\n\n${TRIAGE_PLANNER_CONTEXT}`;

    // Check abort before triage
    if (signal?.aborted) throw new Error("Request aborted");

    const triageResult = await this.triageAgent.evaluate(
      refinedIntent,
      fullContext,
      internalConfig,
    );

    logger.info(`Triage Result: ${JSON.stringify(triageResult)}`);

    // Single Agent mode: one agent with specific tools (e.g., scheduled tasks, simple file ops)
    // Check this BEFORE direct reply, since single_agent also has isComplex=false
    if (triageResult.mode === "single_agent") {
      logger.info("Handling as single-agent task");
      if (onStream) {
        onStream("\n*Processing with single agent...*\n");
      }

      // Give the agent the triage's suggested tools + capability discovery meta-tools
      // The agent can discover more tools via list_capabilities/get_capability_detail
      const suggestedTools = triageResult.suggestedTools || [];
      const discoveryTools = ["list_capabilities", "get_capability_detail"];
      const agentTools = [...new Set([...suggestedTools, ...discoveryTools])];

      // Get only the tool definitions the agent actually needs
      const allTools = await this.toolRegistry.getAllTools();
      const agentToolDefs = allTools.filter((t) => agentTools.includes(t.name));

      // Create a single agent with capability discovery prompt
      const agent = this.agentFactory.createCustomAgent(
        "TaskAgent",
        `You are an expert AI assistant. You have a few assigned tools and the ability to discover more.

**How to work:**
1. Check your assigned tools — they were selected for this task.
2. If you need a tool you don't have, call \`list_capabilities\` to see all available capabilities.
3. Call \`get_capability_detail\` to get the full schema of any tool before using it.
4. Execute the task step-by-step, report results clearly.

**Common patterns:**
- Scheduled/timed tasks → use \`schedule_task\`
- Web data → discover browser tools via \`list_capabilities\`
- File operations → discover file tools via \`list_capabilities\``,
        agentTools,
        agentToolDefs,
        fullContext,
        internalConfig,
      );
      agent.config.modelConfig = internalConfig;

      if (signal?.aborted) throw new Error("Request aborted");

      const result = await agent.process(
        refinedIntent,
        onStream,
        undefined,
        signal,
      );

      // Persist result
      try {
        await this.sessionStore.appendMessage(sessionId, {
          role: "assistant",
          content: result,
        });
      } catch (e) {
        logger.error("Failed to persist single agent response to file session", e);
      }

      return result;
    }

    // Direct Reply (simple, non-tool tasks)
    if (triageResult.mode === "direct" || !triageResult.isComplex) {
      logger.info("Handling as simple task (Direct Reply with Planner LLM)");

      // Build messages with planner system prompt + history + user request
      const directMessages: AgentMessage[] = [
        { role: "system", content: PLANNER_CONVERSATION_PROMPT },
        ...history,
        { role: "user", content: content },
      ];

      let response = "";
      try {
        const llmResponse = await this.llmService.generateCompletion(
          directMessages as any,
          { ...modelConfig, stream: !!onStream },
          false,
          onStream,
          undefined,
          signal,
        );
        response = llmResponse || triageResult.directResponse || "I see.";
      } catch (e: any) {
        logger.error("Direct LLM response failed, using triage fallback", e);
        response = triageResult.directResponse || "I see.";
        if (onStream) onStream(response);
      }

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

    // 4. Workflow Mode -> WorkflowPlanner (DAG creation)
    if (triageResult.mode === "workflow") {
      logger.info("Handling as workflow task");
      if (onStream) {
        onStream("\n*\u8fdb\u5165\u5de5\u4f5c\u6d41\u89c4\u5212\u6a21\u5f0f...*\n");
      }

      // Check abort
      if (signal?.aborted) throw new Error("Request aborted");

      const planResult = await this.workflowPlanner.planOrRefine(
        refinedIntent,
        history as AgentMessage[],
        deviceId,
        sessionId,
        internalConfig,
        undefined,
        onStream,
      );

      let response: string;
      if (planResult.needsClarification) {
        response = planResult.clarificationQuestion || "\u8bf7\u63d0\u4f9b\u66f4\u591a\u4fe1\u606f\u4ee5\u4fbf\u6211\u521b\u5efa\u5de5\u4f5c\u6d41\u3002";
      } else if (planResult.workflow) {
        response = planResult.summary || `\u5de5\u4f5c\u6d41 "${planResult.workflow.name}" \u5df2\u521b\u5efa (v${planResult.workflow.version})`;

        // Auto-start the workflow if engine is available
        if (this.workflowEngine) {
          try {
            const run = await this.workflowEngine.startWorkflow(planResult.workflow.id, internalConfig);
            response += `\n\n\u2705 \u5de5\u4f5c\u6d41\u5df2\u81ea\u52a8\u542f\u52a8 (runId: ${run.id})`;
          } catch (err: any) {
            response += `\n\n\u26a0\ufe0f \u5de5\u4f5c\u6d41\u521b\u5efa\u6210\u529f\u4f46\u542f\u52a8\u5931\u8d25: ${err.message}`;
          }
        }
      } else {
        response = "\u5de5\u4f5c\u6d41\u89c4\u5212\u5b8c\u6210\uff0c\u4f46\u672a\u751f\u6210\u6709\u6548\u5b9a\u4e49\u3002";
      }

      // Persist
      try {
        await this.sessionStore.appendMessage(sessionId, {
          role: "assistant",
          content: response,
        });
      } catch (e) {
        logger.error("Failed to persist workflow response to file session", e);
      }

      return response;
    }

    // 5. Complex Task -> Team Orchestrator (Swarm Mode)

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

    // Check abort before team execution
    if (signal?.aborted) throw new Error("Request aborted");

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
      signal,
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

    // Persist agent execution results to memory - Temporarily disabled
    // try {
    //   await addMemory(
    //     `Executed plan for goal: ${refinedIntent}. Results: ${teamResult}`,
    //     "user",
    //     "system",
    //     ["execution", deviceId],
    //     sessionId,
    //   );
    // } catch (e) {
    //   logger.error("Failed to persist execution results", e);
    // }

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

    // Persist system response to Vector Memory - Temporarily disabled
    // try {
    //   await addMemory(
    //     finalResponse,
    //     "user",
    //     "assistant",
    //     ["interaction", deviceId],
    //     sessionId,
    //   );
    // } catch (e) {
    //   logger.error("Failed to persist output message to vector memory", e);
    // }

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

      const selectedTools = toolName
        ? tools.filter((t) => t.name === toolName)
        : [];

      const executorAgent = this.agentFactory.createExecutorAgent(
        taskData.description,
        selectedTools,
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
