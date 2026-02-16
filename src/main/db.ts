import Database from "better-sqlite3";
import {
  AppSettings,
  DEFAULT_SETTINGS,
  ModelConfig,
} from "../renderer/src/types/settings";

let db: Database.Database;

export function initDB(path: string) {
  db = new Database(path);

  // Create generic settings table (key-value store)
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  // Create models table
  db.exec(`
    CREATE TABLE IF NOT EXISTS models (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      name TEXT NOT NULL,
      api_key TEXT,
      base_url TEXT,
      model_id TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      is_custom INTEGER DEFAULT 0,
      model_type TEXT DEFAULT 'llm',
      temperature REAL,
      max_tokens INTEGER,
      stream INTEGER DEFAULT 0,
      enable_thinking INTEGER DEFAULT 0
    )
  `);

  // Create devices table
  db.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      device_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      last_connected INTEGER
    )
  `);

  // Migration: Add model_type column if missing
  try {
    const columns = db.prepare("PRAGMA table_info(models)").all() as any[];

    // Migration 1: model_type
    if (!columns.some((c) => c.name === "model_type")) {
      console.log("Migrating models table: Adding model_type column...");
      db.prepare(
        "ALTER TABLE models ADD COLUMN model_type TEXT DEFAULT 'llm'",
      ).run();
      // ... (Update defaults logic)
      db.prepare(
        "UPDATE models SET model_type = 'multimodal' WHERE id IN ('openai-gpt-4o', 'anthropic-claude-3-5-sonnet', 'gemini-1-5-pro')",
      ).run();
      db.prepare(
        "UPDATE models SET model_type = 'embedding' WHERE id IN ('openai-text-embedding-3-small')",
      ).run();
    }

    // Migration 2: Advanced parameters
    if (!columns.some((c) => c.name === "temperature")) {
      console.log("Migrating models table: Adding advanced parameters...");
      db.prepare("ALTER TABLE models ADD COLUMN temperature REAL").run();
      db.prepare("ALTER TABLE models ADD COLUMN max_tokens INTEGER").run();
      db.prepare(
        "ALTER TABLE models ADD COLUMN stream INTEGER DEFAULT 0",
      ).run();
      db.prepare(
        "ALTER TABLE models ADD COLUMN enable_thinking INTEGER DEFAULT 0",
      ).run();
    }
  } catch (e) {
    console.error("Migration failed:", e);
  }

  // Check for legacy kv_store and migrate if needed
  const legacyTableExists = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='kv_store'",
    )
    .get();
  if (legacyTableExists) {
    try {
      const row = db
        .prepare("SELECT value FROM kv_store WHERE key = 'z-one-settings'")
        .get() as { value: string } | undefined;
      if (row) {
        const oldSettings = JSON.parse(row.value);
        console.log("Migrating legacy settings...");
        saveAppSettings(oldSettings);
        db.prepare("DROP TABLE kv_store").run();
        console.log("Migration complete.");
      }
    } catch (e) {
      console.error("Migration failed:", e);
    }
  }
}

// === Generic Settings API ===

export function getAppSettings(): AppSettings {
  if (!db) throw new Error("DB not initialized");

  // Load General Settings
  const getSetting = (key: string, defaultVal: any) => {
    const row = db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : defaultVal;
  };

  const general = {
    theme: getSetting("general_theme", DEFAULT_SETTINGS.general.theme),
    primaryColor: getSetting(
      "general_primaryColor",
      DEFAULT_SETTINGS.general.primaryColor,
    ),
    language: getSetting("general_language", DEFAULT_SETTINGS.general.language),
    agentWorkspace: getSetting("general_agentWorkspace", undefined),
  };

  const activeModelId = getSetting(
    "active_model_id",
    DEFAULT_SETTINGS.activeModelId,
  );

  const activeEmbeddingModelId = getSetting(
    "active_embedding_model_id",
    DEFAULT_SETTINGS.activeEmbeddingModelId,
  );

  // Load Models
  const models = getModels();

  // Use default models if DB is empty (first run)
  const finalModels = models.length > 0 ? models : DEFAULT_SETTINGS.models;

  return {
    general: general as AppSettings["general"],
    models: finalModels,
    activeModelId,
    activeEmbeddingModelId,
  };
}

export function saveAppSettings(settings: AppSettings) {
  if (!db) throw new Error("DB not initialized");

  const insertSetting = db.prepare(
    "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
  );

  const transaction = db.transaction(() => {
    // Save General Settings
    insertSetting.run("general_theme", JSON.stringify(settings.general.theme));
    insertSetting.run(
      "general_primaryColor",
      JSON.stringify(settings.general.primaryColor),
    );
    insertSetting.run(
      "general_language",
      JSON.stringify(settings.general.language),
    );
    insertSetting.run(
      "general_agentWorkspace",
      JSON.stringify(settings.general.agentWorkspace),
    );
    insertSetting.run(
      "active_model_id",
      JSON.stringify(settings.activeModelId),
    );
    insertSetting.run(
      "active_embedding_model_id",
      JSON.stringify(settings.activeEmbeddingModelId),
    );

    // Sync Models (Smart Sync)
    // 1. Get existing IDs
    const existingIds = db
      .prepare("SELECT id FROM models")
      .all()
      .map((row: any) => row.id);
    const newIds = settings.models.map((m) => m.id);

    // 2. Delete models that are no longer present
    const idsToDelete = existingIds.filter((id) => !newIds.includes(id));
    if (idsToDelete.length > 0) {
      const deleteStmt = db.prepare("DELETE FROM models WHERE id = ?");
      idsToDelete.forEach((id) => deleteStmt.run(id));
    }

    // 3. Upsert current models
    const upsertModel = db.prepare(`
      INSERT INTO models (id, provider, name, api_key, base_url, model_id, enabled, is_custom, model_type, temperature, max_tokens, stream, enable_thinking)
      VALUES (@id, @provider, @name, @apiKey, @baseUrl, @modelId, @enabled, @isCustom, @modelType, @temperature, @maxTokens, @stream, @enableThinking)
      ON CONFLICT(id) DO UPDATE SET
        provider=excluded.provider,
        name=excluded.name,
        api_key=excluded.api_key,
        base_url=excluded.base_url,
        model_id=excluded.model_id,
        enabled=excluded.enabled,
        is_custom=excluded.is_custom,
        model_type=excluded.model_type,
        temperature=excluded.temperature,
        max_tokens=excluded.max_tokens,
        stream=excluded.stream,
        enable_thinking=excluded.enable_thinking
    `);

    for (const model of settings.models) {
      upsertModel.run({
        id: model.id,
        provider: model.provider,
        name: model.name,
        apiKey: model.apiKey || null,
        baseUrl: model.baseUrl || null,
        modelId: model.modelId,
        enabled: model.enabled ? 1 : 0,
        isCustom: model.isCustom ? 1 : 0,
        modelType: model.modelType || "llm",
        temperature: model.temperature,
        maxTokens: model.maxTokens,
        stream: model.stream ? 1 : 0,
        enableThinking: model.enableThinking ? 1 : 0,
      });
    }
  });

  transaction();
}

// === Dedicated Models API ===

export function getModels(): ModelConfig[] {
  if (!db) throw new Error("DB not initialized");

  const modelsRows = db.prepare("SELECT * FROM models").all() as any[];

  return modelsRows.map((row) => ({
    id: row.id,
    provider: row.provider,
    name: row.name,
    apiKey: row.api_key || undefined,
    baseUrl: row.base_url || undefined,
    modelId: row.model_id,
    enabled: Boolean(row.enabled),
    isCustom: Boolean(row.is_custom),
    modelType: row.model_type || "llm",
    temperature: row.temperature || undefined,
    maxTokens: row.max_tokens || undefined,
    stream: Boolean(row.stream),
    enableThinking: Boolean(row.enable_thinking),
  }));
}

export function saveModel(model: ModelConfig) {
  if (!db) throw new Error("DB not initialized");

  const stmt = db.prepare(`
    INSERT INTO models (id, provider, name, api_key, base_url, model_id, enabled, is_custom, model_type, temperature, max_tokens, stream, enable_thinking)
    VALUES (@id, @provider, @name, @apiKey, @baseUrl, @modelId, @enabled, @isCustom, @modelType, @temperature, @maxTokens, @stream, @enableThinking)
    ON CONFLICT(id) DO UPDATE SET
      provider=excluded.provider,
      name=excluded.name,
      api_key=excluded.api_key,
      base_url=excluded.base_url,
      model_id=excluded.model_id,
      enabled=excluded.enabled,
      is_custom=excluded.is_custom,
      model_type=excluded.model_type,
      temperature=excluded.temperature,
      max_tokens=excluded.max_tokens,
      stream=excluded.stream,
      enable_thinking=excluded.enable_thinking
  `);

  stmt.run({
    id: model.id,
    provider: model.provider,
    name: model.name,
    apiKey: model.apiKey || null,
    baseUrl: model.baseUrl || null,
    modelId: model.modelId,
    enabled: model.enabled ? 1 : 0,
    isCustom: model.isCustom ? 1 : 0,
    modelType: model.modelType || "llm",
    temperature: model.temperature,
    maxTokens: model.maxTokens,
    stream: model.stream ? 1 : 0,
    enableThinking: model.enableThinking ? 1 : 0,
  });
}

export function deleteModel(id: string) {
  if (!db) throw new Error("DB not initialized");
  db.prepare("DELETE FROM models WHERE id = ?").run(id);
}

// === Devices API ===

export interface DeviceConfig {
  deviceId: string;
  name: string;
  type: "internal" | "external";
  status: "pending" | "active" | "rejected" | "blocked";
  lastConnected: number;
}

export function getDevice(deviceId: string): DeviceConfig | undefined {
  if (!db) throw new Error("DB not initialized");
  const row = db
    .prepare("SELECT * FROM devices WHERE device_id = ?")
    .get(deviceId) as any;
  if (!row) return undefined;
  return {
    deviceId: row.device_id,
    name: row.name,
    type: row.type as any,
    status: row.status as any,
    lastConnected: row.last_connected,
  };
}

export function saveDevice(device: DeviceConfig) {
  if (!db) throw new Error("DB not initialized");
  const stmt = db.prepare(`
    INSERT INTO devices (device_id, name, type, status, last_connected)
    VALUES (@deviceId, @name, @type, @status, @lastConnected)
    ON CONFLICT(device_id) DO UPDATE SET
      name=excluded.name,
      type=excluded.type,
      status=excluded.status,
      last_connected=excluded.last_connected
  `);
  stmt.run({
    deviceId: device.deviceId,
    name: device.name,
    type: device.type,
    status: device.status,
    lastConnected: device.lastConnected,
  });
}

export function getDevices(): DeviceConfig[] {
  if (!db) throw new Error("DB not initialized");
  const rows = db.prepare("SELECT * FROM devices").all() as any[];
  return rows.map((row) => ({
    deviceId: row.device_id,
    name: row.name,
    type: row.type as any,
    status: row.status as any,
    lastConnected: row.last_connected,
  }));
}
