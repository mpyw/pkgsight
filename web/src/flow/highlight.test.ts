import { describe, expect, it } from "vitest";
import { highlight } from "./highlight";

const kinds = (line: string) =>
  highlight([line])[0]
    .filter((t) => t.kind !== "plain")
    .map((t) => `${t.kind}:${t.text}`);

describe("highlight", () => {
  it("colors keywords, calls, strings and comments", () => {
    expect(kinds(`go run("x", 42) // start`)).toEqual([
      "keyword:go",
      "func:run",
      'string:"x"',
      "number:42",
      "comment:// start",
    ]);
  });

  it("carries a block comment over lines", () => {
    const lines = highlight(["a /* one", "two */ return nil"]);
    expect(lines[1].map((t) => t.kind)).toEqual([
      "comment",
      "plain",
      "keyword",
      "plain",
      "type",
    ]);
  });
});
