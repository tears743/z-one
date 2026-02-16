import { app, shell, BrowserWindow, ipcMain, dialog } from "electron";
import { join } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import { McpHub } from "./control/mcp-hub";
import { ToolRegistry } from "./execution/tool-registry";
import { nativeTools } from "./execution/tools/native";
import { TeamOrchestrator } from "./team/orchestrator";
import { TaskManager } from "./control/manager";
import { LLMService } from "./model/llm-service";
import { Planner } from "./intelligence/planner";
import { AgentFactory } from "./agent/factory";
import {
  initDB,
  getAppSettings,
  saveAppSettings,
  getModels,
  saveModel,
  deleteModel,
} from "./db";
import { initMemoryStore } from "./memory/store";
import {
  addMemory,
  searchMemory,
  summarizeSession,
  setSettingsGetter,
} from "./memory/manager";
import { interactionManager } from "./interaction/manager";
// import icon from '../../resources/icon.png?asset'

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    frame: false, // Frameless window
    // ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
    },
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Initialize DB
  const dbPath = join(app.getPath("userData"), "z-one.db");
  console.log("DB Path:", dbPath);
  initDB(dbPath);

  // Initialize Memory Store
  initMemoryStore();
  setSettingsGetter(() => {
    try {
      return getAppSettings();
    } catch (e) {
      console.error("Failed to get settings:", e);
      return undefined;
    }
  });

  // Set app user model id for windows
  electronApp.setAppUserModelId("com.electron");

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  createWindow();

  // Initialize Interaction Manager
  interactionManager.start();

  // Initialize MCP Hub
  const mcpHub = new McpHub();
  const serverPath = join(__dirname, "desktop-mcp.js");

  // Initialize Tool Registry
  const toolRegistry = new ToolRegistry(mcpHub);
  nativeTools.forEach((t) => toolRegistry.registerNativeTool(t));

  // Resolve paths for additional MCP servers
  // In dev (electron-vite), __dirname points to out/main
  // The source files are in src/main/execution/servers
  // But electron-vite bundles everything referenced in entry points.
  // Since we are spawning these as separate processes with ts-node in dev, we need source paths.

  const isDev = !app.isPackaged;

  let filesystemServerPath: string;
  let scriptRunnerServerPath: string;

  if (isDev) {
    // Dev: Point to source .ts files
    filesystemServerPath = join(
      process.cwd(),
      "src/main/execution/servers/filesystem-mcp.ts",
    );
    scriptRunnerServerPath = join(
      process.cwd(),
      "src/main/execution/servers/script-runner-mcp.ts",
    );
  } else {
    // Prod: Point to bundled .js files (need to ensure they are built/copied)
    // For now, assuming they are in the same directory as main/index.js if bundled
    // OR we need to adjust build config to output them.
    // Let's assume for now they are not bundled by default entry point but we need to find them.
    // Temporary fallback for prod: assume same dir
    filesystemServerPath = join(
      __dirname,
      "execution/servers/filesystem-mcp.js",
    );
    scriptRunnerServerPath = join(
      __dirname,
      "execution/servers/script-runner-mcp.js",
    );
  }

  const taskManager = new TaskManager(toolRegistry);

  // Initialize Intelligence Layer
  const llmService = new LLMService();
  const agentFactory = new AgentFactory(llmService, toolRegistry);
  const teamOrchestrator = new TeamOrchestrator(
    llmService,
    toolRegistry,
    agentFactory,
  );
  const planner = new Planner(
    llmService,
    toolRegistry,
    taskManager,
    teamOrchestrator,
  );

  // Link Interaction Manager with Planner
  interactionManager.setPlanner(planner);

  // IPC Handlers Registration (Before app.whenReady to avoid race conditions with renderer)
  // MCP Handlers
  ipcMain.handle("mcp:call-tool", async (_, { serverName, toolName, args }) => {
    return await toolRegistry.callTool(toolName, args);
  });

  ipcMain.handle("mcp:get-tools", async () => {
    return await toolRegistry.getAllTools();
  });

  // Task Handlers
  ipcMain.handle("task:create-plan", (_, goal) => {
    return taskManager.createPlan(goal);
  });

  ipcMain.handle("task:add-task", (_, { description, toolName, toolArgs }) => {
    return taskManager.addTask(description, toolName, toolArgs);
  });

  ipcMain.handle("task:execute", async () => {
    return await taskManager.executePlan();
  });

  // Intelligence Handlers
  // ipcMain.handle("intelligence:plan", async (_, { goal, modelConfig }) => {
  //   return await planner.createPlanFromGoal(goal, modelConfig);
  // });

  // DB Handlers
  // Ensure we remove existing handlers to avoid duplicates on hot reload
  ipcMain.removeHandler("db:get-app-settings");
  ipcMain.removeHandler("db:save-app-settings");
  ipcMain.removeHandler("db:get-models");
  ipcMain.removeHandler("db:save-model");
  ipcMain.removeHandler("db:delete-model");

  ipcMain.handle("db:get-app-settings", () => getAppSettings());
  ipcMain.handle("db:save-app-settings", (_, settings) =>
    saveAppSettings(settings),
  );
  ipcMain.handle("db:get-models", () => getModels());
  ipcMain.handle("db:save-model", (_, model) => saveModel(model));
  ipcMain.handle("db:delete-model", (_, id) => deleteModel(id));

  // Memory Handlers
  ipcMain.handle("memory:add", async (_, { content, layer, sessionId }) => {
    return addMemory(content, layer, "user", [], sessionId || "global");
  });

  ipcMain.handle("memory:search", async (_, { query, layer, sessionId }) => {
    return searchMemory(query, {
      limit: 5,
      layer,
      sessionId: sessionId || "global",
    });
  });

  ipcMain.handle("memory:summarize", async (_, { messages, sessionId }) => {
    return summarizeSession(messages, sessionId || "global");
  });

  // Dialog Handlers
  ipcMain.on("window:minimize", () => {
    const win = BrowserWindow.getFocusedWindow();
    win?.minimize();
  });

  ipcMain.on("window:maximize", () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win?.isMaximized()) {
      win.unmaximize();
    } else {
      win?.maximize();
    }
  });

  ipcMain.on("window:close", () => {
    const win = BrowserWindow.getFocusedWindow();
    win?.close();
  });

  // Dialog Handlers (File/Folder Picker)
  ipcMain.handle("dialog:openDirectory", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ["openDirectory"],
    });
    if (canceled) {
      return null;
    } else {
      return filePaths[0];
    }
  });

  try {
    console.log("Starting Desktop MCP Server from:", serverPath);
    await mcpHub.connectToServer({
      id: "local-desktop",
      name: "Desktop Automation",
      command: process.execPath,
      args: [serverPath],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
      },
    });

    console.log("Starting Filesystem MCP Server from:", filesystemServerPath);
    // In dev mode, we use ts-node via electron-vite/esbuild output?
    // Actually, electron-vite bundles everything to out/main.
    // We need to make sure these new servers are also bundled or runnable.
    // For now, let's assume we run them as TS in dev, or compiled JS in prod.
    // But since they are new files, we might need to adjust build config or just run them.
    // Simpler approach for now: Run them using ts-node/tsx in dev if possible, or expect them to be built.

    // Check if we are in dev or prod
    // const isDev = !app.isPackaged; // Moved up

    // For now, let's just try running them. If they are TS files, we need ts-node.
    // But Electron main process is already running.
    // Best practice: Build them as separate entry points in electron-vite.config.ts
    // For this immediate task without modifying build config, we might struggle running .ts files directly.

    // Alternative: Register them in-process? McpHub uses StdioClientTransport which spawns processes.
    // If we want to spawn them, they need to be valid JS files.
    // Let's assume for a moment we will add them to build config later.
    // OR: We can use `ts-node` to run them if available.

    // Let's try to run them assuming they will be built to .js in the same dir structure in dist/out.
    // In dev: src/main/execution/servers/filesystem-mcp.ts
    // In prod: resources/app.asar/out/main/execution/servers/filesystem-mcp.js ?

    // Fix paths for build output structure
    // electron-vite usually outputs to out/main/index.js
    // We need to ensure these files are included.

    // TEMPORARY FIX: We will just try to run them. If it fails, we know we need build config update.

    await mcpHub.connectToServer({
      id: "filesystem",
      name: "File System",
      command: "npx",
      args: ["ts-node", filesystemServerPath], // Dev mode assumption
      env: Object.fromEntries(
        Object.entries(process.env).filter(([, v]) => v !== undefined),
      ) as Record<string, string>,
    });

    await mcpHub.connectToServer({
      id: "script-runner",
      name: "Script Runner",
      command: "npx",
      args: ["ts-node", scriptRunnerServerPath], // Dev mode assumption
      env: Object.fromEntries(
        Object.entries(process.env).filter(([, v]) => v !== undefined),
      ) as Record<string, string>,
    });

    console.log("MCP Hub initialized and connected to servers");
  } catch (err) {
    console.error("Failed to init MCP Hub:", err);
  }
});

app.on("activate", function () {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
