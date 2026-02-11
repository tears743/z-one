import { spawn } from "child_process";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import * as crypto from "crypto";

export interface UIElement {
  Name: string;
  ControlType: string;
  ClassName: string;
  AutomationId: string;
  BoundingRectangle: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  IsEnabled: boolean;
  IsVisible: boolean;
  IsActive?: boolean;
  Children?: UIElement[];
  _id?: number; // Internal ID for interaction mapping
}

// Global registry to map IDs to elements (Simple in-memory store)
// Reset on each screenshot capture
export const ElementRegistry = {
  elements: new Map<number, UIElement>(),

  clear() {
    this.elements.clear();
  },

  register(element: UIElement): number {
    const id = this.elements.size + 1;
    element._id = id;
    this.elements.set(id, element);
    return id;
  },

  get(id: number): UIElement | undefined {
    return this.elements.get(id);
  },
};

export interface PeekabooProvider {
  getActiveWindowTree(depth?: number): Promise<UIElement | null>;
  getDesktopTree(depth?: number): Promise<UIElement | null>;
  getScreenshot(): Promise<string>; // Base64 string
}

class PeekabooWindows implements PeekabooProvider {
  private scriptPath: string;

  constructor() {
    // Search strategy for the PowerShell script:
    // 1. Next to the JS file (bundled/copied)
    // 2. In resources (prod unpacked)
    // 3. Source location (dev)
    const candidates = [
      path.join(__dirname, "dump-tree.ps1"),
      path.join(
        process.cwd(),
        "src/main/execution/tools/peekaboo/dump-tree.ps1",
      ),
      path.join(
        __dirname,
        "../../../src/main/execution/tools/peekaboo/dump-tree.ps1",
      ),
    ];

    // Check if we are in Electron context and have resourcesPath
    // @ts-ignore
    if (process.resourcesPath) {
      // @ts-ignore
      candidates.unshift(path.join(process.resourcesPath, "dump-tree.ps1"));
    }

    this.scriptPath = candidates.find((p) => fs.existsSync(p)) || "";

    if (!this.scriptPath) {
      console.warn(
        "[Peekaboo] Warning: dump-tree.ps1 not found in candidates:",
        candidates,
      );
      // Fallback to default to allow error to propagate from spawn if needed
      this.scriptPath = path.join(__dirname, "dump-tree.ps1");
    }
  }

  async getScreenshot(): Promise<string> {
    try {
      const { screen, FileType } = await import("@nut-tree/nut-js");
      const Jimp = require("jimp");

      // 1. Capture screenshot
      const tempPath = path.join(
        os.tmpdir(),
        `screenshot_${crypto.randomBytes(8).toString("hex")}.png`,
      );
      await screen.capture(
        path.basename(tempPath),
        FileType.PNG,
        path.dirname(tempPath),
      );

      // 2. Load image with Jimp
      const image = await Jimp.read(tempPath);

      // 3. Get UI Tree for numbering
      // Use Desktop scope to cover everything visible on screen
      // Depth -1 usually means unlimited or very deep in many recursive implementations,
      // but let's check dump-tree.ps1. If it expects a number, we might need a large one.
      // Looking at dump-tree.ps1 logic: if ($Depth -gt 0) ... ($Depth - 1)
      // So -1 would stop immediately. We need a large number for "unlimited".
      const tree = await this.getDesktopTree(50);

      // Reset registry
      ElementRegistry.clear();

      // 4. Draw numbers
      if (tree) {
        const font = await Jimp.loadFont(Jimp.FONT_SANS_8_WHITE);
        const red = Jimp.cssColorToHex("#FF0000");

        // Keep track of labeled areas to avoid overlapping/duplicates
        const labeledAreas: {
          x: number;
          y: number;
          width: number;
          height: number;
        }[] = [];

        const isOverlapping = (rect1: any, rect2: any) => {
          return (
            rect1.x < rect2.x + rect2.width &&
            rect1.x + rect1.width > rect2.x &&
            rect1.y < rect2.y + rect2.height &&
            rect1.y + rect1.height > rect2.y
          );
        };

        const traverse = (node: UIElement) => {
          if (node.BoundingRectangle && node.IsVisible) {
            const { x, y, width, height } = node.BoundingRectangle;

            // Ensure coordinates are numbers
            if (
              typeof x !== "number" ||
              typeof y !== "number" ||
              typeof width !== "number" ||
              typeof height !== "number"
            )
              return;

            // Simple heuristic to filter out giant container elements that cover the whole screen
            // or very tiny elements
            if (width < 5 || height < 5) return;
            // if (width > 1000 && height > 800) return; // Optional: Skip very large containers

            // Check for duplicates/overlaps
            // If an element has the exact same bounds as one we already labeled, skip it
            // This happens often with container wrappers
            /*
            const duplicate = labeledAreas.find(
              (area) =>
                Math.abs(area.x - x) < 5 &&
                Math.abs(area.y - y) < 5 &&
                Math.abs(area.width - width) < 5 &&
                Math.abs(area.height - height) < 5,
            );

            if (duplicate) {
              if (node.Children) node.Children.forEach(traverse);
              return;
            }
            */

            // Register element and get ID
            const id = ElementRegistry.register(node);

            // Draw a red box or just a number? Number is cleaner.
            // Let's draw a small background rect for the number for visibility
            const label = id.toString();
            const textWidth = Jimp.measureText(font, label);
            const textHeight = Jimp.measureTextHeight(font, label, 100);

            // Draw label at top-left corner
            let labelX = x;
            let labelY = y;
            const labelWidth = textWidth + 4;
            const labelHeight = textHeight + 4;

            // Boundary check: ensure label stays within image dimensions
            const imageWidth = image.bitmap.width;
            const imageHeight = image.bitmap.height;

            if (labelX + labelWidth > imageWidth) {
              labelX = imageWidth - labelWidth;
            }
            if (labelX < 0) labelX = 0;

            if (labelY + labelHeight > imageHeight) {
              labelY = imageHeight - labelHeight;
            }
            if (labelY < 0) labelY = 0;

            // Check if this label overlaps with any existing label
            const labelOverlap = labeledAreas.some((area) => {
              return (
                labelX < area.x + area.width &&
                labelX + labelWidth > area.x &&
                labelY < area.y + area.height &&
                labelY + labelHeight > area.y
              );
            });

            if (labelOverlap) {
              // If label overlaps, skip it to avoid clutter
              // But we still traverse children
              if (node.Children) node.Children.forEach(traverse);
              return;
            }

            // Draw background rect
            image.scan(
              Math.floor(labelX),
              Math.floor(labelY),
              Math.ceil(labelWidth),
              Math.ceil(labelHeight),
              (lx: number, ly: number, idx: number) => {
                image.bitmap.data[idx + 0] = 255; // R
                image.bitmap.data[idx + 1] = 0; // G
                image.bitmap.data[idx + 2] = 0; // B
                image.bitmap.data[idx + 3] = 255; // Alpha
              },
            );

            // Draw text
            image.print(font, labelX + 2, labelY + 2, label);

            // Store the LABEL area, not the element area
            labeledAreas.push({
              x: labelX,
              y: labelY,
              width: labelWidth,
              height: labelHeight,
            });
          }
          if (Array.isArray(node.Children)) {
            node.Children.forEach(traverse);
          }
        };

        traverse(tree);
      }

      // 5. Resize and Compress for LLM
      // Large images consume too many tokens and may cause API errors
      // if (image.bitmap.width > 1280) {
      //   image.resize(1280, Jimp.AUTO);
      // }
      image.quality(100);

      // 6. Convert to Base64
      const buffer = await image.getBufferAsync(Jimp.MIME_PNG); // Use JPEG for smaller size

      // Clean up
      await fs.promises.unlink(tempPath).catch(() => {});

      // Return raw base64, service layer handles prefix if needed
      return buffer.toString("base64");
    } catch (error) {
      console.error("Screenshot failed:", error);
      throw new Error(`Failed to capture screenshot: ${error}`);
    }
  }

