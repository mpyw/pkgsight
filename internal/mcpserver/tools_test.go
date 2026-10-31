package mcpserver_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/mpyw/pkgsight/internal/callgraph"
	"github.com/mpyw/pkgsight/internal/load"
	"github.com/mpyw/pkgsight/internal/mcpserver"
	"github.com/mpyw/pkgsight/internal/notes"
)

const sample = "../callgraph/testdata/sample"

// session is a client connected to a handler over the sample module.
type session struct {
	cs    *mcp.ClientSession
	notes *notes.Store
	// calls is what the backend answers for the call graph.
	calls func() (*callgraph.Graph, error)
}

func connect(t *testing.T, dir string) *session {
	t.Helper()
	g, err := load.Graph(context.Background(), dir, "./...")
	if err != nil {
		t.Fatal(err)
	}
	calls, err := callgraph.Build(context.Background(), dir, "./...")
	if err != nil {
		t.Fatal(err)
	}
	store, err := notes.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	s := &session{notes: store, calls: func() (*callgraph.Graph, error) { return calls, nil }}
	h := mcpserver.Handler(mcpserver.Backend{
		Graph: g,
		Notes: store,
		Calls: func() (*callgraph.Graph, error) { return s.calls() },
		ReadSource: func(file string) ([]byte, error) {
			return os.ReadFile(filepath.Join(g.Root, filepath.FromSlash(file)))
		},
		Version: "1.2.3",
	})
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	client := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "0"}, nil)
	cs, err := client.Connect(context.Background(), &mcp.StreamableClientTransport{Endpoint: srv.URL}, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cs.Close() })
	s.cs = cs
	return s
}

// call returns the text a tool answers, and whether it is an error.
func (s *session) call(t *testing.T, name string, args map[string]any) (string, bool) {
	t.Helper()
	res, err := s.cs.CallTool(context.Background(), &mcp.CallToolParams{Name: name, Arguments: args})
	if err != nil {
		t.Fatal(err)
	}
	return res.Content[0].(*mcp.TextContent).Text, res.IsError
}

// ok calls a tool that must succeed, and checks its text has each of want.
func (s *session) ok(t *testing.T, name string, args map[string]any, want ...string) string {
	t.Helper()
	text, isErr := s.call(t, name, args)
	if isErr {
		t.Fatalf("%s failed: %s", name, text)
	}
	for _, w := range want {
		if !strings.Contains(text, w) {
			t.Errorf("%s answered without %q:\n%s", name, w, text)
		}
	}
	return text
}

// fails calls a tool that must fail with an error containing want.
func (s *session) fails(t *testing.T, name string, args map[string]any, want string) {
	t.Helper()
	text, isErr := s.call(t, name, args)
	if !isErr || !strings.Contains(text, want) {
		t.Errorf("%s = %q (error %v), want an error with %q", name, text, isErr, want)
	}
}

const (
	run    = "example.com/sample/app.Run"
	appPkg = "example.com/sample/app"
)

func TestServerInfo(t *testing.T) {
	s := connect(t, sample)
	if info := s.cs.InitializeResult().ServerInfo; info.Name != "pkgsight" || info.Version != "1.2.3" {
		t.Errorf("server info = %+v", info)
	}
	if !strings.Contains(s.cs.InitializeResult().Instructions, "GitHub Flavored Markdown") {
		t.Error("the instructions do not explain the note format")
	}
	tools, err := s.cs.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, tool := range tools.Tools {
		names = append(names, tool.Name)
	}
	slices.Sort(names)
	want := []string{"delete_notes", "function", "overview", "package", "search", "stale_notes", "write_function_note", "write_package_note"}
	if !slices.Equal(names, want) {
		t.Errorf("tools = %v, want %v", names, want)
	}
}

