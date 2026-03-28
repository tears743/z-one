/**
 * Workflow Store — SQLite Persistence
 *
 * Manages CRUD for workflows, versions, runs, and node runs.
 * Uses the existing better-sqlite3 database instance from db.ts.
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import {
  WorkflowDefinition,
  WorkflowVersion,
  WorkflowRun,
  NodeRun,
  WorkflowStatus,
  RunStatus,
  NodeRunStatus,
  AgentContextMessage,
} from './types';

let db: Database.Database;

/**
 * Initialize workflow tables. Called from db.ts initDB().
 */
export function initWorkflowTables(database: Database.Database) {
  db = database;

  db.exec(`
    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'draft',
      nodes TEXT NOT NULL DEFAULT '[]',
      edges TEXT NOT NULL DEFAULT '[]',
      source_device_id TEXT,
      source_session_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_versions (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      snapshot TEXT NOT NULL,
      changelog TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_runs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      context TEXT NOT NULL DEFAULT '{}',
      node_states TEXT NOT NULL DEFAULT '{}',
      workflow_version INTEGER NOT NULL,
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      source_device_id TEXT,
      source_session_id TEXT,
      FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS node_runs (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      iteration INTEGER NOT NULL DEFAULT 0,
      started_at INTEGER,
      completed_at INTEGER,
      output TEXT,
      error TEXT,
      logs TEXT NOT NULL DEFAULT '[]',
      message_queue TEXT NOT NULL DEFAULT '[]',
      agent_history TEXT,
      FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE
    )
  `);
}

// ─── Workflow CRUD ──────────────────────────────────────────

export function saveWorkflow(workflow: WorkflowDefinition): void {
  const stmt = db.prepare(`
    INSERT INTO workflows (id, name, description, version, status, nodes, edges, source_device_id, source_session_id, created_at, updated_at)
    VALUES (@id, @name, @description, @version, @status, @nodes, @edges, @sourceDeviceId, @sourceSessionId, @createdAt, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,
      description=excluded.description,
      version=excluded.version,
      status=excluded.status,
      nodes=excluded.nodes,
      edges=excluded.edges,
      source_device_id=excluded.source_device_id,
      source_session_id=excluded.source_session_id,
      updated_at=excluded.updated_at
  `);

  stmt.run({
    id: workflow.id,
    name: workflow.name,
    description: workflow.description || null,
    version: workflow.version,
    status: workflow.status,
    nodes: JSON.stringify(workflow.nodes),
    edges: JSON.stringify(workflow.edges),
    sourceDeviceId: workflow.sourceDeviceId || null,
    sourceSessionId: workflow.sourceSessionId || null,
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
  });
}

export function getWorkflow(id: string): WorkflowDefinition | undefined {
  const row = db.prepare('SELECT * FROM workflows WHERE id = ?').get(id) as any;
  if (!row) return undefined;
  return rowToWorkflow(row);
}

export function listWorkflows(status?: WorkflowStatus): WorkflowDefinition[] {
  let rows: any[];
  if (status) {
    rows = db.prepare('SELECT * FROM workflows WHERE status = ? ORDER BY updated_at DESC').all(status);
  } else {
    rows = db.prepare('SELECT * FROM workflows ORDER BY updated_at DESC').all();
  }
  return rows.map(rowToWorkflow);
}

export function deleteWorkflow(id: string): void {
  db.prepare('DELETE FROM workflows WHERE id = ?').run(id);
}

