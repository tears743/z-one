import { useState, useEffect, useRef } from "react";
import {
  Settings as SettingsIcon,
  Minus,
  Square,
  X,
  Plus,
  Trash2,
  Menu,
  Monitor,
  MonitorOff,
} from "lucide-react";
import { AppSettings, DEFAULT_SETTINGS } from "./types/settings";
import { SettingsModal } from "./components/SettingsModal";
import { ChatInput } from "./components/ChatInput";
import { t } from "./utils/translations";
import {
  interactionClient,
  AuthRequest,
  DeviceInfo,
} from "./services/interaction-client";

interface LogMessage {
  id: string;
  timestamp: number;
  role: "user" | "assistant" | "system";
  content: string;
  details?: any;
}

function App(): React.JSX.Element {
  const [tools, setTools] = useState<any[]>([]);
  const [messages, setMessages] = useState<LogMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [sessions, setSessions] = useState<
    { id: string; title: string; timestamp: number; messages: LogMessage[] }[]
  >([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // Settings State
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const trans = t(settings.general.language);

  const [authRequests, setAuthRequests] = useState<AuthRequest[]>([]);
  const [interactionStatus, setInteractionStatus] = useState<
    "disconnected" | "connecting" | "connected"
  >("disconnected");
  const [deviceList, setDeviceList] = useState<DeviceInfo[]>([]);
  const [showDeviceList, setShowDeviceList] = useState(false);

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
      if (msg.payload && msg.payload.content) {
        // Check if it is a response from system
        if (msg.payload.from === "system") {
          addMessage("assistant", msg.payload.content);
          setLoading(false);
        } else {
          // Message from other devices?
          // For now, treat as assistant or system info
        }
      }
    });
  }, []);

  // Load settings
  useEffect(() => {
    const loadSettings = async () => {
      if (window.electron && window.electron.ipcRenderer) {
        try {
          const savedSettings = await window.electron.ipcRenderer.invoke(
            "db:get-app-settings",
          );
          if (savedSettings) {
            setSettings({ ...DEFAULT_SETTINGS, ...savedSettings });
          }
        } catch (e) {
          console.error("Failed to load settings from DB", e);
        }
      } else {
        const savedSettings = localStorage.getItem("z-one-settings");
        if (savedSettings) {
          try {
            setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(savedSettings) });
          } catch (e) {
            console.error("Failed to parse settings", e);
          }
        }
      }
    };
    loadSettings();
  }, []);

  // Save settings
  const handleSaveSettings = async (newSettings: AppSettings) => {
    setSettings(newSettings);
    if (window.electron && window.electron.ipcRenderer) {
      try {
        await window.electron.ipcRenderer.invoke(
          "db:save-app-settings",
          newSettings,
        );
      } catch (e) {
        console.error("Failed to save settings to DB", e);
      }
    } else {
      localStorage.setItem("z-one-settings", JSON.stringify(newSettings));
    }
  };

  const canControlWindow = !!window.electron?.ipcRenderer?.send;
  const sendWindowCommand = (
    cmd: "window:minimize" | "window:maximize" | "window:close",
  ) => {
    if (!canControlWindow) return;
    window.electron!.ipcRenderer.send(cmd);
  };

  // Load sessions from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("z-one-sessions");
    if (saved) {
      try {
        const loadedSessions = JSON.parse(saved);
        setSessions(loadedSessions);
        if (loadedSessions.length > 0) {
          // Load the first (most recent) session
          const mostRecent = loadedSessions[0];
          setCurrentSessionId(mostRecent.id);
          setMessages(mostRecent.messages);
        } else {
          createNewSession();
        }
      } catch (e) {
        console.error("Failed to parse sessions", e);
        createNewSession();
      }
    } else {
      createNewSession();
    }
  }, []);

  // Save current session when messages change
  useEffect(() => {
    if (!currentSessionId || messages.length === 0) return;

    setSessions((prev) => {
      const index = prev.findIndex((s) => s.id === currentSessionId);
      const firstUserMsg = messages.find((m) => m.role === "user");
      const title = firstUserMsg
        ? firstUserMsg.content.slice(0, 30) +
          (firstUserMsg.content.length > 30 ? "..." : "")
        : trans.newChat;

      const updatedSession = {
        id: currentSessionId,
        title,
        timestamp: Date.now(),
        messages,
      };

      let nextSessions;
      if (index >= 0) {
        nextSessions = [...prev];
        nextSessions[index] = updatedSession;
      } else {
        nextSessions = [updatedSession, ...prev];
      }

      localStorage.setItem("z-one-sessions", JSON.stringify(nextSessions));
      return nextSessions;
    });
  }, [messages, currentSessionId]);

  const formatSessionTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleString(undefined, {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const createNewSession = () => {
    const newId = crypto.randomUUID();
    const now = Date.now();
    const newSession = {
      id: newId,
      title: trans.newChat,
      timestamp: now,
      messages: [] as LogMessage[],
    };
    setSessions((prev) => {
      const nextSessions = [newSession, ...prev];
      localStorage.setItem("z-one-sessions", JSON.stringify(nextSessions));
      return nextSessions;
    });
    setCurrentSessionId(newId);
    setMessages([]);
  };

  const loadSession = (sessionId: string) => {
    const session = sessions.find((s) => s.id === sessionId);
    if (session) {
      setCurrentSessionId(session.id);
      setMessages(session.messages);
    }
  };

  const deleteSession = (sessionId: string) => {
    const nextSessions = sessions.filter((s) => s.id !== sessionId);
    localStorage.setItem("z-one-sessions", JSON.stringify(nextSessions));
    setSessions(nextSessions);

    if (sessionId === currentSessionId) {
      const next = nextSessions[0];
      if (next) {
        setCurrentSessionId(next.id);
        setMessages(next.messages);
      } else {
        createNewSession();
      }
    }
  };

  const addMessage = (
    role: LogMessage["role"],
    content: string,
    details?: any,
  ) => {
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        role,
        content,
        details,
      },
    ]);
  };

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  useEffect(() => {
    const loadTools = async () => {
      try {
        addMessage("system", "Connecting to MCP Hub...");
        if (window.electron && window.electron.ipcRenderer) {
          const availableTools =
            await window.electron.ipcRenderer.invoke("mcp:get-tools");
          setTools(availableTools);
          addMessage(
            "system",
            `Connected. Found ${availableTools.length} tools.`,
            availableTools,
          );
        } else {
          console.warn("Electron IPC not available. Running in browser mode.");
          addMessage(
            "system",
            "Running in Browser Mode. Electron IPC not available.",
          );
          // Mock tools for UI dev
          setTools([
            { name: "get_screenshot" },
            { name: "get_desktop_tree" },
            { name: "get_active_window_tree" },
          ]);
        }
      } catch (err) {
        console.error("Failed to load tools:", err);
        addMessage("system", `Error loading tools: ${err}`);
      }
    };
    loadTools();
  }, []);

  const handleCallTool = async (toolName: string) => {
    setLoading(true);
    addMessage("user", `Execute tool: ${toolName}`);

    try {
      if (window.electron && window.electron.ipcRenderer) {
        const result = await window.electron.ipcRenderer.invoke(
          "mcp:call-tool",
          {
            serverName: "local-desktop",
            toolName,
            args: { depth: 2 },
          },
        );
        addMessage("assistant", `Tool ${toolName} completed.`, result);
      } else {
        addMessage(
          "system",
          "Cannot execute tool: Electron IPC not available.",
        );
        // Mock response for screenshot if in browser
        if (toolName === "get_screenshot") {
          // Return a fake result for testing UI
          addMessage("assistant", `Tool ${toolName} completed (MOCKED).`, {
            content: [
              { type: "text", text: "Mocked screenshot result in browser" },
            ],
          });
        }
      }
    } catch (err) {
      addMessage("system", `Error calling tool: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSendMessage = async (text: string, images: string[]) => {
    if (!text.trim() && images.length === 0) return;

    // Format details for images if any
    let details = undefined;
    if (images.length > 0) {
      details = {
        content: images.map((img) => ({
          type: "image",
          data: img.split(",")[1], // Remove data:image/png;base64, prefix
          mimeType: "image/png",
        })),
      };
    }
    console.log("Sending message:", text, details);
    addMessage("user", text, details);

    // Call Intelligence Layer via WebSocket (InteractionClient)
    setLoading(true);
    try {
      // Prepare content for backend (handle images)
      let content: string | any[] = text;
      if (images.length > 0) {
        content = [
          { type: "text", text: text },
          ...images.map((img) => ({
            type: "image_url",
            image_url: { url: img }, // img is already data URL
          })),
        ];
      }

      // Send message via WebSocket
      // Only send the model ID, let backend fetch credentials
      const activeModel = settings.models.find(
        (m) => m.id === settings.activeModelId,
      );
      const modelInfo = activeModel ? { id: activeModel.id } : undefined;
      interactionClient.sendMessage(content, modelInfo);
      // Note: Response will be handled in onMessage callback
    } catch (e) {
      console.error("Failed to send message:", e);
      addMessage("system", `Error: ${e}`);
      setLoading(false);
    }
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
            <div>{msg.content}</div>
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

    return (
      <>
        <div>{msg.content}</div>
        {msg.details && (
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
            {JSON.stringify(msg.details, null, 2)}
          </pre>
        )}
      </>
    );
  };

  return (
    <div
      className="app-container"
      style={{
        // @ts-ignore
        "--accent-color": settings.general.primaryColor,
      }}
    >
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onSave={handleSaveSettings}
      />

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

      {/* Sidebar */}
      <div
        className="sidebar"
        style={{
          width: isSidebarOpen ? "250px" : "0px",
        }}
      >
        <div className="sidebar-header">
          <button onClick={createNewSession} className="new-chat-btn">
            <Plus size={16} />
            {trans.newChat}
          </button>
        </div>
        <div className="session-list">
          {sessions.map((s) => (
            <div
              key={s.id}
              onClick={() => loadSession(s.id)}
              className={`session-item ${s.id === currentSessionId ? "active" : ""}`}
            >
              <div className="session-item-content">
                <div className="session-title">{s.title}</div>
                <div className="session-time">
                  {formatSessionTime(s.timestamp)}
                </div>
              </div>
              <button
                className="session-delete-btn"
                title="Delete"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteSession(s.id);
                }}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <div className="main-content">
        {/* Header */}
        <header className="app-header">
          <div className="header-left">
            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="icon-btn"
              title={
                isSidebarOpen ? trans.sidebar.collapse : trans.sidebar.expand
              }
            >
              <Menu size={18} />
            </button>
            <h1 className="header-title">{trans.appTitle}</h1>
            <button
              onClick={() => setShowDeviceList(!showDeviceList)}
              className="icon-btn"
              title={`Interaction Layer: ${interactionStatus}`}
              style={{
                marginLeft: "8px",
                position: "relative",
                color:
                  interactionStatus === "connected"
                    ? "#4caf50"
                    : interactionStatus === "connecting"
                      ? "#ffc107"
                      : "#666",
              }}
            >
              {interactionStatus === "connected" ? (
                <Monitor size={18} />
              ) : (
                <MonitorOff size={18} />
              )}
              {deviceList.length > 0 && (
                <span
                  style={{
                    position: "absolute",
                    top: "-2px",
                    right: "-2px",
                    backgroundColor: "#0e639c",
                    color: "white",
                    fontSize: "9px",
                    borderRadius: "50%",
                    width: "12px",
                    height: "12px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {deviceList.length}
                </span>
              )}
            </button>

            {showDeviceList && (
              <div
                style={{
                  position: "absolute",
                  top: "40px",
                  left: "260px",
                  width: "250px",
                  backgroundColor: "var(--bg-secondary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "var(--radius-md)",
                  boxShadow: "var(--shadow-lg)",
                  zIndex: 1000,
                  padding: "8px",
                }}
              >
                <div
                  style={{
                    fontWeight: 600,
                    marginBottom: "8px",
                    paddingBottom: "8px",
                    borderBottom: "1px solid var(--border-color)",
                    color: "var(--text-primary)",
                  }}
                >
                  Connected Devices
                </div>
                {deviceList.length === 0 ? (
                  <div
                    style={{
                      color: "var(--text-muted)",
                      fontSize: "0.9rem",
                      padding: "4px",
                    }}
                  >
                    No devices connected
                  </div>
                ) : (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "4px",
                    }}
                  >
                    {deviceList.map((device) => (
                      <div
                        key={device.id}
                        style={{
                          padding: "8px",
                          borderRadius: "var(--radius-sm)",
                          backgroundColor: "var(--bg-tertiary)",
                          fontSize: "0.9rem",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                          }}
                        >
                          <span
                            style={{
                              color: "var(--text-primary)",
                              fontWeight: 500,
                            }}
                          >
                            {device.name}
                          </span>
                          <span
                            style={{
                              fontSize: "0.75rem",
                              padding: "2px 6px",
                              borderRadius: "10px",
                              backgroundColor:
                                device.status === "active"
                                  ? "#4caf5020"
                                  : "#ffc10720",
                              color:
                                device.status === "active"
                                  ? "#4caf50"
                                  : "#ffc107",
                            }}
                          >
                            {device.status}
                          </span>
                        </div>
                        <div
                          style={{
                            fontSize: "0.75rem",
                            color: "var(--text-muted)",
                            marginTop: "2px",
                          }}
                        >
                          {device.type} • {device.deviceId.slice(0, 8)}...
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="window-controls">
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="icon-btn"
              title={trans.settings}
              style={{ marginRight: "16px" }}
            >
              <SettingsIcon size={20} />
            </button>

            <button
              onClick={() => sendWindowCommand("window:minimize")}
              disabled={!canControlWindow}
              className="window-control-btn"
              title="Minimize"
            >
              <Minus size={18} />
            </button>
            <button
              onClick={() => sendWindowCommand("window:maximize")}
              disabled={!canControlWindow}
              className="window-control-btn"
              title="Maximize"
            >
              <Square size={16} />
            </button>
            <button
              onClick={() => sendWindowCommand("window:close")}
              disabled={!canControlWindow}
              className="window-control-btn close"
              title="Close"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        {/* Chat Area */}
        <div className="chat-area">
          {messages.map((msg) => (
            <div key={msg.id} className={`message-container ${msg.role}`}>
              <div className="message-meta">
                {msg.role.toUpperCase()} •{" "}
                {new Date(msg.timestamp).toLocaleTimeString()}
              </div>
              <div className="message-bubble">{renderMessageContent(msg)}</div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <ChatInput
          models={settings.models.filter((m) => m.enabled)}
          activeModelId={settings.activeModelId}
          onModelChange={(id) =>
            setSettings((prev) => ({ ...prev, activeModelId: id }))
          }
          onSend={handleSendMessage}
          loading={loading}
          language={settings.general.language}
        />
      </div>
    </div>
  );
}

export default App;
