import ELK, {
  type ElkExtendedEdge,
  type ElkNode,
} from "elkjs/lib/elk.bundled.js";
import type { Point } from "../route";
import type { View, VNode } from "./tree";

const elk = new ELK();

export interface Box {
  // Relative to the parent node, as React Flow expects.
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Layout {
  boxes: Map<string, Box>;
  // Absolute coordinates of each edge's route.
  routes: Map<string, Point[]>;
}

export const HEADER = 36;

// size fits a node to its label, and to the summary of its note on a
// second line.
export function size(
  n: VNode,
  summary?: string,
): { width: number; height: number } {
  const text = n.type === "group" ? n.label.length + 6 : n.label.length;
  const width = Math.min(300, Math.max(128, text * 7.6 + 44));
  if (summary) {
    // Wide characters such as kana take about twice the width of Latin ones.
    let w = 0;
    for (const c of summary) w += c.charCodeAt(0) > 0x2e80 ? 11 : 6.2;
    return { width: Math.max(width, Math.min(360, w + 36)), height: 60 };
  }
  return { width, height: n.type === "group" ? 56 : 44 };
}

// layout places the view. summaries holds the summary of each package that
// has one.
export async function layout(
  v: View,
  summaries: ReadonlyMap<string, string> = new Map(),
): Promise<Layout> {
  const elkNodes = new Map<string, ElkNode>();
  const root: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      "elk.layered.spacing.nodeNodeBetweenLayers": "52",
      "elk.layered.spacing.edgeNodeBetweenLayers": "18",
      "elk.spacing.nodeNode": "24",
      "elk.spacing.edgeEdge": "8",
      "elk.json.edgeCoords": "ROOT",
    },
    children: [],
    edges: [],
  };
  for (const n of v.nodes) {
    const e: ElkNode =
      n.type === "container"
        ? {
            id: n.id,
            children: [],
            layoutOptions: {
              "elk.padding": `[top=${HEADER + 12},left=16,bottom=16,right=16]`,
            },
          }
        : {
            id: n.id,
            ...size(
              n,
              n.type === "package" && n.pkg
                ? summaries.get(n.pkg.path)
                : undefined,
            ),
          };
    elkNodes.set(n.id, e);
    const parent = n.parentId === undefined ? root : elkNodes.get(n.parentId)!;
    parent.children!.push(e);
  }
  root.edges = v.edges.map((e): ElkExtendedEdge => ({
    id: e.id,
    sources: [e.source],
    targets: [e.target],
  }));

  const out = await elk.layout(root);

  const boxes = new Map<string, Box>();
  const routes = new Map<string, Point[]>();
  const walk = (n: ElkNode) => {
    for (const c of n.children ?? []) {
      boxes.set(c.id, {
        x: c.x ?? 0,
        y: c.y ?? 0,
        width: c.width ?? 0,
        height: c.height ?? 0,
      });
      walk(c);
    }
    for (const e of n.edges ?? []) {
      const s = e.sections?.[0];
      if (s)
        routes.set(e.id, [s.startPoint, ...(s.bendPoints ?? []), s.endPoint]);
    }
  };
  walk(out);
  return { boxes, routes };
}
