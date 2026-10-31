import ELK, {
  type ElkExtendedEdge,
  type ElkNode,
} from "elkjs/lib/elk.bundled.js";
import type { Box } from "../map/layout";
import type { Point } from "../route";
import type { Inside, INode } from "./graph";

const elk = new ELK();

export interface InsideLayout {
  boxes: Map<string, Box>;
  routes: Map<string, Point[]>;
}

export const TYPE_HEADER = 30;

const partition: Record<INode["kind"], number> = {
  in: 0,
  func: 1,
  type: 1,
  file: 1,
  out: 2,
};

// textWidth estimates the width of text in pixels, wide characters such as
// kana taking about twice the room of Latin ones.
export function textWidth(text: string, latin: number): number {
  let w = 0;
  for (const c of text) w += c.charCodeAt(0) > 0x2e80 ? latin * 1.8 : latin;
  return w;
}

// STUB_ROW is the height of the row of tags for the hubs a node calls.
const STUB_ROW = 18;

// container reports whether n holds other nodes: a type, or an open file.
export function container(n: INode): boolean {
  return n.kind === "type" || (n.kind === "file" && n.open === true);
}

function size(n: INode, summary?: string): { width: number; height: number } {
  const label =
    textWidth(n.label, 7.6) +
    (n.folded ? 34 : 0) +
    (n.count ? 52 : 0) +
    (n.hub ? 40 : 0);
  const stubs = n.stubs
    ? textWidth(n.stubs.map((s) => `→ ${s.label}`).join("  "), 6.6) +
      n.stubs.length * 12 +
      28
    : 0;
  const extra = n.stubs ? STUB_ROW : 0;
  if (n.kind !== "func")
    return {
      width: Math.max(
        Math.min(300, Math.max(120, label + 32)),
        Math.min(420, stubs),
      ),
      height: 36 + extra,
    };
  let width = Math.min(320, Math.max(140, label + 40));
  width = Math.max(width, Math.min(420, stubs));
  if (summary) {
    width = Math.max(width, Math.min(340, textWidth(summary, 6.2) + 32));
    return { width, height: 54 + extra };
  }
  return { width, height: 36 + extra };
}

// layoutInside places the functions left to right along their calls, with
// methods boxed by their receiver type. summaries holds the summary of each
// function that has one.
export async function layoutInside(
  g: Inside,
  summaries: ReadonlyMap<string, string>,
): Promise<InsideLayout> {
  const root: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      "elk.layered.spacing.nodeNodeBetweenLayers": "56",
      "elk.layered.spacing.edgeNodeBetweenLayers": "16",
      "elk.spacing.nodeNode": "18",
      "elk.spacing.edgeEdge": "8",
      "elk.json.edgeCoords": "ROOT",
      // Callers from other packages on the left, callees on the right.
      "elk.partitioning.activate": "true",
    },
    children: [],
    edges: [],
  };
  const elkNodes = new Map<string, ElkNode>();
  for (const n of g.nodes) {
    const e: ElkNode = container(n)
      ? {
          id: n.id,
          children: [],
          layoutOptions: {
            "elk.padding": `[top=${TYPE_HEADER + 10},left=12,bottom=12,right=12]`,
          },
        }
      : { id: n.id, ...size(n, summaries.get(n.id)) };
    if (!n.parentId)
      e.layoutOptions = {
        ...e.layoutOptions,
        "elk.partitioning.partition": String(partition[n.kind]),
      };
    elkNodes.set(n.id, e);
    const parent = n.parentId ? elkNodes.get(n.parentId)! : root;
    parent.children!.push(e);
  }
  root.edges = g.edges.map((e): ElkExtendedEdge => ({
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
