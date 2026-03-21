import { LLMService } from "../model/llm-service";
import { ToolRegistry } from "../execution/tool-registry";
import { AgentFactory } from "../agent/factory";
import {
  TEAM_LEADER_SYSTEM_PROMPT,
  generateTeamRequestPrompt,
} from "./prompts";
import { TeamPlan, TeamTask, SwarmStage } from "./types";
import { logger } from "../logger";
import { Agent } from "../agent/agent";
import * as fs from "fs/promises";
import * as path from "path";
import { getAppSettings } from "../db";

export class TeamOrchestrator {
  private llmService: LLMService;
  private toolRegistry: ToolRegistry;
  private agentFactory: AgentFactory;
  private teammates: Map<string, Agent> = new Map();

  constructor(
    llmService: LLMService,
    toolRegistry: ToolRegistry,
    agentFactory: AgentFactory,
  ) {
    this.llmService = llmService;
    this.toolRegistry = toolRegistry;
    this.agentFactory = agentFactory;
  }

  public async executeMission(
    goal: string,
    context: string,
    modelConfig: any,
    onStatus?: (status: string) => void,
    onSwarmEvent?: (event: any) => void,
    sessionId: string = "global",
    logCallback?: (content: string) => Promise<void>,
    signal?: AbortSignal,
  ): Promise<string> {
    // 1. Tool Discovery — compact summaries for planning prompt (no schemas)
    const allTools = await this.toolRegistry.getAllTools();
    const toolsDesc = allTools
      .map((t) => `- ${t.name}: ${(t.description || "").substring(0, 80)}`)
      .join("\n");

    // 2. Leadership Planning
    if (onStatus) onStatus("Thinking (Staffing & Planning)...");

    const prompt = generateTeamRequestPrompt(goal, context, toolsDesc);

    const teamPlanSchema = {
      name: "team_plan",
      schema: {
        type: "object",
        properties: {
          isComplex: { type: "boolean" },
          thoughts: { type: "string" },
          roster: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                persona: { type: "string" },
                capabilities: { type: "array", items: { type: "string" } },
                tools: { type: "array", items: { type: "string" } },
              },
              required: ["name", "persona", "capabilities", "tools"],
            },
          },
          mission: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                tasks: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      description: { type: "string" },
                      assignedTo: { type: "string" },
                      dependencies: { type: "array", items: { type: "string" } },
                    },
                    required: ["id", "description", "assignedTo", "dependencies"],
                  },
                },
              },
              required: ["name", "tasks"],
            },
          },
        },
        required: ["thoughts", "roster", "mission"],
        additionalProperties: false,
      },
    };

    const response = await this.llmService.generateCompletion(
      [
        { role: "system", content: TEAM_LEADER_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      modelConfig,
      true, // jsonMode
      undefined, // onChunk
      undefined, // tools
      signal,
      teamPlanSchema,
    );

    if (!response) throw new Error("Team Leader failed to respond");

    let plan: TeamPlan;
    try {
      // Handle potential markdown wrapping
      const cleanJson = response.replace(/```json\n?|\n?```/g, "").trim();
      plan = JSON.parse(cleanJson);
    } catch (e) {
      logger.error("Failed to parse team plan", e);
      throw new Error("Invalid team plan format");
    }

    // Validate and fix stage structure: if dependent tasks are in the same stage,
    // automatically split them into sequential stages to prevent race conditions.
    plan.mission = this.validateAndFixStages(plan.mission);

    logger.info("Team Plan:", plan);
    if (onStatus) onStatus(`Strategy: ${plan.thoughts.substring(0, 150)}...`);

    // Plan Approval Check
    const appSettings = getAppSettings();
    if (appSettings?.general?.requirePlanApproval) {
      if (onStatus) onStatus("📋 等待用户确认计划...");

      // Broadcast swarmState BEFORE approval so the SwarmBoard card renders
      if (onSwarmEvent) {
        const previewState = {
          stages: plan.mission.map((stage) => ({
            id: stage.name,
            name: stage.name,
            tasks: stage.tasks.map((task) => {
              const agentRole = plan.roster.find((r) => r.name === task.assignedTo);
              return {
                id: task.id,
                assignedTo: task.assignedTo,
                description: task.description,
                status: "pending",
                tools: agentRole?.tools || [],
              };
            }),
          })),
        };
        onSwarmEvent(previewState);
      }

      // Build plan summary for user review
      const planSummary = this.formatPlanForApproval(plan);

      // Use userInteractionBridge to ask for approval
      const { userInteractionBridge } = await import("../execution/tools/native/user-interaction");
      const approvalRequestId = `plan-approval-${Date.now()}`;
      const deviceId = "unknown";

      // Track pending approval so InteractionManager can intercept user messages
      (userInteractionBridge as any).pendingApprovalId = approvalRequestId;

      // Emit ask_user event with the plan
      userInteractionBridge.emit("ask_user", {
        requestId: approvalRequestId,
        deviceId,
        message: planSummary,
        waitForReply: true,
      });

      // Wait for approval (5 minute timeout)
      const approval = await new Promise<string>((resolve) => {
        const timer = setTimeout(() => {
          userInteractionBridge.removeAllListeners(`user_reply:${deviceId}:${approvalRequestId}`);
          resolve("timeout");
        }, 5 * 60 * 1000);

        // Listen on all possible device IDs (broadcast pattern)
        const handler = (reply: any) => {
          clearTimeout(timer);
          // reply may be a string or {content: string, images: []} from web client
          const text = typeof reply === "string" ? reply : (reply?.content || String(reply));
          resolve(text.trim().toLowerCase());
        };

        userInteractionBridge.once(`user_reply:${deviceId}:${approvalRequestId}`, handler);

        // Also listen for any device reply pattern
        userInteractionBridge.once(`plan_approval:${approvalRequestId}`, handler);
      });

      const isApproved = ["确认", "approve", "yes", "ok", "y", "同意", "执行"].includes(approval);

      // Clear pending approval tracking
      (userInteractionBridge as any).pendingApprovalId = null;

      if (!isApproved) {
        if (approval === "timeout") {
          if (onStatus) onStatus("⏰ 等待超时，计划已取消");
          logger.info("[TeamOrchestrator] Plan approval timed out, cancelling");
          return "计划等待确认超时，已自动取消。请重新发送指令。";
        }
        if (onStatus) onStatus("❌ 计划已被用户拒绝");
        return `计划已被用户拒绝。用户回复: "${approval}"`;
      }

      if (onStatus) onStatus("✅ 计划已确认，开始执行...");
    }

    // Helper to broadcast state
    const broadcastState = () => {
      if (onSwarmEvent) {
        const swarmState = {
          stages: plan.mission.map((stage) => ({
            id: stage.name, // Use name as ID if no explicit ID
            name: stage.name,
            tasks: stage.tasks.map((task) => {
              // Find assigned agent's tools
              const agentRole = plan.roster.find(
                (r) => r.name === task.assignedTo,
              );
              return {
                id: task.id,
                assignedTo: task.assignedTo,
                description: task.description,
                status: (task as any).status || "pending", // We'll attach status to task object
                output: (task as any).output,
                logs: (task as any).logs || [],
                tools: agentRole?.tools || [],
              };
            }),
          })),
        };
        onSwarmEvent(swarmState);
      }
    };

    // 3. Team Assembly (Recruitment)
    this.teammates.clear();
    const rosterNames = plan.roster.map((r) => r.name).join(", ");
    if (onStatus) onStatus(`Assembling Team: ${rosterNames}`);

    // Initial Broadcast
    broadcastState();

    for (const member of plan.roster) {
      // Inject capability discovery meta-tools so each agent can discover more tools
      const discoveryTools = ["list_capabilities", "get_capability_detail"];
      const agentToolNames = [...new Set([...member.tools, ...discoveryTools])];

      // Only pass tool definitions the agent actually needs (not full registry)
      const agentToolDefs = allTools.filter((t) => agentToolNames.includes(t.name));

      logger.info(`Agent ${member.name} assigned tools: ${agentToolNames.join(", ")}`);

      // Create specialized agent with discovery capability
      const agent = this.agentFactory.createCustomAgent(
        member.name,
        member.persona + `\n\n**Tool Discovery:** If you need tools beyond your assigned set, call \`list_capabilities\` to discover all available tools, then \`get_capability_detail\` to get their schema.\n\n**Output Requirement:** When you finish your task, provide a clear, structured summary of your findings/results. This summary will be passed to other team members in subsequent stages. Include key data, file paths, URLs, and any actionable information.`,
        agentToolNames,
        agentToolDefs,
        context, // memoryContext
        modelConfig, // Pass model config for legacy tooling check
      );
      // Ensure they share the same model config (or allow override if plan specified)
      agent.config.modelConfig = modelConfig;

      // Register
      this.teammates.set(member.name, agent);
      logger.info(`Recruited Teammate: ${member.name}`);
    }

    // 4. Mission Execution
    const results: string[] = [];
    // Structured map of all completed task outputs: taskId -> { agent, description, output }
    const completedTaskOutputs: Map<string, { agent: string; description: string; output: string }> = new Map();

    // Ensure progress directory exists in workspace
    const settings = getAppSettings();
    const workspaceRoot =
      settings?.general?.agentWorkspace ||
      path.join(process.cwd(), "workspace");
    const progressDir = path.join(workspaceRoot, "agents-progress");

    try {
      await fs.mkdir(progressDir, { recursive: true });
    } catch (e) {
      logger.error("Failed to create agents-progress directory", e);
    }

    for (const stage of plan.mission) {
      // Check abort before each stage
      if (signal?.aborted) {
        logger.info(`[TeamOrchestrator] Execution aborted before stage: ${stage.name}`);
        // Mark all tasks in this stage and remaining stages as cancelled
        for (const s of plan.mission) {
          for (const t of s.tasks) {
            if (!(t as any).status || (t as any).status === "pending" || (t as any).status === "running") {
              (t as any).status = "cancelled";
            }
          }
        }
        broadcastState();
        break;
      }
      if (onStatus) onStatus(`Starting Stage: ${stage.name}`);

      const stagePromises = stage.tasks.map(async (task) => {
        // Check abort before each task
        if (signal?.aborted) {
          (task as any).status = "cancelled";
          return `[${task.assignedTo}] Task cancelled: ${task.description}`;
        }

        const agent = this.teammates.get(task.assignedTo);
        if (!agent) {
          const error = `Agent ${task.assignedTo} MIA. Skipping task: ${task.description}`;
          logger.error(error);
          return error;
        }

        if (onStatus)
          onStatus(`[${task.assignedTo}] Executing: ${task.description}`);

        // Update status and broadcast
        (task as any).status = "running";
        broadcastState();

        // Write Task Started
        await this.writeTaskProgress(
          progressDir,
          task.assignedTo,
          sessionId,
          task.id,
          "started",
          task,
        );

        try {
          // Provide context from previous stages' results
          let taskInput = task.description;
          if (completedTaskOutputs.size > 0) {
            const contextParts: string[] = [];
            for (const [taskId, info] of completedTaskOutputs) {
              const truncatedOutput = info.output.length > 800
                ? info.output.substring(0, 800) + "... [truncated]"
                : info.output;
              contextParts.push(`=== ${taskId} (${info.agent}) ===\nTask: ${info.description}\nResult:\n${truncatedOutput}`);
            }
            taskInput += `\n\n[Previous Stage Results — use this data to complete your task]:\n${contextParts.join("\n\n")}`;
          }

          // Initialize logs array if not present
          if (!(task as any).logs) (task as any).logs = [];
          if (!(task as any)._logBuffer) (task as any)._logBuffer = "";

          const result = await agent.process(
            taskInput,
            (chunk) => {
              if (signal?.aborted) return;
              // Buffer chunks and split by newline for cleaner logs
              (task as any)._logBuffer += chunk;

              if ((task as any)._logBuffer.includes("\n")) {
                const lines = (task as any)._logBuffer.split("\n");
                // Keep the last part as new buffer (it might be incomplete line)
                (task as any)._logBuffer = lines.pop() || "";

                // Filter out empty lines if desired, or keep them
                const newLines = lines.filter(
                  (l: string) => l.trim().length > 0,
                );
                if (newLines.length > 0) {
                  (task as any).logs.push(...newLines);
                  broadcastState();
                }
              }
            },
            async (stepLog) => {
              // Real-time logging callback
              if (logCallback) {
                const logEntry = `### [Agent: ${task.assignedTo}] Task: ${task.id}\n${stepLog}`;
                try {
                  await logCallback(logEntry);
                } catch (e) {
                  logger.error("Failed to write real-time log", e);
                }
              }
            },
            signal,
          );

          // Flush remaining buffer
          if (
            (task as any)._logBuffer &&
            (task as any)._logBuffer.trim().length > 0
          ) {
            (task as any).logs.push((task as any)._logBuffer);
            (task as any)._logBuffer = "";
          }

          // After agent finishes, re-check abort: if aborted, override status to cancelled
          if (signal?.aborted) {
            (task as any).status = "cancelled";
            broadcastState();
            return `[${task.assignedTo}] Task cancelled (signal aborted during execution)`;
          }

          logger.info(`Task Complete: ${task.id}`);

          // Update status and broadcast
          (task as any).status = "completed";
          (task as any).output = result;
          broadcastState();

          // Store structured output for cross-stage passing
          completedTaskOutputs.set(task.id, {
            agent: task.assignedTo,
            description: task.description,
            output: result || "(no output)",
          });

          // Write Task Completed
          await this.writeTaskProgress(
            progressDir,
            task.assignedTo,
            sessionId,
            task.id,
            "completed",
            task,
            result,
          );

          // Return concise output for final results
          const detailedOutput = `### [Agent: ${task.assignedTo}]\n\n#### Task: ${task.description}\n\n**Result**: ${result}`;
          return detailedOutput;
        } catch (e: any) {
          const error = `[${task.assignedTo}] Failed: ${e.message}`;
          logger.error(error);

          // Update status and broadcast
          (task as any).status = "failed";
          (task as any).output = e.message;
          broadcastState();

          // Write Task Failed
          await this.writeTaskProgress(
            progressDir,
            task.assignedTo,
            sessionId,
            task.id,
            "failed",
            task,
            undefined,
            e.message,
          );

          return error;
        }
      });

      // Wait for all tasks in this stage to complete (Parallel Execution)
      const stageResults = await Promise.all(stagePromises);

      // Stage Verification: check for failures and retry once
      const failedTasks = stage.tasks.filter((t) => (t as any).status === "failed");
      if (failedTasks.length > 0 && !signal?.aborted) {
        if (onStatus) onStatus(`⚠️ Stage "${stage.name}": ${failedTasks.length} task(s) failed. Evaluating retry...`);

        const verification = await this.verifyStageResults(stage, modelConfig, signal);

        if (verification.retryTaskIds.length > 0) {
          if (onStatus) onStatus(`🔄 Retrying ${verification.retryTaskIds.length} failed task(s) in "${stage.name}"...`);

          const retryPromises = verification.retryTaskIds.map(async (taskId) => {
            const task = stage.tasks.find((t) => t.id === taskId);
            if (!task) return `[Retry] Task ${taskId} not found`;

            const agent = this.teammates.get(task.assignedTo);
            if (!agent) return `[Retry] Agent ${task.assignedTo} not found`;

            // Reset status for retry
            (task as any).status = "running";
            (task as any).output = undefined;
            broadcastState();

            try {
              const errorContext = `\n\n[RETRY] Previous attempt failed: ${(task as any).output || "unknown error"}. ${verification.suggestion || "Please try a different approach."}`;
              let retryContext = "";
              if (completedTaskOutputs.size > 0) {
                const parts: string[] = [];
                for (const [tid, info] of completedTaskOutputs) {
                  parts.push(`=== ${tid} (${info.agent}) ===\n${info.output.substring(0, 500)}`);
                }
                retryContext = `\n\n[Previous Results]:\n${parts.join("\n\n")}`;
              }
              const retryInput = task.description + errorContext + retryContext;

              const result = await agent.process(retryInput, undefined, undefined, signal);

              (task as any).status = "completed";
              (task as any).output = result;
              broadcastState();

              logger.info(`[TeamOrchestrator] Retry succeeded for task ${taskId}`);
              const retryTrace = agent.getExecutionTrace();
              return `### [Agent: ${task.assignedTo}] (Retry)\n\n#### Task: ${task.description}\n\n${retryTrace}\n\n**Final Result**: ${result}`;
            } catch (e: any) {
              (task as any).status = "failed";
              (task as any).output = e.message;
              broadcastState();
              logger.error(`[TeamOrchestrator] Retry failed for task ${taskId}: ${e.message}`);
              return `[${task.assignedTo}] Retry Failed: ${e.message}`;
            }
          });

          const retryResults = await Promise.all(retryPromises);
          results.push(...retryResults);
        } else {
          results.push(...stageResults);

          if (verification.abort) {
            if (onStatus) onStatus(`❌ Aborting: ${verification.suggestion}`);
            logger.warn(`[TeamOrchestrator] Aborting after stage "${stage.name}": ${verification.suggestion}`);
            break;
          }
        }
      } else {
        results.push(...stageResults);
      }
    }

    return results.join("\n\n");
  }

  private async writeTaskProgress(
    dir: string,
    agentName: string,
    sessionId: string,
    taskId: string,
    status: string,
    task: TeamTask,
    result?: string,
    error?: string,
  ) {
    // Sanitize names for filesystem
    const safeAgentName = agentName.replace(/[^a-zA-Z0-9_-]/g, "_");
    const safeTaskId = taskId.replace(/[^a-zA-Z0-9_-]/g, "_");

    // Ensure dir exists (redundant but safe)
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (e) {}

    const fileName = `${safeAgentName}_${sessionId}_${safeTaskId}.md`;
    const filePath = path.join(dir, fileName);

    const timestamp = new Date().toISOString();

    const mdContent = `
# Task Progress: ${agentName}

**Task ID**: ${taskId}
**Session ID**: ${sessionId}
**Status**: ${status}
**Time**: ${timestamp}

## Task Description
${task.description}

${result ? `## Result\n${result}` : ""}
${error ? `## Error\n${error}` : ""}
`;

    try {
      await fs.writeFile(filePath, mdContent.trim());
    } catch (e) {
      logger.error(`Failed to write task progress file ${fileName}`, e);
    }
  }

  /**
   * Verify stage results using LLM to decide whether to retry failed tasks.
   */
  private async verifyStageResults(
    stage: SwarmStage,
    modelConfig: any,
    signal?: AbortSignal,
  ): Promise<{ retryTaskIds: string[]; abort: boolean; suggestion: string }> {
    const taskSummaries = stage.tasks.map((t) => {
      const status = (t as any).status || "unknown";
      const output = (t as any).output || "";
      return `- Task "${t.id}" (${t.assignedTo}): ${status}\n  Description: ${t.description}\n  Output: ${String(output).substring(0, 200)}`;
    }).join("\n");

    const verifyPrompt = `You are evaluating the results of a completed stage in a multi-agent task execution.

Stage: "${stage.name}"

Task Results:
${taskSummaries}

Decide:
1. Which failed tasks should be retried (max 1 retry each)?
2. Should we abort the entire mission?
3. Any suggestions for the retry?`;

    const verifySchema = {
      name: "stage_verification",
      schema: {
        type: "object",
        properties: {
          retryTaskIds: { type: "array", items: { type: "string" }, description: "IDs of failed tasks to retry" },
          abort: { type: "boolean", description: "True if mission should be aborted" },
          suggestion: { type: "string", description: "Suggestion for retry approach or abort reason" },
        },
        required: ["retryTaskIds", "abort", "suggestion"],
        additionalProperties: false,
      },
    };

    try {
      const response = await this.llmService.generateCompletion(
        [
          { role: "system", content: "You are a quality assurance agent. Evaluate task results and decide on retries. Only retry tasks that actually failed and have a reasonable chance of succeeding with a different approach. Do not retry tasks that failed due to fundamental impossibility." },
          { role: "user", content: verifyPrompt },
        ],
        { ...modelConfig, stream: false },
        true,
        undefined,
        undefined,
        signal,
        verifySchema,
      );

      if (!response) return { retryTaskIds: [], abort: false, suggestion: "Verification returned empty" };

      const cleanJson = response.replace(/```json\n?|\n?```/g, "").trim();
      const result = JSON.parse(cleanJson);
      return {
        retryTaskIds: Array.isArray(result.retryTaskIds) ? result.retryTaskIds : [],
        abort: !!result.abort,
        suggestion: result.suggestion || "",
      };
    } catch (e: any) {
      logger.error(`[TeamOrchestrator] Stage verification failed: ${e.message}`);
      return { retryTaskIds: [], abort: false, suggestion: "Verification error, continuing" };
    }
  }

  /**
   * Format a plan into a human-readable summary for approval Cards.
   */
  private formatPlanForApproval(plan: TeamPlan): string {
    const lines: string[] = [
      `## 📋 执行计划 — 等待确认\n`,
      `> 💡 **策略分析**: ${plan.thoughts}\n`,
      `---\n`,
      `### 👥 团队配置\n`,
      `| 角色 | 专长 | 工具 |`,
      `|------|------|------|`,
    ];

    for (const member of plan.roster) {
      const persona = member.persona.substring(0, 50).replace(/\|/g, "/");
      const tools = member.tools.slice(0, 4).join(", ") + (member.tools.length > 4 ? " ..." : "");
      lines.push(`| **${member.name}** | ${persona} | \`${tools}\` |`);
    }

    lines.push(`\n### 🚀 执行阶段\n`);

    plan.mission.forEach((stage, i) => {
      lines.push(`**阶段 ${i + 1}: ${stage.name}**\n`);
      for (const task of stage.tasks) {
        const desc = task.description.substring(0, 80);
        lines.push(`- 📌 **${task.assignedTo}**: ${desc}`);
      }
      lines.push("");
    });

    lines.push(`---`);
    lines.push(`\n> ⏳ 请回复 **"确认"** 开始执行，或 **"取消"** 放弃计划。`);

    return lines.join("\n");
  }

  /**
   * Validates and fixes stage structure to ensure dependent tasks are not
   * in the same parallel stage. Uses topological sort on task dependencies
   * to auto-split into correct sequential stages.
   */
  private validateAndFixStages(mission: SwarmStage[]): SwarmStage[] {
    // Collect all tasks across all stages
    const allTasks: TeamTask[] = [];
    for (const stage of mission) {
      allTasks.push(...stage.tasks);
    }

    if (allTasks.length <= 1) return mission;

    // Build a set of all task IDs for quick lookup
    const taskIdSet = new Set(allTasks.map((t) => t.id));

    // Check if any stage has tasks with intra-stage dependencies
    let needsFix = false;
    for (const stage of mission) {
      const stageTaskIds = new Set(stage.tasks.map((t) => t.id));
      for (const task of stage.tasks) {
        for (const dep of task.dependencies) {
          if (stageTaskIds.has(dep)) {
            // A task depends on another task in the SAME stage — invalid for parallel execution
            needsFix = true;
            logger.warn(
              `[TeamOrchestrator] Task "${task.id}" depends on "${dep}" but both are in stage "${stage.name}". Auto-fixing...`,
            );
            break;
          }
        }
        if (needsFix) break;
      }
      if (needsFix) break;
    }

    if (!needsFix) return mission;

    // Topological sort: assign each task a "level" based on its dependency depth
    const taskMap = new Map<string, TeamTask>();
    for (const task of allTasks) {
      taskMap.set(task.id, task);
    }

    const levels = new Map<string, number>();

    const getLevel = (taskId: string, visited: Set<string> = new Set()): number => {
      if (levels.has(taskId)) return levels.get(taskId)!;
      if (visited.has(taskId)) return 0; // Circular dependency guard
      visited.add(taskId);

      const task = taskMap.get(taskId);
      if (!task || task.dependencies.length === 0) {
        levels.set(taskId, 0);
        return 0;
      }

      let maxDepLevel = 0;
      for (const dep of task.dependencies) {
        if (taskIdSet.has(dep)) {
          maxDepLevel = Math.max(maxDepLevel, getLevel(dep, visited) + 1);
        }
      }

      levels.set(taskId, maxDepLevel);
      return maxDepLevel;
    };

    // Calculate level for every task
    for (const task of allTasks) {
      getLevel(task.id);
    }

    // Group tasks by level
    const levelGroups = new Map<number, TeamTask[]>();
    for (const task of allTasks) {
      const level = levels.get(task.id) || 0;
      if (!levelGroups.has(level)) {
        levelGroups.set(level, []);
      }
      levelGroups.get(level)!.push(task);
    }

    // Build new stages from level groups, sorted by level
    const sortedLevels = [...levelGroups.keys()].sort((a, b) => a - b);
    const newMission: SwarmStage[] = sortedLevels.map((level, index) => ({
      name: `Stage ${index + 1}`,
      tasks: levelGroups.get(level)!,
    }));

    logger.info(
      `[TeamOrchestrator] Auto-fixed stages: ${mission.length} stage(s) → ${newMission.length} stage(s)`,
    );

    return newMission;
  }
}
