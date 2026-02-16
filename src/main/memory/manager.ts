import { randomUUID } from "crypto";
import { generateEmbedding, generateCompletion } from "../model/llm-service";
import * as store from "./store";
import { MemoryFragment, MemorySearchResult } from "./types";
import { AppSettings, ModelConfig } from "../../renderer/src/types/settings";
import * as fs from "fs/promises";
import * as path from "path";

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
  layer: "execution" | "control" | "decision" | "user",
  source: string = "user",
  tags: string[] = [],
  sessionId: string = "global",
): Promise<string> {
  const settings = getSettings ? getSettings() : undefined;
  if (!settings) throw new Error("Settings not available");

  const id = randomUUID();

  // 1. File Storage (Log)
  // Note: Chat history logging is handled by FileSessionStore (called via Planner/Interaction Layer).
  // This function primarily handles Vector/RAG storage.
  // Ideally, this should also link to the file content, but for now we rely on the session ID.
  // The 'id' here is the Fragment ID for the vector index, not the Session ID.

  // 2. Vector Storage (For RAG)
  const config = resolveEmbeddingModel(settings);
  const embedding = await generateEmbedding(content, config);

  // Ensure table exists with correct dimensions
  store.ensureVectorTable(embedding.length);

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
  options: { limit?: number; layer?: string; sessionId?: string } = {},
): Promise<MemorySearchResult[]> {
  const settings = getSettings ? getSettings() : undefined;
  if (!settings) throw new Error("Settings not available");

  const limit = options.limit || 10;
  const sessionId = options.sessionId || "global";

  // 1. Vector Search
  let vectorResults: { id: string; score: number }[] = [];

  try {
    const config = resolveEmbeddingModel(settings);
    const embedding = await generateEmbedding(query, config);
    vectorResults = store.searchVector(embedding, limit * 2, sessionId);
  } catch (e: any) {
    // Log simpler error message to avoid spamming stack traces for config issues
    console.warn(`[MemoryManager] Vector search skipped: ${e.message}`);
  }

  // 2. Keyword Search (FTS)
  const keywordResults = store.searchKeyword(query, limit, sessionId);

  // 3. Merge
  const idMap = new Map<string, number>();

  for (const r of vectorResults) {
    idMap.set(r.id, r.score);
  }

  for (const r of keywordResults) {
    if (!idMap.has(r.id)) {
      idMap.set(r.id, 0.5); // Base score for keyword-only match
    } else {
      idMap.set(r.id, (idMap.get(r.id) || 0) + 0.1); // Boost
    }
  }

  const allIds = Array.from(idMap.keys());
  if (allIds.length === 0) return [];

  const fragments = store.getFragments(allIds, sessionId);

  let results: MemorySearchResult[] = fragments.map((f) => ({
    ...f,
    score: idMap.get(f.id) || 0,
  }));

  if (options.layer) {
    results = results.filter((r) => r.layer === options.layer);
  }

  results.sort((a, b) => b.score - a.score);

  return results.slice(0, limit);
}

// Summarization Logic
export async function summarizeSession(
  messages: { role: string; content: string }[],
  sessionId: string = "global",
): Promise<void> {
  const settings = getSettings ? getSettings() : undefined;
  if (!settings) throw new Error("Settings not available");

  const config = resolveChatModel(settings);

  if (messages.length === 0) return;

  // 1. Construct Prompt
  const transcript = messages
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n");

  const prompt = `
You are a helpful assistant that summarizes conversation history.
Also provide a short 3-5 word title for this session.

Structure the summary into three layers:
1. **Decision Layer**: Strategic choices, goals, and high-level directives.
2. **Control Layer**: Plans, rules, and constraints established.
3. **Execution Layer**: Specific actions taken, code changes, and technical details.

Transcript:
${transcript}

Output JSON format:
{
  "title": "...",
  "decision": "...",
  "control": "...",
  "execution": "..."
}
`;

  // 2. Call LLM
  try {
    const content = await generateCompletion(
      [{ role: "user", content: prompt }],
      config,
      true, // jsonMode
    );
    if (!content) return;

    let summary;
    try {
      summary = JSON.parse(content);
    } catch (e) {
      console.error("Failed to parse summary JSON", e);
      return;
    }

    // 3. Store in separate layers (Vector DB)
    if (summary.decision) {
      await addMemory(summary.decision, "decision", "session_summary", [
        "summary",
        sessionId,
      ]);
    }
    if (summary.control) {
      await addMemory(summary.control, "control", "session_summary", [
        "summary",
        sessionId,
      ]);
    }
    if (summary.execution) {
      await addMemory(summary.execution, "execution", "session_summary", [
        "summary",
        sessionId,
      ]);
    }
  } catch (e) {
    console.error("Summarization failed:", e);
  }
}
