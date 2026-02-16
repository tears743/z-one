import { NativeTool } from "../../tool-registry";

export const GetCurrentTimeTool: NativeTool = {
  name: "get_current_time",
  description:
    "Get the current system time in ISO 8601 format and local string format. Use this to check the current date and time.",
  inputSchema: {
    type: "object",
    properties: {},
  },
  execute: async () => {
    const now = new Date();
    return {
      iso: now.toISOString(),
      local: now.toLocaleString(),
      timestamp: now.getTime(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  },
};
