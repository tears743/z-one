/**
 * SkillHealthTracker — tracks skill usage statistics, calculates failure rates,
 * and automatically retires skills that exceed failure thresholds.
 *
 * Rules (after MIN_CALLS threshold):
 * - failureRate > 10% → status = "warned"
 * - failureRate > 20% → status = "retired" (auto-disabled)
 * - Users can manually re-enable retired skills
 *
 * Storage: uses DB tables (skill_health) for persistence.
 */

import { SkillHealth, SkillStatus } from "./types";
import { logger } from "../logger";

// In-memory cache of skill health data
const healthCache: Map<string, SkillHealth> = new Map();

// Thresholds
const MIN_CALLS = 5;
const WARN_THRESHOLD = 0.10;  // 10%
const RETIRE_THRESHOLD = 0.20; // 20%

// DB reference (set via init)
let db: any = null;

/**
 * Initialize the health tracker with a DB reference.
 * Creates the skill_health table if it doesn't exist.
 */
export function initHealthTracker(database: any) {
  db = database;

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS skill_health (
        name TEXT PRIMARY KEY,
        total_calls INTEGER DEFAULT 0,
        failed_calls INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active',
        last_used INTEGER DEFAULT 0
      )
    `);

    // Also create skill_status table for manual enable/disable
    db.exec(`
      CREATE TABLE IF NOT EXISTS skill_status (
        name TEXT PRIMARY KEY,
        enabled INTEGER DEFAULT 1,
        status TEXT DEFAULT 'active'
      )
    `);

    // Load from DB into cache
    const rows = db.prepare("SELECT * FROM skill_health").all() as any[];
    for (const row of rows) {
      healthCache.set(row.name, {
        name: row.name,
        totalCalls: row.total_calls,
        failedCalls: row.failed_calls,
        failureRate: row.total_calls > 0 ? row.failed_calls / row.total_calls : 0,
        status: row.status as SkillStatus,
        lastUsed: row.last_used,
      });
    }

    logger.info(`[HealthTracker] Initialized with ${healthCache.size} skill records`);
  } catch (e: any) {
    logger.error(`[HealthTracker] Failed to initialize: ${e.message}`);
  }
}

/**
 * Record a skill invocation result.
 */
export function recordSkillCall(name: string, success: boolean): SkillHealth {
  let health = healthCache.get(name);

  if (!health) {
    health = {
      name,
      totalCalls: 0,
      failedCalls: 0,
      failureRate: 0,
      status: "active",
      lastUsed: Date.now(),
    };
  }

  health.totalCalls++;
  if (!success) health.failedCalls++;
  health.lastUsed = Date.now();
  health.failureRate = health.totalCalls > 0 ? health.failedCalls / health.totalCalls : 0;

  // Apply auto-retirement rules after minimum calls
  if (health.totalCalls >= MIN_CALLS) {
    if (health.failureRate > RETIRE_THRESHOLD && health.status !== "disabled") {
      health.status = "retired";
      logger.warn(`[HealthTracker] Skill "${name}" auto-retired: failure rate ${(health.failureRate * 100).toFixed(1)}%`);
    } else if (health.failureRate > WARN_THRESHOLD && health.status === "active") {
      health.status = "warned";
      logger.warn(`[HealthTracker] Skill "${name}" warned: failure rate ${(health.failureRate * 100).toFixed(1)}%`);
    }
  }

  healthCache.set(name, health);
  persistHealth(health);

  return health;
}

/**
 * Get health status for a skill. Returns undefined if no data.
 */
export function getSkillHealth(name: string): SkillHealth | undefined {
  return healthCache.get(name);
}

/**
 * Get the combined status for a skill (considering both health and manual status).
 */
export function getSkillStatus(name: string): { status: SkillStatus } | undefined {
  // Check manual status first (from skill_status table)
  if (db) {
    try {
      const row = db.prepare("SELECT * FROM skill_status WHERE name = ?").get(name) as any;
      if (row) {
        if (!row.enabled) return { status: "disabled" };
        if (row.status && row.status !== "active") return { status: row.status as SkillStatus };
      }
    } catch {}
  }

  // Then check health status
  const health = healthCache.get(name);
  if (health && health.status !== "active") {
    return { status: health.status };
  }

  return undefined;
}

/**
 * Manually set a skill's status (enable/disable).
 */
export function setSkillEnabled(name: string, enabled: boolean) {
  if (!db) return;

  const status = enabled ? "active" : "disabled";

  try {
    db.prepare(`
      INSERT INTO skill_status (name, enabled, status)
      VALUES (?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET enabled=excluded.enabled, status=excluded.status
    `).run(name, enabled ? 1 : 0, status);

    // Update health cache too
    const health = healthCache.get(name);
    if (health) {
      health.status = enabled ? "active" : "disabled";
    }

    logger.info(`[HealthTracker] Skill "${name}" ${enabled ? "enabled" : "disabled"}`);
  } catch (e: any) {
    logger.error(`[HealthTracker] Failed to set skill status: ${e.message}`);
  }
}

/**
 * Delete all tracking data for a skill.
 */
export function deleteSkillData(name: string) {
  healthCache.delete(name);
  if (!db) return;

  try {
    db.prepare("DELETE FROM skill_health WHERE name = ?").run(name);
    db.prepare("DELETE FROM skill_status WHERE name = ?").run(name);
    logger.info(`[HealthTracker] Deleted tracking data for skill "${name}"`);
  } catch (e: any) {
    logger.error(`[HealthTracker] Failed to delete skill data: ${e.message}`);
  }
}

/**
 * Get all health records (for Settings UI).
 */
export function getAllSkillHealth(): SkillHealth[] {
  return Array.from(healthCache.values());
}

/**
 * Persist health data to DB.
 */
function persistHealth(health: SkillHealth) {
  if (!db) return;

  try {
    db.prepare(`
      INSERT INTO skill_health (name, total_calls, failed_calls, status, last_used)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        total_calls=excluded.total_calls,
        failed_calls=excluded.failed_calls,
        status=excluded.status,
        last_used=excluded.last_used
    `).run(health.name, health.totalCalls, health.failedCalls, health.status, health.lastUsed);
  } catch (e: any) {
    logger.error(`[HealthTracker] Failed to persist health data: ${e.message}`);
  }
}
