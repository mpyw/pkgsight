import { describe, expect, it } from "vitest";
import type { Call, Func, FuncDetail } from "../data/types";
import { buildInside, HUB_CALLERS, receiver } from "./graph";

const fn = (pkg: string, name: string): Func => ({
  id: `${pkg}.${name}`,
  name,
  pkg,
  pkgName: pkg,
  kind: "own",
});
const call = (to: Func, mode: Call["mode"] = "call", lines = [1]): Call => ({
  to,
  mode,
  dispatch: "static",
  lines,
});

const [run, run1, serve, store, get, main] = [
  fn("app", "Run"),
  fn("app", "Run$1"),
  fn("app", "(*Server).Serve"),
  fn("app", "(*Server).store"),
  fn("db", "Get"),
  fn("cmd", "main"),
];
const funcs: FuncDetail[] = [
  {
    ...run,
    calls: [call(run1, "go"), call(serve, "call", [3, 4])],
    callers: [main],
  },
  { ...run1, calls: [call(store, "defer")], callers: [run] },
  { ...serve, calls: [call(store), call(get)], callers: [run] },
  { ...store, calls: [call(get)], callers: [run1, serve] },
];

const edges = (o: { closures: boolean }) =>
  buildInside("app", funcs, o)
    .edges.map((e) => `${e.source} -> ${e.target} ${e.mode} x${e.count}`)
    .sort();

describe("buildInside", () => {
  it("folds closures into the function that holds them", () => {
    const g = buildInside("app", funcs, { closures: false });
    expect(
      g.nodes.map(
        (n) =>
          `${n.kind} ${n.label}${n.parentId ? ` in ${n.parentId}` : ""}${n.folded ? ` +${n.folded}` : ""}`,
      ),
    ).toEqual([
      "type Server",
      "func Run +1",
      "func Serve in type:Server",
      "func store in type:Server",
      "in cmd",
      "out db",
    ]);
    expect(edges({ closures: false })).toEqual([
      "app.(*Server).Serve -> app.(*Server).store call x1",
      "app.(*Server).Serve -> out:db call x1",
      "app.(*Server).store -> out:db call x1",
      "app.Run -> app.(*Server).Serve call x2",
      "app.Run -> app.(*Server).store defer x1",
      "in:cmd -> app.Run call x1",
    ]);
  });

  it("shows closures on their own when asked", () => {
    expect(edges({ closures: true })).toContain("app.Run -> app.Run$1 go x1");
  });
});

describe("receiver", () => {
  it("strips the pointer and the type parameters", () => {
    expect(receiver("(*List[T]).Push")).toBe("List");
    expect(receiver("(english).Greet")).toBe("english");
    expect(receiver("Run$1")).toBeUndefined();
  });
});

describe("buildInside merging", () => {
  const [p, q, q1, r, ext] = [
    fn("app", "P"),
    fn("app", "Q"),
    fn("app", "Q$1"),
    fn("app", "R"),
    fn("db", "Get"),
  ];
  const merged: FuncDetail[] = [
    {
      ...q,
      calls: [
        { ...call(r, "defer"), dispatch: "interface", maybe: true },
        call(ext),
        { ...call(ext, "go"), lines: [9] },
      ],
      callers: [p, fn("cmd", "main"), fn("cmd", "init")],
    },
    {
      ...q1,
      calls: [{ ...call(r, "go"), maybe: true }, call(r)],
      callers: [q],
    },
    { ...r, calls: [], callers: [q] },
    { ...p, calls: [call(q)], callers: [] },
  ];

  it("keeps the strongest mode, and a guess only when every call is one", () => {
    const g = buildInside("app", merged, { closures: false });
    const e = g.edges.find((x) => x.id === "app.Q->app.R")!;
    expect(e).toMatchObject({
      mode: "go",
      dispatch: "interface",
      maybe: false,
      count: 3,
    });
    expect(g.nodes.find((n) => n.id === "app.Q")!.folded).toBe(1);
  });

  it("counts functions, not call sites, across packages", () => {
    const g = buildInside("app", merged, { closures: false });
    expect(g.edges.find((x) => x.id === "app.Q->out:db")).toMatchObject({
      count: 1,
      mode: "go",
    });
    expect(g.edges.find((x) => x.id === "in:cmd->app.Q")!.count).toBe(2);
  });
});

