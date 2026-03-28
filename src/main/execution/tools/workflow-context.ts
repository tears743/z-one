/**
 * Set Workflow Context Tool — Allow agents to set key-value pairs in the workflow context
 *
 * Condition nodes evaluate JS expressions against `context`, e.g. `context.capital > 0`.
 * This tool lets task-node agents write to `context` so downstream condition/loop nodes
 * can use those values for branching and exit decisions.
 *
 * Dependencies are late-bound via setWorkflowContextDeps() to avoid circular imports.
 */

import { NativeTool } from '../tool-registry';
import { logger } from '../../logger';

interface WorkflowContextDeps {
  engine: {
    setRunContext: (runId: string, key: string, value: any) => void;
  };
}

let _deps: WorkflowContextDeps | null = null;

/** Current execution context — set by the engine before each agent runs */
let _currentCtx: { runId: string; nodeId: string } | null = null;

export function setWorkflowContextDeps(deps: WorkflowContextDeps) {
  _deps = deps;
}

export function setWfCtxContext(runId: string, nodeId: string) {
  _currentCtx = { runId, nodeId };
}

export function clearWfCtxContext() {
  _currentCtx = null;
}

export const SetWorkflowContextTool: NativeTool = {
  name: 'set_workflow_context',
  description: `Set a key-value pair in the shared workflow context. Condition nodes and loop exit conditions evaluate expressions against this context (e.g. "context.capital > 0"). Use this tool to communicate structured data to downstream workflow nodes.
Example: set_workflow_context({ key: "capital", value: 100 }) makes context.capital = 100 available to condition nodes.
You can set any JSON-serializable value: numbers, strings, booleans, objects, arrays.`,
  inputSchema: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description: 'The context key to set (e.g. "capital", "selectedStrategy", "status")',
      },
      value: {
        description: 'The value to set. Can be any JSON type: number, string, boolean, object, array.',
      },
    },
    required: ['key', 'value'],
  },
  execute: async (args: any) => {
    if (!_deps?.engine) {
      return { error: 'Workflow context engine not initialized' };
    }
    if (!_currentCtx) {
      return { error: 'No workflow execution context — this tool can only be used inside a workflow node' };
    }

    const { key, value } = args;
    if (!key || typeof key !== 'string') {
      return { error: 'key must be a non-empty string' };
    }

    const { runId, nodeId } = _currentCtx;

    logger.info(`[SetWorkflowContext] Node ${nodeId} setting context.${key} = ${JSON.stringify(value)}`);

    try {
      _deps.engine.setRunContext(runId, key, value);
      return { success: true, key, value };
    } catch (err: any) {
      logger.error(`[SetWorkflowContext] Failed:`, err);
      return { error: `Failed to set context: ${err.message}` };
    }
  },
};
