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
    // 1. Tool Discovery
    const tools = await this.toolRegistry.getAllTools();
    const toolsDesc = tools
      .map((t) => `- ${t.name}: ${t.description}`)
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
      // Log tool assignment for verification
      logger.info(`Agent ${member.name} assigned tools:`, member.tools);

      // Create specialized agent
      const agent = this.agentFactory.createCustomAgent(
        member.name,
        member.persona, // Use the full persona as description/prompt base
        member.tools,
        tools, // Pass all tools for prompt generation
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
    const executionLog: string[] = [];

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
          // Provide context from previous tasks if needed
          let taskInput = task.description;
          if (executionLog.length > 0) {
            taskInput += `\n\n[Shared Team Context (Previous Results)]:\n${executionLog.slice(-3).join("\n")}`;
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

          const output = `[${task.assignedTo}]: ${result}`;
          logger.info(`Task Complete: ${task.id}`);

          // Update status and broadcast
          (task as any).status = "completed";
          (task as any).output = result;
          broadcastState();

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

          // Return full trace instead of just the final result
          const fullTrace = agent.getExecutionTrace();
          const detailedOutput = `### [Agent: ${task.assignedTo}]\n\n#### Task: ${task.description}\n\n${fullTrace}\n\n**Final Result**: ${result}`;
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

      results.push(...stageResults);
      executionLog.push(...stageResults);
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
