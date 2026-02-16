
// Mock logger
jest.mock('../../../src/main/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

import { ToolRegistry, NativeTool } from '../../../src/main/execution/tool-registry';
import { McpHub } from '../../../src/main/control/mcp-hub';

jest.mock('../../../src/main/control/mcp-hub');

describe('ToolRegistry', () => {
  let toolRegistry: ToolRegistry;
  let mockMcpHub: jest.Mocked<McpHub>;

  beforeEach(() => {
    mockMcpHub = new McpHub() as jest.Mocked<McpHub>;
    toolRegistry = new ToolRegistry(mockMcpHub);

    mockMcpHub.getAllTools.mockResolvedValue([
      { name: 'mcp_tool', description: 'MCP Tool', inputSchema: { type: 'object' } }
    ]);
    mockMcpHub.callTool.mockResolvedValue({
      content: [{ type: 'text', text: 'MCP Result' }]
    });
  });

  test('should register and execute native tools', async () => {
    const nativeTool: NativeTool = {
      name: 'native_tool',
      description: 'Native Tool',
      inputSchema: { type: 'object' },
      execute: jest.fn().mockResolvedValue('Native Result')
    };

    toolRegistry.registerNativeTool(nativeTool);

    const tools = await toolRegistry.getAllTools();
    expect(tools).toHaveLength(2); // 1 native + 1 MCP
    expect(tools.find(t => t.name === 'native_tool')).toBeDefined();

    const result = await toolRegistry.callTool('native_tool', {});
    expect(nativeTool.execute).toHaveBeenCalled();
    const content = result.content[0];
    if (content.type === 'text') {
        expect(content.text).toContain('Native Result');
    } else {
        fail('Expected text content');
    }
  });

  test('should fallback to MCP for unknown tools', async () => {
    const result = await toolRegistry.callTool('mcp_tool', { arg: 1 });
    
    expect(mockMcpHub.callTool).toHaveBeenCalledWith('unknown', 'mcp_tool', { arg: 1 });
    const content = result.content[0];
    if (content.type === 'text') {
        expect(content.text).toBe('MCP Result');
    } else {
        fail('Expected text content');
    }
  });
});
