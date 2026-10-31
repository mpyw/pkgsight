import { describe, expect, it } from "vitest";
import type { Call, Func, FuncDetail } from "../data/types";
import { buildFlow, childKey, pathTo, placeFlow, visibleCalls } from "./tree";

const fn = (name: string, kind: Func["kind"] = "own"): Func => ({
  id: name,
  name,
  pkg: "p",
  pkgName: "p",
  kind,
});
const call = (to: Func, mode: Call["mode"] = "call"): Call => ({
  to,
  mode,
  dispatch: "static",
  lines: [1],
});
const detail = (f: Func, calls: Call[]): FuncDetail => ({
  ...f,
  calls,
  callers: [],
});

const [main, a, b, print] = [
  fn("main"),
  fn("a"),
  fn("b"),
  fn("Println", "std"),
];
const details = new Map([
  ["main", detail(main, [call(a), call(b, "go"), call(print)])],
  ["a", detail(a, [call(b)])],
  ["b", detail(b, [call(a)])],
]);

describe("buildFlow", () => {
  it("expands only what is open, and hides library calls", () => {
    const t = buildFlow(main, details, new Set(["main"]), { library: false });
    expect(
      t.children.map((c) => `${c.via?.mode} ${c.fn.name} hidden=${c.hidden}`),
    ).toEqual(["call a hidden=1", "go b hidden=1"]);
  });

  it("stops at recursion", () => {
    const ka = childKey("main", call(a));
    const kab = childKey(ka, call(b));
    const t = buildFlow(main, details, new Set(["main", ka, kab]), {
      library: true,
    });
    const back = t.children[0].children[0].children[0];
    expect(back.fn.name).toBe("a");
    expect(back.recursive).toBe(true);
    expect(back.hidden).toBe(0);
    expect(t.children.map((c) => c.fn.name)).toEqual(["a", "b", "Println"]);
  });
});

describe("placeFlow", () => {
  it("puts a parent on the row of its first child", () => {
    const ka = childKey("main", call(a));
    const t = buildFlow(main, details, new Set(["main", ka]), {
      library: false,
    });
    expect(
      placeFlow(t).map((p) => `${p.node.fn.name}@${p.node.depth},${p.y / 58}`),
    ).toEqual(["main@0,0", "a@1,0", "b@2,0", "b@1,1"]);
  });
});

describe("pathTo", () => {
  it("lists every ancestor key", () => {
    expect(pathTo("m>call:a>go:b")).toEqual(["m", "m>call:a", "m>call:a>go:b"]);
  });
});

describe("buildFlow before details arrive", () => {
  it("does not know how many calls a function hides", () => {
    const t = buildFlow(main, new Map(), new Set(["main"]), { library: false });
    expect(t.hidden).toBeUndefined();
    expect(t.expanded).toBe(false);
  });

  it("keys a guessed call apart from a sure one", () => {
    expect(childKey("m", { ...call(a), maybe: true })).toBe("m>call?:a");
  });
});

describe("visibleCalls", () => {
  it("keeps library calls only when asked", () => {
    const d = details.get("main")!;
    expect(visibleCalls(d, { library: false })).toHaveLength(2);
    expect(visibleCalls(d, { library: true })).toHaveLength(3);
  });
});
