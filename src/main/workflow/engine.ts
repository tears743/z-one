/**
 * Workflow Engine — DAG Execution
 *
 * Executes workflows by traversing the DAG in topological order.
 * Supports: task nodes (agent execution), condition branching,
 * loop iteration, gateway (parallel/join), message injection,
 * pause/resume, and real-time event emission.
 */

import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import {
  WorkflowDefinition,
  WorkflowRun,
  WorkflowNode,
  WorkflowEdge,
  NodeRun,
  WorkflowEvent,
  WorkflowEventType,
  RunStatus,
  NodeRunStatus,
  AgentContextMessage,
  SubAgentConfig,
} from './types';
import * as store from './store';
import { logger } from '../logger';
import { AgentFactory } from '../agent/factory';
import { ToolRegistry } from '../execution/tool-registry';
import { LLMService } from '../model/llm-service';
import { Agent } from '../agent/agent';
import { getAppSettings, getModels } from '../db';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { setUserInputContext, clearUserInputContext } from '../execution/tools/user-input';
import { setWfCtxContext, clearWfCtxContext } from '../execution/tools/workflow-context';

export class WorkflowEngine extends EventEmitter {
  private agentFactory: AgentFactory;
  private toolRegistry: ToolRegistry;
  private llmService: LLMService;

  /** Active runs keyed by runId, holding abort controllers */
  private activeRuns: Map<string, { abort: AbortController; paused: boolean; run: WorkflowRun }> = new Map();

  /** Live Agent instances per run, keyed by `${runId}:${nodeId}` */
  private liveAgents: Map<string, Agent> = new Map();

  /** Pending user input requests, keyed by `${runId}:${nodeId}` */
  private pendingInputs: Map<string, { resolve: (input: string) => void; prompt: string }> = new Map();

  constructor(llmService: LLMService, toolRegistry: ToolRegistry, agentFactory: AgentFactory) {
    super();
    this.llmService = llmService;
    this.toolRegistry = toolRegistry;
    this.agentFactory = agentFactory;
  }

  // ─── Public API ─────────────────────────────────────────

  /**
   * Start a new run for a workflow.
   */
  public async startRun(workflowId: string, sourceDeviceId?: string, sourceSessionId?: string): Promise<WorkflowRun> {
    const workflow = store.getWorkflow(workflowId);
    if (!workflow) throw new Error(`Workflow ${workflowId} not found`);

    const run: WorkflowRun = {
      id: randomUUID(),
      workflowId,
      status: 'running',
      context: {},
      nodeStates: {},
      workflowVersion: workflow.version,
      startedAt: Date.now(),
      sourceDeviceId,
      sourceSessionId,
    };

    // Initialize node states in memory first
    for (const node of workflow.nodes) {
      const nodeRun: NodeRun = {
        id: randomUUID(),
        runId: run.id,
        nodeId: node.id,
        status: 'pending',
        iteration: 0,
        logs: [],
        messageQueue: [],
      };
      run.nodeStates[node.id] = nodeRun;
    }

    // Save run first (parent), then node runs (children) — FK constraint requires this order
    store.saveRun(run);
    for (const nodeRun of Object.values(run.nodeStates)) {
      store.saveNodeRun(nodeRun);
    }
    store.updateWorkflowStatus(workflowId, 'active');

    const abortController = new AbortController();
    this.activeRuns.set(run.id, { abort: abortController, paused: false, run });

    this.emitEvent('run:started', run.id);

    // Execute in background
    this.executeRun(workflow, run, abortController.signal).catch(err => {
      logger.error(`[WorkflowEngine] Run ${run.id} failed:`, err);
    });

    return run;
  }

  /**
   * Pause a running workflow.
   */
  public pauseRun(runId: string): boolean {
    const active = this.activeRuns.get(runId);
    if (!active) return false;
    active.paused = true;
    store.updateRunStatus(runId, 'paused');
    this.emitEvent('run:paused', runId);
    return true;
  }

