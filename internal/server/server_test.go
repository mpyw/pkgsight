package server_test

import (
	"bufio"
	"context"
	"encoding/json/v2"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/mpyw/pkgsight/internal/callgraph"
	"github.com/mpyw/pkgsight/internal/freshness"
	"github.com/mpyw/pkgsight/internal/load"
	"github.com/mpyw/pkgsight/internal/model"
	"github.com/mpyw/pkgsight/internal/notes"
	"github.com/mpyw/pkgsight/internal/server"
)

func TestServer(t *testing.T) {
	g := &model.Graph{Root: "/r", Packages: []model.Package{{Path: "a", Kind: model.KindOwn}}}
	assets := fstest.MapFS{
		"index.html":    {Data: []byte("<html>app</html>")},
		"assets/app.js": {Data: []byte("js")},
	}
	srv := httptest.NewServer(server.New(g, assets, openNotes(t), "test"))
	defer srv.Close()

	var got model.Graph
	if err := json.Unmarshal([]byte(get(t, srv.URL+"/api/graph", http.StatusOK)), &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Packages) != 1 || got.Packages[0].Path != "a" {
		t.Errorf("graph = %+v", got)
	}
	if body := get(t, srv.URL+"/assets/app.js", http.StatusOK); body != "js" {
		t.Errorf("asset = %q", body)
	}
	if body := get(t, srv.URL+"/pkg/a", http.StatusOK); !strings.Contains(body, "app") {
		t.Errorf("fallback = %q", body)
	}
}

func TestCalls(t *testing.T) {
	root, err := filepath.Abs("../callgraph/testdata/sample")
	if err != nil {
		t.Fatal(err)
	}
	g := &model.Graph{Root: root, Packages: []model.Package{{Path: "example.com/sample/app", Kind: model.KindOwn, Dir: "app", Files: []string{"app.go"}}}}
	s := server.New(g, fstest.MapFS{}, openNotes(t), "test")
	srv := httptest.NewServer(s)
	defer srv.Close()

	get(t, srv.URL+"/api/calls/entries", http.StatusServiceUnavailable)
	if body := get(t, srv.URL+"/api/calls/status", http.StatusOK); !strings.Contains(body, `"pending"`) {
		t.Errorf("status = %s", body)
	}

	calls, err := callgraph.Build(context.Background(), root, "./...")
	if err != nil {
		t.Fatal(err)
	}
	s.SetCalls(calls, nil, time.Second)

	if body := get(t, srv.URL+"/api/calls/status", http.StatusOK); !strings.Contains(body, `"ready"`) {
		t.Errorf("status = %s", body)
	}
	var run model.FuncDetail
	body := get(t, srv.URL+"/api/calls/func?id="+url.QueryEscape("example.com/sample/app.Run"), http.StatusOK)
	if err := json.Unmarshal([]byte(body), &run); err != nil || run.Name != "Run" {
		t.Errorf("func = %s (%v)", body, err)
	}
	get(t, srv.URL+"/api/calls/func?id=nope", http.StatusNotFound)
	if body := get(t, srv.URL+"/api/source?file=app/app.go", http.StatusOK); !strings.Contains(body, "func Run()") {
		t.Errorf("source = %q", body)
	}
	get(t, srv.URL+"/api/source?file=../../../go.mod", http.StatusNotFound)

	if body := get(t, srv.URL+"/api/asset?path=docs/arch.svg", http.StatusOK); !strings.Contains(body, "<svg") {
		t.Errorf("asset = %q", body)
	}
	for _, p := range []string{"go.mod", "../sample/docs/arch.svg", "/etc/hosts.png", "docs/missing.png"} {
		get(t, srv.URL+"/api/asset?path="+url.QueryEscape(p), http.StatusNotFound)
	}
}

