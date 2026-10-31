# Repository instructions

pkgsight draws a Go module in the browser: a package map, the functions inside a package, and call flows. An assistant can write notes over MCP, and the browser shows them next to the code. Read [the design document](docs/design.md) for how the analysis, the views, notes and MCP work. This file records how the code is laid out, and the decisions that are easy to undo by accident. [The README](README.md) is for users only. Keep it to what a person needs to install and use pkgsight, and put anything for agents or contributors here or in the design document.

## Layout

| Path | Role |
| --- | --- |
| `cmd/pkgsight` | The commands, on urfave/cli v3. `main.go` assembles them, each command has a file of its own, and `utils.go` holds what they share |
| `internal/load` | The package graph, from `go list -json` |
| `internal/callgraph` | The call graph, from SSA with VTA, and the queries the API serves |
| `internal/notes` | The notes store: one JSON file per language, and the placement of line notes |
| `internal/freshness` | The fingerprint of a function or a package, and whether each note still matches its code |
| `internal/watch` | Polls the module's Go files, and tells when they change |
| `internal/server` | The HTTP API, the notes stream, image serving and the embedded UI |
| `internal/mcpserver` | The MCP tools and prompts |
| `internal/model` | The JSON shapes shared with the UI. `web/src/data/types.ts` mirrors them |
| `web/` | The UI: React, React Flow and elkjs. `web/embed.go` embeds `web/dist` |

## Decisions to preserve

### The analysis is shallow on purpose

`callgraph.Build` loads the module's own packages with syntax, and dependencies with types only. SSA is built for the own packages alone. VTA resolves calls, and CHA fills in what VTA cannot see.

Full-program SSA was measured and rejected. It is about six times heavier in memory.

| Module | Full program | Shallow |
| --- | --- | --- |
| `cmd/go` | 1.17 GB RSS, 1.75 s | 180 MB RSS, 3.5 s |
| `github.com/mpyw/declscope` | 780 MB RSS, 1.35 s | 114 MB RSS |

The price is calls that pass through dependencies. In `cmd/go`, 811 calls between own functions were lost. 724 of them went through `error`, and most others through `fs.FileInfo` and `flag.Value`. Turning generic instantiation off saved only about 10%, so it is not worth the lost edges.

Two repairs make up for the lost edges. Keep both.

- An interface call that VTA leaves unresolved gets the CHA callees, marked `Maybe`. The UI draws them as guesses.
- An own function handed to a library function becomes a call, with `Through` naming that function. `sync.WaitGroup.Go` and `errgroup.Group.Go` count as `go` calls, through the `spawners` map. A generic library function is named by its origin, so type arguments do not leak into the UI.

### Go only

Adapters for other languages were considered and rejected. An LSP call hierarchy gives callees, but not `go` or `defer`, interface dispatch, or callbacks through libraries. Precise analyzers for other languages need their own runtimes, which breaks the single binary. A tool for another language would be a separate project. So the UI may rely on Go's SSA names: `inside/graph.ts` reads `(*T).M` for receivers and `f$1` for closures.

The module path is `github.com/mpyw/pkgsight`. The name `pkgsight.go` was tried and dropped.

### JSON

Use `encoding/json/v2`, never v1.

- v2 writes a nil slice as `[]`. The UI relies on this. A call the compiler wrote, such as the yield of a range over a function, has no position, so its `Lines` stay nil. Under v1 that was `null`, and the UI crashed.
- v2 `omitempty` keeps `0` and `false`. Use `omitzero` for numbers and booleans.

### Notes

- A function ID is the key of its notes. A change to `builder.id` orphans every stored note, so treat it as a change of the file format.
- So is a change to how `internal/freshness` hashes code: every note would turn stale at once.
- A guess from CHA is listed among the caller's calls, but does not make the callee list the caller. Otherwise every type with a `Write` or an `Error` method would list every caller of the interface.
- A write edits a copy of the book, and stores it only once the file is written. A failed write must leave the store as the file has it.
- A line note stores its offset from the `func` keyword and a hash of the trimmed line, never a line number. Doc comment lines get negative offsets. `notes.Place` puts it back on the nearest line with the same hash, or marks it stale.
- A language tag names a file, so `validLang` must accept only BCP 47 shapes. Writes go through a temporary file and a rename, and the file is `0644` for the team.

