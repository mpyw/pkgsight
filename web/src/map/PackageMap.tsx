import { ReactFlowProvider } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DataSource } from "../data/source";
import type { Kind } from "../data/types";
import { layout, type Layout } from "./layout";
import { MapCanvas } from "./MapCanvas";
import { PackagePanel } from "./PackagePanel";
import { useNotesBook } from "../notes/useNotes";
import {
  allDirectories,
  ancestors,
  initialExpanded,
  view,
  type Forest,
  type View,
} from "./tree";

const kinds: { kind: Kind; label: string }[] = [
  { kind: "own", label: "Module" },
  { kind: "std", label: "Standard library" },
  { kind: "ext", label: "Dependencies" },
];

interface Props {
  source: DataSource;
  forest: Forest;
  selected?: string;
  onSelect: (path: string | undefined) => void;
  onOpenFunc: (id: string) => void;
  // Opens the functions of a package of the module.
  onInside: (path: string) => void;
}

export function PackageMap({
  source,
  forest,
  selected,
  onSelect,
  onOpenFunc,
  onInside,
}: Props) {
  const linked =
    selected === undefined ? undefined : forest.packages.get(selected);
  const [expanded, setExpanded] = useState(
    () =>
      new Set([
        ...initialExpanded(forest),
        ...(linked ? ancestors(forest, linked.path) : []),
      ]),
  );
  const [shown, setShown] = useState<ReadonlySet<Kind>>(
    () => new Set<Kind>(["own", ...(linked ? [linked.kind] : [])]),
  );
  const [placed, setPlaced] = useState<{ view: View; layout: Layout }>();

  const v = useMemo(
    () => view(forest, expanded, shown),
    [forest, expanded, shown],
  );

  // Lay out again only when a package summary changes, not on every note,
  // so the map holds still while an assistant writes function notes.
  const notes = useNotesBook();
  const summaryKey = JSON.stringify(
    Object.entries(notes?.packages ?? {})
      .filter(([, n]) => n.summary)
      .map(([p, n]) => [p, n.summary])
      .sort(),
  );
  const summaries = useMemo(
    () => new Map(JSON.parse(summaryKey) as [string, string][]),
    [summaryKey],
  );

  useEffect(() => {
    let live = true;
    void layout(v, summaries).then(
      (l) => live && setPlaced({ view: v, layout: l }),
    );
    return () => {
      live = false;
    };
  }, [v, summaries]);

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const reveal = useCallback(
    (path: string) => {
      setExpanded((prev) => new Set([...prev, ...ancestors(forest, path)]));
      onSelect(path);
      const kind = forest.packages.get(path)?.kind;
      if (kind)
        setShown((prev) => (prev.has(kind) ? prev : new Set([...prev, kind])));
    },
    [forest, onSelect],
  );

  const toggleKind = (k: Kind) =>
    setShown((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  return (
    <ReactFlowProvider>
      <div className="view">
        <div className="controls">
          {kinds.map(({ kind, label }) => (
            <button
              key={kind}
              className={`chip kind-${kind}`}
              aria-pressed={shown.has(kind)}
              onClick={() => toggleKind(kind)}
            >
              <span className="dot" />
              {label}
            </button>
          ))}
          <span className="sep" />
          <button
            className="chip"
            onClick={() => setExpanded(allDirectories(forest, shown))}
          >
            Expand all
          </button>
          <button
            className="chip"
            onClick={() => setExpanded(new Set(forest.roots.map((r) => r.id)))}
          >
            Collapse all
          </button>
          {placed?.view !== v && <span className="busy">laying out…</span>}
        </div>
        {placed && (
          <MapCanvas
            view={placed.view}
            layout={placed.layout}
            selected={selected}
            onSelect={onSelect}
            onToggle={toggle}
            onInside={onInside}
          />
        )}
        {linked && (
          <PackagePanel
            source={source}
            pkg={linked}
            forest={forest}
            onReveal={reveal}
            onOpenFunc={onOpenFunc}
            onInside={onInside}
            onClose={() => onSelect(undefined)}
          />
        )}
      </div>
    </ReactFlowProvider>
  );
}
