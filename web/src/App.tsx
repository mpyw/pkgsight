import { useEffect, useMemo, useState } from "react";
import { Toolbar } from "./components/Toolbar";
import { anew, type DataSource } from "./data/source";
import type { Graph } from "./data/types";
import { FlowView } from "./flow/FlowView";
import { InsideView } from "./inside/InsideView";
import { readPlace, writePlace, type Place } from "./location";
import { PackageMap } from "./map/PackageMap";
import { AssetContext } from "./notes/Markdown";
import { NotesContext, useNotes } from "./notes/useNotes";
import { buildForest } from "./map/tree";

export function App({ source }: { source: DataSource }) {
  // live is source, under a new identity each time the server analyzes the
  // code again, so every view fetches anew.
  const [live, setLive] = useState(source);
  const [graph, setGraph] = useState<Graph>();
  const [error, setError] = useState<string>();

  useEffect(() => source.watchCode(() => setLive(anew(source))), [source]);

  useEffect(() => {
    live.graph().then(setGraph, (e: unknown) => setError(String(e)));
  }, [live]);

  if (error) return <div className="splash error">{error}</div>;
  if (!graph) return <div className="splash">Loading packages…</div>;
  return <Explorer graph={graph} source={live} />;
}

function Explorer({ graph, source }: { graph: Graph; source: DataSource }) {
  const forest = useMemo(() => buildForest(graph), [graph]);
  const [place, setPlace] = useState<Place>(readPlace);
  const notes = useNotes(source);

  useEffect(() => writePlace(place), [place]);

  const own = graph.packages.filter((p) => p.kind === "own");
  return (
    <AssetContext.Provider value={source.asset}>
      <NotesContext.Provider value={notes.notes}>
        <div className="app">
          <Toolbar
            title={
              graph.modules
                .filter((m) => m.main)
                .map((m) => m.path)
                .join(", ") || graph.root
            }
            stats={`${own.length} packages · ${own.reduce((n, p) => n + p.imports.length, 0)} imports`}
            view={place.view}
            onView={(view) => setPlace((p) => ({ ...p, view }))}
            langs={notes.langs}
            lang={notes.lang}
            onLang={notes.choose}
          />
          {place.view === "inside" && place.pkg ? (
            <InsideView
              key={place.pkg}
              source={source}
              forest={forest}
              path={place.pkg}
              onBack={() => setPlace((p) => ({ ...p, view: "map" }))}
              onInside={(pkg) => setPlace((p) => ({ ...p, pkg }))}
              onFlow={(fn) => setPlace((p) => ({ ...p, view: "flow", fn }))}
            />
          ) : place.view !== "flow" ? (
            <PackageMap
              source={source}
              forest={forest}
              selected={place.pkg}
              onSelect={(pkg) => setPlace((p) => ({ ...p, pkg }))}
              onOpenFunc={(fn) => setPlace((p) => ({ ...p, view: "flow", fn }))}
              onInside={(pkg) =>
                setPlace((p) => ({ ...p, view: "inside", pkg }))
              }
            />
          ) : (
            <FlowView
              source={source}
              root={place.fn}
              onRoot={(fn) => setPlace((p) => ({ ...p, fn }))}
              onShowPackage={(pkg) =>
                setPlace((p) => ({ ...p, view: "map", pkg }))
              }
            />
          )}
        </div>
      </NotesContext.Provider>
    </AssetContext.Provider>
  );
}
