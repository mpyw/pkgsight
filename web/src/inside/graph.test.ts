import { describe, expect, it } from "vitest";
import type { Call, Func, FuncDetail } from "../data/types";
import { buildInside, receiver } from "./graph";

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
      "func Run +1",
      "type Server",
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
