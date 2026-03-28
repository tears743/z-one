import React, { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import remarkGfm from "remark-gfm";
import { LogMessage } from "../types/message";
import { SwarmBoard } from "./SwarmBoard";
import { GitBranch, Check, X, RefreshCw } from "lucide-react";

interface MessageListProps {
  messages: LogMessage[];
  messagesEndRef: React.RefObject<HTMLDivElement>;
  onWorkflowConfirm?: (proposal: any) => Promise<void> | void;
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  messagesEndRef,
  onWorkflowConfirm,
}) => {
  const [expandedThoughts, setExpandedThoughts] = useState<
    Record<string, boolean>
  >({});
  const [confirmedWorkflows, setConfirmedWorkflows] = useState<Set<string>>(() => {
    try {
      const saved = sessionStorage.getItem('confirmedWorkflows');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });
  const [dismissedWorkflows, setDismissedWorkflows] = useState<Set<string>>(() => {
    try {
      const saved = sessionStorage.getItem('dismissedWorkflows');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });
  const [confirmingWorkflow, setConfirmingWorkflow] = useState<string | null>(null);

  const chatAreaRef = useRef<HTMLDivElement>(null);
  const wasAtBottomRef = useRef(true);

  // Track if user is at the bottom
  const handleScroll = () => {
    const chatArea = chatAreaRef.current;
    if (chatArea) {
      const { scrollHeight, scrollTop, clientHeight } = chatArea;
      // Check if we are close to the bottom (within 50px)
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
      wasAtBottomRef.current = isAtBottom;
    }
  };

  // Auto-scroll logic
  useEffect(() => {
    // Scroll on mount
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView();
    }
  }, []); // Run once on mount

  useEffect(() => {
    // Only scroll if we were already near the bottom before the update
    if (wasAtBottomRef.current && messagesEndRef.current) {
      // Use "auto" behavior to avoid fighting with user scroll during rapid updates
      messagesEndRef.current.scrollIntoView({ behavior: "auto" });
    }
  }, [messages]);

  const toggleThought = (messageId: string) => {
    setExpandedThoughts((prev) => ({
      ...prev,
      [messageId]: !prev[messageId],
    }));
  };

  // Extract workflow proposal from message content or details
  const extractWorkflowProposal = (msg: LogMessage): any | null => {
    // Check details for workflow proposal
    if (msg.details?.workflowProposal) {
      return msg.details.workflowProposal;
    }
    // Try to find workflow_proposal JSON in content
    const content = typeof msg.content === 'string' ? msg.content : '';
    const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (parsed.type === 'workflow_proposal') return parsed;
      } catch { /* not JSON */ }
    }
    // Check for inline JSON with workflow_proposal type
    try {
      if (content.includes('"type"') && content.includes('workflow_proposal')) {
        // Find the JSON object
        const start = content.indexOf('{');
        const end = content.lastIndexOf('}');
        if (start >= 0 && end > start) {
          const parsed = JSON.parse(content.substring(start, end + 1));
          if (parsed.type === 'workflow_proposal') return parsed;
        }
      }
    } catch { /* not JSON */ }
    return null;
  };

  const handleConfirmWorkflow = async (proposal: any) => {
    const workflowId = proposal.workflow.id;
    if (confirmingWorkflow) return; // Prevent double-click
    setConfirmingWorkflow(workflowId);
    try {
      // Persist to sessionStorage BEFORE calling onWorkflowConfirm,
      // because confirm triggers view switch which unmounts this component
      const updated = new Set(confirmedWorkflows).add(workflowId);
      sessionStorage.setItem('confirmedWorkflows', JSON.stringify([...updated]));
      setConfirmedWorkflows(updated);
      await onWorkflowConfirm?.(proposal);
    } catch (e) {
      // Rollback on failure
      const rollback = new Set(confirmedWorkflows);
      rollback.delete(workflowId);
      sessionStorage.setItem('confirmedWorkflows', JSON.stringify([...rollback]));
      setConfirmedWorkflows(rollback);
      console.error('Failed to confirm workflow:', e);
    } finally {
      setConfirmingWorkflow(null);
    }
  };

  const handleDismissWorkflow = (workflowId: string) => {
    setDismissedWorkflows(prev => {
      const next = new Set(prev).add(workflowId);
      sessionStorage.setItem('dismissedWorkflows', JSON.stringify([...next]));
      return next;
    });
  };

  const renderWorkflowProposalCard = (proposal: any, msgId: string) => {
    const wf = proposal.workflow;
    const isConfirmed = confirmedWorkflows.has(wf.id);
    const isDismissed = dismissedWorkflows.has(wf.id);
    return (
      <div className="workflow-proposal-card" key={`wf-${msgId}`}>
        <div className="proposal-header">
          <GitBranch size={18} />
          <span className="proposal-title">{wf.name}</span>
          <span className="proposal-badge">{wf.nodeCount} nodes</span>
        </div>
        {wf.description && (
          <p className="proposal-desc">{wf.description}</p>
        )}
        <div className="proposal-nodes">
          {(wf.nodes || []).map((node: any, i: number) => (
            <div key={node.id} className="proposal-node-item">
              <span className="proposal-node-type" data-type={node.type}>
                {node.type}
              </span>
              <span className="proposal-node-label">{node.label}</span>
              {node.tools && node.tools.length > 0 && (
                <span className="proposal-node-tools">
                  {node.tools.slice(0, 3).join(', ')}
                  {node.tools.length > 3 && ` +${node.tools.length - 3}`}
                </span>
              )}
            </div>
          ))}
        </div>
        {isConfirmed ? (
          <div className="proposal-confirmed">
            <Check size={14} /> 工作流已创建，可在 Workflow 页面查看
          </div>
        ) : isDismissed ? (
          <div className="proposal-confirmed" style={{ opacity: 0.6 }}>
            <X size={14} /> 已忽略
          </div>
        ) : (
          <div className="proposal-actions">
            <button
              className="btn btn-primary btn-sm proposal-confirm-btn"
              onClick={() => handleConfirmWorkflow(proposal)}
              disabled={confirmingWorkflow === wf.id}
            >
              {confirmingWorkflow === wf.id ? (
                <><RefreshCw size={14} className="spin" /> 创建中...</>
              ) : (
                <><Check size={14} /> 确认创建</>
              )}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => handleDismissWorkflow(wf.id)}
              disabled={!!confirmingWorkflow}
            >
              <X size={14} /> 暂不需要
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderMessageContent = (msg: LogMessage) => {
    // Check if details contains image
    if (
      msg.details &&
      msg.details.content &&
      Array.isArray(msg.details.content)
    ) {
      const imageContents = msg.details.content.filter(
        (c: any) => c.type === "image",
      );

      if (imageContents.length > 0) {
        return (
          <div>
            {/* Reuse text rendering logic for mixed content */}
            {renderMessageContent({
              ...msg,
              details: undefined,
              content: msg.content,
            })}

            <div
              style={{
                marginTop: "10px",
                display: "flex",
                flexWrap: "wrap",
                gap: "10px",
              }}
            >
              {imageContents.map((img: any, idx: number) => (
                <img
                  key={idx}
                  src={`data:${img.mimeType};base64,${img.data}`}
                  alt="Screenshot"
                  style={{
                    maxWidth: "100%",
                    maxHeight: "300px",
                    borderRadius: "4px",
                    border: "1px solid #444",
                  }}
                />
              ))}
            </div>
            {/* Show other text content if any */}
            {msg.details.content
              .filter((c: any) => c.type !== "image")
              .map((c: any, i: number) => (
                <div key={i} style={{ marginTop: "5px" }}>
                  {c.text}
                </div>
              ))}
          </div>
        );
      }
    }

    // Normalize content to string (it may be an array or object from some APIs)
    const rawContent =
      typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content
              .map((c: any) => (typeof c === "string" ? c : c.text || ""))
              .join("\n")
          : String(msg.content ?? "");

    // Split content by thinking blocks
    const lines = rawContent.split("\n");
    const thoughtLines: string[] = [];
    const contentLines: string[] = [];

    lines.forEach((line) => {
      const trimmed = line.trim();
      // Check for *Status* format (e.g., *Thinking...*, *Executing: tool*)
      // Use a stricter regex to avoid matching Markdown italics like *text*
      // Heuristic: Status updates usually don't have spaces around the * inside,
      // or we can just check if it's a known status pattern or simply assume single lines wrapped in * are status if they are short?
      // Better: Check if it matches our status update format from Planner/Agent.
      // Planner uses: `*${status}*`

      const isStatusLine =
        /^\*[A-Z][^]*\*$/.test(trimmed) && trimmed.length < 100;

      if (isStatusLine) {
        thoughtLines.push(trimmed.slice(1, -1)); // Remove asterisks
      } else {
        contentLines.push(line);
      }
    });

    const finalContent = contentLines.join("\n").trim();

    // Merge thoughts from details (persisted) and current content (streaming)
    const persistedThoughts = msg.details?.thoughts || [];
    const allThoughts = Array.from(
      new Set([...persistedThoughts, ...thoughtLines]),
    );

    const hasThoughts = allThoughts.length > 0;
    const isExpanded = expandedThoughts[msg.id] || false;
    const swarmState = msg.details?.swarmState;

    // Orchestrator Mode: If swarmState exists, this is the Team Lead's planning phase.
    const isOrchestratorPlan = !!swarmState;
    const sectionTitle = isOrchestratorPlan
      ? "Mission Strategy"
      : "Thinking Process";
    const sectionIcon = isOrchestratorPlan ? "🧠" : "🤔";

    // Prepare displayable details (exclude rendered or internal keys)
    const displayableDetails: any = { ...msg.details };
    if (displayableDetails) {
      delete displayableDetails.thoughts;
      delete displayableDetails.isStreaming;
      delete displayableDetails.swarmState;
      delete displayableDetails.content; // Images
    }

    // Check if we should render the details block
    const shouldRenderDetails =
      displayableDetails &&
      !msg.details?.isStreaming &&
      Object.keys(displayableDetails).length > 0;

    return (
      <>
        {hasThoughts && (
          <div
            style={{
              marginBottom: "10px",
              border: "1px solid var(--border-color)",
              borderRadius: "6px",
              backgroundColor: "var(--bg-secondary)",
              overflow: "hidden",
            }}
          >
            <div
              onClick={() => toggleThought(msg.id)}
              style={{
                padding: "8px 12px",
                cursor: "pointer",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                backgroundColor: "var(--bg-tertiary)",
                fontSize: "0.85rem",
                color: "var(--text-secondary)",
                userSelect: "none",
              }}
            >
              <div
                style={{ display: "flex", alignItems: "center", gap: "8px" }}
              >
                <span style={{ fontSize: "1rem" }}>{sectionIcon}</span>
                <span style={{ fontWeight: 500 }}>{sectionTitle}</span>
                <span
                  style={{
                    fontSize: "0.75rem",
                    backgroundColor: "var(--bg-input)",
                    padding: "1px 6px",
                    borderRadius: "10px",
                    color: "var(--text-muted)",
                  }}
                >
                  {isOrchestratorPlan
                    ? "Team Lead"
                    : `${allThoughts.length} steps`}
                </span>
              </div>
              <span style={{ fontSize: "0.8rem", opacity: 0.7 }}>
                {isExpanded ? "Collapse" : "Expand"}
              </span>
            </div>

            {isExpanded && (
              <div
                style={{
                  padding: "16px",
                  backgroundColor: "var(--bg-input)",
                  color: "var(--text-primary)",
                  fontSize: "0.9rem",
                  lineHeight: "1.6",
                  borderTop: "1px solid var(--border-color)",
                }}
              >
                {isOrchestratorPlan ? (
                  // Orchestrator View: Single continuous block
                  <div className="markdown-body">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        code({
                          node,
                          inline,
                          className,
                          children,
                          ...props
                        }: any) {
                          const match = /language-(\w+)/.exec(className || "");
                          return !inline && match ? (
                            <SyntaxHighlighter
                              style={vscDarkPlus}
                              language={match[1]}
                              PreTag="div"
                              {...props}
                            >
                              {String(children).replace(/\n$/, "")}
                            </SyntaxHighlighter>
                          ) : (
                            <code className={className} {...props}>
                              {children}
                            </code>
                          );
                        },
                      }}
                    >
                      {allThoughts.join("\n\n")}
                    </ReactMarkdown>
                  </div>
                ) : (
                  // Standard Agent View: Horizontal Steps
                  <div
                    style={{
                      display: "flex",
                      gap: "12px",
                      overflowX: "auto",
                      paddingBottom: "12px",
                    }}
                  >
                    {allThoughts.map((thought: string, idx: number) => (
                      <div
                        key={idx}
                        style={{
                          minWidth: "200px",
                          maxWidth: "300px",
                          padding: "10px",
                          backgroundColor: "var(--bg-tertiary)",
                          borderRadius: "6px",
                          border: "1px solid var(--border-color)",
                          fontSize: "0.9rem",
                          color: "var(--text-primary)",
                          lineHeight: "1.4",
                          flexShrink: 0,
                          display: "flex",
                          flexDirection: "column",
                          gap: "6px",
                        }}
                      >
                        <div
                          style={{
                            fontSize: "0.75rem",
                            color: "var(--text-muted)",
                            fontWeight: 600,
                            textTransform: "uppercase",
                            letterSpacing: "0.5px",
                          }}
                        >
                          Step {idx + 1}
                        </div>
                        {thought}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {swarmState && <SwarmBoard swarmState={swarmState} />}

        <div className="markdown-body" style={{ lineHeight: "1.6" }}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code({ node, inline, className, children, ...props }: any) {
                const match = /language-(\w+)/.exec(className || "");
                return !inline && match ? (
                  <SyntaxHighlighter
                    style={vscDarkPlus}
                    language={match[1]}
                    PreTag="div"
                    {...props}
                  >
                    {String(children).replace(/\n$/, "")}
                  </SyntaxHighlighter>
                ) : (
                  <code className={className} {...props}>
                    {children}
                  </code>
                );
              },
            }}
          >
            {finalContent}
          </ReactMarkdown>
        </div>

        {/* Workflow Proposal Card */}
        {msg.role === 'assistant' && (() => {
          const proposal = extractWorkflowProposal(msg);
          if (proposal) return renderWorkflowProposalCard(proposal, msg.id);
          return null;
        })()}
      </>
    );
  };

  return (
    <div className="chat-area" ref={chatAreaRef} onScroll={handleScroll}>
      {messages.map((msg) => (
        <div key={msg.id} className={`message-container ${msg.role}`}>
          <div className="message-meta">
            {(msg.sender || msg.role).toUpperCase()} •{" "}
            {new Date(msg.timestamp).toLocaleTimeString()}
          </div>
          <div className="message-bubble">{renderMessageContent(msg)}</div>
        </div>
      ))}
      <div ref={messagesEndRef} />
    </div>
  );
};
