import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";
import type { DataSource } from "../data/source";
import type { FuncDetail } from "../data/types";
import { useCallStatus } from "../data/useCallStatus";
import { FuncPanel } from "../flow/FuncPanel";
import type { Emphasis } from "../map/nodes";
import type { Flow } from "../map/RouteEdge";
import type { Forest } from "../map/tree";
import { Inline } from "../notes/NoteText";
import { SkippedNote } from "../map/PackagePanel";
import { summaryProps } from "../notes/stale";
import { useNotesBook } from "../notes/useNotes";
import { buildInside, type Inside } from "./graph";
import { insideEdgeTypes, type InsideEdgeType } from "./InsideEdge";
import { layoutInside, type InsideLayout } from "./layout";
import { insideNodeTypes, type InsideNode } from "./nodes";

interface Props {
  source: DataSource;
  forest: Forest;
  // The package to look inside.
  path: string;
  // Back to the package map, with this package selected.
  onBack: () => void;
  onInside: (path: string) => void;
  onFlow: (id: string) => void;
}

// InsideView shows the functions of one package and the calls between
// them, with the packages that call in on the left and those called on the
// right.
export function InsideView(props: Props) {
  return (
    <ReactFlowProvider>
      <InsideCanvas {...props} />
    </ReactFlowProvider>
  );
}

const colors: Record<Flow, string> = {
  out: "var(--out)",
  in: "var(--in)",
  dim: "var(--edge-dim)",
  plain: "var(--edge)",
};

