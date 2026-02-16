import { Agent } from "../src/main/agent/agent";
import { AgentConfig } from "../src/main/agent/types";
import { ToolRegistry } from "../src/main/execution/tool-registry";
import { nativeTools } from "../src/main/execution/tools/native";
import { LLMService } from "../src/main/model/llm-service";
import { McpHub } from "../src/main/control/mcp-hub";

// Mock LLM Service
class MockLLMService extends LLMService {
  async generateCompletion(
    messages: any[],
    config: any,
    jsonMode: boolean,
    onChunk?: (chunk: string) => void,
  ): Promise<string> {
    const lastMsg = messages[messages.length - 1].content;
    console.log("MockLLM received:", lastMsg);

    if (lastMsg.includes("Navigate to google")) {
      const response = `I will navigate to Google.
\`\`\`json
{
  "tool": "browser_navigate",
  "args": { "url": "https://www.google.com" }
}
\`\`\``;

      // Simulate streaming
      if (onChunk) {
        const parts = response.split("");
        for (const p of parts) {
          onChunk(p);
          await new Promise((r) => setTimeout(r, 5));
        }
      }
      return response;
    }

    return "Task completed.";
  }
}

async function verifyBrowserTool() {
  console.log("Starting Browser Tool Verification...");

  // 1. Setup Registry
  const mcpHub = new McpHub(); // Mock or minimal
  // Mock mcpHub.getAllTools to return empty
  mcpHub.getAllTools = async () => [];

  const toolRegistry = new ToolRegistry(mcpHub);
  nativeTools.forEach((t) => toolRegistry.registerNativeTool(t));

  // Verify tools are registered
  const allTools = await toolRegistry.getAllTools();
  console.log(
    "Registered Tools:",
    allTools.map((t) => t.name),
  );

  if (!allTools.find((t) => t.name === "browser_navigate")) {
    throw new Error("browser_navigate tool not found in registry!");
  }

  // 2. Setup Agent directly (skipping Factory to avoid DB dependency)
  const llmService = new MockLLMService();

  const agentConfig: AgentConfig = {
    id: "test-agent",
    name: "Test Browser Agent",
    role: "assistant",
    description: "An agent that can browse the web",
    systemPrompt: "You are a helpful browser agent.",
    tools: ["browser_navigate", "browser_click", "browser_type"],
    modelConfig: {
      id: "mock-model",
      name: "Mock Model",
      modelType: "llm",
      enabled: true,
      modelId: "mock-model",
      provider: "mock" as any,
      apiKey: "mock",
      baseUrl: "mock",
    },
  };

  const agent = new Agent(agentConfig, llmService, toolRegistry);

  // 4. Run Agent
  console.log("Running agent...");
  const result = await agent.process(
    "Navigate to google and search for 'hello'",
  );
  console.log("Agent Result:", result);

  // Verify history
  const history = agent.getHistory();
  const toolOutput = history.find(
    (m) =>
      m.role === "user" &&
      typeof m.content === "string" &&
      m.content.includes("Tool Output (browser_navigate)"),
  );

  if (toolOutput) {
    console.log("✅ Tool executed successfully!");
    console.log("Output:", toolOutput.content);
  } else {
    console.error("❌ Tool execution not found in history.");
    console.log("History:", JSON.stringify(history, null, 2));
    process.exit(1);
  }

  process.exit(0);
}

verifyBrowserTool().catch((e) => {
  console.error(e);
  process.exit(1);
});