func TestPrompts(t *testing.T) {
	s := connect(t, sample)
	tests := []struct {
		name string
		args map[string]string
		want []string
	}{
		{"explain_module", map[string]string{"lang": "ja"}, []string{`"ja"`, "overview"}},
		{"explain_package", map[string]string{"package": "app", "lang": "en"}, []string{`"en"`, `"app"`}},
		{"explain_flow", map[string]string{"function": "main", "lang": "ja"}, []string{`"main"`, "up to 3 levels"}},
		{"explain_flow", map[string]string{"function": "main", "lang": "ja", "depth": "5"}, []string{"up to 5 levels"}},
		{"refresh_notes", map[string]string{"lang": "ja"}, []string{`"ja"`, "stale_notes", "delete_notes"}},
	}
	for _, tt := range tests {
		res, err := s.cs.GetPrompt(context.Background(), &mcp.GetPromptParams{Name: tt.name, Arguments: tt.args})
		if err != nil {
			t.Fatalf("%s: %v", tt.name, err)
		}
		text := res.Messages[0].Content.(*mcp.TextContent).Text
		for _, w := range tt.want {
			if !strings.Contains(text, w) {
				t.Errorf("%s %v has no %q:\n%s", tt.name, tt.args, w, text)
			}
		}
	}
}

func TestOverview(t *testing.T) {
	s := connect(t, sample)
	s.ok(t, "overview", nil,
		"Module: example.com/sample",
		"Notes: none yet",
		"- example.com/sample/app (package app), 8 functions",
		"doc: Package app wires the store to the outside world.",
		"imports: example.com/sample/app/store",
		"- example.com/sample/cmd/sample.main (main)",
	)
	if err := s.notes.Update("ja", func(b *notes.Book) { b.Packages[appPkg] = notes.Note{Summary: "x"} }); err != nil {
		t.Fatal(err)
	}
	s.ok(t, "overview", nil, "Notes in ja: 1 packages, 0 functions")

	s.calls = func() (*callgraph.Graph, error) { return nil, nil }
	text := s.ok(t, "overview", nil, "Entry points: the call graph is still building")
	if strings.Contains(text, ", 8 functions") {
		t.Errorf("counted functions without a call graph:\n%s", text)
	}
}

func TestOverviewNamesSkippedPackages(t *testing.T) {
	s := connect(t, "../callgraph/testdata/broken")
	s.ok(t, "overview", nil, "Left out of the call graph", "example.com/broken: ")
}

func TestPackage(t *testing.T) {
	s := connect(t, sample)
	s.fails(t, "package", map[string]any{"path": "fmt"}, "not a package of the module")

	err := s.notes.Update("ja", func(b *notes.Book) {
		b.Packages[appPkg] = notes.Note{Summary: "入口", Doc: "訳", Body: "本文"}
		b.Funcs[run] = notes.FuncNote{Note: notes.Note{Summary: "表示する"}}
	})
	if err != nil {
		t.Fatal(err)
	}
	s.ok(t, "package", map[string]any{"path": appPkg, "lang": "ja"},
		"Package example.com/sample/app (package app)",
		"Doc comment:\n  Package app wires the store to the outside world.",
		// Written without a fingerprint, so it cannot be shown to hold.
		"Note (ja, stale: the code changed since it was written): 入口",
		"Translated doc comment:\n  訳",
		"Body:\n  本文",
		"Imported by: example.com/sample/cmd/sample",
		"- Run\n  id: example.com/sample/app.Run, app/app.go:19-29, 3 calls into the module, 1 callers",
		"note: 表示する",
	)

	s.calls = func() (*callgraph.Graph, error) { return nil, errors.New("boom") }
	s.ok(t, "package", map[string]any{"path": appPkg}, "Functions: the call graph failed: boom")
}

