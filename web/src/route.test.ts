import { describe, expect, it } from "vitest";
import { rounded } from "./route";
import { hue } from "./tone";

describe("rounded", () => {
  it("draws a straight line between two points", () => {
    expect(
      rounded(
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        5,
      ),
    ).toBe("M 0 0 L 10 0");
  });

  it("rounds a corner, no wider than half of either side", () => {
    expect(
      rounded(
        [
          { x: 0, y: 0 },
          { x: 4, y: 0 },
          { x: 4, y: 20 },
        ],
        10,
      ),
    ).toBe("M 0 0 L 2 0 Q 4 0 4 2 L 4 20");
  });

  it("survives two points at the same place", () => {
    expect(
      rounded(
        [
          { x: 1, y: 1 },
          { x: 1, y: 1 },
          { x: 5, y: 1 },
        ],
        3,
      ),
    ).toBe("M 1 1 L 1 1 Q 1 1 1 1 L 5 1");
  });
});

describe("hue", () => {
  it("is stable and within a circle", () => {
    expect(hue("ex.com/m")).toBe(hue("ex.com/m"));
    expect(hue("")).toBe(0);
    for (const s of ["a", "internal", "日本"])
      expect(hue(s)).toBeGreaterThanOrEqual(0);
    expect(hue("zzzzzzzzzzzzzzzzzzzz")).toBeLessThan(360);
  });
});
