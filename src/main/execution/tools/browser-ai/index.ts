import { Stagehand, CustomOpenAIClient } from "@browserbasehq/stagehand";
import OpenAI from "openai";
import { NativeTool } from "../../tool-registry";
import { logger } from "../../../logger";
import { getAppSettings } from "../../../db";

const INIT_TIMEOUT_MS = 30_000; // 30s timeout for browser launch

/**
 * StagehandManager — singleton that manages a Stagehand instance.
 * Uses local Chromium (headless:false) and the user's configured LLM.
 */
class StagehandManager {
  private stagehand: Stagehand | null = null;
  private initPromise: Promise<Stagehand> | null = null;
  private lastError: string | null = null;

  /**
   * Stagehand-supported providers in priority order.
   * These are the providers officially supported by Stagehand's Agent mode.
   */
  private static PREFERRED_PROVIDERS = ["google", "gemini", "openai", "anthropic"];

  /**
   * Stagehand-preferred model IDs — if a user has any of these configured,
   * use them instead of the active model.
   */
  private static PREFERRED_MODEL_PATTERNS = [
    "gemini",     // Google Gemini
    "gpt-4o",     // OpenAI GPT-4o
    "computer-use", // OpenAI Computer Use Preview
    "claude",     // Anthropic Claude
  ];

  /**
   * Build an LLM client from the user's model settings.
   * Prioritizes Stagehand-compatible models (Gemini, GPT-4o, Claude),
   * falls back to the currently active model if none are found.
   */
  private buildLLMClient() {
    const settings = getAppSettings();
    const allModels = settings.models || [];

    // 1. Try to find a preferred Stagehand-compatible model
    let model = this.findPreferredModel(allModels);

    // 2. Fallback to active model
    if (!model) {
      const targetModelId = settings.activeModelId;
      model = allModels.find((m: any) => m.id === targetModelId);
    }

    if (!model) {
      throw new Error(
        "No LLM model configured. Please configure a model in settings.",
      );
    }

    // Normalize baseUrl: built-in models may have undefined baseUrl
    const baseUrl = (model.baseUrl || "https://api.openai.com/v1").replace(
      /\/+$/,
      "",
    );

    logger.info(
      `[StagehandManager] Using model: ${model.modelId} (provider: ${model.provider}) at ${baseUrl}`,
    );

    // Create an OpenAI-compatible client — works with any provider
    // that exposes the /chat/completions endpoint (OpenAI, Deepseek, Ollama, etc.)
    const openaiClient = new OpenAI({
      baseURL: baseUrl,
      apiKey: model.apiKey || "dummy",
    });

    // Proxy: override sampling parameters for providers that reject non-default values.
    // e.g. kimi-k2.5 rejects non-default temperature/top_p with 400 errors.
    const needsParamOverride = !StagehandManager.PREFERRED_PROVIDERS.includes(model.provider);
    if (needsParamOverride) {
      const originalCreate = openaiClient.chat.completions.create.bind(
        openaiClient.chat.completions,
      );
      openaiClient.chat.completions.create = (async (body: any, ...rest: any[]) => {
        const {
          temperature,
          top_p,
          n,
          presence_penalty,
          frequency_penalty,
          ...restBody
        } = body || {};
        return originalCreate(
          {
            ...restBody,
            temperature: 1,
            top_p: 0.95,
            n: 1,
            presence_penalty: 0,
            frequency_penalty: 0,
          },
          ...rest,
        );
      }) as any;
    }

    return new CustomOpenAIClient({
      modelName: model.modelId,
      client: openaiClient as any,
    });
  }

  /**
   * Search configured models for a Stagehand-preferred model.
   * Returns the first enabled model that matches a preferred provider/pattern.
   */
  private findPreferredModel(models: any[]): any | null {
    // Only consider enabled models with an API key
    const enabledModels = models.filter(
      (m: any) => m.enabled && m.apiKey && m.modelType !== "embedding",
    );

    // Try matching by provider first
    for (const provider of StagehandManager.PREFERRED_PROVIDERS) {
      const match = enabledModels.find((m: any) => m.provider === provider);
      if (match) {
        logger.info(
          `[StagehandManager] Found preferred Stagehand model: ${match.modelId} (${match.provider})`,
        );
        return match;
      }
    }

    // Try matching by modelId pattern
    for (const pattern of StagehandManager.PREFERRED_MODEL_PATTERNS) {
      const match = enabledModels.find((m: any) =>
        m.modelId?.toLowerCase().includes(pattern),
      );
      if (match) {
        logger.info(
          `[StagehandManager] Found preferred Stagehand model by pattern: ${match.modelId}`,
        );
        return match;
      }
    }

    logger.info(
      "[StagehandManager] No Stagehand-preferred model found, will fallback to active model.",
    );
    return null;
  }

  async getInstance(): Promise<Stagehand> {
    if (this.stagehand) return this.stagehand;

    // Prevent concurrent init attempts
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.doInit();
    try {
      const result = await this.initPromise;
      return result;
    } finally {
      this.initPromise = null;
    }
  }

