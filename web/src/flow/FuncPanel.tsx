import { Panel } from "../components/Panel";
import type { DataSource } from "../data/source";
import type { Call, Func, FuncDetail } from "../data/types";
import { DocBlock, NoteBlock } from "../notes/NoteText";
import { useNotesBook } from "../notes/useNotes";
import { SourceView } from "./SourceView";

interface Props {
  source: DataSource;
  fn: Func;
  detail?: FuncDetail;
  via?: Call;
  // The caller in the tree, whose source holds the call.
  caller?: Func;
  isRoot: boolean;
  onRoot: (id: string) => void;
  onShowPackage: (path: string) => void;
  onClose: () => void;
}

const kindLabel = {
  own: "Module function",
  std: "Standard library",
  ext: "Dependency",
} as const;

export function FuncPanel({
  source,
  fn,
  detail,
  via,
  caller,
  isRoot,
  onRoot,
  onShowPackage,
  onClose,
}: Props) {
  const notes = useNotesBook();
  const note = notes?.funcs[fn.id];
  return (
    <Panel>
      <header>
        <div>
          <div className={`kind kind-${fn.kind}`}>{kindLabel[fn.kind]}</div>
          <h2>{fn.name}</h2>
          <code className="path">{fn.pkg}</code>
        </div>
        <button className="close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>
      {notes && <NoteBlock note={note} lang={notes.lang} />}
      <DocBlock original={fn.doc} translated={note?.doc} lang={notes?.lang} />
      <div className="buttons">
        {fn.kind === "own" && !isRoot && (
          <button onClick={() => onRoot(fn.id)}>Start the flow here</button>
        )}
        {fn.kind === "own" && (
          <button onClick={() => onShowPackage(fn.pkg)}>
            Show the package
          </button>
        )}
      </div>
      {via && caller && (
        <p className="via">
          <span className={`tag mode-${via.mode}`}>{via.mode}</span>
          {via.dispatch !== "static" && (
            <span className="tag dispatch">
              {via.dispatch === "interface" ? "interface" : "func value"}
            </span>
          )}
          from <code>{caller.name}</code> at line {via.lines.join(", ")}
          {via.through && (
            <span className="hint">
              Handed to <code>{via.through}</code>, which makes the call.
            </span>
          )}
          {via.maybe && (
            <span className="hint">
              The value reaches this call through code outside the module, so
              this callee is a guess from the types.
            </span>
          )}
        </p>
      )}
      {fn.kind !== "own" && (
        <p className="hint">
          The analysis reads only the module's own code, so this is a leaf.
        </p>
      )}
      {fn.file && fn.line && fn.endLine && (
        <section>
          <h3>
            <code>
              {fn.file}:{fn.line}
            </code>
          </h3>
          <SourceView
            source={source}
            file={fn.file}
            from={fn.docLine ?? fn.line}
            to={fn.endLine}
            calls={detail?.calls ?? []}
            notes={note?.lines}
            lang={notes?.lang}
          />
        </section>
      )}
      {detail && (
        <section>
          <h3 className="in">
            Called by <span className="n">{detail.callers.length}</span>
          </h3>
          <ul className="links">
            {detail.callers.map((c) => (
              <li key={c.id}>
                <button
                  className="kind-own"
                  onClick={() => onRoot(c.id)}
                  title="Start the flow here"
                >
                  <span className="dot" />
                  {c.pkgName}.{c.name}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Panel>
  );
}