### What the server exposes

- `/api/source` serves only the files of own packages.
- `/api/asset` serves only image files, opened through `os.Root` so no path or symbolic link leaves the root. SVG goes out with a sandboxing Content-Security-Policy.
- Note Markdown goes through `rehype-sanitize` after `rehype-raw`. Never render note HTML another way.
- `/mcp` is wrapped in `http.CrossOriginProtection`. The SDK option `StreamableHTTPOptions.CrossOriginProtection` is deprecated. It is registered once per method, because a pattern without a method conflicts with `GET /`.
- MCP tools answer in plain text, not JSON. A model reads it better.
- Requests share the server context through `BaseContext`, so the notes stream ends on shutdown.

### Watching the code

- `internal/watch` polls file sizes and times. fsnotify was rejected. On macOS it holds a file descriptor for every watched file, and a large module runs out of them.
- The watcher starts only after the first call graph is handed over, so a reload never lands before it.
- `Server.Reload` swaps the package graph and the call graph under one lock, so no request sees one without the other. The MCP backend reads the package graph through a function for the same reason.
- The frontend hands its views the data source under a new identity after a `code` event (`anew`). Every fetch lists the data source as a dependency, so all of them run again. Do not add a separate revision counter to effects: oxlint rejects dependencies an effect does not read.

### UI behavior that was asked for

- In the call flow, a click on a node opens it and never closes it. The badge toggles it. Clicking back to a parent must not fold what was opened below it.
- The package map and the inside view lay out again only when a summary changes. The map must hold still while an assistant writes function notes.

## Workflow

- `mise run check` runs everything CI would: golangci-lint, `go test`, `declscope shrink`, declscope, then the UI's type check, oxlint, prettier and vitest.
- `mise run build` builds the UI and the binary. The Go tests do not need the built UI.
- The Go tests analyze small modules in `internal/callgraph/testdata`: `sample` for the common shapes, `edges` for generics, guesses, wrappers and callbacks, and `broken` for a package that does not type-check.
- CI uploads coverage to Codecov under two flags, `go` and `ts`. Keep both near 100%. A branch no test can reach is a sign to remove it, not to skip it.
- This repository runs declscope with `qualify: ondemand` and `exported: true`. Read `.agents/skills/declscope-authoring/SKILL.md` before writing Go here. `internal/server/server.go` and `internal/mcpserver/tools.go` are core files.
- Run `declscope shrink` before declscope. A name that shrink unexports must then carry its file's namespace.
- `.pkgsight/notes/ja.yaml` holds Japanese notes on this repository's own code. CI runs `pkgsight notes check`, which fails once a change turns a note stale. After changing a function, run `pkgsight serve`, connect over MCP, and rewrite the stale notes with the `refresh_notes` prompt. Write a note for each new function too. A note says what the code does now and why, never what it used to do.
- The UI uses TypeScript 7 (`tsc -b`), oxlint rather than ESLint, prettier and pnpm.
- `.claude` and `CLAUDE.md` are symbolic links to `.agents` and this file.

## Releases

- Run the **Tag and Release** workflow with a version such as `v0.1.0`. GoReleaser builds every platform from one runner, and publishes the GitHub Release.
- The before hooks of `.goreleaser.yaml` build the web UI, so every binary embeds it. `go install` cannot, so the README sends users to mise or the release archives.
- Bump every version string in the README in one commit before tagging. `.github/scripts/check-version.sh` lists them. CI checks that they agree, and the Tag workflow checks that they equal the tag.
- GoReleaser is pinned to 2.17.1. 2.18.0 attests every artifact, which fails the job in declscope, a sibling project.
- `main.version` is set at link time. `pkgsight --version` prints it, and MCP reports it.
