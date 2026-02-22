import { NativeTool } from "../../tool-registry";
import { GUIAgent, StatusEnum } from "@ui-tars/sdk";

import { NutJSOperator } from "@ui-tars/operator-nut-js";
import { getAppSettings } from "../../../db";
import { logger } from "../../../logger";
import { buildAgentSystemPrompt } from "../../../prompts/builder";
import { buildSystemPrompt } from "./prompts";

let agentStatus = StatusEnum.INIT;

export const UITarsAgentTool: NativeTool = {
  name: "ui_tars_agent",
  description: `使用 UI-TARS GUIAgent 控制本机桌面。
    将用户需要的内容直接描述在指令中，不需要将任务分解为多个步骤`,
  inputSchema: {
    type: "object",
    properties: {
      instruction: {
        type: "string",
        description:
          "要在桌面上执行的自然语言任务描述，直接描述需要获取的内容，不需要将任务分解为多个步骤",
      },
    },
    required: ["instruction"],
  },
  execute: async (args: {
    instruction: string;
    baseURL?: string;
    apiKey?: string;
    model?: string;
    maxLoopCount?: number;
  }) => {
    const settings = getAppSettings();
    const agentModelId = settings.agentModelId || settings.activeModelId;
    const activeModel = settings.models.find((m) => m.id === agentModelId);
    if (agentStatus === StatusEnum.RUNNING) {
      throw new Error("UI-TARS 模型服务正在运行中，请稍后再试。");
    }
    if (!activeModel) {
      agentStatus = StatusEnum.ERROR;
      throw new Error(
        "No active LLM model configured. Please configure a chat model in settings.",
      );
    }

    const baseURL = activeModel.baseUrl;
    const apiKey = activeModel.apiKey;
    const model = activeModel.modelId;

    if (!baseURL || !apiKey) {
      agentStatus = StatusEnum.ERROR;
      throw new Error(
        "UI-TARS 模型服务未配置：缺少 baseURL 或 apiKey。请在设置中为当前模型配置。",
      );
    }

    const messages: Array<{
      from: string;
      value: string;
      screenshotBase64?: string;
    }> = [];
    return new Promise(async (resolve, reject) => {
      const guiAgent = new GUIAgent({
        model: {
          baseURL,
          apiKey,
          model,
        },
        systemPrompt: buildSystemPrompt("computer", "zh"),
        operator: new NutJSOperator(),
        // maxLoopCount: args.maxLoopCount ?? 25,
        onData: ({ data }) => {
          try {
            logger.info("[UI-TARS Tool] onData payload", {
              status: data.status,
            });
            agentStatus = data.status;
            if (Array.isArray(data?.conversations)) {
              for (const conv of data.conversations) {
                if (typeof conv?.from === "string" && conv.value) {
                  messages.push({
                    from: conv.from,
                    value: String(conv.value),
                    screenshotBase64: conv.screenshotBase64,
                  });
                }
              }
            }

            if (data.status === StatusEnum.END) {
              resolve(messages[messages.length - 1].value);
            }
          } catch (e) {
            logger.warn("[UI-TARS Tool] Failed to process onData payload", e);
          }
        },
        onError: ({ error, data }) => {
          logger.error("[UI-TARS Tool] GUIAgent error", { error, data });
        },
      });
      agentStatus = StatusEnum.RUNNING;
      await guiAgent.run(args.instruction);
    });
  },
};

export const TarsTools = [UITarsAgentTool];
