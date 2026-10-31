<div align="center">

<img src=".github/assets/icon.png" width="200" alt="A Go gopher looking through a magnifying glass at a tree of packages">

# pkgsight

See how a Go module is **built** and how its code **runs**, in your browser.

[![CI](https://github.com/mpyw/pkgsight/actions/workflows/ci.yml/badge.svg)](https://github.com/mpyw/pkgsight/actions/workflows/ci.yml)
[![Codecov](https://codecov.io/gh/mpyw/pkgsight/graph/badge.svg)](https://codecov.io/gh/mpyw/pkgsight)
[![Go Reference](https://pkg.go.dev/badge/github.com/mpyw/pkgsight.svg)](https://pkg.go.dev/github.com/mpyw/pkgsight)

</div>

> [!WARNING]
> This is an early draft. The flags, the notes format and the MCP tools may change.

pkgsight reads a Go module and draws it. The package map shows which package imports which. The call flow follows the calls from a function, line by line. An AI assistant can write notes in your own language, and they appear next to the code.

![The call flow of declscope, with notes in Japanese](docs/assets/call-flow.png)

## Why

Reading an unfamiliar codebase file by file hides its shape. pkgsight shows the shape first, so you know where to read.

| You want to know | Open |
| --- | --- |
| How the packages depend on each other | [The package map](#the-package-map) |
| What a package holds, and how its functions call each other | [Inside a package](#inside-a-package) |
| What happens when a program runs | [The call flow](#the-call-flow) |
| Why a line is there | [Notes](#notes-from-an-assistant) |

Everything runs from one binary. It needs no account and no network. The code stays on your machine.

## Install

| Method | Command |
| --- | --- |
| **[mise](https://mise.jdx.dev/)** *(recommended)* | `mise use "github:mpyw/pkgsight@0.1.0"` |
| Release archive | See below |
| From source | See below |

<details>
<summary>Pin a version, or install from an archive or from source</summary>

`mise use` pins the version in the project's `mise.toml`, so every checkout runs the same one. Add `-g` to install it for every project on your machine instead.

```toml
[tools]
"github:mpyw/pkgsight" = "0.1.0"
```

From a release archive, verified against the published checksums:

```bash
VERSION=0.1.0
curl -LO "https://github.com/mpyw/pkgsight/releases/download/v${VERSION}/pkgsight_${VERSION}_darwin_arm64.tar.gz"
curl -LO "https://github.com/mpyw/pkgsight/releases/download/v${VERSION}/checksums.txt"
shasum -a 256 -c checksums.txt --ignore-missing
tar xzf "pkgsight_${VERSION}_darwin_arm64.tar.gz"
```

From source. mise installs Go, Node.js and pnpm at the versions the repository pins.

```bash
git clone https://github.com/mpyw/pkgsight
cd pkgsight
mise install
mise run build
```

> [!WARNING]
> **`go install` gives a binary without the web UI.** The UI is built with pnpm and embedded at build time. The Go module does not contain the built files. Such a binary serves only an error page.

</details>

## Usage

Run it in a Go module.

```bash
cd path/to/your/module
pkgsight serve
```

```console
loaded 223 packages in 741ms
serving on http://127.0.0.1:7878, and MCP on http://127.0.0.1:7878/mcp
built the call graph in 2.694s
```

The browser opens on the package map. The map is ready at once. The call flow waits for the call graph, which is built in the background.

| Command | What it does |
| --- | --- |
| `pkgsight serve [flags] [packages]` | Analyze the packages and open them in the browser |
| `pkgsight version` | Print the version |

`serve` takes these flags.

| Flag | Default | Meaning |
| --- | --- | --- |
| `-C` | `.` | The directory to run in |
| `-addr` | `localhost:7878` | The address to listen on |
| `-open` | `true` | Open the map in the default browser |

Package patterns follow the flags and default to `./...`, as for the go command.

```bash
pkgsight serve -C ../other-module ./cmd/... ./internal/...
```

The URL keeps what is on screen. Copy it to show someone the same view.

### The package map

![The package map of declscope](docs/assets/package-map.png)

Packages are laid out by directory. A directory with many packages folds into one box, and a click opens it.

| Action | Result |
| --- | --- |
| Click a package | The panel lists its imports, its importers and its functions. Its own edges light up |
| Double-click a package, or press **Look inside** | [Inside a package](#inside-a-package) opens |
| Click a function in the panel | [The call flow](#the-call-flow) opens from it |
| Toggle **Standard library** or **Dependencies** | Packages from outside the module show or hide |

### Inside a package

![Inside the config package of declscope](docs/assets/inside.png)

One package, function by function.

- Each function is a box. Methods sit in a box for their receiver type.
- Calls between them are drawn with the same styles as [the call flow](#the-call-flow).
- Packages that call in sit on the left. Packages it calls sit on the right. A click goes inside them.
- Exported names are bold. Closures fold into the function that holds them, as `+2ƒ`. **Closures** shows them on their own.

Click a function to see its source, its notes and its callers.

### The call flow

The call flow is a tree of calls, read left to right. Start it from the sidebar.

| Section | Holds |
| --- | --- |
| **Programs** | Each `main` function |
| **Called from outside** | Exported functions that nothing in the module calls |
| The search box | Any function of the module, by name |

A click on a function selects it and opens its calls. The badge on its right edge opens or closes it: `+4` opens four calls, and `−` closes them. Closing keeps what was open below, so it comes back on the next open.

The panel shows the source of the selected function. Lines that make a call are marked. **Called by** lists its callers. A click on one starts the flow there.

Calls are drawn by how they start their callee and how they find it.

| Call | Edge | Tag |
| --- | --- | --- |
| A plain call | Solid gray | None |
| `go` | Green | `go` |
| `defer` | Dashed amber | `defer` |
| Through an interface | Purple | `iface` |
| Through a function value | Dotted purple | `func value` |
| A function handed to a library function | Dotted purple | `via (*WaitGroup).Go` |
| A guess from the types | Dotted gray | `iface?` |

A function handed to `sync.WaitGroup.Go` or `errgroup.Group.Go` counts as a `go` call. **Library calls** adds calls into the standard library and dependencies, as leaves.

> [!NOTE]
> **A guessed edge** is an interface call whose value comes through code outside the module. The analysis cannot follow the value. It lists every type of the module that has the method. See [What the analysis sees](#what-the-analysis-sees).

## Notes from an assistant

`pkgsight serve` also answers [MCP](https://modelcontextprotocol.io/) at `/mcp`. Through it, an assistant reads the module and writes notes. The browser shows each note as soon as it is written.

Connect Claude Code while `pkgsight serve` runs:

```bash
claude mcp add --transport http pkgsight http://localhost:7878/mcp
```

Then ask in your own words, such as *"Explain the flow from main in Japanese"*. Or run one of the prompts, which Claude Code offers as slash commands:

| Prompt | Writes notes for |
| --- | --- |
| `/mcp__pkgsight__explain_module <lang>` | Every package, and the entry points |
| `/mcp__pkgsight__explain_package <package> <lang>` | A package and its functions |
| `/mcp__pkgsight__explain_flow <function> <lang> [depth]` | The functions along the call flow from a function |

`<lang>` is a language tag, such as `ja` or `en`.

### What a note holds

| Part | For | Shown |
| --- | --- | --- |
| Summary | A package or a function | Under its name on the map, inside a package, and in the call flow |
| Doc | A package or a function | In place of the doc comment, with the original below |
| Body | A package or a function | In the panel |
| Line note | A line of a function or its doc comment | Above the line, without a line number of its own |

The doc, the body and line notes are [GitHub Flavored Markdown](https://github.github.com/gfm/) with HTML. Tables, `<details>`, images and alerts such as `> [!WARNING]` render as on GitHub. Go code blocks are highlighted like the source. Scripts are stripped. An image of the repository takes its path from the directory pkgsight runs in, such as `![The pipeline](docs/pipeline.png)`.

A line note can also take a kind. It then draws like a GitHub alert, with its color and icon.

| Kind | For |
| --- | --- |
| `note` | Background to know while reading the line |
| `tip` | A better way to use or change the code |
| `important` | What a reader must grasp to understand the function |
| `warning` | Something that breaks easily or surprises |
| `caution` | A real risk, such as data loss, a race or a security hole |

**Notes** in the toolbar picks the language to show, or turns notes off. It starts with your browser's language when there are notes in it.

### Where notes are kept

Each language has one file under the directory pkgsight runs in.

```
.pkgsight/notes/ja.json
.pkgsight/notes/en.json
```

> [!TIP]
> **Commit `.pkgsight/notes/`.** Everyone who runs pkgsight on the repository then reads the same notes.

A line note keeps its line by two things. One is its distance from the `func` keyword. The other is a hash of the line's text. Code added above the function does not move it. When the line itself changes, the note stays near its old place, marked **code changed**.

### The tools

An assistant uses these tools. You do not call them yourself.

| Tool | Does |
| --- | --- |
| `overview` | Lists the packages, their imports and the entry points |
| `package` | Describes one package: its doc comment, imports, importers and functions |
| `function` | Shows one function: its source with line numbers, its calls and its callers |
| `search` | Finds functions by name |
| `write_package_note` | Writes the note of a package |
| `write_function_note` | Writes the note of a function, with its line notes |
| `delete_notes` | Deletes notes of one language |

> [!NOTE]
> The MCP endpoint refuses writes from other web pages. A site you visit cannot change your notes through the server on your machine.

## What the analysis sees

pkgsight builds the call graph from the module's own code. It reads dependencies only for their types. This keeps memory low on large modules. The price is some calls it cannot see.

| Call | Seen |
| --- | --- |
| A call to a function or method of the module | Yes |
| A call through an interface, where the value is made in the module | Yes, to each type it can hold |
| A call through an interface, where the value comes from a dependency | As a guess, marked `iface?` |
| A function of the module handed to a library function, such as `slices.SortFunc` | Yes, tagged `via` with the library function |
| A call made inside a dependency | No |
| A call through reflection | No |

An entry point is a `main` function, or an exported function that nothing in the module calls. A function that only a library calls, such as a handler handed to a router, is not listed. Find it with the search box.

## Development

| Task | Command |
| --- | --- |
| Build the binary | `mise run build` |
| Run every test and lint | `mise run check` |
| Work on the UI with live reload | `pkgsight serve -open=false` in one terminal, and `pnpm --dir web dev` in another |

The dev server of the UI sends `/api` to `localhost:7878`. See [AGENTS.md](AGENTS.md) for how the code is laid out and what to keep.
