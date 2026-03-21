#!/usr/bin/env node
/**
 * Z-One CLI — WebSocket client that connects to the Electron app as a device.
 *
 * Remote Control Commands:
 *   z-one screenshot [--save file.png]         # Capture screenshot
 *   z-one dom [--mode skeleton|interactive|full] [--selector ".css"]
 *   z-one element <selector>                   # Get element detail
 *   z-one click <selector>                     # Click element
 *   z-one dblclick <selector>                  # Double-click
 *   z-one type <selector> "text"               # Type into input
 *   z-one scroll [selector] <deltaY>           # Scroll
 *   z-one select <selector> <value>            # Select dropdown
 *   z-one focus <selector>                     # Focus element
 *   z-one eval "js code"                       # Execute JS in renderer
 *   z-one state                                # App state
 *   z-one window                               # Window info
 *
 * Chat:
 *   z-one chat "message"                       # Send chat message
 *   z-one                                      # Interactive REPL
 *
 * Workflow:
 *   z-one workflow ls|status|start|pause|resume|inject|logs|delete
 *
 * Test:
 *   z-one test run <suite.json> [--case TC001] # Run test suite
 *   z-one test list <suite.json>               # List test cases
 */

import { randomUUID } from "crypto";
import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";
import WebSocket from "ws";

const WS_URL = "ws://localhost:18888";
const DEVICE_ID = "_zone_cli";
const DEVICE_NAME = "ZoneCLI";

// ── Token File ──────────────────────────────────────────────────────────

function getTokenPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "/tmp";
  return path.join(home, ".z-one-cli-token");
}

function readToken(): string | null {
  try {
    const tokenPath = getTokenPath();
    if (fs.existsSync(tokenPath)) {
      return fs.readFileSync(tokenPath, "utf-8").trim();
    }
  } catch {}
  return null;
}

// ── WS Connection ───────────────────────────────────────────────────────