func TestNotesOverMCP(t *testing.T) {
	root, err := filepath.Abs("../callgraph/testdata/sample")
	if err != nil {
		t.Fatal(err)
	}
	g := &model.Graph{Root: root, Packages: []model.Package{{Path: "example.com/sample/app", Kind: model.KindOwn, Dir: "app", Files: []string{"app.go"}}}}
	s := server.New(g, fstest.MapFS{}, openNotes(t), "test")
	calls, err := callgraph.Build(context.Background(), root, "./...")
	if err != nil {
		t.Fatal(err)
	}
	s.SetCalls(calls, nil, time.Second)
	srv := httptest.NewServer(s)
	defer srv.Close()

	ctx := context.Background()
	client := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "0"}, nil)
	cs, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: srv.URL + "/mcp"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = cs.Close() }()

	call := func(name string, args map[string]any) string {
		t.Helper()
		res, err := cs.CallTool(ctx, &mcp.CallToolParams{Name: name, Arguments: args})
		if err != nil {
			t.Fatal(err)
		}
		text := res.Content[0].(*mcp.TextContent).Text
		if res.IsError {
			t.Fatalf("%s: %s", name, text)
		}
		return text
	}

	if out := call("function", map[string]any{"id": "example.com/sample/app.Run"}); !strings.Contains(out, "   23  \tgo func() {") {
		t.Errorf("function = %s", out)
	}
	call("write_function_note", map[string]any{
		"lang":    "ja",
		"id":      "example.com/sample/app.Run",
		"summary": "ストアの中身を表示する",
		"doc":     "Run はストアの中身を表示する。",
		"lines": []map[string]any{
			{"line": 23, "text": "別の goroutine で挨拶する"},
			{"line": 18, "text": "doc コメントの行にも書ける", "kind": "warning"},
		},
	})
	call("write_package_note", map[string]any{"lang": "ja", "path": "example.com/sample/app", "summary": "入口"})

	var v server.NotesView
	if err := json.Unmarshal([]byte(get(t, srv.URL+"/api/notes?lang=ja", http.StatusOK)), &v); err != nil {
		t.Fatal(err)
	}
	run := v.Funcs["example.com/sample/app.Run"]
	if len(v.Langs) != 1 || run.Doc != "Run はストアの中身を表示する。" || len(run.Lines) != 2 || run.Lines[0].Line != 18 || run.Lines[0].Kind != "warning" || run.Lines[1].Line != 23 {
		t.Errorf("notes = %+v", v)
	}
	if v.Packages["example.com/sample/app"].Summary != "入口" {
		t.Errorf("package notes = %+v", v.Packages)
	}
	if out := call("function", map[string]any{"id": "example.com/sample/app.Run", "lang": "ja"}); !strings.Contains(out, ">> 別の goroutine で挨拶する\n   23") {
		t.Errorf("function with notes = %s", out)
	}
}

func TestServerWithoutFrontend(t *testing.T) {
	srv := httptest.NewServer(server.New(&model.Graph{}, fstest.MapFS{".gitkeep": {}}, openNotes(t), "test"))
	defer srv.Close()

	if body := get(t, srv.URL+"/", http.StatusNotFound); !strings.Contains(body, "web-build") {
		t.Errorf("body = %q", body)
	}
}

