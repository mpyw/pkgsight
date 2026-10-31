import type { DataSource } from "../data/source";
import type {
  Call,
  CallStatus,
  Entry,
  Func,
  FuncDetail,
  Graph,
  Notes,
  Package,
} from "../data/types";

// A small module with a program, a server package that starts goroutines
// and calls through an interface, a store, and a library package.
const mod = "ex.com/app";

const pkg = (
  path: string,
  imports: string[],
  extra: Partial<Package> = {},
): Package => ({
  path,
  name: path.split("/").at(-1)!,
  kind: "own",
  module: mod,
  dir: path === mod ? "." : path.slice(mod.length + 1),
  files: ["main.go"],
  imports,
  ...extra,
});

export const graph: Graph = {
  root: "/src/app",
  modules: [
    { path: mod, main: true },
    { path: "golang.org/x/sync", version: "v0.10.0", main: false },
  ],
  packages: [
    pkg(`${mod}/cmd/app`, [`${mod}/internal/server`, "fmt"], {
      name: "main",
      doc: "Command app serves the store.",
    }),
    pkg(`${mod}/internal/server`, [
      `${mod}/internal/store`,
      "golang.org/x/sync/errgroup",
      "fmt",
    ]),
    pkg(`${mod}/internal/store`, [], {
      error: "store.go:3: undefined: x",
    }),
    pkg("fmt", [], {
      kind: "std",
      module: undefined,
      dir: "/go/src/fmt",
      files: ["print.go"],
    }),
    pkg("golang.org/x/sync/errgroup", [], {
      kind: "ext",
      module: "golang.org/x/sync",
      dir: "/mod/errgroup",
    }),
  ],
};

const fn = (
  pkgPath: string,
  name: string,
  extra: Partial<Func> = {},
): Func => ({
  id: `${pkgPath}.${name}`,
  name,
  pkg: pkgPath,
  pkgName: pkgPath === `${mod}/cmd/app` ? "main" : pkgPath.split("/").at(-1)!,
  kind: "own",
  ...extra,
});

export const main = fn(`${mod}/cmd/app`, "main", {
  file: "cmd/app/main.go",
  line: 5,
  endLine: 8,
  doc: "main runs the server.",
});
export const run = fn(`${mod}/internal/server`, "Run", {
  file: "internal/server/main.go",
  line: 9,
  endLine: 16,
  docLine: 8,
  doc: "Run serves until it fails.",
});
export const run1 = fn(`${mod}/internal/server`, "Run$1", {
  file: "internal/server/main.go",
  line: 11,
  endLine: 13,
});
export const serve = fn(`${mod}/internal/server`, "(*Server).Serve", {
  file: "internal/server/main.go",
  line: 18,
  endLine: 22,
});
export const get = fn(`${mod}/internal/store`, "Get", {
  file: "internal/store/main.go",
  line: 3,
  endLine: 5,
});
export const loop = fn(`${mod}/internal/store`, "loop", {
  file: "internal/store/main.go",
  line: 7,
  endLine: 9,
});
export const printLine = fn("fmt", "Println", { kind: "std" });

const call = (to: Func, extra: Partial<Call> = {}): Call => ({
  to,
  mode: "call",
  dispatch: "static",
  lines: [6],
  ...extra,
});

export const details = new Map<string, FuncDetail>([
  [
    main.id,
    {
      ...main,
      calls: [call(run, { lines: [6, 7] }), call(printLine, { lines: [7] })],
      callers: [],
    },
  ],
  [
    run.id,
    {
      ...run,
      calls: [
        call(run1, {
          mode: "go",
          dispatch: "dynamic",
          lines: [11],
          through: "sync.(*WaitGroup).Go",
        }),
        call(serve, { mode: "defer", lines: [14] }),
        call(get, { dispatch: "interface", maybe: true, lines: [15] }),
      ],
      callers: [main],
    },
  ],
  [run1.id, { ...run1, calls: [call(get, { lines: [12] })], callers: [run] }],
  [
    serve.id,
    {
      ...serve,
      calls: [call(get, { dispatch: "interface", lines: [19] })],
      callers: [run],
    },
  ],
  [
    get.id,
    {
      ...get,
      calls: [call(loop, { lines: [4] })],
      callers: [run, run1, serve],
    },
  ],
  [loop.id, { ...loop, calls: [call(loop, { lines: [8] })], callers: [get] }],
]);

