import * as fs from "fs";
import * as path from "path";
import { addMemory } from "./manager";
import { deleteFragmentsBySource } from "./store";
import { logger } from "../logger";

export class MemoryIndexer {
  private watchedFiles: Map<string, fs.FSWatcher> = new Map();
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private watchedDirs: Map<string, fs.FSWatcher> = new Map();

  constructor() {}

  public watchDirectory(dirPath: string) {
    if (this.watchedDirs.has(dirPath)) return;

    if (!fs.existsSync(dirPath)) {
      logger.warn(`[MemoryIndexer] Directory not found: ${dirPath}`);
      return;
    }

    logger.info(`[MemoryIndexer] Watching directory recursively: ${dirPath}`);

    // Initial Scan & Index
    this.scanAndIndex(dirPath);

    try {
      // Recursive watch (supported on Windows/macOS)
      const watcher = fs.watch(
        dirPath,
        { recursive: true },
        (eventType, filename) => {
          if (!filename) return;

          // Normalize path
          const fullPath = path.join(dirPath, filename.toString());

          // Filter ignored
          if (this.isIgnored(fullPath)) return;

          // Check existence to determine add/change vs delete
          if (fs.existsSync(fullPath)) {
            const stats = fs.statSync(fullPath);
            if (stats.isFile()) {
              this.handleFileChange(fullPath);
            }
          } else {
            this.handleFileDelete(fullPath);
          }
        },
      );

      this.watchedDirs.set(dirPath, watcher);
    } catch (error) {
      logger.error(
        `[MemoryIndexer] Failed to watch directory ${dirPath}:`,
        error,
      );
    }
  }

  private isIgnored(filePath: string): boolean {
    const ignored = [
      "node_modules",
      ".git",
      "out",
      "dist",
      ".DS_Store",
      "package-lock.json",
      "pnpm-lock.yaml",
      "yarn.lock",
      ".env",
    ];
    return ignored.some(
      (i) => filePath.includes(path.sep + i) || filePath.includes("/" + i),
    );
  }

  private async scanAndIndex(dirPath: string) {
    try {
      const files = await fs.promises.readdir(dirPath, { withFileTypes: true });
      for (const file of files) {
        const fullPath = path.join(dirPath, file.name);
        if (this.isIgnored(fullPath)) continue;

        if (file.isDirectory()) {
          await this.scanAndIndex(fullPath);
        } else if (file.isFile()) {
          // Index supported file types
          if (this.isSupportedFile(fullPath)) {
            await this.indexFile(fullPath);
          }
        }
      }
    } catch (error) {
      logger.error(
        `[MemoryIndexer] Failed to scan directory ${dirPath}:`,
        error,
      );
    }
  }

  private isSupportedFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return [".md", ".ts", ".js", ".json", ".txt", ".tsx", ".jsx"].includes(ext);
  }

  public watchFile(filePath: string) {
    // ... existing watchFile logic kept for single file watching ...
    if (this.watchedFiles.has(filePath)) return;

    if (!fs.existsSync(filePath)) {
      logger.warn(`[MemoryIndexer] File not found: ${filePath}`);
      return;
    }

    logger.info(`[MemoryIndexer] Watching file: ${filePath}`);

    // Initial Indexing
    this.indexFile(filePath);

    try {
      const watcher = fs.watch(filePath, (eventType) => {
        if (eventType === "change" || eventType === "rename") {
          // Check if file still exists
          if (fs.existsSync(filePath)) {
            this.handleFileChange(filePath);
          } else {
            // File deleted
            this.handleFileDelete(filePath);
          }
        }
      });
      this.watchedFiles.set(filePath, watcher);
    } catch (error) {
      logger.error(`[MemoryIndexer] Failed to watch file ${filePath}:`, error);
    }
  }

  private handleFileDelete(filePath: string) {
    logger.info(`[MemoryIndexer] File deleted: ${filePath}`);
    deleteFragmentsBySource(filePath);
    const watcher = this.watchedFiles.get(filePath);
    if (watcher) {
      watcher.close();
      this.watchedFiles.delete(filePath);
    }
  }

  private handleFileChange(filePath: string) {
    // Debounce
    if (this.debounceTimers.has(filePath)) {
      clearTimeout(this.debounceTimers.get(filePath)!);
    }

    const timer = setTimeout(() => {
      this.indexFile(filePath);
      this.debounceTimers.delete(filePath);
    }, 2000); // 2 second debounce to ensure write complete

    this.debounceTimers.set(filePath, timer);
  }

  private async indexFile(filePath: string) {
    if (!this.isSupportedFile(filePath)) return;

    logger.info(`[MemoryIndexer] Indexing file: ${filePath}`);
    try {
      const content = await fs.promises.readFile(filePath, "utf-8");

      // 1. Clear old fragments for this file
      deleteFragmentsBySource(filePath);

      const chunks = this.splitContent(content, filePath);

      for (const chunk of chunks) {
        if (!chunk.trim()) continue;
        for (const piece of this.splitByLength(chunk)) {
          if (!piece.trim()) continue;
          await addMemory(
            piece,
            "knowledge",
            filePath,
            ["file-memory", path.extname(filePath)],
            "global",
          );
        }
      }

      logger.info(
        `[MemoryIndexer] Indexed ${chunks.length} chunks from ${filePath}`,
      );
    } catch (error) {
      logger.error(`[MemoryIndexer] Failed to index file ${filePath}:`, error);
    }
  }

  private splitContent(content: string, filePath: string): string[] {
    const ext = path.extname(filePath).toLowerCase();

    if (ext === ".md") {
      return this.splitMarkdown(content);
    } else {
      return this.splitCode(content);
    }
  }

  private splitMarkdown(content: string): string[] {
    // Simple splitting by headers for Markdown
    const lines = content.split("\n");
    const chunks: string[] = [];
    let currentChunk: string[] = [];

    for (const line of lines) {
      if (line.startsWith("#")) {
        if (currentChunk.length > 0) {
          chunks.push(currentChunk.join("\n"));
        }
        currentChunk = [line];
      } else {
        currentChunk.push(line);
      }
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk.join("\n"));
    }

    return chunks;
  }

  private splitCode(content: string): string[] {
    const lines = content.split("\n");
    const chunks: string[] = [];
    const CHUNK_SIZE = 50;
    const OVERLAP = 10;

    for (let i = 0; i < lines.length; i += CHUNK_SIZE - OVERLAP) {
      const chunk = lines.slice(i, i + CHUNK_SIZE).join("\n");
      if (chunk.trim()) {
        chunks.push(chunk);
      }
    }
    return chunks;
  }

  private splitByLength(
    content: string,
    maxLength: number = 4000,
    overlap: number = 200,
  ): string[] {
    if (content.length <= maxLength) return [content];
    const result: string[] = [];
    let start = 0;
    while (start < content.length) {
      const end = Math.min(start + maxLength, content.length);
      result.push(content.slice(start, end));
      if (end === content.length) break;
      start = end - overlap;
      if (start < 0) start = 0;
    }
    return result;
  }
}

export const memoryIndexer = new MemoryIndexer();
