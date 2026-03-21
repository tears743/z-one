/**
 * SkillLoader — loads SKILL.md files from workspace/skills/ directory,
 * parses YAML frontmatter, and filters by gating rules and enabled status.
 */

import * as fs from "fs";
import * as path from "path";
import { SkillEntry, SkillMetadata, SkillStatus } from "./types";
import { getSkillStatus } from "./health-tracker";
import { logger } from "../logger";

/**
 * Parse YAML frontmatter from SKILL.md content.
 * Expects format:
 * ---
 * name: skill-name
 * description: A brief description
 * ...
 * ---
 * [markdown content]
 */
function parseFrontmatter(content: string): { metadata: Partial<SkillMetadata>; body: string } {
  const fmRegex = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/;
  const match = content.match(fmRegex);

  if (!match) {
    return { metadata: {}, body: content };
  }

  const yamlStr = match[1];
  const body = match[2];

  // Simple YAML parser for flat key-value pairs and basic arrays
  const metadata: Record<string, any> = {};
  let currentKey: string | null = null;

  for (const line of yamlStr.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Key: value
    const kvMatch = trimmed.match(/^(\w[\w.-]*)\s*:\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1];
      const value = kvMatch[2].trim();

      if (value === "" || value === "|" || value === ">") {
        // Start of a block or nested object
        currentKey = key;
        if (!metadata[key]) metadata[key] = {};
      } else if (value.startsWith("[") && value.endsWith("]")) {
        // Inline array: [item1, item2]
        metadata[key] = value
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean);
        currentKey = null;
      } else {
        metadata[key] = value.replace(/^["']|["']$/g, "");
        currentKey = null;
      }
      continue;
    }

    // Array item under a key:   - item
    const arrayMatch = trimmed.match(/^-\s+(.+)$/);
    if (arrayMatch && currentKey) {
      if (!Array.isArray(metadata[currentKey])) {
        metadata[currentKey] = [];
      }
      metadata[currentKey].push(arrayMatch[1].replace(/^["']|["']$/g, ""));
      continue;
    }

    // Nested key under a parent (e.g., requires.bins)
    if (currentKey && trimmed.includes(":")) {
      const nestedMatch = trimmed.match(/^(\w+)\s*:\s*(.*)$/);
      if (nestedMatch) {
        if (typeof metadata[currentKey] !== "object" || Array.isArray(metadata[currentKey])) {
          metadata[currentKey] = {};
        }
        const nestedVal = nestedMatch[2].trim();
        if (nestedVal.startsWith("[") && nestedVal.endsWith("]")) {
          metadata[currentKey][nestedMatch[1]] = nestedVal
            .slice(1, -1)
            .split(",")
            .map((s) => s.trim().replace(/^["']|["']$/g, ""))
            .filter(Boolean);
        } else {
          metadata[currentKey][nestedMatch[1]] = nestedVal.replace(/^["']|["']$/g, "");
        }
      }
    }
  }

  return { metadata: metadata as Partial<SkillMetadata>, body };
}

/**
 * Check if a skill passes its gating requirements.
 */
function checkGating(metadata: SkillMetadata): boolean {
  const requires = metadata.requires;
  if (!requires) return true;

  // Check OS
  if (requires.os && requires.os.length > 0) {
    const currentOS = process.platform;
    if (!requires.os.includes(currentOS)) {
      logger.debug(`[SkillLoader] Skill "${metadata.name}" gated by OS: requires ${requires.os.join(",")}, current: ${currentOS}`);
      return false;
    }
  }

  // Check required binaries
  if (requires.bins && requires.bins.length > 0) {
    const { execSync } = require("child_process");
    for (const bin of requires.bins) {
      try {
        execSync(`which ${bin}`, { stdio: "ignore" });
      } catch {
        logger.debug(`[SkillLoader] Skill "${metadata.name}" gated by missing binary: ${bin}`);
        return false;
      }
    }
  }

  // Check required environment variables
  if (requires.env && requires.env.length > 0) {
    for (const envVar of requires.env) {
      if (!process.env[envVar]) {
        logger.debug(`[SkillLoader] Skill "${metadata.name}" gated by missing env: ${envVar}`);
        return false;
      }
    }
  }

  return true;
}

/**
 * Load all skills from the workspace/skills/ directory.
 * Returns only skills that:
 * 1. Have a valid SKILL.md
 * 2. Pass gating requirements
 * 3. Are not disabled by user
 * 4. Are not "retired" by health tracker
 */
export function loadSkills(workspacePath: string): SkillEntry[] {
  const skillsDir = path.join(workspacePath, "skills");

  if (!fs.existsSync(skillsDir)) {
    logger.info(`[SkillLoader] Skills directory not found: ${skillsDir}`);
    return [];
  }

  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  const skills: SkillEntry[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillDir = path.join(skillsDir, entry.name);
    const skillMdPath = path.join(skillDir, "SKILL.md");

    if (!fs.existsSync(skillMdPath)) {
      logger.debug(`[SkillLoader] Skipping ${entry.name}: no SKILL.md`);
      continue;
    }

    try {
      const content = fs.readFileSync(skillMdPath, "utf-8");
      const { metadata: rawMeta, body } = parseFrontmatter(content);

      const metadata: SkillMetadata = {
        name: rawMeta.name || entry.name,
        description: rawMeta.description || "No description",
        version: rawMeta.version,
        author: rawMeta.author,
        requires: rawMeta.requires as SkillMetadata["requires"],
        tags: rawMeta.tags as string[],
      };

      // Check gating
      if (!checkGating(metadata)) continue;

      // Get status from health tracker / DB
      const health = getSkillStatus(metadata.name);

      const skill: SkillEntry = {
        name: metadata.name,
        description: metadata.description,
        content, // Full SKILL.md content (frontmatter + body)
        dirPath: skillDir,
        metadata,
        status: health?.status || "active",
        enabled: health?.status !== "disabled",
      };

      skills.push(skill);
    } catch (e: any) {
      logger.warn(`[SkillLoader] Failed to load skill "${entry.name}": ${e.message}`);
    }
  }

  logger.info(`[SkillLoader] Loaded ${skills.length} skills from ${skillsDir}`);
  return skills;
}

/**
 * Load all skills including disabled ones (for Settings UI).
 */
export function loadAllSkills(workspacePath: string): SkillEntry[] {
  const skillsDir = path.join(workspacePath, "skills");

  if (!fs.existsSync(skillsDir)) return [];

  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  const skills: SkillEntry[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillDir = path.join(skillsDir, entry.name);
    const skillMdPath = path.join(skillDir, "SKILL.md");
    if (!fs.existsSync(skillMdPath)) continue;

    try {
      const content = fs.readFileSync(skillMdPath, "utf-8");
      const { metadata: rawMeta } = parseFrontmatter(content);

      const metadata: SkillMetadata = {
        name: rawMeta.name || entry.name,
        description: rawMeta.description || "No description",
        version: rawMeta.version,
        author: rawMeta.author,
        requires: rawMeta.requires as SkillMetadata["requires"],
        tags: rawMeta.tags as string[],
      };

      const health = getSkillStatus(metadata.name);

      skills.push({
        name: metadata.name,
        description: metadata.description,
        content,
        dirPath: skillDir,
        metadata,
        status: health?.status || "active",
        enabled: health?.status !== "disabled",
      });
    } catch (e: any) {
      logger.warn(`[SkillLoader] Failed to load skill "${entry.name}": ${e.message}`);
    }
  }

  return skills;
}
