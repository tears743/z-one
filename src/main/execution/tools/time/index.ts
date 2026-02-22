import { NativeTool } from "../../tool-registry";
import dayjs from "dayjs";

export const GetCurrentTimeTool: NativeTool = {
  name: "get_current_time",
  description:
    "Get the current system time in ISO 8601 format and local string format. Use this to check the current date and time.",
  inputSchema: {
    type: "object",
    properties: {},
  },
  execute: async () => {
    return dayjs().format("yyyy-MM-dd HH:mm:ss");
  },
};
