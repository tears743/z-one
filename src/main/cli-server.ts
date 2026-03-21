/**
 * Z-One CLI Server — Unix Socket Server embedded in the main GUI process.
 *
 * Allows the CLI client to communicate with the running app instance
 * via a Unix Domain Socket (IPC). This enables:
 * - CLI -> App: send messages, manage workflows
 * - App <-> CLI: share the same Planner, WorkflowEngine, DB
 */

import * as net from "net";
import * as fs from "fs";
import * as path from "path";
import { logger } from "./logger";
import type { Planner } from "./intelligence/planner";
import * as workflowStore from "./workflow/store";

const SOCKET_PATH =
  process.platform === "win32"
    ? "\\\\.\\pipe\\z-one-cli"
    : "/tmp/z-one-cli.sock";

export class CLIServer {
  private server: net.Server | null = null;
  private planner: Planner;
  private getModelConfig: () => any;

  constructor(planner: Planner, getModelConfig: () => any) {
    this.planner = planner;
    this.getModelConfig = getModelConfig;
  }

  start(): void {
    // Clean up stale socket
    if (process.platform !== "win32" && fs.existsSync(SOCKET_PATH)) {
      try {
        fs.unlinkSync(SOCKET_PATH);
      } catch {}
    }

    this.server = net.createServer((conn) => this.handleConnection(conn));

    this.server.listen(SOCKET_PATH, () => {
      logger.info(`[CLIServer] Listening on ${SOCKET_PATH}`);
      // Ensure socket is accessible
      if (process.platform !== "win32") {
        try {
          fs.chmodSync(SOCKET_PATH, 0o770);
        } catch {}
      }
    });

    this.server.on("error", (err) => {
      logger.error("[CLIServer] Server error:", err);
    });
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    // Clean up socket file
    if (process.platform !== "win32" && fs.existsSync(SOCKET_PATH)) {
      try {
        fs.unlinkSync(SOCKET_PATH);
      } catch {}
    }
    logger.info("[CLIServer] Stopped.");
  }

  private handleConnection(conn: net.Socket) {
    let buffer = "";

    conn.on("data", (data) => {
      buffer += data.toString();
      // Messages are newline-delimited JSON
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.trim()) {
          this.handleRequest(line.trim(), conn);
        }
      }
    });

    conn.on("error", (err) => {
      logger.warn("[CLIServer] Connection error:", err.message);
    });
  }

  private async handleRequest(raw: string, conn: net.Socket) {
    let req: any;
    try {
      req = JSON.parse(raw);
    } catch {
      this.sendResponse(conn, { error: "Invalid JSON" });
      return;
    }

    const { id, method, params } = req;

    try {
      let result: any;

      switch (method) {
        case "ping":
          result = { pong: true, timestamp: Date.now() };
          break;

        case "chat":
          result = await this.handleChat(params, conn);
          break;

        case "workflow.list":
          result = this.handleWorkflowList();
          break;

        case "workflow.status":
          result = this.handleWorkflowStatus(params);
          break;

        case "workflow.start":
          result = await this.handleWorkflowStart(params);
          break;

        case "workflow.pause":
          result = this.handleWorkflowPause(params);
          break;

        case "workflow.resume":
          result = await this.handleWorkflowResume(params);
          break;

        case "workflow.inject":
          result = this.handleWorkflowInject(params);
          break;

        case "workflow.logs":
          result = this.handleWorkflowLogs(params);
          break;

        case "workflow.delete":
          result = this.handleWorkflowDelete(params);
          break;

        default:
          result = { error: `Unknown method: ${method}` };
      }

      this.sendResponse(conn, { id, result });
    } catch (err: any) {
      this.sendResponse(conn, { id, error: err.message });
    }
  }

  private sendResponse(conn: net.Socket, data: any) {
    try {
      conn.write(JSON.stringify(data) + "\n");
    } catch {}
  }

  // ─── Handlers ─────────────────────────────────────────────────────────

  private async handleChat(params: any, conn: net.Socket): Promise<any> {
    const { message, sessionId } = params || {};
    if (!message) return { error: "Missing message" };

    const modelConfig = this.getModelConfig();
    if (!modelConfig) return { error: "No active model configured" };

    const chunks: string[] = [];
    const result = await this.planner.processInput(
      "cli",
      message,
      modelConfig,
      (chunk) => {
        if (typeof chunk === "string") {
          chunks.push(chunk);
          // Stream chunks to CLI
          this.sendResponse(conn, { stream: true, chunk });
        }
      },
      sessionId || `cli-${Date.now()}`,
    );

    return { success: true, response: result, chunks };
  }

  private handleWorkflowList() {
    const workflows = workflowStore.listWorkflows();
    return {
      workflows: workflows.map((w) => ({
        id: w.id,
        name: w.name,
        description: w.description,
        version: w.version,
        updatedAt: w.updatedAt,
      })),
    };
  }

  private handleWorkflowStatus(params: any) {
    const { id } = params || {};
    if (!id) return { error: "Missing workflow id" };

    const workflow = workflowStore.getWorkflow(id);
    if (!workflow) return { error: `Workflow ${id} not found` };

    const runs = workflowStore.getRunsByWorkflow(id);
    return { workflow, runs };
  }

  private async handleWorkflowStart(params: any) {
    const { id } = params || {};
    if (!id) return { error: "Missing workflow id" };

    const engine = this.planner.getWorkflowEngine();
    if (!engine) return { error: "Workflow engine not initialized" };

    const modelConfig = this.getModelConfig();
    const run = await engine.startWorkflow(id, modelConfig);
    return { success: true, runId: run.id };
  }

  private handleWorkflowPause(params: any) {
    const { runId } = params || {};
    if (!runId) return { error: "Missing runId" };

    const engine = this.planner.getWorkflowEngine();
    if (!engine) return { error: "Workflow engine not initialized" };

    engine.pauseWorkflow(runId);
    return { success: true };
  }

  private async handleWorkflowResume(params: any) {
    const { runId } = params || {};
    if (!runId) return { error: "Missing runId" };

    const engine = this.planner.getWorkflowEngine();
    if (!engine) return { error: "Workflow engine not initialized" };

    const modelConfig = this.getModelConfig();
    await engine.resumeWorkflow(runId, modelConfig);
    return { success: true };
  }

  private handleWorkflowInject(params: any) {
    const { runId, nodeId, message } = params || {};
    if (!runId || !nodeId || !message) return { error: "Missing runId, nodeId, or message" };

    const engine = this.planner.getWorkflowEngine();
    if (!engine) return { error: "Workflow engine not initialized" };

    engine.injectMessage(runId, nodeId, message);
    return { success: true };
  }

  private handleWorkflowLogs(params: any) {
    const { runId, nodeId } = params || {};
    if (!runId) return { error: "Missing runId" };

    const run = workflowStore.getRun(runId);
    if (!run) return { error: `Run ${runId} not found` };

    if (nodeId) {
      const nodeState = run.nodeStates[nodeId];
      return nodeState ? { ...nodeState } : { error: `Node ${nodeId} not found` };
    }

    return { nodeStates: run.nodeStates };
  }

  private handleWorkflowDelete(params: any) {
    const { id } = params || {};
    if (!id) return { error: "Missing id" };

    workflowStore.deleteWorkflow(id);
    return { success: true };
  }
}

export { SOCKET_PATH };
