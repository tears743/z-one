import OpenAI from "openai";
import { ModelConfig } from "../../renderer/src/types/settings";
import { logger } from "../logger";

function normalizeBaseUrl(baseUrl?: string): string {
  const base = (baseUrl || "https://api.openai.com/v1").trim();
  return base.endsWith("/") ? base : `${base}/`;
}

async function streamChatCompletionViaSSE(args: {
  baseUrl?: string;
  apiKey: string;
  body: unknown;
  onChunk?: (chunk: string) => void;
}): Promise<string> {
  const url = new URL(
    "chat/completions",
    normalizeBaseUrl(args.baseUrl),
  ).toString();

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(args.body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `SSE request failed (${response.status}): ${text || response.statusText}`,
    );
  }

  if (!response.body) {
    throw new Error("SSE response has no body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let eventData: string[] = [];
  let fullContent = "";

  const flushEvent = () => {
    if (eventData.length === 0) return false;
    const data = eventData
      .map((l) => l.replace(/^data:\s?/, ""))
      .join("\n")
      .trim();
    eventData = [];
    if (!data) return false;
    if (data === "[DONE]") return true;
    try {
      const json = JSON.parse(data);
      const content = json?.choices?.[0]?.delta?.content;
      if (typeof content === "string" && content.length > 0) {
        fullContent += content;
        args.onChunk?.(content);
      }
    } catch {}
    return false;
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const newlineIdx = buffer.indexOf("\n");
      if (newlineIdx === -1) break;
      const rawLine = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 1);
      const line = rawLine.replace(/\r$/, "");

      if (line === "") {
        const ended = flushEvent();
        if (ended) return fullContent;
        continue;
      }

      if (line.startsWith("data:")) {
        eventData.push(line);
      }
    }
  }

  flushEvent();
  return fullContent;
}

export async function generateEmbedding(
  text: string,
  config: ModelConfig,
): Promise<number[]> {
  const baseURL = config.baseUrl;
  const apiKey = config.apiKey;

  if (!apiKey) {
    throw new Error("API Key required for embeddings");
  }

  const openai = new OpenAI({
    baseURL: baseURL || undefined,
    apiKey,
  });

  try {
    const response = await openai.embeddings.create({
      model: config.modelId, // Use configured model ID
      input: text,
    });

    return response.data[0].embedding;
  } catch (error) {
    console.error(
      `Failed to generate embedding with model ${config.modelId}:`,
      error,
    );
    throw error;
  }
}

export class LLMService {
  constructor() {}

  async generateEmbedding(
    text: string,
    config: ModelConfig,
  ): Promise<number[]> {
    return generateEmbedding(text, config);
  }

  async generateCompletion(
    messages: ChatMessage[],
    config: ModelConfig,
    jsonMode: boolean = false,
    onChunk?: (chunk: string) => void,
  ): Promise<string | null> {
    return generateCompletion(messages, config, jsonMode, onChunk);
  }
}
export interface ChatMessage {
  role: string;
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;
}

export async function generateCompletion(
  messages: ChatMessage[],
  config: ModelConfig,
  jsonMode: boolean = false,
  onChunk?: (chunk: string) => void,
): Promise<string | null> {
  const baseURL = config.baseUrl;
  const apiKey = config.apiKey;

  // DEBUG LOGGING
  logger.info(
    `[LLMService] Generating completion for model: ${config.modelId}`,
  );
  logger.debug(
    `[LLMService] Config details: messages:${JSON.stringify(messages)} BaseURL=${baseURL}, APIKeyPresent=${!!apiKey}, JsonMode=${jsonMode}, Stream=${!!onChunk}`,
  );

  if (!apiKey) {
    logger.error("[LLMService] Missing API Key in config", {
      config: JSON.stringify(config, null, 2),
    });
    throw new Error("API Key required for completion");
  }

  const openai = new OpenAI({
    baseURL: baseURL || undefined,
    apiKey,
  });

  // Prepare parameters
  const params: any = {
    model: config.modelId,
    messages: messages.map((m) => {
      // Ensure content is properly formatted for OpenAI
      if (Array.isArray(m.content)) {
        return {
          role: m.role,
          content: m.content.map((part) => {
            if (part.type === "image_url") {
              let url = part.image_url.url;

              // Ensure Base64 has correct Data URI prefix
              // If it's a raw base64 string (no scheme), assume it's the JPEG we generated
              if (!url.startsWith("http") && !url.startsWith("data:")) {
                url = `data:image/png;base64,${url}`;
              }

              return {
                type: "image_url",
                image_url: {
                  url: url,
                  detail: "auto",
                },
              };
            }
            return part;
          }),
        };
      }
      return m;
    }) as any,
    response_format: jsonMode ? { type: "json_object" } : undefined,
  };

  // Add advanced parameters if configured
  if (config.temperature !== undefined) {
    params.temperature = config.temperature;
  }

  if (config.maxTokens !== undefined) {
    // For reasoning models (often indicated by enableThinking), standard is max_completion_tokens
    if (config.enableThinking) {
      params.max_completion_tokens = config.maxTokens;
    } else {
      params.max_tokens = config.maxTokens;
    }
  }

  // Handle stream
  // If onChunk is provided OR config.stream is true, we use streaming.
  // Note: If onChunk is NOT provided but config.stream is TRUE, we still stream but just collect the result.
  // This is useful if the model requires streaming (some do) or if we just want to respect the setting.
  const shouldStream = config.stream || !!onChunk;
  if (shouldStream) {
    params.stream = true;

    // For reasoning/thinking models, we might need specific stream options if available
    if (config.enableThinking) {
      // Some providers might need extra params here, but standard OpenAI doesn't yet
      // explicitly require extra params for streaming reasoning models besides standard stream: true
    }
  }

  try {
    if (shouldStream) {
      return await streamChatCompletionViaSSE({
        baseUrl: baseURL || undefined,
        apiKey,
        body: params,
        onChunk,
      });
    } else {
      const response = await openai.chat.completions.create(params);
      return response.choices[0].message.content;
    }
  } catch (error) {
    logger.error(
      `Failed to generate completion with model ${config.modelId}`,
      error,
    );
    throw error;
  }
}
