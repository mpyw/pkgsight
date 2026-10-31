import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DataSource } from "../data/source";
import type { CallStatus, Entry, Func, FuncDetail } from "../data/types";
import { useCallStatus } from "../data/useCallStatus";
import { FlowEdge, type FlowEdgeType } from "./FlowEdge";
import { FuncNode, type FuncNodeType } from "./FuncNode";
import { FuncPanel } from "./FuncPanel";
import { useNotesBook } from "../notes/useNotes";
import {
  buildFlow,
  NOTED,
  pathTo,
  placeFlow,
  PLAIN,
  type FlowNode,
} from "./tree";

interface Props {
  source: DataSource;
  root?: string;
  onRoot: (id: string) => void;
  onShowPackage: (path: string) => void;
}

const nodeTypes = { func: FuncNode };
const edgeTypes = { flow: FlowEdge };

export function FlowView(props: Props) {
  return (
    <ReactFlowProvider>
      <Flow {...props} />
    </ReactFlowProvider>
  );
}

function Flow({ source, root, onRoot, onShowPackage }: Props) {
  const status = useCallStatus(source);
  const [details, setDetails] = useState<ReadonlyMap<string, FuncDetail>>(
    new Map(),
  );
  const inflight = useRef(new Set<string>());
  // Functions whose details failed to load, with why. They are not asked
  // for again until the reader says so.
  const [failed, setFailed] = useState<ReadonlyMap<string, string>>(new Map());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    new Set(root ? [root] : []),
  );
  const [selected, setSelected] = useState<string | undefined>(root);
  const [library, setLibrary] = useState(false);
  // The node to bring into view with its callees after it opens.
  const [follow, setFollow] = useState<string>();

  const ensure = useCallback(
    (ids: string[]) => {
      for (const id of ids) {
        if (inflight.current.has(id)) continue;
        inflight.current.add(id);
        source.func(id).then(
          (d) => setDetails((prev) => new Map(prev).set(id, d)),
          (e: unknown) => {
            inflight.current.delete(id);
            setFailed((prev) => new Map(prev).set(id, String(e)));
          },
        );
      }
    },
    [source],
  );

  const start = useCallback(
    (id: string) => {
      setExpanded(new Set([id]));
      setSelected(id);
      onRoot(id);
    },
    [onRoot],
  );

  const toggle = useCallback((n: FlowNode) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(n.key)) next.delete(n.key);
      else next.add(n.key);
      return next;
    });
    if (!n.expanded) setFollow(n.key);
  }, []);

  const rootDetail = root === undefined ? undefined : details.get(root);
  const tree = useMemo(
    () =>
      rootDetail
        ? buildFlow(rootDetail, details, expanded, { library })
        : undefined,
    [rootDetail, details, expanded, library],
  );
  const notes = useNotesBook();
  const size =
    notes && Object.values(notes.funcs).some((n) => n.summary) ? NOTED : PLAIN;
  const placed = useMemo(
    () => (tree ? placeFlow(tree, size) : []),
    [tree, size],
  );

  // Fetch the root and every own function on screen, so each knows how many calls it hides.
  useEffect(() => {
    if (status?.state !== "ready" || root === undefined) return;
    const missing = placed
      .filter((p) => p.node.fn.kind === "own" && !details.has(p.node.fn.id))
      .map((p) => p.node.fn.id);
    if (!details.has(root)) missing.push(root);
    ensure(missing.filter((id) => !failed.has(id)));
  }, [status, root, placed, details, failed, ensure]);

  const byKey = useMemo(
    () => new Map(placed.map((p) => [p.node.key, p])),
    [placed],
  );
  const onPath = useMemo(
    () => new Set(selected ? pathTo(selected) : []),
    [selected],
  );

  const nodes = useMemo(
    () =>
      placed.map((p): FuncNodeType => ({
        id: p.node.key,
        type: "func",
        position: { x: p.x, y: p.y },
        width: size.width,
        height: size.height,
        style: { width: size.width, height: size.height },
        data: {
          n: p.node,
          summary: notes?.funcs[p.node.fn.id]?.summary,
          stale: notes?.funcs[p.node.fn.id]?.stale,
          lang: notes?.lang,
          selected: p.node.key === selected,
          onPath: onPath.has(p.node.key),
          onToggle: toggle,
        },
        draggable: false,
      })),
    [placed, selected, onPath, toggle, size, notes],
  );

  const edges = useMemo(
    () =>
      placed.flatMap((p): FlowEdgeType[] => {
        const parent =
          p.node.via &&
          byKey.get(p.node.key.slice(0, p.node.key.lastIndexOf(">")));
        if (!parent || !p.node.via) return [];
        return [
          {
            id: p.node.key,
            source: parent.node.key,
            target: p.node.key,
            type: "flow",
            data: {
              from: {
                x: parent.x + size.width,
                y: parent.y + size.height / 2,
              },
              to: { x: p.x, y: p.y + size.height / 2 },
              via: p.node.via,
              onPath: onPath.has(p.node.key),
            },
            zIndex: onPath.has(p.node.key) ? 2 : 1,
          },
        ];
      }),
    [placed, byKey, onPath, size],
  );

  const { fitView } = useReactFlow();

  useEffect(() => {
    if (follow === undefined) return;
    const at = byKey.get(follow);
    if (!at) return;
    const ids = [at.node, ...at.node.children].map((n) => ({ id: n.key }));
    const id = requestAnimationFrame(
      () =>
        void fitView({ nodes: ids, duration: 350, maxZoom: 1, padding: 0.2 }),
    );
    return () => cancelAnimationFrame(id);
  }, [follow, byKey, fitView]);

  const fitted = useRef<string>(undefined);
  useEffect(() => {
    if (!tree || fitted.current === tree.key) return;
    fitted.current = tree.key;
    const id = requestAnimationFrame(
      () => void fitView({ duration: 400, padding: 0.15, maxZoom: 1 }),
    );
    return () => cancelAnimationFrame(id);
  }, [tree, fitView]);

  // A click selects a node and opens it, but never closes it: going back to
  // a parent should not fold away what was opened below it. The badge on the
  // node closes it, and the keys below stay in the set, so opening it again
  // brings the same subtree back.
  const click = (n: FlowNode) => {
    setSelected(n.key);
    setFollow(n.key);
    if (n.fn.kind !== "own" || n.recursive) return;
    setExpanded((prev) => (prev.has(n.key) ? prev : new Set(prev).add(n.key)));
  };

  const sel = selected === undefined ? undefined : byKey.get(selected)?.node;
  const caller = sel?.via
    ? byKey.get(sel.key.slice(0, sel.key.lastIndexOf(">")))?.node.fn
    : undefined;

  return (
    <div className="view flow">
      <Sidebar source={source} status={status} root={root} onStart={start} />
      <div className="controls">
        <button
          className="chip"
          aria-pressed={library}
          onClick={() => setLibrary((l) => !l)}
        >
          <span className="dot lib" />
          Library calls
        </button>
        <span className="legend-inline">
          <span className="mode-go">go</span>
          <span className="mode-defer">defer</span>
          <span className="dispatch-interface">interface</span>
          <span className="dispatch-dynamic">func value</span>
          <span className="maybe">guessed</span>
        </span>
      </div>
      {root === undefined ? (
        <div className="empty">
          Pick a place to start on the left: a main function, or search for any
          function.
        </div>
      ) : failed.has(root) && !rootDetail ? (
        <div className="empty">
          <p>
            Could not load <code>{root}</code>: {failed.get(root)}
          </p>
          <button className="chip" onClick={() => setFailed(new Map())}>
            Try again
          </button>
        </div>
      ) : (
        <div className="canvas">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodeClick={(_, n) => click((n as FuncNodeType).data.n)}
            onPaneClick={() => setSelected(undefined)}
            nodesConnectable={false}
            elementsSelectable={false}
            minZoom={0.1}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} />
            <Controls showInteractive={false} position="bottom-left" />
          </ReactFlow>
        </div>
      )}
      {sel && (
        <FuncPanel
          key={sel.key}
          source={source}
          fn={sel.fn}
          detail={details.get(sel.fn.id)}
          via={sel.via}
          caller={caller}
          isRoot={sel.key === root}
          onRoot={start}
          onShowPackage={onShowPackage}
          onClose={() => setSelected(undefined)}
        />
      )}
    </div>
  );
}