  private async doInit(): Promise<Stagehand> {
    logger.info("[StagehandManager] Initializing Stagehand (local browser)...");

    try {
      const stagehand = new Stagehand({
        env: "LOCAL",
        localBrowserLaunchOptions: {
          headless: false,
        },
        llmClient: this.buildLLMClient(),
        verbose: 1,
      });

      // Add timeout to prevent hanging forever
      await Promise.race([
        stagehand.init(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `Browser init timed out after ${INIT_TIMEOUT_MS / 1000}s. ` +
                  `Ensure Chromium is installed: npx playwright install chromium`,
                ),
              ),
            INIT_TIMEOUT_MS,
          ),
        ),
      ]);

      this.stagehand = stagehand;
      this.lastError = null;
      logger.info("[StagehandManager] Stagehand initialized successfully.");
      return stagehand;
    } catch (err: any) {
      this.lastError = err.message || String(err);
      logger.error(`[StagehandManager] Init failed: ${this.lastError}`);
      // Clean up any partial browser process
      await this.forceCleanup();
      throw err;
    }
  }

  async close() {
    if (this.stagehand) {
      try {
        await this.stagehand.close();
      } catch (e) {
        logger.warn("[StagehandManager] Error closing stagehand", e);
      }
      this.stagehand = null;
      this.lastError = null;
      logger.info("[StagehandManager] Stagehand closed.");
    }
    // Kill orphan Chromium processes launched by Playwright
    await this.forceCleanup();
  }

  /**
   * Force-kill any orphan Chromium processes spawned by Playwright.
   * This prevents ghost browser windows from lingering in the dock.
   */
  private async forceCleanup() {
    try {
      const { exec } = await import("child_process");
      const { promisify } = await import("util");
      const execAsync = promisify(exec);
      // Kill Chromium processes that were launched by Playwright (not the user's own Chrome)
      await execAsync(
        'pkill -f "chromium.*--remote-debugging" 2>/dev/null || true',
      );
    } catch {
      // Best-effort cleanup, ignore errors
    }
  }

  getLastError(): string | null {
    return this.lastError;
  }
}

export const stagehandManager = new StagehandManager();

// Guard: Stagehand's internal pino logger can crash when the worker exits
// (e.g. when Chromium closes during app shutdown). Catch it gracefully.
process.on("uncaughtException", (err) => {
  if (
    err.message?.includes("the worker has exited") ||
    err.message?.includes("write after end")
  ) {
    // Stagehand/pino teardown race condition — safe to ignore
    return;
  }
  // Re-throw non-Stagehand errors
  throw err;
});

/**
 * Helper: get Stagehand and its active page (Playwright Page).
 * Stagehand v3 uses context.awaitActivePage() to resolve the page.
 */
async function getStagehandAndPage() {
  const stagehand = await stagehandManager.getInstance();
  let page: any = null;
  try {
    const ctx = (stagehand as any).context || (stagehand as any).ctx;
    if (ctx?.awaitActivePage) {
      const v3page = await ctx.awaitActivePage();
      // v3page may wrap a Playwright page — extract the raw page if needed
      page = v3page?.page || v3page;
    }
  } catch (e) {
    logger.warn("[StagehandManager] Could not get active page", e);
  }
  return { stagehand, page };
}

// ── Tool 1: Navigate ─────────────────────────────────────────────────

export const BrowserAINavigateTool: NativeTool = {
  name: "browser_navigate",
  description: `Navigate to a URL in the AI-controlled browser. 
Opens a visible Chromium browser if not already open.
Returns the page title and URL.`,
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "The URL to navigate to" },
    },
    required: ["url"],
  },
  execute: async (args: { url: string }) => {
    try {
      const { stagehand, page } = await getStagehandAndPage();
      if (!page) {
        await stagehand.act(`navigate to ${args.url}`);
        return { title: "Navigated", url: args.url };
      }
      await page.goto(args.url, { waitUntil: "networkidle" });
      // Extra wait for JS-rendered pages (e.g. GitHub Trending)
      await new Promise((r) => setTimeout(r, 2000));
      const title = await page.title();
      return { title, url: page.url() };
    } catch (err: any) {
      return { error: true, message: err.message || String(err) };
    }
  },
};

// ── Tool 2: Act (Natural Language Action) ─────────────────────────────

export const BrowserAIActTool: NativeTool = {
  name: "browser_act",
  description: `Execute an action on the current browser page using natural language.
Examples: "click the login button", "scroll down", "select the second item", "fill in the email field with test@example.com"
The AI will identify the correct element and perform the action.`,
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description:
          "Natural language description of the action to perform on the current page.",
      },
    },
    required: ["action"],
  },
  execute: async (args: { action: string }) => {
    try {
      const { stagehand } = await getStagehandAndPage();
      const result = await stagehand.act(args.action);
      return { success: true, action: args.action, result };
    } catch (err: any) {
      return { error: true, message: err.message || String(err) };
    }
  },
};

