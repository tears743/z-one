
import React from "react";
import { Plus, Trash2 } from "lucide-react";

interface SidebarProps {
  isOpen: boolean;
  sessions: any[];
  currentSessionId: string;
  trans: any;
  onNewChat: () => void;
  onLoadSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  formatTime: (ts: number) => string;
  isCreating?: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  sessions,
  currentSessionId,
  trans,
  onNewChat,
  onLoadSession,
  onDeleteSession,
  formatTime,
  isCreating,
}) => {
  return (
    <div
      className="sidebar"
      style={{
        width: isOpen ? "250px" : "0px",
      }}
    >
      <div className="sidebar-header">
        <button onClick={onNewChat} className="new-chat-btn" disabled={isCreating}>
          {isCreating ? (
            <div className="spinner-small" style={{ marginRight: '8px' }} />
          ) : (
            <Plus size={16} />
          )}
          {isCreating ? "Creating..." : trans.newChat}
        </button>
      </div>
      <div className="session-list">
        {sessions.map((s) => (
          <div
            key={s.id}
            onClick={() => onLoadSession(s.id)}
            className={`session-item ${s.id === currentSessionId ? "active" : ""}`}
          >
            <div className="session-item-content">
              <div className="session-title">{s.title}</div>
              <div className="session-time">{formatTime(s.timestamp)}</div>
            </div>
            <button
              className="session-delete-btn"
              title="Delete"
              onClick={(e) => {
                e.stopPropagation();
                onDeleteSession(s.id);
              }}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
