import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { app } from "electron";
import path from "path";
import fs from "fs";
import {
  MemoryFragment,
  MemorySearchOptions,
  MemorySearchResult,
} from "./types";

let db: Database.Database | null = null;

const DB_PATH = path.join(app.getPath("userData"), "z-one-memory.sqlite");

export function initMemoryStore() {
  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(DB_PATH);

  // Enable extensions
  db.exec("PRAGMA foreign_keys = ON;");

  try {
    sqliteVec.load(db);
    console.log("[MemoryStore] sqlite-vec extension loaded successfully");
  } catch (err) {
    console.error("[MemoryStore] Failed to load sqlite-vec extension:", err);
  }

  // Create Tables

  // 1. Main storage (Source of Truth for metadata)
  db.exec(`
    CREATE TABLE IF NOT EXISTS fragments (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      layer TEXT NOT NULL,
      source TEXT NOT NULL,
      session_id TEXT NOT NULL DEFAULT 'global',
      timestamp INTEGER NOT NULL,
      tags TEXT -- JSON array
    );
  `);

  ensureFragmentsSchema();
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_fragments_session_ts ON fragments(session_id, timestamp);",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_fragments_source ON fragments(source);",
  );

  // 2. Vector storage (sqlite-vec)
  // Table creation is deferred until we know the dimensions in ensureVectorTable

  // 3. FTS storage (Keyword Search)
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS fts_fragments USING fts5(
      content,
      id UNINDEXED
    );
  `);

  console.log("[MemoryStore] Tables initialized");
}

function ensureFragmentsSchema() {
  if (!db) throw new Error("DB not initialized");
  const cols = db.prepare("PRAGMA table_info(fragments)").all() as Array<{
    name: string;
  }>;
  const hasSessionId = cols.some((c) => c.name === "session_id");
  if (!hasSessionId) {
    db.exec(
      "ALTER TABLE fragments ADD COLUMN session_id TEXT NOT NULL DEFAULT 'global';",
    );
  }
}

export function ensureVectorTable(dimensions: number) {
  if (!db) throw new Error("DB not initialized");

  // Check if table exists and has correct dimensions
  try {
    const result = db
      .prepare(`SELECT sql FROM sqlite_master WHERE name='vec_fragments'`)
      .get() as { sql: string } | undefined;
    if (result) {
      // Check dimensions in SQL (e.g., "float[1536]")
      const match = result.sql.match(/float\[(\d+)\]/);
      if (match && parseInt(match[1]) === dimensions) {
        return; // Correct dimensions
      }
      console.warn(
        `[MemoryStore] Vector dimensions changed (old: ${match?.[1]}, new: ${dimensions}). Recreating table.`,
      );
      db.exec("DROP TABLE vec_fragments");
    }
  } catch (e) {
    // Table might not exist, ignore
  }

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_fragments USING vec0(
      id TEXT PRIMARY KEY,
      embedding float[${dimensions}]
    );
  `);
}