  /**
   * Resume a paused workflow.
   */
  public resumeRun(runId: string): boolean {
    const active = this.activeRuns.get(runId);
    if (!active || !active.paused) return false;
    active.paused = false;
    store.updateRunStatus(runId, 'running');
    // The execution loop checks `paused` flag and will resume
    return true;
  }

  /**
   * Cancel a running workflow.
   */
  public cancelRun(runId: string): boolean {
    const active = this.activeRuns.get(runId);
    if (!active) return false;
    active.abort.abort();
    store.updateRunStatus(runId, 'cancelled', Date.now());
    this.activeRuns.delete(runId);
    return true;
  }

  /**
   * Inject a message into a specific node's context.
   * If the node is running, the message will be picked up on the next iteration.
   * If pending, it will be delivered when the node starts.
   */
  public injectMessage(runId: string, nodeId: string, content: string, source: string = 'user'): boolean {
    const run = store.getRun(runId);
    if (!run) return false;

    const nodeState = run.nodeStates[nodeId];
    if (!nodeState) return false;

    const message: AgentContextMessage = {
      role: 'user',
      content,
      timestamp: Date.now(),
      source,
    };

    store.injectNodeMessage(nodeState.id, message);
    this.emitEvent('node:message_injected', runId, nodeId, { message });
    return true;
  }

  /**
   * Get logs for a specific node in a run.
   */
  public getNodeLogs(runId: string, nodeId: string): string[] {
    const run = store.getRun(runId);
    if (!run) return [];
    const nodeState = run.nodeStates[nodeId];
    if (!nodeState) return [];
    // Fetch fresh from DB
    const freshNodeRun = store.getNodeRun(nodeState.id);
    return freshNodeRun?.logs || [];
  }

  /**
   * Get the live Agent instance for a node (for conversation injection).
   */
  public getLiveAgent(runId: string, nodeId: string): Agent | undefined {
    return this.liveAgents.get(`${runId}:${nodeId}`);
  }

  /**
   * Request user input — blocks until submitInput() is called.
   * Called by the request_user_input tool during agent execution.
   */
  public async requestInput(runId: string, nodeId: string, prompt: string): Promise<string> {
    const key = `${runId}:${nodeId}`;

    // Update node status to waiting_input
    const run = store.getRun(runId);
    if (run) {
      await this.updateNodeState(run, nodeId, 'waiting_input');
    }

    this.emitEvent('node:waiting_input', runId, nodeId, { prompt });
    this.appendLog(run!, nodeId, `**Waiting for user input**: ${prompt}`);

    return new Promise<string>((resolve) => {
      this.pendingInputs.set(key, { resolve, prompt });
    });
  }

  /**
   * Submit user input to a waiting node — resolves the pending Promise.
   * Called via IPC when the user submits input from the UI.
   */
  public submitInput(runId: string, nodeId: string, input: string): boolean {
    const key = `${runId}:${nodeId}`;
    const pending = this.pendingInputs.get(key);
    if (!pending) return false;

    this.pendingInputs.delete(key);

    // Restore node status to running
    const run = store.getRun(runId);
    if (run) {
      this.updateNodeState(run, nodeId, 'running');
    }

    this.appendLog(run!, nodeId, `**User input received**: ${input}`);
    this.emitEvent('node:started', runId, nodeId); // signal resumed

    pending.resolve(input);
    return true;
  }

  /**
   * Set a key-value pair in a run's shared context.
   * Called by the set_workflow_context tool from within an agent.
   */
  public setRunContext(runId: string, key: string, value: any): void {
    const entry = this.activeRuns.get(runId);
    if (!entry) {
      logger.warn(`[WorkflowEngine] setRunContext: no active run ${runId}`);
      return;
    }
    // Update both in-memory run and DB
    entry.run.context[key] = value;
    store.updateRunContext(runId, entry.run.context);
    this.emitEvent('context:updated', runId, undefined, { key, value });
    logger.info(`[WorkflowEngine] Context updated: ${key} = ${JSON.stringify(value)}`);
  }

  // ─── Core Execution Loop ────────────────────────────────

