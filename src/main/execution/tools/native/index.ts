import { ReadFileTool, WriteFileTool, ListDirTool } from "./fs";
import { BrowserAITools } from "../browser-ai";
import { MemoryTools } from "../memory";

import { GetCurrentTimeTool } from "../time";

import { RunCommandTool } from "../cli";
import { SchedulerTools } from "../scheduler";
import { AskUserTool } from "./user-interaction";
import { CapabilityDiscoveryTools } from "./capability-discovery";
import { SkillManagementTools } from "./skill-tools";
import { PrivacyVaultTools } from "../../../workflow/privacy-vault";

export const nativeTools = [
  ReadFileTool,
  WriteFileTool,
  ListDirTool,
  ...BrowserAITools,
  ...MemoryTools,
  GetCurrentTimeTool,
  RunCommandTool,
  ...SchedulerTools,
  AskUserTool,
  ...CapabilityDiscoveryTools,
  ...SkillManagementTools,
  ...PrivacyVaultTools,
];
