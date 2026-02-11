# Z-One: AI OS Agent

> **Mission**: To create a safe, abstract, and evolving AI Agent that operates as an extension of the user, bridging the gap between digital intentions and physical/digital execution.
>
> **使命**: 打造一个安全、抽象且具备自我进化能力的 AI Agent，作为用户的延伸，连接数字意图与物理/数字执行。

## 📖 Introduction / 简介

Z-One is a next-generation **AI OS Agent** designed with a "Safety First" philosophy. It is not just a desktop automation tool but a comprehensive intelligent system capable of:
*   **Operating your PC**: Automating complex workflows across applications.
*   **Connecting to Hardware**: Interfacing with Arduino/IoT devices.
*   **Managing Social Interactions**: Bridging communication gaps across platforms.
*   **Self-Evolution**: Creating its own tools when existing ones are insufficient.

Z-One 是下一代遵循“安全第一”理念的 **AI OS Agent**。它不仅是一个桌面自动化工具，更是一个综合智能系统，具备以下能力：
*   **操控电脑**: 跨应用自动化复杂工作流。
*   **连接硬件**: 对接 Arduino/IoT 设备。
*   **管理社交**: 跨平台连接沟通鸿沟。
*   **自我进化**: 在现有工具不足时自动创建新工具。

## 🏗 Architecture / 架构

Z-One adopts a **4-Layer + Guardian** architecture, standardized via the **Model Context Protocol (MCP)**:

Z-One 采用 **4层 + 守护者** 架构，并通过 **Model Context Protocol (MCP)** 进行标准化：

1.  **🧠 Intelligence Layer (智慧层)**: The Brain. Handles strategic planning, goal analysis, and self-correction.
    *   **智慧层**: 大脑。负责战略规划、目标分析和自我修正。
2.  **🎮 Control Layer (控制层)**: The Manager. Orchestrates task execution, validates results, and manages complex skills.
    *   **控制层**: 经理。编排任务执行，验证结果，并管理复杂技能。
3.  **🛠️ Execution Layer (执行层)**: The Toolbelt. A collection of **MCP Servers** (Desktop, Browser, Sandbox) that perform actual actions. Includes a **Tool Forge** to generate new tools on the fly.
    *   **执行层**: 工具带。由一系列 **MCP Servers**（桌面、浏览器、沙箱）组成，负责实际行动。包含一个**工具锻造厂 (Tool Forge)** 用于动态生成新工具。
4.  **👁️ Interaction Layer (交互层)**: The Senses. Handles multimodal input (Audio/Video/Text) and output via a unified event bus.
    *   **交互层**: 感官。通过统一事件总线处理多模态输入（音视频/文本）和输出。

🛡️ **Safety Layer (安全层)**: A cross-cutting "Guardian" that audits plans, filters inputs, and requires Human-in-the-Loop confirmation for critical actions.
🛡️ **安全层**: 贯穿全周期的“守护者”，负责审计计划、过滤输入，并对关键操作强制要求人工确认。

## 🚀 Tech Stack / 技术栈

*   **Runtime**: Node.js (Electron)
*   **Language**: TypeScript
*   **Protocol**: Model Context Protocol (MCP)
*   **AI**: OpenAI / Anthropic API
*   **State Management**: XState
*   **Automation**: nut.js (Desktop), Playwright (Web)

## 📂 Directory Structure / 目录结构

```
src/
├── main/
│   ├── intelligence/  # Layer 1: Planning & Reasoning
│   ├── control/       # Layer 2: Workflow & Skills
│   ├── execution/     # Layer 3: MCP Servers & Tool Forge
│   ├── interaction/   # Layer 4: Multimodal I/O
│   ├── guardian/      # Safety & Security Middleware
│   └── memory/        # Vector DB & Context Management
├── renderer/          # UI (React + Overlay)
└── common/            # Shared Types & IPC Interfaces
```

## 🗓️ Roadmap / 路线图

- [ ] **Phase 1**: Skeleton Setup & MCP Architecture
- [ ] **Phase 2**: PC Control (Mouse/Keyboard) & Basic Planning
- [ ] **Phase 3**: Tool Forge (Code Generation Sandbox)
- [ ] **Phase 4**: Safety Guardian & Visual Feedback
- [ ] **Phase 5**: Hardware & Social Extensions

---
*Dedicated to Zhou Yi (Dipu).*