  private async executeRun(workflow: WorkflowDefinition, run: WorkflowRun, signal: AbortSignal): Promise<void> {
    try {
      // Detect ALL back-edges using DFS — these create cycles that break topological sort.
      // AI-generated workflows often have retry loops (condition → earlier node)
      // and loop node back-edges that form cycles.
      const backEdgeIds = this.detectBackEdges(workflow.nodes, workflow.edges);
      logger.info(`[WorkflowEngine] Detected ${backEdgeIds.size} back-edges in workflow`);

      const forwardEdges = workflow.edges.filter(e => !backEdgeIds.has(e.id));
      const executionOrder = this.topologicalSort(workflow.nodes, forwardEdges);

      // Collect all loop body nodes — these are executed exclusively inside executeLoopNode.
      // Without this, loop body nodes would be executed TWICE: once inside the loop and once
      // in the main execution loop (since they appear in the topological order).
      const loopBodyNodeIds = new Set<string>();
      for (const node of workflow.nodes) {
        if (node.type === 'loop') {
          const childEdges = workflow.edges.filter(e => e.source === node.id);
          const subgraph = this.discoverLoopSubgraph(
            workflow, node.id, childEdges.map(e => e.target),
          );
          for (const id of subgraph) loopBodyNodeIds.add(id);
        }
      }
      if (loopBodyNodeIds.size > 0) {
        logger.info(`[WorkflowEngine] Loop body nodes (excluded from main loop): ${Array.from(loopBodyNodeIds).join(', ')}`);
      }

      for (const nodeId of executionOrder) {
        // Check abort
        if (signal.aborted) break;

        // Check pause — spin wait
        while (this.activeRuns.get(run.id)?.paused) {
          await this.sleep(500);
          if (signal.aborted) break;
        }
        if (signal.aborted) break;

        const node = workflow.nodes.find(n => n.id === nodeId);
        if (!node) continue;

        // Skip loop body nodes — they are executed inside executeLoopNode only
        if (loopBodyNodeIds.has(nodeId)) {
          continue;
        }

        // Check if all dependencies are satisfied (ignoring back-edges)
        const incomingEdges = workflow.edges.filter(
          e => e.target === nodeId && !backEdgeIds.has(e.id),
        );
        const depStatuses = incomingEdges.map(edge => run.nodeStates[edge.source]?.status);
        const allDepsFinished = depStatuses.every(
          s => s === 'completed' || s === 'skipped',
        );
        const hasAnyCompleted = depStatuses.some(s => s === 'completed');

        if (!allDepsFinished) {
          // Mark as skipped if dependencies didn't finish
          await this.updateNodeState(run, nodeId, 'skipped');
          continue;
        }

        // If ALL deps are skipped (none completed), propagate the skip.
        // This prevents downstream nodes of a skipped condition branch from executing.
        if (!hasAnyCompleted && incomingEdges.length > 0) {
          await this.updateNodeState(run, nodeId, 'skipped');
          continue;
        }

        // Check condition edges — if this node was reached via a condition, check if the condition was met
        const conditionIncomingEdges = incomingEdges.filter(e => {
          const srcNode = workflow.nodes.find(n => n.id === e.source);
          return srcNode?.type === 'condition';
        });
        if (conditionIncomingEdges.length > 0) {
          const allConditionsMet = conditionIncomingEdges.every(edge => {
            if (!edge.conditionLabel) return false; // Edge from condition without label = unreachable
            const conditionResult = run.nodeStates[edge.source]?.output;
            return conditionResult === edge.conditionLabel;
          });
          if (!allConditionsMet) {
            await this.updateNodeState(run, nodeId, 'skipped');
            continue;
          }
        }

        try {
          await this.executeNode(workflow, run, node, signal);
        } catch (err: any) {
          // Node failure should NOT abort the entire run.
          // Downstream nodes will be skipped via the dependency check
          // (failed status is neither 'completed' nor 'skipped').
          logger.warn(`[WorkflowEngine] Node ${nodeId} failed, continuing run: ${err.message}`);
          this.appendLog(run, nodeId, `[ERROR] ${err.message}`);
        }
      }

      // All nodes processed
      if (!signal.aborted) {
        run.status = 'completed';
        run.completedAt = Date.now();
        store.updateRunStatus(run.id, 'completed', run.completedAt);
        this.emitEvent('run:completed', run.id);
      }
    } catch (err: any) {
      if (!signal.aborted) {
        run.status = 'failed';
        run.completedAt = Date.now();
        store.updateRunStatus(run.id, 'failed', run.completedAt);
        this.emitEvent('run:failed', run.id, undefined, { error: err.message });
      }
    } finally {
      this.activeRuns.delete(run.id);
      // Clean up live agents for this run
      for (const key of this.liveAgents.keys()) {
        if (key.startsWith(`${run.id}:`)) {
          this.liveAgents.delete(key);
        }
      }
    }
  }

