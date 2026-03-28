/**
 * User Input Tool — Request input from workflow operator
 *
 * When a workflow sub-agent needs information from the user,
 * it calls this tool with a prompt. The engine blocks execution
 * until the user submits their response via the UI.
 *
 * Dependencies are late-bound via setUserInputDeps() to avoid
 * circular imports with the engine.
 */

import { NativeTool } from '../tool-registry';
import { logger } from '../../logger';

interface UserInputDeps {
  engine: {
    requestInput: (runId: string, nodeId: string, prompt: string) => Promise<string>;
  };
}

let _deps: UserInputDeps | null = null;

/** Current execution context — set by the engine before each tool call */
let _currentContext: { runId: string; nodeId: string } | null = null;

export function setUserInputDeps(deps: UserInputDeps) {
  _deps = deps;
}

export function setUserInputContext(runId: string, nodeId: string) {
  _currentContext = { runId, nodeId };
}

export function clearUserInputContext() {
  _currentContext = null;
}

export const RequestUserInputTool: NativeTool = {
  name: 'request_user_input',
  description: `Request input from the human operator. Use this when you need information that you cannot determine on your own, such as account credentials, preferences, approval for an action, or clarification on a task.
The workflow will pause and wait for the user to respond before continuing.
Input: a clear prompt describing what information you need from the user.
Output: the user's response text.`,
  inputSchema: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'A clear question or instruction for the user. Be specific about what information you need.',
      },
    },
    required: ['prompt'],
  },
  execute: async (args: any) => {
    if (!_deps?.engine) {
      return { error: 'User input engine not initialized' };
    }
    if (!_currentContext) {
      return { error: 'No workflow execution context — this tool can only be used inside a workflow node' };
    }

    const { runId, nodeId } = _currentContext;
    const prompt = args.prompt || 'Please provide input:';

    logger.info(`[RequestUserInput] Node ${nodeId} requesting input: "${prompt}"`);

    try {
      const userInput = await _deps.engine.requestInput(runId, nodeId, prompt);
      logger.info(`[RequestUserInput] Node ${nodeId} received input (${userInput.length} chars)`);
      return { input: userInput };
    } catch (err: any) {
      logger.error(`[RequestUserInput] Failed:`, err);
      return { error: `Failed to get user input: ${err.message}` };
    }
  },
};