func TestPackageDocSkipsUnreadableFiles(t *testing.T) {
	dir := t.TempDir()
	if err := os.CopyFS(dir, os.DirFS(sample)); err != nil {
		t.Fatal(err)
	}
	s := connect(t, dir)
	// The package was loaded with app.go, which is gone now.
	if err := os.Remove(filepath.Join(dir, "app", "app.go")); err != nil {
		t.Fatal(err)
	}
	text := s.ok(t, "package", map[string]any{"path": appPkg})
	if strings.Contains(text, "Doc comment:") {
		t.Errorf("a doc comment from a file that is gone:\n%s", text)
	}
}

func TestFunction(t *testing.T) {
	s := connect(t, sample)
	s.fails(t, "function", map[string]any{"id": "nope"}, "use the search tool")
	s.ok(t, "function", map[string]any{"id": run},
		"Function Run in example.com/sample/app",
		"Doc: Run prints what the store holds.",
		"Source with the doc comment, app/app.go lines 18-29:\n   18  // Run prints",
		"- line 21: app.cleanup (defer)\n  id: example.com/sample/app.cleanup",
		"- line 23: app.Run$1 (go)",
		"Called by:\n- main.main (id: example.com/sample/cmd/sample.main)",
	)
	s.ok(t, "function", map[string]any{"id": "example.com/sample/app.Unused"}, "Called by:\n- nothing in the module")
	s.ok(t, "function", map[string]any{"id": "example.com/sample/app.work"},
		"(english).Greet (via interface)",
		"Called by:\n- app.Run$1",
	)
	s.ok(t, "function", map[string]any{"id": "example.com/sample/app.Spawn"},
		"(go, via dynamic, handed to sync.(*WaitGroup).Go)",
	)
	s.ok(t, "function", map[string]any{"id": "example.com/sample/app.cleanup"}, "Calls, in order of the first call site:\n- none")

	s.calls = func() (*callgraph.Graph, error) { return nil, nil }
	s.fails(t, "function", map[string]any{"id": run}, "still building")
}

func TestFunctionMissingSource(t *testing.T) {
	dir := t.TempDir()
	if err := os.CopyFS(dir, os.DirFS(sample)); err != nil {
		t.Fatal(err)
	}
	s := connect(t, dir)
	if err := os.Remove(filepath.Join(dir, "app", "app.go")); err != nil {
		t.Fatal(err)
	}
	s.fails(t, "function", map[string]any{"id": run}, "app.go")
}

func TestWriteAndReadFunctionNotes(t *testing.T) {
	s := connect(t, sample)
	s.ok(t, "write_function_note", map[string]any{
		"lang":    "ja",
		"id":      run,
		"summary": "表示する",
		"doc":     "Run はストアの中身を表示する。",
		"body":    "本文",
		"lines": []map[string]any{
			{"line": 23, "text": "別の goroutine", "kind": "WARNING"},
			{"line": 18, "text": "doc の行"},
		},
	}, "Saved the note of Run with 2 line notes.")

	book := s.notes.Book("ja")
	lines := book.Funcs[run].Lines
	// Sorted by offset, the doc comment line first, the kind in lower case.
	if len(lines) != 2 || lines[0].Offset != -1 || lines[1].Offset != 4 || lines[1].Kind != notes.KindWarning {
		t.Errorf("lines = %+v", lines)
	}

	s.ok(t, "function", map[string]any{"id": run, "lang": "ja"},
		"Note (ja): 表示する",
		"Translated doc comment:\n  Run はストアの中身を表示する。",
		"Body:\n  本文",
		"with the line notes as >> above their lines",
		"     >> doc の行\n   18  // Run prints",
		"     >> [WARNING] 別の goroutine\n   23",
	)
	// A caller shows the summary of the function it calls.
	s.ok(t, "function", map[string]any{"id": "example.com/sample/cmd/sample.main", "lang": "ja"}, "note: 表示する")
}

