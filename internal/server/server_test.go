package server_test

import (
	"context"
	"encoding/json/v2"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/mpyw/pkgsight/internal/callgraph"
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
