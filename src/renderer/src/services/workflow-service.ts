/**
 * Workflow Service — Renderer-side API
 *
 * Provides a clean interface for workflow operations via
 * the preload-exposed IPC channels.
 */

import type {
  WorkflowDefinition,
  WorkflowRun,
  WorkflowEvent,
} from '../types/workflow';

declare global {
  interface Window {
    api: {
      workflow: {
        list: () => Promise<WorkflowDefinition[]>;
        get: (id: string) => Promise<WorkflowDefinition | undefined>;
        create: (request: string, modelConfig?: any) => Promise<WorkflowDefinition>;
        delete: (id: string) => Promise<void>;
        start: (workflowId: string, deviceId?: string, sessionId?: string) => Promise<WorkflowRun>;
        pause: (runId: string) => Promise<boolean>;
        resume: (runId: string) => Promise<boolean>;
        cancel: (runId: string) => Promise<boolean>;
        injectMessage: (runId: string, nodeId: string, content: string, source?: string) => Promise<boolean>;
        getNodeLogs: (runId: string, nodeId: string) => Promise<string[]>;
        getRuns: (workflowId: string) => Promise<WorkflowRun[]>;
        confirmProposal: (proposal: any) => Promise<WorkflowDefinition>;
        submitInput: (runId: string, nodeId: string, input: string) => Promise<boolean>;
        onEvent: (callback: (event: WorkflowEvent) => void) => () => void;
      };
    };
  }
}

class WorkflowService {
  async listWorkflows(): Promise<WorkflowDefinition[]> {
    return window.api.workflow.list();
  }

  async getWorkflow(id: string): Promise<WorkflowDefinition | undefined> {
    return window.api.workflow.get(id);
  }

  async createWorkflow(request: string, modelConfig?: any): Promise<WorkflowDefinition> {
    return window.api.workflow.create(request, modelConfig);
  }

  async deleteWorkflow(id: string): Promise<void> {
    return window.api.workflow.delete(id);
  }

  async startRun(workflowId: string, deviceId?: string, sessionId?: string): Promise<WorkflowRun> {
    return window.api.workflow.start(workflowId, deviceId, sessionId);
  }

  async pauseRun(runId: string): Promise<boolean> {
    return window.api.workflow.pause(runId);
  }

  async resumeRun(runId: string): Promise<boolean> {
    return window.api.workflow.resume(runId);
  }

  async cancelRun(runId: string): Promise<boolean> {
    return window.api.workflow.cancel(runId);
  }

  async injectMessage(runId: string, nodeId: string, content: string, source?: string): Promise<boolean> {
    return window.api.workflow.injectMessage(runId, nodeId, content, source);
  }

  async getNodeLogs(runId: string, nodeId: string): Promise<string[]> {
    return window.api.workflow.getNodeLogs(runId, nodeId);
  }

  async getRuns(workflowId: string): Promise<WorkflowRun[]> {
    return window.api.workflow.getRuns(workflowId);
  }

  async confirmProposal(proposal: any): Promise<WorkflowDefinition> {
    return window.api.workflow.confirmProposal(proposal);
  }

  onEvent(callback: (event: WorkflowEvent) => void): () => void {
    return window.api.workflow.onEvent(callback);
  }

  async submitInput(runId: string, nodeId: string, input: string): Promise<boolean> {
    return window.api.workflow.submitInput(runId, nodeId, input);
  }
}

export const workflowService = new WorkflowService();