interface PendingRequest {
  resolve: (val: any) => void;
  reject: (err: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

class ZoneCLIClient {
  private ws: WebSocket | null = null;
  private registered = false;
  private pendingRequests = new Map<string, PendingRequest>();
  private messageCallback: ((msg: any) => void) | null = null;
  private registeredPromise: { resolve: () => void; reject: (err: Error) => void } | null = null;

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const token = readToken();
      this.ws = new WebSocket(WS_URL);

      const connectTimeout = setTimeout(() => {
        reject(new Error("Connection timeout — is the Z-One app running?"));
        this.ws?.close();
      }, 5000);

      this.ws.on("open", () => {
        clearTimeout(connectTimeout);
        // Register as internal device
        this.ws!.send(JSON.stringify({
          type: "register",
          payload: {
            name: DEVICE_NAME,
            type: "internal",
            deviceId: DEVICE_ID,
            token: token || undefined,
          },
          timestamp: Date.now(),
        }));

        // Wait for register_ack
        this.registeredPromise = { resolve: () => { this.registered = true; resolve(); }, reject };
      });

      this.ws.on("message", (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleMessage(msg);
        } catch {}
      });

      this.ws.on("error", (err) => {
        clearTimeout(connectTimeout);
        reject(new Error(`WebSocket error: ${err.message}`));
      });

      this.ws.on("close", () => {
        this.registered = false;
        this.pendingRequests.forEach((p) => {
          clearTimeout(p.timeout);
          p.reject(new Error("Connection closed"));
        });
        this.pendingRequests.clear();
      });
    });
  }

  private handleMessage(msg: any) {
    switch (msg.type) {
      case "register_ack":
        if (msg.payload?.status === "active") {
          this.registeredPromise?.resolve();
        } else {
          this.registeredPromise?.reject(new Error(`Registration failed: ${msg.payload?.status}`));
        }
        break;

      case "remote_control_response": {
        const reqId = msg.payload?.requestId;
        const pending = this.pendingRequests.get(reqId);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(reqId);
          pending.resolve(msg.payload);
        }
        break;
      }

      case "message":
        if (this.messageCallback) {
          this.messageCallback(msg);
        }
        break;

      case "heartbeat":
        break; // ignore
    }
  }

  sendRemoteControl(action: string, params?: any, timeoutMs = 30000): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ws || !this.registered) {
        reject(new Error("Not connected"));
        return;
      }

      const requestId = randomUUID();
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Timeout waiting for ${action} response`));
      }, timeoutMs);

      this.pendingRequests.set(requestId, { resolve, reject, timeout });

      this.ws.send(JSON.stringify({
        type: "remote_control",
        payload: { requestId, action, params },
        timestamp: Date.now(),
      }));
    });
  }

  sendChat(message: string, sessionId: string): void {
    if (!this.ws || !this.registered) throw new Error("Not connected");
    this.ws.send(JSON.stringify({
      type: "message",
      payload: { content: { content: message, images: [] }, from: DEVICE_ID, sessionId },
      timestamp: Date.now(),
    }));
  }

  onMessage(cb: (msg: any) => void) { this.messageCallback = cb; }

  close() {
    this.ws?.close();
    this.ws = null;
  }
}

// ── Command Handlers ────────────────────────────────────────────────────

async function handleCommand(client: ZoneCLIClient, args: string[], jsonMode: boolean) {
  const cmd = args[0];

  switch (cmd) {
    case "screenshot": {
      const saveIdx = args.indexOf("--save");
      const savePath = saveIdx >= 0 ? args[saveIdx + 1] : undefined;
      const resp = await client.sendRemoteControl("screenshot", { save: savePath });
      if (savePath && resp.result?.success) {
        output(`Screenshot saved to ${resp.result.savedTo} (${resp.result.size} bytes)`, jsonMode, resp.result);
      } else if (resp.result?.image) {
        // Base64 — save to temp file for AI consumption
        const tmpPath = `/tmp/z-one-screenshot-${Date.now()}.png`;
        const buf = Buffer.from(resp.result.image.replace("data:image/png;base64,", ""), "base64");
        fs.writeFileSync(tmpPath, buf);
        output(`Screenshot saved to ${tmpPath} (${buf.length} bytes)`, jsonMode, { ...resp.result, savedTo: tmpPath, image: undefined });
      } else {
        output(JSON.stringify(resp.result), jsonMode, resp.result);
      }
      break;
    }

    case "dom": {
      const params: any = {};
      const modeIdx = args.indexOf("--mode");
      if (modeIdx >= 0) params.mode = args[modeIdx + 1];
      else if (args.includes("--interactive")) params.mode = "interactive";
      else if (args.includes("--full")) params.mode = "full";
      const selIdx = args.indexOf("--selector");
      if (selIdx >= 0) params.selector = args[selIdx + 1];
      if (args.includes("--no-rects")) params.withRects = false;
      const resp = await client.sendRemoteControl("dom", params);
      output(JSON.stringify(resp.result, null, jsonMode ? undefined : 2), jsonMode, resp.result);
      break;
    }

    case "element": {
      const selector = args.slice(1).join(" ");
      const resp = await client.sendRemoteControl("dom_element", { selector });
      output(JSON.stringify(resp.result, null, 2), jsonMode, resp.result);
      break;
    }

    case "click": {
      const selector = args.slice(1).join(" ");
      const resp = await client.sendRemoteControl("click", { selector });
      output(resp.result?.success ? "✓ Clicked" : `✗ ${resp.result?.error}`, jsonMode, resp.result);
      break;
    }

    case "dblclick": {
      const selector = args.slice(1).join(" ");
      const resp = await client.sendRemoteControl("dblclick", { selector });
      output(resp.result?.success ? "✓ Double-clicked" : `✗ ${resp.result?.error}`, jsonMode, resp.result);
      break;
    }

    case "type": {
      const selector = args[1];
      const text = args.slice(2).join(" ");
      const resp = await client.sendRemoteControl("type", { selector, text });
      output(resp.result?.success ? "✓ Typed" : `✗ ${resp.result?.error}`, jsonMode, resp.result);
      break;
    }

    case "scroll": {
      let selector: string | null = null;
      let deltaY = 0;
      if (args.length === 2) { deltaY = parseInt(args[1]); }
      else if (args.length >= 3) { selector = args[1]; deltaY = parseInt(args[2]); }
      const resp = await client.sendRemoteControl("scroll", { selector, deltaY });
      output(resp.result?.success ? "✓ Scrolled" : `✗ ${resp.result?.error}`, jsonMode, resp.result);
      break;
    }

    case "select": {
      const selector = args[1];
      const value = args[2];
      const resp = await client.sendRemoteControl("select", { selector, value });
      output(resp.result?.success ? "✓ Selected" : `✗ ${resp.result?.error}`, jsonMode, resp.result);
      break;
    }

    case "focus": {
      const selector = args.slice(1).join(" ");
      const resp = await client.sendRemoteControl("focus", { selector });
      output(resp.result?.success ? "✓ Focused" : `✗ ${resp.result?.error}`, jsonMode, resp.result);
      break;
    }

    case "eval": {
      const code = args.slice(1).join(" ");
      const resp = await client.sendRemoteControl("eval", { code });
      output(JSON.stringify(resp.result, null, 2), jsonMode, resp.result);
      break;
    }

    case "state": {
      const resp = await client.sendRemoteControl("get_app_state");
      output(JSON.stringify(resp.result, null, 2), jsonMode, resp.result);
      break;
    }

    case "window": {
      const resp = await client.sendRemoteControl("get_window_info");
      output(JSON.stringify(resp.result, null, 2), jsonMode, resp.result);
      break;
    }

    case "chat": {
      const message = args.slice(1).join(" ");
      const sessionId = `cli-${Date.now()}`;

      return new Promise<void>((resolve) => {
        const chunks: string[] = [];
        client.onMessage((msg) => {
          const payload = msg.payload;
          if (payload?.content && typeof payload.content === "string") {
            if (!payload.isChunk) {
              // Final message
              if (!jsonMode) {
                const alreadyPrinted = chunks.some(c => c.includes(payload.content.substring(0, 30)));
                if (!alreadyPrinted) console.log(payload.content);
              } else {
                console.log(JSON.stringify({ success: true, response: payload.content }));
              }
              resolve();
            } else if (!payload.details?.swarmState) {
              // Stream chunk
              chunks.push(payload.content);
              if (!jsonMode) process.stdout.write(payload.content);
            }
          }
        });

        client.sendChat(message, sessionId);

        // Timeout after 120s
        setTimeout(() => {
          if (!jsonMode) console.error("\n[Timeout]");
          resolve();
        }, 120000);
      });
      break;
    }

    case "workflow": {
      const sub = args[1];
      const subArgs = args.slice(2);
      let action: string;
      let params: any = {};

      switch (sub) {
        case "ls": case "list":
          action = "workflow_list"; break;
        case "status":
          action = "workflow_status"; params = { id: subArgs[0] }; break;
        case "start":
          action = "workflow_start"; params = { id: subArgs[0] }; break;
        case "pause":
          action = "workflow_pause"; params = { runId: subArgs[0] }; break;
        case "resume":
          action = "workflow_resume"; params = { runId: subArgs[0] }; break;
        case "inject":
          action = "workflow_inject"; params = { runId: subArgs[0], nodeId: subArgs[1], message: subArgs.slice(2).join(" ") }; break;
        case "logs":
          action = "workflow_logs"; params = { runId: subArgs[0], nodeId: subArgs[1] }; break;
        case "delete":
          action = "workflow_delete"; params = { id: subArgs[0] }; break;
        default:
          console.error(`Unknown workflow command: ${sub}`);
          return;
      }

      const resp = await client.sendRemoteControl(action, params, 30000);
      if (resp.result?.error) {
        output(`✗ ${resp.result.error}`, jsonMode, resp.result);
      } else {
        output(JSON.stringify(resp.result, null, jsonMode ? undefined : 2), jsonMode, resp.result);
      }
      break;
    }

    case "test": {
      const testSub = args[1];
      const testFile = args[2];
      if (!testSub || !testFile) {
        console.error("Usage: z-one test run <suite.json> [--case TC001]");
        return;
      }
      await runTests(client, testSub, testFile, args.slice(3), jsonMode);
      break;
    }

    default:
      console.error(`Unknown command: ${cmd}`);
      printHelp();
  }
}

function output(text: string, jsonMode: boolean, data?: any) {
  if (jsonMode && data) {
    console.log(JSON.stringify(data));
  } else {
    console.log(text);
  }
}

function printHelp() {
  console.error(`
