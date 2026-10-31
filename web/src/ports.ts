import { Position, type NodeHandle } from "@xyflow/react";

// ports gives a node of the given size its two handles: the target on the
// left and the source on the right, or on the top and bottom when the
// edges run down.
//
// React Flow draws an edge only once it knows where both its handles are.
// Without handles on the node, it measures them in the page, and forgets
// them each time the node is passed anew, as on every note or pick. A node
// whose size did not change is not measured again, so its edges were left
// out until a reload. Our edges follow their own routes, so the handles
// only need to exist.
export function ports(
  width: number,
  height: number,
  down = false,
): NodeHandle[] {
  return down
    ? [
        { type: "target", position: Position.Top, x: width / 2, y: 0 },
        { type: "source", position: Position.Bottom, x: width / 2, y: height },
      ]
    : [
        { type: "target", position: Position.Left, x: 0, y: height / 2 },
        { type: "source", position: Position.Right, x: width, y: height / 2 },
      ];
}
