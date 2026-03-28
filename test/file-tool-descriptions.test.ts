/**
 * Tests for file tool descriptions — verifies that tool descriptions
 * properly inform AI about workspace path resolution behavior.
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

import { ReadFileTool, WriteFileTool, ListDirTool } from '../src/main/execution/tools/native/fs';

describe('File Tool Descriptions', () => {
  const tools = [
    { name: 'read_file', tool: ReadFileTool },
    { name: 'write_file', tool: WriteFileTool },
    { name: 'list_dir', tool: ListDirTool },
  ];

  for (const { name, tool } of tools) {
    test(`${name} description should mention automatic workspace resolution`, () => {
      expect(tool.description.toLowerCase()).toContain('automatically');
      expect(tool.description.toLowerCase()).toContain('relative');
    });

    test(`${name} path parameter should explain workspace prepending`, () => {
      const pathParam = tool.inputSchema.properties.path;
      expect(pathParam.description.toLowerCase()).toContain('workspace');
      expect(pathParam.description.toLowerCase()).toContain('relative');
    });

    test(`${name} description should mention using relative paths`, () => {
      // Should have examples like 'notes/todo.md' or similar
      expect(tool.description).toMatch(/e\.g\.\s*['"]/);
    });
  }
});
