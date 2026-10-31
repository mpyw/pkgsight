import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  useReactFlow,
} from "@xyflow/react";
import { useEffect, useMemo } from "react";
import type { Layout } from "./layout";
import type { View } from "./tree";
import { nodeTypes, type Emphasis, type MapNode } from "./nodes";
import { edgeTypes, type Flow, type RouteEdgeType } from "./RouteEdge";

interface Props {
  view: View;
  layout: Layout;
  // The selected package path.
  selected?: string;
  onSelect: (path: string | undefined) => void;
  onToggle: (id: string) => void;
  // Opens the functions of a package, on a double click.
  onInside: (path: string) => void;
}

const colors: Record<Flow, string> = {
  out: "var(--out)",
  in: "var(--in)",
  dim: "var(--edge-dim)",
  plain: "var(--edge)",
};

export function MapCanvas({
  view,
  layout,
  selected,
  onSelect,
  onToggle,
  onInside,
}: Props) {
  const focus = selected === undefined ? undefined : view.rep.get(selected);

  const linked = useMemo(() => {
    const ids = new Set<string>();
    for (const e of view.edges) {
      if (e.source === focus) ids.add(e.target);
      if (e.target === focus) ids.add(e.source);
    }
    return ids;
  }, [view, focus]);

  const nodes = useMemo(
    () =>
      view.nodes.map((v): MapNode => {
        const b = layout.boxes.get(v.id)!;
        let emphasis: Emphasis = "plain";
        if (focus !== undefined && v.type !== "container") {
          emphasis =
            v.id === focus ? "selected" : linked.has(v.id) ? "linked" : "dim";
        }
        return {
          id: v.id,
          type: v.type,
          parentId: v.parentId,
          position: { x: b.x, y: b.y },
          width: b.width,
          height: b.height,
          style: { width: b.width, height: b.height },
          data: { v, emphasis, onToggle },
          draggable: false,
          zIndex: v.type === "container" ? 0 : 1,
        };
      }),
    [view, layout, focus, linked, onToggle],
  );

  const edges = useMemo(
    () =>
      view.edges.flatMap((e): RouteEdgeType[] => {
        const points = layout.routes.get(e.id);
        if (!points) return [];
        let flow: Flow = "plain";
        if (focus !== undefined)
          flow = e.source === focus ? "out" : e.target === focus ? "in" : "dim";
        return [
          {
            id: e.id,
            source: e.source,
            target: e.target,
            type: "route",
            data: { points, count: e.count, flow },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              width: 14,
              height: 14,
              color: colors[flow],
            },
            zIndex: flow === "out" || flow === "in" ? 3 : 2,
          },
        ];
      }),
    [view, layout, focus],
  );

  const { fitView } = useReactFlow();
  // Fit whenever a new layout arrives, once React Flow has measured it.
  useEffect(() => {
    if (layout.boxes.size === 0) return;
    const id = requestAnimationFrame(
      () => void fitView({ duration: 450, padding: 0.06 }),
    );
    return () => cancelAnimationFrame(id);
  }, [layout, fitView]);

  return (
    <div className="canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={(_, n) => {
          const v = (n as MapNode).data.v;
          if (v.type === "group") onToggle(v.id);
          else if (v.type === "package" && v.pkg) onSelect(v.pkg.path);
        }}
        onNodeDoubleClick={(_, n) => {
          const v = (n as MapNode).data.v;
          if (v.type === "package" && v.pkg?.kind === "own")
            onInside(v.pkg.path);
        }}
        onPaneClick={() => onSelect(undefined)}
        // A double click goes inside a package. React Flow's own double-click
        // zoom would catch it first, on the pane, and stop it there.
        zoomOnDoubleClick={false}
        nodesConnectable={false}
        elementsSelectable={false}
        minZoom={0.05}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap
          pannable
          zoomable
          position="bottom-right"
          nodeColor={miniColor}
          maskColor="var(--minimap-mask)"
        />
        <div className="legend">
          <span className="out">━ imports</span>
          <span className="in">━ imported by</span>
        </div>
      </ReactFlow>
    </div>
  );
}

function miniColor(n: MapNode): string {
  if (n.data.v.type === "container") return "transparent";
  return `hsl(${n.data.v.tone} 55% 55%)`;
}