export function saveFragment(fragment: MemoryFragment) {
  if (!db) throw new Error("DB not initialized");

  const insertFragment = db.prepare(`
    INSERT OR REPLACE INTO fragments (id, content, layer, source, session_id, timestamp, tags)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertVector = db.prepare(`
    INSERT OR REPLACE INTO vec_fragments (id, embedding)
    VALUES (?, ?)
  `);

  const insertFTS = db.prepare(`
    INSERT INTO fts_fragments (content, id)
    VALUES (?, ?)
  `);

  const transaction = db.transaction(() => {
    insertFragment.run(
      fragment.id,
      fragment.content,
      fragment.layer,
      fragment.source,
      fragment.sessionId || "global",
      fragment.timestamp,
      JSON.stringify(fragment.tags),
    );

    // Update Vector
    if (fragment.embedding) {
      // Ensure vector table exists (it should, handled by addMemory -> ensureVectorTable)
      insertVector.run(
        fragment.id,
        Buffer.from(new Float32Array(fragment.embedding).buffer),
      );
    }

    // Update FTS (keyword index, independent of main rowid)
    insertFTS.run(fragment.content, fragment.id);
  });

  transaction();
}

export function deleteFragmentsBySource(source: string) {
  if (!db) throw new Error("DB not initialized");

  // 1. Get IDs to delete
  const ids = db
    .prepare("SELECT id FROM fragments WHERE source = ?")
    .all(source) as { id: string }[];
  if (ids.length === 0) return;

  const deleteFragment = db.prepare("DELETE FROM fragments WHERE id = ?");
  const deleteVector = db.prepare("DELETE FROM vec_fragments WHERE id = ?");

  // FTS delete is harder without rowid mapping, skipping for now as it's just keyword search index.

  const transaction = db.transaction(() => {
    for (const { id } of ids) {
      deleteFragment.run(id);
      try {
        deleteVector.run(id);
      } catch (e) {
        // Vector table might not exist or ID not in it
      }
    }
  });

  transaction();
  console.log(
    `[MemoryStore] Deleted ${ids.length} fragments from source: ${source}`,
  );
}

export function searchSimilar(
  embedding: number[],
  options: MemorySearchOptions = {},
): MemorySearchResult[] {
  if (!db) throw new Error("DB not initialized");

  const limit = options.limit || 5;

  // Vector Search using sqlite-vec
  const query = `
    SELECT
      v.id,
      v.distance
    FROM vec_fragments v
    WHERE v.embedding MATCH ?
    AND k = ?
    ORDER BY v.distance
  `;

  try {
    const vectorResults = db
      .prepare(query)
      .all(Buffer.from(new Float32Array(embedding).buffer), limit) as Array<{
      id: string;
      distance: number;
    }>;

    // Hydrate with content
    const results: MemorySearchResult[] = [];
    const getFragment = db.prepare("SELECT * FROM fragments WHERE id = ?");

    for (const vec of vectorResults) {
      const fragment = getFragment.get(vec.id) as any;
      if (fragment) {
        if (options.layer && fragment.layer !== options.layer) continue;
        if (options.sessionId && fragment.sessionId !== options.sessionId)
          continue;

        results.push({
          id: fragment.id,
          content: fragment.content,
          layer: fragment.layer,
          source: fragment.source,
          sessionId: fragment.session_id,
          timestamp: fragment.timestamp,
          tags: JSON.parse(fragment.tags || "[]"),
          score: 1 - vec.distance, // Convert distance to similarity score
        });
      }
    }

    return results;
  } catch (e) {
    console.error("[MemoryStore] Vector search failed:", e);
    return [];
  }
}

export function searchByFts(
  query: string,
  options: MemorySearchOptions = {},
): MemorySearchResult[] {
  if (!db) throw new Error("DB not initialized");

  const limit = options.limit || 5;

  const sql = `
    SELECT
      f.id,
      f.content,
      f.layer,
      f.source,
      f.session_id as session_id,
      f.timestamp,
      f.tags,
      bm25(fts_fragments) as rank
    FROM fts_fragments
    JOIN fragments f ON fts_fragments.id = f.id
    WHERE fts_fragments MATCH ?
    ORDER BY rank
    LIMIT ?
  `;

  try {
    const rows = db.prepare(sql).all(query, limit) as Array<{
      id: string;
      content: string;
      layer: MemoryFragment["layer"];
      source: string;
      session_id: string;
      timestamp: number;
      tags: string | null;
      rank: number;
    }>;

    const results: MemorySearchResult[] = [];

    for (const row of rows) {
      if (options.layer && row.layer !== options.layer) continue;
      if (options.sessionId && row.session_id !== options.sessionId) continue;

      results.push({
        id: row.id,
        content: row.content,
        layer: row.layer,
        source: row.source,
        sessionId: row.session_id,
        timestamp: row.timestamp,
        tags: JSON.parse(row.tags || "[]"),
        score: row.rank != null ? -row.rank : 1,
      });
    }

    return results;
  } catch (e) {
    console.error("[MemoryStore] FTS search failed:", e);
    return [];
  }
}
