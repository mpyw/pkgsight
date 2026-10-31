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
