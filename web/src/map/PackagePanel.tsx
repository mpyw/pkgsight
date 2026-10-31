import { Panel } from "../components/Panel";
import { useEffect, useState } from "react";
import type { DataSource } from "../data/source";
import type { FuncDetail, Package } from "../data/types";
import { DocBlock, NoteBlock } from "../notes/NoteText";
import { useNotesBook } from "../notes/useNotes";
import type { Forest } from "./tree";

interface Props {
  source: DataSource;
  pkg: Package;
  forest: Forest;
  onReveal: (path: string) => void;
  onOpenFunc: (id: string) => void;
  onInside: (path: string) => void;
  onClose: () => void;
}

export function PackagePanel({
  source,
  pkg,
  forest,
  onReveal,
  onOpenFunc,
  onInside,
  onClose,
}: Props) {
  const importers = forest.importers.get(pkg.path) ?? [];
  const notes = useNotesBook();
  return (
    <Panel>
      <header>
        <div>
          <div className={`kind kind-${pkg.kind}`}>{kindLabel[pkg.kind]}</div>
          <h2>{pkg.name}</h2>
          <code className="path">{pkg.path}</code>
        </div>
        <button className="close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>
      {notes && <NoteBlock note={notes.packages[pkg.path]} lang={notes.lang} />}
      <DocBlock
        original={pkg.doc}
        translated={notes?.packages[pkg.path]?.doc}
        lang={notes?.lang}
      />
      {pkg.error && <p className="doc error">{pkg.error}</p>}
      {pkg.kind === "own" && (
        <div className="buttons">
          <button onClick={() => onInside(pkg.path)}>Look inside</button>
        </div>
      )}
      <dl>
        <dt>Directory</dt>
        <dd>
          <code>{pkg.dir}</code>
        </dd>
        {pkg.module && (
          <>
            <dt>Module</dt>
            <dd>
              <code>{pkg.module}</code>
            </dd>
          </>
        )}
      </dl>
      <Links
        title="Imports"
        paths={pkg.imports}
        forest={forest}
        onReveal={onReveal}
        flow="out"
      />
      <Links
        title="Imported by"
        paths={importers}
        forest={forest}
        onReveal={onReveal}
        flow="in"
      />
      {pkg.kind === "own" && (
        <Funcs source={source} path={pkg.path} onOpenFunc={onOpenFunc} />
      )}
      <section>
        <h3>
          Files <span className="n">{pkg.files.length}</span>
        </h3>
        <ul className="files">
          {pkg.files.map((f) => (
            <li key={f}>
              <code>{f}</code>
            </li>
          ))}
        </ul>
      </section>
    </Panel>
  );
}

// Funcs lists the package's named functions, each a way into the call flow.
function Funcs({
  source,
  path,
  onOpenFunc,
}: {
  source: DataSource;
  path: string;
  onOpenFunc: (id: string) => void;
}) {
  const [funcs, setFuncs] = useState<FuncDetail[]>();
  useEffect(() => {
    let live = true;
    // The call graph may still be building; the list then stays empty.
    source.packageFuncs(path).then(
      (f) => live && setFuncs(f),
      () => live && setFuncs([]),
    );
    return () => {
      live = false;
    };
  }, [source, path]);

  const notes = useNotesBook();
  const named = (funcs ?? []).filter((f) => !f.name.includes("$"));
  return (
    <section>
      <h3>
        Functions <span className="n">{funcs ? named.length : "…"}</span>
      </h3>
      <ul className="links">
        {named.map((f) => (
          <li key={f.id}>
            <button
              className="kind-own"
              onClick={() => onOpenFunc(f.id)}
              title="Open the call flow from here"
            >
              <span className="dot" />
              {f.name}
              <span className="n">
                {f.calls.filter((c) => c.to.kind === "own").length} calls
              </span>
              {notes?.funcs[f.id]?.summary && (
                <span className="summary" lang={notes.lang}>
                  {notes.funcs[f.id].summary}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

const kindLabel = {
  own: "Module package",
  std: "Standard library",
  ext: "Dependency",
} as const;

function Links(props: {
  title: string;
  paths: string[];
  forest: Forest;
  flow: "out" | "in";
  onReveal: (path: string) => void;
}) {
  const { title, forest, flow, onReveal } = props;
  const order = { own: 0, ext: 1, std: 2 };
  const kindOf = (p: string) => forest.packages.get(p)?.kind ?? "std";
  const paths = [...props.paths].sort(
    (a, b) => order[kindOf(a)] - order[kindOf(b)] || a.localeCompare(b),
  );
  return (
    <section>
      <h3 className={flow}>
        {title} <span className="n">{paths.length}</span>
      </h3>
      <ul className="links">
        {paths.map((p) => (
          <li key={p}>
            <button
              className={`kind-${kindOf(p)}`}
              onClick={() => onReveal(p)}
              title={p}
            >
              <span className="dot" />
              {p}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
