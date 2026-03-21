import { join } from "path";
import { appendFileSync, existsSync, mkdirSync } from "fs";

// Graceful Electron import — fallback for CLI / non-Electron environments
let electronApp: any = null;
try {
  electronApp = require("electron").app;
} catch {
  // Not running in Electron — that's fine
}

export type LogLevel = "info" | "warn" | "error" | "debug";

class Logger {
  private logPath: string;
  private isPackaged: boolean;

  constructor() {
    let userDataPath: string;
    try {
      userDataPath = electronApp?.getPath?.("userData") || join(process.env.HOME || "/tmp", ".z-one");
    } catch {
      userDataPath = join(process.env.HOME || "/tmp", ".z-one");
    }
    this.isPackaged = electronApp?.isPackaged ?? true; // Default to packaged (no console) if unknown

    const logsDir = join(userDataPath, "logs");

    if (!existsSync(logsDir)) {
      mkdirSync(logsDir, { recursive: true });
    }

    const date = new Date().toISOString().split("T")[0];
    this.logPath = join(logsDir, `interaction-${date}.log`);
  }

  private formatMessage(level: LogLevel, message: string, meta?: any): string {
    const timestamp = new Date().toISOString();
    const metaStr = meta
      ? ` | ${JSON.stringify(
          meta instanceof Error
            ? { message: meta.message, stack: meta.stack }
            : meta,
        )}`
      : "";
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}\n`;
  }

  public log(level: LogLevel, message: string, meta?: any) {
    const logEntry = this.formatMessage(level, message, meta);

    // Console output for dev
    if (!this.isPackaged) {
      // In Windows console, unicode characters might display incorrectly depending on code page.
      // But Node.js console.log generally handles UTF-8 well if the terminal supports it.
      // The issue might be double encoding or font.
      // However, we can try to force log output encoding if needed, but usually not possible in JS directly.
      // Just log directly.
      console.log(logEntry.trim());

      // Also write to file in dev for checking encoding there
      try {
        appendFileSync(this.logPath, logEntry, "utf8");
      } catch (e) {
        console.error("Failed to write to log file:", e);
      }
      return;
    }

    try {
      appendFileSync(this.logPath, logEntry, "utf8");
    } catch (e) {
      console.error("Failed to write to log file:", e);
    }
  }

  public info(message: string, meta?: any) {
    this.log("info", message, meta);
  }

  public warn(message: string, meta?: any) {
    this.log("warn", message, meta);
  }

  public error(message: string, meta?: any) {
    this.log("error", message, meta);
  }

  public debug(message: string, meta?: any) {
    this.log("debug", message, meta);
  }
}

export const logger = new Logger();
