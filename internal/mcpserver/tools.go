//declscope:core

// Package mcpserver lets an assistant read the module and write notes over
// MCP. The notes show up in the browser next to the code.
package mcpserver

import (
	"context"
	"errors"
	"fmt"
	"go/parser"
	"go/token"
	"net/http"
	"path"
	"slices"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/mpyw/pkgsight/internal/callgraph"
	"github.com/mpyw/pkgsight/internal/model"
	"github.com/mpyw/pkgsight/internal/notes"
)

const instructions = `pkgsight draws a Go module as a package map and as call flows in the
browser. With these tools you read the module and write notes that pkgsight
shows next to the code, in the reader's language, for someone new to it.

Kinds of notes:
- A doc: the doc comment of a package or function, translated in full and
  faithfully into the reader's language. Write one whenever there is a doc
  comment and it is in another language. pkgsight shows it in place of the
  original, with the original below.
- A summary: one sentence for the map or the call flow. Say what the package
  or function is for, not how it works. Keep it short: about 40 characters in
  Japanese or Chinese, about 80 in English.
- A body: a few short paragraphs for the side panel, when the summary is not
  enough. Put identifiers in backticks.
- Line notes: shown above a line of a function or of its doc comment,
  without a line number of their own. Write one only where a reader would stop: what a branch means,
  why a goroutine or a defer, what an interface call reaches, how errors are
  handled, a trick that is not obvious. Never restate the code. Most
  functions need 0 to 5.
- A line note may take a kind, drawn like a GitHub alert. Leave it out for
  an ordinary explanation, which is most of them.
  - note: background a reader should know while reading the line.
  - tip: a better way to use or change the code.
  - important: what a reader must grasp to understand the function.
  - warning: something that breaks easily or surprises, to keep in mind
    when changing the code.
  - caution: a real risk: data loss, a race, a security hole.
- A body, a doc and a line note are GitHub Flavored Markdown, HTML
  included, as on GitHub: tables, lists, code blocks, <details>, and alerts
  as a blockquote that starts with "> [!WARNING]". An image of the
  repository takes its path from the module root, like
  ![the pipeline](docs/pipeline.png). Scripts are stripped. A summary is
  plain text.

How to work:
- Write every note in the language the user asks for, given as a BCP 47 tag
  such as "ja". Keep identifiers and code as they are.
- Read the callees before you summarize a caller.
- Writing a note replaces the earlier note of the same package or function.
- The browser shows each note as soon as you write it.`

// Backend is what the tools read and write.
type Backend struct {
	Graph *model.Graph
	Notes *notes.Store
	// Calls returns the call graph, or nil while it is building, and why it
	// failed if it did.
	Calls func() (*callgraph.Graph, error)
	// ReadSource reads a file of the module by its slash path from the root.
	ReadSource func(file string) ([]byte, error)
	// Version is the version of pkgsight that MCP reports.
	Version string
}

type tools struct{ Backend }

// Handler answers MCP over streamable HTTP.
func Handler(b Backend) http.Handler {
	s := &tools{b}
	m := mcp.NewServer(&mcp.Implementation{Name: "pkgsight", Version: b.Version}, &mcp.ServerOptions{Instructions: instructions})
	mcp.AddTool(m, &mcp.Tool{
		Name:        "overview",
		Description: "The module's own packages with their imports, the entry points of the call graph, and the languages that already have notes. Start here.",
	}, text(s.overview))
	mcp.AddTool(m, &mcp.Tool{
		Name:        "package",
		Description: "One package: its doc, imports, importers, files, and functions in source order with their IDs.",
	}, text(s.packageInfo))
	mcp.AddTool(m, &mcp.Tool{
		Name:        "function",
		Description: "One function by ID: its source with line numbers, the calls it makes with the line of each, and its callers.",
	}, text(s.function))
	mcp.AddTool(m, &mcp.Tool{
		Name:        "search",
		Description: "Find functions of the module by name, like \"Run\" or \"server.New\". Returns IDs for the other tools.",
	}, text(s.search))
	mcp.AddTool(m, &mcp.Tool{
		Name:        "write_package_note",
		Description: "Write the note of a package in one language, replacing the earlier one.",
	}, text(s.writePackageNote))
	mcp.AddTool(m, &mcp.Tool{
		Name:        "write_function_note",
		Description: "Write the note of a function in one language, replacing the earlier one: a summary, an optional body, and optional notes above lines of the function.",
	}, text(s.writeFunctionNote))
	mcp.AddTool(m, &mcp.Tool{
		Name:        "delete_notes",
		Description: "Delete notes of one language: of some packages, of some functions, or all of them.",
	}, text(s.deleteNotes))

	for _, p := range prompts {
		m.AddPrompt(p.prompt, p.handler)
	}
	h := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return m }, nil)
	// A page in the browser must not write notes through the reader's server.
	return http.NewCrossOriginProtection().Handler(h)
}

