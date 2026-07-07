import { describe, test, expect } from "vitest";
import { pluralSuffix } from "../../utils/text";

describe("pluralSuffix", () => {
  test("returns empty string for singular count", () => {
    expect(pluralSuffix(1)).toBe("");
  });

  test("returns s for plural count", () => {
    expect(pluralSuffix(0)).toBe("s");
    expect(pluralSuffix(2)).toBe("s");
  });
});
