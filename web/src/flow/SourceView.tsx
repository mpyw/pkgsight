import { Fragment, useEffect, useMemo, useState } from "react";
import type { DataSource } from "../data/source";
import type { Call, LineNote } from "../data/types";
import { AlertTitle } from "../notes/alerts";
import { Markdown } from "../notes/Markdown";
import { highlight } from "./highlight";

interface Props {
  source: DataSource;
  file: string;
  from: number;
  to: number;
  calls: Call[];
  // The line to scroll to and mark, when the reader came from a call.
  focus?: number;
  // Notes to show above their lines, in the language lang.
  notes?: LineNote[];
  lang?: string;
}

export function SourceView({
  source,
  file,
  from,
  to,
  calls,
  focus,
  notes,
  lang,
}: Props) {
  const [text, setText] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let live = true;
    source.source(file).then(
      (t) => live && setText(t),
      (e: unknown) => live && setError(String(e)),
    );
    return () => {
      live = false;
    };
  }, [source, file]);

  const marks = useMemo(() => {
    const m = new Map<number, string>();
    for (const c of calls)
      for (const l of c.lines)
        if (!m.has(l) || c.mode !== "call") m.set(l, c.mode);
    return m;
  }, [calls]);

  const lines = useMemo(
    () => (text === undefined ? [] : text.split("\n").slice(from - 1, to)),
    [text, from, to],
  );
  const tokens = useMemo(() => highlight(lines), [lines]);

  const above = useMemo(() => {
    const m = new Map<number, LineNote[]>();
    for (const n of notes ?? []) m.set(n.line, [...(m.get(n.line) ?? []), n]);
    return m;
  }, [notes]);

  if (error) return <pre className="source error">{error}</pre>;
  if (text === undefined) return <pre className="source">Loading…</pre>;
  return (
    <pre className="source">
      {tokens.map((line, i) => {
        const n = from + i;
        const mark = marks.get(n);
        const cls = [
          "line",
          mark && `call mode-${mark}`,
          n === focus && "focus",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <Fragment key={n}>
            {above.get(n)?.map((note, j) => (
              <div
                key={j}
                className={[
                  "vnote",
                  note.kind && `alert-${note.kind}`,
                  note.stale && "stale",
                ]
                  .filter(Boolean)
                  .join(" ")}
                lang={lang}
                title={
                  note.stale
                    ? "The code here changed since this note was written"
                    : undefined
                }
              >
                <span className="ln" />
                <span
                  className="text"
                  style={{ marginLeft: `${indent(lines[i])}ch` }}
                >
                  {note.kind && <AlertTitle kind={note.kind} />}
                  <Markdown text={note.text} />
                </span>
              </div>
            ))}
            <div className={cls}>
              <span className="ln">{n}</span>
              <code>
                {line.map((t, j) => (
                  <span key={j} className={`tk-${t.kind}`}>
                    {t.text}
                  </span>
                ))}
              </code>
            </div>
          </Fragment>
        );
      })}
    </pre>
  );
}

// indent is the width of a line's leading whitespace, a tab counting as the
// tab-size of .source.
function indent(line: string): number {
  let w = 0;
  for (const c of line) {
    if (c === "\t") w += 4;
    else if (c === " ") w += 1;
    else break;
  }
  return w;
}
