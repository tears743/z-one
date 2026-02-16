import { NativeTool } from "../../tool-registry";
import { PeekabooFactory, ElementRegistry } from "../peekaboo";
import { logger } from "../../../logger";

// Lazy load nut.js to avoid startup impact
const getNutJs = async () => {
  return import("@nut-tree/nut-js");
};

export const DesktopScreenshotTool: NativeTool = {
  name: "desktop_screenshot",
  description: `Capture a screenshot of the entire desktop screen with UI element annotations (IDs). 
Returns a base64 encoded image where actionable elements are labeled with numeric IDs.
Use these IDs with 'desktop_click' to interact with elements.
This tool is the primary way to "see" the screen.`,
  inputSchema: {
    type: "object",
    properties: {},
  },
  execute: async () => {
    try {
      const provider = PeekabooFactory.getProvider();
      const base64Image = await provider.getScreenshot();
      return {
        type: "image",
        data: base64Image,
        mimeType: "image/png",
        note: "Elements are labeled with red numbers. Use these IDs in desktop_click.",
      };
    } catch (error: any) {
      logger.error("Failed to take desktop screenshot", error);
      throw new Error(`Failed to take screenshot: ${error.message}`);
    }
  },
};

export const DesktopClickTool: NativeTool = {
  name: "desktop_click",
  description: `Click on a UI element on the desktop using its ID from the last screenshot.
You MUST have taken a screenshot first to populate the element registry.`,
  inputSchema: {
    type: "object",
    properties: {
      elementId: {
        type: "number",
        description: "The ID of the element to click (shown in the screenshot)",
      },
      clickType: {
        type: "string",
        enum: ["left", "right", "double"],
        description: "Type of click (default: left)",
      },
    },
    required: ["elementId"],
  },
  execute: async (args: {
    elementId: number;
    clickType?: "left" | "right" | "double";
  }) => {
    const { elementId, clickType = "left" } = args;
    const element = ElementRegistry.get(elementId);

    if (!element || !element.BoundingRectangle) {
      throw new Error(
        `Element with ID ${elementId} not found or invalid. Please take a new screenshot to refresh the registry.`,
      );
    }

    const { x, y, width, height } = element.BoundingRectangle;
    const centerX = x + width / 2;
    const centerY = y + height / 2;

    try {
      const { mouse, straightTo, Point, Button } = await getNutJs();
      await mouse.move(straightTo(new Point(centerX, centerY)));

      if (clickType === "left") {
        await mouse.click(Button.LEFT);
      } else if (clickType === "right") {
        await mouse.click(Button.RIGHT);
      } else if (clickType === "double") {
        await mouse.doubleClick(Button.LEFT);
      }

      return `Clicked element ${elementId} (${element.Name || "Unknown"}) at (${centerX}, ${centerY})`;
    } catch (error: any) {
      throw new Error(`Failed to click element ${elementId}: ${error.message}`);
    }
  },
};

export const DesktopTypeTool: NativeTool = {
  name: "desktop_type",
  description: "Type text on the desktop (simulates keyboard input).",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", description: "The text to type" },
    },
    required: ["text"],
  },
  execute: async (args: { text: string }) => {
    try {
      const { keyboard } = await getNutJs();
      await keyboard.type(args.text);
      return `Typed: "${args.text}"`;
    } catch (error: any) {
      throw new Error(`Failed to type text: ${error.message}`);
    }
  },
};

export const DesktopTools = [
  DesktopScreenshotTool,
  DesktopClickTool,
  DesktopTypeTool,
];