// text adapts a handler that answers in plain text, which reads better for
// a model than JSON.
func text[In any](h func(In) (string, error)) mcp.ToolHandlerFor[In, any] {
	return func(_ context.Context, _ *mcp.CallToolRequest, in In) (*mcp.CallToolResult, any, error) {
		out, err := h(in)
		if err != nil {
			return nil, nil, err
		}
		return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: out}}}, nil, nil
	}
}

var errBuilding = errors.New("the call graph is still building; try again in a few seconds")

func (s *tools) needCalls() (*callgraph.Graph, error) {
	g, err := s.Calls()
	switch {
	case err != nil:
		return nil, fmt.Errorf("the call graph failed: %w", err)
	case g == nil:
		return nil, errBuilding
	}
	return g, nil
}

func (s *tools) ownPackage(path string) (model.Package, bool) {
	for _, p := range s.Graph.Packages {
		if p.Path == path && p.Kind == model.KindOwn {
			return p, true
		}
	}
	return model.Package{}, false
}

func (s *tools) ownImports(p model.Package) []string {
	var out []string
	for _, i := range p.Imports {
		if _, ok := s.ownPackage(i); ok {
			out = append(out, i)
		}
	}
	return out
}

func (s *tools) importers(path string) []string {
	var out []string
	for _, p := range s.Graph.Packages {
		if p.Kind == model.KindOwn && slices.Contains(p.Imports, path) {
			out = append(out, p.Path)
		}
	}
	return out
}

type overviewIn struct{}

func (s *tools) overview(overviewIn) (string, error) {
	var b strings.Builder
	var mods []string
	for _, m := range s.Graph.Modules {
		if m.Main {
			mods = append(mods, m.Path)
		}
	}
	fmt.Fprintf(&b, "Module: %s\nRoot: %s\n", strings.Join(mods, ", "), s.Graph.Root)
	langs := s.Notes.Langs()
	if len(langs) == 0 {
		b.WriteString("Notes: none yet\n")
	}
	for _, l := range langs {
		book := s.Notes.Book(l)
		fmt.Fprintf(&b, "Notes in %s: %d packages, %d functions\n", l, len(book.Packages), len(book.Funcs))
	}
	g, _ := s.Calls()
	b.WriteString("\nPackages:\n")
	for _, p := range s.Graph.Packages {
		if p.Kind != model.KindOwn {
			continue
		}
		fmt.Fprintf(&b, "- %s (package %s)", p.Path, p.Name)
		if g != nil {
			fmt.Fprintf(&b, ", %d functions", len(g.Package(p.Path)))
		}
		b.WriteString("\n")
		if p.Doc != "" {
			fmt.Fprintf(&b, "  doc: %s\n", p.Doc)
		}
		if imps := s.ownImports(p); len(imps) > 0 {
			fmt.Fprintf(&b, "  imports: %s\n", strings.Join(imps, ", "))
		}
	}
	if g == nil {
		b.WriteString("\nEntry points: " + errBuilding.Error() + "\n")
		return b.String(), nil
	}
	b.WriteString("\nEntry points:\n")
	for _, e := range g.Entries() {
		fmt.Fprintf(&b, "- %s (%s)\n", e.ID, e.Reason)
	}
	return b.String(), nil
}

type packageIn struct {
	Path string `json:"path" jsonschema:"the import path of a package of the module"`
	Lang string `json:"lang,omitempty" jsonschema:"show the notes of this language too, like \"ja\""`
}

