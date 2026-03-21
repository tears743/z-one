/**
 * Z-One Workflow Planner — Conversational workflow creation and self-reflection.
 *
 * Responsibilities:
 * 1. Multi-turn dialogue to understand user intent and generate a DAG workflow
 * 2. Self-reflection after execution to identify improvements
 * 3. Version management for iterative refinement
 */

import { v4 as uuid } from "uuid";
import {
  WorkflowDefinition,
  WorkflowRun,
  WorkflowNode,
  WorkflowEdge,
} from "./types";
import * as store from "./store";
import { LLMService } from "../model/llm-service";
import { ToolRegistry } from "../execution/tool-registry";
import { AgentMessage } from "../agent/types";
import { logger } from "../logger";

// ─── System Prompts ─────────────────────────────────────────────────────────

const WORKFLOW_PLANNER_SYSTEM_PROMPT = `You are the Workflow Architect of Z-One, an AI Agent System.
Your job is to design executable workflow DAGs (Directed Acyclic Graphs) from user requests.

## Node Types
- **task**: An agent executes a task. Config: { agentPersona, prompt, suggestedTools? }
  - Each agent has FULL access to all available tools via tool discovery.
  - Each agent can CREATE new tools at runtime if needed.
  - "suggestedTools" is OPTIONAL — only use it to hint preferred tools and save tokens. Never restrict agents to only those tools.
- **condition**: Evaluates an expression and routes to different branches. Config: { expression, branches: [{label, edgeId}] }
- **loop**: Repeatedly executes body nodes until exit condition is met. Config: { maxIterations, exitCondition, intervalMs?, bodyNodeIds }
- **gateway**: Joins multiple branches. Config: { mode: "all"|"any" }

## Rules
1. ALWAYS discuss the workflow plan with the user first. Describe the proposed nodes, their purposes, and the data flow between them. Ask if the user wants to adjust anything.
2. ONLY generate the JSON workflow after the user explicitly confirms (e.g., "确认", "好的", "可以", "生成", "就这样").
3. If the user says "直接生成" or "不要问问题", skip discussion and generate immediately.
4. Use {{nodeId.output}} template syntax to reference outputs from previous nodes.
5. Give each node a clear, short Chinese label.
6. Position nodes with x/y coordinates for visualization (top-to-bottom layout, start at y=50, increment ~150px).
7. Use the user's language (Chinese/English) for communication.

## Complete Example

When the user confirms, output ONLY a JSON code block:

\`\`\`json
{
  "name": "竞品价格监控",
  "description": "每小时检查竞品价格变化并通知",
  "nodes": [
    {
      "id": "n1", "type": "task", "label": "抓取价格数据",
      "config": { "agentPersona": "数据采集专家", "prompt": "从指定网站抓取竞品价格数据，记录当前价格和历史价格" },
      "position": { "x": 200, "y": 50 }
    },
    {
      "id": "n2", "type": "condition", "label": "价格是否变化",
      "config": {
        "expression": "priceChanged",
        "branches": [
          { "label": "有变化", "edgeId": "e2" },
          { "label": "无变化", "edgeId": "e3" }
        ]
      },
      "position": { "x": 200, "y": 200 }
    },
    {
      "id": "n3", "type": "task", "label": "发送通知",
      "config": { "agentPersona": "通知专员", "prompt": "将价格变动 {{n1.output}} 整理成报告并通知用户" },
      "position": { "x": 100, "y": 350 }
    },
    {
      "id": "n4", "type": "task", "label": "记录日志",
      "config": { "agentPersona": "日志记录员", "prompt": "记录本次价格检查结果 {{n1.output}}" },
      "position": { "x": 300, "y": 350 }
    }
  ],
  "edges": [
    { "id": "e1", "source": "n1", "target": "n2" },
    { "id": "e2", "source": "n2", "target": "n3", "condition": "有变化" },
    { "id": "e3", "source": "n2", "target": "n4", "condition": "无变化" }
  ]
}
\`\`\`
`;

const REFLECTION_SYSTEM_PROMPT = `You are a Workflow Optimizer. Analyze the execution results and determine if the workflow needs improvement.

Analyze:
1. Which nodes failed? Why?
2. Are the outputs as expected?
3. Should any nodes be added, removed, or modified?
4. Are loop exit conditions and iteration limits appropriate?
5. Are condition expressions accurate?

If changes are needed, output a modified workflow definition JSON.
If no changes needed, respond with: {"shouldRefine": false, "reasoning": "explanation"}
If changes needed, respond with: {"shouldRefine": true, "reasoning": "explanation", "workflow": {...updated definition...}}
`;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface WorkflowPlanResult {
  /** Whether the planner needs more info from the user */
  needsClarification: boolean;
  /** Question to ask the user (if needsClarification) */
  clarificationQuestion?: string;
  /** The generated/modified workflow (if ready) */
  workflow?: WorkflowDefinition;
  /** What changed (for version updates) */
  changelog?: string;
  /** Human-readable summary of the plan */
  summary?: string;
}

export interface ReflectionResult {
  shouldRefine: boolean;
  refinedWorkflow?: WorkflowDefinition;
  reasoning: string;
}

// ─── WorkflowPlanner ────────────────────────────────────────────────────────

export class WorkflowPlanner {
  private llmService: LLMService;
  private toolRegistry: ToolRegistry;

  constructor(llmService: LLMService, toolRegistry: ToolRegistry) {
    this.llmService = llmService;
    this.toolRegistry = toolRegistry;
  }

