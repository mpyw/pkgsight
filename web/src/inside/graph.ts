import type { Call, Dispatch, FuncDetail, Mode } from "../data/types";

// The inside of one package: its functions, the calls between them, and
// the other packages of the module that call in or are called.
export interface Inside {
  nodes: INode[];
  edges: IEdge[];
}

export type INodeKind = "func" | "type" | "in" | "out";

export interface INode {
  id: string;
  kind: INodeKind;
  // The type box that holds a method.
  parentId?: string;
  label: string;
  // The function of a func node.
  fn?: FuncDetail;
  // The package of an in or out node.
  pkg?: string;
  // Closures folded into a func node.
  folded?: number;
}

export interface IEdge {
  id: string;
  source: string;
  target: string;
  // Call sites, or functions for an edge to or from another package.
  count: number;
  // The strongest way any of the folded calls starts the callee.
  mode: Mode;
  dispatch: Dispatch;
  // Every folded call is only a guess.
  maybe: boolean;
}

export interface InsideOptions {
  // Show each closure as its own node instead of folding it into the
  // function that holds it.
  closures: boolean;
}

// buildInside lays out the package at path from its functions, as the call
// graph returns them in source order.
export function buildInside(
  path: string,
  funcs: FuncDetail[],
  o: InsideOptions,
): Inside {
  const byName = new Map(funcs.map((f) => [f.name, f]));
  // owner maps each function to the node that shows it.
  const owner = new Map<string, string>();
  for (const f of funcs) {
    const outer = f.name.split("$")[0];
    const home = o.closures ? f : (byName.get(outer) ?? f);
    owner.set(f.id, home.id);
  }

  const nodes: INode[] = [];
  const types = new Map<string, INode>();
  for (const f of funcs) {
    if (owner.get(f.id) !== f.id) {
      const home = nodes.find((n) => n.id === owner.get(f.id));
      if (home) home.folded = (home.folded ?? 0) + 1;
      continue;
    }
    const recv = receiver(f.name);
    let parentId: string | undefined;
    if (recv) {
      parentId = `type:${recv}`;
      if (!types.has(recv)) {
        const t: INode = { id: parentId, kind: "type", label: recv };
        types.set(recv, t);
        nodes.push(t);
      }
    }
    nodes.push({
      id: f.id,
      kind: "func",
      parentId,
      label: recv ? f.name.slice(f.name.indexOf(").") + 2) : f.name,
      fn: f,
    });
  }

  const edges = new Map<string, IEdge>();
  const add = (source: string, target: string, c: Call | undefined, n = 1) => {
    if (source === target) return;
    const id = `${source}->${target}`;
    const e = edges.get(id);
    if (!e) {
      edges.set(id, {
        id,
        source,
        target,
        count: n,
        mode: c?.mode ?? "call",
        dispatch: c?.dispatch ?? "static",
        maybe: c?.maybe ?? false,
      });
      return;
    }
    e.count += n;
    if (c) {
      e.mode = stronger(e.mode, c.mode);
      if (c.dispatch !== "static") e.dispatch = c.dispatch;
      e.maybe &&= c.maybe ?? false;
    }
  };

  const outs = new Map<string, Set<string>>();
  const ins = new Map<string, Set<string>>();
  const note = (m: Map<string, Set<string>>, key: string, v: string) =>
    m.set(key, (m.get(key) ?? new Set()).add(v));

  for (const f of funcs) {
    const from = owner.get(f.id)!;
    for (const c of f.calls) {
      if (c.to.kind !== "own") continue;
      if (c.to.pkg === path) {
        const to = owner.get(c.to.id);
        if (to) add(from, to, c, c.lines.length);
      } else {
        note(outs, `${from}\n${c.to.pkg}`, c.to.id);
        add(from, `out:${c.to.pkg}`, c, 0);
      }
    }
    for (const caller of f.callers)
      if (caller.pkg !== path) note(ins, `${caller.pkg}\n${from}`, caller.id);
  }
  // An edge across packages counts the functions on the far side.
  for (const [key, ids] of outs) {
    const [from, pkg] = key.split("\n");
    edges.get(`${from}->out:${pkg}`)!.count = ids.size;
  }
  for (const [key, ids] of ins) {
    const [pkg, to] = key.split("\n");
    add(`in:${pkg}`, to, undefined, ids.size);
  }

  const pkgsOf = (prefix: string) =>
    [
      ...new Set(
        [...edges.values()]
          .flatMap((e) => [e.source, e.target])
          .filter((id) => id.startsWith(prefix)),
      ),
    ].sort();
  for (const id of pkgsOf("in:"))
    nodes.push({ id, kind: "in", label: id.slice(3), pkg: id.slice(3) });
  for (const id of pkgsOf("out:"))
    nodes.push({ id, kind: "out", label: id.slice(4), pkg: id.slice(4) });

  return { nodes, edges: [...edges.values()] };
}

// receiver returns the receiver type of a method name like "(*Server).Start"
// or "(*List[T]).Push", without the pointer and the type parameters.
export function receiver(name: string): string | undefined {
  const m = /^\(\*?([^)[]+)(?:\[[^)]*\])?\)\./.exec(name);
  return m?.[1];
}

const rank: Record<Mode, number> = { call: 0, defer: 1, go: 2 };

function stronger(a: Mode, b: Mode): Mode {
  return rank[b] > rank[a] ? b : a;
}
