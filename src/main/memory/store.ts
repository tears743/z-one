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

  // 2. Vector storage (sqlite-vec)
  // Table creation is deferred until we know the dimensions

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

    db.exec(`
            CREATE VIRTUAL TABLE vec_fragments USING vec0(
              id TEXT PRIMARY KEY,
              embedding float[${dimensions}]
            );
        `);
    console.log(
      `[MemoryStore] Created vector table with ${dimensions} dimensions`,
    );
  } catch (e) {
    console.error("[MemoryStore] Failed to ensure vector table:", e);
    throw e;
  }
}

export function saveFragment(fragment: MemoryFragment) {
  if (!db) throw new Error("DB not initialized");

  const transaction = db.transaction(() => {
    // 1. Insert into fragments
    const insertFrag = db!.prepare(`
      INSERT OR REPLACE INTO fragments (id, content, layer, source, session_id, timestamp, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertFrag.run(
      fragment.id,
      fragment.content,
      fragment.layer,
      fragment.source,
      fragment.sessionId,
      fragment.timestamp,
      JSON.stringify(fragment.tags || []),
    );

    // 2. Insert into vec_fragments
    if (fragment.embedding && fragment.embedding.length > 0) {
      // Ensure table exists (this might be slow if called every time, but safe)
      // Ideally caller ensures it, but we can double check or catch error
      // For performance, we assume caller called ensureVectorTable or we check cache.
      // We'll rely on the caller (manager) to ensure dimensions match.

      const insertVec = db!.prepare(`
        INSERT OR REPLACE INTO vec_fragments (id, embedding)
        VALUES (?, ?)
      `);
      insertVec.run(fragment.id, new Float32Array(fragment.embedding));
    }

    // 3. Insert into fts_fragments
    const insertFts = db!.prepare(`
      INSERT INTO fts_fragments (rowid, content)
      SELECT rowid, content FROM fragments WHERE id = ?
    `);
    // Delete old FTS entry if exists? FTS5 manages updates?
    // FTS external content table is better, but here we use separate table.
    // We should delete old entry first to avoid duplicates if ID exists.
    // Or we use 'delete' command.

    // Simplest for now: DELETE matches content? No.
    // FTS doesn't have ID as primary key in this schema.
    // Refined FTS Schema: content, id UNINDEXED.
    // We should Delete where id matches.
    db!.prepare("DELETE FROM fts_fragments WHERE id = ?").run(fragment.id);

    db!
      .prepare(
        `
      INSERT INTO fts_fragments (content, id)
      VALUES (?, ?)
    `,
      )
      .run(fragment.content, fragment.id);
  });

  transaction();
}

export function searchVector(
  embedding: number[],
  limit: number = 10,
  sessionId: string = "global",
): { id: string; score: number }[] {
  if (!db) throw new Error("DB not initialized");

  // Check if vec_fragments exists
  const tableExists = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='vec_fragments'",
    )
    .get();
  if (!tableExists) return [];

  let results: { id: string; distance: number }[] = [];
  try {
    const stmt = db.prepare(`
      SELECT
        v.id,
        v.distance
      FROM vec_fragments v
      JOIN fragments f ON f.id = v.id
      WHERE f.session_id = ? AND v.embedding MATCH ?
      ORDER BY v.distance
      LIMIT ?
    `);
    results = stmt.all(sessionId, new Float32Array(embedding), limit) as {
      id: string;
      distance: number;
    }[];
  } catch {
    const stmt = db.prepare(`
      SELECT
        id,
        distance
      FROM vec_fragments
      WHERE embedding MATCH ?
      ORDER BY distance
      LIMIT ?
    `);
    results = stmt.all(new Float32Array(embedding), limit * 8) as {
      id: string;
      distance: number;
    }[];
  }

  return results.map((r) => ({
    id: r.id,
    score: 1 / (1 + r.distance), // Convert distance to similarity score
  }));
}

export function searchKeyword(
  query: string,
  limit: number = 10,
  sessionId: string = "global",
): { id: string }[] {
  if (!db) throw new Error("DB not initialized");

  // Sanitize query for FTS5
  // Replace FTS5 reserved characters with spaces to prevent syntax errors
  // Reserved: " * + - ^ : ( ) { } [ ] AND OR NOT
  const safeQuery = query.replace(/["*+\-^:(){}\[\]]/g, " ").trim();
  
  // If query becomes empty or just boolean operators, handle gracefully
  if (!safeQuery) return [];

  // Simple tokenization: treat as AND query by default if multiple words?
  // FTS5 default is AND. "foo bar" matches documents with foo AND bar.
  
  const stmt = db.prepare(`
    SELECT t.id
    FROM fts_fragments t
    JOIN fragments f ON f.id = t.id
    WHERE t.content MATCH ? AND f.session_id = ?
    ORDER BY t.rank
    LIMIT ?
  `);

  try {
    const results = stmt.all(safeQuery, sessionId, limit) as { id: string }[];
    return results;
  } catch (e) {
    // FTS syntax error (e.g. empty query or special chars)
    console.warn("FTS search error:", e);
    return [];
  }
}

export function getFragments(
  ids: string[],
  sessionId: string = "global",
): MemoryFragment[] {
  if (!db) throw new Error("DB not initialized");
  if (ids.length === 0) return [];

  const placeholders = ids.map(() => "?").join(",");
  const stmt = db.prepare(`
    SELECT * FROM fragments WHERE id IN (${placeholders}) AND session_id = ?
  `);

  const rows = stmt.all(...ids, sessionId) as any[];

  return rows.map((row) => ({
    id: row.id,
    content: row.content,
    layer: row.layer as any,
    source: row.source,
    sessionId: row.session_id,
    timestamp: row.timestamp,
    tags: JSON.parse(row.tags || "[]"),
  }));
}