describe("buildInside files", () => {
  const at = (f: Func, file?: string): Func => ({ ...f, file });
  const [a, a1, b, c, gen] = [
    at(fn("app", "A"), "app/a.go"),
    at(fn("app", "A$1"), "app/a.go"),
    at(fn("app", "(*T).B"), "app/b.go"),
    at(fn("app", "C"), "app/b.go"),
    at(fn("app", "wrapper")),
  ];
  const filed: FuncDetail[] = [
    { ...a, calls: [call(a1), call(b)], callers: [] },
    { ...a1, calls: [call(c)], callers: [a] },
    { ...b, calls: [call(c)], callers: [a] },
    { ...c, calls: [], callers: [a1, b] },
    { ...gen, calls: [call(a)], callers: [] },
  ];
  const show = (open: string[]) => {
    const g = buildInside("app", filed, {
      closures: false,
      open: new Set(open),
    });
    return {
      nodes: g.nodes.map(
        (n) =>
          `${n.kind} ${n.label}${n.parentId ? ` in ${n.parentId}` : ""}${n.count ? ` (${n.count})` : ""}`,
      ),
      edges: g.edges
        .map((e) => `${e.source} -> ${e.target} x${e.count}`)
        .sort(),
    };
  };

  it("draws a closed file as one node, with the calls between files", () => {
    expect(show([])).toEqual({
      nodes: ["file a.go (1)", "file b.go (2)", "file (generated) (1)"],
      edges: ["file: -> file:app/a.go x1", "file:app/a.go -> file:app/b.go x2"],
    });
  });

  it("puts the functions and types of an open file inside it", () => {
    expect(show(["app/b.go"])).toEqual({
      nodes: [
        "file a.go (1)",
        "file b.go",
        "file (generated) (1)",
        "type T in file:app/b.go",
        "func B in type:app/b.go:T",
        "func C in file:app/b.go",
      ],
      edges: [
        "file: -> file:app/a.go x1",
        "file:app/a.go -> app.(*T).B x1",
        "file:app/a.go -> app.C x1",
        "app.(*T).B -> app.C x1",
      ].sort(),
    });
  });

  it("shows only the neighbors of the focus, without files", () => {
    const g = buildInside("app", filed, {
      closures: false,
      open: new Set(),
      focus: "app.C",
    });
    expect(g.nodes.map((n) => n.id)).toEqual([
      "type:T",
      "app.A",
      "app.(*T).B",
      "app.C",
    ]);
    expect(g.edges.map((e) => e.id).sort()).toEqual([
      "app.(*T).B->app.C",
      "app.A->app.C",
    ]);
  });

  it("finds a folded closure under the function that holds it", () => {
    const g = buildInside("app", filed, { closures: false, focus: "app.A$1" });
    expect(g.nodes.map((n) => n.id)).toContain("app.A");
  });
});

describe("buildInside hubs", () => {
  const hub = fn("app", "err");
  const users = Array.from({ length: HUB_CALLERS }, (_, i) =>
    fn("app", `U${i}`),
  );
  const few = fn("app", "few");
  const hubbed: FuncDetail[] = [
    { ...hub, calls: [], callers: [...users, fn("cmd", "main")] },
    { ...few, calls: [], callers: [users[0]] },
    ...users.map((u, i) => ({
      ...u,
      calls: i === 0 ? [call(hub), call(few)] : [call(hub)],
      callers: [],
    })),
  ];

  it("tags the callers of a hub instead of drawing a line from each", () => {
    const g = buildInside("app", hubbed, { closures: false });
    expect(g.nodes.find((n) => n.id === "app.err")!.hub).toBe(HUB_CALLERS);
    expect(g.nodes.find((n) => n.id === "app.U0")!.stubs).toEqual([
      { id: "app.err", label: "err" },
    ]);
    expect(
      g.edges.some(
        (e) => e.target === "app.err" && !e.source.startsWith("in:"),
      ),
    ).toBe(false);
    expect(g.edges.some((e) => e.id === "in:cmd->app.err")).toBe(true);
    expect(g.edges.filter((e) => e.target === "app.few")).toHaveLength(1);
  });

  it("draws every line to a hub in focus", () => {
    const g = buildInside("app", hubbed, { closures: false, focus: "app.err" });
    expect(g.nodes.find((n) => n.id === "app.err")!.hub).toBeUndefined();
    expect(g.edges.filter((e) => e.target === "app.err")).toHaveLength(
      HUB_CALLERS + 1,
    );
  });
});

describe("buildInside packages calling in", () => {
  const callers = Array.from({ length: 6 }, (_, i) => fn("cmd", `M${i}`));
  const local = Array.from({ length: 6 }, (_, i) => ({
    ...fn("app", `L${i}`),
    file: `app/l${i}.go`,
  }));
  const called: FuncDetail[] = [
    ...local.map((f, i) => ({ ...f, calls: [], callers: [callers[i]] })),
    // A method the compiler wrote, with no file.
    { ...fn("app", "(T).W"), calls: [], callers: [] },
  ];

  it("tags the files a package calls into, when it calls into many", () => {
    const g = buildInside("app", called, {
      closures: false,
      open: new Set([""]),
    });
    expect(g.nodes.find((n) => n.id === "in:cmd")!.hub).toBe(6);
    expect(g.nodes.find((n) => n.id === "file:app/l0.go")!.stubs).toEqual([
      { id: "in:cmd", label: "cmd", from: true },
    ]);
    expect(g.edges).toEqual([]);
    expect(g.nodes.find((n) => n.id === "type::T")!.parentId).toBe("file:");
  });

  it("draws its lines with every function shown", () => {
    const g = buildInside("app", called, { closures: false });
    expect(g.edges).toHaveLength(6);
  });
});
