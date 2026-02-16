import { NativeTool } from "../../../tool-registry";
import {
  mouse,
  keyboard,
  screen,
  Point,
  Button,
  Key,
  straightTo,
  centerOf,
  Region,
} from "@nut-tree/nut-js";
import { desktopCapturer, screen as electronScreen } from "electron";

// Map string keys to Nut-js Key enum
const KeyMap: Record<string, Key> = {
  enter: Key.Enter,
  escape: Key.Escape,
  backspace: Key.Backspace,
  tab: Key.Tab,
  space: Key.Space,
  up: Key.Up,
  down: Key.Down,
  left: Key.Left,
  right: Key.Right,
  home: Key.Home,
  end: Key.End,
  pageup: Key.PageUp,
  pagedown: Key.PageDown,
  insert: Key.Insert,
  delete: Key.Delete,
  printscreen: Key.Print,
  f1: Key.F1,
  f2: Key.F2,
  f3: Key.F3,
  f4: Key.F4,
  f5: Key.F5,
  f6: Key.F6,
  f7: Key.F7,
  f8: Key.F8,
  f9: Key.F9,
  f10: Key.F10,
  f11: Key.F11,
  f12: Key.F12,
  cmd: Key.LeftCmd,
  command: Key.LeftCmd,
  ctrl: Key.LeftControl,
  control: Key.LeftControl,
  alt: Key.LeftAlt,
  shift: Key.LeftShift,
  left_cmd: Key.LeftCmd,
  right_cmd: Key.RightCmd,
  left_ctrl: Key.LeftControl,
  right_ctrl: Key.RightControl,
  left_alt: Key.LeftAlt,
  right_alt: Key.RightAlt,
  left_shift: Key.LeftShift,
  right_shift: Key.RightShift,
  a: Key.A,
  b: Key.B,
  c: Key.C,
  d: Key.D,
  e: Key.E,
  f: Key.F,
  g: Key.G,
  h: Key.H,
  i: Key.I,
  j: Key.J,
  k: Key.K,
  l: Key.L,
  m: Key.M,
  n: Key.N,
  o: Key.O,
  p: Key.P,
  q: Key.Q,
  r: Key.R,
  s: Key.S,
  t: Key.T,
  u: Key.U,
  v: Key.V,
  w: Key.W,
  x: Key.X,
  y: Key.Y,
  z: Key.Z,
  "0": Key.Num0,
  "1": Key.Num1,
  "2": Key.Num2,
  "3": Key.Num3,
  "4": Key.Num4,
  "5": Key.Num5,
  "6": Key.Num6,
  "7": Key.Num7,
  "8": Key.Num8,
  "9": Key.Num9,
};

function getKey(keyName: string): Key {
  const key = KeyMap[keyName.toLowerCase()];
  if (key === undefined) {
    // Try to map single characters
    if (keyName.length === 1) {
      // @ts-ignore
      return Key[keyName.toUpperCase()] || Key[keyName];
    }
    throw new Error(`Unknown key: ${keyName}`);
  }
  return key;
}

