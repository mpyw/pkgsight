import { BaseEdge, type Edge, type EdgeProps } from "@xyflow/react";
import type { Call } from "../data/types";
import { rounded, type Point } from "../route";

export type FlowEdgeType = Edge<{
  from: Point;
  to: Point;
  via: Call;
  onPath: boolean;
}>;

// FlowEdge runs right from the caller, down the shared trunk, and right into the callee.
export function FlowEdge({ id, data }: EdgeProps<FlowEdgeType>) {
  if (!data) return null;
  const { from, to, via, onPath } = data;
  const mx = from.x + 22;
  const points = [from, { x: mx, y: from.y }, { x: mx, y: to.y }, to];
  const cls = [
    "flow-edge",
    `mode-${via.mode}`,
    `dispatch-${via.dispatch}`,
    via.maybe && "maybe",
    onPath && "on-path",
  ];
  return (
    <g className={cls.filter(Boolean).join(" ")}>
      <BaseEdge id={id} path={rounded(points, 8)} />
    </g>
  );
}
