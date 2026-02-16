// Mock logger
jest.mock("../../../src/main/logger", () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

import { TeamOrchestrator } from "../../../src/main/team/orchestrator";
import { LLMService } from "../../../src/main/model/llm-service";
import { McpHub } from "../../../src/main/control/mcp-hub";
import { AgentFactory } from "../../../src/main/agent/factory";
import { Agent } from "../../../src/main/agent/agent";
import { ToolRegistry } from "../../../src/main/execution/tool-registry";

// Mock dependencies
jest.mock("../../../src/main/model/llm-service");
jest.mock("../../../src/main/control/mcp-hub");
jest.mock("../../../src/main/agent/factory");
jest.mock("../../../src/main/agent/agent");
jest.mock("../../../src/main/execution/tool-registry");

describe("TeamManager", () => {
  let teamManager: TeamOrchestrator;
  let mockLLMService: jest.Mocked<LLMService>;
  let mockMcpHub: jest.Mocked<McpHub>;
  let mockToolRegistry: jest.Mocked<ToolRegistry>;
  let mockAgentFactory: jest.Mocked<AgentFactory>;
  let mockAgent: jest.Mocked<Agent>;

  beforeEach(() => {
    mockLLMService = new LLMService() as jest.Mocked<LLMService>;
    mockMcpHub = new McpHub() as jest.Mocked<McpHub>;
    mockToolRegistry = new ToolRegistry(
      mockMcpHub,
    ) as jest.Mocked<ToolRegistry>;
    mockAgentFactory = new AgentFactory(
      mockLLMService,
      mockToolRegistry,
    ) as jest.Mocked<AgentFactory>;

    // Setup Mock Agent
    mockAgent = new Agent(
      {} as any,
      mockLLMService,
      mockToolRegistry,
    ) as jest.Mocked<Agent>;
    mockAgent.process = jest.fn().mockResolvedValue("Task Completed");
    mockAgent.config = { modelConfig: {} } as any;

    mockAgentFactory.createCustomAgent.mockReturnValue(mockAgent);

    teamManager = new TeamOrchestrator(
      mockLLMService,
      mockToolRegistry,
      mockAgentFactory,
    );

    // Mock ToolRegistry tools
    mockToolRegistry.getAllTools.mockResolvedValue([
      { name: "tool1", description: "Tool 1", inputSchema: {} },
    ] as any);
  });

  test("should orchestrate a team based on a plan", async () => {
    // Mock LLM Plan Response
    const mockPlan = {
      thoughts: "We need a SQL expert.",
      isComplex: true,
      roster: [{ name: "SQLExpert", persona: "Handles SQL", tools: ["tool1"] }],
      mission: [
        {
          id: "stage1",
          name: "Stage 1",
          tasks: [
            {
              id: "1",
              description: "Run Query",
              assignedTo: "SQLExpert",
              dependencies: [],
            },
          ],
        },
      ],
    };

    mockLLMService.generateCompletion.mockResolvedValue(
      JSON.stringify(mockPlan),
    );

    const result = await teamManager.executeMission(
      "Run a query",
      "Context",
      {},
    );

    // Verify Steps
    expect(mockToolRegistry.getAllTools).toHaveBeenCalled();
    expect(mockLLMService.generateCompletion).toHaveBeenCalled();

    // Verify Agent Creation
    expect(mockAgentFactory.createCustomAgent).toHaveBeenCalledWith(
      "SQLExpert",
      "Handles SQL",
      ["tool1"],
    );

    // Verify Task Execution
    // Note: executeMission returns concatenated results
    expect(result).toContain("[SQLExpert]: Task Completed");
  });
});