  private async executeNode(
    workflow: WorkflowDefinition,
    run: WorkflowRun,
    node: WorkflowNode,
    signal: AbortSignal,
  ): Promise<void> {
    await this.updateNodeState(run, node.id, 'running');
    this.emitEvent('node:started', run.id, node.id);

    try {
      switch (node.type) {
        case 'task':
          await this.executeTaskNode(run, node, signal);
          break;
        case 'condition':
          await this.executeConditionNode(run, node, workflow);
          break;
        case 'loop':
          await this.executeLoopNode(workflow, run, node, signal);
          break;
        case 'gateway':
          // Gateway nodes are markers — parallel branches are handled by topo sort
          await this.updateNodeState(run, node.id, 'completed');
          break;
        default:
          await this.updateNodeState(run, node.id, 'skipped');
      }
    } catch (err: any) {
      const nodeState = run.nodeStates[node.id];
      if (nodeState) {
        nodeState.error = err.message;
        nodeState.status = 'failed';
        store.saveNodeRun(nodeState);
      }
      this.emitEvent('node:failed', run.id, node.id, { error: err.message });

      // Check retry config
      if (node.retryConfig && nodeState) {
        if (nodeState.iteration < node.retryConfig.maxRetries) {
          logger.info(`[WorkflowEngine] Retrying node ${node.id} (attempt ${nodeState.iteration + 1})`);
          await this.sleep(node.retryConfig.retryDelayMs || 1000);
          nodeState.iteration++;
          nodeState.status = 'pending';
          nodeState.error = undefined;
          store.saveNodeRun(nodeState);
          await this.executeNode(workflow, run, node, signal);
          return;
        }
      }

      throw err;
    }
  }

  // ─── Task Node: Agent Execution ─────────────────────────