function Sidebar({
  source,
  status,
  root,
  onStart,
}: {
  source: DataSource;
  status?: CallStatus;
  root?: string;
  onStart: (id: string) => void;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Func[]>();
  const notes = useNotesBook();

  useEffect(() => {
    if (status?.state === "ready")
      source.entries().then(setEntries, () => setEntries([]));
  }, [source, status]);

  useEffect(() => {
    if (status?.state !== "ready" || query.trim() === "") return;
    let live = true;
    const t = setTimeout(
      () =>
        source.search(query.trim()).then(
          (h) => live && setHits(h),
          () => live && setHits([]),
        ),
      120,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [source, status, query]);

  const item = (f: Func, note?: string) => (
    <li key={f.id}>
      <button
        aria-current={f.id === root}
        onClick={() => onStart(f.id)}
        title={f.id}
      >
        <span className="name">
          <span className="pkgname">{f.pkgName}.</span>
          {f.name}
        </span>
        {notes?.funcs[f.id]?.summary ? (
          <span
            className={`note summary${notes.funcs[f.id].stale ? " stale" : ""}`}
            lang={notes.lang}
          >
            {notes.funcs[f.id].summary}
          </span>
        ) : (
          note && <span className="note">{note}</span>
        )}
      </button>
    </li>
  );

  const mains = entries.filter((e) => e.reason === "main");
  const uncalled = entries.filter((e) => e.reason === "uncalled");
  return (
    <aside className="sidebar">
      <input
        type="search"
        placeholder="Search functions…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          if (e.target.value.trim() === "") setHits(undefined);
        }}
        disabled={status?.state !== "ready"}
      />
      {status?.state === "pending" && (
        <p className="status">Building the call graph…</p>
      )}
      {status?.state === "error" && (
        <p className="status error">{status.error}</p>
      )}
      {status?.state === "ready" && (
        <p className="status">
          Call graph built in {((status.tookMs ?? 0) / 1000).toFixed(1)}s
        </p>
      )}
      {status?.skipped && status.skipped.length > 0 && (
        <details className="status skipped">
          <summary>
            {status.skipped.length === 1
              ? "1 package left out: it does not type-check"
              : `${status.skipped.length} packages left out: they do not type-check`}
          </summary>
          <ul>
            {status.skipped.map((s) => (
              <li key={s.path} title={s.error}>
                <code>{s.path}</code>
                <span className="note">{s.error}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {hits ? (
        <section>
          <h3>Results</h3>
          <ul>{hits.map((f) => item(f, f.file && `${f.file}:${f.line}`))}</ul>
        </section>
      ) : (
        <>
          <section>
            <h3>Programs</h3>
            <ul>{mains.map((f) => item(f, f.pkg))}</ul>
          </section>
          {uncalled.length > 0 && (
            <section>
              <h3 title="Exported functions that no code in the module calls">
                Called from outside
              </h3>
              <ul>{uncalled.map((f) => item(f, f.pkg))}</ul>
            </section>
          )}
        </>
      )}
    </aside>
  );
}
