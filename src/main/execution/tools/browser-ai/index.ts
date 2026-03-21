import { Stagehand, CustomOpenAIClient } from "@browserbasehq/stagehand";
import OpenAI from "openai";
import { NativeTool, ToolContext } from "../../tool-registry";
import { logger } from "../../../logger";
import { getAppSettings } from "../../../db";

const INIT_TIMEOUT_MS = 30_000; // 30s timeout for browser launch

/**
 * StagehandManager — manages per-agent Stagehand instances.
 * Each agent gets its own browser process, providing full isolation.
 * Stagehand's act/extract/observe always operate on its internal page,
 * so sharing a single instance across agents doesn't work.
 */
class StagehandManager {
  /** agentId -> Stagehand instance */
  private instances: Map<string, Stagehand> = new Map();
  /** agentId -> init Promise (prevents concurrent init for same agent) */
  private initPromises: Map<string, Promise<Stagehand>> = new Map();
  /** Fallback instance for calls without agentId */
  private defaultInstance: Stagehand | null = null;
  private defaultInitPromise: Promise<Stagehand> | null = null;
  private lastError: string | null = null;

  /**
   * Stagehand-supported providers in priority order.
   */
  private static PREFERRED_PROVIDERS = ["google", "gemini", "openai", "anthropic"];

  private static PREFERRED_MODEL_PATTERNS = [
    "gemini",
    "gpt-4o",
    "computer-use",
    "claude",
  ];

  /**
   * Build an LLM client from the user's model settings.
   */
  private buildLLMClient() {
    const settings = getAppSettings();
    const allModels = settings.models || [];

    let model = this.findPreferredModel(allModels);

    if (!model) {
      const targetModelId = settings.activeModelId;
      model = allModels.find((m: any) => m.id === targetModelId);
    }

    if (!model) {
      throw new Error(
        "No LLM model configured. Please configure a model in settings.",
      );
    }

    const baseUrl = (model.baseUrl || "https://api.openai.com/v1").replace(
      /\/+$/,
      "",
    );

    logger.info(
      `[StagehandManager] Using model: ${model.modelId} (provider: ${model.provider}) at ${baseUrl}`,
    );

    const openaiClient = new OpenAI({
      baseURL: baseUrl,
      apiKey: model.apiKey || "dummy",
    });

    // Proxy: override sampling parameters for providers that reject non-default values
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

  private findPreferredModel(models: any[]): any | null {
    const enabledModels = models.filter(
      (m: any) => m.enabled && m.apiKey && m.modelType !== "embedding",
    );

    for (const provider of StagehandManager.PREFERRED_PROVIDERS) {
      const match = enabledModels.find((m: any) => m.provider === provider);
      if (match) {
        logger.info(`[StagehandManager] Found preferred model by provider: ${match.modelId}`);
        return match;
      }
    }

    for (const pattern of StagehandManager.PREFERRED_MODEL_PATTERNS) {
      const match = enabledModels.find((m: any) =>
        m.modelId?.toLowerCase().includes(pattern),
      );
      if (match) {
        logger.info(`[StagehandManager] Found preferred model by pattern: ${match.modelId}`);
        return match;
      }
    }

    logger.info("[StagehandManager] No preferred model found, will use active model.");
    return null;
  }

  /**
   * Create a new Stagehand instance (launches a separate browser process).
   */
  private async createInstance(label: string): Promise<Stagehand> {
    logger.info(`[StagehandManager] Creating Stagehand instance for: ${label}`);

    const stagehand = new Stagehand({
      env: "LOCAL",
      localBrowserLaunchOptions: {
        headless: false,
      },
      llmClient: this.buildLLMClient(),
      verbose: 1,
    });

    await Promise.race([
      stagehand.init(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(
            `Browser init timed out after ${INIT_TIMEOUT_MS / 1000}s. ` +
            `Ensure Chromium is installed: npx playwright install chromium`,
          )),
          INIT_TIMEOUT_MS,
        ),
      ),
    ]);

