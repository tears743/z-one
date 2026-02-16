import React, { useState, useEffect } from "react";
import { X, Plus, Trash2, Save, Check } from "lucide-react";
import {
  AppSettings,
  ModelConfig,
  ModelProvider,
  DEFAULT_MODELS,
} from "../types/settings";
import { t, translations } from "../utils/translations";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onSave: (newSettings: AppSettings) => void;
  trans: typeof translations.en;
}

const LOCKED_PROVIDER: ModelProvider = "openai";

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onSave,
}) => {
  const [activeTab, setActiveTab] = useState<"general" | "models">("general");
  const [localSettings, setLocalSettings] = useState<AppSettings>(settings);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const trans = t(localSettings.general.language);

  // Reset local state when opening
  useEffect(() => {
    if (isOpen) {
      setLocalSettings({
        ...settings,
        models: settings.models.map((m) => ({
          ...m,
          provider: LOCKED_PROVIDER,
        })),
      });
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
      models: localSettings.models.map((m) => ({
        ...m,
        provider: LOCKED_PROVIDER,
      })),
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
      models: prev.models.map((m) =>
        m.id === id ? { ...m, ...updates, provider: LOCKED_PROVIDER } : m,
      ),
    }));
  };

  const addModel = () => {
    const newModel: ModelConfig = {
      id: crypto.randomUUID(),
      provider: LOCKED_PROVIDER,
      name: "New Model",
      modelId: "",
      enabled: true,
      isCustom: true,
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
              label={trans.models}
              active={activeTab === "models"}
              onClick={() => setActiveTab("models")}
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
                            <input
                              value={LOCKED_PROVIDER}
                              disabled
                              className="form-input"
                              style={{
                                opacity: 0.8,
                                cursor: "not-allowed",
                              }}
                            />
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
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
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