func (s *tools) packageInfo(in packageIn) (string, error) {
	p, ok := s.ownPackage(in.Path)
	if !ok {
		return "", fmt.Errorf("%q is not a package of the module; see the overview tool", in.Path)
	}
	var b strings.Builder
	fmt.Fprintf(&b, "Package %s (package %s)\nDirectory: %s\n", p.Path, p.Name, p.Dir)
	if doc := s.packageDoc(p); doc != "" {
		fmt.Fprintf(&b, "Doc comment:\n%s\n", indentText(doc))
	}
	var book notes.Book
	if in.Lang != "" {
		book = s.Notes.Book(in.Lang)
		if n, ok := book.Packages[p.Path]; ok {
			writeNote(&b, in.Lang, n)
		}
	}
	fmt.Fprintf(&b, "Imports: %s\n", list(p.Imports))
	fmt.Fprintf(&b, "Imported by: %s\n", list(s.importers(p.Path)))
	fmt.Fprintf(&b, "Files: %s\n", list(p.Files))
	g, err := s.needCalls()
	if err != nil {
		fmt.Fprintf(&b, "Functions: %v\n", err)
		return b.String(), nil
	}
	b.WriteString("\nFunctions in source order:\n")
	for _, f := range g.Package(p.Path) {
		own := 0
		for _, c := range f.Calls {
			if c.To.Kind == model.KindOwn {
				own++
			}
		}
		fmt.Fprintf(&b, "- %s\n  id: %s, %s:%d-%d, %d calls into the module, %d callers\n", f.Name, f.ID, f.File, f.Line, f.EndLine, own, len(f.Callers))
		if f.Doc != "" {
			fmt.Fprintf(&b, "  doc: %s\n", f.Doc)
		}
		if n, ok := book.Funcs[f.ID]; ok && n.Summary != "" {
			fmt.Fprintf(&b, "  note: %s\n", n.Summary)
		}
	}
	return b.String(), nil
}

type functionIn struct {
	ID   string `json:"id" jsonschema:"the function ID, from the package or search tool"`
	Lang string `json:"lang,omitempty" jsonschema:"show the notes of this language too, like \"ja\""`
}

func (s *tools) function(in functionIn) (string, error) {
	g, err := s.needCalls()
	if err != nil {
		return "", err
	}
	d, ok := g.Func(in.ID)
	if !ok {
		return "", fmt.Errorf("no function has the ID %q; use the search tool", in.ID)
	}
	var b strings.Builder
	fmt.Fprintf(&b, "Function %s in %s\nID: %s\n", d.Name, d.Pkg, d.ID)
	if d.Doc != "" {
		fmt.Fprintf(&b, "Doc: %s\n", d.Doc)
	}
	var book notes.Book
	if in.Lang != "" {
		book = s.Notes.Book(in.Lang)
	}
	if d.File != "" {
		src, err := s.ReadSource(d.File)
		if err != nil {
			return "", err
		}
		lines := strings.Split(string(src), "\n")
		var placed map[int][]notes.Resolved
		if n, ok := book.Funcs[d.ID]; ok {
			writeNote(&b, in.Lang, n.Note)
			placed = map[int][]notes.Resolved{}
			for _, r := range notes.Place(n, lines, d.Line, d.FirstLine(), d.EndLine) {
				placed[r.Line] = append(placed[r.Line], r)
			}
		}
		fmt.Fprintf(&b, "\nSource with the doc comment, %s lines %d-%d", d.File, d.FirstLine(), d.EndLine)
		if placed != nil {
			b.WriteString(", with the line notes as >> above their lines")
		}
		b.WriteString(":\n")
		for n := d.FirstLine(); n <= d.EndLine && n <= len(lines); n++ {
			for _, r := range placed[n] {
				stale := ""
				if r.Stale {
					stale = " (stale: the line changed)"
				}
				kind := ""
				if r.Kind != "" {
					kind = "[" + strings.ToUpper(string(r.Kind)) + "] "
				}
				fmt.Fprintf(&b, "     >> %s%s%s\n", kind, r.Text, stale)
			}
			fmt.Fprintf(&b, "%5d  %s\n", n, lines[n-1])
		}
	} else {
		b.WriteString("Outside the module: no source.\n")
	}
	b.WriteString("\nCalls, in order of the first call site:\n")
	if len(d.Calls) == 0 {
		b.WriteString("- none\n")
	}
	for _, c := range d.Calls {
		fmt.Fprintf(&b, "- line %s: %s.%s", joinInts(c.Lines), c.To.PkgName, c.To.Name)
		var tags []string
		if c.Mode != model.ModeCall {
			tags = append(tags, string(c.Mode))
		}
		if c.Dispatch != model.DispatchStatic {
			tags = append(tags, "via "+string(c.Dispatch))
		}
		if c.Maybe {
			tags = append(tags, "guessed from the types")
		}
		if c.Through != "" {
			tags = append(tags, "handed to "+c.Through)
		}
		if len(tags) > 0 {
			fmt.Fprintf(&b, " (%s)", strings.Join(tags, ", "))
		}
		if c.To.Kind == model.KindOwn {
			fmt.Fprintf(&b, "\n  id: %s", c.To.ID)
			if n, ok := book.Funcs[c.To.ID]; ok && n.Summary != "" {
				fmt.Fprintf(&b, "\n  note: %s", n.Summary)
			}
		}
		b.WriteString("\n")
	}
	b.WriteString("\nCalled by:\n")
	if len(d.Callers) == 0 {
		b.WriteString("- nothing in the module\n")
	}
	for _, c := range d.Callers {
		fmt.Fprintf(&b, "- %s.%s (id: %s)\n", c.PkgName, c.Name, c.ID)
	}
	return b.String(), nil
}

