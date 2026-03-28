/**
 * Workflow Planner — Conversational Workflow Creation
 *
 * Uses LLM to generate, refine, and reflect on workflow definitions.
 * Converts natural language requests into structured DAG workflows
 * with properly configured sub-agents (prompts + tools).
 */

import { randomUUID } from 'crypto';
import { LLMService } from '../model/llm-service';
import { ToolRegistry } from '../execution/tool-registry';
import {
  WorkflowDefinition,
  WorkflowNode,
  WorkflowEdge,
  SubAgentConfig,
} from './types';
import * as store from './store';
import { logger } from '../logger';

const WORKFLOW_PLANNER_SYSTEM_PROMPT = `You are a Workflow Architect. Your job is to convert user requests into structured DAG workflows.

Each workflow is a directed acyclic graph of nodes and edges. Node types:
- **task**: An AI agent executes a specific task. Each task node has an agent config with name, persona (system prompt), and tools.
- **condition**: Evaluates a JS expression against the workflow context to branch execution.
- **loop**: Repeats child nodes for N iterations or until an exit condition is met. The loop node's outgoing edge points to the first node of the loop body. All nodes reachable from that edge (up to nodes that point back at the loop) form the loop body and will be re-executed each iteration.
- **gateway**: Marks parallel fork/join points.

**CRITICAL — Workflow Context and Conditions:**
Condition nodes evaluate JS expressions against the shared \`context\` object (e.g., \`context.capital > 0\`).
Task node agents can set context values using the \`set_workflow_context\` tool.
**Any task node whose output is needed by a downstream condition or loop exit condition MUST include \`set_workflow_context\` in its tools list.**
The agent's persona should instruct it to call set_workflow_context with the specific keys the downstream condition checks.
Example: If a condition checks \`context.capital > 0\`, the upstream task node must call \`set_workflow_context({ key: "capital", value: 100 })\`.

**CRITICAL — No Back-edges / No Cycles:**
NEVER create edges that point backward in the graph (from a later node to an earlier one). This creates cycles which break execution.
- Do NOT create "retry" edges from condition → earlier node. If you need retry logic, use a loop node instead.
- The ONLY way to create iteration is with a loop node. The loop node handles re-execution of its child subgraph automatically.
- Condition nodes should ONLY have edges going forward to two branches: one for "true" and one for "false".

**Design Guidelines:**
1. Each task node should have a focused, well-defined agent with a specific persona and relevant tools.
2. Agent personas should describe their expertise, tone, and approach — not generic descriptions.
3. Only assign tools that are relevant to the agent's task.
4. Use condition nodes for branching logic (e.g., check if data meets criteria).
5. Use loop nodes for iterative tasks (e.g., retry until success, periodic checks).
6. Edges connect nodes in execution order. Condition edges have conditionLabel ("true"/"false").
7. Node positions (x, y) should make the graph visually readable — left to right, top to bottom.
8. Every condition edge MUST have a conditionLabel ("true" or "false"). Never create unlabeled edges from condition nodes.

**Output Format:**
Output a JSON object with:
- name: workflow name
- description: brief description
- nodes: array of workflow nodes
- edges: array of edges connecting nodes

Each node must have:
- id: unique string (e.g., "node_1")
- type: "task" | "condition" | "loop" | "gateway"
- label: short display name
- description: what this node does
- position: { x: number, y: number }
- agentConfig (for task nodes): { name, persona, tools: string[] }
- condition (for condition nodes): JS expression string
- loopConfig (for loop nodes): { maxIterations, exitCondition? }
- gatewayMode (for gateway nodes): "parallel" | "join"

Each edge must have:
- id: unique string
- source: source node id
- target: target node id
- conditionLabel (optional): "true" or "false" for condition branches
`;

export class WorkflowPlanner {
  private llmService: LLMService;
  private toolRegistry: ToolRegistry;

  constructor(llmService: LLMService, toolRegistry: ToolRegistry) {
    this.llmService = llmService;
    this.toolRegistry = toolRegistry;
  }

