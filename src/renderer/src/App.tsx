import { useState, useEffect, useRef } from "react";
import "./styles.css";
import { t } from "./utils/translations";
import { AppSettings, DEFAULT_SETTINGS } from "./types/settings";
import {
  interactionClient,
  DeviceInfo,
  AuthRequest,
} from "./services/interaction-client";
import { SettingsModal } from "./components/SettingsModal";
import { ChatInput } from "./components/ChatInput";
import { Sidebar } from "./components/Sidebar";
import { Header } from "./components/Header";
import { MessageList } from "./components/MessageList";
import { loadSettings, saveSettings } from "./hooks/useSettings";
import { loadSessions, saveCurrentSession } from "./hooks/useSessions";
import { LogMessage } from "./types/message";

function App() {
  // --- State ---
  const [messages, setMessages] = useState<LogMessage[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Re-calculate trans when settings change
  const trans = t(settings.general.language);
  const [interactionStatus, setInteractionStatus] = useState<
    "disconnected" | "connecting" | "connected"
  >("disconnected");
  const [deviceList, setDeviceList] = useState<DeviceInfo[]>([]);
  const [authRequests, setAuthRequests] = useState<AuthRequest[]>([]);

  // Sessions
  const [sessions, setSessions] = useState<any[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>("");
  const [isCreatingSession, setIsCreatingSession] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const currentSessionIdRef = useRef<string>("");

  // --- Effects ---

  // 1. Load Settings
  useEffect(() => {
    loadSettings(setSettings);
  }, []);

  // Apply Theme
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", settings.general.theme);
  }, [settings.general.theme]);

  // 2. Load Tools & IPC

  // 3. Load Sessions
  useEffect(() => {
    loadSessions(
      setSessions,
      setCurrentSessionId,
      setMessages,
      createNewSession,
    );
  }, [trans.newChat]); // Depend on trans for initial title

  // Keep a ref of the current session ID for use inside stable callbacks
  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  // 4. 持久化当前会话的完整消息（包括 swarm 细节和 final answer）
  useEffect(() => {
    if (!currentSessionId) return;
    if (messages.length === 0) return;
    saveCurrentSession(currentSessionId, messages, setSessions, trans);
  }, [currentSessionId, messages, trans]);

  // 4. Auto-Scroll logic moved to MessageList component

  // 5. Interaction Client
  useEffect(() => {
    interactionClient.init(
      (req) => {
        setAuthRequests((prev) => [...prev, req]);
      },
      (status) => {
        setInteractionStatus(status);
      },
      (devices) => {
        setDeviceList(devices);
      },
    );

    // Listen for incoming messages
    interactionClient.onMessage((msg) => {
      if (msg.payload) {
        // Allow messages from system or teammates (any non-user source)
        // We assume anything not from us is an assistant/system message
        const isFromSystem = msg.payload.from === "system";
        const sender = isFromSystem ? undefined : msg.payload.from;

        if (msg.payload.isChunk) {
          updateLastMessage(
            "assistant",
            msg.payload.content,
            msg.payload.details,
          );
        } else {
          // Final message or non-streamed message
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (
              last &&
              last.role === "assistant" &&
              last.details?.isStreaming
            ) {
              // Capture thoughts from the streaming content before replacing it
              const existingThoughts = last.content
                .split("\n")
                .map((l) => l.trim())
                .filter(
                  (l) => l.startsWith("*") && l.endsWith("*") && l.length > 2,
                )
                .map((l) => l.slice(1, -1));

              const allThoughts = [
                ...(last.details?.thoughts || []),
                ...existingThoughts,
              ];

              // Remove duplicates just in case
              const uniqueThoughts = Array.from(new Set(allThoughts));

              // Replace the streaming message with final content
              const updated: LogMessage = {
                ...last,
                sender: sender || last.sender, // Update sender if provided
                content: msg.payload.content,
                details: {
                  ...last.details,
                  ...(msg.payload.details || {}),
                  isStreaming: false,
                  thoughts:
                    uniqueThoughts.length > 0 ? uniqueThoughts : undefined,
                },
              };
              return [...prev.slice(0, -1), updated];
            } else {
              // New message
              return [
                ...prev,
                {
                  id: crypto.randomUUID(),
                  timestamp: Date.now(),
                  role: "assistant",
                  sender: sender,
                  content: msg.payload.content || "",
                  details: {
                    ...(msg.payload.details || {}),
                  },
                },
              ];
            }
          });
        }
      }
    });

    // Listen for Session Responses
    interactionClient.onSessionResponse((payload) => {
      setIsCreatingSession(false);
      if (payload.status === "created" && payload.sessionId) {
        const newSession = {
          id: payload.sessionId,
          title: trans.newChat,
          timestamp: Date.now(),
          messages: [],
        };
        setSessions((prev) => [newSession, ...prev]);
        setCurrentSessionId(payload.sessionId);
        setMessages([]);
      }
    });

    // Listen for Session History Responses
    interactionClient.onSessionHistoryResponse((payload) => {
      if (payload.sessionId && payload.messages) {
        // Map backend messages to LogMessage format
        const loadedMessages: LogMessage[] = payload.messages.map((m: any) => ({
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          role: m.role,
          content:
            typeof m.content === "string"
              ? m.content
              : JSON.stringify(m.content ?? ""),
          sender: m.name || (m.role === "user" ? undefined : "assistant"),
        }));

        // Cache backend messages，仅在本地缓存为空或只有用户消息时才覆盖
        setSessions((prev) => {
          const index = prev.findIndex((s) => s.id === payload.sessionId);
          if (index === -1) return prev;

          const session = prev[index];
          const sessionMessages: LogMessage[] = session.messages || [];

          const hasNonUserMessage = sessionMessages.some(
            (m) => m.role !== "user",
          );
          if (sessionMessages.length > 0 && hasNonUserMessage) {
            // 已经有 assistant/system 等富历史，保留本地快照
            return prev;
          }

          const updatedSession = {
            ...session,
            messages: loadedMessages,
          };

          const next = [...prev];
          next[index] = updatedSession;
          return next;
        });

        // 仅在当前会话消息为空或只包含用户消息时，用后端历史填充 UI
        setMessages((prev) => {
          if (currentSessionIdRef.current !== payload.sessionId) {
            return prev;
          }

          const hasNonUserMessage = prev.some((m) => m.role !== "user");
          if (prev.length > 0 && hasNonUserMessage) {
            return prev;
          }

          return loadedMessages;
        });
      }
    });

    // Initial connection handled by init()
    // interactionClient.connect();

    return () => {
      interactionClient.disconnect();
    };
  }, []); // Remove trans dependency to avoid re-init loop, handle trans inside callbacks if needed or use ref

  // --- Handlers ---

  const createNewSession = () => {
    if (isCreatingSession) return;

    // If connected, request from server
    if (interactionStatus === "connected") {
      setIsCreatingSession(true);
      interactionClient.requestSession();
    } else {
      // Fallback: Create locally (Offline mode)
      // Note: This might cause issues if we enforce server-side session strictly.
      // But for UX, we allow it, and maybe sync later (not implemented yet).
      console.warn("Offline: Creating local session");
      const newId = crypto.randomUUID();
      const newSession = {
        id: newId,
        title: trans.newChat,
        timestamp: Date.now(),
        messages: [],
      };
      setSessions((prev) => [newSession, ...prev]);
      setCurrentSessionId(newId);
      setMessages([]);
    }
  };

  const loadSession = (sessionId: string) => {
    setCurrentSessionId(sessionId);

    // Always show locally cached messages first (they contain rich swarm details)
    const session = sessions.find((s) => s.id === sessionId);
    if (session) {
      setMessages(session.messages);
    } else {
      setMessages([]);
    }

    // Optionally refresh from backend for persistence / recovery,
    // but avoid overriding existing rich history in the UI.
    if (interactionStatus === "connected") {
      interactionClient.requestSessionHistory(sessionId);
    }
  };

  const deleteSession = (sessionId: string) => {
    const newSessions = sessions.filter((s) => s.id !== sessionId);
    setSessions(newSessions);
    localStorage.setItem("z-one-sessions", JSON.stringify(newSessions));

    if (currentSessionId === sessionId) {
      if (newSessions.length > 0) {
        loadSession(newSessions[0].id);
      } else {
        createNewSession();
      }
    }
  };

  const updateLastMessage = (
    role: LogMessage["role"],
    contentChunk: string = "",
    detailsUpdate?: any,
  ) => {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === role && last.details?.isStreaming) {
        const updated = {
          ...last,
          content: last.content + (contentChunk || ""),
          details: {
            ...last.details,
            ...(detailsUpdate || {}),
          },
        };
        return [...prev.slice(0, -1), updated];
      } else {
        return [
          ...prev,
          {
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            role,
            content: contentChunk || "",
            details: { isStreaming: true, ...(detailsUpdate || {}) },
          },
        ];
      }
    });
  };

  const handleSendMessage = async (content: string, images: string[] = []) => {
    if (!content.trim() && images.length === 0) return;

    const attachments = images
      .map((img) => {
        const match = img.match(/^data:(.*?);base64,(.*)$/);
        return match
          ? {
              type: "image" as const,
              mimeType: match[1],
              data: match[2],
            }
          : null;
      })
      .filter(
        (item): item is { type: "image"; data: string; mimeType: string } =>
          item !== null,
      );

    // 1. Add User Message
    const userMsg: LogMessage = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      role: "user",
      content,
      details:
        attachments && attachments.length > 0
          ? { content: attachments }
          : undefined,
    };

    const newMessages = [...messages, userMsg];
    setMessages(newMessages);

    // 2. Persist Session (Title update logic inside hook)
    saveCurrentSession(currentSessionId, newMessages, setSessions, trans);

    // 3. Send to Backend
    try {
      if (interactionStatus === "connected") {
        await interactionClient.sendMessage(
          {
            content,
            images: attachments,
          },
          currentSessionId, // Pass session ID
        );
      } else {
        // Fallback or error
        const errorMsg: LogMessage = {
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          role: "system",
          content: "Error: Backend not connected.",
        };
        setMessages((prev) => [...prev, errorMsg]);
      }
    } catch (error: any) {
      const errorMsg: LogMessage = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        role: "system",
        content: `Error: ${error.message}`,
      };
      setMessages((prev) => [...prev, errorMsg]);
    }
  };

  const handleWindowCommand = (
    cmd: "window:minimize" | "window:maximize" | "window:close",
  ) => {
    if (window.electron && window.electron.ipcRenderer) {
      window.electron.ipcRenderer.send(cmd);
    }
  };

  return (
    <div
      className="app-container"
      style={{ "--accent-color": settings.general.primaryColor } as any}
    >
      <Sidebar
        isOpen={isSidebarOpen}
        sessions={sessions}
        currentSessionId={currentSessionId}
        trans={trans}
        onNewChat={createNewSession}
        onLoadSession={loadSession}
        onDeleteSession={deleteSession}
        formatTime={(ts) =>
          new Date(ts).toLocaleString(undefined, {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })
        }
        isCreating={isCreatingSession}
      />

      {/* Auth Requests Modal Overlay */}
      {authRequests.length > 0 && (
        <div className="modal-overlay">
          <div
            className="modal-content"
            style={{ width: "400px", height: "auto", padding: "20px" }}
          >
            <h3 style={{ marginTop: 0, color: "var(--text-primary)" }}>
              Device Access Request
            </h3>
            <div style={{ margin: "20px 0", color: "var(--text-secondary)" }}>
              <p>
                <strong>Name:</strong> {authRequests[0].name}
              </p>
              <p>
                <strong>Device ID:</strong> {authRequests[0].deviceId}
              </p>
              <p>
                <strong>IP:</strong> {authRequests[0].ip}
              </p>
            </div>
            <div
              style={{
                display: "flex",
                gap: "10px",
                justifyContent: "flex-end",
              }}
            >
              <button
                className="btn btn-secondary"
                onClick={() => {
                  interactionClient.approveRequest(
                    authRequests[0].requestId,
                    false,
                  );
                  setAuthRequests((prev) => prev.slice(1));
                }}
              >
                Reject
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  interactionClient.approveRequest(
                    authRequests[0].requestId,
                    true,
                  );
                  setAuthRequests((prev) => prev.slice(1));
                }}
              >
                Allow
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="main-content">
        <Header
          isSidebarOpen={isSidebarOpen}
          toggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
          trans={trans}
          interactionStatus={interactionStatus}
          deviceList={deviceList}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onWindowCommand={handleWindowCommand}
          canControlWindow={!!(window.electron && window.electron.ipcRenderer)}
          onReconnect={() => interactionClient.reconnect()}
        />

        <MessageList
          messages={messages}
          messagesEndRef={messagesEndRef as React.RefObject<HTMLDivElement>}
        />

        <ChatInput
          disabled={interactionStatus !== "connected"}
          // Add required props for ChatInput
          models={settings.models.filter((m) => m.enabled)}
          activeModelId={settings.activeModelId}
          onModelChange={(id) => {
            const newSettings = { ...settings, activeModelId: id };
            saveSettings(newSettings, setSettings);
          }}
          onSend={handleSendMessage} // Use handleSendMessage as onSend
          loading={false} // Manage loading state if needed
          language={settings.general.language}
        />
      </div>

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onSave={(newSettings) => saveSettings(newSettings, setSettings)}
        trans={trans}
      />
    </div>
  );
}

export default App;
