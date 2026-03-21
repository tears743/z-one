import { useState, useEffect, useCallback, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  MarkerType,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ArrowLeft,
  Play,
  Pause,
  RotateCcw,
  CheckCircle,
  XCircle,
  RefreshCw,
  MessageSquare,
  GitBranch,
  CircleDot,
  Repeat,
  Layers,
  ChevronDown,
  ChevronUp,
  Send,
  Loader,
} from "lucide-react";

const api = (window as any).api;

/* ── Status colors & helpers ────────────────────────────────────────────── */

const STATUS_COLORS: Record<string, string> = {
  pending: "#64748b",
  running: "#3b82f6",
  completed: "#22c55e",
  failed: "#ef4444",
  paused: "#f59e0b",
  skipped: "#94a3b8",
};

const STATUS_BG: Record<string, string> = {
  pending: "rgba(100,116,139,.12)",
  running: "rgba(59,130,246,.15)",
  completed: "rgba(34,197,94,.12)",
  failed: "rgba(239,68,68,.12)",
  paused: "rgba(245,158,11,.12)",
  skipped: "rgba(148,163,184,.08)",
};

/* ── Custom Node Components ─────────────────────────────────────────────── */

function TaskNode({ data }: { data: any }) {
  const color = STATUS_COLORS[data.status] || STATUS_COLORS.pending;
  const bg = STATUS_BG[data.status] || STATUS_BG.pending;
  const isRunning = data.status === "running";

  return (
    <div
      className={`wf-node wf-node-task ${isRunning ? "wf-node-pulse" : ""}`}
      style={{ borderColor: color, background: bg }}
      onClick={() => data.onSelect?.(data.nodeId)}
    >
      <Handle type="target" position={Position.Top} className="wf-handle" />
      <div className="wf-node-inner">
        <CircleDot size={14} style={{ color, flexShrink: 0 }} />
        <span className="wf-node-label">{data.label}</span>
        {data.status === "completed" && <CheckCircle size={12} color="#22c55e" />}
        {data.status === "failed" && <XCircle size={12} color="#ef4444" />}
        {isRunning && <Loader size={12} className="wf-spin" color="#3b82f6" />}
      </div>
      <Handle type="source" position={Position.Bottom} className="wf-handle" />
    </div>
  );
}

function ConditionNode({ data }: { data: any }) {
  const color = STATUS_COLORS[data.status] || STATUS_COLORS.pending;
  const bg = STATUS_BG[data.status] || STATUS_BG.pending;
  const isRunning = data.status === "running";

  return (
    <div
      className={`wf-node wf-node-condition ${isRunning ? "wf-node-pulse" : ""}`}
      style={{ borderColor: color, background: bg }}
      onClick={() => data.onSelect?.(data.nodeId)}
    >
      <Handle type="target" position={Position.Top} className="wf-handle" />
      <div className="wf-node-inner">
        <GitBranch size={14} style={{ color, flexShrink: 0 }} />
        <span className="wf-node-label">{data.label}</span>
        {isRunning && <Loader size={12} className="wf-spin" color="#3b82f6" />}
      </div>
      <Handle type="source" position={Position.Bottom} className="wf-handle" id="default" />
      <Handle type="source" position={Position.Right} className="wf-handle" id="right" />
    </div>
  );
}

function LoopNode({ data }: { data: any }) {
  const color = STATUS_COLORS[data.status] || STATUS_COLORS.pending;
  const bg = STATUS_BG[data.status] || STATUS_BG.pending;
  const isRunning = data.status === "running";

  return (
    <div
      className={`wf-node wf-node-loop ${isRunning ? "wf-node-pulse" : ""}`}
      style={{ borderColor: color, background: bg }}
      onClick={() => data.onSelect?.(data.nodeId)}
    >
      <Handle type="target" position={Position.Top} className="wf-handle" />
      <div className="wf-node-inner">
        <Repeat size={14} style={{ color, flexShrink: 0 }} />
        <span className="wf-node-label">{data.label}</span>
        {data.iterations > 0 && (
          <span className="wf-node-badge">{data.iterations}x</span>
        )}
        {isRunning && <Loader size={12} className="wf-spin" color="#3b82f6" />}
      </div>
      <Handle type="source" position={Position.Bottom} className="wf-handle" />
    </div>
  );
}