type searchIn struct {
	Query string `json:"query" jsonschema:"part of a function name, optionally after the package name, like \"server.New\""`
}

func (s *tools) search(in searchIn) (string, error) {
	g, err := s.needCalls()
	if err != nil {
		return "", err
	}
	hits := g.Search(in.Query, 30)
	if len(hits) == 0 {
		return "No function matches.", nil
	}
	var b strings.Builder
	for _, f := range hits {
		fmt.Fprintf(&b, "- %s.%s (id: %s) %s:%d\n", f.PkgName, f.Name, f.ID, f.File, f.Line)
	}
	return b.String(), nil
}

type packageNoteIn struct {
	Lang    string `json:"lang" jsonschema:"the language of the note as a BCP 47 tag, like \"ja\""`
	Path    string `json:"path" jsonschema:"the import path of the package"`
	Summary string `json:"summary" jsonschema:"one sentence on what the package is for"`
	Doc     string `json:"doc,omitempty" jsonschema:"the package doc comment, translated in full"`
	Body    string `json:"body,omitempty" jsonschema:"a longer explanation in a few short paragraphs"`
}

func (s *tools) writePackageNote(in packageNoteIn) (string, error) {
	if _, ok := s.ownPackage(in.Path); !ok {
		return "", fmt.Errorf("%q is not a package of the module", in.Path)
	}
	err := s.Notes.Update(in.Lang, func(b *notes.Book) {
		b.Packages[in.Path] = notes.Note{Summary: in.Summary, Doc: in.Doc, Body: in.Body}
	})
	if err != nil {
		return "", err
	}
	return "Saved the note of " + in.Path + ".", nil
}

type lineIn struct {
	Line int    `json:"line" jsonschema:"the line number in the file, as the function tool shows it"`
	Text string `json:"text" jsonschema:"the note, shown above the line"`
	Kind string `json:"kind,omitempty" jsonschema:"draw the note as a GitHub alert: note, tip, important, warning or caution"`
}

type functionNoteIn struct {
	Lang    string   `json:"lang" jsonschema:"the language of the note as a BCP 47 tag, like \"ja\""`
	ID      string   `json:"id" jsonschema:"the function ID"`
	Summary string   `json:"summary" jsonschema:"one sentence on what the function is for"`
	Doc     string   `json:"doc,omitempty" jsonschema:"the doc comment, translated in full"`
	Body    string   `json:"body,omitempty" jsonschema:"a longer explanation in a few short paragraphs"`
	Lines   []lineIn `json:"lines,omitempty" jsonschema:"notes above lines of the function or its doc comment"`
}

