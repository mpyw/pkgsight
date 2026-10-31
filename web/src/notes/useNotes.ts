import { createContext, useContext, useEffect, useState } from "react";
import type { DataSource } from "../data/source";
import type { Notes } from "../data/types";

const KEY = "pkgsight.notesLang";
const OFF = "off";

export interface NotesState {
  langs: string[];
  // The language shown, or undefined when notes are off or there are none.
  lang?: string;
  choose: (lang: string | undefined) => void;
  notes?: Notes;
}

// useNotes keeps the notes of the chosen language, and refreshes them when
// the assistant writes one or when the call graph, which places line notes,
// is ready.
export function useNotes(source: DataSource): NotesState {
  const [langs, setLangs] = useState<string[]>([]);
  const [chosen, setChosen] = useState<string | null>(() => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  });
  const [notes, setNotes] = useState<Notes>();

  const lang =
    chosen === OFF
      ? undefined
      : chosen && langs.includes(chosen)
        ? chosen
        : preferred(langs);

  useEffect(() => {
    let live = true;
    const load = () =>
      source.notes(lang ?? "").then(
        (n) => {
          if (!live) return;
          setLangs(n.langs);
          setNotes(lang ? n : undefined);
        },
        () => live && setNotes(undefined),
      );
    void load();
    const stop = source.watchNotes(() => void load());

    // Line notes are placed once the call graph is ready, so load again then.
    let timer: ReturnType<typeof setTimeout>;
    const poll = () =>
      source.callStatus().then(
        (s) => {
          if (!live) return;
          if (s.state === "pending") timer = setTimeout(poll, 1000);
          else void load();
        },
        () => {
          if (live) timer = setTimeout(poll, 1000);
        },
      );
    void poll();

    return () => {
      live = false;
      stop();
      clearTimeout(timer);
    };
  }, [source, lang]);

  const choose = (l: string | undefined) => {
    const v = l ?? OFF;
    setChosen(v);
    try {
      localStorage.setItem(KEY, v);
    } catch {
      // The choice then lasts only for this page.
    }
  };

  return { langs, lang, choose, notes };
}

// preferred picks the browser's language when it has notes, else the first.
function preferred(langs: string[]): string | undefined {
  for (const want of navigator.languages) {
    const hit =
      langs.find((l) => l.toLowerCase() === want.toLowerCase()) ??
      langs.find((l) => l.split("-")[0] === want.split("-")[0]);
    if (hit) return hit;
  }
  return langs[0];
}

export const NotesContext = createContext<Notes | undefined>(undefined);

export function useNotesBook(): Notes | undefined {
  return useContext(NotesContext);
}
