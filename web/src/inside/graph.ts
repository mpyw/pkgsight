import type { Call, Dispatch, FuncDetail, Mode } from "../data/types";

// The inside of one package: its functions, the calls between them, and
// the other packages of the module that call in or are called.
export interface Inside {
  nodes: INode[];
  edges: IEdge[];
  // The lines between nodes of the package, hubs' included.
  calls: number;
}

export type INodeKind = "func" | "type" | "file" | "in" | "out";

// A function called from this many nodes or more is a hub. Its callers
// carry a tag for it instead of a line each, which would cross the view.
// With files closed, a quarter of the boxes on screen, but at least
// HUB_FLOOR, is enough: each box then stands for many functions.
export const HUB_CALLERS = 8;
export const HUB_FLOOR = 5;

// A package with more functions than this starts with its files closed.
export const GROUP_AT = 40;

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
  // The source file of a file node.
  file?: string;
  // A file node shows its functions inside.
  open?: boolean;
  // The functions in a closed file node.
  count?: number;
  // The hubs this node calls, or the packages calling in that it is
  // called from, drawn as tags instead of lines.
  stubs?: { id: string; label: string; from?: boolean }[];
  // How many nodes a hub is called from, or a package calling in calls,
  // with no line drawn.
  hub?: number;
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
  // Group the functions by file, with only these files open. Without it,
  // every function shows and no file does.
  open?: ReadonlySet<string>;
  // Show only this function and the nodes it calls or is called by,
  // without files. It wins over open.
  focus?: string;
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

  const grouped = o.open !== undefined && o.focus === undefined;
  let nodes: INode[] = [];
  const byId = new Map<string, INode>();
  const push = (n: INode) => {
    nodes.push(n);
    byId.set(n.id, n);
    return n;
  };
  const fileNode = (file: string) =>
    byId.get(`file:${file}`) ??
    push({
      id: `file:${file}`,
      kind: "file",
      label: file ? file.slice(file.lastIndexOf("/") + 1) : "(generated)",
      file,
      open: o.open!.has(file),
      count: 0,
    });
  for (const f of funcs) {
    const home = owner.get(f.id)!;
    let fileId: string | undefined;
    if (grouped) {
      // A function the compiler wrote has no file.
      const file = fileNode(f.file ?? "");
      fileId = file.id;
      if (!file.open) {
        if (home === f.id) file.count!++;
        owner.set(f.id, file.id);
        continue;
      }
    }
    if (home !== f.id) {
      const n = byId.get(home);
      if (n) n.folded = (n.folded ?? 0) + 1;
      continue;
    }
    const recv = receiver(f.name);
    let parentId = fileId;
    if (recv) {
      const id = grouped ? `type:${f.file ?? ""}:${recv}` : `type:${recv}`;
      if (!byId.has(id)) push({ id, kind: "type", parentId, label: recv });
      parentId = id;
    }
    push({
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
    push({ id, kind: "in", label: id.slice(3), pkg: id.slice(3) });
  for (const id of pkgsOf("out:"))
    push({ id, kind: "out", label: id.slice(4), pkg: id.slice(4) });

  let kept = [...edges.values()];
  const calls = kept.filter(
    (e) => !e.source.includes(":") && !e.target.includes(":"),
  ).length;
  if (o.focus !== undefined) {
    const at = owner.get(o.focus) ?? o.focus;
    kept = kept.filter((e) => e.source === at || e.target === at);
    const keep = new Set([at, ...kept.flatMap((e) => [e.source, e.target])]);
    for (const n of nodes)
      if (keep.has(n.id) && n.parentId) keep.add(n.parentId);
    nodes = nodes.filter((n) => keep.has(n.id));
  } else {
    const shown = nodes.filter((n) => n.kind === "func" || n.kind === "file");
    const many = grouped
      ? Math.max(HUB_FLOOR, Math.ceil(shown.length / 4))
      : HUB_CALLERS;
    const callers = new Map<string, IEdge[]>();
    const callIns = new Map<string, IEdge[]>();
    for (const e of kept) {
      const to = byId.get(e.target)?.kind;
      if (to !== "func" && to !== "file") continue;
      const m = e.source.startsWith("in:") ? callIns : callers;
      const key = m === callIns ? e.source : e.target;
      m.set(key, [...(m.get(key) ?? []), e]);
    }
    const stubbed = new Set<IEdge>();
    for (const [id, es] of callers) {
      if (es.length < many) continue;
      const hub = byId.get(id)!;
      hub.hub = es.length;
      for (const e of es) {
        (byId.get(e.source)!.stubs ??= []).push({ id, label: hub.label });
        stubbed.add(e);
      }
    }
    // A package calling into many boxes is a tag on each, in grouped
    // view only: with every function shown, its lines tell which.
    for (const [id, es] of callIns) {
      if (!grouped || es.length < many) continue;
      const port = byId.get(id)!;
      port.hub = es.length;
      for (const e of es) {
        (byId.get(e.target)!.stubs ??= []).push({
          id,
          label: port.label.slice(port.label.lastIndexOf("/") + 1),
          from: true,
        });
        stubbed.add(e);
      }
    }
    kept = kept.filter((e) => !stubbed.has(e));
  }

  // React Flow and ELK both need a parent before its children.
  const depth = (n: INode) =>
    n.kind === "file" ? 0 : n.kind === "type" ? 1 : 2;
  nodes.sort((a, b) => depth(a) - depth(b));
  return { nodes, edges: kept, calls };
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
