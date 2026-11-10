import { describe, it, expect } from "vitest";
import { formatDate, formatDateTime, toDateTimeLocal, fromDateTimeLocal } from "../src/web/lib/format.js";

describe("format", () => {
  it("formats a date-only value from its parts, independent of timezone", () => {
    expect(formatDate("2026-11-08")).toBe("11-08-2026");
    expect(formatDate("2026-01-01")).toBe("01-01-2026");
  });

  it("formats a datetime in 12 hour time with am or pm", () => {
    const local = new Date(2026, 10, 8, 15, 5).toISOString();
    expect(formatDateTime(local)).toBe("11-08-2026 3:05 pm");
    expect(formatDateTime(new Date(2026, 10, 8, 0, 30).toISOString())).toBe("11-08-2026 12:30 am");
  });

  it("round trips ISO to datetime-local to ISO without drifting", () => {
    const iso = new Date(2026, 10, 8, 9, 15).toISOString();
    const local = toDateTimeLocal(iso);
    expect(local).toBe("2026-11-08T09:15");
    expect(fromDateTimeLocal(local)).toBe(iso);
    expect(fromDateTimeLocal(toDateTimeLocal(fromDateTimeLocal(local)))).toBe(iso);
  });

  it("handles empty input", () => {
    expect(toDateTimeLocal(null)).toBe("");
    expect(fromDateTimeLocal("")).toBeNull();
  });
});
