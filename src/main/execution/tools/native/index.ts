import { ReadFileTool, WriteFileTool, ListDirTool } from "./fs";
import { BrowserTools } from "../browser";
import { MemoryTools } from "../memory";
import { ComputerTool } from "./computer";
import { DesktopTools } from "../desktop";
import { GetCurrentTimeTool } from "../time";

export const nativeTools = [
  ReadFileTool,
  WriteFileTool,
  ListDirTool,
  ...BrowserTools,
  ...MemoryTools,
  ComputerTool,
  ...DesktopTools,
  GetCurrentTimeTool,
];