func (s *tools) writeFunctionNote(in functionNoteIn) (string, error) {
	g, err := s.needCalls()
	if err != nil {
		return "", err
	}
	d, ok := g.Func(in.ID)
	if !ok || d.File == "" {
		return "", fmt.Errorf("%q is not a function of the module; use the search tool", in.ID)
	}
	src, err := s.ReadSource(d.File)
	if err != nil {
		return "", err
	}
	lines := strings.Split(string(src), "\n")
	n := notes.FuncNote{Note: notes.Note{Summary: in.Summary, Doc: in.Doc, Body: in.Body}}
	for _, l := range in.Lines {
		if l.Line < d.FirstLine() || l.Line > d.EndLine || l.Line > len(lines) {
			return "", fmt.Errorf("line %d is outside the function, which spans lines %d-%d with its doc comment", l.Line, d.FirstLine(), d.EndLine)
		}
		kind := notes.Kind(strings.ToLower(l.Kind))
		if kind != "" && !slices.Contains(notes.Kinds, kind) {
			return "", fmt.Errorf("line %d: kind %q is not one of %v", l.Line, l.Kind, notes.Kinds)
		}
		n.Lines = append(n.Lines, notes.LineNote{Offset: l.Line - d.Line, Hash: notes.HashLine(lines[l.Line-1]), Text: l.Text, Kind: kind})
	}
	slices.SortStableFunc(n.Lines, func(a, b notes.LineNote) int { return a.Offset - b.Offset })
	if err := s.Notes.Update(in.Lang, func(b *notes.Book) { b.Funcs[in.ID] = n }); err != nil {
		return "", err
	}
	return fmt.Sprintf("Saved the note of %s with %d line notes.", d.Name, len(n.Lines)), nil
}

type deleteIn struct {
	Lang      string   `json:"lang" jsonschema:"the language, like \"ja\""`
	Packages  []string `json:"packages,omitempty" jsonschema:"import paths whose notes to delete"`
	Functions []string `json:"functions,omitempty" jsonschema:"function IDs whose notes to delete"`
	All       bool     `json:"all,omitempty" jsonschema:"delete every note of the language"`
}

func (s *tools) deleteNotes(in deleteIn) (string, error) {
	removed := 0
	err := s.Notes.Update(in.Lang, func(b *notes.Book) {
		if in.All {
			removed = len(b.Packages) + len(b.Funcs)
			clear(b.Packages)
			clear(b.Funcs)
			return
		}
		for _, p := range in.Packages {
			if _, ok := b.Packages[p]; ok {
				delete(b.Packages, p)
				removed++
			}
		}
		for _, f := range in.Functions {
			if _, ok := b.Funcs[f]; ok {
				delete(b.Funcs, f)
				removed++
			}
		}
	})
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("Deleted %d notes.", removed), nil
}

// packageDoc reads the package comment from the files of p. The graph
// keeps only its first sentence.
func (s *tools) packageDoc(p model.Package) string {
	var docs []string
	for _, f := range p.Files {
		src, err := s.ReadSource(path.Join(p.Dir, f))
		if err != nil {
			continue
		}
		file, err := parser.ParseFile(token.NewFileSet(), f, src, parser.PackageClauseOnly|parser.ParseComments)
		if err == nil && file.Doc != nil {
			docs = append(docs, strings.TrimSpace(file.Doc.Text()))
		}
	}
	return strings.Join(docs, "\n\n")
}

func writeNote(b *strings.Builder, lang string, n notes.Note) {
	fmt.Fprintf(b, "Note (%s): %s\n", lang, n.Summary)
	if n.Doc != "" {
		fmt.Fprintf(b, "Translated doc comment:\n%s\n", indentText(n.Doc))
	}
	if n.Body != "" {
		fmt.Fprintf(b, "Body:\n%s\n", indentText(n.Body))
	}
}

func indentText(s string) string {
	return "  " + strings.ReplaceAll(s, "\n", "\n  ")
}

func list(s []string) string {
	if len(s) == 0 {
		return "none"
	}
	return strings.Join(s, ", ")
}

func joinInts(ns []int) string {
	s := make([]string, len(ns))
	for i, n := range ns {
		s[i] = fmt.Sprint(n)
	}
	return strings.Join(s, ", ")
}
