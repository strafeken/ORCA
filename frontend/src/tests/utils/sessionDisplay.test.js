import { describe, test, expect } from "vitest";
import {
  formatAgent,
  timeUntil,
  timeIdle,
  idleWarnColor,
} from "../../utils/sessionDisplay";

describe("sessionDisplay utils", () => {
  const now = new Date("2026-01-01T12:00:00Z").getTime();

  test("formatAgent returns dash for empty user agent", () => {
    expect(formatAgent(null)).toBe("—");
  });

  test("formatAgent truncates long user agents", () => {
    const ua = "A".repeat(80);
    expect(formatAgent(ua)).toBe(`${"A".repeat(60)}…`);
  });

  test("timeUntil reports expired sessions", () => {
    expect(timeUntil("2025-12-31T12:00:00Z", now)).toBe("expired");
  });

  test("timeUntil formats hours and minutes", () => {
    expect(timeUntil("2026-01-01T14:30:00Z", now)).toBe("2h 30m");
  });

  test("timeIdle reports just now for recent activity", () => {
    expect(timeIdle("2026-01-01T11:59:50Z", now)).toBe("just now");
  });

  test("idleWarnColor turns amber after 10 minutes idle", () => {
    expect(idleWarnColor("2026-01-01T11:40:00Z", now)).toBe("#d97706");
    expect(idleWarnColor("2026-01-01T11:55:00Z", now)).toBe("var(--orca-muted)");
  });
});
