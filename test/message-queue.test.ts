/**
 * Tests for message-queue content normalization.
 *
 * The frontend sends `content` as `{content: string, images: string[]}`,
 * but Planner.processInput expects `string | Array<{type,text}|{type,image_url}>`.
 * The MessageQueue must normalize before passing to processInput.
 */
import { WebSocket } from "ws";

// Mock logger (uses Electron app.getPath which isn't available in test)
jest.mock("@/main/logger", () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

import { MessageQueue, QueueItem } from "@/main/interaction/message-queue";

// ── Mock Planner ──────────────────────────────────────────────────────
const mockProcessInput = jest.fn().mockResolvedValue("ok");

const fakePlanner = {
  processInput: mockProcessInput,
  llmService: {
    generateCompletion: jest.fn().mockResolvedValue('{"action":"queue","reason":"test"}'),
  },
} as any;

// ── Helpers ───────────────────────────────────────────────────────────
function makeQueueItem(content: any, overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: "test-id",
    deviceId: "device-1",
    ws: {} as WebSocket,
    message: {
      type: "text",
      timestamp: Date.now(),
      payload: { content, sessionId: "s1" },
    } as any,
    abortController: new AbortController(),
    status: "pending",
    modelConfig: { stream: true },
    sessionId: "s1",
    onStream: jest.fn(),
    onComplete: jest.fn(),
    onError: jest.fn(),
    ...overrides,
  };
}

describe("MessageQueue content normalization", () => {
  let queue: MessageQueue;

  beforeEach(() => {
    mockProcessInput.mockReset().mockResolvedValue("ok");
    queue = new MessageQueue(fakePlanner);
  });

  test("normalizes string content (pass-through)", async () => {
    const item = makeQueueItem("Hello world");
    await queue.enqueue(item);

    // Wait for async processing
    await new Promise((r) => setTimeout(r, 50));

    expect(mockProcessInput).toHaveBeenCalledWith(
      "device-1",
      "Hello world",
      expect.anything(),
      expect.any(Function),
      "s1",
      expect.anything(),
    );
  });

  test("normalizes {content, images:[]} object to plain string", async () => {
    const item = makeQueueItem({ content: "Tell me a joke", images: [] });
    await queue.enqueue(item);
    await new Promise((r) => setTimeout(r, 50));

    // Should extract the text content, not pass the object
    expect(mockProcessInput).toHaveBeenCalledWith(
      "device-1",
      "Tell me a joke",
      expect.anything(),
      expect.any(Function),
      "s1",
      expect.anything(),
    );
  });

  test("normalizes {content, images:[...]} object to multimodal array", async () => {
    const item = makeQueueItem({
      content: "What is this?",
      images: ["data:image/png;base64,abc123", "data:image/png;base64,def456"],
    });
    await queue.enqueue(item);
    await new Promise((r) => setTimeout(r, 50));

    const calledContent = mockProcessInput.mock.calls[0][1];
    expect(Array.isArray(calledContent)).toBe(true);
    expect(calledContent).toHaveLength(3); // 1 text + 2 images
    expect(calledContent[0]).toEqual({ type: "text", text: "What is this?" });
    expect(calledContent[1]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,abc123" },
    });
    expect(calledContent[2]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,def456" },
    });
  });

  test("normalizes already-array content (pass-through)", async () => {
    const multimodal = [
      { type: "text", text: "Hi" },
      { type: "image_url", image_url: { url: "data:..." } },
    ];
    const item = makeQueueItem(multimodal);
    await queue.enqueue(item);
    await new Promise((r) => setTimeout(r, 50));

    expect(mockProcessInput).toHaveBeenCalledWith(
      "device-1",
      multimodal,
      expect.anything(),
      expect.any(Function),
      "s1",
      expect.anything(),
    );
  });

  test("normalizes {content: '', images: []} with empty text to empty string", async () => {
    const item = makeQueueItem({ content: "", images: [] });
    await queue.enqueue(item);
    await new Promise((r) => setTimeout(r, 50));

    expect(mockProcessInput).toHaveBeenCalledWith(
      "device-1",
      "",
      expect.anything(),
      expect.any(Function),
      "s1",
      expect.anything(),
    );
  });

  test("normalizes unexpected type to string via String()", async () => {
    const item = makeQueueItem(42);
    await queue.enqueue(item);
    await new Promise((r) => setTimeout(r, 50));

    expect(mockProcessInput).toHaveBeenCalledWith(
      "device-1",
      "42",
      expect.anything(),
      expect.any(Function),
      "s1",
      expect.anything(),
    );
  });

  test("calls onComplete after successful processing", async () => {
    const onComplete = jest.fn();
    const item = makeQueueItem("Hi", { onComplete });
    await queue.enqueue(item);
    await new Promise((r) => setTimeout(r, 50));

    expect(onComplete).toHaveBeenCalledWith("ok");
  });

  test("calls onError when processInput throws", async () => {
    mockProcessInput.mockRejectedValueOnce(new Error("LLM down"));
    const onError = jest.fn();
    const item = makeQueueItem("Hi", { onError });
    await queue.enqueue(item);
    await new Promise((r) => setTimeout(r, 100));

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(onError.mock.calls[0][0].message).toBe("LLM down");
  });
});

describe("MessageQueue supervisor triage", () => {
  let queue: MessageQueue;

  beforeEach(() => {
    mockProcessInput.mockReset();
    queue = new MessageQueue(fakePlanner);
  });

  test("processes immediately when no active task", async () => {
    mockProcessInput.mockResolvedValue("response");
    const item = makeQueueItem("Hello");
    await queue.enqueue(item);
    await new Promise((r) => setTimeout(r, 50));

    expect(mockProcessInput).toHaveBeenCalledTimes(1);
  });

  test("getQueueLength returns 0 for empty queue", () => {
    expect(queue.getQueueLength("device-1")).toBe(0);
  });

  test("isProcessing returns false initially", () => {
    expect(queue.isProcessing("device-1")).toBe(false);
  });
});
