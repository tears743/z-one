/**
 * Z-One Workflow Store — SQLite persistence for workflows, runs, and versions.
 */

import Database from "better-sqlite3";
import { v4 as uuid } from "uuid";
import {
  WorkflowDefinition,
  WorkflowRun,
  WorkflowVersion,
  NodeRun,
  NodeStatus,
  WorkflowStatus,
} from "./types";
import { logger } from "../logger";

let db: Database.Database | null = null;

/**
 * Initialize workflow tables. Call after main DB init.
 */
export function initWorkflowStore(database: Database.Database) {
  db = database;

  db.exec(`
    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      version INTEGER DEFAULT 1,
      definition_json TEXT NOT NULL,
      source_device_id TEXT NOT NULL,
      source_session_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_versions (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      definition_json TEXT NOT NULL,
      changelog TEXT DEFAULT '',
      created_at INTEGER NOT NULL,
      FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_runs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      context_json TEXT DEFAULT '{}',
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS node_runs (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      output_json TEXT,
      logs_json TEXT DEFAULT '[]',
      message_queue_json TEXT DEFAULT '[]',
      iterations INTEGER DEFAULT 0,
      started_at INTEGER,
      completed_at INTEGER,
      FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE
    )
  `);

  logger.info("[WorkflowStore] Tables initialized.");
}

function getDB(): Database.Database {
  if (!db) throw new Error("WorkflowStore not initialized. Call initWorkflowStore first.");
  return db;
}

// ─── Workflow CRUD ────────────────────────────────────────────────────────────

