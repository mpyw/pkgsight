# Design

How pkgsight analyzes a module, what it shows, and how notes and MCP work. [AGENTS.md](../AGENTS.md) holds the decisions behind this and the rules for changing it. The README covers only what a user needs.

## Analysis

`pkgsight serve` loads the package graph with `go list` first, so the map shows at once. The call graph is built after it, in the background.

With `--watch`, on by default, `internal/watch` polls the Go files, `go.mod`, `go.sum` and `go.work` of the module's package directories twice a second. Once a change settles, the server builds both graphs again, swaps them in at once, and sends a `code` event on `/api/notes/events`. The frontend then fetches anew and keeps what is on screen. The old graphs serve requests until the new ones are ready.

The call graph comes from SSA of the module's own packages. Dependencies are loaded for their types only. VTA resolves calls, and CHA fills in what VTA cannot see.

| Call | Shown |
| --- | --- |
| To a function or method of the module | Yes |
| Through an interface, the value made in the module | Yes, to each type it can hold |
| Through an interface, the value from a dependency | As a guess (`Maybe`), drawn dotted |
| A function of the module handed to a library function | Yes, with `Through` naming the library function |
| A function literal handed to the module's own function or interface | Yes, from the caller too, with `Through` naming what it was handed to |
| Made inside a dependency | No |
| Through reflection | No |

A function handed to `sync.WaitGroup.Go` or `errgroup.Group.Go` is a `go` call. A helper that calls back what it is handed, such as a unit of work, calls back every literal any caller hands it. VTA cannot tell them apart. So the literal is drawn under the caller that wrote it, too. A named function handed to the module's own code is left to VTA. A guess is listed among the caller's calls, but the callee does not list the caller. Otherwise every type with a `Write` or an `Error` method would list every caller of the interface. A call the compiler wrote, such as the yield of a range over a function, has no line. The body of such a loop is a function the compiler wrote too. Its calls belong to the function that holds the loop.

An entry point is where a reader may start a call flow.

| Kind | What it is | Example |
| --- | --- | --- |
| `main` | A `main` function | `main` |
| `handed` | A function stored in a field of another module's struct, or made one of its function types and handed over as its interface. Nothing in the module calls it | `&analysis.Analyzer{Run: run}`, `Action: serveAction`, `http.HandlerFunc(serve)` |
| `interface` | A method that an interface of another module requires, from a type the module converts to it. Nothing in the module calls it | `ServeHTTP` |
| `uncalled` | An exported function that nothing in the module calls | A library's API |

Some methods never make an `interface` entry.

| Method | Why |
| --- | --- |
| `String` and `Error` | Nearly every type has them |
| Unexported, like the marker that closes a sum type | Only its own package can call it |
| One that only returns constants, like `Close() error { return nil }` | It shows nothing |
 A function handed to a library as an argument, as with `http.HandleFunc`, is no entry: the call flow reaches it from the caller, through the library.

## Export

`pkgsight export` builds both graphs, then writes one HTML file. The built UI's script and style go in inline. The data goes in a `<script id="pkgsight-data" type="application/json">` element, and `web/src/data/embedded.ts` answers from it in place of the server.

| Data | Comes from |
| --- | --- |
| Package graph, entries, functions, sources | The analysis, as the API would encode them |
| Call status, notes, images | The API, asked in the same process with no network, so notes are placed and checked as `serve` does |

Images that notes show are embedded as data URLs. Search runs in the browser, as the server runs it.

## Views

| View | Shows |
| --- | --- |
| Package map | Packages by directory, with import edges. Folded directories open on a click |
| Inside a package | Its functions, with methods boxed by receiver type, and the calls between them. Callers from other packages sit on the left, callees on the right. Closures fold into their function unless **Closures** is on. A large package starts with its files closed |
| Call flow | A tree of calls from one function. A function appears once per path that reaches it. Recursion stops at a function already on the path |

Edges in the call flow and inside a package:

| Call | Edge | Tag |
| --- | --- | --- |
| Plain | Solid gray | |
| `go` | Green | `go` |
| `defer` | Dashed amber | `defer` |
| Through an interface | Purple | `iface` |
| Through a function value | Dotted purple | `func value` |
| Handed to a library function | Dotted purple | `via <function>` |
| A guess | Dotted gray | `iface?` |

Inside a package, three things keep a large one readable.

| Rule | When | What it does |
| --- | --- | --- |
| Files | More than 40 functions | Each file starts as one box, with the calls between files. A click opens it |
| Hubs | A box called from many boxes: 8 with every function shown, and a quarter of the boxes, at least 5, with files | Its callers carry a tag `→ name` instead of a line each. The hub counts them, as `←9` |
| Focus | A function is picked, with **Focus** on. It starts on for a large package | Only the function and those it calls or is called by stay, without files or hubs |

