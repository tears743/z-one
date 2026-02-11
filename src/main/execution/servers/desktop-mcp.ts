import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { PeekabooFactory, ElementRegistry } from "../tools/peekaboo/index";

// We use nut.js for interactions
let mouse: any, straightTo: any, Point: any, keyboard: any, Key: any;

async function initNutJs() {
  try {
    const nut = await import("@nut-tree/nut-js");
    mouse = nut.mouse;
    straightTo = nut.straightTo;
    Point = nut.Point;
    keyboard = nut.keyboard;
    Key = nut.Key;
  } catch (e) {
    console.error("Failed to load nut.js:", e);
  }
}

// Create server instance
const server = new Server(
  {
    name: "z-one-desktop-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

const peekaboo = PeekabooFactory.getProvider();

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_active_window_tree",
        description: "Get the UI tree of the currently active window",
        inputSchema: convertZodToJsonSchema(
          z.object({
            depth: z
              .number()
              .optional()
              .describe("Traversal depth (default: 5)"),
          }),
        ),
      },
      {
        name: "get_desktop_tree",
        description:
          "Get the UI tree of the entire desktop (use with caution, large output)",
        inputSchema: convertZodToJsonSchema(
          z.object({
            depth: z
              .number()
              .optional()
              .describe("Traversal depth (default: 3)"),
          }),
        ),
      },
      {
        name: "get_screenshot",
        description:
          "Capture the full screen screenshot as a base64 encoded PNG image with element numbering",
        inputSchema: convertZodToJsonSchema(z.object({})),
      },
      {
        name: "click_element",
        description: "Click on an element by its ID (from screenshot)",
        inputSchema: convertZodToJsonSchema(
          z.object({
            elementId: z.number().describe("The ID of the element to click"),
            clickType: z
              .enum(["left", "right", "double"])
              .optional()
              .describe("Type of click (default: left)"),
          }),
        ),
      },
      {
        name: "type_text",
        description: "Type text (optionally clicking an element first)",
        inputSchema: convertZodToJsonSchema(
          z.object({
            text: z.string().describe("The text to type"),
            elementId: z
              .number()
              .optional()
              .describe("The ID of the element to click before typing"),
          }),
        ),
      },
    ],
  };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "get_active_window_tree") {
      const depth = (args as any)?.depth || 5;
      const tree = await peekaboo.getActiveWindowTree(depth);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(tree, null, 2),
          },
        ],
      };
    } else if (name === "get_desktop_tree") {
      const depth = (args as any)?.depth || 3;
      const tree = await peekaboo.getDesktopTree(depth);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(tree, null, 2),
          },
        ],
      };
    } else if (name === "get_screenshot") {
      const imageBase64 = await peekaboo.getScreenshot();
      return {
        content: [
          {
            type: "image",
            data: imageBase64,
            mimeType: "image/png",
          },
        ],
      };
    } else if (name === "click_element") {
      const elementId = (args as any)?.elementId;
      const clickType = (args as any)?.clickType || "left";

      const element = ElementRegistry.get(elementId);
      if (!element || !element.BoundingRectangle) {
        throw new Error(`Element with ID ${elementId} not found or invalid.`);
      }

      const { x, y, width, height } = element.BoundingRectangle;
      const centerX = x + width / 2;
      const centerY = y + height / 2;

      // Move and Click
      await mouse.move(straightTo(new Point(centerX, centerY)));

      if (clickType === "left") {
        await mouse.leftClick();
      } else if (clickType === "right") {
        await mouse.rightClick();
      } else if (clickType === "double") {
        await mouse.leftClick();
        await mouse.leftClick();
      }

      return {
        content: [
          {
            type: "text",
            text: `Clicked element ${elementId} at (${centerX}, ${centerY})`,
          },
        ],
      };
    } else if (name === "type_text") {
      const text = (args as any)?.text;
      const elementId = (args as any)?.elementId;

      if (elementId) {
        const element = ElementRegistry.get(elementId);
        if (!element || !element.BoundingRectangle) {
          throw new Error(`Element with ID ${elementId} not found or invalid.`);
        }
        const { x, y, width, height } = element.BoundingRectangle;
        const centerX = x + width / 2;
        const centerY = y + height / 2;
        await mouse.move(straightTo(new Point(centerX, centerY)));
        await mouse.leftClick();
      }

      await keyboard.type(text);

      return {
        content: [{ type: "text", text: `Typed "${text}"` }],
      };
    } else {
      throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: `Error executing ${name}: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
});

// Start the server
async function runServer() {
  await initNutJs();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Desktop MCP Server running on stdio");
}

runServer().catch((error) => {
  console.error("Fatal error in server:", error);
  process.exit(1);
});

// Helper to convert Zod schema to JSON Schema
function convertZodToJsonSchema(schema: z.ZodType): any {
  // Simplified conversion for basic types
  // For production, use zod-to-json-schema package
  // This is a minimal implementation for now
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const properties: any = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      properties[key] = { type: "string" }; // Default to string for simplicity in this stub
      if (value instanceof z.ZodNumber) properties[key].type = "number";
      if (value instanceof z.ZodString) properties[key].type = "string";
      if (value instanceof z.ZodBoolean) properties[key].type = "boolean";
      // Add more types as needed
      if (!value.isOptional()) required.push(key);
    }

    return {
      type: "object",
      properties,
      required: required.length > 0 ? required : undefined,
    };
  }
  return { type: "object" };
}
