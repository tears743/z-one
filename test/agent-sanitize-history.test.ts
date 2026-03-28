/**
 * Tests for Agent.sanitizeHistory() — ensures tool_calls/tool message pairing is valid
 * and prevents 400 errors from the OpenAI API.
 */

// Mock logger
jest.mock('../src/main/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

// Mock db
jest.mock('../src/main/db', () => ({
  getAppSettings: jest.fn().mockReturnValue({
    general: { agentWorkspace: '/tmp/test-workspace' },
    models: [],
  }),
}));

import { Agent } from '../src/main/agent/agent';
import { AgentMessage } from '../src/main/agent/types';
import { LLMService } from '../src/main/model/llm-service';
import { ToolRegistry } from '../src/main/execution/tool-registry';
import { McpHub } from '../src/main/control/mcp-hub';

jest.mock('../src/main/control/mcp-hub');
jest.mock('../src/main/model/llm-service');

describe('Agent sanitizeHistory', () => {
  let agent: Agent;

  beforeEach(() => {
    const mockLlm = new LLMService() as jest.Mocked<LLMService>;
    const mockMcp = new McpHub() as jest.Mocked<McpHub>;
    (mockMcp as any).getAllTools = jest.fn().mockResolvedValue([]);
    const toolRegistry = new ToolRegistry(mockMcp);

    agent = new Agent(
      {
        id: 'test-agent',
        name: 'Test Agent',
        role: 'executor',
        description: 'Test',
        modelConfig: { modelId: 'test', apiKey: 'test', provider: 'openai' } as any,
        systemPrompt: 'You are a test agent.',
        tools: [],
      },
      mockLlm,
      toolRegistry,
    );
  });

  test('should preserve valid tool_calls/tool pairings', () => {
    const history: AgentMessage[] = [
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'Hello' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call_abc', function: { name: 'read_file', arguments: '{"path":"test.txt"}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'call_abc', name: 'read_file', content: 'file contents' },
      { role: 'assistant', content: 'Here is the file.' },
    ];

    agent.setHistory(history);
    const result = agent.getHistory();

    // All messages should be preserved
    expect(result).toHaveLength(5);
    expect(result[2].tool_calls).toBeDefined();
    expect(result[2].tool_calls![0].id).toBe('call_abc');
    expect(result[3].role).toBe('tool');
    expect(result[3].tool_call_id).toBe('call_abc');
  });

  test('should handle orphaned tool messages (no preceding assistant+tool_calls)', () => {
    const history: AgentMessage[] = [
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'Hello' },
      // Orphaned tool message — no preceding assistant with tool_calls
      { role: 'tool', tool_call_id: 'call_xyz', name: 'read_file', content: 'some result' },
      { role: 'assistant', content: 'Done.' },
    ];

    agent.setHistory(history);
    const result = agent.getHistory();

    // Tool message should be converted to user message
    expect(result).toHaveLength(4);
    expect(result[2].role).toBe('user');
    expect(typeof result[2].content === 'string' && result[2].content.includes('[Tool Result')).toBe(true);
  });

  test('should handle assistant+tool_calls with missing tool responses', () => {
    const history: AgentMessage[] = [
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'Hello' },
      {
        role: 'assistant',
        content: 'Let me check.',
        tool_calls: [
          { id: 'call_111', function: { name: 'read_file', arguments: '{}' } },
          { id: 'call_222', function: { name: 'write_file', arguments: '{}' } },
        ],
      },
      // Only one tool response — call_222 is missing
      { role: 'tool', tool_call_id: 'call_111', name: 'read_file', content: 'result' },
      { role: 'user', content: 'Next question' },
    ];

    agent.setHistory(history);
    const result = agent.getHistory();

    // Assistant should have tool_calls stripped
    expect(result[2].role).toBe('assistant');
    expect(result[2].tool_calls).toBeUndefined();
    // Tool message should be converted to user observation
    expect(result[3].role).toBe('user');
    expect(typeof result[3].content === 'string' && result[3].content.includes('[Tool Result')).toBe(true);
  });

  test('should handle tool_calls without id (model did not return id)', () => {
    const history: AgentMessage[] = [
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'Hello' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { function: { name: 'read_file', arguments: '{}' } },  // No id!
        ],
      },
      { role: 'tool', name: 'read_file', content: 'result' },  // No tool_call_id!
      { role: 'assistant', content: 'Done.' },
    ];

    agent.setHistory(history);
    const result = agent.getHistory();

    // Since neither has valid ids, the pairing is broken
    // Assistant should be converted to plain message, tool to observation
    expect(result[2].role).toBe('assistant');
    expect(result[2].tool_calls).toBeUndefined();
    expect(result[3].role).toBe('user');
  });

  test('should handle multiple valid tool_calls in sequence', () => {
    const history: AgentMessage[] = [
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'Do two things' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call_a', function: { name: 'read_file', arguments: '{}' } },
          { id: 'call_b', function: { name: 'list_dir', arguments: '{}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'call_a', name: 'read_file', content: 'result a' },
      { role: 'tool', tool_call_id: 'call_b', name: 'list_dir', content: 'result b' },
      { role: 'assistant', content: 'Both done.' },
    ];

    agent.setHistory(history);
    const result = agent.getHistory();

    // All should be preserved
    expect(result).toHaveLength(6);
    expect(result[2].tool_calls).toHaveLength(2);
    expect(result[3].role).toBe('tool');
    expect(result[4].role).toBe('tool');
  });

  test('should handle history compression boundary (tool split from assistant)', () => {
    // Simulates what happens after compressHistoryIfNeeded slices history
    // The compressed summary replaces the earlier history, and recent messages
    // might start with tool messages whose assistant is now gone
    const history: AgentMessage[] = [
      { role: 'system', content: '[Compressed] Summary of earlier conversation' },
      // These tool messages were split from their assistant+tool_calls by compression
      { role: 'tool', tool_call_id: 'call_old1', name: 'read_file', content: 'old result' },
      { role: 'tool', tool_call_id: 'call_old2', name: 'write_file', content: 'old result 2' },
      { role: 'assistant', content: 'Final answer based on tools.' },
      { role: 'user', content: 'New question' },
    ];

    agent.setHistory(history);
    const result = agent.getHistory();

    // Orphaned tool messages should be converted
    expect(result[1].role).toBe('user');
    expect(result[2].role).toBe('user');
    // The rest should be preserved
    expect(result[3].role).toBe('assistant');
    expect(result[4].role).toBe('user');
    expect(result[4].content).toBe('New question');
  });
});
