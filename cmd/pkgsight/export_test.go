package main

import (
	"bytes"
	"context"
	"encoding/json/v2"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/mpyw/pkgsight/internal/notes"
)

// exportedUI stands in for the built web UI.
var exportedUI = fstest.MapFS{
	"index.html": {Data: []byte(`<!doctype html>
<html>
  <head>
    <script type="module" crossorigin src="/assets/app.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/app.css">
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`)},
	"assets/app.js":  {Data: []byte(`console.log("</script>");`)},
	"assets/app.css": {Data: []byte(`body{color:red}`)},
}

func exportWith(t *testing.T, ui fs.FS) {
	t.Helper()
	old := exportedAssets
	exportedAssets = func() fs.FS { return ui }
	t.Cleanup(func() { exportedAssets = old })
}

func TestExport(t *testing.T) {
	exportWith(t, exportedUI)
	dir := t.TempDir()
	if err := os.CopyFS(dir, os.DirFS(sample)); err != nil {
		t.Fatal(err)
	}
	store, err := notes.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	err = store.Update("ja", func(b *notes.Book) {
		b.Packages["example.com/sample/app"] = notes.Note{
			Summary: "s",
			Body:    "![arch](./docs/arch.svg) ![remote](https://example.com/x.png) ![gone](docs/gone.png) <img src=\"docs/arch.svg\">",
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	out := filepath.Join(t.TempDir(), "out.html")
	var stderr bytes.Buffer
	if code := pkgsight(context.Background(), io.Discard, &stderr, "export", "-C", dir, "-o", out); code != 0 {
		t.Fatalf("exit %d:\n%s", code, stderr.String())
	}
	if !strings.Contains(stderr.String(), "wrote "+out) {
		t.Errorf("stderr = %q", stderr.String())
	}
	b, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	page := string(b)
	for _, want := range []string{
		`<script type="module">console.log("<\/script>");</script>`,
		`<style>body{color:red}</style>`,
		`<script id="pkgsight-data" type="application/json">`,
	} {
		if !strings.Contains(page, want) {
			t.Errorf("the page has no %q", want)
		}
	}
	if strings.Contains(page, `src="/assets/`) || strings.Contains(page, `href="/assets/`) {
		t.Error("the page still links its assets")
	}

	raw := regexp.MustCompile(`(?s)<script id="pkgsight-data" type="application/json">(.*?)</script>`).FindStringSubmatch(page)[1]
	var data struct {
		Status struct {
			State string `json:"state"`
		} `json:"status"`
		Entries []struct {
			ID string `json:"id"`
		} `json:"entries"`
		Funcs map[string]struct {
			Name string `json:"name"`
		} `json:"funcs"`
		Packages map[string][]string `json:"packages"`
		Sources  map[string]string   `json:"sources"`
		Notes    map[string]struct {
			Lang string `json:"lang"`
		} `json:"notes"`
		Assets map[string]string `json:"assets"`
	}
	if err := json.Unmarshal([]byte(raw), &data); err != nil {
		t.Fatal(err)
	}
	if data.Status.State != "ready" || len(data.Entries) == 0 {
		t.Errorf("status %+v, entries %+v", data.Status, data.Entries)
	}
	if data.Funcs["example.com/sample/app.Run"].Name != "Run" || len(data.Packages["example.com/sample/app"]) == 0 {
		t.Errorf("funcs or packages are missing: %d funcs", len(data.Funcs))
	}
	if !strings.Contains(data.Sources["app/app.go"], "func Run()") {
		t.Errorf("sources = %v", len(data.Sources))
	}
	if data.Notes["ja"].Lang != "ja" {
		t.Errorf("notes = %+v", data.Notes)
	}
	// The image of the repository is embedded once. A remote image and one
	// that is gone are not.
	if len(data.Assets) != 1 || !strings.HasPrefix(data.Assets["docs/arch.svg"], "data:image/svg+xml;base64,") {
		t.Errorf("assets = %v", data.Assets)
	}
}

func TestExportFailures(t *testing.T) {
	tests := []struct {
		name string
		ui   fs.FS
		args []string
		want string
	}{
		{"no built UI", fstest.MapFS{".gitkeep": {}}, nil, "the web UI is not built"},
		{"a missing asset", fstest.MapFS{"index.html": exportedUI["index.html"]}, nil, "assets/app.js"},
		{"no such directory", exportedUI, []string{"-C", filepath.Join(t.TempDir(), "missing")}, "missing: no such file or directory"},
		{"a bad notes file", exportedUI, []string{"-C", exportSourceWithBadNotes(t)}, "ja.yaml"},
		{"an unwritable output", exportedUI, []string{"-o", filepath.Join(t.TempDir(), "no", "such", "dir.html")}, "no such file or directory"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			exportWith(t, tt.ui)
			var stderr bytes.Buffer
			args := append([]string{"export"}, tt.args...)
			if !slices.Contains(args, "-C") {
				args = append(args, "-C", sample)
			}
			if !slices.Contains(args, "-o") {
				args = append(args, "-o", filepath.Join(t.TempDir(), "out.html"))
			}
			if code := pkgsight(context.Background(), io.Discard, &stderr, args...); code != 1 {
				t.Errorf("exit %d, want 1", code)
			}
			if !strings.Contains(stderr.String(), tt.want) {
				t.Errorf("stderr = %q, want %q in it", stderr.String(), tt.want)
			}
		})
	}
}

// exportSourceWithBadNotes copies the sample with a notes file that does not parse.
func exportSourceWithBadNotes(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.CopyFS(dir, os.DirFS(sample)); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, ".pkgsight", "notes"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, ".pkgsight", "notes", "ja.yaml"), []byte("{"), 0o644); err != nil {
		t.Fatal(err)
	}
	return dir
}
