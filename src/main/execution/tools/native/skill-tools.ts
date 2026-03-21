/**
 * Skill management tools — search, install, enable/disable, delete skills.
 *
 * Tools:
 *   search_clawhub  — search ClawHub community skills
 *   install_skill   — download, review, and install a skill
 *   skill_disable   — disable a skill
 *   skill_enable    — re-enable a skill
 *   skill_delete    — delete an installed skill
 */

import { NativeTool } from "../../tool-registry";
import { reviewSkill } from "../../../skills/reviewer";
import { setSkillEnabled, deleteSkillData } from "../../../skills/health-tracker";
import { getAppSettings } from "../../../db";
import { logger } from "../../../logger";
import * as fs from "fs";
import * as path from "path";

// LLM service reference for security review
let llmServiceRef: any = null;

export function setLLMService(service: any) {
  llmServiceRef = service;
}

/**
 * search_clawhub — search the ClawHub registry for community skills
 */
export const SearchClawHubTool: NativeTool = {
  name: "search_clawhub",
  description:
    "Search the ClawHub community skill registry. " +
    "Returns a list of available skills matching the query. " +
    "Use install_skill to install a found skill.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query (e.g., 'github', 'weather', 'docker')",
      },
      page: {
        type: "number",
        description: "Page number. Default: 1",
      },
    },
    required: ["query"],
  },
  execute: async (args: any) => {
    const { query, page = 1 } = args;

    try {
      // ClawHub API — public search endpoint
      const url = `https://api.clawhub.ai/v1/skills/search?q=${encodeURIComponent(query)}&page=${page}&limit=20`;

      const response = await fetch(url, {
        headers: { "User-Agent": "Z-One Agent/1.0" },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        // Fallback: try the website scraping approach
        return JSON.stringify({
          error: `ClawHub API returned ${response.status}. The API may be unavailable.`,
          suggestion: "Try visiting https://clawhub.ai/skills to browse skills manually.",
        });
      }

      const data = await response.json();
      return JSON.stringify({
        results: data.skills || data.results || [],
        page,
        total: data.total || 0,
      });
    } catch (e: any) {
      logger.warn(`[search_clawhub] API call failed: ${e.message}`);
      return JSON.stringify({
        error: `Failed to search ClawHub: ${e.message}`,
        suggestion: "Check network connection or visit https://clawhub.ai/skills directly.",
      });
    }
  },
};

/**
 * install_skill — download skill from ClawHub, security review, then install
 */
