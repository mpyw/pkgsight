import type { Call, Func, FuncDetail } from "../data/types";

// A function at one place in the call tree. The same function shows up once
// per path that reaches it, the way a trace would show it.
export interface FlowNode {
  // The path from the root, so it stays the same while siblings come and go.
  key: string;
  fn: Func;
  // The call that led here. The root has none.
  via?: Call;
  depth: number;
  children: FlowNode[];
  // The function is already on the path above, so expanding it would loop.
  recursive: boolean;
  // Own calls that a click would show. Undefined while unknown.
  hidden?: number;
  expanded: boolean;
}

export interface FlowOptions {
  // Calls into the standard library and dependencies.
  library: boolean;
}

export function visibleCalls(d: FuncDetail, o: FlowOptions): Call[] {
  return d.calls.filter((c) => o.library || c.to.kind === "own");
}

export function buildFlow(
  root: Func,
  details: ReadonlyMap<string, FuncDetail>,
  expanded: ReadonlySet<string>,
  o: FlowOptions,
): FlowNode {
  const walk = (
    key: string,
    fn: Func,
    via: Call | undefined,
    depth: number,
    path: ReadonlySet<string>,
  ): FlowNode => {
    const recursive = path.has(fn.id);
    const d = fn.kind === "own" && !recursive ? details.get(fn.id) : undefined;
    const calls = d ? visibleCalls(d, o) : [];
    const open = d !== undefined && expanded.has(key) && calls.length > 0;
    const inner = new Set(path).add(fn.id);
    return {
      key,
      fn,
      via,
      depth,
      recursive,
      expanded: open,
      hidden:
        fn.kind !== "own" || recursive
          ? 0
          : d
            ? open
              ? 0
              : calls.length
            : undefined,
      children: open
        ? calls.map((c) => walk(childKey(key, c), c.to, c, depth + 1, inner))
        : [],
    };
  };
  return walk(root.id, root, undefined, 0, new Set());
}

export function childKey(parent: string, c: Call): string {
  return `${parent}>${c.mode}${c.maybe ? "?" : ""}:${c.to.id}`;
}

export interface Placed {
  node: FlowNode;
  x: number;
  y: number;
}

export interface Size {
  column: number;
  row: number;
  width: number;
  height: number;
}

export const PLAIN: Size = { column: 320, row: 58, width: 264, height: 46 };
// With notes, each node has room for a summary under its name.
export const NOTED: Size = { column: 356, row: 80, width: 300, height: 66 };

// placeFlow lays the tree out left to right. A parent shares the row of its
// first child, and each later child takes the next free row, so the calls
// read top to bottom in source order.
export function placeFlow(root: FlowNode, size: Size = PLAIN): Placed[] {
  const out: Placed[] = [];
  const place = (n: FlowNode, row: number): number => {
    out.push({ node: n, x: n.depth * size.column, y: row * size.row });
    if (n.children.length === 0) return row + 1;
    let next = row;
    for (const c of n.children) next = place(c, next);
    return next;
  };
  place(root, 0);
  return out;
}

// pathTo lists the keys from the root down to key.
export function pathTo(key: string): string[] {
  const parts = key.split(">");
  return parts.map((_, i) => parts.slice(0, i + 1).join(">"));
}
