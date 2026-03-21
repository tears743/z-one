import { useState, useEffect, useCallback } from "react";
import {
  GitBranch,
  Play,
  Pause,
  Trash2,
  RefreshCw,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  ArrowRight,
  Workflow,
} from "lucide-react";

interface WorkflowItem {
  id: string;
  name: string;
  description: string;
  version: number;
  nodes: any[];
  edges: any[];
  updatedAt: number;
  createdAt: number;
}

interface RunItem {
  id: string;
  workflowId: string;
  status: string;
  startedAt: number;
  completedAt?: number;
}

const api = (window as any).api;

const statusIcons: Record<string, any> = {
  pending: Clock,
  running: RefreshCw,
  completed: CheckCircle,
  failed: XCircle,
  paused: Pause,
};

const statusColors: Record<string, string> = {
  pending: "var(--color-text-muted)",
  running: "var(--color-primary)",
  completed: "#22c55e",
  failed: "#ef4444",
  paused: "#f59e0b",
};

export function WorkflowListPage({
  trans,
  onSelectWorkflow,
}: {
  trans: any;
  onSelectWorkflow: (id: string) => void;
}) {
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([]);
  const [runs, setRuns] = useState<Record<string, RunItem[]>>({});
  const [loading, setLoading] = useState(true);

  const wt = trans.workflow;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.workflow.list();
      setWorkflows(list || []);
      // Load latest runs for each workflow
      const runMap: Record<string, RunItem[]> = {};
      for (const w of list || []) {
        try {
          const r = await api.workflow.getRuns(w.id);
          runMap[w.id] = r || [];
        } catch {}
      }
      setRuns(runMap);
    } catch (err) {
      console.error("Failed to load workflows:", err);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    // Listen for workflow events
    const cleanup = api.workflow.onEvent(() => load());
    return cleanup;
  }, [load]);

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(wt.deleteConfirm)) return;
    await api.workflow.delete(id);
    load();
  };

  const handleStart = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await api.workflow.start(id);
    load();
  };

  const getLatestRun = (workflowId: string): RunItem | undefined => {
    const r = runs[workflowId];
    if (!r || r.length === 0) return undefined;
    return r.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))[0];
  };

  const formatTime = (ts: number) => {
    if (!ts) return "-";
    return new Date(ts).toLocaleString();
  };

  return (
    <div className="workflow-list-page">
      <div className="workflow-list-header">
        <div className="workflow-list-title">
          <Workflow size={22} />
          <h2>{wt.list}</h2>
        </div>
        <button className="workflow-refresh-btn" onClick={load} title="Refresh">
          <RefreshCw size={16} className={loading ? "spin" : ""} />
        </button>
      </div>

      {workflows.length === 0 && !loading ? (
        <div className="workflow-empty">
          <GitBranch size={48} strokeWidth={1} />
          <p>{wt.noWorkflows}</p>
        </div>
      ) : (
        <div className="workflow-grid">
          {workflows.map((w) => {
            const latestRun = getLatestRun(w.id);
            const StatusIcon = latestRun
              ? statusIcons[latestRun.status] || AlertCircle
              : null;
            const statusColor = latestRun
              ? statusColors[latestRun.status] || "var(--color-text-muted)"
              : undefined;

            return (
              <div
                key={w.id}
                className="workflow-card"
                onClick={() => onSelectWorkflow(w.id)}
              >
                <div className="workflow-card-header">
                  <div className="workflow-card-name">{w.name}</div>
                  <div className="workflow-card-version">v{w.version}</div>
                </div>

                {w.description && (
                  <div className="workflow-card-desc">{w.description}</div>
                )}

                <div className="workflow-card-meta">
                  <span className="workflow-card-nodes">
                    {w.nodes?.length || 0} {wt.nodes}
                  </span>
                  <span className="workflow-card-sep">·</span>
                  <span>{formatTime(w.updatedAt)}</span>
                </div>

                {latestRun && StatusIcon && (
                  <div
                    className="workflow-card-status"
                    style={{ color: statusColor }}
                  >
                    <StatusIcon size={14} />
                    <span>
                      {(wt.runStatus as any)[latestRun.status] ||
                        latestRun.status}
                    </span>
                  </div>
                )}

                <div className="workflow-card-actions">
                  <button
                    className="workflow-action-btn start"
                    onClick={(e) => handleStart(w.id, e)}
                    title={wt.start}
                  >
                    <Play size={14} />
                  </button>
                  <button
                    className="workflow-action-btn delete"
                    onClick={(e) => handleDelete(w.id, e)}
                    title={wt.delete}
                  >
                    <Trash2 size={14} />
                  </button>
                  <button
                    className="workflow-action-btn detail"
                    onClick={() => onSelectWorkflow(w.id)}
                    title={wt.detail}
                  >
                    <ArrowRight size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