export function updateWorkflowStatus(id: string, status: WorkflowStatus): void {
  db.prepare('UPDATE workflows SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, Date.now(), id);
}

function rowToWorkflow(row: any): WorkflowDefinition {
  return {
    id: row.id,
    name: row.name,
    description: row.description || undefined,
    version: row.version,
    status: row.status as WorkflowStatus,
    nodes: JSON.parse(row.nodes),
    edges: JSON.parse(row.edges),
    sourceDeviceId: row.source_device_id || undefined,
    sourceSessionId: row.source_session_id || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── Version CRUD ───────────────────────────────────────────

export function saveVersion(version: WorkflowVersion): void {
  db.prepare(`
    INSERT INTO workflow_versions (id, workflow_id, version, snapshot, changelog, created_at)
    VALUES (@id, @workflowId, @version, @snapshot, @changelog, @createdAt)
  `).run({
    id: version.id,
    workflowId: version.workflowId,
    version: version.version,
    snapshot: version.snapshot,
    changelog: version.changelog || null,
    createdAt: version.createdAt,
  });
}

export function getVersions(workflowId: string): WorkflowVersion[] {
  const rows = db.prepare(
    'SELECT * FROM workflow_versions WHERE workflow_id = ? ORDER BY version DESC'
  ).all(workflowId) as any[];

  return rows.map(row => ({
    id: row.id,
    workflowId: row.workflow_id,
    version: row.version,
    snapshot: row.snapshot,
    changelog: row.changelog || undefined,
    createdAt: row.created_at,
  }));
}

// ─── Run CRUD ───────────────────────────────────────────────

export function saveRun(run: WorkflowRun): void {
  db.prepare(`
    INSERT INTO workflow_runs (id, workflow_id, status, context, node_states, workflow_version, started_at, completed_at, source_device_id, source_session_id)
    VALUES (@id, @workflowId, @status, @context, @nodeStates, @workflowVersion, @startedAt, @completedAt, @sourceDeviceId, @sourceSessionId)
    ON CONFLICT(id) DO UPDATE SET
      status=excluded.status,
      context=excluded.context,
      node_states=excluded.node_states,
      completed_at=excluded.completed_at
  `).run({
    id: run.id,
    workflowId: run.workflowId,
    status: run.status,
    context: JSON.stringify(run.context),
    nodeStates: JSON.stringify(run.nodeStates),
    workflowVersion: run.workflowVersion,
    startedAt: run.startedAt,
    completedAt: run.completedAt || null,
    sourceDeviceId: run.sourceDeviceId || null,
    sourceSessionId: run.sourceSessionId || null,
  });
}

export function getRun(id: string): WorkflowRun | undefined {
  const row = db.prepare('SELECT * FROM workflow_runs WHERE id = ?').get(id) as any;
  if (!row) return undefined;
  return rowToRun(row);
}

export function getRunsByWorkflow(workflowId: string): WorkflowRun[] {
  const rows = db.prepare(
    'SELECT * FROM workflow_runs WHERE workflow_id = ? ORDER BY started_at DESC'
  ).all(workflowId) as any[];
  return rows.map(rowToRun);
}

export function updateRunStatus(id: string, status: RunStatus, completedAt?: number): void {
  if (completedAt) {
    db.prepare('UPDATE workflow_runs SET status = ?, completed_at = ? WHERE id = ?')
      .run(status, completedAt, id);
  } else {
    db.prepare('UPDATE workflow_runs SET status = ? WHERE id = ?')
      .run(status, id);
  }
}

export function updateRunContext(id: string, context: Record<string, any>): void {
  db.prepare('UPDATE workflow_runs SET context = ? WHERE id = ?')
    .run(JSON.stringify(context), id);
}

function rowToRun(row: any): WorkflowRun {
  const run: WorkflowRun = {
    id: row.id,
    workflowId: row.workflow_id,
    status: row.status as RunStatus,
    context: JSON.parse(row.context),
    nodeStates: {},
    workflowVersion: row.workflow_version,
    startedAt: row.started_at,
    completedAt: row.completed_at || undefined,
    sourceDeviceId: row.source_device_id || undefined,
    sourceSessionId: row.source_session_id || undefined,
  };

  // Reconstruct nodeStates from the authoritative node_runs table
  // (workflow_runs.node_states is a stale snapshot from startRun() time)
  const nodeRows = db.prepare(
    'SELECT * FROM node_runs WHERE run_id = ?'
  ).all(row.id) as any[];

  if (nodeRows.length > 0) {
    for (const nr of nodeRows) {
      run.nodeStates[nr.node_id] = rowToNodeRun(nr);
    }
  } else {
    // Fallback: if no node_runs exist yet, use the snapshot
    const snapshot = JSON.parse(row.node_states);
    for (const [nodeId, ns] of Object.entries(snapshot)) {
      run.nodeStates[nodeId] = ns as NodeRun;
    }
  }

  return run;
}

// ─── Node Run CRUD ──────────────────────────────────────────

export function saveNodeRun(nodeRun: NodeRun): void {
  db.prepare(`
    INSERT INTO node_runs (id, run_id, node_id, status, iteration, started_at, completed_at, output, error, logs, message_queue, agent_history)
    VALUES (@id, @runId, @nodeId, @status, @iteration, @startedAt, @completedAt, @output, @error, @logs, @messageQueue, @agentHistory)
    ON CONFLICT(id) DO UPDATE SET
      status=excluded.status,
      iteration=excluded.iteration,
      started_at=excluded.started_at,
      completed_at=excluded.completed_at,
      output=excluded.output,
      error=excluded.error,
      logs=excluded.logs,
      message_queue=excluded.message_queue,
      agent_history=excluded.agent_history
  `).run({
    id: nodeRun.id,
    runId: nodeRun.runId,
    nodeId: nodeRun.nodeId,
    status: nodeRun.status,
    iteration: nodeRun.iteration,
    startedAt: nodeRun.startedAt || null,
    completedAt: nodeRun.completedAt || null,
    output: nodeRun.output || null,
    error: nodeRun.error || null,
    logs: JSON.stringify(nodeRun.logs),
    messageQueue: JSON.stringify(nodeRun.messageQueue),
    agentHistory: nodeRun.agentHistory || null,
  });
}

export function getNodeRun(id: string): NodeRun | undefined {
  const row = db.prepare('SELECT * FROM node_runs WHERE id = ?').get(id) as any;
  if (!row) return undefined;
  return rowToNodeRun(row);
}

export function getNodeRunsByRunId(runId: string): NodeRun[] {
  const rows = db.prepare('SELECT * FROM node_runs WHERE run_id = ?').all(runId) as any[];
  return rows.map(rowToNodeRun);
}

export function getNodeRunByNodeId(runId: string, nodeId: string): NodeRun | undefined {
  const row = db.prepare(
    'SELECT * FROM node_runs WHERE run_id = ? AND node_id = ?'
  ).get(runId, nodeId) as any;
  if (!row) return undefined;
  return rowToNodeRun(row);
}

export function appendNodeLog(nodeRunId: string, log: string): void {
  const row = db.prepare('SELECT logs FROM node_runs WHERE id = ?').get(nodeRunId) as any;
  if (!row) return;
  const logs: string[] = JSON.parse(row.logs);
  logs.push(log);
  db.prepare('UPDATE node_runs SET logs = ? WHERE id = ?')
    .run(JSON.stringify(logs), nodeRunId);
}

export function updateNodeRunStatus(id: string, status: NodeRunStatus): void {
  const updates: Record<string, any> = { status };
  if (status === 'running' && !getNodeRun(id)?.startedAt) {
    updates.startedAt = Date.now();
  }
  if (status === 'completed' || status === 'failed' || status === 'skipped') {
    updates.completedAt = Date.now();
  }

  const setClauses = Object.keys(updates)
    .map(k => {
      if (k === 'status') return 'status = ?';
      if (k === 'startedAt') return 'started_at = ?';
      if (k === 'completedAt') return 'completed_at = ?';
      return '';
    })
    .filter(Boolean)
    .join(', ');

  const values = Object.values(updates);
  db.prepare(`UPDATE node_runs SET ${setClauses} WHERE id = ?`)
    .run(...values, id);
}

export function injectNodeMessage(nodeRunId: string, message: AgentContextMessage): void {
  const row = db.prepare('SELECT message_queue FROM node_runs WHERE id = ?').get(nodeRunId) as any;
  if (!row) return;
  const queue: AgentContextMessage[] = JSON.parse(row.message_queue);
  queue.push(message);
  db.prepare('UPDATE node_runs SET message_queue = ? WHERE id = ?')
    .run(JSON.stringify(queue), nodeRunId);
}

export function drainNodeMessages(nodeRunId: string): AgentContextMessage[] {
  const row = db.prepare('SELECT message_queue FROM node_runs WHERE id = ?').get(nodeRunId) as any;
  if (!row) return [];
  const queue: AgentContextMessage[] = JSON.parse(row.message_queue);
  if (queue.length > 0) {
    db.prepare('UPDATE node_runs SET message_queue = ? WHERE id = ?')
      .run('[]', nodeRunId);
  }
  return queue;
}

function rowToNodeRun(row: any): NodeRun {
  return {
    id: row.id,
    runId: row.run_id,
    nodeId: row.node_id,
    status: row.status as NodeRunStatus,
    iteration: row.iteration,
    startedAt: row.started_at || undefined,
    completedAt: row.completed_at || undefined,
    output: row.output || undefined,
    error: row.error || undefined,
    logs: JSON.parse(row.logs),
    messageQueue: JSON.parse(row.message_queue),
    agentHistory: row.agent_history || undefined,
  };
}
