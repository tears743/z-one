/**
 * Types for the OpenClaw/ClawHub Skills system.
 */

/** Status of an installed skill */
export type SkillStatus = "active" | "warned" | "retired" | "disabled";

/** A skill entry loaded from workspace/skills/ */
export interface SkillEntry {
  /** Unique skill name (directory name) */
  name: string;
  /** Human-readable description from SKILL.md frontmatter */
  description: string;
  /** Full content of SKILL.md (instructions for the LLM) */
  content: string;
  /** Directory path on disk */
  dirPath: string;
  /** Parsed YAML frontmatter metadata */
  metadata: SkillMetadata;
  /** Current status (from DB or health tracker) */
  status: SkillStatus;
  /** Whether user has manually enabled/disabled */
  enabled: boolean;
}

/** SKILL.md YAML frontmatter structure (OpenClaw compatible) */
export interface SkillMetadata {
  name: string;
  description: string;
  version?: string;
  author?: string;
  /** Gating requirements */
  requires?: {
    /** Required CLI binaries (e.g. ["git", "curl"]) */
    bins?: string[];
    /** Required environment variables (e.g. ["GITHUB_TOKEN"]) */
    env?: string[];
    /** Required OS (e.g. ["darwin", "linux"]) */
    os?: string[];
  };
  /** Tags for categorization */
  tags?: string[];
}

/** Health tracking data for a skill */
export interface SkillHealth {
  /** Skill name */
  name: string;
  /** Total number of times the skill was invoked */
  totalCalls: number;
  /** Number of failed invocations */
  failedCalls: number;
  /** Failure rate (failedCalls / totalCalls) */
  failureRate: number;
  /** Current health status */
  status: SkillStatus;
  /** Timestamp of last usage */
  lastUsed: number;
}

/** Result of a ClawHub search */
export interface ClawHubSearchResult {
  name: string;
  description: string;
  author: string;
  downloads: number;
  version: string;
  url: string;
}

/** Result of a skill security review */
export interface SkillReviewResult {
  safe: boolean;
  risks: string[];
  summary: string;
}
