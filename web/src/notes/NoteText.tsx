import type { Note } from "../data/types";
import { Markdown } from "./Markdown";

// NoteBlock shows a note in a side panel: the summary, then the body in
// GitHub Flavored Markdown.
export function NoteBlock({ note, lang }: { note?: Note; lang: string }) {
  if (!note?.summary && !note?.body) return null;
  return (
    <div className="note-block" lang={lang}>
      {note.summary && (
        <p className="summary">
          <Inline text={note.summary} />
        </p>
      )}
      {note.body && <Markdown text={note.body} />}
    </div>
  );
}

// DocBlock shows a doc comment, translated when the notes have it, with
// the original below the translation.
export function DocBlock({
  original,
  translated,
  lang,
}: {
  original?: string;
  translated?: string;
  lang?: string;
}) {
  if (!translated) return original ? <p className="doc">{original}</p> : null;
  return (
    <div className="doc translated">
      <div lang={lang}>
        <Markdown text={translated} />
      </div>
      {original && <p className="original">{original}</p>}
    </div>
  );
}

// Inline renders text with `code` spans.
export function Inline({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/(`[^`]+`)/)
        .map((part, i) =>
          part.startsWith("`") && part.endsWith("`") && part.length > 1 ? (
            <code key={i}>{part.slice(1, -1)}</code>
          ) : (
            part
          ),
        )}
    </>
  );
}