func openNotes(t *testing.T) *notes.Store {
	t.Helper()
	s, err := notes.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func get(t *testing.T, url string, status int) string {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != status {
		t.Fatalf("GET %s = %d, want %d: %s", url, resp.StatusCode, status, body)
	}
	return string(body)
}

// sampleServer serves a copy of the callgraph sample, so a test may change
// its files, with the call graph built.
func sampleServer(t *testing.T) (*httptest.Server, string, *notes.Store) {
	t.Helper()
	root := t.TempDir()
	if err := os.CopyFS(root, os.DirFS("../callgraph/testdata/sample")); err != nil {
		t.Fatal(err)
	}
	g, err := load.Graph(context.Background(), root, "./...")
	if err != nil {
		t.Fatal(err)
	}
	store := openNotes(t)
	s := server.New(g, fstest.MapFS{"index.html": {Data: []byte("app")}}, store, "test")
	calls, err := callgraph.Build(context.Background(), root, "./...")
	if err != nil {
		t.Fatal(err)
	}
	s.SetCalls(calls, nil, time.Second)
	srv := httptest.NewServer(s)
	t.Cleanup(srv.Close)
	return srv, root, store
}

func TestCallQueries(t *testing.T) {
	srv, _, _ := sampleServer(t)

	var entries []model.Entry
	if err := json.Unmarshal([]byte(get(t, srv.URL+"/api/calls/entries", http.StatusOK)), &entries); err != nil || len(entries) != 3 {
		t.Errorf("entries = %+v (%v)", entries, err)
	}
	var funcs []model.FuncDetail
	if err := json.Unmarshal([]byte(get(t, srv.URL+"/api/calls/package?path=example.com/sample/app", http.StatusOK)), &funcs); err != nil || len(funcs) == 0 || funcs[0].Name != "(english).Greet" {
		t.Errorf("package = %+v (%v)", funcs, err)
	}
	for _, limit := range []string{"", "abc", "0", "999"} {
		var hits []model.Func
		body := get(t, srv.URL+"/api/calls/search?q=a&limit="+limit, http.StatusOK)
		if err := json.Unmarshal([]byte(body), &hits); err != nil || len(hits) == 0 {
			t.Errorf("search with limit %q = %s (%v)", limit, body, err)
		}
	}
	var one []model.Func
	if err := json.Unmarshal([]byte(get(t, srv.URL+"/api/calls/search?q=a&limit=1", http.StatusOK)), &one); err != nil || len(one) != 1 {
		t.Errorf("search with limit 1 = %+v (%v)", one, err)
	}
	if body := get(t, srv.URL+"/", http.StatusOK); body != "app" {
		t.Errorf("/ = %q", body)
	}
}

func TestStatusReportsFailureAndSkippedPackages(t *testing.T) {
	s := server.New(&model.Graph{}, fstest.MapFS{}, openNotes(t), "test")
	srv := httptest.NewServer(s)
	defer srv.Close()

	s.SetCalls(nil, errors.New("boom"), 0)
	if body := get(t, srv.URL+"/api/calls/status", http.StatusOK); !strings.Contains(body, `"state":"error"`) || !strings.Contains(body, "boom") {
		t.Errorf("status = %s", body)
	}

	calls, err := callgraph.Build(context.Background(), "../callgraph/testdata/broken", "./...")
	if err != nil {
		t.Fatal(err)
	}
	s.SetCalls(calls, nil, time.Second)
	if body := get(t, srv.URL+"/api/calls/status", http.StatusOK); !strings.Contains(body, `"skipped":[{"path":"example.com/broken"`) {
		t.Errorf("status = %s", body)
	}
}

func TestReadFailures(t *testing.T) {
	srv, root, _ := sampleServer(t)
	// The file was known when the server started, and is gone now.
	if err := os.Remove(filepath.Join(root, "app", "app.go")); err != nil {
		t.Fatal(err)
	}
	get(t, srv.URL+"/api/source?file=app/app.go", http.StatusInternalServerError)

	// With the root gone, no image can be read.
	if err := os.RemoveAll(root); err != nil {
		t.Fatal(err)
	}
	get(t, srv.URL+"/api/asset?path=docs/arch.svg", http.StatusInternalServerError)
}

func TestAssetHeaders(t *testing.T) {
	srv, _, _ := sampleServer(t)
	resp, err := http.Get(srv.URL + "/api/asset?path=docs/arch.svg")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	if ct := resp.Header.Get("Content-Type"); ct != "image/svg+xml" {
		t.Errorf("Content-Type = %q", ct)
	}
	if csp := resp.Header.Get("Content-Security-Policy"); !strings.Contains(csp, "sandbox") {
		t.Errorf("Content-Security-Policy = %q", csp)
	}
	for _, p := range []string{".git/x.png", "docs/arch.svg.txt", "docs/missing.png"} {
		get(t, srv.URL+"/api/asset?path="+url.QueryEscape(p), http.StatusNotFound)
	}
}

func TestNotesEvents(t *testing.T) {
	srv, _, store := sampleServer(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, srv.URL+"/api/notes/events", nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	if ct := resp.Header.Get("Content-Type"); ct != "text/event-stream" {
		t.Errorf("Content-Type = %q", ct)
	}

	if err := store.Update("ja", func(b *notes.Book) { b.Packages["p"] = notes.Note{Summary: "x"} }); err != nil {
		t.Fatal(err)
	}
	line, err := bufio.NewReader(resp.Body).ReadString('\n')
	if err != nil || line != "event: notes\n" {
		t.Errorf("first line = %q (%v)", line, err)
	}
}

func TestNotesEventsNeedFlushing(t *testing.T) {
	s := server.New(&model.Graph{}, fstest.MapFS{}, openNotes(t), "test")
	w := &struct{ http.ResponseWriter }{httptest.NewRecorder()}
	s.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/notes/events", nil))
	rec := w.ResponseWriter.(*httptest.ResponseRecorder)
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d", rec.Code)
	}
}

func TestNotesViewWithoutLines(t *testing.T) {
	srv, _, store := sampleServer(t)
	err := store.Update("ja", func(b *notes.Book) {
		b.Funcs["example.com/sample/app.Run"] = notes.FuncNote{Note: notes.Note{Summary: "s"}}
		b.Funcs["gone.Func"] = notes.FuncNote{Note: notes.Note{Summary: "orphan"}}
	})
	if err != nil {
		t.Fatal(err)
	}
	var v server.NotesView
	if err := json.Unmarshal([]byte(get(t, srv.URL+"/api/notes?lang=ja", http.StatusOK)), &v); err != nil {
		t.Fatal(err)
	}
	if v.Funcs["example.com/sample/app.Run"].Summary != "s" || v.Funcs["gone.Func"].Summary != "orphan" {
		t.Errorf("funcs = %+v", v.Funcs)
	}
}

func TestNotesViewMarksStaleNotes(t *testing.T) {
	srv, root, store := sampleServer(t)
	g, err := load.Graph(context.Background(), root, "./...")
	if err != nil {
		t.Fatal(err)
	}
	calls, err := callgraph.Build(context.Background(), root, "./...")
	if err != nil {
		t.Fatal(err)
	}
	code := freshness.New(g, calls, func(f string) ([]byte, error) { return os.ReadFile(filepath.Join(root, f)) })
	run, _ := calls.Func("example.com/sample/app.Run")
	print, err := code.FuncPrint(run.Func)
	if err != nil {
		t.Fatal(err)
	}
	err = store.Update("ja", func(b *notes.Book) {
		b.Funcs[run.ID] = notes.FuncNote{Note: notes.Note{Summary: "fresh", Fingerprint: print}}
		b.Funcs["example.com/sample/app.work"] = notes.FuncNote{Note: notes.Note{Summary: "no fingerprint"}}
		b.Packages["example.com/sample/app"] = notes.Note{Summary: "no fingerprint"}
	})
	if err != nil {
		t.Fatal(err)
	}
	var v server.NotesView
	if err := json.Unmarshal([]byte(get(t, srv.URL+"/api/notes?lang=ja", http.StatusOK)), &v); err != nil {
		t.Fatal(err)
	}
	if v.Funcs[run.ID].Stale || !v.Funcs["example.com/sample/app.work"].Stale || !v.Packages["example.com/sample/app"].Stale {
		t.Errorf("notes = %+v", v)
	}
}
