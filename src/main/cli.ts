#!/usr/bin/env npx ts-node
/**
 * z-one CLI — Remote Control Client
 *
 * Connects to the z-one app via WebSocket (port 18888) and provides:
 * - Remote control: screenshot, dom, click, type, scroll, eval
 * - Workflow management: ls, status, start, pause, resume, inject, logs, delete
 * - Test execution: test run <suite.json>
 * - Message sending: z-one "message"
 *
 * Usage:
 *   npx ts-node src/main/cli.ts screenshot [--save path.png]
 *   npx ts-node src/main/cli.ts dom [--mode interactive] [--selector ".foo"]
 *   npx ts-node src/main/cli.ts click ".selector"
 *   npx ts-node src/main/cli.ts type ".selector" "text"
 *   npx ts-node src/main/cli.ts workflow ls
 *   npx ts-node src/main/cli.ts workflow start <id>
 *   npx ts-node src/main/cli.ts test run <suite.json>
 *   npx ts-node src/main/cli.ts "send this message"
 */

import WebSocket from 'ws';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

// ─── Config ─────────────────────────────────────────────────

const WS_URL = 'ws://localhost:18888';
const TOKEN_PATH = '/tmp/z-one-cli-token';
const DEVICE_ID = '_zone_cli';
const DEVICE_NAME = 'Z-One CLI';
const RESPONSE_TIMEOUT = 30000; // 30s

// ─── Globals ────────────────────────────────────────────────

let ws: WebSocket;
let jsonMode = false;
let pendingRequests: Map<string, { resolve: (data: any) => void; reject: (err: Error) => void }> = new Map();
let messageResolve: ((data: any) => void) | null = null;

// ─── Connection ─────────────────────────────────────────────

function readToken(): string {
  try {
    return fs.readFileSync(TOKEN_PATH, 'utf-8').trim();
  } catch {
    logError('Cannot read CLI token. Is z-one running?');
    process.exit(1);
  }
}

function connect(): Promise<void> {
  return new Promise((resolve, reject) => {
    const token = readToken();
    ws = new WebSocket(WS_URL);

    ws.on('open', () => {
      // Register as internal CLI device
      ws.send(JSON.stringify({
        type: 'register',
        payload: {
          name: DEVICE_NAME,
          type: 'internal',
          deviceId: DEVICE_ID,
          token: token,
        },
        timestamp: Date.now(),
      }));
      resolve();
    });

    ws.on('message', (data: string) => {
      try {
        const msg = JSON.parse(data.toString());
        handleMessage(msg);
      } catch (e) {
        // Ignore parse errors
      }
    });

    ws.on('error', (err) => {
      logError(`Connection failed: ${err.message}`);
      reject(err);
    });

    ws.on('close', () => {
      // If we have pending requests, reject them
      for (const [, req] of pendingRequests) {
        req.reject(new Error('Connection closed'));
      }
      pendingRequests.clear();
    });

    setTimeout(() => reject(new Error('Connection timeout')), 5000);
  });
}

function handleMessage(msg: any) {
  switch (msg.type) {
    case 'register_ack':
      logDebug('Registered with server');
      break;
    case 'remote_control_response': {
      const { requestId, success, data, error } = msg.payload;
      const pending = pendingRequests.get(requestId);
      if (pending) {
        pendingRequests.delete(requestId);
        if (success) {
          pending.resolve(data);
        } else {
          pending.reject(new Error(error || 'Remote control failed'));
        }
      }
      break;
    }
    case 'message': {
      // Response to a text message
      if (messageResolve) {
        const content = msg.payload?.content;
        if (typeof content === 'string') {
          messageResolve(content);
          messageResolve = null;
        }
      }
      break;
    }
    case 'heartbeat':
      break;
  }
}

// ─── Remote Control API ─────────────────────────────────────

function sendRemoteControl(action: string, params: Record<string, any> = {}): Promise<any> {
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    pendingRequests.set(requestId, { resolve, reject });

    ws.send(JSON.stringify({
      type: 'remote_control',
      payload: {
        requestId,
        action,
        ...params,
      },
      timestamp: Date.now(),
    }));

    setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        reject(new Error(`Timeout waiting for ${action} response`));
      }
    }, RESPONSE_TIMEOUT);
  });
}