With files, a package calling in to as many boxes as a hub has tags on them too, like `usecase →`.

The URL fragment holds the view: `#view=flow&fn=<id>`, `#view=inside&pkg=<path>`, or `#pkg=<path>` on the map. Inside a package, `fn` is the function picked.

| Click | History |
| --- | --- |
| To another view, another package inside, or another root of the call flow | A new entry, so the back button returns |
| From one function to another inside a package | A new entry: focus redraws around it |
| Picking a package on the map, or picking or dropping a function inside | Replaces the fragment |

## Notes

Notes live in `.pkgsight/notes/<lang>.yaml` under the directory pkgsight runs in, one file per BCP 47 language tag. The files are YAML, so a multi-line body reads well in a diff. Unknown keys are rejected, so a typo in a hand-edited file is not lost. The UI shows one language at a time, chosen in the toolbar. It starts with the browser's language when there are notes in it.

| Part | Of | Shown |
| --- | --- | --- |
| `summary` | A package or a function | Under its name on the map, inside a package and in the call flow. Plain text |
| `doc` | A package or a function | In place of the doc comment, with the original below |
| `body` | A package or a function | In the panel |
| `lines` | A function | Above a line of the function or its doc comment, without a line number |

`doc`, `body` and line notes are GitHub Flavored Markdown with HTML, sanitized. Alerts such as `> [!WARNING]` render as on GitHub. Go code blocks are highlighted like the source. A relative image path is resolved from the directory pkgsight runs in, and served by `/api/asset`.

A note keeps a `fingerprint` of the code it was written for. A function's is a hash of its tokens, from the `func` keyword to the end. Comments, blank lines and layout do not count. A package's is a hash of its doc comment and the sorted names of its functions. `internal/freshness` computes both, and tells each note's state.

| State | Meaning | Shown |
| --- | --- | --- |
| Fresh | The fingerprint matches the code | As is |
| Stale | The code changed, or the note has no fingerprint | Dimmed, with ⚠ and a warning in the panel |
| Orphan | The package or function is gone or renamed | Nowhere. `stale_notes` and `notes check` list it |

`pkgsight notes check` lists the notes that are not fresh, one per line, and exits with status 1 when there is any.

A line note may take a `kind`, drawn as a GitHub alert.

| Kind | For |
| --- | --- |
| `note` | Background to know while reading the line |
| `tip` | A better way to use or change the code |
| `important` | What a reader must grasp to understand the function |
| `warning` | Something that breaks easily or surprises |
| `caution` | A real risk, such as data loss, a race or a security hole |

A line note is stored by its offset from the `func` keyword and a hash of the trimmed line. `notes.Place` puts it on the line at that offset when the hash matches. Otherwise it goes to the nearest line in the function with the same hash. Failing that, it stays at its offset, marked stale.

## MCP

`/mcp` serves MCP over streamable HTTP. The tools answer in plain text.

| Tool | Does |
| --- | --- |
| `overview` | Lists the packages, their imports, the entry points and the languages with notes |
| `package` | Describes a package: its doc comment, imports, importers, files and functions |
| `function` | Shows a function: its source with line numbers and line notes, its calls and its callers |
| `search` | Finds functions by name |
| `write_package_note` | Replaces the note of a package |
| `write_function_note` | Replaces the note of a function, with its line notes |
| `stale_notes` | Lists the notes of one language that are stale or orphaned |
| `delete_notes` | Deletes notes of one language |

| Prompt | Arguments | Writes notes for |
| --- | --- | --- |
| `explain_module` | `lang` | Every package, and the entry points |
| `explain_package` | `package`, `lang` | A package and its functions |
| `explain_flow` | `function`, `lang`, `depth` | The functions along the call flow from a function |
| `refresh_notes` | `lang` | The stale notes, rewritten. Orphaned notes are deleted |

The server instructions in `internal/mcpserver/tools.go` tell the model how to write each part. Cross-origin browser requests to `/mcp` are refused.

## HTTP API

| Endpoint | Returns |
| --- | --- |
| `GET /api/graph` | The package graph |
| `GET /api/calls/status` | Whether the call graph is pending, ready or failed, and the packages left out because they do not type-check |
| `GET /api/calls/entries` | The entry points |
| `GET /api/calls/func?id=` | A function with its calls and callers |
| `GET /api/calls/package?path=` | The functions of a package, in source order |
| `GET /api/calls/search?q=` | Functions whose name matches |
| `GET /api/source?file=` | A source file of the module's own packages |
| `GET /api/asset?path=` | An image file under the root |
| `GET /api/notes?lang=` | The notes of a language, with line notes placed and each note's `stale` flag |
| `GET /api/notes/events` | Server-sent events: `notes` when a book of notes changes, and `code` after the code was analyzed again |