  private async executeTaskNode(run: WorkflowRun, node: WorkflowNode, signal: AbortSignal): Promise<void> {
    const agentConfig = node.agentConfig;
    if (!agentConfig) {
      await this.updateNodeState(run, node.id, 'completed', 'No agent config — skipped');
      return;
    }

    // Resolve model config
    const modelConfig = this.resolveModelConfig(agentConfig.modelConfig);

    // Get all available tools
    const allTools = await this.toolRegistry.getAllTools();

    // Create the agent
    const agent = this.agentFactory.createCustomAgent(
      agentConfig.name,
      agentConfig.persona,
      agentConfig.tools,
      allTools,
      undefined, // memoryContext
      modelConfig,
    );
    agent.config.modelConfig = modelConfig;

    // Store live agent reference for conversation injection
    this.liveAgents.set(`${run.id}:${node.id}`, agent);

    // Inject any queued messages into the agent's context
    const nodeState = run.nodeStates[node.id];
    if (nodeState) {
      // Drain injected messages from the queue
      const messages = store.drainNodeMessages(nodeState.id);
      if (messages.length > 0) {
        const history = agent.getHistory();
        for (const msg of messages) {
          history.push({ role: msg.role, content: msg.content });
        }
        agent.setHistory(history);
      }

      // Also inject initial context messages from agent config
      if (agentConfig.injectedMessages && agentConfig.injectedMessages.length > 0) {
        const history = agent.getHistory();
        for (const msg of agentConfig.injectedMessages) {
          history.push({ role: msg.role, content: msg.content });
        }
        agent.setHistory(history);
      }
    }

    // Build the task prompt from workflow context
    const contextStr = Object.entries(run.context)
      .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join('\n');

    const taskPrompt = node.description
      ? `${node.description}\n\n[Workflow Context]:\n${contextStr || '(empty)'}`
      : `Execute task: ${node.label}\n\n[Workflow Context]:\n${contextStr || '(empty)'}`;

    // Set context so request_user_input and set_workflow_context tools know which run/node is active
    setUserInputContext(run.id, node.id);
    setWfCtxContext(run.id, node.id);

    // Execute
    let result: string;
    try {
      result = await agent.process(
        taskPrompt,
        (chunk) => {
          if (nodeState) {
            this.appendLog(run, node.id, chunk);
          }
        },
        (step) => {
          this.appendLog(run, node.id, step);
        },
        signal,
      );
    } finally {
      clearUserInputContext();
      clearWfCtxContext();
    }

    // Save result
    if (nodeState) {
      nodeState.output = result;
      nodeState.agentHistory = JSON.stringify(agent.getHistory());
      store.saveNodeRun(nodeState);
    }

    // Store result in workflow context for downstream nodes
    run.context[`${node.id}_result`] = result;

    // Auto-extract structured values (e.g., capital, balance) from the agent's text output
    // into the shared context. This allows condition nodes to evaluate expressions like
    // `context.capital > 0` even when the agent didn't explicitly call set_workflow_context.
    // Explicit values (set via set_workflow_context tool) are never overwritten.
    this.extractContextFromOutput(run.context, result);

    store.updateRunContext(run.id, run.context);

    await this.updateNodeState(run, node.id, 'completed', result);
    this.emitEvent('node:completed', run.id, node.id, { output: result });
  }

  private async executeConditionNode(run: WorkflowRun, node: WorkflowNode, workflow?: WorkflowDefinition): Promise<void> {
    const condition = node.condition || node.description || 'Always true';
    let result = 'true';

    // Gather workflow context for the LLM
    const contextStr = Object.entries(run.context)
      .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join('\n');

    // Gather upstream node outputs for additional context
    let upstreamInfo = '';
    if (workflow) {
      const upstreamEdges = workflow.edges.filter(e => e.target === node.id);
      for (const edge of upstreamEdges) {
        const upstreamNode = workflow.nodes.find(n => n.id === edge.source);
        const upstreamState = run.nodeStates[edge.source];
        if (upstreamState?.output) {
          const label = upstreamNode?.label || edge.source;
          upstreamInfo += `\n[${label} output]: ${upstreamState.output}\n`;
        }
      }
    }

    const modelConfig = this.resolveModelConfig();

    try {
      const prompt = `You are a workflow condition evaluator. Based on the workflow context and upstream node outputs, evaluate whether the following condition is TRUE or FALSE.

Condition to evaluate: "${condition}"
${node.description ? `Node description: "${node.description}"` : ''}

Workflow Context:
${contextStr || '(empty)'}
${upstreamInfo ? `\nUpstream Node Outputs:${upstreamInfo}` : ''}

Respond with ONLY a JSON object, no other text:
{"result": true, "reason": "brief explanation"} or {"result": false, "reason": "brief explanation"}`;

      const response = await this.llmService.generateCompletion(
        [
          { role: 'system', content: 'You are a precise condition evaluator. Output ONLY valid JSON. No markdown, no code blocks.' },
          { role: 'user', content: prompt },
        ],
        { ...modelConfig, stream: false },
        true, // jsonMode
      );

      if (response) {
        const text = typeof response === 'string' ? response : response.content || '';
        // Extract JSON from response (handle potential markdown wrapping)
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          result = parsed.result ? 'true' : 'false';
          this.appendLog(run, node.id,
            `Condition "${condition}" → ${result} (reason: ${parsed.reason || 'N/A'})`);
        }
      }
    } catch (err: any) {
      logger.warn(`[WorkflowEngine] AI condition evaluation failed for ${node.id}:`, err.message);
      // Fallback to JS expression evaluation
      try {
        const fn = new Function('context', `return (${condition}) ? 'true' : 'false'`);
        result = fn(run.context);
        this.appendLog(run, node.id, `Condition fallback to JS eval: ${condition} → ${result}`);
      } catch {
        result = 'false';
        this.appendLog(run, node.id, `Condition evaluation failed, defaulting to false`);
      }
    }