  /**
   * Plan a new workflow or refine an existing one through conversation.
   */
  async planOrRefine(
    userRequest: string,
    conversationHistory: AgentMessage[],
    sourceDeviceId: string,
    sourceSessionId: string,
    modelConfig: any,
    existingWorkflow?: WorkflowDefinition,
    onStream?: (chunk: string) => void,
  ): Promise<WorkflowPlanResult> {
    // Get available tools for context
    const allTools = await this.toolRegistry.getAllTools();
    const toolsDesc = allTools
      .map((t) => `- ${t.name}: ${(t.description || "").substring(0, 60)}`)
      .join("\n");

    // Build the messages
    const messages: any[] = [
      { role: "system", content: WORKFLOW_PLANNER_SYSTEM_PROMPT },
    ];

    // Add conversation history (skip system messages)
    for (const msg of conversationHistory) {
      if (msg.role !== "system") {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    // Build the user prompt
    let userPrompt = userRequest;
    if (existingWorkflow) {
      userPrompt += `\n\n[Existing Workflow to Modify]:\n${JSON.stringify(existingWorkflow, null, 2)}`;
    }
    userPrompt += `\n\n[Available Tools]:\n${toolsDesc}`;

    messages.push({ role: "user", content: userPrompt });

    // Call LLM
    let fullResponse = "";
    const response = await this.llmService.generateCompletion(
      messages,
      { ...modelConfig, stream: !!onStream },
      false,
      (chunk: string) => {
        fullResponse += chunk;
        if (onStream) onStream(chunk);
      },
    );

    fullResponse = response || fullResponse;

    // Try to extract JSON workflow from response
    const jsonMatch = fullResponse.match(/```json\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1].trim());
        const workflow = this.buildWorkflowDefinition(
          parsed,
          sourceDeviceId,
          sourceSessionId,
          existingWorkflow,
        );

        const changelog = existingWorkflow
          ? `Refined from v${existingWorkflow.version}: ${userRequest.substring(0, 100)}`
          : "Initial version";

        // Save to store
        let savedWorkflow: WorkflowDefinition;
        if (existingWorkflow) {
          savedWorkflow = store.updateWorkflow(workflow, changelog);
        } else {
          savedWorkflow = store.createWorkflow(workflow);
        }

        // Remove the JSON from summary (user already sees the workflow in UI)
        const summary = fullResponse.replace(/```json[\s\S]*?```/, "").trim();

        return {
          needsClarification: false,
          workflow: savedWorkflow,
          changelog,
          summary: summary || `Workflow "${savedWorkflow.name}" created.`,
        };
      } catch (e) {
        logger.error("[WorkflowPlanner] Failed to parse workflow JSON:", e);
        // Fall through to clarification
      }
    }

    // No valid JSON found — the planner is still discussing
    return {
      needsClarification: true,
      clarificationQuestion: fullResponse,
    };
  }

  /**
   * Reflect on a completed/failed workflow run and suggest improvements.
   */
  async reflectAndRefine(
    workflow: WorkflowDefinition,
    run: WorkflowRun,
    modelConfig: any,
  ): Promise<ReflectionResult> {
    // Build execution summary
    const executionSummary = Object.entries(run.nodeStates).map(([nodeId, state]) => {
      const node = workflow.nodes.find((n) => n.id === nodeId);
      return {
        nodeId,
        label: node?.label || nodeId,
        type: node?.type,
        status: state.status,
        output: state.output ? JSON.stringify(state.output).substring(0, 200) : null,
        logs: state.logs.slice(-5), // Last 5 logs
        iterations: state.iterations,
      };
    });

    const response = await this.llmService.generateCompletion(
      [
        { role: "system", content: REFLECTION_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Workflow: ${JSON.stringify(workflow, null, 2)}\n\nExecution Results:\n${JSON.stringify(executionSummary, null, 2)}`,
        },
      ],
      { ...modelConfig, stream: false },
    );

    if (!response) {
      return { shouldRefine: false, reasoning: "No response from reflection." };
    }

    try {
      const cleanJson = response.replace(/```json\n?|\n?```/g, "").trim();
      const result = JSON.parse(cleanJson);

      if (result.shouldRefine && result.workflow) {
        const refined = this.buildWorkflowDefinition(
          result.workflow,
          workflow.sourceDeviceId,
          workflow.sourceSessionId,
          workflow,
        );
        const savedWorkflow = store.updateWorkflow(refined, `Auto-refined: ${result.reasoning.substring(0, 100)}`);

        return {
          shouldRefine: true,
          refinedWorkflow: savedWorkflow,
          reasoning: result.reasoning,
        };
      }

      return {
        shouldRefine: false,
        reasoning: result.reasoning || "No improvements needed.",
      };
    } catch (e) {
      logger.warn("[WorkflowPlanner] Failed to parse reflection response:", e);
      return { shouldRefine: false, reasoning: response.substring(0, 200) };
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  private buildWorkflowDefinition(
    parsed: any,
    sourceDeviceId: string,
    sourceSessionId: string,
    existing?: WorkflowDefinition,
  ): WorkflowDefinition {
    const now = Date.now();

    // Ensure all nodes have IDs
    const nodes: WorkflowNode[] = (parsed.nodes || []).map((n: any, i: number) => ({
      id: n.id || `node_${i + 1}`,
      type: n.type || "task",
      label: n.label || `Node ${i + 1}`,
      config: n.config || {},
      position: n.position || { x: 200, y: i * 150 },
    }));

    // Ensure all edges have IDs
    const edges: WorkflowEdge[] = (parsed.edges || []).map((e: any, i: number) => ({
      id: e.id || `edge_${i + 1}`,
      source: e.source,
      target: e.target,
      condition: e.condition,
    }));

    return {
      id: existing?.id || uuid(),
      name: parsed.name || existing?.name || "Untitled Workflow",
      description: parsed.description || existing?.description || "",
      version: existing ? existing.version : 1,
      nodes,
      edges,
      sourceDeviceId,
      sourceSessionId,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
  }
}
