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
    throw new Error(
      "PeekabooWindows: Screenshot requires @nut-tree/nut-js which is not installed. Please install it to use this feature.",
    );
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