Z-One CLI — Remote Control & Testing Tool

Commands:
  screenshot [--save file.png]            Capture app screenshot
  dom [--mode interactive|skeleton|full]   Query DOM tree
  element <selector>                      Get element details
  click <selector>                        Click element
  dblclick <selector>                     Double-click element
  type <selector> "text"                  Type into input
  scroll [selector] <deltaY>              Scroll
  select <selector> <value>               Select dropdown value
  focus <selector>                        Focus element
  eval "js code"                          Execute JS in renderer
  state                                   Get app state
  window                                  Get window info
  chat "message"                          Send chat message
  test run <suite.json>                   Run test suite
  test list <suite.json>                  List test cases

Workflow Commands:
  workflow ls                             List all workflows
  workflow status <id>                    Show workflow status & runs
  workflow start <id>                     Start a workflow
  workflow pause <runId>                  Pause a running workflow
  workflow resume <runId>                 Resume a paused workflow
  workflow inject <runId> <nodeId> "msg"  Inject message into node
  workflow logs <runId> [nodeId]          View execution logs
  workflow delete <id>                    Delete a workflow

Options:
  --json                                  JSON output mode
  --help                                  Show help
`);
}

// ── Test Runner ─────────────────────────────────────────────────────────

interface TestAssertion {
  type: "contains" | "not_contains" | "equals" | "exists" | "count";
  target: string;
  expected: any;
}

interface TestStep {
  action: string;
  params: Record<string, any>;
  assert?: TestAssertion[];
  timeout?: number;
  onFail?: "stop" | "continue";
}

interface TestCase {
  id: string;
  name: string;
  steps: TestStep[];
}

interface TestSuite {
  name: string;
  description?: string;
  setup?: TestStep[];
  teardown?: TestStep[];
  cases: TestCase[];
}

interface StepResult {
  step: number;
  action: string;
  passed: boolean;
  error?: string;
  duration: number;
  screenshot?: string;
}

interface CaseResult {
  id: string;
  name: string;
  passed: boolean;
  duration: number;
  steps: StepResult[];
  failureReason?: string;
}

async function runTests(client: ZoneCLIClient, sub: string, filePath: string, extraArgs: string[], jsonMode: boolean) {
  if (!fs.existsSync(filePath)) {
    console.error(`Test file not found: ${filePath}`);
    return;
  }

  const suite: TestSuite = JSON.parse(fs.readFileSync(filePath, "utf-8"));

  if (sub === "list") {
    console.log(`\nTest Suite: ${suite.name}`);
    if (suite.description) console.log(`  ${suite.description}`);
    console.log(`\n  ${suite.cases.length} test case(s):\n`);
    for (const tc of suite.cases) {
      console.log(`  ${tc.id}  ${tc.name}  (${tc.steps.length} steps)`);
    }
    return;
  }

  if (sub !== "run") {
    console.error(`Unknown test command: ${sub}`);
    return;
  }

  // Filter by --case
  const caseIdx = extraArgs.indexOf("--case");
  const filterCaseId = caseIdx >= 0 ? extraArgs[caseIdx + 1] : null;

  const casesToRun = filterCaseId
    ? suite.cases.filter(c => c.id === filterCaseId)
    : suite.cases;

  if (casesToRun.length === 0) {
    console.error(`No matching test cases found.`);
    return;
  }

  // Output dir
  const outputDir = `/tmp/z-one-test-${Date.now()}`;
  fs.mkdirSync(outputDir, { recursive: true });

  const banner = `═══════════════════════════════════════════════════\n  ${suite.name}\n  Run: ${new Date().toISOString()}\n═══════════════════════════════════════════════════`;
  console.log(banner);

  // Run setup
  if (suite.setup) {
    console.log("\n  [Setup]");
    for (const step of suite.setup) {
      await executeTestStep(client, step, outputDir, 0);
    }
  }

  const results: CaseResult[] = [];

  for (const tc of casesToRun) {
    const caseStart = Date.now();
    const stepResults: StepResult[] = [];
    let casePassed = true;
    let failureReason = "";

    for (let i = 0; i < tc.steps.length; i++) {
      const step = tc.steps[i];
      const stepStart = Date.now();
      const result = await executeTestStep(client, step, outputDir, i);

      const stepResult: StepResult = {
        step: i + 1,
        action: step.action,
        passed: result.passed,
        error: result.error,
        duration: Date.now() - stepStart,
        screenshot: result.screenshot,
      };
      stepResults.push(stepResult);

      if (!result.passed) {
        casePassed = false;
        failureReason = `Step ${i + 1} (${step.action}): ${result.error}`;
        // Auto-screenshot on failure
        if (!result.screenshot) {
          try {
            const failScreenshot = path.join(outputDir, `${tc.id}_step${i + 1}_fail.png`);
            await client.sendRemoteControl("screenshot", { save: failScreenshot });
            stepResult.screenshot = failScreenshot;
          } catch {}
        }
        if (step.onFail === "stop" || step.onFail === undefined) break;
      }
    }

    const caseResult: CaseResult = {
      id: tc.id,
      name: tc.name,
      passed: casePassed,
      duration: Date.now() - caseStart,
      steps: stepResults,
      failureReason: casePassed ? undefined : failureReason,
    };
    results.push(caseResult);

    // Print inline result
    const icon = casePassed ? "✅" : "❌";
    const dur = (caseResult.duration / 1000).toFixed(1);
    console.log(`\n${icon} ${tc.id} ${tc.name}  ${dur}s`);

    if (!casePassed) {
      const failedStep = stepResults.find(s => !s.passed);
      if (failedStep) {
        console.log(`   ├─ Step ${failedStep.step}: ${failedStep.action}  ❌`);
        console.log(`   │  ${failedStep.error}`);
        if (failedStep.screenshot) {
          console.log(`   └─ Screenshot: ${failedStep.screenshot}`);
        }
      }
    }
  }

  // Run teardown
  if (suite.teardown) {
    console.log("\n  [Teardown]");
    for (const step of suite.teardown) {
      await executeTestStep(client, step, outputDir, 0);
    }
  }

  // Summary
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`\n───────────────────────────────────────────────────`);
  console.log(`Result: ${passed}/${results.length} PASSED | ${failed} FAILED`);
  console.log(`Screenshots: ${outputDir}`);
  console.log(`═══════════════════════════════════════════════════`);

  // Save JSON report
  const reportPath = path.join(outputDir, "report.json");
  fs.writeFileSync(reportPath, JSON.stringify({ suite: suite.name, timestamp: Date.now(), results }, null, 2));
  console.log(`Report: ${reportPath}`);

  if (jsonMode) {
    console.log(JSON.stringify({ passed, failed, total: results.length, results, reportPath }));
  }
}

async function executeTestStep(
  client: ZoneCLIClient,
  step: TestStep,
  outputDir: string,
  stepIndex: number,
): Promise<{ passed: boolean; error?: string; screenshot?: string; data?: any }> {
  try {
    switch (step.action) {
      case "wait": {
        await new Promise(r => setTimeout(r, step.params.ms || 500));
        return { passed: true };
      }

      case "screenshot": {
        const savePath = step.params.save
          ? path.join(outputDir, step.params.save)
          : path.join(outputDir, `step_${stepIndex + 1}.png`);
        const resp = await client.sendRemoteControl("screenshot", { save: savePath }, step.timeout || 10000);
        if (resp.result?.error) return { passed: false, error: resp.result.error };
        return { passed: true, screenshot: savePath, data: resp.result };
      }

      case "dom": {
        const resp = await client.sendRemoteControl("dom", step.params, step.timeout || 10000);
        if (resp.result?.error) return { passed: false, error: resp.result.error };
        return runAssertions(step.assert, resp.result);
      }

      case "dom_element":
      case "element": {
        const resp = await client.sendRemoteControl("dom_element", step.params, step.timeout || 10000);
        // If there are assertions, pass even error results through (for negative testing)
        if (resp.result?.error && step.assert && step.assert.length > 0) {
          return runAssertions(step.assert, resp.result);
        }
        if (resp.result?.error) return { passed: false, error: resp.result.error };
        return runAssertions(step.assert, resp.result);
      }

      case "click": {
        const resp = await client.sendRemoteControl("click", step.params, step.timeout || 10000);
        if (resp.result?.error) return { passed: false, error: resp.result.error };
        return runAssertions(step.assert, resp.result);
      }

      case "dblclick": {
        const resp = await client.sendRemoteControl("dblclick", step.params, step.timeout || 10000);
        if (resp.result?.error) return { passed: false, error: resp.result.error };
        return runAssertions(step.assert, resp.result);
      }

      case "type": {
        const resp = await client.sendRemoteControl("type", step.params, step.timeout || 10000);
        if (resp.result?.error) return { passed: false, error: resp.result.error };
        return runAssertions(step.assert, resp.result);
      }

      case "scroll": {
        const resp = await client.sendRemoteControl("scroll", step.params, step.timeout || 10000);
        if (resp.result?.error) return { passed: false, error: resp.result.error };
        return runAssertions(step.assert, resp.result);
      }

      case "eval": {
        const resp = await client.sendRemoteControl("eval", step.params, step.timeout || 10000);
        if (resp.result?.error) return { passed: false, error: resp.result.error };
        return runAssertions(step.assert, resp.result);
      }

      case "state": {
        const resp = await client.sendRemoteControl("get_app_state", {}, step.timeout || 10000);
        if (resp.result?.error) return { passed: false, error: resp.result.error };
        return runAssertions(step.assert, resp.result);
      }

      case "window": {
        const resp = await client.sendRemoteControl("get_window_info", {}, step.timeout || 10000);
        if (resp.result?.error) return { passed: false, error: resp.result.error };
        return runAssertions(step.assert, resp.result);
      }

      case "assert": {
        // Pure assertion on previous data — not yet supported (future: pipeline)
        return { passed: true };
      }

      default:
        return { passed: false, error: `Unknown test action: ${step.action}` };
    }
  } catch (err: any) {
    return { passed: false, error: err.message };
  }
}

function runAssertions(
  assertions: TestAssertion[] | undefined,
  data: any,
): { passed: boolean; error?: string; data?: any } {
  if (!assertions || assertions.length === 0) return { passed: true, data };

  const jsonStr = JSON.stringify(data);

  for (const a of assertions) {
    switch (a.type) {
      case "contains":
        if (!jsonStr.includes(String(a.expected))) {
          return { passed: false, error: `contains("${a.expected}") failed — not found in result`, data };
        }
        break;

      case "not_contains":
        if (jsonStr.includes(String(a.expected))) {
          return { passed: false, error: `not_contains("${a.expected}") failed — found in result`, data };
        }
        break;

      case "equals":
        if (resolveTarget(data, a.target) !== a.expected) {
          return { passed: false, error: `equals("${a.target}") — expected ${a.expected}, got ${resolveTarget(data, a.target)}`, data };
        }
        break;

      case "exists": {
        const found = searchInData(data, a.target);
        if (a.expected && !found) {
          return { passed: false, error: `exists("${a.target}") — not found in DOM result`, data };
        }
        if (!a.expected && found) {
          return { passed: false, error: `exists("${a.target}") — expected not to exist but found`, data };
        }
        break;
      }

      case "count": {
        const count = countInData(data, a.target);
        if (count !== a.expected) {
          return { passed: false, error: `count("${a.target}") — expected ${a.expected}, got ${count}`, data };
        }
        break;
      }
    }
  }

  return { passed: true, data };
}

function resolveTarget(data: any, target: string): any {
  // Simple dot-path resolution: "result.success" → data.result.success
  const parts = target.split(".");
  let current = data;
  for (const p of parts) {
    if (current == null) return undefined;
    current = current[p];
  }
  return current;
}

function searchInData(data: any, target: string): boolean {
  // Search for target as a class name or text in the compact DOM tree
  // Target can be a CSS class pattern or text content
  const jsonStr = JSON.stringify(data);
  // Clean target for search (remove regex markers)
  const cleanTarget = target.replace(/^\$\.\.\[.*\(@\.cls[=~]*'?/g, "").replace(/'?\).*$/g, "")
    .replace(/^\$\.\.tx$/, "").replace(/^\$\.\.\[.*\(@\.t[=]*'?/g, "").replace(/'?\).*$/g, "");

  if (cleanTarget && jsonStr.includes(cleanTarget)) return true;

  // Direct check: if target looks like a CSS class, search cls fields
  if (target.includes("cls")) {
    const classMatch = target.match(/cls[=~]*'([^']+)'/);
    if (classMatch) return jsonStr.includes(classMatch[1]);
  }
  if (target.includes(".t==") || target.includes(".t='")) {
    const tagMatch = target.match(/t[=]*'([^']+)'/);
    if (tagMatch) return jsonStr.includes(`"t":"${tagMatch[1]}"`);
  }

  return false;
}

function countInData(data: any, target: string): number {
  const jsonStr = JSON.stringify(data);
  const classMatch = target.match(/cls[=~]*'([^']+)'/);
  if (classMatch) {
    const regex = new RegExp(classMatch[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    return (jsonStr.match(regex) || []).length;
  }
  return 0;
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes("--json");
  const filteredArgs = args.filter(a => a !== "--json");

  if (filteredArgs.includes("--help") || filteredArgs.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  // Connect
  const client = new ZoneCLIClient();
  try {
    await client.connect();
  } catch (err: any) {
    console.error(`[CLI] Failed to connect: ${err.message}`);
    console.error("[CLI] Make sure Z-One app is running (pnpm dev)");
    process.exit(1);
  }

  if (!jsonMode) console.error("[CLI] Connected to Z-One app.");

  // Command mode
  if (filteredArgs.length > 0) {
    try {
      await handleCommand(client, filteredArgs, jsonMode);
    } catch (err: any) {
      if (jsonMode) console.log(JSON.stringify({ error: err.message }));
      else console.error(`Error: ${err.message}`);
    }
    client.close();
    process.exit(0);
  }

  // Interactive REPL
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
    prompt: "z-one> ",
  });

  console.error("Interactive mode. Type /help for commands, /quit to exit.\n");
  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }
    if (["/quit", "/exit", "/q"].includes(input)) {
      console.error("Bye!");
      client.close();
      process.exit(0);
    }
    if (input === "/help") {
      printHelp();
      rl.prompt();
      return;
    }

    const cmdArgs = parseArgs(input);
    try {
      await handleCommand(client, cmdArgs, jsonMode);
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
    }
    rl.prompt();
  });

  rl.on("close", () => {
    console.error("\nBye!");
    client.close();
    process.exit(0);
  });
}

function parseArgs(input: string): string[] {
  const args: string[] = [];
  let current = "";
  let inQuotes = false;
  let quoteChar = "";

  for (const ch of input) {
    if (inQuotes) {
      if (ch === quoteChar) { inQuotes = false; }
      else { current += ch; }
    } else {
      if (ch === '"' || ch === "'") { inQuotes = true; quoteChar = ch; }
      else if (ch === " ") { if (current) args.push(current); current = ""; }
      else { current += ch; }
    }
  }
  if (current) args.push(current);
  return args;
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