    await this.updateNodeState(run, node.id, 'completed', result);
    this.emitEvent('node:completed', run.id, node.id, { output: result });
  }

  /**
   * Try to extract key-value pairs from a task node's text output.
   * Looks for patterns like "capital: 100", "100¥ capital", JSON blocks, etc.
   * Merges found values into the context (doesn't overwrite explicit values).
   */
  private extractContextFromOutput(context: Record<string, any>, output: string): void {
    // Try parsing the entire output as JSON
    try {
      const parsed = JSON.parse(output);
      if (typeof parsed === 'object' && parsed !== null) {
        for (const [key, value] of Object.entries(parsed)) {
          if (!(key in context)) context[key] = value;
        }
        return;
      }
    } catch {
      // Not JSON, try pattern extraction
    }

    // Financial keywords to look for in text output
    const keywords = ['capital', 'balance', 'budget', 'funds', 'money'];

    for (const keyword of keywords) {
      if (keyword in context) continue; // Don't overwrite explicit values

      // Pattern 1: "keyword: 100" / "**keyword**: 100" / "keyword = 100"
      const p1 = new RegExp(`\\*{0,2}(?:initial\\s+)?${keyword}\\*{0,2}[:\\s=]+([\\d,.]+)`, 'i');
      // Pattern 2: "100 RMB keyword" / "100¥ keyword" / "100 initial keyword"
      const p2 = new RegExp(`([\\d,.]+)\\s*(?:RMB|¥|\\$|USD)?\\s+(?:initial\\s+)?${keyword}`, 'i');
      // Pattern 3: "keyword of 100" / "keyword is 100"
      const p3 = new RegExp(`${keyword}\\s+(?:of|is|was|at|:)\\s+([\\d,.]+)`, 'i');

      for (const pattern of [p1, p2, p3]) {
        const match = pattern.exec(output);
        if (match) {
          const value = parseFloat(match[1].replace(/,/g, ''));
          if (!isNaN(value)) {
            context[keyword] = value;
            logger.info(`[WorkflowEngine] Extracted ${keyword}=${value} from upstream output`);
            break;
          }
        }
      }
    }
  }

  // ─── Loop Node ──────────────────────────────────────────

  private async executeLoopNode(
    workflow: WorkflowDefinition,
    run: WorkflowRun,
    node: WorkflowNode,
    signal: AbortSignal,
  ): Promise<void> {
    const maxIterations = node.loopConfig?.maxIterations || 5;
    const exitCondition = node.loopConfig?.exitCondition;

    // Discover the full reachable subgraph from this loop node's children
    // BFS from direct children, stopping when we reach the loop node itself or a dead end
    const directChildEdges = workflow.edges.filter(e => e.source === node.id);
    const subgraphNodeIds = this.discoverLoopSubgraph(
      workflow, node.id, directChildEdges.map(e => e.target),
    );

    if (subgraphNodeIds.length === 0) {
      this.appendLog(run, node.id, 'Loop has no child nodes — skipping');
      await this.updateNodeState(run, node.id, 'completed', 'No child nodes');
      return;
    }

    // Sort the subgraph in topological order
    const subgraphNodes = workflow.nodes.filter(n => subgraphNodeIds.includes(n.id));
    const subgraphEdges = workflow.edges.filter(
      e => subgraphNodeIds.includes(e.source) && subgraphNodeIds.includes(e.target),
    );
    const executionOrder = this.topologicalSort(subgraphNodes, subgraphEdges);

    this.appendLog(run, node.id, `Loop subgraph: ${executionOrder.length} nodes, max ${maxIterations} iterations`);

    for (let i = 0; i < maxIterations; i++) {
      if (signal.aborted) break;

      // Check exit condition
      if (exitCondition) {
        try {
          const fn = new Function('context', 'iteration', `return ${exitCondition}`);
          if (fn(run.context, i)) {
            this.appendLog(run, node.id, `Loop exited at iteration ${i}: exit condition met`);
            break;
          }
        } catch {
          // Continue if condition evaluation fails
        }
      }

      // Check pause
      while (this.activeRuns.get(run.id)?.paused) {
        await this.sleep(500);
        if (signal.aborted) break;
      }
      if (signal.aborted) break;

      // Update iteration count
      const nodeState = run.nodeStates[node.id];
      if (nodeState) {
        nodeState.iteration = i;
        store.saveNodeRun(nodeState);
      }

      this.appendLog(run, node.id, `── Loop iteration ${i + 1}/${maxIterations} ──`);
      this.emitEvent('node:log', run.id, node.id, { log: `Loop iteration ${i + 1}` });

      // Execute all subgraph nodes in topological order
      for (const childId of executionOrder) {
        if (signal.aborted) break;

        const childNode = workflow.nodes.find(n => n.id === childId);
        if (!childNode) continue;

        // Reset child node state for re-execution
        await this.updateNodeState(run, childId, 'pending');

        // Check condition edges within the subgraph
        const childIncoming = subgraphEdges.filter(e => e.target === childId);
        const condEdges = childIncoming.filter(e => {
          const srcNode = workflow.nodes.find(n => n.id === e.source);
          return srcNode?.type === 'condition';
        });
        if (condEdges.length > 0) {
          const condMet = condEdges.every(e => {
            if (!e.conditionLabel) return false;
            return run.nodeStates[e.source]?.output === e.conditionLabel;
          });
          if (!condMet) {
            await this.updateNodeState(run, childId, 'skipped');
            continue;
          }
        }

        // Check non-condition deps are completed/skipped
        const nonCondDeps = childIncoming.filter(e => {
          const srcNode = workflow.nodes.find(n => n.id === e.source);
          return srcNode?.type !== 'condition';
        });
        const nonCondStatuses = nonCondDeps.map(e => run.nodeStates[e.source]?.status);
        const depsOk = nonCondStatuses.every(
          s => s === 'completed' || s === 'skipped',
        );
        if (!depsOk) {
          await this.updateNodeState(run, childId, 'skipped');
          continue;
        }
        // If ALL non-condition deps are skipped (none completed), propagate the skip
        const hasCompletedDep = nonCondStatuses.some(s => s === 'completed');
        if (!hasCompletedDep && nonCondDeps.length > 0) {
          await this.updateNodeState(run, childId, 'skipped');
          continue;
        }

        await this.executeNode(workflow, run, childNode, signal);
      }
    }

    await this.updateNodeState(run, node.id, 'completed',
      `Completed after loop iterations`);
  }

  /**
   * BFS to discover all nodes reachable from the loop's direct children,
   * stopping at the loop node itself to avoid infinite recursion.
   */
  private discoverLoopSubgraph(
    workflow: WorkflowDefinition,
    loopNodeId: string,
    startNodeIds: string[],
  ): string[] {
    const visited = new Set<string>();
    const queue = [...startNodeIds];

    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      if (nodeId === loopNodeId) continue; // Don't include the loop node itself
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);

      // Add all nodes reachable from this node
      const outEdges = workflow.edges.filter(e => e.source === nodeId);
      for (const edge of outEdges) {
        if (!visited.has(edge.target) && edge.target !== loopNodeId) {
          queue.push(edge.target);
        }
      }
    }

    return Array.from(visited);
  }

  // ─── Helpers ────────────────────────────────────────────

  /**
   * Detect all back-edges in the graph using DFS.
   * Back-edges point from a node to an ancestor in the DFS tree, creating cycles.
   */
  private detectBackEdges(nodes: WorkflowNode[], edges: WorkflowEdge[]): Set<string> {
    const backEdges = new Set<string>();
    const adjacency = new Map<string, { target: string; edgeId: string }[]>();

    for (const node of nodes) {
      adjacency.set(node.id, []);
    }
    for (const edge of edges) {
      adjacency.get(edge.source)?.push({ target: edge.target, edgeId: edge.id });
    }

    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<string, number>();
    for (const node of nodes) {
      color.set(node.id, WHITE);
    }

    const dfs = (nodeId: string) => {
      color.set(nodeId, GRAY);
      for (const { target, edgeId } of (adjacency.get(nodeId) || [])) {
        const targetColor = color.get(target);
        if (targetColor === GRAY) {
          // Back-edge: target is an ancestor (still being processed)
          backEdges.add(edgeId);
        } else if (targetColor === WHITE) {
          dfs(target);
        }
      }
      color.set(nodeId, BLACK);
    };

    for (const node of nodes) {
      if (color.get(node.id) === WHITE) {
        dfs(node.id);
      }
    }

    return backEdges;
  }

  private topologicalSort(nodes: WorkflowNode[], edges: WorkflowEdge[]): string[] {
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    for (const node of nodes) {
      inDegree.set(node.id, 0);
      adjacency.set(node.id, []);
    }

    for (const edge of edges) {
      inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
      adjacency.get(edge.source)?.push(edge.target);
    }

    // BFS queue with nodes that have no incoming edges
    const queue: string[] = [];
    for (const [id, deg] of inDegree.entries()) {
      if (deg === 0) queue.push(id);
    }

    const sorted: string[] = [];
    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      sorted.push(nodeId);

      for (const neighbor of (adjacency.get(nodeId) || [])) {
        const newDeg = (inDegree.get(neighbor) || 1) - 1;
        inDegree.set(neighbor, newDeg);
        if (newDeg === 0) queue.push(neighbor);
      }
    }

    // If sorted doesn't include all nodes, there's a cycle
    if (sorted.length !== nodes.length) {
      logger.warn('[WorkflowEngine] Cycle detected in workflow DAG. Some nodes will be skipped.');
    }

    return sorted;
  }

  private async updateNodeState(run: WorkflowRun, nodeId: string, status: NodeRunStatus, output?: string): Promise<void> {
    const nodeState = run.nodeStates[nodeId];
    if (!nodeState) return;

    nodeState.status = status;
    if (output !== undefined) nodeState.output = output;
    if (status === 'running' && !nodeState.startedAt) nodeState.startedAt = Date.now();
    if (status === 'completed' || status === 'failed' || status === 'skipped') {
      nodeState.completedAt = Date.now();
    }

    store.saveNodeRun(nodeState);
  }

  private appendLog(run: WorkflowRun, nodeId: string, log: string): void {
    const nodeState = run.nodeStates[nodeId];
    if (!nodeState) return;
    nodeState.logs.push(log);
    store.appendNodeLog(nodeState.id, log);
    this.emitEvent('node:log', run.id, nodeId, { log });
  }

  private resolveModelConfig(override?: Record<string, any>): any {
    const settings = getAppSettings();
    const allModels = getModels();

    // Use override model ID or active model
    const modelId = override?.id || settings?.agentModelId || settings?.activeModelId;
    const model = allModels.find((m: any) => m.id === modelId) || allModels.find((m: any) => m.enabled);

    if (!model) {
      throw new Error('No valid model configuration found for workflow agent');
    }

    return {
      ...model,
      ...(override || {}),
      stream: override?.stream ?? model.stream ?? false,
    };
  }

  private emitEvent(type: WorkflowEventType, runId: string, nodeId?: string, data?: any): void {
    const event: WorkflowEvent = {
      type,
      runId,
      nodeId,
      data,
      timestamp: Date.now(),
    };
    this.emit('workflow:event', event);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
