import type { Graph, Kind, Package } from "../data/types";
import { hue } from "../tone";

// A directory of import paths. A node holds a package, subdirectories, or both.
export interface TreeNode {
  id: string;
  label: string;
  kind: Kind;
  pkg?: Package;
  children: TreeNode[];
  parent?: TreeNode;
  // Packages in the subtree, this node's own included.
  size: number;
  // Hue shared by everything under the same top-level directory.
  tone: number;
}

export interface Forest {
  roots: TreeNode[];
  packages: Map<string, Package>;
  importers: Map<string, string[]>;
  // The node that holds each package.
  holder: Map<string, TreeNode>;
}

export function buildForest(g: Graph): Forest {
  const roots = new Map<string, TreeNode>();
  const rootOf = (p: Package): [TreeNode, string] => {
    const key = p.kind === "std" ? "std" : (p.module ?? p.path);
    let root = roots.get(key);
    if (!root) {
      root = {
        id: `r:${key}`,
        label: key,
        kind: p.kind,
        children: [],
        size: 0,
        tone: 0,
      };
      roots.set(key, root);
    }
    return [root, p.kind === "std" ? "" : key];
  };

  for (const p of g.packages) {
    const [root, prefix] = rootOf(p);
    const rel = prefix === "" ? p.path : p.path.slice(prefix.length + 1);
    let node = root;
    let path = prefix;
    for (const seg of rel === "" ? [] : rel.split("/")) {
      path = path === "" ? seg : `${path}/${seg}`;
      let child = node.children.find((c) => c.label === seg);
      if (!child) {
        child = {
          id: `g:${path}`,
          label: seg,
          kind: p.kind,
          children: [],
          parent: node,
          size: 0,
          tone: 0,
        };
        node.children.push(child);
      }
      node = child;
    }
    node.pkg = p;
  }

  const holder = new Map<string, TreeNode>();
  const finish = (node: TreeNode, tone: number): number => {
    while (node.parent && !node.pkg && node.children.length === 1) {
      const only = node.children[0];
      node.label = `${node.label}/${only.label}`;
      node.id = only.id;
      node.pkg = only.pkg;
      node.children = only.children;
      for (const c of node.children) c.parent = node;
    }
    if (node.pkg && node.children.length === 0) node.id = `p:${node.pkg.path}`;
    if (node.pkg) holder.set(node.pkg.path, node);
    node.tone = tone;
    node.children.sort((a, b) => a.label.localeCompare(b.label));
    const own = !node.parent || (!node.parent.parent && plain.has(node.label));
    node.size =
      (node.pkg ? 1 : 0) +
      node.children.reduce(
        (n, c) => n + finish(c, own ? hue(c.label) : tone),
        0,
      );
    return node.size;
  };
  const order: Record<Kind, number> = { own: 0, std: 1, ext: 2 };
  const sorted = [...roots.values()].sort(
    (a, b) => order[a.kind] - order[b.kind] || a.label.localeCompare(b.label),
  );
  for (const r of sorted) finish(r, hue(r.label));

  const importers = new Map<string, string[]>();
  for (const p of g.packages) {
    for (const imp of p.imports) {
      importers.set(imp, [...(importers.get(imp) ?? []), p.path]);
    }
  }
  return {
    roots: sorted,
    packages: new Map(g.packages.map((p) => [p.path, p])),
    importers,
    holder,
  };
}

// Top-level directories that only group others. Their children pick their own hues.
const plain = new Set([
  "internal",
  "pkg",
  "cmd",
  "app",
  "apps",
  "services",
  "lib",
]);

export type VNodeType = "package" | "group" | "container";

export interface VNode {
  id: string;
  type: VNodeType;
  parentId?: string;
  label: string;
  kind: Kind;
  size: number;
  tone: number;
  pkg?: Package;
  // The package of a directory that also has subdirectories.
  self?: boolean;
}

export interface VEdge {
  id: string;
  source: string;
  target: string;
  // Import edges folded into this one.
  count: number;
}

