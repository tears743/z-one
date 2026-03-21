/**
 * Z-One Workflow Engine — DAG-based execution engine with task, condition, loop, and gateway support.
 */

import { EventEmitter } from "events";
import { v4 as uuid } from "uuid";
import {
  WorkflowDefinition,
  WorkflowNode,
  WorkflowEdge,
  WorkflowRun,
  NodeRun,
  NodeStatus,
  WorkflowStatus,
  TaskConfig,
  ConditionConfig,
  LoopConfig,
  GatewayConfig,
  WorkflowEvent,
  WorkflowEventType,
} from "./types";
import * as store from "./store";
import { AgentFactory } from "../agent/factory";
import { LLMService } from "../model/llm-service";
import { ToolRegistry } from "../execution/tool-registry";
import { logger } from "../logger";

export class WorkflowEngine extends EventEmitter {
  private llmService: LLMService;
  private toolRegistry: ToolRegistry;
  private agentFactory: AgentFactory;
  /** Active runs being executed (in-memory handles) */
  private activeRuns: Map<string, { abortController: AbortController }> = new Map();

  constructor(
    llmService: LLMService,
    toolRegistry: ToolRegistry,
    agentFactory: AgentFactory,
  ) {
    super();
    this.llmService = llmService;
    this.toolRegistry = toolRegistry;
    this.agentFactory = agentFactory;
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────

  /**
   * Start a workflow and begin execution in the background.
   */
  async startWorkflow(
    workflowId: string,
    modelConfig: any,
  ): Promise<WorkflowRun> {
    const workflow = store.getWorkflow(workflowId);
    if (!workflow) throw new Error(`Workflow ${workflowId} not found`);

    const run = store.createRun(workflowId, workflow);
    this.emitEvent("workflow:started", workflowId, run.id);

    // Execute in background (non-blocking)
    const abortController = new AbortController();
    this.activeRuns.set(run.id, { abortController });

    this.executeWorkflow(workflow, run.id, modelConfig, abortController.signal)
      .catch((err) => {
        logger.error(`[WorkflowEngine] Run ${run.id} failed:`, err);
        store.updateRunStatus(run.id, "failed");
        this.emitEvent("workflow:failed", workflowId, run.id, undefined, { error: err.message });
      })
      .finally(() => {
        this.activeRuns.delete(run.id);
      });

    return run;
  }

  /**
   * Pause a running workflow.
   */
  pauseWorkflow(runId: string) {
    const handle = this.activeRuns.get(runId);
    if (handle) {
      handle.abortController.abort();
      this.activeRuns.delete(runId);
    }
    store.updateRunStatus(runId, "paused");
    const run = store.getRun(runId);
    if (run) this.emitEvent("workflow:paused", run.workflowId, runId);
  }

  /**
   * Resume a paused workflow.
   */
  async resumeWorkflow(runId: string, modelConfig: any) {
    const run = store.getRun(runId);
    if (!run) throw new Error(`Run ${runId} not found`);
    if (run.status !== "paused") throw new Error(`Run ${runId} is not paused (status: ${run.status})`);

    const workflow = store.getWorkflow(run.workflowId);
    if (!workflow) throw new Error(`Workflow ${run.workflowId} not found`);

    store.updateRunStatus(runId, "running");
    this.emitEvent("workflow:resumed", run.workflowId, runId);

    const abortController = new AbortController();
    this.activeRuns.set(runId, { abortController });

    this.executeWorkflow(workflow, runId, modelConfig, abortController.signal)
      .catch((err) => {
        logger.error(`[WorkflowEngine] Resumed run ${runId} failed:`, err);
        store.updateRunStatus(runId, "failed");
        this.emitEvent("workflow:failed", run.workflowId, runId, undefined, { error: err.message });
      })
      .finally(() => {
        this.activeRuns.delete(runId);
      });
  }

  /**
   * Inject a user message into a node's message queue.
   */
  injectMessage(runId: string, nodeId: string, message: string) {
    store.injectMessage(runId, nodeId, message);
    const run = store.getRun(runId);
    if (run) {
      this.emitEvent("node:messageInjected", run.workflowId, runId, nodeId, { message });
    }
  }

  // ─── Core Execution Loop ─────────────────────────────────────────────

  private async executeWorkflow(
    workflow: WorkflowDefinition,
    runId: string,
    modelConfig: any,
    signal: AbortSignal,
  ) {
    logger.info(`[WorkflowEngine] Starting execution of workflow "${workflow.name}" (run: ${runId})`);

    while (!signal.aborted) {
      const run = store.getRun(runId);
      if (!run || run.status !== "running") break;

      // Find nodes that are ready to execute
      const readyNodes = this.findReadyNodes(workflow, run);
      if (readyNodes.length === 0) {
        // Check if all nodes are done (completed/failed/skipped)
        const allDone = workflow.nodes.every((n) => {
          const state = run.nodeStates[n.id];
          return state && ["completed", "failed", "skipped"].includes(state.status);
        });

        if (allDone) {
          store.updateRunStatus(runId, "completed");
          
          // Collect node outputs summary for auto-report
          const outputSummary: Record<string, any> = {};
          for (const node of workflow.nodes) {
            const state = run.nodeStates[node.id];
            if (state?.output) {
              outputSummary[node.label] = typeof state.output === "string" 
                ? state.output.substring(0, 500)
                : state.output;
            }
          }
          
          this.emitEvent("workflow:completed", workflow.id, runId, undefined, {
            workflowName: workflow.name,
            sourceSessionId: workflow.sourceSessionId,
            outputSummary,
          });
          logger.info(`[WorkflowEngine] Workflow "${workflow.name}" completed.`);
          return;
        }

        // Some nodes are still waiting — wait a bit then re-check
        await this.sleep(1000);
        continue;
      }

      // Execute ready nodes in parallel
      const promises = readyNodes.map((node) =>
        this.executeNode(workflow, run, node, runId, modelConfig, signal),
      );

      await Promise.allSettled(promises);
    }

    if (signal.aborted) {
      logger.info(`[WorkflowEngine] Run ${runId} was paused/aborted.`);
    }
  }

  /**
   * Find nodes whose dependencies are all satisfied and status is "pending".
   */
  private findReadyNodes(workflow: WorkflowDefinition, run: WorkflowRun): WorkflowNode[] {
    const ready: WorkflowNode[] = [];

    for (const node of workflow.nodes) {
      const state = run.nodeStates[node.id];
      if (!state || state.status !== "pending") continue;

      // Find all incoming edges to this node
      const incomingEdges = workflow.edges.filter((e) => e.target === node.id);

      if (incomingEdges.length === 0) {
        // Start node — no dependencies
        ready.push(node);
        continue;
      }

      // Check if all source nodes of incoming edges are completed
      const allSourcesDone = incomingEdges.every((edge) => {
        const sourceState = run.nodeStates[edge.source];
        return sourceState && sourceState.status === "completed";
      });

      // For gateway nodes with 'any' mode, just need one source done
      if (node.type === "gateway") {
        const config = node.config as GatewayConfig;
        if (config.mode === "any") {
          const anySourceDone = incomingEdges.some((edge) => {
            const sourceState = run.nodeStates[edge.source];
            return sourceState && sourceState.status === "completed";
          });
          if (anySourceDone) ready.push(node);
          continue;
        }
      }

      if (allSourcesDone) {
        ready.push(node);
      }
    }

    return ready;
  }

  // ─── Node Execution ───────────────────────────────────────────────────

  private async executeNode(
    workflow: WorkflowDefinition,
    run: WorkflowRun,
    node: WorkflowNode,
    runId: string,
    modelConfig: any,
    signal: AbortSignal,
  ) {
    logger.info(`[WorkflowEngine] Executing node "${node.label}" (${node.type})`);

    store.updateNodeStatus(runId, node.id, "running");
    this.emitEvent("node:started", workflow.id, runId, node.id);

    try {
      let output: any;

      switch (node.type) {
        case "task":
          output = await this.executeTaskNode(workflow, runId, node, modelConfig, signal);
          break;
        case "condition":
          output = await this.executeConditionNode(workflow, runId, node, modelConfig);
          break;
        case "loop":
          output = await this.executeLoopNode(workflow, runId, node, modelConfig, signal);
          break;
        case "gateway":
          output = await this.executeGatewayNode(runId, node);
          break;
      }

      store.updateNodeOutput(runId, node.id, output);
      store.updateNodeStatus(runId, node.id, "completed");
      store.appendNodeLog(runId, node.id, `Completed with output: ${JSON.stringify(output).substring(0, 200)}`);

      // Update run context with this node's output
      const currentRun = store.getRun(runId);
      if (currentRun) {
        currentRun.context[node.id] = output;
        store.updateRunContext(runId, currentRun.context);
      }

      this.emitEvent("node:completed", workflow.id, runId, node.id, { output });

      // Handle condition node routing: skip branches not taken
      if (node.type === "condition" && output?.selectedBranch) {
        this.routeConditionBranches(workflow, runId, node, output.selectedBranch);
      }

    } catch (err: any) {
      // AbortError is expected when workflow is paused — don't treat as failure
      if (err.name === "AbortError" || err.message?.includes("aborted")) {
        logger.info(`[WorkflowEngine] Node "${node.label}" was paused/aborted.`);
        store.appendNodeLog(runId, node.id, `Paused: operation aborted`);
        // Don't mark as failed — keep current status so it can be resumed
        return;
      }
      logger.error(`[WorkflowEngine] Node "${node.label}" failed:`, err);
      store.appendNodeLog(runId, node.id, `Failed: ${err.message}`);
      store.updateNodeStatus(runId, node.id, "failed");
      this.emitEvent("node:failed", workflow.id, runId, node.id, { error: err.message });
    }
  }

  // ─── Task Node ────────────────────────────────────────────────────────

  private async executeTaskNode(
    workflow: WorkflowDefinition,
    runId: string,
    node: WorkflowNode,
    modelConfig: any,
    signal: AbortSignal,
  ): Promise<any> {
    const config = node.config as TaskConfig;

    // Drain any injected messages
    const injectedMessages = store.drainMessageQueue(runId, node.id);

    // Resolve template variables in prompt: {{nodeId.output}}
    let resolvedPrompt = config.prompt;
    const currentRun = store.getRun(runId);
    if (currentRun) {
      resolvedPrompt = this.resolveTemplate(resolvedPrompt, currentRun.context);
    }

    // Add injected context
    if (injectedMessages.length > 0) {
      resolvedPrompt += `\n\n[User Injected Context]:\n${injectedMessages.join("\n")}`;
    }

    store.appendNodeLog(runId, node.id, `Starting task agent with prompt: ${resolvedPrompt.substring(0, 100)}...`);

    // Get ALL available tools for capability discovery + prompt building
    const allTools = await this.toolRegistry.getAllTools();

    // Merge explicitly assigned tools + suggested tools
    const requestedToolNames = [
      ...(config.tools || []),
      ...(config.suggestedTools || []),
    ];

    // Build effective tool names — always include capability discovery
    let agentToolNames: string[] = [...requestedToolNames];
    const discoveryTools = ["list_capabilities", "get_capability_detail"];

    // Always add capability discovery tools so agents can find more tools at runtime
    for (const dt of discoveryTools) {
      if (!agentToolNames.includes(dt)) {
        agentToolNames.push(dt);
      }
    }

    // Filter allTools to get definitions for the agent's tools
    const agentToolDefs = allTools.filter((t) => agentToolNames.includes(t.name));

    const missing = requestedToolNames.filter(n => !allTools.find(t => t.name === n));
    if (missing.length > 0) {
      logger.warn(`[WorkflowEngine] Node "${node.label}" requested tools not found in registry: ${missing.join(", ")}`);
    }
    logger.info(`[WorkflowEngine] Node "${node.label}" tools resolved: ${agentToolDefs.map(t => t.name).join(", ")} (${agentToolDefs.length} total)`);

    // Build persona
    const persona = config.agentPersona || "You are a helpful assistant executing a workflow task.";

    // Create agent with resolved tools — always pass allTools as available tools
    // so the prompt builder can include proper tool descriptions
    const agent = this.agentFactory.createCustomAgent(
      `WF-${node.label}`,
      persona,
      agentToolNames,
      allTools,  // Pass ALL tools so createCustomAgent can find definitions
      undefined,
      { ...modelConfig, stream: false },
    );
    agent.config.modelConfig = { ...modelConfig, stream: false };

    // Execute
    let result = "";
    const output = await agent.process(
      resolvedPrompt,
      (chunk) => {
        if (typeof chunk === "string") {
          result += chunk;
          store.appendNodeLog(runId, node.id, chunk.substring(0, 200));
        }
      },
      undefined,
      signal,
    );

    return output || result;
  }

  // ─── Condition Node ───────────────────────────────────────────────────

  private async executeConditionNode(
    workflow: WorkflowDefinition,
    runId: string,
    node: WorkflowNode,
    modelConfig: any,
  ): Promise<any> {
    const config = node.config as ConditionConfig;

    // Resolve expression with context
    const currentRun = store.getRun(runId);
    const resolvedExpr = currentRun
      ? this.resolveTemplate(config.expression, currentRun.context)
      : config.expression;

    store.appendNodeLog(runId, node.id, `Evaluating condition: ${resolvedExpr}`);

    // Use LLM to evaluate the condition
    const branchLabels = config.branches.map((b) => b.label).join(", ");
    const response = await this.llmService.generateCompletion(
      [
        {
          role: "system",
          content: `You are a condition evaluator. Given the expression and context, determine which branch to take. Respond with ONLY one of these labels: ${branchLabels}`,
        },
        {
          role: "user",
          content: `Expression: ${resolvedExpr}\n\nContext:\n${JSON.stringify(currentRun?.context || {}, null, 2)}`,
        },
      ],
      { ...modelConfig, stream: false },
    );

    const selectedBranch = response?.trim() || config.branches[0]?.label || "true";
    store.appendNodeLog(runId, node.id, `Condition result: "${selectedBranch}"`);

    return { selectedBranch, expression: resolvedExpr };
  }

  /**
   * After a condition node completes, skip edges/targets for branches not taken.
   */
  private routeConditionBranches(
    workflow: WorkflowDefinition,
    runId: string,
    node: WorkflowNode,
    selectedBranch: string,
  ) {
    const config = node.config as ConditionConfig;
    const outEdges = workflow.edges.filter((e) => e.source === node.id);

    for (const edge of outEdges) {
      const branchDef = config.branches.find((b) => b.edgeId === edge.id);
      // If this edge is NOT the selected branch, skip its target
      if (branchDef && branchDef.label !== selectedBranch) {
        store.updateNodeStatus(runId, edge.target, "skipped");
        store.appendNodeLog(runId, edge.target, `Skipped: condition took branch "${selectedBranch}"`);
        // Also skip any downstream nodes only reachable from this skipped node
        this.skipDownstream(workflow, runId, edge.target);
      }
    }
  }

  /**
   * Recursively skip downstream nodes that are only reachable from a skipped node.
   */
  private skipDownstream(
    workflow: WorkflowDefinition,
    runId: string,
    nodeId: string,
  ) {
    const outEdges = workflow.edges.filter((e) => e.source === nodeId);
    for (const edge of outEdges) {
      const run = store.getRun(runId);
      if (!run) break;
      const targetState = run.nodeStates[edge.target];
      if (targetState && targetState.status === "pending") {
        // Check if ALL incoming edges to this target come from skipped nodes
        const allIncoming = workflow.edges.filter((e) => e.target === edge.target);
        const allSkipped = allIncoming.every((ie) => {
          const sourceState = run.nodeStates[ie.source];
          return sourceState && sourceState.status === "skipped";
        });
        if (allSkipped) {
          store.updateNodeStatus(runId, edge.target, "skipped");
          store.appendNodeLog(runId, edge.target, "Skipped: all incoming branches were skipped");
          this.skipDownstream(workflow, runId, edge.target);
        }
      }
    }
  }

  // ─── Loop Node ────────────────────────────────────────────────────────

  private async executeLoopNode(
    workflow: WorkflowDefinition,
    runId: string,
    node: WorkflowNode,
    modelConfig: any,
    signal: AbortSignal,
  ): Promise<any> {
    const config = node.config as LoopConfig;
    let iteration = 0;
    let lastResult: any = null;

    store.appendNodeLog(runId, node.id, `Starting loop (max: ${config.maxIterations || "∞"})`);

    while (!signal.aborted) {
      iteration++;
      store.updateNodeIterations(runId, node.id, iteration);
      store.appendNodeLog(runId, node.id, `--- Loop iteration ${iteration} ---`);

      // Drain injected messages each iteration
      const injectedMessages = store.drainMessageQueue(runId, node.id);
      if (injectedMessages.length > 0) {
        store.appendNodeLog(runId, node.id, `Received ${injectedMessages.length} injected messages`);
      }

      // Execute body nodes sequentially within loop
      for (const bodyNodeId of config.bodyNodeIds) {
        if (signal.aborted) break;

        const bodyNode = workflow.nodes.find((n) => n.id === bodyNodeId);
        if (!bodyNode) continue;

        // Reset body node state for this iteration
        store.updateNodeStatus(runId, bodyNodeId, "pending");

        // Execute the body node
        const bodyRun = store.getRun(runId);
        if (!bodyRun) break;

        await this.executeNode(workflow, bodyRun, bodyNode, runId, modelConfig, signal);

        // Get output
        const updatedRun = store.getRun(runId);
        if (updatedRun) {
          lastResult = updatedRun.nodeStates[bodyNodeId]?.output;
        }
      }

      // Check exit condition
      const currentRun = store.getRun(runId);
      const shouldExit = await this.evaluateExitCondition(
        config.exitCondition,
        currentRun?.context || {},
        lastResult,
        modelConfig,
      );

      if (shouldExit) {
        store.appendNodeLog(runId, node.id, `Loop exiting: exit condition met after ${iteration} iterations`);
        break;
      }

      // Check max iterations
      if (config.maxIterations > 0 && iteration >= config.maxIterations) {
        store.appendNodeLog(runId, node.id, `Loop exiting: max iterations (${config.maxIterations}) reached`);
        break;
      }

      // Wait interval if specified (for polling tasks)
      if (config.intervalMs && config.intervalMs > 0) {
        store.appendNodeLog(runId, node.id, `Waiting ${config.intervalMs}ms before next iteration...`);
        await this.sleep(config.intervalMs);
      }
    }

    return { iterations: iteration, lastResult };
  }

  private async evaluateExitCondition(
    exitCondition: string,
    context: Record<string, any>,
    lastResult: any,
    modelConfig: any,
  ): Promise<boolean> {
    if (!exitCondition) return false;

    const response = await this.llmService.generateCompletion(
      [
        {
          role: "system",
          content: "You are a condition evaluator. Return EXACTLY 'true' or 'false' (nothing else).",
        },
        {
          role: "user",
          content: `Exit condition: ${exitCondition}\n\nContext: ${JSON.stringify(context)}\n\nLast result: ${JSON.stringify(lastResult)}`,
        },
      ],
      { ...modelConfig, stream: false },
    );

    return response?.trim().toLowerCase() === "true";
  }

  // ─── Gateway Node ─────────────────────────────────────────────────────

  private async executeGatewayNode(
    runId: string,
    node: WorkflowNode,
  ): Promise<any> {
    // Gateway just passes through — its readiness is handled by findReadyNodes
    const config = node.config as GatewayConfig;
    store.appendNodeLog(runId, node.id, `Gateway (${config.mode}) passed — all required branches completed`);
    return { mode: config.mode, passed: true };
  }

  // ─── Utilities ────────────────────────────────────────────────────────

  /**
   * Resolve template variables like {{nodeId.output}} in a string.
   */
  private resolveTemplate(template: string, context: Record<string, any>): string {
    return template.replace(/\{\{(\w+)\.output\}\}/g, (match, nodeId) => {
      const value = context[nodeId];
      if (value === undefined) return match;
      return typeof value === "string" ? value : JSON.stringify(value);
    });
  }

  private emitEvent(
    type: WorkflowEventType,
    workflowId: string,
    runId: string,
    nodeId?: string,
    data?: any,
  ) {
    const event: WorkflowEvent = {
      type,
      workflowId,
      runId,
      nodeId,
      data,
      timestamp: Date.now(),
    };
    this.emit("workflowEvent", event);
    this.emit(type, event);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
