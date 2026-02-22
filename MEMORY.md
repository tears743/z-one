# Z-One Memory & Knowledge Base

## Project Mission
**Mission**: To create a safe, abstract, and evolving AI Agent that operates as an extension of the user, bridging the gap between digital intentions and physical/digital execution.

## Architecture
Z-One adopts a **4-Layer + Guardian** architecture, standardized via the **Model Context Protocol (MCP)**:
1.  **Intelligence Layer**: The Brain. Handles strategic planning, goal analysis, and self-correction.
2.  **Control Layer**: The Manager. Orchestrates task execution, validates results, and manages complex skills.
3.  **Execution Layer**: The Toolbelt. A collection of **MCP Servers** (Desktop, Browser, Sandbox).
4.  **Interaction Layer**: The Senses. Handles multimodal input and output.
5.  **Safety Layer**: A cross-cutting "Guardian" that audits plans and requires confirmation.

## Tech Stack
*   **Runtime**: Node.js (Electron)
*   **Language**: TypeScript
*   **Protocol**: Model Context Protocol (MCP)
*   **AI**: OpenAI / Anthropic API
*   **Automation**: nut.js (Desktop), Playwright (Web)

## Core Principles
*   **Safety First**: Always prioritize user safety and data integrity.
*   **Files as Truth**: Prefer editing existing files over creating new ones.
*   **Autonomy**: Agents should be autonomous but respect safety boundaries.