    logger.info(`[StagehandManager] Instance ready for: ${label}`);
    return stagehand;
  }

  /**
   * Get or create a Stagehand instance for a specific agent.
   * Each agent gets its own isolated browser.
   */
  async getInstanceForAgent(agentId: string): Promise<Stagehand> {
    // Return existing if alive
    const existing = this.instances.get(agentId);
    if (existing) return existing;

    // Prevent concurrent init for the same agent
    const pending = this.initPromises.get(agentId);
    if (pending) return pending;

    const promise = this.createInstance(`agent:${agentId}`)
      .then((stagehand) => {
        this.instances.set(agentId, stagehand);
        this.initPromises.delete(agentId);
        this.lastError = null;
        return stagehand;
      })
      .catch((err) => {
        this.initPromises.delete(agentId);
        this.lastError = err.message || String(err);
        logger.error(`[StagehandManager] Init failed for agent ${agentId}: ${this.lastError}`);
        throw err;
      });

    this.initPromises.set(agentId, promise);
    return promise;
  }

  /**
   * Get or create the default instance (for calls without agentId).
   */
  async getDefaultInstance(): Promise<Stagehand> {
    if (this.defaultInstance) return this.defaultInstance;
    if (this.defaultInitPromise) return this.defaultInitPromise;

    this.defaultInitPromise = this.createInstance("default")
      .then((stagehand) => {
        this.defaultInstance = stagehand;
        this.defaultInitPromise = null;
        this.lastError = null;
        return stagehand;
      })
      .catch((err) => {
        this.defaultInitPromise = null;
        this.lastError = err.message || String(err);
        throw err;
      });

    return this.defaultInitPromise;
  }

  /**
   * Close a specific agent's browser instance.
   */
  async closeAgent(agentId: string) {
    const instance = this.instances.get(agentId);
    if (instance) {
      try {
        await instance.close();
        logger.info(`[StagehandManager] Closed browser for agent: ${agentId}`);
      } catch (e) {
        logger.warn(`[StagehandManager] Error closing browser for agent ${agentId}`, e);
      }
      this.instances.delete(agentId);
    }
  }

  /**
   * Close all browser instances.
   */
  async close() {
    for (const [agentId, instance] of this.instances) {
      try {
        await instance.close();
        logger.info(`[StagehandManager] Closed browser for agent: ${agentId}`);
      } catch { /* best-effort */ }
    }
    this.instances.clear();

    if (this.defaultInstance) {
      try {
        await this.defaultInstance.close();
      } catch (e) {
        logger.warn("[StagehandManager] Error closing default stagehand", e);
      }
      this.defaultInstance = null;
      logger.info("[StagehandManager] Default Stagehand closed.");
    }

    this.lastError = null;
    await this.forceCleanup();
  }

  /**
   * Force-kill any orphan Chromium processes spawned by Playwright.
   */
  private async forceCleanup() {
    try {
      const { exec } = await import("child_process");
      const { promisify } = await import("util");
      const execAsync = promisify(exec);
      await execAsync('pkill -f "chromium.*--remote-debugging" 2>/dev/null || true');
    } catch { /* best-effort */ }
  }

  getLastError(): string | null {
    return this.lastError;
  }
}

export const stagehandManager = new StagehandManager();

// Guard: Stagehand's internal pino logger can crash when worker exits
process.on("uncaughtException", (err) => {
  if (
    err.message?.includes("the worker has exited") ||
    err.message?.includes("write after end")
  ) {
    return; // Stagehand/pino teardown race — safe to ignore
  }
  throw err;
});

/**
 * Helper: get a Stagehand instance and its page for a specific agent.
 * Each agent gets its own fully isolated browser instance.
 */
async function getStagehandAndPage(agentId?: string) {
  let stagehand: Stagehand;

  if (agentId) {
    stagehand = await stagehandManager.getInstanceForAgent(agentId);
  } else {
    stagehand = await stagehandManager.getDefaultInstance();
  }

  // Get the page from this agent's own stagehand instance
  let page: any = null;
  try {
    const ctx = (stagehand as any).context || (stagehand as any).ctx;
    if (ctx?.awaitActivePage) {
      const v3page = await ctx.awaitActivePage();
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
  execute: async (args: { url: string }, context?: ToolContext) => {
    try {
      const { stagehand, page } = await getStagehandAndPage(context?.agentId);
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
  execute: async (args: { action: string }, context?: ToolContext) => {
    try {
      const { stagehand } = await getStagehandAndPage(context?.agentId);
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
  execute: async (args: { instruction: string }, context?: ToolContext) => {
    try {
      const { stagehand } = await getStagehandAndPage(context?.agentId);
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
  execute: async (args: { instruction?: string }, context?: ToolContext) => {
    try {
      const { stagehand } = await getStagehandAndPage(context?.agentId);
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
  execute: async (args: { fullPage?: boolean }, context?: ToolContext) => {
    try {
      const { page } = await getStagehandAndPage(context?.agentId);
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
  execute: async (args: { maxLength?: number }, context?: ToolContext) => {
    try {
      const { stagehand, page } = await getStagehandAndPage(context?.agentId);
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
  execute: async (_args: any, context?: ToolContext) => {
    try {
      if (context?.agentId) {
        await stagehandManager.closeAgent(context.agentId);
      } else {
        await stagehandManager.close();
      }
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
