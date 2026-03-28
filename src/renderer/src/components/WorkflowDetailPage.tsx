/**
 * WorkflowDetailPage — DAG visualization with node detail panel and log strip.
 *
 * Layout per user wireframe:
 * ┌──────────────────────────────────────────┐
 * │ Header tabs: Chat | Workflow | Work Log  │
 * ├───────────────────┬──────────────────────┤
 * │                   │                      │
 * │  DAG Flow Graph   │  Node Detail Panel   │
 * │  (SVG nodes +     │  (logs, messages,    │
 * │   edges)          │   agent history)     │
 * │                   │                      │
 * ├───────────────────┴──────────────────────┤
 * │ Bottom Log Strip + Message Injection     │
 * └──────────────────────────────────────────┘
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { workflowService } from '../services/workflow-service';
import {
  Play, Pause, StopCircle, ArrowLeft, Send,
  RefreshCw, ChevronRight, ChevronDown, Keyboard,
} from 'lucide-react';
import type {
  WorkflowDefinition,
  WorkflowRun,
  WorkflowNode,
  WorkflowEvent,
  NodeRunStatus,
} from '../types/workflow';

interface WorkflowDetailPageProps {
  workflow: WorkflowDefinition;
  onBack: () => void;
  trans: any;
}

const NODE_W = 160;
const NODE_H = 50;

const statusLabels: Record<string, string> = {
  pending: '待运行',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  skipped: '已跳过',
  paused: '暂停',
  waiting_input: '等待输入',
};

const statusColors: Record<string, string> = {
  pending: '#607d8b',
  running: '#2196f3',
  completed: '#4caf50',
  failed: '#f44336',
  skipped: '#9e9e9e',
  paused: '#ff9800',
  waiting_input: '#9c27b0',
};

export const WorkflowDetailPage: React.FC<WorkflowDetailPageProps> = ({
  workflow,
  onBack,
  trans,
}) => {
  const [currentRun, setCurrentRun] = useState<WorkflowRun | null>(null);
  const [selectedNode, setSelectedNode] = useState<WorkflowNode | null>(null);
  const [nodeLogs, setNodeLogs] = useState<string[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [injectMessage, setInjectMessage] = useState('');
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [startError, setStartError] = useState<string | null>(null);
  const [waitingInput, setWaitingInput] = useState<{ nodeId: string; prompt: string } | null>(null);
  const [userInputValue, setUserInputValue] = useState('');
  const logEndRef = useRef<HTMLDivElement>(null);
  const currentRunRef = useRef<WorkflowRun | null>(null);
  const selectedNodeRef = useRef<WorkflowNode | null>(null);

  // ─── Infinite Canvas (Pan & Zoom) ───────────────────
  const [pan, setPan] = useState({ x: 20, y: 20 });
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0 });
  const dagPanelRef = useRef<HTMLDivElement>(null);

  // ─── Draggable Nodes ────────────────────────────────
  const [nodePositions, setNodePositions] = useState<Record<string, { x: number; y: number }>>({});
  const [draggingNode, setDraggingNode] = useState<string | null>(null);
  const dragStart = useRef({ x: 0, y: 0, nodeX: 0, nodeY: 0 });
  const hasDragged = useRef(false);

  // ─── Resizable Bottom Panel ─────────────────────────
  const [bottomHeight, setBottomHeight] = useState(140);
  const [isResizingBottom, setIsResizingBottom] = useState(false);
  const resizeStartY = useRef(0);
  const resizeStartH = useRef(0);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.08 : 0.08;
    setZoom(z => Math.max(0.2, Math.min(3, z + delta)));
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    // Only start panning if clicking on the canvas background (svg), not on nodes
    const target = e.target as HTMLElement;
    if (target.closest('.workflow-dag-node')) return;
    setIsPanning(true);
    panStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [pan]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (draggingNode) {
      // Node dragging
      const dx = (e.clientX - dragStart.current.x) / zoom;
      const dy = (e.clientY - dragStart.current.y) / zoom;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasDragged.current = true;
      setNodePositions(prev => ({
        ...prev,
        [draggingNode]: {
          x: dragStart.current.nodeX + dx,
          y: dragStart.current.nodeY + dy,
        },
      }));
      return;
    }
    if (!isPanning) return;
    setPan({ x: e.clientX - panStart.current.x, y: e.clientY - panStart.current.y });
  }, [isPanning, draggingNode, zoom]);

  const handlePointerUp = useCallback(() => {
    setIsPanning(false);
    setDraggingNode(null);
  }, []);

  // Node drag start — called from node onPointerDown
  const handleNodeDragStart = useCallback((e: React.PointerEvent, node: WorkflowNode) => {
    e.stopPropagation();
    const pos = nodePositions[node.id] || node.position || { x: 0, y: 0 };
    setDraggingNode(node.id);
    hasDragged.current = false;
    dragStart.current = { x: e.clientX, y: e.clientY, nodeX: pos.x, nodeY: pos.y };
  }, [nodePositions]);

  // Bottom panel resize handlers
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingBottom(true);
    resizeStartY.current = e.clientY;
    resizeStartH.current = bottomHeight;
  }, [bottomHeight]);

  useEffect(() => {
    if (!isResizingBottom) return;
    const onMove = (e: MouseEvent) => {
      const delta = resizeStartY.current - e.clientY;
      setBottomHeight(Math.max(60, Math.min(500, resizeStartH.current + delta)));
    };
    const onUp = () => setIsResizingBottom(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isResizingBottom]);

  // Helper: get node position (overridden or original)
  const getNodePos = useCallback((node: WorkflowNode) => {
    return nodePositions[node.id] || node.position || { x: 0, y: 0 };
  }, [nodePositions]);

  // Compute run progress
  const getRunProgress = () => {
    if (!currentRun) return null;
    const nodeIds = workflow.nodes.map(n => n.id);
    const total = nodeIds.length;
    const completed = nodeIds.filter(id => {
      const s = currentRun.nodeStates[id]?.status;
      return s === 'completed' || s === 'skipped';
    }).length;
    const failed = nodeIds.filter(id => currentRun.nodeStates[id]?.status === 'failed').length;
    const running = nodeIds.filter(id => currentRun.nodeStates[id]?.status === 'running').length;
    return { total, completed, failed, running, pct: Math.round((completed / total) * 100) };
  };

  // Keep refs in sync with state to avoid stale closures in event handler
  useEffect(() => { currentRunRef.current = currentRun; }, [currentRun]);
  useEffect(() => { selectedNodeRef.current = selectedNode; }, [selectedNode]);

  useEffect(() => {
    loadRuns();
    const unsubscribe = workflowService.onEvent(handleEvent);
    return () => unsubscribe();
  }, [workflow.id]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const loadRuns = async () => {
    const r = await workflowService.getRuns(workflow.id);
    setRuns(r);
    if (r.length > 0) {
      setCurrentRun(r[0]); // Latest run
    }
  };

  const handleEvent = useCallback((event: WorkflowEvent) => {
    const run = currentRunRef.current;
    const selNode = selectedNodeRef.current;

    // Accept events for any run of this workflow
    const ts = new Date(event.timestamp).toLocaleTimeString();
    const msg = `[${ts}] ${event.type}${event.nodeId ? ` (${event.nodeId})` : ''}: ${JSON.stringify(event.data || '')}`;
    setLogs(prev => [...prev, msg]);

    if (event.type === 'node:log' && event.nodeId === selNode?.id) {
      setNodeLogs(prev => [...prev, event.data?.log || '']);
    }

    // Handle waiting_input: auto-select the waiting node and show prompt
    if (event.type === 'node:waiting_input' && event.nodeId) {
      const waitNode = workflow.nodes.find(n => n.id === event.nodeId);
      if (waitNode) {
        setSelectedNode(waitNode);
        setWaitingInput({ nodeId: event.nodeId, prompt: event.data?.prompt || 'Please provide input' });
        setUserInputValue('');
      }
    }

    // Clear waiting state when node resumes
    if (event.type === 'node:started' && event.nodeId === waitingInput?.nodeId) {
      setWaitingInput(null);
      setUserInputValue('');
    }

    // Refresh run state on important events
    if (['run:started', 'run:completed', 'run:failed', 'run:paused', 'node:started', 'node:completed', 'node:failed', 'node:waiting_input'].includes(event.type)) {
      loadRuns();
    }
  }, [waitingInput]);

  const handleStart = async () => {
    setStartError(null);
    try {
      const run = await workflowService.startRun(workflow.id);
      setCurrentRun(run);
      setLogs([`[${new Date().toLocaleTimeString()}] Workflow started: ${run.id}`]);
    } catch (e: any) {
      console.error('Failed to start workflow:', e);
      setStartError(e.message || 'Failed to start workflow');
      setLogs(prev => [...prev, `[ERROR] ${e.message || 'Failed to start workflow'}`]);
    }
  };

  const handlePause = async () => {
    if (!currentRun) return;
    await workflowService.pauseRun(currentRun.id);
  };

  const handleResume = async () => {
    if (!currentRun) return;
    await workflowService.resumeRun(currentRun.id);
  };

  const handleCancel = async () => {
    if (!currentRun) return;
    await workflowService.cancelRun(currentRun.id);
  };

  const handleSelectNode = async (node: WorkflowNode) => {
    setSelectedNode(node);
    if (currentRun) {
      const l = await workflowService.getNodeLogs(currentRun.id, node.id);
      setNodeLogs(l);
    } else {
      setNodeLogs([]);
    }
  };

  const handleInject = async () => {
    if (!currentRun || !selectedNode || !injectMessage.trim()) return;
    await workflowService.injectMessage(currentRun.id, selectedNode.id, injectMessage.trim(), 'user');
    setInjectMessage('');
    setNodeLogs(prev => [...prev, `[injected] ${injectMessage.trim()}`]);
  };

  const handleSubmitInput = async () => {
    if (!currentRun || !waitingInput || !userInputValue.trim()) return;
    await workflowService.submitInput(currentRun.id, waitingInput.nodeId, userInputValue.trim());
    setNodeLogs(prev => [...prev, `[user input] ${userInputValue.trim()}`]);
    setWaitingInput(null);
    setUserInputValue('');
  };

  const getNodeStatus = (nodeId: string): NodeRunStatus => {
    if (!currentRun) return 'pending';
    const ns = currentRun.nodeStates[nodeId];
    return ns?.status || 'pending';
  };

  // ─── Render ───────────────────────────────────────────

  return (
    <div className="workflow-detail-page">
      {/* Toolbar */}
      <div className="workflow-toolbar">
        <button onClick={onBack} className="icon-btn" title="Back">
          <ArrowLeft size={16} />
        </button>
        <span className="workflow-detail-title">{workflow.name}</span>
        <span className="workflow-detail-status" style={{ color: statusColors[workflow.status] || '#9e9e9e' }}>
          {workflow.status}
        </span>
        {/* Run progress indicator */}
        {currentRun && currentRun.status === 'running' && (() => {
          const prog = getRunProgress();
          return prog ? (
            <div className="run-progress-bar">
              <div className="run-progress-fill" style={{ width: `${prog.pct}%` }} />
              <span className="run-progress-text">{prog.completed}/{prog.total} nodes</span>
            </div>
          ) : null;
        })()}
        {currentRun && currentRun.status !== 'running' && currentRun.status !== 'pending' && (
          <span className="run-status-badge" data-status={currentRun.status}>
            {currentRun.status}
          </span>
        )}
        <div className="workflow-toolbar-actions">
          {(!currentRun || currentRun.status === 'completed' || currentRun.status === 'failed' || currentRun.status === 'cancelled') && (
            <button onClick={handleStart} className="btn btn-primary btn-sm">
              <Play size={12} /> Start
            </button>
          )}
          {currentRun?.status === 'running' && (
            <>
              <button onClick={handlePause} className="btn btn-warning btn-sm">
                <Pause size={12} /> Pause
              </button>
              <button onClick={handleCancel} className="btn btn-danger btn-sm">
                <StopCircle size={12} /> Cancel
              </button>
            </>
          )}
          {currentRun?.status === 'paused' && (
            <>
              <button onClick={handleResume} className="btn btn-primary btn-sm">
                <Play size={12} /> Resume
              </button>
              <button onClick={handleCancel} className="btn btn-danger btn-sm">
                <StopCircle size={12} /> Cancel
              </button>
            </>
          )}
          <button onClick={loadRuns} className="icon-btn" title="Refresh">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Main Content: DAG + Node Detail */}
      <div className="workflow-main-content">
        {/* Left: DAG Flow — Infinite Canvas */}
        <div
          className={`workflow-dag-panel ${isPanning ? 'is-panning' : ''}`}
          ref={dagPanelRef}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <svg
            className="workflow-dag-svg"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: '0 0',
              width: Math.max(800, ...workflow.nodes.map((n: WorkflowNode) => (getNodePos(n).x) + NODE_W + 60)),
              height: Math.max(400, ...workflow.nodes.map((n: WorkflowNode) => (getNodePos(n).y) + NODE_H + 80)),
            }}
          >
            <defs>
              <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5"
                markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--text-secondary)" />
              </marker>
            </defs>

            {/* Edges */}
            {workflow.edges.map((edge: { id: string; source: string; target: string; conditionLabel?: string }) => {
              const source = workflow.nodes.find((n: WorkflowNode) => n.id === edge.source);
              const target = workflow.nodes.find((n: WorkflowNode) => n.id === edge.target);
              if (!source || !target) return null;

              const srcPos = getNodePos(source);
              const tgtPos = getNodePos(target);
              const x1 = srcPos.x + NODE_W;
              const y1 = srcPos.y + NODE_H / 2;
              const x2 = tgtPos.x;
              const y2 = tgtPos.y + NODE_H / 2;

              // Color edge based on BOTH source and target status
              // For condition branches, skipped targets should show dim edges
              const srcStatus = getNodeStatus(source.id);
              const tgtStatus = getNodeStatus(target.id);
              const edgeColor = tgtStatus === 'skipped' ? 'var(--text-muted)'
                : srcStatus === 'completed' ? statusColors.completed
                : srcStatus === 'running' ? statusColors.running
                : 'var(--border-color)';
              const edgeOpacity = tgtStatus === 'skipped' ? 0.25
                : srcStatus === 'completed' ? 1 : 0.5;

              return (
                <g key={edge.id}>
                  <path
                    d={`M ${x1} ${y1} C ${x1 + 40} ${y1}, ${x2 - 40} ${y2}, ${x2} ${y2}`}
                    stroke={edgeColor}
                    strokeWidth="2"
                    fill="none"
                    markerEnd="url(#arrow)"
                    opacity={edgeOpacity}
                  />
                  {edge.conditionLabel && (
                    <text
                      x={(x1 + x2) / 2}
                      y={(y1 + y2) / 2 - 8}
                      fill="var(--text-muted)"
                      fontSize="11"
                      textAnchor="middle"
                    >
                      {edge.conditionLabel}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Nodes */}
            {workflow.nodes.map((node: WorkflowNode) => {
              const status = getNodeStatus(node.id);
              const isSelected = selectedNode?.id === node.id;
              const borderColor = isSelected ? 'var(--accent-color)' : (statusColors[status] || '#607d8b');
              const isRunning = status === 'running';
              const isWaiting = status === 'waiting_input';
              const pos = getNodePos(node);

              return (
                <g
                  key={node.id}
                  className={`workflow-dag-node ${isRunning ? 'node-running' : ''} ${isWaiting ? 'node-waiting' : ''}`}
                  onClick={() => { if (!hasDragged.current) handleSelectNode(node); }}
                  onPointerDown={(e) => handleNodeDragStart(e, node)}
                  style={{ cursor: draggingNode === node.id ? 'grabbing' : 'grab' }}
                >
                  {/* Glow ring for running nodes */}
                  {isRunning && (
                    <rect
                      x={pos.x - 3}
                      y={pos.y - 3}
                      width={NODE_W + 6}
                      height={NODE_H + 6}
                      rx="10"
                      ry="10"
                      fill="none"
                      stroke={statusColors.running}
                      strokeWidth="2"
                      className="node-pulse-ring"
                    />
                  )}
                  {/* Glow ring for waiting_input nodes — distinct purple pulse */}
                  {isWaiting && (
                    <rect
                      x={pos.x - 4}
                      y={pos.y - 4}
                      width={NODE_W + 8}
                      height={NODE_H + 8}
                      rx="11"
                      ry="11"
                      fill="none"
                      stroke={statusColors.waiting_input}
                      strokeWidth="3"
                      className="node-waiting-ring"
                    />
                  )}
                  <rect
                    x={pos.x}
                    y={pos.y}
                    width={NODE_W}
                    height={NODE_H}
                    rx="8"
                    ry="8"
                    fill={isWaiting ? 'rgba(156, 39, 176, 0.1)' : 'var(--bg-secondary)'}
                    stroke={borderColor}
                    strokeWidth={isSelected ? 3 : 2}
                  />
                  {/* Status indicator circle */}
                  <circle
                    cx={pos.x + 14}
                    cy={pos.y + NODE_H / 2 - 4}
                    r="5"
                    fill={statusColors[status] || '#607d8b'}
                    className={isRunning ? 'node-status-pulse' : isWaiting ? 'node-status-pulse' : ''}
                  />
                  {/* Status label under circle */}
                  <text
                    x={pos.x + 14}
                    y={pos.y + NODE_H / 2 + 10}
                    fill={statusColors[status] || '#607d8b'}
                    fontSize="8"
                    textAnchor="middle"
                    fontWeight="600"
                  >
                    {statusLabels[status] || status}
                  </text>
                  {/* Label */}
                  <text
                    x={pos.x + 30}
                    y={pos.y + NODE_H / 2 + 1}
                    fill="var(--text-primary)"
                    fontSize="12"
                    fontWeight="500"
                  >
                    {node.label.slice(0, 16)}
                  </text>
                  {/* Type badge or waiting icon */}
                  {isWaiting ? (
                    <text
                      x={pos.x + NODE_W - 12}
                      y={pos.y + 16}
                      fontSize="14"
                      textAnchor="end"
                      className="node-waiting-icon"
                    >
                      ⌨️
                    </text>
                  ) : (
                    <text
                      x={pos.x + NODE_W - 8}
                      y={pos.y + 14}
                      fill="var(--text-muted)"
                      fontSize="9"
                      textAnchor="end"
                    >
                      {node.type}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          {/* Zoom indicator */}
          <div className="canvas-zoom-indicator">{Math.round(zoom * 100)}%</div>
        </div>

        {/* Right: Node Detail Panel */}
        <div className="workflow-node-detail">
          {selectedNode ? (
            <>
              <div className="node-detail-header">
                <h3>{selectedNode.label}</h3>
                <span className="node-type-badge">{selectedNode.type}</span>
              </div>
              {selectedNode.description && (
                <p className="node-detail-desc">{selectedNode.description}</p>
              )}
              {selectedNode.agentConfig && (
                <div className="node-detail-section">
                  <h4>Agent Config</h4>
                  <div className="node-detail-kv">
                    <span>Name:</span> <span>{selectedNode.agentConfig.name}</span>
                  </div>
                  <div className="node-detail-kv">
                    <span>Tools:</span> <span>{selectedNode.agentConfig.tools.join(', ') || 'none'}</span>
                  </div>
                  <div className="node-detail-persona">
                    <span>Persona:</span>
                    <pre>{selectedNode.agentConfig.persona}</pre>
                  </div>
                </div>
              )}
              <div className="node-detail-section">
                <h4>Logs ({nodeLogs.length})</h4>
                <div className="node-detail-logs">
                  {nodeLogs.length === 0 ? (
                    <span className="text-muted">No logs yet</span>
                  ) : (
                    nodeLogs.map((log, i) => (
                      <div key={i} className="node-log-item">{log}</div>
                    ))
                  )}
                </div>
              </div>
              {/* Inline input form when node is waiting for user input */}
              {waitingInput && selectedNode && waitingInput.nodeId === selectedNode.id && (
                <div className="node-input-prompt">
                  <div className="node-input-prompt-header">
                    <Keyboard size={16} />
                    <span>Agent is waiting for your input</span>
                  </div>
                  <p className="node-input-prompt-text">{waitingInput.prompt}</p>
                  <div className="node-input-prompt-form">
                    <input
                      type="text"
                      value={userInputValue}
                      onChange={e => setUserInputValue(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleSubmitInput()}
                      placeholder="Type your response..."
                      className="node-input-field"
                      autoFocus
                    />
                    <button
                      onClick={handleSubmitInput}
                      disabled={!userInputValue.trim()}
                      className="btn btn-primary btn-sm"
                    >
                      <Send size={12} /> Submit
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="node-detail-empty">
              <p>Select a node to view details</p>
            </div>
          )}
        </div>
      </div>

      {/* Bottom: Resizable Log Strip + Message Injection */}
      <div className="workflow-resize-handle" onMouseDown={handleResizeStart} />
      <div className="workflow-bottom-strip" style={{ height: bottomHeight }}>
        <div className="workflow-log-strip">
          {logs.length === 0 ? (
            <span className="text-muted">Logs will appear here when the workflow runs...</span>
          ) : (
            logs.slice(-50).map((log, i) => (
              <div key={i} className="log-strip-item">{log}</div>
            ))
          )}
          <div ref={logEndRef} />
        </div>
        <div className="workflow-inject-bar">
          <input
            type="text"
            value={injectMessage}
            onChange={e => setInjectMessage(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleInject()}
            placeholder={selectedNode ? `Inject message to ${selectedNode.label}...` : 'Select a node first'}
            disabled={!selectedNode || !currentRun}
            className="workflow-inject-input"
          />
          <button
            onClick={handleInject}
            disabled={!selectedNode || !currentRun || !injectMessage.trim()}
            className="btn btn-primary btn-sm"
          >
            <Send size={12} />
          </button>
        </div>
      </div>
    </div>
  );
};
