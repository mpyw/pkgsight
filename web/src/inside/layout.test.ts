import { describe, expect, it } from "vitest";
import { details } from "../test/fake";
import { buildInside, type INode } from "./graph";
import { layoutInside, textWidth } from "./layout";

describe("textWidth", () => {
  it("counts wide characters wider", () => {
    expect(textWidth("ab", 10)).toBe(20);
    expect(textWidth("あ", 10)).toBe(18);
  });
});

describe("layoutInside", () => {
  const funcs = [...details.values()].filter(
    (d) => d.pkg === "ex.com/app/internal/server",
  );

  it("boxes methods by type and keeps callers left of callees", async () => {
    const g = buildInside("ex.com/app/internal/server", funcs, {
      closures: false,
    });
    const run = "ex.com/app/internal/server.Run";
    const l = await layoutInside(g, new Map([[run, "サーバーを動かす"]]));
    for (const n of g.nodes) expect(l.boxes.has(n.id)).toBe(true);
    for (const e of g.edges) expect(l.routes.has(e.id)).toBe(true);
    const x = (id: string) => l.boxes.get(id)!.x;
    expect(x("in:ex.com/app/cmd/app")).toBeLessThan(x(run));
    expect(x(run)).toBeLessThan(x("out:ex.com/app/internal/store"));
    expect(l.boxes.get(run)!.height).toBe(54);
    // A method sits inside its type, at a position relative to it.
    const t = l.boxes.get("type:Server")!;
    expect(
      l.boxes.get("ex.com/app/internal/server.(*Server).Serve")!.x,
    ).toBeLessThan(t.width);
  });

  it("sizes package ports and folded functions", async () => {
    const nodes: INode[] = [
      { id: "f", kind: "func", label: "f", folded: 2 },
      { id: "out:p", kind: "out", label: "a".repeat(100), pkg: "p" },
    ];
    const l = await layoutInside({ nodes, edges: [], calls: 0 }, new Map());
    expect(l.boxes.get("out:p")!.width).toBe(300);
    expect(l.boxes.get("f")!.width).toBe(140);
  });
});

describe("layoutInside files and tags", () => {
  it("sizes closed files, open files and nodes with tags", async () => {
    const tags = [{ id: "h", label: "helper" }];
    const nodes: INode[] = [
      {
        id: "file:a.go",
        kind: "file",
        label: "a.go",
        file: "a.go",
        count: 3,
        hub: 6,
        stubs: tags,
      },
      {
        id: "file:b.go",
        kind: "file",
        label: "b.go",
        file: "b.go",
        open: true,
      },
      { id: "f", kind: "func", label: "f", parentId: "file:b.go", stubs: tags },
      { id: "g", kind: "func", label: "g", parentId: "file:b.go", stubs: tags },
    ];
    const l = await layoutInside(
      { nodes, edges: [], calls: 0 },
      new Map([["g", "要約"]]),
    );
    expect(l.boxes.get("file:a.go")!.height).toBe(54);
    expect(l.boxes.get("f")!.height).toBe(54);
    expect(l.boxes.get("g")!.height).toBe(72);
    // An open file holds its functions.
    const b = l.boxes.get("file:b.go")!;
    expect(b.height).toBeGreaterThan(54 + 72);
  });
});