func TestStaleLineNote(t *testing.T) {
	dir := t.TempDir()
	if err := os.CopyFS(dir, os.DirFS(sample)); err != nil {
		t.Fatal(err)
	}
	s := connect(t, dir)
	s.ok(t, "write_function_note", map[string]any{
		"lang": "ja", "id": run, "summary": "s",
		"lines": []map[string]any{{"line": 27, "text": "待つ"}},
	})
	file := filepath.Join(dir, "app", "app.go")
	src, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, []byte(strings.Replace(string(src), "wg.Wait()", "wg.Wait() // changed", 1)), 0o644); err != nil {
		t.Fatal(err)
	}
	s.ok(t, "function", map[string]any{"id": run, "lang": "ja"}, ">> 待つ (stale: the line changed)")
}

func TestWriteFunctionNoteRejects(t *testing.T) {
	s := connect(t, sample)
	note := func(id string, lines ...map[string]any) map[string]any {
		return map[string]any{"lang": "ja", "id": id, "summary": "s", "lines": lines}
	}
	s.fails(t, "write_function_note", note("nope"), "not a function of the module")
	s.fails(t, "write_function_note", note(run, map[string]any{"line": 30, "text": "x"}), "spans lines 18-29")
	s.fails(t, "write_function_note", note(run, map[string]any{"line": 17, "text": "x"}), "spans lines 18-29")
	s.fails(t, "write_function_note", note(run, map[string]any{"line": 19, "text": "x", "kind": "danger"}), `kind "danger" is not one of`)
	s.fails(t, "write_function_note", map[string]any{"lang": "../x", "id": run, "summary": "s"}, "not a language tag")
	if langs := s.notes.Langs(); len(langs) != 0 {
		t.Errorf("a rejected note was saved: %v", langs)
	}

	s.calls = func() (*callgraph.Graph, error) { return nil, nil }
	s.fails(t, "write_function_note", note(run), "still building")
}

func TestPackageNotes(t *testing.T) {
	s := connect(t, sample)
	s.fails(t, "write_package_note", map[string]any{"lang": "ja", "path": "fmt", "summary": "s"}, "not a package of the module")
	s.fails(t, "write_package_note", map[string]any{"lang": "", "path": appPkg, "summary": "s"}, "not a language tag")
	s.ok(t, "write_package_note", map[string]any{"lang": "ja", "path": appPkg, "summary": "s", "doc": "d", "body": "b"}, "Saved the note of example.com/sample/app.")
	got := s.notes.Book("ja").Packages[appPkg]
	if got.Summary != "s" || got.Doc != "d" || got.Body != "b" || got.Fingerprint == "" {
		t.Errorf("note = %+v", got)
	}
	s.ok(t, "package", map[string]any{"path": appPkg, "lang": "ja"}, "Note (ja): s")

	s.calls = func() (*callgraph.Graph, error) { return nil, nil }
	s.fails(t, "write_package_note", map[string]any{"lang": "ja", "path": appPkg, "summary": "s"}, "still building")
}

func TestDeleteNotes(t *testing.T) {
	s := connect(t, sample)
	s.ok(t, "write_package_note", map[string]any{"lang": "ja", "path": appPkg, "summary": "s"})
	s.ok(t, "write_function_note", map[string]any{"lang": "ja", "id": run, "summary": "s"})
	s.ok(t, "delete_notes", map[string]any{"lang": "ja", "packages": []string{appPkg, "gone"}, "functions": []string{"gone"}}, "Deleted 1 notes.")
	s.ok(t, "write_package_note", map[string]any{"lang": "ja", "path": appPkg, "summary": "s"})
	s.ok(t, "delete_notes", map[string]any{"lang": "ja", "all": true}, "Deleted 2 notes.")
	if langs := s.notes.Langs(); len(langs) != 0 {
		t.Errorf("Langs after deleting all = %v", langs)
	}
	s.fails(t, "delete_notes", map[string]any{"lang": "no/pe", "all": true}, "not a language tag")
}

