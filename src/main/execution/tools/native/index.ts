import { ReadFileTool, WriteFileTool, ListDirTool } from "./fs";
import { BrowserAITools } from "../browser-ai";
import { MemoryTools } from "../memory";

import { GetCurrentTimeTool } from "../time";

import { RunCommandTool } from "../cli";
import { SchedulerTools } from "../scheduler";

export const nativeTools = [
  ReadFileTool,
  WriteFileTool,
  ListDirTool,
  ...BrowserAITools,
  ...MemoryTools,
  GetCurrentTimeTool,
  RunCommandTool,
  ...SchedulerTools,
];
