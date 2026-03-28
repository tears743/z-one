/**
 * WorkflowListPage — Shows all workflows with status, run count, and controls.
 */

import React, { useState, useEffect } from 'react';
import { workflowService } from '../services/workflow-service';
import { Play, Trash2, Plus, FileText, RefreshCw } from 'lucide-react';
import type { WorkflowDefinition, WorkflowRun } from '../types/workflow';

interface WorkflowListPageProps {
  onSelectWorkflow: (workflow: WorkflowDefinition) => void;
  trans: any;
}

export const WorkflowListPage: React.FC<WorkflowListPageProps> = ({
  onSelectWorkflow,
  trans,
}) => {
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    loadWorkflows();
  }, []);

  const loadWorkflows = async () => {
    setLoading(true);
    try {
      const list = await workflowService.listWorkflows();
      setWorkflows(list);
    } catch (e) {
      console.error('Failed to load workflows:', e);
    }
    setLoading(false);
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const w = await workflowService.createWorkflow(newName.trim());
      setWorkflows(prev => [w, ...prev]);
      setNewName('');
      onSelectWorkflow(w);
    } catch (e) {
      console.error('Failed to create workflow:', e);
    }
    setCreating(false);
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const wf = workflows.find(w => w.id === id);
    if (!confirm(`确定要删除工作流「${wf?.name || id}」吗？此操作不可撤销。`)) return;
    try {
      await workflowService.deleteWorkflow(id);
      setWorkflows(prev => prev.filter(w => w.id !== id));
    } catch (e) {
      console.error('Failed to delete workflow:', e);
    }
  };

  const statusColors: Record<string, string> = {
    draft: '#9e9e9e',
    active: '#4caf50',
    paused: '#ff9800',
    completed: '#2196f3',
    failed: '#f44336',
    archived: '#607d8b',
  };

  return (
    <div className="workflow-list-page">
      {/* Create Bar */}
      <div className="workflow-create-bar">
        <input
          type="text"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleCreate()}
          placeholder="Describe your workflow..."
          className="workflow-create-input"
        />
        <button
          onClick={handleCreate}
          disabled={creating || !newName.trim()}
          className="btn btn-primary workflow-create-btn"
        >
          {creating ? <RefreshCw size={14} className="spin" /> : <Plus size={14} />}
          <span>{creating ? 'Creating...' : 'Create'}</span>
        </button>
      </div>

      {/* Workflow Cards */}
      {loading ? (
        <div className="workflow-loading">Loading workflows...</div>
      ) : workflows.length === 0 ? (
        <div className="workflow-empty">
          <FileText size={48} />
          <p>No workflows yet</p>
          <p className="text-muted">Describe a task to create your first workflow</p>
        </div>
      ) : (
        <div className="workflow-grid">
          {workflows.map(w => (
            <div
              key={w.id}
              className="workflow-card"
              onClick={() => onSelectWorkflow(w)}
            >
              <div className="workflow-card-header">
                <span
                  className="workflow-status-dot"
                  style={{ backgroundColor: statusColors[w.status] || '#9e9e9e' }}
                />
                <span className="workflow-card-title">{w.name}</span>
              </div>
              {w.description && (
                <div className="workflow-card-desc">{w.description}</div>
              )}
              <div className="workflow-card-meta">
                <span>{w.nodes.length} nodes</span>
                <span>v{w.version}</span>
                <span>{new Date(w.updatedAt).toLocaleDateString()}</span>
              </div>
              <div className="workflow-card-actions">
                <button
                  className="icon-btn"
                  onClick={e => handleDelete(e, w.id)}
                  title="Delete"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
