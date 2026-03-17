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
  signal?: AbortSignal;
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
    signal: args.signal,
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
      const reasoning =
        json?.choices?.[0]?.delta?.reasoning_content ||
        json?.choices?.[0]?.delta?.reasoning;

      if (typeof reasoning === "string" && reasoning.length > 0) {
        fullContent += reasoning;
        args.onChunk?.(reasoning);
      }

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

async function generateEmbeddingOllama(
  text: string,
  config: ModelConfig,
): Promise<number[]> {
  const baseURL = (config.baseUrl || "http://127.0.0.1:11434").replace(
    /\/$/,
    "",
  );

  const callOnce = async (input: string): Promise<number[]> => {
    const res = await fetch(`${baseURL}/api/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.modelId || "nomic-embed-text",
        prompt: input,
      }),
    });

    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      throw new Error(
        `Ollama embedding request failed (${res.status}): ${
          msg || res.statusText
        }`,
      );
    }

    const json = (await res.json()) as any;
    const embedding = json?.embedding;
    if (!Array.isArray(embedding)) {
      throw new Error("Invalid embedding response from Ollama");
    }
    return embedding.map((v: any) => Number(v) || 0);
  };

  const MAX_CHARS = 4000;
  const OVERLAP = 200;

  if (text.length <= MAX_CHARS) {
    return await callOnce(text);
  }

  const parts: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + MAX_CHARS, text.length);
    parts.push(text.slice(start, end));
    if (end === text.length) break;
    start = end - OVERLAP;
    if (start < 0) start = 0;
  }

  logger.warn(
    "[LLMService] Long text for Ollama embedding, splitting into parts",
    {
      originalLength: text.length,
      parts: parts.length,
      maxCharsPerPart: MAX_CHARS,
      overlap: OVERLAP,
      modelId: config.modelId,
    },
  );

  const vectors: number[][] = [];
  for (const part of parts) {
    try {
      const v = await callOnce(part);
      vectors.push(v);
    } catch (e) {
      logger.error(
        "[LLMService] Failed to embed one part of long text with Ollama, aborting aggregation",
        e,
      );
      throw e;
    }
  }

  if (vectors.length === 0) {
    throw new Error("No embeddings generated for long text");
  }

  const dim = vectors[0].length;
  const agg = new Array(dim).fill(0);
  for (const v of vectors) {
    if (v.length !== dim) continue;
    for (let i = 0; i < dim; i++) {
      agg[i] += v[i];
    }
  }
  for (let i = 0; i < dim; i++) {
    agg[i] /= vectors.length;
  }

  return agg;
}

export async function generateEmbedding(
  text: string,
  config: ModelConfig,
): Promise<number[]> {
  if (config.provider === "ollama") {
    try {
      return await generateEmbeddingOllama(text, config);
    } catch (error) {
      logger.error(
        `Failed to generate embedding with Ollama model ${config.modelId}`,
        error,
      );
      throw error;
    }
  }

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
      model: config.modelId,
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
    tools?: any[],
    signal?: AbortSignal,
    jsonSchema?: { name: string; schema: object },
  ): Promise<any> {
    return generateCompletion(messages, config, jsonMode, onChunk, tools, signal, jsonSchema);
  }
}
export interface ChatMessage {
  role: string;
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >
    | null;
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
}

export async function generateCompletion(
  messages: ChatMessage[],
  config: ModelConfig,
  jsonMode: boolean = false,
  onChunk?: (chunk: string) => void,
  tools?: any[],
  signal?: AbortSignal,
  jsonSchema?: { name: string; schema: object },
): Promise<any> {
  const baseURL = config.baseUrl;
  const apiKey = config.apiKey;

  // DEBUG LOGGING
  logger.info(
    `[LLMService] Generating completion for model: ${config.modelId}`,
  );
  logger.debug(
    `[LLMService] Config details: messages:${JSON.stringify(messages)} BaseURL=${baseURL}, APIKeyPresent=${!!apiKey}, JsonMode=${jsonMode}, Stream=${!!onChunk}, Tools=${!!tools}`,
  );

  if (!apiKey && !config.isCustom && config.provider !== "ollama" && config.provider !== "lm_studio") {
    logger.error("[LLMService] Missing API Key in config", {
      config: JSON.stringify(config, null, 2),
    });
    throw new Error("API Key required for completion");
  }

  const openai = new OpenAI({
    baseURL: baseURL || undefined,
    apiKey: apiKey || "dummy", // Local models might not need a key, but SDK requires one
  });
  const msg = messages.map((m) => {
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
  });
  logger.debug(
    `[LLMService] Prepared messages: ${JSON.stringify(msg, null, 2)}`,
  );
  // Prepare parameters
  const params: any = {
    model: config.modelId,
    messages: msg,
  };

  // Add tools if provided
  if (tools && tools.length > 0) {
    params.tools = tools;
  }

  // Add advanced parameters if configured
  if (config.temperature !== undefined) {
    params.temperature = config.temperature;
  }

  if (config.maxTokens !== undefined) {
    // For reasoning models (often indicated by enableThinking), standard is max_completion_tokens
    // But local models (LM Studio, Ollama) and custom models don't support it - always use max_tokens
    const useMaxCompletionTokens =
      config.enableThinking &&
      !config.isCustom &&
      config.provider !== "lm_studio" &&
      config.provider !== "ollama";

    if (useMaxCompletionTokens) {
      params.max_completion_tokens = config.maxTokens;
    } else {
      params.max_tokens = config.maxTokens;
    }
  }

  // Enforce JSON Mode via response_format if requested
  if (jsonMode) {
    if (config.provider === "lm_studio" && jsonSchema) {
      // LM Studio supports json_schema format (not json_object)
      params.response_format = {
        type: "json_schema",
        json_schema: {
          name: jsonSchema.name,
          schema: jsonSchema.schema,
          strict: true,
        },
      };
    } else if (
      !config.isCustom &&
      config.provider !== "lm_studio" &&
      config.provider !== "ollama"
    ) {
      // Cloud providers support json_object
      params.response_format = { type: "json_object" };
    }
    // Ollama and custom models: rely on prompt-based JSON enforcement only

    // Ensure "json" is mentioned in the system message if not already
    const systemMsg = params.messages.find((m: any) => m.role === "system");
    if (
      systemMsg &&
      typeof systemMsg.content === "string" &&
      !systemMsg.content.toLowerCase().includes("json")
    ) {
      systemMsg.content += "\nIMPORTANT: Please output valid JSON.";
    }
  }

  // Handle stream
  // If onChunk is provided OR config.stream is true, we use streaming.
  // Note: If onChunk is NOT provided but config.stream is TRUE, we still stream but just collect the result.
  // This is useful if the model requires streaming (some do) or if we just want to respect the setting.
  const shouldStream = config.stream || !!onChunk;
  const hasTools = tools && tools.length > 0;

  if (shouldStream && !hasTools) {
    // Disable streaming if tools are used for now to simplify handling
    params.stream = true;

    // For reasoning/thinking models, we might need specific stream options if available
    if (config.enableThinking) {
      // Some providers might need extra params here, but standard OpenAI doesn't yet
      // explicitly require extra params for streaming reasoning models besides standard stream: true
    }
  }

  try {
    if (shouldStream && !hasTools) {
      return await streamChatCompletionViaSSE({
        baseUrl: baseURL || undefined,
        apiKey: apiKey || "dummy",
        body: params,
        onChunk,
        signal,
      });
    } else if (
      (config.provider === "lm_studio" || config.provider === "ollama") &&
      !hasTools
    ) {
      // Use raw fetch for local models (LM Studio / Ollama) to avoid
      // OpenAI SDK response parsing issues
      const url = new URL(
        "chat/completions",
        normalizeBaseUrl(baseURL),
      ).toString();

      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey || "dummy"}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...params, stream: false }),
        signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `${config.provider} request failed (${res.status}): ${text || res.statusText}`,
        );
      }

      const json = (await res.json()) as any;
      const content =
        json?.choices?.[0]?.message?.content ?? json?.choices?.[0]?.text ?? null;

      if (content === null) {
        logger.error(
          `[LLMService] No content in ${config.provider} response`,
          { response: JSON.stringify(json, null, 2) },
        );
        throw new Error(
          `Model ${config.modelId} returned no content. Raw: ${JSON.stringify(json)}`,
        );
      }

      return content;
    } else {
      const response = await openai.chat.completions.create(params, { signal });

      // Safety check: some models may return empty choices
      if (!response?.choices || response.choices.length === 0) {
        logger.error(
          `[LLMService] Empty choices in response from ${config.modelId}`,
          { response: JSON.stringify(response, null, 2) },
        );
        throw new Error(
          `Model ${config.modelId} returned no choices. Raw response: ${JSON.stringify(response)}`,
        );
      }

      const message = response.choices[0].message;

      // If tools were requested, return the full message object
      if (tools) {
        return message;
      }

      // Otherwise return just content string for backward compatibility
      return message.content;
    }
  } catch (error: any) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorDetails = error?.response?.data || error?.response || error;
    logger.error(
      `Failed to generate completion with model ${config.modelId}. Error: ${errorMsg}`,
      {
        params: JSON.stringify(params, null, 2),
        details: JSON.stringify(errorDetails, null, 2),
      }
    );
    throw error;
  }
}