  private async runScript(
    target: "Active" | "Desktop",
    depth: number = 5,
  ): Promise<UIElement | null> {
    const tempFile = path.join(
      os.tmpdir(),
      `peekaboo_${crypto.randomBytes(8).toString("hex")}.json`,
    );

    return new Promise((resolve, reject) => {
      const ps = spawn("powershell.exe", [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        this.scriptPath,
        "-Target",
        target,
        "-Depth",
        depth.toString(),
        "-OutputFile",
        tempFile,
      ]);

      let stderr = "";

      ps.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      ps.on("close", async (code) => {
        if (code !== 0) {
          reject(
            new Error(`PowerShell script exited with code ${code}: ${stderr}`),
          );
          if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
          return;
        }

        try {
          if (!fs.existsSync(tempFile)) {
            // If no file created, maybe empty result?
            resolve(null);
            return;
          }

          let content = fs.readFileSync(tempFile, "utf8");
          fs.unlinkSync(tempFile); // Cleanup

          // Remove BOM if present
          content = content.replace(/^\uFEFF/, "");

          if (!content.trim() || content.trim() === "{}") {
            resolve(null);
            return;
          }
          const tree = JSON.parse(content);
          resolve(tree);
        } catch (error) {
          reject(new Error(`Failed to parse JSON output: ${error}`));
        }
      });

      ps.on("error", (err) => {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
        reject(err);
      });
    });
  }

  async getActiveWindowTree(depth: number = 5): Promise<UIElement | null> {
    return this.runScript("Active", depth);
  }

  async getDesktopTree(depth: number = 5): Promise<UIElement | null> {
    return this.runScript("Desktop", depth);
  }
}

class PeekabooMacOS implements PeekabooProvider {
  async getActiveWindowTree(depth?: number): Promise<UIElement | null> {
    throw new Error(
      "PeekabooMacOS: Not implemented yet. Pending macOS implementation.",
    );
  }

  async getDesktopTree(depth?: number): Promise<UIElement | null> {
    throw new Error(
      "PeekabooMacOS: Not implemented yet. Pending macOS implementation.",
    );
  }

  async getScreenshot(): Promise<string> {
    throw new Error(
      "PeekabooMacOS: Not implemented yet. Pending macOS implementation.",
    );
  }
}

export class PeekabooFactory {
  static getProvider(): PeekabooProvider {
    const platform = os.platform();
    if (platform === "win32") {
      return new PeekabooWindows();
    } else if (platform === "darwin") {
      return new PeekabooMacOS();
    } else {
      throw new Error(`Unsupported platform: ${platform}`);
    }
  }
}

// Export specific classes if needed for direct testing, but prefer factory
export { PeekabooWindows, PeekabooMacOS };
