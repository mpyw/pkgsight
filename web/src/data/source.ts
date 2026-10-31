import type {
  CallStatus,
  Entry,
  Func,
  FuncDetail,
  Graph,
  Notes,
} from "./types";

// Where the app reads its data from. `serve` answers over HTTP; the planned
// `export` embeds the same data in the page.
export interface DataSource {
  graph(): Promise<Graph>;
  callStatus(): Promise<CallStatus>;
  entries(): Promise<Entry[]>;
  func(id: string): Promise<FuncDetail>;
  packageFuncs(path: string): Promise<FuncDetail[]>;
  search(q: string): Promise<Func[]>;
  source(file: string): Promise<string>;
  notes(lang: string): Promise<Notes>;
  // The URL of an image of the repository, by its path from the root.
  asset(path: string): string;
  // Calls back whenever the notes change, until the returned function runs.
  watchNotes(changed: () => void): () => void;
}

export class HttpDataSource implements DataSource {
  private sources = new Map<string, Promise<string>>();

  graph = () => this.json<Graph>("/api/graph");
  callStatus = () => this.json<CallStatus>("/api/calls/status");
  entries = () => this.json<Entry[]>("/api/calls/entries");
  func = (id: string) =>
    this.json<FuncDetail>(`/api/calls/func?${new URLSearchParams({ id })}`);
  packageFuncs = (path: string) =>
    this.json<FuncDetail[]>(
      `/api/calls/package?${new URLSearchParams({ path })}`,
    );
  search = (q: string) =>
    this.json<Func[]>(`/api/calls/search?${new URLSearchParams({ q })}`);

  notes = (lang: string) =>
    this.json<Notes>(`/api/notes?${new URLSearchParams({ lang })}`);

  asset = (path: string) => `/api/asset?${new URLSearchParams({ path })}`;

  watchNotes(changed: () => void): () => void {
    const events = new EventSource("/api/notes/events");
    events.addEventListener("notes", changed);
    return () => events.close();
  }

  source(file: string): Promise<string> {
    let p = this.sources.get(file);
    if (!p) {
      p = this.fetch(`/api/source?${new URLSearchParams({ file })}`).then((r) =>
        r.text(),
      );
      // Keep a failure out of the cache, so the next look tries again.
      p.catch(() => this.sources.delete(file));
      this.sources.set(file, p);
    }
    return p;
  }

  private async json<T>(url: string): Promise<T> {
    return (await (await this.fetch(url)).json()) as T;
  }

  private async fetch(url: string): Promise<Response> {
    const res = await fetch(url);
    if (!res.ok)
      throw new Error(`GET ${url}: ${res.status} ${await res.text()}`);
    return res;
  }
}
