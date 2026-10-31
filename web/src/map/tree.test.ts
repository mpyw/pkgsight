import { describe, expect, it } from "vitest";
import type { Graph, Package } from "../data/types";
import {
  allDirectories,
  ancestors,
  buildForest,
  initialExpanded,
  view,
} from "./tree";

const pkg = (
  path: string,
  imports: string[] = [],
  kind: Package["kind"] = "own",
): Package => ({
  path,
  name: path.split("/").at(-1)!,
  kind,
  module: kind === "std" ? undefined : "ex.com/m",
  dir: "",
  files: [],
  imports,
});

const graph: Graph = {
  root: "/m",
  modules: [{ path: "ex.com/m", main: true }],
  packages: [
    pkg("ex.com/m", ["ex.com/m/internal/a/x"]),
    pkg("ex.com/m/cmd/tool", [
      "ex.com/m/internal/a/x",
      "ex.com/m/internal/b",
      "fmt",
    ]),
    pkg("ex.com/m/internal/a/x", ["ex.com/m/internal/b"]),
    pkg("ex.com/m/internal/a/y", ["ex.com/m/internal/b"]),
    pkg("ex.com/m/internal/b"),
    pkg("fmt", [], "std"),
  ],
};

describe("buildForest", () => {
  it("compresses single-child directories", () => {
    const f = buildForest(graph);
    const root = f.roots[0];
    expect(root.children.map((c) => c.label)).toEqual(["cmd/tool", "internal"]);
    expect(root.children[0].id).toBe("p:ex.com/m/cmd/tool");
    expect(root.size).toBe(5);
    expect(f.importers.get("ex.com/m/internal/b")).toHaveLength(3);
  });
});

describe("view", () => {
  it("folds imports into a collapsed directory", () => {
    const f = buildForest(graph);
    const v = view(f, new Set(["r:ex.com/m"]), new Set(["own"]));
    expect(v.nodes.map((n) => `${n.type}:${n.id}`)).toEqual([
      "container:r:ex.com/m",
      "package:p:ex.com/m",
      "package:p:ex.com/m/cmd/tool",
      "group:g:ex.com/m/internal",
    ]);
    // a/x -> b and a/y -> b both stay inside internal and vanish.
    expect(v.edges).toEqual([
      {
        id: "p:ex.com/m->g:ex.com/m/internal",
        source: "p:ex.com/m",
        target: "g:ex.com/m/internal",
        count: 1,
      },
      {
        id: "p:ex.com/m/cmd/tool->g:ex.com/m/internal",
        source: "p:ex.com/m/cmd/tool",
        target: "g:ex.com/m/internal",
        count: 2,
      },
    ]);
  });

  it("draws edges to a kind only while it is shown", () => {
    const f = buildForest(graph);
    const toStd = (kinds: Package["kind"][]) =>
      view(f, new Set(["r:ex.com/m"]), new Set(kinds)).edges.some(
        (e) => e.target === "r:std",
      );
    expect(toStd(["own"])).toBe(false);
    expect(toStd(["own", "std"])).toBe(true);
  });
});

describe("initialExpanded", () => {
  it("expands within the budget", () => {
    const f = buildForest(graph);
    expect([...initialExpanded(f, 4)]).toEqual(["r:ex.com/m"]);
    expect(initialExpanded(f, 99).size).toBe(3);
  });
});

describe("ancestors", () => {
  it("lists the directories to open", () => {
    const f = buildForest(graph);
    expect(ancestors(f, "ex.com/m/internal/a/x")).toEqual([
      "g:ex.com/m/internal/a",
      "g:ex.com/m/internal",
      "r:ex.com/m",
    ]);
  });
});

describe("allDirectories", () => {
  it("lists every directory of the shown kinds", () => {
    const f = buildForest(graph);
    expect([...allDirectories(f, new Set(["own"]))].sort()).toEqual([
      "g:ex.com/m/internal",
      "g:ex.com/m/internal/a",
      "r:ex.com/m",
    ]);
    expect([...allDirectories(f, new Set(["std"]))]).toEqual(["r:std"]);
  });
});

describe("buildForest roots", () => {
  it("orders the module first, then the standard library, then dependencies", () => {
    const f = buildForest({
      ...graph,
      packages: [
        pkg("z.org/dep/x", [], "ext"),
        ...graph.packages,
        pkg("net/http", ["fmt"], "std"),
      ].map((p) => (p.kind === "ext" ? { ...p, module: "z.org/dep" } : p)),
    });
    expect(f.roots.map((r) => r.label)).toEqual([
      "ex.com/m",
      "std",
      "z.org/dep",
    ]);
    const std = f.roots[1];
    expect(std.children.map((c) => c.label)).toEqual(["fmt", "net/http"]);
  });

  it("gives each child of a grouping directory its own hue", () => {
    const f = buildForest(graph);
    const internal = f.holder.get("ex.com/m/internal/b")!.parent!;
    const [a, b] = internal.children;
    expect(a.tone).not.toBe(b.tone);
  });
});

describe("ancestors of a package with subdirectories", () => {
  it("opens the package's own directory too", () => {
    const f = buildForest(graph);
    expect(ancestors(f, "ex.com/m")).toEqual(["r:ex.com/m"]);
    expect(ancestors(f, "nope")).toEqual([]);
  });
});
