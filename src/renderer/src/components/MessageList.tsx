import React, { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import remarkGfm from "remark-gfm";
import { LogMessage } from "../types/message";
import { SwarmBoard } from "./SwarmBoard";

interface MessageListProps {
  messages: LogMessage[];
  messagesEndRef: React.RefObject<HTMLDivElement>;
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  messagesEndRef,
}) => {
  const [expandedThoughts, setExpandedThoughts] = useState<
    Record<string, boolean>
  >({});

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

    // Split content by thinking blocks
    const lines = msg.content.split("\n");
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

        {/* {shouldRenderDetails && (
          <pre
            style={{
              marginTop: "10px",
              backgroundColor: "#1e1e1e",
              padding: "8px",
              borderRadius: "4px",
              overflowX: "auto",
              fontSize: "0.85rem",
              maxHeight: "300px",
            }}
          >
            {JSON.stringify(displayableDetails, null, 2)}
          </pre>
        )} */}
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
