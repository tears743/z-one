import React, { useState, useEffect } from "react";
import { X, Plus, Trash2, Save, Check } from "lucide-react";
import { AppSettings, ModelConfig, ModelProvider, DeviceConfig, DeviceType } from "../types/settings";
import { t, translations } from "../utils/translations";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onSave: (newSettings: AppSettings) => void;
  trans: typeof translations.en;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onSave,
}) => {
  const [activeTab, setActiveTab] = useState<"general" | "agent" | "models" | "devices" | "scheduledTasks">(
    "general",
  );
  const [localSettings, setLocalSettings] = useState<AppSettings>(settings);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const trans = t(localSettings.general.language);
  const [scheduledTasks, setScheduledTasks] = useState<any[]>([]);

  // Load scheduled tasks when tab is active
  useEffect(() => {
    if (activeTab === "scheduledTasks" && isOpen) {
      window.electron?.ipcRenderer.invoke("cron:list").then((tasks: any[]) => {
        setScheduledTasks(tasks || []);
      });
    }
  }, [activeTab, isOpen]);

  // Reset local state when opening
  useEffect(() => {
    if (isOpen) {
      setLocalSettings(settings);
    }
  }, [isOpen, settings]);

  if (!isOpen) return null;

  const handleSelectFolder = async () => {
    if (window.electron && window.electron.ipcRenderer) {
      const folderPath = await window.electron.ipcRenderer.invoke(
        "dialog:openDirectory",
      );
      if (folderPath) {
        updateGeneral("agentWorkspace", folderPath);
      }
    }
  };

  const handleSave = () => {
    // Validation
    const hasLLM = localSettings.models.some(
      (m) =>
        m.enabled && (m.modelType === "llm" || m.modelType === "multimodal"),
    );
    const hasEmbedding = localSettings.models.some(
      (m) => m.enabled && m.modelType === "embedding",
    );
    const hasMultimodal = localSettings.models.some(
      (m) => m.enabled && m.modelType === "multimodal",
    );

    if (!hasLLM) {
      alert(trans.errors.requireLLM);
      return;
    }
    if (!hasEmbedding) {
      alert(trans.errors.requireEmbedding);
      return;
    }

    if (!hasMultimodal) {
      if (!window.confirm(trans.errors.noMultimodalWarning)) {
        return;
      }
    }

    const lockedSettings: AppSettings = {
      ...localSettings,
    };

    onSave(lockedSettings);
    onClose();
  };

  const updateGeneral = <K extends keyof AppSettings["general"]>(
    key: K,
    value: AppSettings["general"][K],
  ) => {
    setLocalSettings((prev) => ({
      ...prev,
      general: { ...prev.general, [key]: value },
    }));
  };

  const updateModel = (id: string, updates: Partial<ModelConfig>) => {
    setLocalSettings((prev) => ({
      ...prev,
      models: prev.models.map((m) => (m.id === id ? { ...m, ...updates } : m)),
    }));
  };

  const addModel = () => {
    const newModel: ModelConfig = {
      id: crypto.randomUUID(),
      provider: "openai",
      name: "New Model",
      modelId: "",
      enabled: true,
      isCustom: false,
      modelType: "llm",
    };
    setLocalSettings((prev) => ({
      ...prev,
      models: [...prev.models, newModel],
    }));
    setEditingModelId(newModel.id);
  };

  const deleteModel = (id: string) => {
    if (!window.confirm(trans.errors.deleteModelConfirm)) {
      return;
    }
    setLocalSettings((prev) => ({
      ...prev,
      models: prev.models.filter((m) => m.id !== id),
    }));
    if (editingModelId === id) setEditingModelId(null);
  };

  return (
    <div
      className="modal-overlay"
      style={{ "--accent-color": localSettings.general.primaryColor } as any}
    >
      <div className="modal-content">
        {/* Header */}
        <div className="modal-header">
          <h2
            style={{
              margin: 0,
              fontSize: "1.2rem",
              color: "var(--text-primary)",
            }}
          >
            {trans.settings}
          </h2>
          <button
            onClick={onClose}
            className="icon-btn"
            style={{ color: "var(--text-primary)" }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="modal-body">
          {/* Sidebar */}
          <div className="modal-sidebar">
            <SidebarItem
              label={trans.general}
              active={activeTab === "general"}
              onClick={() => setActiveTab("general")}
            />
            <SidebarItem
              label={trans.agent}
              active={activeTab === "agent"}
              onClick={() => setActiveTab("agent")}
            />
            <SidebarItem
              label={trans.models}
              active={activeTab === "models"}
              onClick={() => setActiveTab("models")}
            />
            <SidebarItem
              label={trans.devices}
              active={activeTab === "devices"}
              onClick={() => setActiveTab("devices")}
            />
            <SidebarItem
              label={trans.scheduledTasks}
              active={activeTab === "scheduledTasks"}
              onClick={() => setActiveTab("scheduledTasks")}
            />
          </div>

          {/* Main Panel */}
          <div className="modal-main">
            {activeTab === "general" && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "20px",
                }}
              >
                <Section title={trans.models}>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "10px",
                    }}
                  >
                    <label className="form-label">
                      {trans.activeChatModel}:
                      <select
                        value={localSettings.activeModelId}
                        onChange={(e) => {
                          const id = e.target.value;
                          const model = localSettings.models.find(
                            (m) => m.id === id,
                          );
                          if (model && model.modelType === "embedding") {
                            alert(trans.errors.selectLLMForChat);
                            return;
                          }
                          setLocalSettings((prev) => ({
                            ...prev,
                            activeModelId: id,
                          }));
                        }}
                        className="form-select"
                      >
                        {localSettings.models
                          .filter(
                            (m) => m.enabled && m.modelType !== "embedding",
                          )
                          .map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                      </select>
                    </label>

                    <label className="form-label">
                      {trans.activeEmbeddingModel}:
                      <select
                        value={localSettings.activeEmbeddingModelId || ""}
                        onChange={(e) =>
                          setLocalSettings((prev) => ({
                            ...prev,
                            activeEmbeddingModelId: e.target.value,
                          }))
                        }
                        className="form-select"
                      >
                        {localSettings.models
                          .filter(
                            (m) => m.enabled && m.modelType === "embedding",
                          )
                          .map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                      </select>
                    </label>
                  </div>
                </Section>
                <Section title={trans.appearance}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "20px",
                    }}
                  >
                    <div className="form-group">
                      <label className="form-label">{trans.theme}</label>
                      <select
                        value={localSettings.general.theme}
                        onChange={(e) =>
                          updateGeneral(
                            "theme",
                            e.target.value as "light" | "dark" | "system",
                          )
                        }
                        className="form-select"
                        style={{ width: "100%" }}
                      >
                        <option value="light">{trans.light}</option>
                        <option value="dark">{trans.dark}</option>
                        <option value="system">{trans.system}</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">{trans.primaryColor}</label>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                        }}
                      >
                        <div
                          style={{
                            width: "36px",
                            height: "36px",
                            borderRadius: "50%",
                            backgroundColor: localSettings.general.primaryColor,
                            border: "2px solid var(--border-color)",
                            cursor: "pointer",
                            position: "relative",
                            overflow: "hidden",
                          }}
                        >
                          <input
                            type="color"
                            value={localSettings.general.primaryColor}
                            onChange={(e) =>
                              updateGeneral("primaryColor", e.target.value)
                            }
                            style={{
                              position: "absolute",
                              top: "-50%",
                              left: "-50%",
                              width: "200%",
                              height: "200%",
                              cursor: "pointer",
                              opacity: 0,
                            }}
                          />
                        </div>
                        <span
                          style={{
                            fontSize: "0.9rem",
                            color: "var(--text-secondary)",
                          }}
                        >
                          {localSettings.general.primaryColor}
                        </span>
                      </div>
                    </div>
                  </div>
                </Section>
                <Section title={trans.agentWorkspace}>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "10px",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "0.8rem",
                        color: "var(--text-muted)",
                        marginBottom: "5px",
                      }}
                    >
                      {trans.agentWorkspaceDesc}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                      }}
                    >
                      <div
                        style={{
                          flex: 1,
                          padding: "8px 12px",
                          backgroundColor: "var(--bg-input)",
                          borderRadius: "var(--radius-sm)",
                          border: "1px solid var(--border-color)",
                          color: "var(--text-primary)",
                          fontSize: "0.9rem",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {localSettings.general.agentWorkspace &&
                        localSettings.general.agentWorkspace.length > 0
                          ? localSettings.general.agentWorkspace
                          : "Not set"}
                      </div>
                      <button
                        onClick={handleSelectFolder}
                        className="btn btn-secondary"
                        style={{ whiteSpace: "nowrap" }}
                      >
                        {trans.selectFolder}
                      </button>
                    </div>
                  </div>
                </Section>
                <Section title={trans.language}>
                  <select
                    value={localSettings.general.language}
                    onChange={(e) =>
                      updateGeneral("language", e.target.value as "en" | "zh")
                    }
                    className="form-select"
                  >
                    <option value="en">{trans.english}</option>
                    <option value="zh">{trans.chinese}</option>
                  </select>
                </Section>
              </div>
            )}

            {activeTab === "agent" && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "20px",
                }}
              >
                <Section title={trans.agentModel}>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "10px",
                    }}
                  >
                    <label className="form-label">
                      {trans.agentModel}:
                      <select
                        value={
                          localSettings.agentModelId ||
                          localSettings.activeModelId
                        }
                        onChange={(e) =>
                          setLocalSettings((prev) => ({
                            ...prev,
                            agentModelId: e.target.value,
                          }))
                        }
                        className="form-select"
                      >
                        {localSettings.models
                          .filter(
                            (m) => m.enabled && m.modelType !== "embedding",
                          )
                          .map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <div
                      style={{
                        fontSize: "0.8rem",
                        color: "var(--text-muted)",
                      }}
                    >
                      {trans.activeChatModel}:{" "}
                      {
                        (
                          localSettings.models.find(
                            (m) => m.id === localSettings.activeModelId,
                          ) || {}
                        ).name
                      }
                    </div>
                  </div>
                </Section>
              </div>
            )}

            {activeTab === "models" && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  height: "100%",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: "10px",
                  }}
                >
                  <h3 style={{ margin: 0, color: "var(--text-primary)" }}>
                    {trans.modelConfigurations}
                  </h3>
                  <button onClick={addModel} className="btn btn-primary">
                    <Plus size={16} style={{ marginRight: "5px" }} />{" "}
                    {trans.addModel}
                  </button>
                </div>

                <div
                  style={{
                    flex: 1,
                    overflowY: "auto",
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                  }}
                >
                  {localSettings.models.map((model) => (
                    <div
                      key={model.id}
                      style={{
                        padding: "10px",
                        backgroundColor: "var(--bg-tertiary)",
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid var(--border-color)",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          cursor: "pointer",
                        }}
                        onClick={() =>
                          setEditingModelId(
                            editingModelId === model.id ? null : model.id,
                          )
                        }
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "10px",
                          }}
                        >
                          <span
                            style={{
                              width: "10px",
                              height: "10px",
                              borderRadius: "50%",
                              backgroundColor: model.enabled
                                ? "#4caf50"
                                : "#666",
                            }}
                          />
                          <span
                            style={{
                              fontWeight: "bold",
                              color: "var(--text-primary)",
                            }}
                          >
                            {model.name}
                          </span>
                          <span
                            style={{
                              fontSize: "0.8rem",
                              color: "var(--text-muted)",
                            }}
                          >
                            ({model.provider})
                          </span>
                        </div>
                        <div style={{ display: "flex", gap: "10px" }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteModel(model.id);
                            }}
                            className="icon-btn"
                            style={{ color: "#ff5f56" }}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>

                      {editingModelId === model.id && (
                        <div
                          style={{
                            marginTop: "15px",
                            paddingTop: "15px",
                            borderTop: "1px solid var(--border-color)",
                            display: "grid",
                            gridTemplateColumns: "1fr 1fr",
                            gap: "10px",
                          }}
                        >
                          <Field label={trans.name}>
                            <input
                              value={model.name}
                              onChange={(e) =>
                                updateModel(model.id, { name: e.target.value })
                              }
                              className="form-input"
                            />
                          </Field>
                          <Field label={trans.apiType}>
                            <select
                              value={model.provider}
                              onChange={(e) =>
                                updateModel(model.id, {
                                  provider: e.target.value as ModelProvider,
                                })
                              }
                              className="form-select"
                            >
                              <option value="openai">openai</option>
                              <option value="ollama">ollama</option>
                              <option value="lm_studio">LM Studio</option>
                              <option value="anthropic">anthropic</option>
                              <option value="gemini">gemini</option>
                              <option value="deepseek">deepseek</option>
                              <option value="minimax">minimax</option>
                              <option value="qwen">qwen</option>
                            </select>
                          </Field>
                          <Field label={trans.modelType}>
                            <select
                              value={model.modelType || "llm"}
                              onChange={(e) =>
                                updateModel(model.id, {
                                  modelType: e.target.value as any,
                                })
                              }
                              className="form-select"
                            >
                              <option value="llm">{trans.typeLLM}</option>
                              <option value="multimodal">
                                {trans.typeMultimodal}
                              </option>
                              <option value="embedding">
                                {trans.typeEmbedding}
                              </option>
                            </select>
                          </Field>
                          <Field label={trans.modelId}>
                            <input
                              value={model.modelId}
                              onChange={(e) =>
                                updateModel(model.id, {
                                  modelId: e.target.value,
                                })
                              }
                              placeholder="e.g. gpt-4o"
                              className="form-input"
                            />
                          </Field>
                          <Field label={trans.baseUrl} fullWidth>
                            <input
                              value={model.baseUrl || ""}
                              onChange={(e) =>
                                updateModel(model.id, {
                                  baseUrl: e.target.value,
                                })
                              }
                              placeholder="https://api.openai.com/v1"
                              className="form-input"
                            />
                          </Field>
                          <Field label={trans.apiKey} fullWidth>
                            <input
                              type="password"
                              value={model.apiKey || ""}
                              onChange={(e) =>
                                updateModel(model.id, {
                                  apiKey: e.target.value,
                                })
                              }
                              placeholder="sk-..."
                              className="form-input"
                            />
                          </Field>

                          {/* Advanced Parameters */}
                          <div
                            style={{
                              gridColumn: "1 / -1",
                              display: "grid",
                              gridTemplateColumns: "1fr 1fr",
                              gap: "10px",
                            }}
                          >
                            <Field label={trans.temperature}>
                              <input
                                type="number"
                                min={0}
                                max={2}
                                step={0.1}
                                value={model.temperature ?? ""}
                                onChange={(e) =>
                                  updateModel(model.id, {
                                    temperature: e.target.value
                                      ? parseFloat(e.target.value)
                                      : undefined,
                                  })
                                }
                                placeholder="0.7"
                                className="form-input"
                              />
                            </Field>
                            <Field label={trans.maxTokens}>
                              <input
                                type="number"
                                min={1}
                                value={model.maxTokens ?? ""}
                                onChange={(e) =>
                                  updateModel(model.id, {
                                    maxTokens: e.target.value
                                      ? parseInt(e.target.value)
                                      : undefined,
                                  })
                                }
                                placeholder="e.g. 4096"
                                className="form-input"
                              />
                            </Field>
                          </div>

                          <Field
                            label="Max Input Tokens (History Compression)"
                            fullWidth
                          >
                            <input
                              type="number"
                              min={1}
                              value={model.inputMaxTokens ?? ""}
                              onChange={(e) =>
                                updateModel(model.id, {
                                  inputMaxTokens: e.target.value
                                    ? parseInt(e.target.value)
                                    : undefined,
                                })
                              }
                              placeholder="e.g. 8000"
                              className="form-input"
                            />
                          </Field>

                          <div
                            style={{
                              gridColumn: "1 / -1",
                              display: "flex",
                              flexWrap: "wrap",
                              gap: "20px",
                              marginTop: "10px",
                              paddingTop: "10px",
                              borderTop: "1px solid var(--border-color)",
                            }}
                          >
                            <label
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "5px",
                                cursor: "pointer",
                                color: "var(--text-secondary)",
                                fontSize: "0.9rem",
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={model.enabled}
                                onChange={(e) =>
                                  updateModel(model.id, {
                                    enabled: e.target.checked,
                                  })
                                }
                              />
                              {trans.enableModel}
                            </label>

                            <label
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "5px",
                                cursor: "pointer",
                                color: "var(--text-secondary)",
                                fontSize: "0.9rem",
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={!!model.stream}
                                onChange={(e) =>
                                  updateModel(model.id, {
                                    stream: e.target.checked,
                                  })
                                }
                              />
                              {trans.stream}
                            </label>

                            <label
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "5px",
                                cursor: "pointer",
                                color: "var(--text-secondary)",
                                fontSize: "0.9rem",
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={!!model.enableThinking}
                                onChange={(e) =>
                                  updateModel(model.id, {
                                    enableThinking: e.target.checked,
                                  })
                                }
                              />
                              {trans.enableThinking}
                            </label>

                            <label
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "5px",
                                cursor: "pointer",
                                color: "var(--text-secondary)",
                                fontSize: "0.9rem",
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={!!model.isCustom}
                                onChange={(e) =>
                                  updateModel(model.id, {
                                    isCustom: e.target.checked,
                                  })
                                }
                              />
                              Is Custom (Local)
                            </label>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === "devices" && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "20px",
                }}
              >
                <Section title={trans.devices}>
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      const newDevice: DeviceConfig = {
                        id: `device-${Date.now()}`,
                        type: "lark",
                        name: "",
                        enabled: true,
                      };
                      setLocalSettings((prev) => ({
                        ...prev,
                        devices: [...(prev.devices || []), newDevice],
                      }));
                    }}
                    style={{ marginBottom: "10px", alignSelf: "flex-start" }}
                  >
                    <Plus size={14} style={{ marginRight: "5px" }} />
                    {trans.addDevice}
                  </button>

                  {(!localSettings.devices || localSettings.devices.length === 0) && (
                    <p style={{ color: "var(--text-secondary)", fontStyle: "italic" }}>
                      {trans.noDevices}
                    </p>
                  )}

                  {(localSettings.devices || []).map((device, idx) => (
                    <div
                      key={device.id}
                      style={{
                        border: "1px solid var(--border-color)",
                        borderRadius: "8px",
                        padding: "16px",
                        marginBottom: "12px",
                        backgroundColor: "var(--bg-primary)",
                      }}
                    >
                      {/* Device header */}
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: "12px",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <span
                            style={{
                              fontSize: "1.2em",
                            }}
                          >
                            {device.type === "lark" ? "\uD83D\uDC26" : "\u2699\uFE0F"}
                          </span>
                          <span style={{ fontWeight: "bold", color: "var(--text-primary)" }}>
                            {device.name || (device.type === "lark" ? trans.lark : trans.hardware)}
                          </span>
                        </div>
                        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                          <label
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "4px",
                              fontSize: "0.85em",
                              color: "var(--text-secondary)",
                              cursor: "pointer",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={device.enabled}
                              onChange={(e) => {
                                const devices = [...(localSettings.devices || [])];
                                devices[idx] = { ...devices[idx], enabled: e.target.checked };
                                setLocalSettings((prev) => ({ ...prev, devices }));
                              }}
                            />
                            {trans.enabled}
                          </label>
                          <button
                            className="icon-btn"
                            onClick={() => {
                              const devices = (localSettings.devices || []).filter((_, i) => i !== idx);
                              setLocalSettings((prev) => ({ ...prev, devices }));
                            }}
                            style={{ color: "var(--error-color, #f44336)" }}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>

                      {/* Common fields */}
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr",
                          gap: "10px",
                        }}
                      >
                        <Field label={trans.deviceName}>
                          <input
                            className="form-input"
                            value={device.name}
                            placeholder={device.type === "lark" ? trans.lark : trans.hardware}
                            onChange={(e) => {
                              const devices = [...(localSettings.devices || [])];
                              devices[idx] = { ...devices[idx], name: e.target.value };
                              setLocalSettings((prev) => ({ ...prev, devices }));
                            }}
                          />
                        </Field>
                        <Field label={trans.deviceType}>
                          <select
                            className="form-input"
                            value={device.type}
                            onChange={(e) => {
                              const devices = [...(localSettings.devices || [])];
                              devices[idx] = { ...devices[idx], type: e.target.value as DeviceType };
                              setLocalSettings((prev) => ({ ...prev, devices }));
                            }}
                          >
                            <option value="lark">{trans.lark}</option>
                            <option value="hardware">{trans.hardware}</option>
                          </select>
                        </Field>
                      </div>

                      {/* Lark-specific fields */}
                      {device.type === "lark" && (
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1fr 1fr",
                            gap: "10px",
                            marginTop: "10px",
                          }}
                        >
                          <Field label={trans.appId}>
                            <input
                              className="form-input"
                              value={device.appId || ""}
                              placeholder="cli_xxxxxxxx"
                              onChange={(e) => {
                                const devices = [...(localSettings.devices || [])];
                                devices[idx] = { ...devices[idx], appId: e.target.value };
                                setLocalSettings((prev) => ({ ...prev, devices }));
                              }}
                            />
                          </Field>
                          <Field label={trans.appSecret}>
                            <input
                              className="form-input"
                              type="password"
                              value={device.appSecret || ""}
                              placeholder="App Secret"
                              onChange={(e) => {
                                const devices = [...(localSettings.devices || [])];
                                devices[idx] = { ...devices[idx], appSecret: e.target.value };
                                setLocalSettings((prev) => ({ ...prev, devices }));
                              }}
                            />
                          </Field>
                        </div>
                      )}

                      {/* Hardware-specific fields */}
                      {device.type === "hardware" && (
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1fr 1fr",
                            gap: "10px",
                            marginTop: "10px",
                          }}
                        >
                          <Field label={trans.connectionType}>
                            <select
                              className="form-input"
                              value={device.connectionType || "serial"}
                              onChange={(e) => {
                                const devices = [...(localSettings.devices || [])];
                                devices[idx] = {
                                  ...devices[idx],
                                  connectionType: e.target.value as "serial" | "bluetooth" | "tcp",
                                };
                                setLocalSettings((prev) => ({ ...prev, devices }));
                              }}
                            >
                              <option value="serial">{trans.serial}</option>
                              <option value="bluetooth">{trans.bluetooth}</option>
                              <option value="tcp">{trans.tcp}</option>
                            </select>
                          </Field>
                          <Field label={trans.address}>
                            <input
                              className="form-input"
                              value={device.address || ""}
                              placeholder={
                                device.connectionType === "tcp"
                                  ? "192.168.1.100:8080"
                                  : device.connectionType === "bluetooth"
                                    ? "AA:BB:CC:DD:EE:FF"
                                    : "/dev/tty.usbserial-xxx"
                              }
                              onChange={(e) => {
                                const devices = [...(localSettings.devices || [])];
                                devices[idx] = { ...devices[idx], address: e.target.value };
                                setLocalSettings((prev) => ({ ...prev, devices }));
                              }}
                            />
                          </Field>
                          {(device.connectionType === "serial" || !device.connectionType) && (
                            <Field label={trans.baudRate}>
                              <input
                                className="form-input"
                                type="number"
                                value={device.baudRate || 115200}
                                onChange={(e) => {
                                  const devices = [...(localSettings.devices || [])];
                                  devices[idx] = {
                                    ...devices[idx],
                                    baudRate: parseInt(e.target.value) || 115200,
                                  };
                                  setLocalSettings((prev) => ({ ...prev, devices }));
                                }}
                              />
                            </Field>
                          )}
                          <Field label={trans.protocol}>
                            <input
                              className="form-input"
                              value={device.protocol || ""}
                              placeholder="custom"
                              onChange={(e) => {
                                const devices = [...(localSettings.devices || [])];
                                devices[idx] = { ...devices[idx], protocol: e.target.value };
                                setLocalSettings((prev) => ({ ...prev, devices }));
                              }}
                            />
                          </Field>
                        </div>
                      )}
                    </div>
                  ))}
                </Section>
              </div>
            )}

            {activeTab === "scheduledTasks" && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "20px",
                }}
              >
                <Section title={trans.scheduledTasks}>
                  {scheduledTasks.length === 0 && (
                    <p style={{ color: "var(--text-secondary)", fontStyle: "italic" }}>
                      {trans.noScheduledTasks}
                    </p>
                  )}

                  {scheduledTasks.map((task: any) => (
                    <div
                      key={task.id}
                      style={{
                        border: "1px solid var(--border-color)",
                        borderRadius: "8px",
                        padding: "16px",
                        marginBottom: "12px",
                        backgroundColor: "var(--bg-primary)",
                        opacity: task.enabled ? 1 : 0.6,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: "8px",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ fontWeight: "bold", color: "var(--text-primary)" }}>
                            {task.type === "cron" ? "\uD83D\uDD04" : "\u23F0"} {task.name}
                          </span>
                          <span
                            style={{
                              fontSize: "0.75em",
                              padding: "2px 6px",
                              borderRadius: "4px",
                              backgroundColor: task.type === "cron" ? "var(--primary-color, #4a9eff)" : "#ff9800",
                              color: "#fff",
                            }}
                          >
                            {task.type === "cron" ? trans.cronTask : trans.onceTask}
                          </span>
                        </div>
                        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                          <label
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "4px",
                              fontSize: "0.85em",
                              color: "var(--text-secondary)",
                              cursor: "pointer",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={task.enabled}
                              onChange={async () => {
                                await window.electron?.ipcRenderer.invoke("cron:toggle", {
                                  id: task.id,
                                  enabled: !task.enabled,
                                });
                                const tasks = await window.electron?.ipcRenderer.invoke("cron:list");
                                setScheduledTasks(tasks || []);
                              }}
                            />
                            {trans.enabled}
                          </label>
                          <button
                            className="icon-btn"
                            onClick={async () => {
                              await window.electron?.ipcRenderer.invoke("cron:delete", { id: task.id });
                              const tasks = await window.electron?.ipcRenderer.invoke("cron:list");
                              setScheduledTasks(tasks || []);
                            }}
                            style={{ color: "var(--error-color, #f44336)" }}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr",
                          gap: "6px 16px",
                          fontSize: "0.85em",
                          color: "var(--text-secondary)",
                        }}
                      >
                        <div>
                          <strong>{trans.schedule}:</strong>{" "}
                          {task.cronExpression || (task.runAt ? new Date(task.runAt).toLocaleString() : "-")}
                        </div>
                        <div>
                          <strong>{trans.lastRun}:</strong>{" "}
                          {task.lastRun ? new Date(task.lastRun).toLocaleString() : trans.neverRun}
                        </div>
                        <div style={{ gridColumn: "1 / -1" }}>
                          <strong>{trans.taskDescription}:</strong>{" "}
                          <span style={{ color: "var(--text-primary)" }}>
                            {task.taskDescription.length > 100
                              ? task.taskDescription.slice(0, 100) + "..."
                              : task.taskDescription}
                          </span>
                        </div>
                        <div>
                          <strong>{trans.targetDevice}:</strong> {task.deviceId}
                        </div>
                      </div>
                    </div>
                  ))}
                </Section>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "15px 20px",
            borderTop: "1px solid var(--border-color)",
            display: "flex",
            justifyContent: "flex-end",
            gap: "10px",
            backgroundColor: "var(--bg-secondary)",
          }}
        >
          <button onClick={onClose} className="btn btn-secondary">
            {trans.cancel}
          </button>
          <button onClick={handleSave} className="btn btn-primary">
            <Save size={16} style={{ marginRight: "5px" }} />{" "}
            {trans.saveSettings}
          </button>
        </div>
      </div>
    </div>
  );
};

const SidebarItem: React.FC<{
  label: string;
  active: boolean;
  onClick: () => void;
}> = ({ label, active, onClick }) => (
  <div
    onClick={onClick}
    className={`modal-sidebar-item ${active ? "active" : ""}`}
  >
    {label}
  </div>
);

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <div className="settings-section">
    <h3 className="settings-section-title">{title}</h3>
    {children}
  </div>
);

const Field: React.FC<{
  label: string;
  children: React.ReactNode;
  fullWidth?: boolean;
}> = ({ label, children, fullWidth }) => (
  <div
    className="form-group"
    style={{ gridColumn: fullWidth ? "1 / -1" : "auto" }}
  >
    <label className="form-label">{label}</label>
    {children}
  </div>
);
