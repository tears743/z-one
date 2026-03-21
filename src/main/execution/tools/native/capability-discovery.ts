/**
 * Unified Capability Discovery tools — replaces separate tool/skill discovery.
 *
 * Tools:
 *   list_capabilities  — paginated list of all available capabilities (tools + skills)
 *   get_capability_detail — detailed info: inputSchema for tools, SKILL.md content for skills
 */

import { NativeTool, ToolContext } from "../../tool-registry";
import { loadSkills } from "../../../skills/loader";
import { getAppSettings } from "../../../db";
import { logger } from "../../../logger";
import * as path from "path";

// We need access to the tool registry to list MCP+native tools
// This will be set during registration
let toolRegistryRef: any = null;

export function setToolRegistry(registry: any) {
  toolRegistryRef = registry;
}

/**
 * list_capabilities — paginated unified list of tools + skills
 */
export const ListCapabilitiesTool: NativeTool = {
  name: "list_capabilities",
  description:
    "List all available capabilities (native tools, MCP tools, and installed skills). " +
    "Returns a paginated list with name, brief description, and type (tool/skill). " +
    "Use page parameter for pagination (50 items per page).",
  inputSchema: {
    type: "object",
    properties: {
      page: {
        type: "number",
        description: "Page number (1-indexed). Default: 1",
      },
      typeFilter: {
        type: "string",
        enum: ["all", "tool", "skill"],
        description: "Filter by type. Default: all",
      },
    },
  },
  execute: async (args: any) => {
    const page = Math.max(1, args?.page || 1);
    const typeFilter = args?.typeFilter || "all";
    const pageSize = 50;

    const capabilities: Array<{ name: string; description: string; type: "tool" | "skill" }> = [];

    // 1. Collect tools (native + MCP)
    if (typeFilter === "all" || typeFilter === "tool") {
      if (toolRegistryRef) {
        try {
          const allTools = await toolRegistryRef.getAllTools();
          for (const tool of allTools) {
            capabilities.push({
              name: tool.name,
              description: (tool.description || "").substring(0, 100),
              type: "tool",
            });
          }
        } catch (e: any) {
          logger.warn(`[list_capabilities] Failed to get tools: ${e.message}`);
        }
      }
    }

    // 2. Collect skills
    if (typeFilter === "all" || typeFilter === "skill") {
      try {
        const settings = getAppSettings();
        const workspacePath = settings?.general?.agentWorkspace || path.join(process.cwd(), "workspace");
        const skills = loadSkills(workspacePath);

        for (const skill of skills) {
          // Only show active/warned skills, not retired/disabled
          if (skill.status === "active" || skill.status === "warned") {
            capabilities.push({
              name: skill.name,
              description: skill.description.substring(0, 100),
              type: "skill",
            });
          }
        }
      } catch (e: any) {
        logger.warn(`[list_capabilities] Failed to load skills: ${e.message}`);
      }
    }

    // 3. Paginate
    const totalItems = capabilities.length;
    const totalPages = Math.ceil(totalItems / pageSize);
    const startIdx = (page - 1) * pageSize;
    const pageItems = capabilities.slice(startIdx, startIdx + pageSize);

    return JSON.stringify({
      capabilities: pageItems,
      page,
      totalPages,
      totalItems,
    });
  },
};

/**
 * get_capability_detail — detailed info for a specific tool or skill
 */
export const GetCapabilityDetailTool: NativeTool = {
  name: "get_capability_detail",
  description:
    "Get detailed information about a specific capability by name. " +
    "For tools: returns inputSchema. For skills: returns full SKILL.md content (instructions).",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Name of the capability to get details for",
      },
    },
    required: ["name"],
  },
  execute: async (args: any) => {
    const capName = args?.name;
    if (!capName) return JSON.stringify({ error: "name is required" });

    // 1. Check tools first
    if (toolRegistryRef) {
      try {
        const allTools = await toolRegistryRef.getAllTools();
        const tool = allTools.find((t: any) => t.name === capName);
        if (tool) {
          return JSON.stringify({
            type: "tool",
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          });
        }
      } catch {}
    }

    // 2. Check skills
    try {
      const settings = getAppSettings();
      const workspacePath = settings?.general?.agentWorkspace || path.join(process.cwd(), "workspace");
      const skills = loadSkills(workspacePath);
      const skill = skills.find((s) => s.name === capName);

      if (skill) {
        return JSON.stringify({
          type: "skill",
          name: skill.name,
          description: skill.description,
          status: skill.status,
          content: skill.content, // Full SKILL.md content
          metadata: skill.metadata,
        });
      }
    } catch {}

    return JSON.stringify({ error: `Capability "${capName}" not found` });
  },
};

export const CapabilityDiscoveryTools = [ListCapabilitiesTool, GetCapabilityDetailTool];