function GatewayNode({ data }: { data: any }) {
  const color = STATUS_COLORS[data.status] || STATUS_COLORS.pending;
  const bg = STATUS_BG[data.status] || STATUS_BG.pending;

  return (
    <div
      className="wf-node wf-node-gateway"
      style={{ borderColor: color, background: bg }}
      onClick={() => data.onSelect?.(data.nodeId)}
    >
      <Handle type="target" position={Position.Top} className="wf-handle" />
      <div className="wf-node-inner">
        <Layers size={14} style={{ color, flexShrink: 0 }} />
        <span className="wf-node-label">{data.label}</span>
      </div>
      <Handle type="source" position={Position.Bottom} className="wf-handle" />
    </div>
  );
}

const nodeTypes = {
  task: TaskNode,
  condition: ConditionNode,
  loop: LoopNode,
  gateway: GatewayNode,
};

/* ── Main Component ─────────────────────────────────────────────────────── */

export function WorkflowDetailPage({
  workflowId,
  trans,
  onBack,
}: {
  workflowId: string;
  trans: any;
  onBack: () => void;
}) {
  const [workflow, setWorkflow] = useState<any>(null);
  const [runs, setRuns] = useState<any[]>([]);
  const [selectedRun, setSelectedRun] = useState<any>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [panelHeight, setPanelHeight] = useState(200);
  const [panelCollapsed, setPanelCollapsed] = useState(true);
  const [injectText, setInjectText] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  const wt = trans.workflow;

  const load = useCallback(async () => {
    try {
      const w = await api.workflow.get(workflowId);
      setWorkflow(w);
      const r = await api.workflow.getRuns(workflowId);
      setRuns(r || []);
      if (r && r.length > 0) {
        const latest = r.sort(
          (a: any, b: any) => (b.startedAt || 0) - (a.startedAt || 0),
        )[0];
        const runDetail = await api.workflow.getRun(latest.id);
        setSelectedRun(runDetail);
      }
    } catch (err) {
      console.error("Failed to load workflow detail:", err);
    }
  }, [workflowId]);

  useEffect(() => {
    load();
    const cleanup = api.workflow.onEvent((event: any) => {
      if (event.workflowId === workflowId) load();
    });
    return cleanup;
  }, [load, workflowId]);

  const handleStart = async () => {
    await api.workflow.start(workflowId);
    load();
  };

  const handlePause = async (runId: string) => {
    await api.workflow.pause(runId);
    load();
  };

  const handleResume = async (runId: string) => {
    await api.workflow.resume(runId);
    load();
  };

  const handleInject = async () => {
    if (!selectedRun || !selectedNodeId || !injectText.trim()) return;
    await api.workflow.injectMessage(
      selectedRun.id,
      selectedNodeId,
      injectText.trim(),
    );
    setInjectText("");
    load();
  };

  const handleSelectNode = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    setPanelCollapsed(false);
  }, []);

  /* ── Drag resize logic ──────────────────────────────────────────────── */

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    const startY = e.clientY;
    const startHeight = panelHeight;

    const onMove = (ev: MouseEvent) => {
      const delta = startY - ev.clientY;
      const newHeight = Math.max(80, Math.min(500, startHeight + delta));
      setPanelHeight(newHeight);
      setPanelCollapsed(false);
    };

    const onUp = () => {
      setIsDragging(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [panelHeight]);

  /* ── Build React Flow nodes & edges ─────────────────────────────────── */

  const { flowNodes, flowEdges } = useMemo(() => {
    if (!workflow) return { flowNodes: [], flowEdges: [] };

    const nodes: Node[] = (workflow.nodes || []).map((n: any) => {
      const nodeState = selectedRun?.nodeStates?.[n.id];
      return {
        id: n.id,
        type: n.type || "task",
        position: n.position || { x: 200, y: 50 },
        data: {
          label: n.label,
          nodeId: n.id,
          status: nodeState?.status || "pending",
          iterations: nodeState?.iterations || 0,
          onSelect: handleSelectNode,
        },
      };
    });

    const edges: Edge[] = (workflow.edges || []).map((e: any) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.condition || e.label || undefined,
      animated: selectedRun?.nodeStates?.[e.source]?.status === "running",
      style: {
        stroke:
          selectedRun?.nodeStates?.[e.source]?.status === "completed"
            ? "#22c55e"
            : selectedRun?.nodeStates?.[e.source]?.status === "running"
              ? "#3b82f6"
              : "#475569",
        strokeWidth: 2,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color:
          selectedRun?.nodeStates?.[e.source]?.status === "completed"
            ? "#22c55e"
            : "#475569",
      },
      labelStyle: {
        fill: "var(--color-text-secondary)",
        fontSize: 11,
        fontWeight: 500,
      },
      labelBgStyle: {
        fill: "var(--bg-secondary)",
        fillOpacity: 0.9,
      },
    }));

    return { flowNodes: nodes, flowEdges: edges };
  }, [workflow, selectedRun, handleSelectNode]);

  /* ── Selected node details ──────────────────────────────────────────── */

  const selectedNode = workflow?.nodes?.find(
    (n: any) => n.id === selectedNodeId,
  );
  const selectedNodeState = selectedRun?.nodeStates?.[selectedNodeId || ""];

  const formatTime = (ts: number) =>
    ts ? new Date(ts).toLocaleString() : "-";

  /* ── Render ─────────────────────────────────────────────────────────── */

  if (!workflow) {
    return (
      <div className="workflow-detail-page">
        <div className="workflow-detail-loading">
          <RefreshCw size={24} className="spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="workflow-detail-page wf-detail-layout">
      {/* ── Header ── */}
      <div className="workflow-detail-header">
        <button className="workflow-back-btn" onClick={onBack}>
          <ArrowLeft size={18} />
          <span>{wt.backToList}</span>
        </button>
        <div className="workflow-detail-title">
          <h2>{workflow.name}</h2>
          <span className="workflow-detail-version">v{workflow.version}</span>
        </div>
        <button className="workflow-start-btn" onClick={handleStart}>
          <Play size={14} />
          {wt.start}
        </button>
      </div>

      {/* ── Flowchart (main area) ── */}
      <div className="wf-canvas-container">
        <ReactFlow
          key={`${workflow?.id}-${flowNodes.length}`}
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          onInit={(instance) => {
            // Delay fitView to ensure container has layout dimensions
            setTimeout(() => instance.fitView({ padding: 0.3 }), 100);
          }}
          minZoom={0.3}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{
            type: "smoothstep",
          }}
        >
          <Background color="var(--border-color)" gap={20} size={1} />
          <Controls
            showInteractive={false}
            style={{ bottom: panelCollapsed ? 46 : panelHeight + 10 }}
          />
          <MiniMap
            style={{
              background: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
            }}
            nodeColor={(n: any) => STATUS_COLORS[n.data?.status] || "#64748b"}
            maskColor="rgba(0,0,0,0.3)"
          />
        </ReactFlow>
      </div>

      {/* ── Bottom Panel (node detail + runs) ── */}
      <div
        className={`wf-bottom-panel ${panelCollapsed ? "" : "wf-panel-open"}`}
        style={panelCollapsed ? {} : { height: panelHeight }}
      >
        {/* Drag resize handle */}
        <div
          className={`wf-panel-drag-bar ${isDragging ? "wf-dragging" : ""}`}
          onMouseDown={handleDragStart}
          onDoubleClick={() => setPanelCollapsed(!panelCollapsed)}
        />
        <div
          className="wf-panel-toggle"
          onClick={() => setPanelCollapsed(!panelCollapsed)}
        >
          {panelCollapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          <span>
            {selectedNode
              ? `${selectedNode.label} — ${(wt.runStatus as any)?.[selectedNodeState?.status] || selectedNodeState?.status || "pending"}`
              : wt.runs}
          </span>
        </div>

        {!panelCollapsed && (
          <div className="wf-panel-content">
            {/* Runs list */}
            <div className="wf-panel-section">
              <h4>{wt.runs}</h4>
              {runs.length === 0 ? (
                <p className="workflow-empty-text">{wt.noRuns}</p>
              ) : (
                <div className="wf-runs-row">
                  {runs
                    .sort(
                      (a, b) => (b.startedAt || 0) - (a.startedAt || 0),
                    )
                    .map((run) => {
                      const isActive = selectedRun?.id === run.id;
                      const sc =
                        STATUS_COLORS[run.status] || STATUS_COLORS.pending;
                      return (
                        <div
                          key={run.id}
                          className={`wf-run-chip ${isActive ? "active" : ""}`}
                          style={{ borderColor: isActive ? sc : undefined }}
                          onClick={async () => {
                            const d = await api.workflow.getRun(run.id);
                            setSelectedRun(d);
                          }}
                        >
                          <div
                            className="wf-status-dot"
                            style={{ background: sc }}
                          />
                          <span>{run.id.substring(0, 8)}</span>
                          <span className="wf-run-time">
                            {formatTime(run.startedAt)}
                          </span>
                          {run.status === "running" && (
                            <button
                              className="wf-run-action-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                handlePause(run.id);
                              }}
                            >
                              <Pause size={12} />
                            </button>
                          )}
                          {run.status === "paused" && (
                            <button
                              className="wf-run-action-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleResume(run.id);
                              }}
                            >
                              <RotateCcw size={12} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}
            </div>

            {/* Node detail */}
            {selectedNode && (
              <div className="wf-panel-section wf-node-detail-panel">
                <h4>
                  {selectedNode.label} ({(wt.nodeTypes as any)?.[selectedNode.type] || selectedNode.type})
                </h4>

                {selectedNode.config?.agentPersona && (
                  <div className="wf-detail-field">
                    <strong>Agent Persona:</strong>
                    <pre>{selectedNode.config.agentPersona}</pre>
                  </div>
                )}

                {selectedNode.config?.prompt && (
                  <div className="wf-detail-field">
                    <strong>Prompt:</strong>
                    <pre>{selectedNode.config.prompt}</pre>
                  </div>
                )}

                {selectedNode.config?.tools && selectedNode.config.tools.length > 0 && (
                  <div className="wf-detail-field">
                    <strong>Tools:</strong>
                    <div className="wf-tag-list">
                      {selectedNode.config.tools.map((t: string) => (
                        <span key={t} className="wf-tag">{t}</span>
                      ))}
                    </div>
                  </div>
                )}

                {selectedNode.config?.suggestedTools && selectedNode.config.suggestedTools.length > 0 && (
                  <div className="wf-detail-field">
                    <strong>Suggested Tools:</strong>
                    <div className="wf-tag-list">
                      {selectedNode.config.suggestedTools.map((t: string) => (
                        <span key={t} className="wf-tag wf-tag-suggested">{t}</span>
                      ))}
                    </div>
                  </div>
                )}

                {selectedNode.config?.expression && (
                  <div className="wf-detail-field">
                    <strong>Expression:</strong>
                    <code>{selectedNode.config.expression}</code>
                  </div>
                )}

                {selectedNode.type === "loop" && (
                  <div className="wf-detail-field">
                    <strong>Loop Config:</strong>
                    <pre>{JSON.stringify({
                      maxIterations: selectedNode.config?.maxIterations,
                      intervalMs: selectedNode.config?.intervalMs,
                      exitCondition: selectedNode.config?.exitCondition,
                    }, null, 2)}</pre>
                  </div>
                )}

                {selectedNode.type === "gateway" && (
                  <div className="wf-detail-field">
                    <strong>Mode:</strong> <code>{selectedNode.config?.mode}</code>
                  </div>
                )}

                {selectedNodeState?.output && (
                  <div className="wf-detail-field">
                    <strong>{wt.output}:</strong>
                    <pre>
                      {typeof selectedNodeState.output === "string"
                        ? selectedNodeState.output.substring(0, 500)
                        : JSON.stringify(selectedNodeState.output, null, 2).substring(0, 500)}
                    </pre>
                  </div>
                )}

                {selectedNodeState?.logs && selectedNodeState.logs.length > 0 && (
                  <div className="wf-detail-field">
                    <strong>{wt.logs}:</strong>
                    <div className="wf-logs">
                      {selectedNodeState.logs.slice(-8).map((log: string, i: number) => (
                        <div key={i} className="wf-log-line">{log}</div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Inject message */}
                {selectedRun &&
                  ["running", "pending"].includes(
                    selectedNodeState?.status || "",
                  ) && (
                    <div className="wf-inject-row">
                      <input
                        type="text"
                        value={injectText}
                        onChange={(e) => setInjectText(e.target.value)}
                        placeholder={`${wt.inject} → ${selectedNode.label}`}
                        onKeyDown={(e) => e.key === "Enter" && handleInject()}
                      />
                      <button onClick={handleInject}>
                        <Send size={14} />
                      </button>
                    </div>
                  )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