export function createWorkflow(def: WorkflowDefinition): WorkflowDefinition {
  const d = getDB();
  const now = Date.now();
  const workflow: WorkflowDefinition = {
    ...def,
    id: def.id || uuid(),
    version: 1,
    createdAt: now,
    updatedAt: now,
  };

  d.prepare(`
    INSERT INTO workflows (id, name, description, version, definition_json, source_device_id, source_session_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    workflow.id,
    workflow.name,
    workflow.description,
    workflow.version,
    JSON.stringify(workflow),
    workflow.sourceDeviceId,
    workflow.sourceSessionId,
    workflow.createdAt,
    workflow.updatedAt,
  );

  // Save initial version
  saveVersion(workflow, "Initial version");

  logger.info(`[WorkflowStore] Created workflow: ${workflow.id} "${workflow.name}"`);
  return workflow;
}

export function getWorkflow(id: string): WorkflowDefinition | null {
  const row = getDB().prepare("SELECT definition_json FROM workflows WHERE id = ?").get(id) as any;
  if (!row) return null;
  return JSON.parse(row.definition_json);
}

export function listWorkflows(): WorkflowDefinition[] {
  const rows = getDB().prepare("SELECT definition_json FROM workflows ORDER BY updated_at DESC").all() as any[];
  return rows.map((r) => JSON.parse(r.definition_json));
}

export function updateWorkflow(
  workflow: WorkflowDefinition,
  changelog: string = "Updated",
): WorkflowDefinition {
  const d = getDB();
  const now = Date.now();
  const updated = {
    ...workflow,
    version: workflow.version + 1,
    updatedAt: now,
  };

  d.prepare(`
    UPDATE workflows SET name = ?, description = ?, version = ?, definition_json = ?, updated_at = ?
    WHERE id = ?
  `).run(updated.name, updated.description, updated.version, JSON.stringify(updated), now, updated.id);

  saveVersion(updated, changelog);

  logger.info(`[WorkflowStore] Updated workflow: ${updated.id} to v${updated.version}`);
  return updated;
}

export function deleteWorkflow(id: string): void {
  getDB().prepare("DELETE FROM workflows WHERE id = ?").run(id);
  logger.info(`[WorkflowStore] Deleted workflow: ${id}`);
}

// ─── Versions ─────────────────────────────────────────────────────────────────

function saveVersion(workflow: WorkflowDefinition, changelog: string) {
  getDB().prepare(`
    INSERT INTO workflow_versions (id, workflow_id, version, definition_json, changelog, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(uuid(), workflow.id, workflow.version, JSON.stringify(workflow), changelog, Date.now());
}

export function getVersions(workflowId: string): WorkflowVersion[] {
  const rows = getDB()
    .prepare("SELECT * FROM workflow_versions WHERE workflow_id = ? ORDER BY version DESC")
    .all(workflowId) as any[];

  return rows.map((r) => ({
    id: r.id,
    workflowId: r.workflow_id,
    version: r.version,
    definition: JSON.parse(r.definition_json),
    changelog: r.changelog,
    createdAt: r.created_at,
  }));
}

export function getVersion(workflowId: string, version: number): WorkflowDefinition | null {
  const row = getDB()
    .prepare("SELECT definition_json FROM workflow_versions WHERE workflow_id = ? AND version = ?")
    .get(workflowId, version) as any;
  if (!row) return null;
  return JSON.parse(row.definition_json);
}

// ─── Workflow Runs ────────────────────────────────────────────────────────────

export function createRun(workflowId: string, workflow: WorkflowDefinition): WorkflowRun {
  const d = getDB();
  const runId = uuid();
  const now = Date.now();

  // Initialize node states for all nodes
  const nodeStates: Record<string, NodeRun> = {};
  for (const node of workflow.nodes) {
    nodeStates[node.id] = {
      nodeId: node.id,
      status: "pending",
      logs: [],
      messageQueue: [],
    };
  }

  const run: WorkflowRun = {
    id: runId,
    workflowId,
    status: "running",
    context: {},
    nodeStates,
    startedAt: now,
  };

  d.prepare(`
    INSERT INTO workflow_runs (id, workflow_id, status, context_json, started_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(runId, workflowId, "running", JSON.stringify(run.context), now);

  // Insert node runs
  const insertNode = d.prepare(`
    INSERT INTO node_runs (id, run_id, node_id, status, logs_json, message_queue_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const node of workflow.nodes) {
    insertNode.run(uuid(), runId, node.id, "pending", "[]", "[]");
  }

  logger.info(`[WorkflowStore] Created run: ${runId} for workflow ${workflowId}`);
  return run;
}

export function getRun(runId: string): WorkflowRun | null {
  const d = getDB();
  const runRow = d.prepare("SELECT * FROM workflow_runs WHERE id = ?").get(runId) as any;
  if (!runRow) return null;

  const nodeRows = d.prepare("SELECT * FROM node_runs WHERE run_id = ?").all(runId) as any[];
  const nodeStates: Record<string, NodeRun> = {};

  for (const nr of nodeRows) {
    nodeStates[nr.node_id] = {
      nodeId: nr.node_id,
      status: nr.status as NodeStatus,
      output: nr.output_json ? JSON.parse(nr.output_json) : undefined,
      logs: JSON.parse(nr.logs_json || "[]"),
      iterations: nr.iterations,
      startedAt: nr.started_at,
      completedAt: nr.completed_at,
      messageQueue: JSON.parse(nr.message_queue_json || "[]"),
    };
  }

  return {
    id: runRow.id,
    workflowId: runRow.workflow_id,
    status: runRow.status as WorkflowStatus,
    context: JSON.parse(runRow.context_json || "{}"),
    nodeStates,
    startedAt: runRow.started_at,
    completedAt: runRow.completed_at,
  };
}

export function getRunsByWorkflow(workflowId: string): WorkflowRun[] {
  const rows = getDB()
    .prepare("SELECT id FROM workflow_runs WHERE workflow_id = ? ORDER BY started_at DESC")
    .all(workflowId) as any[];
  return rows.map((r) => getRun(r.id)).filter(Boolean) as WorkflowRun[];
}

export function updateRunStatus(runId: string, status: WorkflowStatus) {
  const completedAt = ["completed", "failed"].includes(status) ? Date.now() : null;
  getDB().prepare("UPDATE workflow_runs SET status = ?, completed_at = ? WHERE id = ?")
    .run(status, completedAt, runId);
}

export function updateRunContext(runId: string, context: Record<string, any>) {
  getDB().prepare("UPDATE workflow_runs SET context_json = ? WHERE id = ?")
    .run(JSON.stringify(context), runId);
}

// ─── Node Runs ────────────────────────────────────────────────────────────────

export function updateNodeStatus(runId: string, nodeId: string, status: NodeStatus) {
  const d = getDB();
  const updates: any = { status };
  if (status === "running" && !d.prepare("SELECT started_at FROM node_runs WHERE run_id = ? AND node_id = ?").get(runId, nodeId)) {
    updates.startedAt = Date.now();
  }
  if (["completed", "failed", "skipped"].includes(status)) {
    updates.completedAt = Date.now();
  }

  d.prepare(`
    UPDATE node_runs SET status = ?,
      started_at = COALESCE(?, started_at),
      completed_at = COALESCE(?, completed_at)
    WHERE run_id = ? AND node_id = ?
  `).run(
    status,
    status === "running" ? Date.now() : null,
    ["completed", "failed", "skipped"].includes(status) ? Date.now() : null,
    runId,
    nodeId,
  );
}

export function updateNodeOutput(runId: string, nodeId: string, output: any) {
  getDB().prepare("UPDATE node_runs SET output_json = ? WHERE run_id = ? AND node_id = ?")
    .run(JSON.stringify(output), runId, nodeId);
}

export function appendNodeLog(runId: string, nodeId: string, log: string) {
  const d = getDB();
  const row = d.prepare("SELECT logs_json FROM node_runs WHERE run_id = ? AND node_id = ?")
    .get(runId, nodeId) as any;
  if (!row) return;

  const logs: string[] = JSON.parse(row.logs_json || "[]");
  logs.push(`[${new Date().toISOString()}] ${log}`);
  d.prepare("UPDATE node_runs SET logs_json = ? WHERE run_id = ? AND node_id = ?")
    .run(JSON.stringify(logs), runId, nodeId);
}

export function updateNodeIterations(runId: string, nodeId: string, iterations: number) {
  getDB().prepare("UPDATE node_runs SET iterations = ? WHERE run_id = ? AND node_id = ?")
    .run(iterations, runId, nodeId);
}

// ─── Message Queue ────────────────────────────────────────────────────────────

export function injectMessage(runId: string, nodeId: string, message: string) {
  const d = getDB();
  const row = d.prepare("SELECT message_queue_json FROM node_runs WHERE run_id = ? AND node_id = ?")
    .get(runId, nodeId) as any;
  if (!row) throw new Error(`Node ${nodeId} not found in run ${runId}`);

  const queue: string[] = JSON.parse(row.message_queue_json || "[]");
  queue.push(message);
  d.prepare("UPDATE node_runs SET message_queue_json = ? WHERE run_id = ? AND node_id = ?")
    .run(JSON.stringify(queue), runId, nodeId);

  logger.info(`[WorkflowStore] Injected message to node ${nodeId} in run ${runId}`);
}

export function drainMessageQueue(runId: string, nodeId: string): string[] {
  const d = getDB();
  const row = d.prepare("SELECT message_queue_json FROM node_runs WHERE run_id = ? AND node_id = ?")
    .get(runId, nodeId) as any;
  if (!row) return [];

  const queue: string[] = JSON.parse(row.message_queue_json || "[]");
  if (queue.length === 0) return [];

  // Clear the queue
  d.prepare("UPDATE node_runs SET message_queue_json = '[]' WHERE run_id = ? AND node_id = ?")
    .run(runId, nodeId);

  return queue;
}
