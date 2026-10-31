import { describe, expect, it } from "vitest";
import { graph } from "../test/fake";
import { layout, size } from "./layout";
import { buildForest, view, type VNode } from "./tree";

const node = (over: Partial<VNode>): VNode => ({
  id: "p:x",
  type: "package",
  label: "x",
  kind: "own",
  size: 1,
  tone: 0,
  ...over,
});

describe("size", () => {
  it("fits the label, within bounds", () => {
    expect(size(node({ label: "a" }))).toEqual({ width: 128, height: 44 });
    expect(size(node({ label: "a".repeat(80) })).width).toBe(300);
    expect(size(node({ type: "group", label: "a" }))).toEqual({
      width: 128,
      height: 56,
    });
  });

  it("makes room for a summary, wider for wide characters", () => {
    const latin = size(node({}), "a".repeat(20));
    const kana = size(node({}), "あ".repeat(20));
    expect(latin.height).toBe(60);
    expect(kana.width).toBeGreaterThan(latin.width);
    expect(size(node({}), "あ".repeat(200)).width).toBe(360);
  });
});

describe("layout", () => {
  it("places every node and routes every edge", async () => {
    const f = buildForest(graph);
    const v = view(
      f,
      new Set(["r:ex.com/app", "g:ex.com/app/internal"]),
      new Set(["own", "std"]),
    );
    const l = await layout(
      v,
      new Map([["ex.com/app/internal/server", "サーバーの起動"]]),
    );
    for (const n of v.nodes) expect(l.boxes.has(n.id)).toBe(true);
    for (const e of v.edges)
      expect(l.routes.get(e.id)?.length).toBeGreaterThan(1);
    expect(l.boxes.get("p:ex.com/app/internal/server")?.height).toBe(60);
  });

  it("lays out an empty view", async () => {
    const l = await layout({ nodes: [], edges: [], rep: new Map() });
    expect(l.boxes.size).toBe(0);
  });
});
