import { Position } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { ports } from "./ports";

describe("ports", () => {
  it("puts the handles on the left and right, or the top and bottom", () => {
    expect(ports(100, 40)).toEqual([
      { type: "target", position: Position.Left, x: 0, y: 20 },
      { type: "source", position: Position.Right, x: 100, y: 20 },
    ]);
    expect(ports(100, 40, true)).toEqual([
      { type: "target", position: Position.Top, x: 50, y: 0 },
      { type: "source", position: Position.Bottom, x: 50, y: 40 },
    ]);
  });
});
