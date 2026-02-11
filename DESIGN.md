# Z-One: AI OS Agent Design Document

## 1. Core Philosophy: "Safety First" & "Abstract Agent"

The AI operates not just the local computer, but potentially external hardware (Arduino) and social platforms.
**User Control** and **System Safety** are paramount. The system is designed as a layered, abstract intelligent agent.

---

## 2. System Architecture: The "Four Layers + Guardian" Model

We adopt a highly abstract, hierarchical architecture designed for extensibility (Software -> Hardware -> Social).
We standardize the connection between layers using the **Model Context Protocol (MCP)**.

### Layer 1: Intelligence Layer (智慧层) - "The Brain"

- **Role**: High-level decision making and planning. Acts as the **MCP Client**.
- **Responsibilities**:
  - **Goal Analysis**: Understands user intent from Interaction Layer.
  - **Strategic Planning**: Decomposes goals into a sequence of high-level tasks.
  - **Self-Correction (Replanning)**: Decides whether to alter the strategy when the Control Layer reports failure.
- **Plan Validation (The "Critic")**:
  - Before any plan is sent to Control Layer, it passes through a **Plan Evaluator**.
  - **Criteria**: Rationality, Safety, Efficiency.

### Layer 2: Control Layer (控制层) - "The Manager"

- **Role**: Orchestrates execution and ensures quality.
- **Responsibilities**:
  - **Skill Composition**: Combines atomic MCP Tools into complex "Agent Skills" (e.g., "Summarize PDF" = `readFile` -> `LLM` -> `writeFile`).
  - **Task Dispatch**: Breaks down Intelligence Layer's tasks into specific MCP Tool calls.
  - **Loop & Validation**: Monitors execution status (Do -> Check -> Fix).
- **Components**:
  - **Skill Registry**: Library of known workflows (stored in Procedural Memory).
  - **Workflow Engine**: XState machine managing the execution loop.

### Layer 3: Execution Layer (执行层) - "The Toolbelt"

- **Role**: The "Effectors". Exposes capabilities via **MCP Servers**.
- **Architecture**:
  - **MCP Host**: The local runtime hosting various MCP Servers.
  - **Standard MCP Servers**:
    - `@mcp/filesystem`: Safe file operations.
    - `@mcp/browser`: Web browsing (Playwright).
    - `@mcp/desktop`: Mouse/Keyboard control (nut.js).
  - **Dynamic Capability (The "Tool Forge")**:
    - **Concept**: If a required tool is missing, the Agent creates it on the fly.
    - **Workflow**:
      1.  **Detection**: "I need to convert .wav to .mp3 but no tool exists."
      2.  **Generation**: Intelligence Layer writes a Python/Node.js script.
      3.  **Sandboxing**: The script is executed in a secure **Code Sandbox** (e.g., Docker container or isolated process).
      4.  **Adoption**: If successful, the script is saved as a new **Custom MCP Tool** for future use.

### Layer 4: Interaction Layer (交互层) - "The Senses"

- **Role**: Interface with the outside world.
- **Responsibilities**:
  - **Multimodal Input**: Audio, Video, Image, Text.
  - **Multimodal Output**: TTS, Text, Video generation.
- **Concurrency & Priority**:
  - **Event Bus**: All inputs are normalized into `AgentEvent` objects.
  - **Priority Queue**: P0 (Critical) -> P3 (Low).

---

## 3. Core Foundation: Memory & Context (记忆)

Memory is a shared infrastructure service available primarily to the Intelligence Layer.

- **Structure**:
  1.  **Episodic Memory**: "What did we do yesterday?" (Vector DB).
  2.  **Semantic Memory**: "How do I use Photoshop?" (Vector DB/Docs).
  3.  **Procedural Memory (Skill Library)**: "Click X then Y". Stores **Composed Skills** and **Generated Tools**.
  4.  **Working Context**: Active task state.

---

## 4. Cross-Cutting Concern: Safety Layer (安全层)

- **Role**: The "Guardian". Penetrates all key nodes of the lifecycle.
- **Design**: Extensible middleware pattern.
- **Checkpoints**:
  1.  **Input Filter**: Block malicious prompts.
  2.  **Plan Audit**: LLM self-reflection.
  3.  **Action Gate**: Human-in-the-Loop for critical MCP Tool calls.
  4.  **Hardware Limit**: Max motor speed (Arduino).

---

## 5. Technical Stack Proposal

### A. Core Framework

- **Runtime**: Node.js (Electron Main Process).
- **Protocol**: **Model Context Protocol (MCP)** SDK.

### B. Implementation Mapping

- **Intelligence**: OpenAI API / Anthropic API + `sqlite-vec`.
- **Control**: `XState` (State Machines).
- **Execution**:
  - **MCP Host**: Electron Main Process.
  - **Tools**: `nut.js`, `Playwright`.

## 6. Implementation Status (Phase 1: Skeleton)

### Directory Structure Mapping

- **Interaction Layer**: `src/renderer/` (React UI)
- **Control Layer**: `src/main/control/` (McpHub, future XState)
- **Execution Layer**: `src/main/execution/`
  - `servers/`: MCP Servers (e.g., `desktop-mcp.ts`)
  - `tools/`: Raw implementations (e.g., `peekaboo/`)

### Current Components

- **McpHub (`src/main/control/mcp-hub.ts`)**:
  - Acts as the central MCP Client.
  - Manages connections to local/remote MCP Servers.
  - Routes tool calls to appropriate servers.

- **Desktop MCP Server (`src/main/execution/servers/desktop-mcp.ts`)**:
  - Standardized MCP interface for desktop automation.
  - Exposes `get_active_window_tree` and `get_desktop_tree`.

- **Peekaboo (`src/main/execution/tools/peekaboo/`)**:
  - **Windows**: PowerShell-based UI Automation wrapper (`dump-tree.ps1`).
  - **Abstract**: Factory pattern for cross-platform support.

- **UI**:
  - Simple React interface to list and call MCP tools.
  - IPC bridge (`mcp:get-tools`, `mcp:call-tool`).
- **Execution**:
  - **MCP Servers**:
    - `z-one-desktop-mcp`: Wraps `nut.js`.
    - `z-one-hardware-mcp`: Wraps `serialport`.
    - `z-one-sandbox-mcp`: Runs generated code (Node/Python).
- **Interaction**:
  - Audio: `node-record-lpcm16` (Requires SoX on Windows/Mac) or native modules.
  - UI: Electron Renderer (React).

### C. Cross-Platform Strategy (Windows & macOS)

- **Desktop Automation**:
  - Use `nut.js` for cross-platform mouse/keyboard control.
  - **Window Management**: Use `active-win` for getting active window info. For advanced window manipulation (moving/resizing), we may need platform-specific modules:
    - **Windows**: `node-ffi-napi` accessing User32.dll or PowerShell scripts.
    - **macOS**: AppleScript (JXA) or Swift bridge.
- **Audio**:
  - Ensure `SoX` is bundled or prompt user to install.
  - Alternative: Web Audio API in Electron Renderer process (captures system audio via `desktopCapturer`).
- **Paths & Files**:
  - Use `path.join` and `os.homedir` strictly.
  - Handle CRLF vs LF line endings.

---

## 6. Development Phases

1.  **Phase 1 (Skeleton)**: Setup Electron + MCP Client/Server architecture.
2.  **Phase 2 (PC Control)**: Implement `z-one-desktop-mcp` (Mouse/Keyboard).
3.  **Phase 3 (Tool Forge)**: Implement `z-one-sandbox-mcp` for running generated code.
4.  **Phase 4 (Safety)**: Add "Guardian" middleware and Visual Feedback.