function InsideCanvas({
  source,
  forest,
  path,
  onBack,
  onInside,
  onFlow,
}: Props) {
  const status = useCallStatus(source);
  const [funcs, setFuncs] = useState<FuncDetail[]>();
  const [error, setError] = useState<string>();
  const [closures, setClosures] = useState(false);
  const [selected, setSelected] = useState<string>();
  const notes = useNotesBook();

  useEffect(() => {
    if (status?.state !== "ready") return;
    let live = true;
    source.packageFuncs(path).then(
      (f) => live && setFuncs(f),
      (e: unknown) => live && setError(String(e)),
    );
    return () => {
      live = false;
    };
  }, [source, status, path]);

  const g = useMemo(
    () => (funcs ? buildInside(path, funcs, { closures }) : undefined),
    [path, funcs, closures],
  );

  // Lay out again only when a summary changes, not on every note.
  const summaryKey = JSON.stringify(
    (g?.nodes ?? []).flatMap((n) => {
      const s = notes?.funcs[n.id]?.summary;
      return s ? [[n.id, s]] : [];
    }),
  );
  const summaries = useMemo(
    () => new Map(JSON.parse(summaryKey) as [string, string][]),
    [summaryKey],
  );

  const [placed, setPlaced] = useState<{ g: Inside; layout: InsideLayout }>();
  useEffect(() => {
    if (!g) return;
    let live = true;
    void layoutInside(g, summaries).then(
      (layout) => live && setPlaced({ g, layout }),
    );
    return () => {
      live = false;
    };
  }, [g, summaries]);

  const linked = useMemo(() => {
    const ids = new Set<string>();
    for (const e of placed?.g.edges ?? []) {
      if (e.source === selected) ids.add(e.target);
      if (e.target === selected) ids.add(e.source);
    }
    return ids;
  }, [placed, selected]);

  const nodes = useMemo(
    () =>
      (placed?.g.nodes ?? []).map((n): InsideNode => {
        const b = placed!.layout.boxes.get(n.id)!;
        let emphasis: Emphasis = "plain";
        if (selected !== undefined && n.kind !== "type")
          emphasis =
            n.id === selected
              ? "selected"
              : linked.has(n.id)
                ? "linked"
                : "dim";
        return {
          id: n.id,
          type: n.kind,
          parentId: n.parentId,
          position: { x: b.x, y: b.y },
          width: b.width,
          height: b.height,
          style: { width: b.width, height: b.height },
          data: {
            n,
            emphasis,
            home: path,
            summary: notes?.funcs[n.id]?.summary,
            stale: notes?.funcs[n.id]?.stale,
            lang: notes?.lang,
          },
          draggable: false,
          zIndex: n.kind === "type" ? 0 : 1,
        };
      }),
    [placed, selected, linked, path, notes],
  );

  const edges = useMemo(
    () =>
      (placed?.g.edges ?? []).flatMap((e): InsideEdgeType[] => {
        const points = placed!.layout.routes.get(e.id);
        if (!points) return [];
        let flow: Flow = "plain";
        if (selected !== undefined)
          flow =
            e.source === selected
              ? "out"
              : e.target === selected
                ? "in"
                : "dim";
        return [
          {
            id: e.id,
            source: e.source,
            target: e.target,
            type: "inside",
            data: { points, e, flow },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              width: 13,
              height: 13,
              color: colors[flow],
            },
            zIndex: flow === "out" || flow === "in" ? 3 : 2,
          },
        ];
      }),
    [placed, selected],
  );

  const { fitView } = useReactFlow();
  const layout = placed?.layout;
  useEffect(() => {
    if (!layout) return;
    const id = requestAnimationFrame(
      () => void fitView({ duration: 400, padding: 0.08, maxZoom: 1.1 }),
    );
    return () => cancelAnimationFrame(id);
  }, [layout, fitView]);

  // Bring a selected function and the ones it touches into view.
  useEffect(() => {
    if (selected === undefined) return;
    const ids = [selected, ...linked].map((id) => ({ id }));
    const frame = requestAnimationFrame(
      () =>
        void fitView({ nodes: ids, duration: 350, padding: 0.2, maxZoom: 1.1 }),
    );
    return () => cancelAnimationFrame(frame);
  }, [selected, linked, fitView]);

  const pkg = forest.packages.get(path);
  const skipped = status?.skipped?.find((s) => s.path === path);
  const pkgNote = notes?.packages[path];
  const sel = funcs?.find((f) => f.id === selected);
  const fnCount = g?.nodes.filter((n) => n.kind === "func").length ?? 0;
  const callCount =
    g?.edges.filter((e) => !e.source.includes(":") && !e.target.includes(":"))
      .length ?? 0;

  return (
    <div className="view inside">
      <div className="controls">
        <button
          className="chip"
          onClick={onBack}
          title="Back to the package map"
        >
          ← Packages
        </button>
        <span className="crumb">
          <code>{path}</code>
          {pkgNote?.summary ? (
            <span
              lang={notes?.lang}
              {...summaryProps(pkgNote.summary, pkgNote.stale)}
            >
              <Inline text={pkgNote.summary} />
            </span>
          ) : (
            pkg?.doc && <span className="doc-line">{pkg.doc}</span>
          )}
        </span>
        <span className="sep" />
        <button
          className="chip"
          aria-pressed={closures}
          onClick={() => setClosures((c) => !c)}
          title="Show each closure as its own function"
        >
          <span className="dot lib" />
          Closures
        </button>
        {g && (
          <span className="stats">
            {fnCount} functions · {callCount} calls inside
          </span>
        )}
        <span className="legend-inline">
          <span className="mode-go">go</span>
          <span className="mode-defer">defer</span>
          <span className="dispatch-interface">interface</span>
          <span className="dispatch-dynamic">func value</span>
        </span>
      </div>
      <div className="canvas">
        {status?.state === "error" ? (
          <div className="empty">{status.error}</div>
        ) : error ? (
          <div className="empty">{error}</div>
        ) : !placed ? (
          <div className="empty">
            {status?.state === "ready"
              ? "Laying out…"
              : "Building the call graph…"}
          </div>
        ) : skipped ? (
          <div className="empty">
            <SkippedNote skipped={skipped} />
          </div>
        ) : fnCount === 0 ? (
          <div className="empty">This package declares no functions.</div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={insideNodeTypes}
            edgeTypes={insideEdgeTypes}
            onNodeClick={(_, node) => {
              const n = (node as InsideNode).data.n;
              if (n.kind === "func") setSelected(n.id);
              else if (n.pkg) onInside(n.pkg);
            }}
            onPaneClick={() => setSelected(undefined)}
            nodesConnectable={false}
            elementsSelectable={false}
            minZoom={0.05}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} />
            <Controls showInteractive={false} position="bottom-left" />
          </ReactFlow>
        )}
      </div>
      {sel && (
        <FuncPanel
          key={sel.id}
          source={source}
          fn={sel}
          detail={sel}
          isRoot={false}
          onRoot={onFlow}
          onShowPackage={onBack}
          onClose={() => setSelected(undefined)}
        />
      )}
    </div>
  );
}