export interface View {
  nodes: VNode[];
  edges: VEdge[];
  // The visible node that stands for each package.
  rep: Map<string, string>;
}

// view lists the nodes to draw: an expanded directory becomes a container,
// a collapsed one a single group node, and the imports between the packages
// they hold fold into one edge per pair of visible nodes.
export function view(
  f: Forest,
  expanded: ReadonlySet<string>,
  shown: ReadonlySet<Kind>,
): View {
  const nodes: VNode[] = [];
  const rep = new Map<string, string>();
  const claim = (n: TreeNode, id: string) => {
    if (n.pkg) rep.set(n.pkg.path, id);
    for (const c of n.children) claim(c, id);
  };
  const walk = (n: TreeNode, parentId?: string) => {
    const base = {
      label: n.label,
      kind: n.kind,
      size: n.size,
      tone: n.tone,
      parentId,
    };
    if (n.children.length === 0) {
      nodes.push({ ...base, id: n.id, type: "package", pkg: n.pkg });
      claim(n, n.id);
      return;
    }
    if (!expanded.has(n.id)) {
      nodes.push({ ...base, id: n.id, type: "group" });
      claim(n, n.id);
      return;
    }
    nodes.push({ ...base, id: n.id, type: "container" });
    if (n.pkg) {
      const id = `p:${n.pkg.path}`;
      nodes.push({
        ...base,
        id,
        type: "package",
        label: n.pkg.name,
        size: 1,
        pkg: n.pkg,
        parentId: n.id,
        self: true,
      });
      rep.set(n.pkg.path, id);
    }
    for (const c of n.children) walk(c, n.id);
  };
  for (const r of f.roots) if (shown.has(r.kind)) walk(r);

  const counts = new Map<string, VEdge>();
  for (const [path, from] of rep) {
    for (const imp of f.packages.get(path)?.imports ?? []) {
      const to = rep.get(imp);
      if (to === undefined || to === from) continue;
      const id = `${from}->${to}`;
      const e = counts.get(id);
      if (e) e.count++;
      else counts.set(id, { id, source: from, target: to, count: 1 });
    }
  }
  return { nodes, edges: [...counts.values()], rep };
}

// initialExpanded opens own directories, largest first, while the map stays
// small enough to read at a glance.
export function initialExpanded(f: Forest, budget = 36): Set<string> {
  const expanded = new Set<string>();
  const own = f.roots.filter((r) => r.kind === "own");
  let visible = 0;
  const frontier: TreeNode[] = [];
  for (const r of own) {
    visible++;
    frontier.push(r);
  }
  for (;;) {
    frontier.sort((a, b) => b.size - a.size);
    const i = frontier.findIndex(
      (n) => visible + grows(n) <= budget || expanded.size === 0,
    );
    if (i < 0) break;
    const [n] = frontier.splice(i, 1);
    expanded.add(n.id);
    visible += grows(n);
    frontier.push(...n.children.filter((c) => c.children.length > 0));
  }
  return expanded;
}

// grows is how many more nodes the map shows once n is expanded.
function grows(n: TreeNode): number {
  return n.children.length + (n.pkg ? 1 : 0);
}

// ancestors returns the directories to expand so that path gets its own node.
export function ancestors(f: Forest, path: string): string[] {
  const ids: string[] = [];
  const h = f.holder.get(path);
  if (h && h.children.length > 0) ids.push(h.id);
  for (let n = h?.parent; n; n = n.parent) ids.push(n.id);
  return ids;
}

export function allDirectories(
  f: Forest,
  kinds: ReadonlySet<Kind>,
): Set<string> {
  const ids = new Set<string>();
  const walk = (n: TreeNode) => {
    if (n.children.length === 0) return;
    ids.add(n.id);
    n.children.forEach(walk);
  };
  f.roots.filter((r) => kinds.has(r.kind)).forEach(walk);
  return ids;
}