  /**
   * Plan a new workflow or refine an existing one.
   */
  public async planOrRefine(
    request: string,
    modelConfig: any,
    existingWorkflow?: WorkflowDefinition,
    feedback?: string,
  ): Promise<WorkflowDefinition> {
    // Get available tools for context
    const tools = await this.toolRegistry.getAllTools();
    const toolsDesc = tools
      .map(t => `- ${t.name}: ${t.description || 'No description'}`)
      .join('\n');

    let userPrompt: string;

    if (existingWorkflow && feedback) {
      // Refinement mode
      userPrompt = `**Refine this workflow based on feedback.**

**Current Workflow:**
\`\`\`json
${JSON.stringify({
  name: existingWorkflow.name,
  description: existingWorkflow.description,
  nodes: existingWorkflow.nodes,
  edges: existingWorkflow.edges,
}, null, 2)}
\`\`\`

**User Feedback:**
${feedback}

**Available Tools:**
${toolsDesc}

Output the refined workflow as JSON.`;
    } else {
      // New workflow mode
      userPrompt = `**Create a workflow for this request:**
${request}

**Available Tools:**
${toolsDesc}

Output the workflow as JSON.`;
    }

    const response = await this.llmService.generateCompletion(
      [
        { role: 'system', content: WORKFLOW_PLANNER_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      { ...modelConfig, stream: false },
      true, // jsonMode
    );

    if (!response) throw new Error('Workflow planner returned empty response');

    // Parse the response
    let parsed: any;
    try {
      const cleanJson = response.replace(/```json\n?|\n?```/g, '').trim();
      parsed = JSON.parse(cleanJson);
    } catch (e) {
      logger.error('[WorkflowPlanner] Failed to parse response:', e);
      throw new Error('Failed to parse workflow plan');
    }

    // Build WorkflowDefinition
    const now = Date.now();
    const workflow: WorkflowDefinition = {
      id: existingWorkflow?.id || randomUUID(),
      name: parsed.name || 'Untitled Workflow',
      description: parsed.description,
      version: existingWorkflow ? existingWorkflow.version + 1 : 1,
      status: 'draft',
      nodes: (parsed.nodes || []).map((n: any) => this.normalizeNode(n)),
      edges: (parsed.edges || []).map((e: any) => this.normalizeEdge(e)),
      sourceDeviceId: existingWorkflow?.sourceDeviceId,
      sourceSessionId: existingWorkflow?.sourceSessionId,
      createdAt: existingWorkflow?.createdAt || now,
      updatedAt: now,
    };

    // Save to DB
    store.saveWorkflow(workflow);

    // Save version snapshot
    store.saveVersion({
      id: randomUUID(),
      workflowId: workflow.id,
      version: workflow.version,
      snapshot: JSON.stringify(workflow),
      changelog: feedback || request,
      createdAt: now,
    });

    return workflow;
  }

  /**
   * Post-execution reflection: analyze a completed run and suggest improvements.
   */
  public async reflectAndRefine(
    workflow: WorkflowDefinition,
    runSummary: string,
    modelConfig: any,
  ): Promise<{ suggestions: string; refinedWorkflow?: WorkflowDefinition }> {
    const prompt = `**Analyze this workflow execution and suggest improvements.**

**Workflow:**
${JSON.stringify({ name: workflow.name, nodes: workflow.nodes.map(n => ({ id: n.id, label: n.label, type: n.type })), edges: workflow.edges }, null, 2)}

**Execution Summary:**
${runSummary}

Provide:
1. Analysis of what went well and what could be improved
2. Specific suggestions for workflow optimization
3. If no changes needed, say "No changes recommended."

Output as JSON: { "analysis": "...", "suggestions": "...", "needsRefinement": boolean }`;

    const response = await this.llmService.generateCompletion(
      [
        { role: 'system', content: 'You are a workflow optimization expert. Analyze and suggest improvements.' },
        { role: 'user', content: prompt },
      ],
      { ...modelConfig, stream: false },
      true,
    );

    if (!response) return { suggestions: 'Unable to analyze — no response from LLM' };

    try {
      const cleanJson = response.replace(/```json\n?|\n?```/g, '').trim();
      const result = JSON.parse(cleanJson);
      return {
        suggestions: `${result.analysis}\n\n${result.suggestions}`,
      };
    } catch {
      return { suggestions: response };
    }
  }

  // ─── Helpers ────────────────────────────────────────────

  private normalizeNode(raw: any): WorkflowNode {
    return {
      id: raw.id || randomUUID(),
      type: raw.type || 'task',
      label: raw.label || raw.name || 'Unnamed',
      description: raw.description,
      position: raw.position || { x: 0, y: 0 },
      agentConfig: raw.agentConfig ? {
        name: raw.agentConfig.name || raw.label || 'Agent',
        persona: raw.agentConfig.persona || raw.agentConfig.systemPrompt || '',
        tools: raw.agentConfig.tools || [],
        modelConfig: raw.agentConfig.modelConfig,
        injectedMessages: raw.agentConfig.injectedMessages || [],
      } : undefined,
      condition: raw.condition,
      loopConfig: raw.loopConfig,
      gatewayMode: raw.gatewayMode,
      timeout: raw.timeout,
      retryConfig: raw.retryConfig,
    };
  }

  private normalizeEdge(raw: any): WorkflowEdge {
    return {
      id: raw.id || randomUUID(),
      source: raw.source,
      target: raw.target,
      conditionLabel: raw.conditionLabel,
    };
  }
}
