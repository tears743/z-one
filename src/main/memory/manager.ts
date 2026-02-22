import { randomUUID } from "crypto";
import { generateEmbedding, generateCompletion } from "../model/llm-service";
import * as store from "./store";
import {
  MemoryFragment,
  MemorySearchResult,
  MemorySearchOptions,
} from "./types";
import { AppSettings, ModelConfig } from "../../renderer/src/types/settings";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import { logger } from "../logger";

// Helper to get settings
let getSettings: () => AppSettings | undefined;

export function setSettingsGetter(getter: () => AppSettings | undefined) {
  getSettings = getter;
}

function resolveEmbeddingModel(settings: AppSettings): ModelConfig {
  // 1. Try activeEmbeddingModelId
  if (settings.activeEmbeddingModelId) {
    const model = settings.models.find(
      (m) => m.id === settings.activeEmbeddingModelId,
    );
    if (model) return model;
  }

  // 2. Fallback: try to find any model with "embedding" in ID or Name
  const embeddingModel = settings.models.find(
    (m) =>
      m.id.toLowerCase().includes("embedding") ||
      m.name.toLowerCase().includes("embedding"),
  );
  if (embeddingModel) return embeddingModel;

  throw new Error(
    "No embedding model configured. Please select an embedding model in settings.",
  );
}

function resolveChatModel(settings: AppSettings): ModelConfig {
  const active = settings.models.find((m) => m.id === settings.activeModelId);
  if (active) return active;
  throw new Error("No active chat model found");
}

async function appendToFile(
  filePath: string,
  content: string,
  role: string,
  layer: string,
) {
  try {
    const entry = `\n---\n**Date**: ${new Date().toISOString()}\n**Role**: ${role}\n**Layer**: ${layer}\n\n${content}\n`;
    await fs.appendFile(filePath, entry, "utf-8");
  } catch (e) {
    console.error(`Failed to append to file ${filePath}:`, e);
  }
}

export async function addMemory(
  content: string,
  layer: "execution" | "control" | "decision" | "user" | "knowledge",
  source: string = "user",
  tags: string[] = [],
  sessionId: string = "global",
): Promise<string> {
  const settings = getSettings ? getSettings() : undefined;
  if (!settings) throw new Error("Settings not available");

  const id = randomUUID();

  let embedding: number[] | undefined;

  try {
    const config = resolveEmbeddingModel(settings);
    if (config.apiKey || config.provider === "ollama") {
      embedding = await generateEmbedding(content, config);
      store.ensureVectorTable(embedding.length);
    } else {
      logger.warn(
        "[MemoryManager] Embedding model has no API key, using FTS-only mode",
      );
    }
  } catch (e) {
    logger.warn(
      "[MemoryManager] Failed to generate embedding, using FTS-only mode",
      e,
    );
  }

  const fragment: MemoryFragment = {
    id,
    content,
    layer,
    source,
    sessionId,
    timestamp: Date.now(),
    embedding,
    tags,
  };

  store.saveFragment(fragment);
  return id;
}

export async function searchMemory(
  query: string,
  options: MemorySearchOptions = {},
): Promise<MemorySearchResult[]> {
  const settings = getSettings ? getSettings() : undefined;
  if (!settings) {
    return store.searchByFts(query, options);
  }

  try {
    const config = resolveEmbeddingModel(settings);
    if (!config.apiKey || config.provider !== "ollama") {
      logger.warn(
        "[MemoryManager] Embedding model has no API key, using FTS-only search",
      );
      return store.searchByFts(query, options);
    }

    const embedding = await generateEmbedding(query, config);
    store.ensureVectorTable(embedding.length);
    return store.searchSimilar(embedding, options);
  } catch (e) {
    logger.warn(
      "[MemoryManager] Embedding search failed, falling back to FTS",
      e,
    );
    return store.searchByFts(query, options);
  }
}

// --- File Watcher & Sync (OpenClaw style) ---

const MEMORY_FILENAME = "MEMORY.md";

export async function initMemoryWatcher(workspaceDir: string) {
  const memoryPath = path.join(workspaceDir, MEMORY_FILENAME);
  logger.info(`[MemoryManager] Initializing watcher for ${memoryPath}`);

  // Ensure file exists
  try {
    await fs.access(memoryPath);
  } catch {
    await fs.writeFile(
      memoryPath,
      "# Project Memory\n\nGlobal memory for the agent. Edit this file to add persistent knowledge.\n",
    );
  }

  // Initial sync
  await syncMemoryFile(memoryPath);

  // Watch for changes
  // Using fs.watch (native) as chokidar is not strictly required if we just watch one file
  let fsWait: NodeJS.Timeout | null = null;
  fsSync.watch(memoryPath, (eventType, filename) => {
    if (filename && eventType === "change") {
      if (fsWait) return;
      // Debounce to avoid multiple events
      fsWait = setTimeout(async () => {
        fsWait = null;
        logger.info(
          `[MemoryManager] Detected change in ${filename}, syncing...`,
        );
        await syncMemoryFile(memoryPath);
      }, 500);
    }
  });
}

async function syncMemoryFile(filePath: string) {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const filename = path.basename(filePath);

    // 1. Clear existing fragments for this file
    store.deleteFragmentsBySource(filename);

    const chunks = splitMarkdownByHeaders(content);

    for (const chunk of chunks) {
      if (!chunk.content.trim()) continue;
      for (const piece of splitByLength(chunk.content)) {
        if (!piece.trim()) continue;
        await addMemory(
          piece,
          "knowledge",
          filename,
          ["memory-file"],
          "global",
        );
      }
    }
    logger.info(
      `[MemoryManager] Synced ${chunks.length} chunks from ${filename}`,
    );
  } catch (e) {
    logger.error(`[MemoryManager] Failed to sync memory file ${filePath}:`, e);
  }
}

function splitMarkdownByHeaders(
  content: string,
): { header: string; content: string }[] {
  const lines = content.split("\n");
  const chunks: { header: string; content: string }[] = [];
  let currentHeader = "Intro";
  let currentLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("#")) {
      if (currentLines.length > 0) {
        chunks.push({
          header: currentHeader,
          content: currentLines.join("\n"),
        });
      }
      currentHeader = line.replace(/^#+\s*/, "").trim();
      currentLines = [line]; // Include header in content
    } else {
      currentLines.push(line);
    }
  }
  if (currentLines.length > 0) {
    chunks.push({ header: currentHeader, content: currentLines.join("\n") });
  }
  return chunks;
}

function splitByLength(
  content: string,
  maxLength: number = 4000,
  overlap: number = 200,
): string[] {
  if (content.length <= maxLength) return [content];
  const result: string[] = [];
  let start = 0;
  while (start < content.length) {
    const end = Math.min(start + maxLength, content.length);
    result.push(content.slice(start, end));
    if (end === content.length) break;
    start = end - overlap;
    if (start < 0) start = 0;
  }
  return result;
}

export function summarizeSession(
  messages: any[],
  agentRole: string = "assistant",
): string {
  // Simple summary for now (placeholder)
  return `Session summary for ${agentRole} with ${messages.length} messages.`;
}
