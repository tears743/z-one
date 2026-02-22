import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { app } from "electron";
import * as os from "os";

export type PromptMode = "full" | "minimal" | "none" | "input";

export interface SystemPromptParams {
  role: string;
  name: string;
  mode?: PromptMode;
  tools?: Tool[];
  memoryContext?: string; // Content from memory search
  userInstructions?: string; // Custom user rules
  useLegacyTooling?: boolean; // If true, instructs model to use JSON for tools
}

export class SystemPromptBuilder {
  private sections: string[] = [];

  constructor(private params: SystemPromptParams) {}

  public build(): string {
    if (this.params.mode === "none") return "";

    this.addIdentitySection();
    this.addEnvironmentSection();

    if (this.params.mode === "full") {
      this.addToolingSection();
      this.addMemorySection();
      this.addRulesSection();
    } else if (this.params.mode === "input") {
      this.addMemorySection();
      // Input mode skips tooling and generic rules, but adds user instructions explicitly
      if (this.params.userInstructions) {
        this.sections.push(`## Instructions\n${this.params.userInstructions}`);
      }
    } else if (this.params.mode === "minimal") {
      // Minimal mode just has identity and environment
    }

    return this.sections.join("\n\n");
  }

  private addIdentitySection() {
    this.sections.push(
      `You are ${this.params.name}, a ${this.params.role} agent operating within the z-one IDE environment.`,
    );
  }

  private addEnvironmentSection() {
    const envInfo = [
      `OS: ${process.platform} (${os.release()})`,
      `Working Directory: ${process.cwd()}`,
      `Date: ${new Date().toISOString().split("T")[0]}`,
    ];
    this.sections.push(`## Environment\n${envInfo.join("\n")}`);
  }

  private addToolingSection() {
    if (!this.params.tools || this.params.tools.length === 0) return;

    const toolDescriptions = this.params.tools
      .map((t) => `- ${t.name}: ${t.description || "No description"}`)
      .join("\n");

    let section = `## Available Tools\nYou have access to the following tools. Use them to perform actions.\n${toolDescriptions}`;

    if (this.params.useLegacyTooling) {
      section += `\n\nIMPORTANT: You must invoke tools by outputting a JSON block. Do NOT just describe the action.\nFormat:\n\`\`\`json\n{\n  "action": "tool_name",\n  "args": {\n    "arg_name": "value"\n  }\n}\n\`\`\``;
    }

    this.sections.push(section);
  }

  private addMemorySection() {
    // Instructions on how to use memory
    // OpenClaw style: "Files as Source of Truth"
    this.sections.push(
      `## Memory & Knowledge
You have access to a persistent memory system.
- **Session Memory**: Recent interactions are tracked automatically.
- **Long-term Memory**: Critical information is stored in 'MEMORY.md' and indexed.
- **Retrieval**: When answering complex questions, use 'memory_search' (if available) to recall relevant information from the knowledge base.
`,
    );

    if (this.params.memoryContext) {
      this.sections.push(
        `## Relevant Context (Retrieved from Memory)\n${this.params.memoryContext}`,
      );
    }
  }

  private addRulesSection() {
    const rules = [
      "1. **Autonomy**: Do not ask for confirmation unless the action is destructive.",
      "2. **Files**: Prefer editing existing files over creating new ones. Use 'read_file' before editing.",
      "3. **Code**: Write clean, efficient, and well-documented code.",
      "4. **Verification**: Verify your work (e.g., run tests, check syntax) before finishing.",
    ];

    if (this.params.userInstructions) {
      rules.push(`\n## User Instructions\n${this.params.userInstructions}`);
    }

    this.sections.push(`## Operational Rules\n${rules.join("\n")}`);
  }
}

export function buildAgentSystemPrompt(params: SystemPromptParams): string {
  const builder = new SystemPromptBuilder(params);
  return builder.build();
}
