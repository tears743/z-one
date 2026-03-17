export type ModelProvider =
  | "openai"
  | "anthropic"
  | "gemini"
  | "deepseek"
  | "minimax"
  | "qwen"
  | "ollama"
  | "lm_studio";

export interface ModelConfig {
  id: string; // Unique ID for this config entry
  provider: ModelProvider;
  name: string; // Display name (e.g. "My GPT-4")
  apiKey?: string;
  baseUrl?: string;
  modelId: string; // The actual model string (e.g. "gpt-4o")
  enabled: boolean;
  isCustom?: boolean; // If true, user manually added this
  modelType: "llm" | "embedding" | "multimodal";
  // Advanced Parameters
  temperature?: number;
  maxTokens?: number;
  inputMaxTokens?: number; // Max input context tokens before compression
  stream?: boolean;
  enableThinking?: boolean; // For reasoning models
}

export type DeviceType = "lark" | "hardware";

export interface DeviceConfig {
  id: string;
  type: DeviceType;
  name: string; // Display name, e.g. "我的飞书机器人"
  enabled: boolean;
  // Lark specific
  appId?: string;
  appSecret?: string;
  // Hardware specific
  connectionType?: "serial" | "bluetooth" | "tcp";
  address?: string; // COM port / BLE address / IP:port
  baudRate?: number; // Serial baud rate
  protocol?: string; // Custom protocol identifier
}

export interface AppSettings {
  general: {
    theme: "light" | "dark" | "system";
    primaryColor: string; // For skin/theme color
    language: "en" | "zh";
    agentWorkspace?: string;
  };
  models: ModelConfig[];
  devices: DeviceConfig[];
  activeModelId: string; // ID of the currently selected ModelConfig (LLM/Multimodal)
  activeEmbeddingModelId?: string; // ID of the currently selected Embedding Model
  agentModelId?: string; // ID of the selected Agent model
}

export const DEFAULT_MODELS: ModelConfig[] = [
  {
    id: "openai-gpt-4o",
    provider: "openai",
    name: "OpenAI GPT-4o",
    modelId: "gpt-4o",
    enabled: true,
    modelType: "multimodal",
  },
  {
    id: "openai-text-embedding-3-small",
    provider: "openai",
    name: "OpenAI Embedding (Small)",
    modelId: "text-embedding-3-small",
    enabled: true,
    modelType: "embedding",
  },
  {
    id: "anthropic-claude-3-5-sonnet",
    provider: "anthropic",
    name: "Claude 3.5 Sonnet",
    modelId: "claude-3-5-sonnet-20240620",
    enabled: true,
    modelType: "multimodal",
  },
  {
    id: "gemini-1-5-pro",
    provider: "gemini",
    name: "Gemini 1.5 Pro",
    modelId: "gemini-1.5-pro",
    enabled: true,
    modelType: "multimodal",
  },
  {
    id: "deepseek-chat",
    provider: "deepseek",
    name: "DeepSeek Chat",
    modelId: "deepseek-chat",
    enabled: true,
    modelType: "llm",
  },
  {
    id: "ollama-llama3",
    provider: "ollama",
    name: "Ollama Llama3",
    baseUrl: "http://localhost:11434",
    modelId: "llama3",
    enabled: true,
    modelType: "llm",
  },
];

export const DEFAULT_SETTINGS: AppSettings = {
  general: {
    theme: "dark",
    primaryColor: "#0e639c",
    language: "zh",
  },
  models: DEFAULT_MODELS,
  devices: [],
  activeModelId: "openai-gpt-4o",
  activeEmbeddingModelId: "openai-text-embedding-3-small",
  agentModelId: "openai-gpt-4o",
};
