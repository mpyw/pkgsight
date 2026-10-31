import { BaseEdge, type Edge, type EdgeProps } from "@xyflow/react";
import type { Flow } from "../map/RouteEdge";
import { rounded, type Point } from "../route";
import type { IEdge } from "./graph";

export type InsideEdgeType = Edge<{
  points: Point[];
  e: IEdge;
  flow: Flow;
}>;

// InsideEdge follows the route from ELK, styled like the call flow: by how
// the call starts its callee and how it finds it.
export function InsideEdge({ id, data, markerEnd }: EdgeProps<InsideEdgeType>) {
  if (!data) return null;
  const { points, e, flow } = data;
  const cross = e.source.startsWith("in:") || e.target.startsWith("out:");
  const cls = [
    "iedge",
    `mode-${e.mode}`,
    `dispatch-${e.dispatch}`,
    e.maybe && "maybe",
    cross && "cross",
    flow,
  ]
    .filter(Boolean)
    .join(" ");
  const what = cross
    ? `${e.count} function${e.count === 1 ? "" : "s"}`
    : `${e.count} call site${e.count === 1 ? "" : "s"}`;
  return (
    <g className={cls}>
      <title>{what}</title>
      <BaseEdge
        id={id}
        path={rounded(points, 8)}
        markerEnd={markerEnd}
        style={{ strokeWidth: 1.25 + Math.log2(Math.max(1, e.count)) * 0.6 }}
      />
    </g>
  );
}

export const insideEdgeTypes = { inside: InsideEdge };
