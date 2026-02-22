import dayjs from "dayjs";
import { GetCurrentTimeTool } from "../../../src/main/execution/tools/time";

describe("GetCurrentTimeTool", () => {
  test("should have correct metadata", () => {
    expect(GetCurrentTimeTool.name).toBe("get_current_time");
    expect(GetCurrentTimeTool.inputSchema).toEqual({
      type: "object",
      properties: {},
    });
  });

  test("should return formatted current time string", async () => {
    const before = dayjs();
    const result = await GetCurrentTimeTool.execute({});
    const parsed = dayjs(result, "yyyy-MM-dd HH:mm:ss", true);

    expect(parsed.isValid()).toBe(true);
    const diff = Math.abs(parsed.diff(before, "second"));
    expect(diff).toBeLessThan(5);
  });
});