export const InstallSkillTool: NativeTool = {
  name: "install_skill",
  description:
    "Install a skill from ClawHub or a local path. " +
    "Performs LLM-based security review before installation. " +
    "Skills are installed to workspace/skills/ directory.",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Skill name to install from ClawHub, or path to local skill directory",
      },
      skipReview: {
        type: "boolean",
        description: "Skip security review (not recommended). Default: false",
      },
    },
    required: ["name"],
  },
  execute: async (args: any) => {
    const { name, skipReview = false } = args;

    const settings = getAppSettings();
    const workspacePath = settings?.general?.agentWorkspace || path.join(process.cwd(), "workspace");
    const skillsDir = path.join(workspacePath, "skills");

    // Ensure skills directory exists
    if (!fs.existsSync(skillsDir)) {
      fs.mkdirSync(skillsDir, { recursive: true });
    }

    const targetDir = path.join(skillsDir, name);

    // Check if already installed
    if (fs.existsSync(targetDir)) {
      return JSON.stringify({
        error: `Skill "${name}" is already installed at ${targetDir}`,
        suggestion: "Use skill_delete to remove it first, then reinstall.",
      });
    }

    // Try to download from ClawHub using clawhub CLI
    try {
      const { execSync } = require("child_process");

      // Check if clawhub CLI is available
      try {
        execSync("which clawhub", { stdio: "ignore" });
      } catch {
        return JSON.stringify({
          error: "clawhub CLI not found. Please install it first.",
          suggestion: "Run: npm install -g @anthropic/clawhub",
        });
      }

      // Download skill
      logger.info(`[install_skill] Downloading skill: ${name}`);
      execSync(`clawhub install ${name} --target "${targetDir}"`, {
        stdio: "pipe",
        timeout: 30000,
      });
    } catch (e: any) {
      // If clawhub CLI fails, check if it's a local path
      if (fs.existsSync(name) && fs.existsSync(path.join(name, "SKILL.md"))) {
        // Copy local skill
        logger.info(`[install_skill] Installing from local path: ${name}`);
        fs.cpSync(name, targetDir, { recursive: true });
      } else {
        return JSON.stringify({
          error: `Failed to download skill "${name}": ${e.message}`,
          suggestion: "Check the skill name or provide a local path.",
        });
      }
    }

    // Verify SKILL.md exists
    const skillMdPath = path.join(targetDir, "SKILL.md");
    if (!fs.existsSync(skillMdPath)) {
      // Clean up
      fs.rmSync(targetDir, { recursive: true, force: true });
      return JSON.stringify({ error: "Downloaded package does not contain SKILL.md" });
    }

    // Security Review
    if (!skipReview) {
      const skillContent = fs.readFileSync(skillMdPath, "utf-8");

      if (!llmServiceRef) {
        return JSON.stringify({
          error: "LLM service not available for security review",
          installed: false,
        });
      }

      const modelConfig = settings?.activeModelId
        ? settings.models.find((m) => m.id === settings.activeModelId) || {}
        : {};

      const review = await reviewSkill(skillContent, name, llmServiceRef, modelConfig);

      if (!review.safe) {
        // Remove installed skill
        fs.rmSync(targetDir, { recursive: true, force: true });
        logger.warn(`[install_skill] Skill "${name}" rejected by security review: ${review.risks.join(", ")}`);
        return JSON.stringify({
          installed: false,
          reason: "Security review failed",
          risks: review.risks,
          summary: review.summary,
        });
      }

      logger.info(`[install_skill] Skill "${name}" passed security review: ${review.summary}`);
    }

    return JSON.stringify({
      installed: true,
      name,
      path: targetDir,
      message: `Skill "${name}" installed successfully${skipReview ? " (review skipped)" : " (passed security review)"}`,
    });
  },
};

/**
 * skill_disable — disable an installed skill
 */
export const SkillDisableTool: NativeTool = {
  name: "skill_disable",
  description: "Disable an installed skill. Disabled skills will not appear in list_capabilities.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Skill name to disable" },
    },
    required: ["name"],
  },
  execute: async (args: any) => {
    const { name } = args;
    setSkillEnabled(name, false);
    return JSON.stringify({ success: true, message: `Skill "${name}" disabled` });
  },
};

/**
 * skill_enable — re-enable a disabled skill
 */
export const SkillEnableTool: NativeTool = {
  name: "skill_enable",
  description: "Re-enable a disabled or retired skill.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Skill name to enable" },
    },
    required: ["name"],
  },
  execute: async (args: any) => {
    const { name } = args;
    setSkillEnabled(name, true);
    return JSON.stringify({ success: true, message: `Skill "${name}" enabled` });
  },
};

/**
 * skill_delete — delete an installed skill from disk and DB
 */
export const SkillDeleteTool: NativeTool = {
  name: "skill_delete",
  description: "Delete an installed skill from disk. Removes the skill directory and all tracking data.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Skill name to delete" },
    },
    required: ["name"],
  },
  execute: async (args: any) => {
    const { name } = args;

    const settings = getAppSettings();
    const workspacePath = settings?.general?.agentWorkspace || path.join(process.cwd(), "workspace");
    const skillDir = path.join(workspacePath, "skills", name);

    if (!fs.existsSync(skillDir)) {
      return JSON.stringify({ error: `Skill "${name}" not found at ${skillDir}` });
    }

    try {
      fs.rmSync(skillDir, { recursive: true, force: true });
      deleteSkillData(name);
      logger.info(`[skill_delete] Deleted skill: ${name}`);
      return JSON.stringify({ success: true, message: `Skill "${name}" deleted` });
    } catch (e: any) {
      return JSON.stringify({ error: `Failed to delete skill: ${e.message}` });
    }
  },
};

export const SkillManagementTools = [
  SearchClawHubTool,
  InstallSkillTool,
  SkillDisableTool,
  SkillEnableTool,
  SkillDeleteTool,
];
