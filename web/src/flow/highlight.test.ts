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

describe("highlight across lines", () => {
  it("carries a raw string over lines, and an unclosed comment to the end", () => {
    const lines = highlight([
      "s := `one",
      "two",
      "three` + x",
      "/* open",
      "still",
    ]);
    expect(lines[0].at(-1)).toEqual({ kind: "string", text: "`one" });
    expect(lines[1]).toEqual([{ kind: "string", text: "two" }]);
    expect(lines[2][0]).toEqual({ kind: "string", text: "three`" });
    expect(lines[4]).toEqual([{ kind: "comment", text: "still" }]);
  });

  it("opens a raw string on a lone backquote", () => {
    const lines = highlight(["x := `", "body`"]);
    expect(lines[1]).toEqual([{ kind: "string", text: "body`" }]);
  });

  it("reads runes and keywords before a parenthesis", () => {
    expect(kinds(`if ('a' == r) { return f() }`)).toEqual([
      "keyword:if",
      "string:'a'",
      "keyword:return",
      "func:f",
    ]);
  });
});
