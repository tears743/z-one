import { chromium, Browser, Page, BrowserContext } from "playwright";
import { NativeTool } from "../../tool-registry";
import { logger } from "../../../logger";

class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  async getPage(): Promise<Page> {
    if (!this.browser) {
      this.browser = await chromium.launch({ headless: false }); // Visible for user to see
    }
    if (!this.context) {
      this.context = await this.browser.newContext();
    }
    if (!this.page) {
      this.page = await this.context.newPage();
    }
    return this.page;
  }

  async close() {
    if (this.page) await this.page.close();
    if (this.context) await this.context.close();
    if (this.browser) await this.browser.close();
    this.page = null;
    this.context = null;
    this.browser = null;
  }
}

const browserManager = new BrowserManager();

export const BrowserNavigateTool: NativeTool = {
  name: "browser_navigate",
  description:
    "Navigate to a URL using a browser. Launches the browser if not already open.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "The URL to navigate to" },
    },
    required: ["url"],
  },
  execute: async (args: { url: string }) => {
    const page = await browserManager.getPage();
    await page.goto(args.url);
    const title = await page.title();
    return { title, url: page.url() };
  },
};

export const BrowserClickTool: NativeTool = {
  name: "browser_click",
  description: "Click an element on the current page using a CSS selector.",
  inputSchema: {
    type: "object",
    properties: {
      selector: { type: "string", description: "CSS selector to click" },
    },
    required: ["selector"],
  },
  execute: async (args: { selector: string }) => {
    const page = await browserManager.getPage();
    await page.click(args.selector);
    return { status: "clicked", selector: args.selector };
  },
};

export const BrowserTypeTool: NativeTool = {
  name: "browser_type",
  description: "Type text into an input element on the current page.",
  inputSchema: {
    type: "object",
    properties: {
      selector: { type: "string", description: "CSS selector of the input" },
      text: { type: "string", description: "Text to type" },
    },
    required: ["selector", "text"],
  },
  execute: async (args: { selector: string; text: string }) => {
    const page = await browserManager.getPage();
    await page.fill(args.selector, args.text);
    return { status: "typed", selector: args.selector };
  },
};

export const BrowserGetContentTool: NativeTool = {
  name: "browser_get_content",
  description:
      "Get the text content or HTML of the current page or a specific element. Automatically cleans and truncates content to avoid token limits.",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description:
            "Optional CSS selector to get content from. If omitted, returns full page text.",
        },
        asHtml: {
          type: "boolean",
          description: "If true, returns HTML instead of text. Default false.",
        },
        maxLength: {
          type: "number",
          description: "Maximum character length. Default 8000.",
        },
      },
    },
    execute: async (args: {
      selector?: string;
      asHtml?: boolean;
      maxLength?: number;
    }) => {
      const page = await browserManager.getPage();
      const maxLength = args.maxLength || 8000;
  
      if (args.selector) {
      if (args.asHtml) {
        const html = await page.innerHTML(args.selector);
        return html.length > maxLength
          ? html.substring(0, maxLength) + "...[Truncated]"
          : html;
      } else {
        const text = await page.innerText(args.selector);
        return text.length > maxLength
          ? text.substring(0, maxLength) + "...[Truncated]"
          : text;
      }
    } else {
      if (args.asHtml) {
        const content = await page.content();
        return content.length > maxLength
          ? content.substring(0, maxLength) + "...[Truncated]"
          : content;
      } else {
        // Smart content extraction to save tokens
        const result = await page.evaluate((maxLen) => {
          function cleanup(node: Node) {
            // Remove comments
            if (node.nodeType === 8) {
              node.parentNode?.removeChild(node);
              return;
            }
            // Remove unwanted tags
            if (node.nodeType === 1) {
              const el = node as Element;
              const tagName = el.tagName.toLowerCase();
              if (
                [
                  "script",
                  "style",
                  "svg",
                  "noscript",
                  "iframe",
                  "object",
                  "embed",
                  "link",
                ].includes(tagName)
              ) {
                el.parentNode?.removeChild(el);
                return;
              }
              // Hide base64 images to save massive space
              if (tagName === "img") {
                const img = el as HTMLImageElement;
                if (img.src.startsWith("data:")) {
                  img.src = "";
                  img.alt = "[Base64 Image Removed]";
                }
              }
            }
            // Recurse
            let child = node.firstChild;
            while (child) {
              const next = child.nextSibling;
              cleanup(child);
              child = next;
            }
          }

          // Clone body to not affect the actual page
          const clone = document.body.cloneNode(true) as HTMLElement;
          cleanup(clone);

          let text = clone.innerText || "";
          // Collapse multiple newlines
          text = text.replace(/\n\s*\n/g, "\n\n");

          if (text.length > maxLen) {
            return (
              text.substring(0, maxLen) +
              `\n\n...[Content Truncated due to length limit of ${maxLen} chars]...`
            );
          }
          return text;
        }, maxLength);

        return result;
      }
    }
  },
};

export const BrowserScreenshotTool: NativeTool = {
  name: "browser_screenshot",
  description: "Take a screenshot of the current page. Returns base64 image.",
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
    const page = await browserManager.getPage();
    const buffer = await page.screenshot({ fullPage: args.fullPage });
    return {
      message: "Screenshot taken",
      image_data: buffer.toString("base64"),
      mime_type: "image/png",
    };
  },
};

export const BrowserTools = [
  BrowserNavigateTool,
  BrowserClickTool,
  BrowserTypeTool,
  BrowserGetContentTool,
  BrowserScreenshotTool,
];