function sendTextMessage(content: string, sessionId?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    messageResolve = resolve;

    ws.send(JSON.stringify({
      type: 'message',
      payload: {
        content,
        from: DEVICE_ID,
        sessionId: sessionId || `cli-${Date.now()}`,
      },
      timestamp: Date.now(),
    }));

    setTimeout(() => {
      if (messageResolve) {
        messageResolve = null;
        reject(new Error('Timeout waiting for message response'));
      }
    }, 120000); // 2 min timeout for LLM responses
  });
}

// ─── Output Helpers ─────────────────────────────────────────

function output(data: any) {
  if (jsonMode) {
    console.log(JSON.stringify(data, null, 2));
  } else if (typeof data === 'string') {
    console.log(data);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

function logError(msg: string) {
  if (jsonMode) {
    console.error(JSON.stringify({ error: msg }));
  } else {
    console.error(`❌ ${msg}`);
  }
}

function logDebug(msg: string) {
  if (!jsonMode) {
    // console.error(`[debug] ${msg}`);
  }
}

function logSuccess(msg: string) {
  if (!jsonMode) {
    console.log(`✅ ${msg}`);
  }
}

// ─── Command Handlers ───────────────────────────────────────

async function cmdScreenshot(args: string[]) {
  const saveIdx = args.indexOf('--save');
  const savePath = saveIdx >= 0 ? args[saveIdx + 1] : undefined;
  const result = await sendRemoteControl('screenshot', { savePath });
  if (savePath) {
    logSuccess(`Screenshot saved to ${savePath} (${result.size} bytes)`);
  }
  output({ saved: result.saved, size: result.size });
}

async function cmdDom(args: string[]) {
  const modeIdx = args.indexOf('--mode');
  const mode = modeIdx >= 0 ? args[modeIdx + 1] : 'interactive';
  const selIdx = args.indexOf('--selector');
  const selector = selIdx >= 0 ? args[selIdx + 1] : undefined;
  const result = await sendRemoteControl('dom', { mode, selector });
  output(result);
}

async function cmdClick(args: string[]) {
  if (args.length < 1) {
    logError('Usage: click <selector>');
    return;
  }
  const result = await sendRemoteControl('click', { selector: args[0] });
  output(result);
}

async function cmdType(args: string[]) {
  if (args.length < 2) {
    logError('Usage: type <selector> <text>');
    return;
  }
  const result = await sendRemoteControl('type', { selector: args[0], text: args[1] });
  output(result);
}

async function cmdScroll(args: string[]) {
  const deltaIdx = args.indexOf('--delta');
  const delta = deltaIdx >= 0 ? parseInt(args[deltaIdx + 1]) : 300;
  const selIdx = args.indexOf('--selector');
  const selector = selIdx >= 0 ? args[selIdx + 1] : undefined;
  const result = await sendRemoteControl('scroll', { delta, selector });
  output(result);
}

async function cmdEval(args: string[]) {
  if (args.length < 1) {
    logError('Usage: eval <expression>');
    return;
  }
  const result = await sendRemoteControl('eval', { expression: args.join(' ') });
  output(result);
}

async function cmdWait(args: string[]) {
  const duration = parseInt(args[0]) || 1000;
  await sendRemoteControl('wait', { duration });
  logSuccess(`Waited ${duration}ms`);
}

// ─── Workflow Commands ──────────────────────────────────────

async function cmdWorkflow(args: string[]) {
  const subCmd = args[0];
  const subArgs = args.slice(1);

  switch (subCmd) {
    case 'ls':
    case 'list': {
      const result = await sendRemoteControl('eval', {
        expression: `window.electron.ipcRenderer.invoke('workflow:list')`,
      });
      output(result);
      break;
    }
    case 'status':
    case 'get': {
      if (subArgs.length < 1) { logError('Usage: workflow status <id>'); return; }
      const result = await sendRemoteControl('eval', {
        expression: `window.electron.ipcRenderer.invoke('workflow:get', '${subArgs[0]}')`,
      });
      output(result);
      break;
    }
    case 'start': {
      if (subArgs.length < 1) { logError('Usage: workflow start <id>'); return; }
      const result = await sendRemoteControl('eval', {
        expression: `window.electron.ipcRenderer.invoke('workflow:start', { workflowId: '${subArgs[0]}' })`,
      });
      output(result);
      break;
    }
    case 'pause': {
      if (subArgs.length < 1) { logError('Usage: workflow pause <runId>'); return; }
      const result = await sendRemoteControl('eval', {
        expression: `window.electron.ipcRenderer.invoke('workflow:pause', '${subArgs[0]}')`,
      });
      output(result);
      break;
    }
    case 'resume': {
      if (subArgs.length < 1) { logError('Usage: workflow resume <runId>'); return; }
      const result = await sendRemoteControl('eval', {
        expression: `window.electron.ipcRenderer.invoke('workflow:resume', '${subArgs[0]}')`,
      });
      output(result);
      break;
    }
    case 'cancel': {
      if (subArgs.length < 1) { logError('Usage: workflow cancel <runId>'); return; }
      const result = await sendRemoteControl('eval', {
        expression: `window.electron.ipcRenderer.invoke('workflow:cancel', '${subArgs[0]}')`,
      });
      output(result);
      break;
    }
    case 'inject': {
      if (subArgs.length < 3) { logError('Usage: workflow inject <runId> <nodeId> "message"'); return; }
      const [runId, nodeId, ...msgParts] = subArgs;
      const content = msgParts.join(' ');
      const result = await sendRemoteControl('eval', {
        expression: `window.electron.ipcRenderer.invoke('workflow:inject-message', { runId: '${runId}', nodeId: '${nodeId}', content: ${JSON.stringify(content)}, source: 'cli' })`,
      });
      output(result);
      break;
    }
    case 'logs': {
      if (subArgs.length < 2) { logError('Usage: workflow logs <runId> <nodeId>'); return; }
      const result = await sendRemoteControl('eval', {
        expression: `window.electron.ipcRenderer.invoke('workflow:get-node-logs', { runId: '${subArgs[0]}', nodeId: '${subArgs[1]}' })`,
      });
      output(result);
      break;
    }
    case 'delete': {
      if (subArgs.length < 1) { logError('Usage: workflow delete <id>'); return; }
      const result = await sendRemoteControl('eval', {
        expression: `window.electron.ipcRenderer.invoke('workflow:delete', '${subArgs[0]}')`,
      });
      logSuccess(`Deleted workflow ${subArgs[0]}`);
      output(result);
      break;
    }
    case 'runs': {
      if (subArgs.length < 1) { logError('Usage: workflow runs <workflowId>'); return; }
      const result = await sendRemoteControl('eval', {
        expression: `window.electron.ipcRenderer.invoke('workflow:get-runs', '${subArgs[0]}')`,
      });
      output(result);
      break;
    }
    case 'create': {
      if (subArgs.length < 1) { logError('Usage: workflow create "description"'); return; }
      const request = subArgs.join(' ');
      const result = await sendRemoteControl('eval', {
        expression: `window.electron.ipcRenderer.invoke('workflow:create', { request: ${JSON.stringify(request)} })`,
      });
      output(result);
      break;
    }
    default:
      logError(`Unknown workflow command: ${subCmd}. Available: ls, status, start, pause, resume, cancel, inject, logs, delete, runs, create`);
  }
}

// ─── Test Runner ────────────────────────────────────────────

interface TestStep {
  action: 'screenshot' | 'dom' | 'click' | 'type' | 'scroll' | 'eval' | 'wait' | 'assert';
  selector?: string;
  text?: string;
  mode?: string;
  expression?: string;
  duration?: number;
  delta?: number;
  savePath?: string;
  /** For assert action */
  assertion?: {
    type: 'contains' | 'not_contains' | 'equals' | 'exists' | 'count' | 'truthy';
    target?: string; // selector or expression for evaluation
    expected?: any;
  };
  /** Description for logging */
  description?: string;
}

interface TestCase {
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

interface TestResult {
  suite: string;
  totalCases: number;
  passed: number;
  failed: number;
  errors: string[];
  cases: {
    name: string;
    status: 'passed' | 'failed';
    error?: string;
    duration: number;
  }[];
}

async function executeTestStep(step: TestStep): Promise<any> {
  const desc = step.description ? ` — ${step.description}` : '';

  switch (step.action) {
    case 'screenshot':
      logDebug(`  📸 Screenshot${desc}`);
      return await sendRemoteControl('screenshot', { savePath: step.savePath });
    case 'dom':
      logDebug(`  🔍 DOM query (${step.mode || 'interactive'})${desc}`);
      return await sendRemoteControl('dom', { mode: step.mode, selector: step.selector });
    case 'click':
      logDebug(`  👆 Click: ${step.selector}${desc}`);
      return await sendRemoteControl('click', { selector: step.selector });
    case 'type':
      logDebug(`  ⌨️  Type: "${step.text}" into ${step.selector}${desc}`);
      return await sendRemoteControl('type', { selector: step.selector, text: step.text });
    case 'scroll':
      logDebug(`  📜 Scroll: ${step.delta || 300}px${desc}`);
      return await sendRemoteControl('scroll', { delta: step.delta, selector: step.selector });
    case 'eval':
      logDebug(`  🧮 Eval: ${step.expression?.slice(0, 50)}${desc}`);
      return await sendRemoteControl('eval', { expression: step.expression });
    case 'wait':
      logDebug(`  ⏳ Wait: ${step.duration || 1000}ms${desc}`);
      return await sendRemoteControl('wait', { duration: step.duration });
    case 'assert': {
      if (!step.assertion) throw new Error('assert step requires assertion config');
      const { type, target, expected } = step.assertion;
      logDebug(`  ✓ Assert (${type}): ${target || ''}${desc}`);

      let value: any;
      if (target) {
        // Evaluate the target expression
        value = await sendRemoteControl('eval', { expression: target });
      }

      switch (type) {
        case 'contains':
          if (typeof value !== 'string' || !value.includes(expected)) {
            throw new Error(`Assert contains failed: "${value}" does not contain "${expected}"`);
          }
          break;
        case 'not_contains':
          if (typeof value === 'string' && value.includes(expected)) {
            throw new Error(`Assert not_contains failed: "${value}" contains "${expected}"`);
          }
          break;
        case 'equals':
          if (value !== expected) {
            throw new Error(`Assert equals failed: ${JSON.stringify(value)} !== ${JSON.stringify(expected)}`);
          }
          break;
        case 'exists':
          if (value === null || value === undefined) {
            throw new Error(`Assert exists failed: value is ${value}`);
          }
          break;
        case 'count':
          if (typeof value === 'object' && Array.isArray(value)) {
            if (value.length !== expected) {
              throw new Error(`Assert count failed: got ${value.length}, expected ${expected}`);
            }
          }
          break;
        case 'truthy':
          if (!value) {
            throw new Error(`Assert truthy failed: value is ${JSON.stringify(value)}`);
          }
          break;
      }
      return { asserted: true };
    }
    default:
      throw new Error(`Unknown test action: ${step.action}`);
  }
}

async function cmdTestRun(args: string[]) {
  if (args.length < 1) {
    logError('Usage: test run <suite.json>');
    return;
  }

  const suitePath = path.resolve(args[0]);
  if (!fs.existsSync(suitePath)) {
    logError(`Test suite not found: ${suitePath}`);
    return;
  }

  const suite: TestSuite = JSON.parse(fs.readFileSync(suitePath, 'utf-8'));
  console.log(`\n🧪 Running test suite: ${suite.name}`);
  if (suite.description) console.log(`   ${suite.description}`);
  console.log(`   ${suite.cases.length} test case(s)\n`);

  const result: TestResult = {
    suite: suite.name,
    totalCases: suite.cases.length,
    passed: 0,
    failed: 0,
    errors: [],
    cases: [],
  };

  // Setup
  if (suite.setup && suite.setup.length > 0) {
    console.log('📋 Setup...');
    for (const step of suite.setup) {
      await executeTestStep(step);
    }
  }

  // Run cases
  for (const tc of suite.cases) {
    const start = Date.now();
    console.log(`  🔹 ${tc.name}`);

    try {
      for (const step of tc.steps) {
        await executeTestStep(step);
      }
      const duration = Date.now() - start;
      result.passed++;
      result.cases.push({ name: tc.name, status: 'passed', duration });
      console.log(`    ✅ PASSED (${duration}ms)`);
    } catch (err: any) {
      const duration = Date.now() - start;
      result.failed++;
      result.errors.push(`${tc.name}: ${err.message}`);
      result.cases.push({ name: tc.name, status: 'failed', error: err.message, duration });
      console.log(`    ❌ FAILED: ${err.message} (${duration}ms)`);

      // Auto-screenshot on failure
      try {
        const failScreenshotPath = `/tmp/z-one-test-fail-${tc.name.replace(/\W/g, '_')}.png`;
        await sendRemoteControl('screenshot', { savePath: failScreenshotPath });
        console.log(`    📸 Failure screenshot: ${failScreenshotPath}`);
      } catch { /* ignore */ }
    }
  }

  // Teardown
  if (suite.teardown && suite.teardown.length > 0) {
    console.log('\n📋 Teardown...');
    for (const step of suite.teardown) {
      await executeTestStep(step);
    }
  }

  // Summary
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${result.passed}/${result.totalCases} passed, ${result.failed} failed`);
  if (result.errors.length > 0) {
    console.log('\nFailures:');
    result.errors.forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
  }
  console.log('');

  // Save result
  const resultPath = suitePath.replace('.json', '-result.json');
  fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
  console.log(`📄 Results saved to: ${resultPath}`);

  output(result);
}

// ─── Main ───────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  // Extract flags
  if (args.includes('--json')) {
    jsonMode = true;
    args.splice(args.indexOf('--json'), 1);
  }

  if (args.length === 0) {
    console.log(`z-one CLI — Remote Control

Usage:
  z-one <command> [args] [--json]

Commands:
  screenshot [--save path.png]              Take a screenshot
  dom [--mode interactive|skeleton|full|scoped] [--selector ".foo"]
  click <selector>                          Click an element
  type <selector> <text>                    Type text into an element
  scroll [--delta 300] [--selector ".foo"]  Scroll the page
  eval <expression>                         Execute JS in renderer
  wait <ms>                                 Wait for N ms

  workflow ls                               List workflows
  workflow create "description"             Create workflow from description
  workflow status <id>                      Get workflow details
  workflow start <id>                       Start a workflow run
  workflow pause <runId>                    Pause a running workflow
  workflow resume <runId>                   Resume a paused workflow
  workflow cancel <runId>                   Cancel a running workflow
  workflow inject <runId> <nodeId> "msg"    Inject message into a node
  workflow logs <runId> <nodeId>            Get node execution logs
  workflow delete <id>                      Delete a workflow
  workflow runs <workflowId>                List runs for a workflow

  test run <suite.json>                     Run a structured test suite

  "message text"                            Send a message to the AI

Flags:
  --json                                    Output in JSON format
`);
    process.exit(0);
  }

  try {
    await connect();
  } catch (err: any) {
    logError(`Failed to connect to z-one: ${err.message}`);
    process.exit(1);
  }

  // Small delay to ensure registration completes
  await new Promise(resolve => setTimeout(resolve, 200));

  const cmd = args[0];
  const cmdArgs = args.slice(1);

  try {
    switch (cmd) {
      case 'screenshot':
        await cmdScreenshot(cmdArgs);
        break;
      case 'dom':
        await cmdDom(cmdArgs);
        break;
      case 'click':
        await cmdClick(cmdArgs);
        break;
      case 'type':
        await cmdType(cmdArgs);
        break;
      case 'scroll':
        await cmdScroll(cmdArgs);
        break;
      case 'eval':
        await cmdEval(cmdArgs);
        break;
      case 'wait':
        await cmdWait(cmdArgs);
        break;
      case 'workflow':
        await cmdWorkflow(cmdArgs);
        break;
      case 'test':
        if (cmdArgs[0] === 'run') {
          await cmdTestRun(cmdArgs.slice(1));
        } else {
          logError('Usage: test run <suite.json>');
        }
        break;
      default:
        // Treat as a text message
        const response = await sendTextMessage(args.join(' '));
        output(response);
        break;
    }
  } catch (err: any) {
    logError(err.message);
    process.exit(1);
  }

  ws.close();
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