export const ComputerTool: NativeTool = {
  name: "computer",
  description: `Control the local computer's mouse, keyboard, and screen. 
Use this tool to perform precise UI interactions. 
Coordinate system: (0, 0) is the top-left corner of the primary screen.
For 'click', 'double_click', 'right_click', 'drag', you must provide coordinates.
For 'type', provide the text content.
For 'hotkey', provide an array of keys (e.g., ['ctrl', 'c']).
For 'screenshot', it returns a base64 encoded image of the primary screen.`,
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [
          "click",
          "double_click",
          "right_click",
          "drag",
          "type",
          "hotkey",
          "scroll",
          "wait",
          "screenshot",
          "cursor_position",
          "screen_info",
          "active_window",
        ],
        description: "The action to perform on the computer.",
      },
      coordinate: {
        type: "array",
        items: { type: "number" },
        minItems: 2,
        maxItems: 2,
        description:
          "The [x, y] coordinates for mouse actions (required for click, double_click, right_click, drag).",
      },
      end_coordinate: {
        type: "array",
        items: { type: "number" },
        minItems: 2,
        maxItems: 2,
        description:
          "The [x, y] coordinates for the end point of a drag action.",
      },
      text: {
        type: "string",
        description: "The text to type (required for 'type' action).",
      },
      keys: {
        type: "array",
        items: { type: "string" },
        description:
          "Array of keys to press together for 'hotkey' action (e.g., ['control', 'c']).",
      },
      scroll_direction: {
        type: "string",
        enum: ["up", "down", "left", "right"],
        description: "Direction to scroll (default: down).",
      },
      scroll_amount: {
        type: "number",
        description: "Amount to scroll in pixels/steps (default: 100).",
      },
      duration: {
        type: "number",
        description: "Duration in milliseconds to wait (for 'wait' action).",
      },
    },
    required: ["action"],
  },
  execute: async (args: {
    action: string;
    coordinate?: [number, number];
    end_coordinate?: [number, number];
    text?: string;
    keys?: string[];
    scroll_direction?: "up" | "down" | "left" | "right";
    scroll_amount?: number;
    duration?: number;
  }) => {
    try {
      // Helper to convert agent coordinates (relative to screenshot) to nut.js coordinates (logical)
      const getScaledPoint = async (x: number, y: number): Promise<Point> => {
        // On Windows, nut.js (and the underlying OS APIs) usually work with physical pixels,
        // especially when the app is DPI-aware (which Electron is).
        // UI-TARS also uses physical coordinates directly on Windows.
        if (process.platform === "win32") {
          return new Point(x, y);
        }

        const primaryDisplay = electronScreen.getPrimaryDisplay();
        const { scaleFactor, size: logicalSize } = primaryDisplay;
        // Physical size = logicalSize * scaleFactor
        // Screenshot from desktopCapturer (if full res) is usually physical size on Windows.
        // BUT, we need to know what the Agent SAW.
        // If the Agent saw a screenshot of width W, and wants to click x,
        // we assume x is in 0..W range.

        // Nut.js uses logical coordinates.
        // If the screenshot was physical (W_phys = W_log * scale),
        // then x_log = x_phys / scale.

        // We will assume the agent sees the Physical resolution if we send full res screenshot.
        // So we divide by scaleFactor.

        return new Point(x / scaleFactor, y / scaleFactor);
      };

      switch (args.action) {
        case "click":
          if (!args.coordinate)
            throw new Error("Coordinate required for click");
          const clickPoint = await getScaledPoint(
            args.coordinate[0],
            args.coordinate[1],
          );
          await mouse.move(straightTo(clickPoint));
          await mouse.click(Button.LEFT);
          return `Clicked at [${args.coordinate[0]}, ${args.coordinate[1]}] (Logical: [${clickPoint.x}, ${clickPoint.y}])`;

        case "double_click":
          if (!args.coordinate)
            throw new Error("Coordinate required for double_click");
          const doubleClickPoint = await getScaledPoint(
            args.coordinate[0],
            args.coordinate[1],
          );
          await mouse.move(straightTo(doubleClickPoint));
          await mouse.doubleClick(Button.LEFT);
          return `Double clicked at [${args.coordinate[0]}, ${args.coordinate[1]}]`;

        case "right_click":
          if (!args.coordinate)
            throw new Error("Coordinate required for right_click");
          const rightClickPoint = await getScaledPoint(
            args.coordinate[0],
            args.coordinate[1],
          );
          await mouse.move(straightTo(rightClickPoint));
          await mouse.click(Button.RIGHT);
          return `Right clicked at [${args.coordinate[0]}, ${args.coordinate[1]}]`;

        case "drag":
          if (!args.coordinate || !args.end_coordinate)
            throw new Error("Start and end coordinates required for drag");
          const startPoint = await getScaledPoint(
            args.coordinate[0],
            args.coordinate[1],
          );
          const endPoint = await getScaledPoint(
            args.end_coordinate[0],
            args.end_coordinate[1],
          );
          await mouse.move(straightTo(startPoint));
          await mouse.drag(straightTo(endPoint));
          return `Dragged from [${args.coordinate[0]}, ${args.coordinate[1]}] to [${args.end_coordinate[0]}, ${args.end_coordinate[1]}]`;

        case "type":
          if (!args.text) throw new Error("Text required for type");
          // Nut-js typing is slow for long text, maybe use clipboard for large text if appropriate,
          // but 'type' implies keystrokes.
          // To ensure reliability, we can use clipboard paste for long text if it's safe?
          // UI-TARS implementation uses clipboard paste for "type" if content is long/complex to avoid issues.
          // Let's implement a safe typing mechanism.
          await keyboard.type(args.text);
          return `Typed: "${args.text}"`;

        case "hotkey":
          if (!args.keys || args.keys.length === 0)
            throw new Error("Keys required for hotkey");
          const mappedKeys = args.keys.map((k) => getKey(k));
          await keyboard.pressKey(...mappedKeys);
          await keyboard.releaseKey(...mappedKeys);
          return `Pressed hotkey: ${args.keys.join("+")}`;

        case "scroll":
          const amount = args.scroll_amount || 100;
          const direction = args.scroll_direction || "down";
          if (direction === "down") await mouse.scrollDown(amount);
          else if (direction === "up") await mouse.scrollUp(amount);
          else if (direction === "left") await mouse.scrollLeft(amount);
          else if (direction === "right") await mouse.scrollRight(amount);
          return `Scrolled ${direction} by ${amount}`;

        case "wait":
          const ms = args.duration || 1000;
          await new Promise((resolve) => setTimeout(resolve, ms));
          return `Waited ${ms}ms`;

        case "cursor_position":
          const pos = await mouse.getPosition();
          return `Cursor is at [${pos.x}, ${pos.y}]`;

        case "screen_info":
          const primaryDisplay = electronScreen.getPrimaryDisplay();
          const { width, height } = primaryDisplay.size; // Logical size
          const scaleFactor = primaryDisplay.scaleFactor;
          const physicalWidth = width * scaleFactor;
          const physicalHeight = height * scaleFactor;
          return `Screen resolution: Logical ${width}x${height}, Physical ${physicalWidth}x${physicalHeight}, Scale Factor: ${scaleFactor}`;

        case "active_window":
          try {
            // Dynamic import for ESM/CJS compatibility (active-win is ESM)
            const { default: activeWindow } =
              (await import("active-win")) as any;
            const win = await activeWindow();
            if (!win) return "No active window found";
            return JSON.stringify(win);
          } catch (e: any) {
            return `Failed to get active window: ${e.message}`;
          }

        case "screenshot":
          const sources = await desktopCapturer.getSources({
            types: ["screen"],
            thumbnailSize: { width: 1920 * 2, height: 1080 * 2 }, // Ask for high res
          });
          const primarySource = sources[0];
          if (!primarySource) throw new Error("No screen source found");
          const image = primarySource.thumbnail.toDataURL();

          const display = electronScreen.getPrimaryDisplay();
          // We provide this info so the LLM knows what coordinate system to use (Physical usually)
          return JSON.stringify({
            message: "Screenshot taken",
            size_bytes: image.length,
            logical_size: display.size,
            scale_factor: display.scaleFactor,
            physical_size: {
              width: display.size.width * display.scaleFactor,
              height: display.size.height * display.scaleFactor,
            },
            note: "Coordinates in actions should be relative to the Physical Size if the screenshot is full resolution.",
          });

        default:
          throw new Error(`Unknown action: ${args.action}`);
      }
    } catch (e: any) {
      throw new Error(`Computer tool error: ${e.message}`);
    }
  },
};
