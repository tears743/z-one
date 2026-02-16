import React, { useState } from "react";
import { SwarmState, SwarmTaskState } from "../types/message";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

interface SwarmBoardProps {
  swarmState: SwarmState;
}

const AgentCard: React.FC<{ task: SwarmTaskState }> = ({ task }) => {
  const [isFlipped, setIsFlipped] = useState(false);

  return (
    <div
      style={{
        width: "220px",
        height: "280px",
        perspective: "1000px",
        cursor: "pointer",
        marginBottom: "10px",
        flexShrink: 0,
      }}
      onClick={() => setIsFlipped(!isFlipped)}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          textAlign: "center",
          transition: "transform 0.6s",
          transformStyle: "preserve-3d",
          transform: isFlipped ? "rotateY(180deg)" : "rotateY(0deg)",
        }}
      >
        {/* Front */}
        <div
          style={{
            position: "absolute",
            width: "calc(100% - 24px)",
            height: "100%",
            backfaceVisibility: "hidden",
            backgroundColor: "var(--bg-tertiary)",
            border: "1px solid var(--border-color)",
            borderRadius: "8px",
            padding: "12px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            alignItems: "center",
            boxShadow: "var(--shadow-md)",
            color: "var(--text-primary)",
            overflow: "hidden", // Prevent content from spilling over
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              width: "100%",
            }}
          >
            <div style={{ fontSize: "2rem", marginBottom: "10px" }}>🤖</div>
            <h3
              style={{
                margin: "0 0 5px 0",
                color: "var(--text-primary)",
                fontSize: "1rem",
                fontWeight: 600,
                width: "100%",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={task.assignedTo}
            >
              {task.assignedTo}
            </h3>
            <p
              style={{
                color: "var(--text-secondary)",
                fontSize: "0.8rem",
                lineHeight: "1.3",
                margin: 0,
                display: "-webkit-box",
                WebkitLineClamp: 3,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                textAlign: "center",
              }}
              title={task.description}
            >
              {task.description}
            </p>
          </div>

          {/* Tools Display */}
          <div
            style={{ width: "100%", marginTop: "auto", marginBottom: "8px" }}
          >
            <div
              style={{
                fontSize: "0.7rem",
                color: "var(--text-muted)",
                marginBottom: "4px",
                textAlign: "left",
              }}
            >
              Tools:
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "4px",
                justifyContent: "center",
              }}
            >
              {task.tools && task.tools.length > 0 ? (
                task.tools.slice(0, 3).map((tool, idx) => (
                  <span
                    key={idx}
                    style={{
                      fontSize: "0.65rem",
                      padding: "2px 6px",
                      backgroundColor: "var(--bg-secondary)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "4px",
                      color: "var(--text-secondary)",
                      maxWidth: "100%",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {tool}
                  </span>
                ))
              ) : (
                <span
                  style={{
                    fontSize: "0.7rem",
                    color: "var(--text-muted)",
                    fontStyle: "italic",
                  }}
                >
                  None
                </span>
              )}
              {task.tools && task.tools.length > 3 && (
                <span
                  style={{
                    fontSize: "0.75rem",
                    color: "var(--text-muted)",
                    padding: "2px 6px",
                    borderRadius: "4px",
                    backgroundColor: "var(--bg-hover)",
                    cursor: "help",
                  }}
                  title={task.tools.slice(3).join(", ")}
                >
                  +{task.tools.length - 3}
                </span>
              )}
            </div>
          </div>

          <div
            style={{
              padding: "4px 12px",
              borderRadius: "12px",
              fontSize: "0.75rem",
              fontWeight: "bold",
              textTransform: "uppercase",
              backgroundColor:
                task.status === "running"
                  ? "var(--accent-color)"
                  : task.status === "completed"
                    ? "#4caf50"
                    : task.status === "failed"
                      ? "#f44336"
                      : "var(--bg-button-secondary)",
              color: "#fff",
              marginTop: "4px",
            }}
          >
            {task.status}
          </div>
        </div>

        {/* Back */}
        <div
          style={{
            position: "absolute",
            width: "calc(100% - 24px)",
            height: "100%",
            backfaceVisibility: "hidden",
            backgroundColor: "var(--bg-secondary)",
            border: "1px solid var(--border-color)",
            borderRadius: "8px",
            padding: "12px",
            transform: "rotateY(180deg)",
            display: "flex",
            flexDirection: "column",
            textAlign: "left",
            overflow: "hidden",
            boxShadow: "var(--shadow-md)",
            color: "var(--text-primary)",
          }}
        >
          <div
            style={{
              fontSize: "0.8rem",
              color: "var(--text-muted)",
              marginBottom: "8px",
              fontWeight: "bold",
              borderBottom: "1px solid var(--border-color)",
              paddingBottom: "4px",
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <span>EXECUTION LOG</span>
            {task.status === "completed" && (
              <span style={{ color: "#4caf50" }}>✓</span>
            )}
            {task.status === "failed" && (
              <span style={{ color: "#f44336" }}>✗</span>
            )}
          </div>
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              fontSize: "0.75rem",
              fontFamily: "monospace",
              color: "var(--text-secondary)",
            }}
            className="markdown-body"
          >
            {task.output ? (
              <div style={{ whiteSpace: "pre-wrap" }}>
                <strong>Result:</strong>
                <div
                  style={{
                    marginTop: "4px",
                    padding: "4px",
                    backgroundColor: "var(--bg-tertiary)",
                    borderRadius: "4px",
                  }}
                >
                  {task.output.length > 150
                    ? task.output.substring(0, 150) + "..."
                    : task.output}
                </div>
              </div>
            ) : task.status === "running" ? (
              <span style={{ fontStyle: "italic" }}>Working...</span>
            ) : (
              <span style={{ fontStyle: "italic", opacity: 0.7 }}>
                No output yet
              </span>
            )}

            {task.logs.length > 0 && (
              <div
                style={{
                  marginTop: "10px",
                  borderTop: "1px dashed var(--border-color)",
                  paddingTop: "4px",
                }}
              >
                <strong>Logs:</strong>
                {task.logs.map((log, i) => (
                  <div
                    key={i}
                    style={{ color: "var(--text-muted)", marginTop: "2px" }}
                  >
                    &gt; {log}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export const SwarmBoard: React.FC<SwarmBoardProps> = ({ swarmState }) => {
  if (!swarmState || swarmState.stages.length === 0) return null;

  return (
    <div
      style={{
        marginTop: "15px",
        marginBottom: "15px",
        borderTop: "1px solid var(--border-color)",
        paddingTop: "15px",
      }}
    >
      <div
        style={{
          marginBottom: "10px",
          color: "var(--text-muted)",
          fontSize: "0.9rem",
          fontWeight: 600,
        }}
      >
        🐝 Swarm Activity
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "40px", // Increased gap between stages to prevent occlusion
        }}
      >
        {swarmState.stages.map((stage) => (
          <div key={stage.id}>
            <div
              style={{
                fontSize: "0.85rem",
                color: "var(--text-secondary)",
                marginBottom: "16px", // Increased bottom margin for title
                textTransform: "uppercase",
                letterSpacing: "1px",
                fontWeight: 600,
              }}
            >
              Stage: {stage.name}
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "nowrap",
                gap: "32px", // Increased gap between cards to prevent occlusion
                alignItems: "flex-start", // Ensure alignment
                overflowX: "auto",
                overflowY: "hidden", // Remove vertical scrollbar
                paddingBottom: "20px",
                paddingLeft: "20px",
                paddingRight: "20px",
                width: "100%",
              }}
            >
              {stage.tasks.map((task) => (
                <AgentCard key={task.id} task={task} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