func TestSearch(t *testing.T) {
	s := connect(t, sample)
	s.ok(t, "search", map[string]any{"query": "app.run"}, "- app.Run (id: example.com/sample/app.Run) app/app.go:19")
	s.ok(t, "search", map[string]any{"query": "zzz"}, "No function matches.")
	s.calls = func() (*callgraph.Graph, error) { return nil, nil }
	s.fails(t, "search", map[string]any{"query": "run"}, "still building")
}

func TestRefusesCrossOriginWrites(t *testing.T) {
	h := mcpserver.Handler(mcpserver.Backend{Version: "test"})
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader("{}"))
	req.Header.Set("Sec-Fetch-Site", "cross-site")
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("status = %d, want 403", rec.Code)
	}
}

func TestFunctionShowsGuesses(t *testing.T) {
	s := connect(t, "../callgraph/testdata/edges")
	s.ok(t, "function", map[string]any{"id": "example.com/edges.Guess"}, "(sink).Write (via interface, guessed from the types)")
}

func TestWriteFunctionNoteMissingSource(t *testing.T) {
	dir := t.TempDir()
	if err := os.CopyFS(dir, os.DirFS(sample)); err != nil {
		t.Fatal(err)
	}
	s := connect(t, dir)
	if err := os.Remove(filepath.Join(dir, "app", "app.go")); err != nil {
		t.Fatal(err)
	}
	s.fails(t, "write_function_note", map[string]any{"lang": "ja", "id": run, "summary": "s"}, "app.go")
}

func TestDeleteFunctionNotes(t *testing.T) {
	s := connect(t, sample)
	s.ok(t, "write_function_note", map[string]any{"lang": "ja", "id": run, "summary": "s"})
	s.ok(t, "delete_notes", map[string]any{"lang": "ja", "functions": []string{run}}, "Deleted 1 notes.")
}

func TestPackageWithoutImports(t *testing.T) {
	s := connect(t, "../callgraph/testdata/broken")
	s.ok(t, "package", map[string]any{"path": "example.com/broken"}, "Imports: none", "Imported by: none")
}

func TestStaleNotes(t *testing.T) {
	dir := t.TempDir()
	if err := os.CopyFS(dir, os.DirFS(sample)); err != nil {
		t.Fatal(err)
	}
	s := connect(t, dir)
	s.ok(t, "write_function_note", map[string]any{"lang": "ja", "id": run, "summary": "s"})
	s.ok(t, "write_package_note", map[string]any{"lang": "ja", "path": appPkg, "summary": "s"})
	s.ok(t, "stale_notes", map[string]any{"lang": "ja"}, "Every note in ja is fresh.")
	s.ok(t, "function", map[string]any{"id": run, "lang": "ja"}, "Note (ja): s")

	// The body of Run changes, and a note of a function that is gone stays.
	file := filepath.Join(dir, "app", "app.go")
	src, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, []byte(strings.Replace(string(src), "wg.Add(1)", "wg.Add(2)", 1)), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := s.notes.Update("ja", func(b *notes.Book) { b.Funcs["example.com/sample/app.Gone"] = notes.FuncNote{} }); err != nil {
		t.Fatal(err)
	}
	s.ok(t, "stale_notes", map[string]any{"lang": "ja"},
		"- orphaned function example.com/sample/app.Gone: it is gone or renamed, so delete its note",
		"- stale function example.com/sample/app.Run: read it again and rewrite its note",
	)
	s.ok(t, "function", map[string]any{"id": run, "lang": "ja"}, "Note (ja, stale: the code changed since it was written): s")
	s.ok(t, "overview", nil, "Notes in ja: 1 packages, 2 functions, 2 stale or orphaned (see stale_notes)")

	s.calls = func() (*callgraph.Graph, error) { return nil, nil }
	s.fails(t, "stale_notes", map[string]any{"lang": "ja"}, "still building")
	// Without a call graph, a package note cannot be checked, so it says nothing.
	s.ok(t, "package", map[string]any{"path": appPkg, "lang": "ja"}, "Note (ja): s")
}