// ── Tool 3: Extract (Structured Data) ─────────────────────────────────

export const BrowserAIExtractTool: NativeTool = {
  name: "browser_extract",
  description: `Extract structured data from the current browser page using natural language.
The AI analyzes the page and returns the requested information as structured text.
Examples: "extract all product names and prices", "get the main article text", "list all links on this page"`,
  inputSchema: {
    type: "object",
    properties: {
      instruction: {
        type: "string",
        description:
          "What data to extract from the current page. Be specific about what you want.",
      },
    },
    required: ["instruction"],
  },
  execute: async (args: { instruction: string }) => {
    try {
      const { stagehand } = await getStagehandAndPage();
      // V3: extract(instruction) returns the extracted data
      const result = await stagehand.extract(args.instruction);
      return result;
    } catch (err: any) {
      return { error: true, message: err.message || String(err) };
    }
  },
};

// ── Tool 4: Observe (Discover Actions) ────────────────────────────────

export const BrowserAIObserveTool: NativeTool = {
  name: "browser_observe",
  description: `Discover available actions and interactive elements on the current browser page.
Returns a list of possible actions you can take. Use this to understand what's on the page before acting.
Examples: "find all buttons", "what forms are on this page", "what can I click"`,
  inputSchema: {
    type: "object",
    properties: {
      instruction: {
        type: "string",
        description:
          "What to look for on the current page. Leave empty to discover all available actions.",
      },
    },
  },
  execute: async (args: { instruction?: string }) => {
    try {
      const { stagehand } = await getStagehandAndPage();
      const observations = await stagehand.observe(
        args.instruction || "What actions can I take on this page?",
      );
      return { observations };
    } catch (err: any) {
      return { error: true, message: err.message || String(err) };
    }
  },
};

// ── Tool 5: Screenshot ────────────────────────────────────────────────

export const BrowserAIScreenshotTool: NativeTool = {
  name: "browser_screenshot",
  description: `Take a screenshot of the current browser page. Returns a base64 encoded PNG image.`,
  inputSchema: {
    type: "object",
    properties: {
      fullPage: {
        type: "boolean",
        description: "Capture full scrollable page. Default false.",
      },
    },
  },
  execute: async (args: { fullPage?: boolean }) => {
    try {
      const { page } = await getStagehandAndPage();
      if (!page) {
        return { error: true, message: "No page available for screenshot" };
      }
      const buffer = await page.screenshot({ fullPage: args.fullPage });
      return {
        message: "Screenshot taken",
        image_data: buffer.toString("base64"),
        mime_type: "image/png",
      };
    } catch (err: any) {
      return { error: true, message: err.message || String(err) };
    }
  },
};

// ── Tool 6: Get Page Content ──────────────────────────────────────────

export const BrowserAIGetContentTool: NativeTool = {
  name: "browser_get_content",
  description: `Get the text content of the current browser page. 
Automatically cleans markup, removes scripts/styles, and truncates to avoid token limits.`,
  inputSchema: {
    type: "object",
    properties: {
      maxLength: {
        type: "number",
        description: "Maximum character length. Default 8000.",
      },
    },
  },
  execute: async (args: { maxLength?: number }) => {
    try {
      const { stagehand, page } = await getStagehandAndPage();
      if (!page) {
        const result = await stagehand.extract(
          "Get the full text content of the page",
        );
        return {
          content: (result as any).extraction || JSON.stringify(result),
          url: "unknown",
          title: "unknown",
        };
      }
      const maxLength = args.maxLength || 8000;

      const result = await page.evaluate((maxLen: number) => {
        const clone = document.body.cloneNode(true) as HTMLElement;
        const remove = clone.querySelectorAll(
          "script, style, svg, noscript, iframe, nav, footer, header",
        );
        remove.forEach((el) => el.remove());

        let text = clone.innerText || "";
        text = text.replace(/\n\s*\n/g, "\n\n").trim();

        if (text.length > maxLen) {
          return (
            text.substring(0, maxLen) +
            `\n\n...[Truncated. Total: ${text.length}]...`
          );
        }
        return text;
      }, maxLength);

      return { content: result, url: page.url(), title: await page.title() };
    } catch (err: any) {
      return { error: true, message: err.message || String(err) };
    }
  },
};

// ── Tool 7: Close Browser ─────────────────────────────────────────────

export const BrowserAICloseTool: NativeTool = {
  name: "browser_close",
  description: "Close the AI-controlled browser instance.",
  inputSchema: {
    type: "object",
    properties: {},
  },
  execute: async () => {
    try {
      await stagehandManager.close();
      return { status: "Browser closed" };
    } catch (err: any) {
      return { error: true, message: err.message || String(err) };
    }
  },
};

// ── Export All ─────────────────────────────────────────────────────────

export const BrowserAITools = [
  BrowserAINavigateTool,
  BrowserAIActTool,
  BrowserAIExtractTool,
  BrowserAIObserveTool,
  BrowserAIScreenshotTool,
  BrowserAIGetContentTool,
  BrowserAICloseTool,
];
