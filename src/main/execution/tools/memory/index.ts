import { NativeTool } from "../../tool-registry";
import { searchMemory, addMemory } from "../../../memory/manager";

export const SearchMemoryTool: NativeTool = {
  name: "search_memory",
  description:
    "Search long-term memory for relevant information, facts, or past context.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "The search query" },
      limit: { type: "number", description: "Max results (default 5)" },
    },
    required: ["query"],
  },
  execute: async (args: { query: string; limit?: number }) => {
    const results = await searchMemory(args.query, { limit: args.limit || 5 });
    return results.map((r) => ({
      content: r.content,
      score: r.score,
      source: r.source,
      timestamp: new Date(r.timestamp).toISOString(),
    }));
  },
};

export const AddMemoryTool: NativeTool = {
  name: "add_memory",
  description:
    "Explicitly save a key fact, decision, or rule to long-term memory.",
  inputSchema: {
    type: "object",
    properties: {
      content: { type: "string", description: "The content to remember" },
      tag: {
        type: "string",
        description: "Optional tag (e.g. 'user_preference', 'project_fact')",
      },
    },
    required: ["content"],
  },
  execute: async (args: { content: string; tag?: string }) => {
    await addMemory(
      args.content,
      "decision",
      "agent_tool",
      args.tag ? [args.tag] : [],
    );
    return "Memory saved.";
  },
};

export const MemoryTools = [SearchMemoryTool, AddMemoryTool];