export const sources: Record<string, string> = {
  "cmd/app/main.go": [
    "package main",
    "",
    'import "ex.com/app/internal/server"',
    "",
    "func main() {",
    "\tserver.Run()",
    '\tfmt.Println("done")',
    "}",
  ].join("\n"),
  "internal/server/main.go": [
    "package server",
    "",
    "type Server struct{}",
    "",
    "type Getter interface{ Get() string }",
    "",
    "var wg sync.WaitGroup",
    "// Run serves until it fails.",
    "func Run() {",
    "\t// start",
    "\twg.Go(func() {",
    "\t\tstore.Get()",
    "\t})",
    "\tdefer (&Server{}).Serve(nil)",
    "\tvar g Getter; g.Get()",
    "}",
    "",
    "func (s *Server) Serve(g Getter) {",
    "\tg.Get()",
    "  /* block",
    "  comment */",
    "}",
  ].join("\n"),
  "internal/store/main.go": [
    "package store",
    "",
    "func Get() string {",
    "\tloop()",
    '\treturn "v"',
    "}",
    "func loop() {",
    "\tloop()",
    "}",
  ].join("\n"),
};

export const entries: Entry[] = [
  { ...main, reason: "main" },
  { ...run, reason: "uncalled" },
];

export const notesJa: Notes = {
  langs: ["en", "ja"],
  lang: "ja",
  packages: {
    [`${mod}/internal/server`]: {
      summary: "サーバーの起動",
      doc: "サーバーを動かす。",
      stale: true,
      body: "> [!WARNING]\n> 止まらない。",
    },
  },
  funcs: {
    // Written for older code, so every view marks it.
    [main.id]: { summary: "入口", body: "`server.Run` を呼ぶ。", stale: true },
    [run.id]: {
      summary: "サーバーを動かす",
      doc: "失敗するまで動かす。",
      lines: [
        { line: 8, text: "doc の行", kind: "note" },
        { line: 11, text: "**並列**に挨拶する", kind: "tip" },
        { line: 11, text: "二つ目" },
        { line: 15, text: "古い", stale: true },
      ],
    },
  },
};

export interface FakeOptions {
  status?: CallStatus[];
  notes?: Record<string, Notes>;
  failGraph?: boolean;
  failPackage?: boolean;
  failSource?: boolean;
}

// FakeSource answers from the data above. Each call to callStatus returns
// the next status of the list, then the last one forever.
export class FakeSource implements DataSource {
  watchers = new Set<() => void>();
  searches: string[] = [];
  private statusIndex = 0;

  constructor(private o: FakeOptions = {}) {}

  graph = () =>
    this.o.failGraph
      ? Promise.reject(new Error("GET /api/graph: 500 boom"))
      : Promise.resolve(graph);

  callStatus = () => {
    const list = this.o.status ?? [{ state: "ready", tookMs: 1234 }];
    const s = list[Math.min(this.statusIndex++, list.length - 1)];
    return Promise.resolve(s);
  };

  entries = () => Promise.resolve(entries);

  func = (id: string) => {
    const d = details.get(id);
    return d ? Promise.resolve(d) : Promise.reject(new Error(`no ${id}`));
  };

  packageFuncs = (path: string) =>
    this.o.failPackage
      ? Promise.reject(new Error("GET /api/calls/package: 503"))
      : Promise.resolve([...details.values()].filter((d) => d.pkg === path));

  search = (q: string) => {
    this.searches.push(q);
    return Promise.resolve(
      [...details.values()]
        .filter((d) => d.name.toLowerCase().includes(q.toLowerCase()))
        .map(({ calls: _calls, callers: _callers, ...f }) => f),
    );
  };

  source = (file: string) =>
    this.o.failSource || !(file in sources)
      ? Promise.reject(new Error(`GET /api/source: 404 ${file}`))
      : Promise.resolve(sources[file]);

  notes = (lang: string): Promise<Notes> => {
    const books = this.o.notes ?? { ja: notesJa };
    const langs = Object.keys(books).sort();
    const book = books[lang];
    return Promise.resolve(
      book ? { ...book, langs } : { langs, lang, packages: {}, funcs: {} },
    );
  };

  asset = (path: string) => `/api/asset?path=${path}`;

  watchNotes(changed: () => void): () => void {
    this.watchers.add(changed);
    return () => this.watchers.delete(changed);
  }

  // notify plays the server telling that notes changed.
  notify() {
    for (const w of this.watchers) w();
  }
}
