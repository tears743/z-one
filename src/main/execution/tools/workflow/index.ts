/**
 * Workflow Tool — AI-initiated workflow creation
 *
 * Allows the AI agent to propose a workflow during conversation.
 * The workflow is created as a draft and presented to the user
 * with a confirmation card in chat. User confirms → workflow is activated.
 *
 * NOTE: All dependencies are injected via setWorkflowDeps() to avoid
 * circular dependency issues with db.ts and workflow/store.ts at bundle time.
 */

import { NativeTool, ToolContext } from '../../tool-registry';
import { logger } from '../../../logger';

interface WorkflowDeps {
  planner: any;
  getAppSettings: () => any;
  getModels: () => any;
  getWorkflow: (id: string) => any;
  updateWorkflowStatus: (id: string, status: any) => void;
}

/** Late-bound deps — set after initialization */
let _deps: WorkflowDeps | null = null;

export function setWorkflowPlanner(planner: any) {
  // Back-compat: if called with just planner, update planner only
  if (_deps) {
    _deps.planner = planner;
  } else {
    // Will be completed by setWorkflowDeps
    _deps = { planner } as any;
  }
}

export function setWorkflowDeps(deps: WorkflowDeps) {
  _deps = deps;
}

export const CreateWorkflowTool: NativeTool = {
  name: 'create_workflow',
  description: `Create an automated workflow (DAG) from a conversation context.
Use this tool when the user has discussed a strategy, process, or multi-step task
that would benefit from being turned into an executable workflow.
The workflow will be presented to the user as a proposal for their approval before activation.
Input: a description of what the workflow should accomplish, and optionally a summary of the chat context.`,
  inputSchema: {
    type: 'object',
    properties: {
      description: {
        type: 'string',
        description: 'Clear description of what the workflow should accomplish. Be specific about the steps, tools, and goals.',
      },
      chat_context: {
        type: 'string',
        description: 'Summary of the relevant conversation that led to this workflow proposal. Include key decisions, requirements, and constraints discussed.',
      },
    },
    required: ['description'],
  },
  execute: async (args: any, context?: ToolContext) => {
    if (!_deps?.planner) {
      return { error: 'Workflow planner not initialized' };
    }

    try {
      // Build the request string with chat context if provided
      let request = args.description;
      if (args.chat_context) {
        request = `${args.description}\n\n[Chat Context]:\n${args.chat_context}`;
      }

      // Resolve model config
      const settings = _deps.getAppSettings();
      const models = _deps.getModels();
      const activeModel = models.find((m: any) => m.id === (settings?.activeModelId || ''));
      const modelConfig = activeModel || models[0];

      // Generate the workflow via planner (saved as draft)
      const workflow = await _deps.planner.planOrRefine(request, modelConfig);

      logger.info(`[CreateWorkflowTool] Created workflow proposal: ${workflow.id} — ${workflow.name}`);

      // Return structured data for the proposal card
      return {
        type: 'workflow_proposal',
        workflow: {
          id: workflow.id,
          name: workflow.name,
          description: workflow.description,
          nodeCount: workflow.nodes.length,
          edgeCount: workflow.edges.length,
          nodes: workflow.nodes.map((n: any) => ({
            id: n.id,
            label: n.label,
            type: n.type,
            tools: n.agentConfig?.tools || [],
            description: n.description,
            agentConfig: n.agentConfig,
            condition: n.condition,
            position: n.position,
          })),
          edges: workflow.edges,
          status: workflow.status,
        },
        message: `已生成工作流方案「${workflow.name}」，包含 ${workflow.nodes.length} 个节点。请确认是否创建。`,
      };
    } catch (err: any) {
      logger.error('[CreateWorkflowTool] Failed:', err);
      return { error: `Failed to create workflow: ${err.message}` };
    }
  },
};

export const ConfirmWorkflowTool: NativeTool = {
  name: 'confirm_workflow',
  description: `Confirm and activate a previously proposed workflow. This is called after the user approves a workflow proposal.
Only use this tool when the user explicitly confirms/agrees to create the workflow.`,
  inputSchema: {
    type: 'object',
    properties: {
      workflow_id: {
        type: 'string',
        description: 'The ID of the workflow to activate.',
      },
    },
    required: ['workflow_id'],
  },
  execute: async (args: any) => {
    if (!_deps) {
      return { error: 'Workflow deps not initialized' };
    }

    try {
      const workflow = _deps.getWorkflow(args.workflow_id);
      if (!workflow) {
        return { error: `Workflow ${args.workflow_id} not found` };
      }

      _deps.updateWorkflowStatus(args.workflow_id, 'active');

      return {
        type: 'workflow_confirmed',
        workflow: {
          id: workflow.id,
          name: workflow.name,
          nodeCount: workflow.nodes.length,
        },
        message: `工作流「${workflow.name}」已创建并激活！你可以在 Workflow 页面查看和运行。`,
      };
    } catch (err: any) {
      return { error: `Failed to confirm workflow: ${err.message}` };
    }
  },
};

export const WorkflowTools = [CreateWorkflowTool, ConfirmWorkflowTool];
