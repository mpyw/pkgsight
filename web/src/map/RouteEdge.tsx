import { BaseEdge, type Edge, type EdgeProps } from "@xyflow/react";
import { rounded, type Point } from "../route";

export type Flow = "out" | "in" | "dim" | "plain";

export type RouteEdgeType = Edge<{
  points: Point[];
  count: number;
  flow: Flow;
}>;

// RouteEdge follows the orthogonal route from ELK, with rounded corners.
export function RouteEdge({ id, data, markerEnd }: EdgeProps<RouteEdgeType>) {
  if (!data) return null;
  const { points, count, flow } = data;
  return (
    <g className={`route ${flow}`}>
      <title>{count === 1 ? "1 import" : `${count} imports`}</title>
      <BaseEdge
        id={id}
        path={rounded(points, 10)}
        markerEnd={markerEnd}
        style={{ strokeWidth: 1.25 + Math.log2(count) }}
      />
    </g>
  );
}

export const edgeTypes = { route: RouteEdge };
