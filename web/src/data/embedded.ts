import type { DataSource } from "./source";
import type {
  CallStatus,
  Entry,
  Func,
  FuncDetail,
  Graph,
  Notes,
} from "./types";

// Embedded is what `pkgsight export` writes into the page: the answers the
// server would give, gathered once.
export interface Embedded {
  graph: Graph;
  status: CallStatus;
  entries: Entry[];
  funcs: Record<string, FuncDetail>;
  // The function IDs of each package, in source order.
  packages: Record<string, string[]>;
  sources: Record<string, string>;
  // The notes of each language, as /api/notes answers them.
  notes: Record<string, Notes>;
  // Images that notes show, as data URLs, by their path.
  assets: Record<string, string>;
}

// readEmbedded returns the data an exported page carries, if it is one.
export function readEmbedded(doc: Document): Embedded | undefined {
  const el = doc.getElementById("pkgsight-data");
  return el?.textContent ? (JSON.parse(el.textContent) as Embedded) : undefined;
}

// EmbeddedDataSource answers from an exported page. Nothing changes, so
// there is nothing to watch.
export class EmbeddedDataSource implements DataSource {
  constructor(private d: Embedded) {}

  graph = () => Promise.resolve(this.d.graph);
  callStatus = () => Promise.resolve(this.d.status);
  entries = () => Promise.resolve(this.d.entries);

  func = (id: string) => {
    const f = this.d.funcs[id];
    return f
      ? Promise.resolve(f)
      : Promise.reject(new Error(`no such function: ${id}`));
  };

  packageFuncs = (path: string) =>
    Promise.resolve(
      (this.d.packages[path] ?? []).flatMap((id) => this.d.funcs[id] ?? []),
    );

  // search matches as the server does: "pkgname.Name" contains q, ignoring
  // case, the shortest names first.
  search = (q: string) => {
    const want = q.toLowerCase();
    const hits: Func[] = Object.values(this.d.funcs)
      .filter((f) => `${f.pkgName}.${f.name}`.toLowerCase().includes(want))
      .map(({ calls: _calls, callers: _callers, ...f }) => f);
    hits.sort(
      (a, b) => a.name.length - b.name.length || (a.id < b.id ? -1 : 1),
    );
    return Promise.resolve(hits.slice(0, 50));
  };

  source = (file: string) =>
    file in this.d.sources
      ? Promise.resolve(this.d.sources[file])
      : Promise.reject(new Error(`no such file: ${file}`));

  notes = (lang: string): Promise<Notes> => {
    const langs = Object.keys(this.d.notes).sort();
    return Promise.resolve(
      this.d.notes[lang] ?? { langs, lang, packages: {}, funcs: {} },
    );
  };

  asset = (path: string) => this.d.assets[path] ?? path;
  watchNotes = () => () => {};
  watchCode = () => () => {};
}
