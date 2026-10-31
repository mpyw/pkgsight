package freshness_test

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/mpyw/pkgsight/internal/callgraph"
	"github.com/mpyw/pkgsight/internal/freshness"
	"github.com/mpyw/pkgsight/internal/load"
	"github.com/mpyw/pkgsight/internal/model"
	"github.com/mpyw/pkgsight/internal/notes"
)

const (
	run    = "example.com/sample/app.Run"
	appPkg = "example.com/sample/app"
)

// sample copies the callgraph sample to a directory the test may change.
func sample(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.CopyFS(dir, os.DirFS("../callgraph/testdata/sample")); err != nil {
		t.Fatal(err)
	}
	return dir
}

// code analyzes dir as it is now.
func code(t *testing.T, dir string) (*freshness.Code, *model.Graph) {
	t.Helper()
	c, g, _ := analyze(t, dir)
	return c, g
}

func analyze(t *testing.T, dir string) (*freshness.Code, *model.Graph, *callgraph.Graph) {
	t.Helper()
	g, err := load.Graph(context.Background(), dir, "./...")
	if err != nil {
		t.Fatal(err)
	}
	calls, err := callgraph.Build(context.Background(), dir, "./...")
	if err != nil {
		t.Fatal(err)
	}
	read := func(file string) ([]byte, error) { return os.ReadFile(filepath.Join(dir, filepath.FromSlash(file))) }
	return freshness.New(g, calls, read), g, calls
}

func pkgOf(t *testing.T, g *model.Graph, path string) model.Package {
	t.Helper()
	for _, p := range g.Packages {
		if p.Path == path {
			return p
		}
	}
	t.Fatalf("no package %s", path)
	return model.Package{}
}

// edit rewrites a file of dir, replacing old with new once.
func edit(t *testing.T, dir, file, old, new string) {
	t.Helper()
	path := filepath.Join(dir, file)
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), old) {
		t.Fatalf("%s has no %q", file, old)
	}
	if err := os.WriteFile(path, []byte(strings.Replace(string(b), old, new, 1)), 0o644); err != nil {
		t.Fatal(err)
	}
}

// book writes notes for Run and for the app package as the code is now.
func book(t *testing.T, dir string) notes.Book {
	t.Helper()
	c, g, calls := analyze(t, dir)
	d, _ := calls.Func(run)
	fp, err := c.FuncPrint(d.Func)
	if err != nil {
		t.Fatal(err)
	}
	return notes.Book{
		Packages: map[string]notes.Note{appPkg: {Summary: "s", Fingerprint: c.PackagePrint(pkgOf(t, g, appPkg))}},
		Funcs:    map[string]notes.FuncNote{run: {Note: notes.Note{Summary: "s", Fingerprint: fp}}},
	}
}

func states(r freshness.Report) map[string]freshness.State {
	out := map[string]freshness.State{}
	for k, v := range r.Packages {
		out["package "+k] = v
	}
	for k, v := range r.Funcs {
		out["function "+k] = v
	}
	return out
}

func TestFreshUntilTheCodeChanges(t *testing.T) {
	tests := []struct {
		name     string
		file     string
		old, new string
		pkg, fn  freshness.State
	}{
		{"nothing changed", "app/app.go", "", "", freshness.Fresh, freshness.Fresh},
		{"a comment and layout", "app/app.go", "\tdefer cleanup()\n", "\n\t// cleaned up last\n\tdefer   cleanup()\n\n", freshness.Fresh, freshness.Fresh},
		{"the doc comment of the function", "app/app.go", "// Run prints what the store holds.", "// Run prints the value.", freshness.Fresh, freshness.Fresh},
		{"code above the function", "app/app.go", "func (english) Greet() string { return \"hello\" }", "func (english) Greet() string {\n\treturn \"hi\"\n}", freshness.Fresh, freshness.Fresh},
		{"the body", "app/app.go", "wg.Wait()", "wg.Wait()\n\twg.Wait()", freshness.Fresh, freshness.Stale},
		{"a literal", "app/app.go", "wg.Add(1)", "wg.Add(2)", freshness.Fresh, freshness.Stale},
		{"the package comment", "app/app.go", "// Package app wires", "// Package app joins", freshness.Stale, freshness.Fresh},
		{"a new function", "app/app.go", "func cleanup() {}", "func cleanup() {}\n\nfunc tidy() {}", freshness.Stale, freshness.Fresh},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := sample(t)
			b := book(t, dir)
			if tt.old != "" {
				edit(t, dir, tt.file, tt.old, tt.new)
			}
			c, _ := code(t, dir)
			want := map[string]freshness.State{"package " + appPkg: tt.pkg, "function " + run: tt.fn}
			if got := states(c.Check(b)); !reflect.DeepEqual(got, want) {
				t.Errorf("states = %v, want %v", got, want)
			}
		})
	}
}

func TestOrphansAndNotesWithoutFingerprints(t *testing.T) {
	dir := sample(t)
	c, _ := code(t, dir)
	r := c.Check(notes.Book{
		Packages: map[string]notes.Note{"example.com/gone": {}, "fmt": {}, appPkg: {Summary: "old"}},
		Funcs:    map[string]notes.FuncNote{"example.com/gone.F": {}, run: {}},
	})
	want := map[string]freshness.State{
		"package example.com/gone":    freshness.Orphan,
		"package fmt":                 freshness.Orphan,
		"package " + appPkg:           freshness.Stale,
		"function example.com/gone.F": freshness.Orphan,
		"function " + run:             freshness.Stale,
	}
	if got := states(r); !reflect.DeepEqual(got, want) {
		t.Errorf("states = %v, want %v", got, want)
	}
	var problems []string
	for _, p := range r.Problems() {
		problems = append(problems, p.Kind+" "+p.Key+" "+string(p.State))
	}
	wantProblems := []string{
		"package example.com/gone orphan",
		"package " + appPkg + " stale",
		"package fmt orphan",
		"function example.com/gone.F orphan",
		"function " + run + " stale",
	}
	if !reflect.DeepEqual(problems, wantProblems) {
		t.Errorf("Problems = %v, want %v", problems, wantProblems)
	}
}

func TestUnreadableSourceIsStale(t *testing.T) {
	dir := sample(t)
	b := book(t, dir)
	c, _ := code(t, dir)
	if err := os.Remove(filepath.Join(dir, "app", "app.go")); err != nil {
		t.Fatal(err)
	}
	if got := c.Check(b).Funcs[run]; got != freshness.Stale {
		t.Errorf("state = %s, want stale", got)
	}
	// The package comment lived in app.go too, so there is none to read.
	if doc := c.PackageDoc(model.Package{Dir: "app", Files: []string{"app.go"}}); doc != "" {
		t.Errorf("PackageDoc = %q", doc)
	}
}

func TestLinesAreKept(t *testing.T) {
	reads := 0
	c := freshness.New(&model.Graph{}, nil, func(string) ([]byte, error) {
		reads++
		return []byte("a\nb"), nil
	})
	for range 2 {
		lines, err := c.Lines("f.go")
		if err != nil || !reflect.DeepEqual(lines, []string{"a", "b"}) {
			t.Errorf("Lines = %v (%v)", lines, err)
		}
	}
	if reads != 1 {
		t.Errorf("read the file %d times", reads)
	}
}

func TestPackageOf(t *testing.T) {
	for id, want := range map[string]string{
		"github.com/mpyw/pkgsight/cmd/pkgsight.main":              "github.com/mpyw/pkgsight/cmd/pkgsight",
		"example.com/sample/app.Run$1":                            "example.com/sample/app",
		"(example.com/sample/app.english).Greet":                  "example.com/sample/app",
		"(*github.com/mpyw/pkgsight/internal/notes.Store).Update": "github.com/mpyw/pkgsight/internal/notes",
		"(*example.com/x.List[T]).Push":                           "example.com/x",
		"main.main":                                               "main",
		"nodot":                                                   "nodot",
	} {
		if got := freshness.PackageOf(id); got != want {
			t.Errorf("PackageOf(%q) = %q, want %q", id, got, want)
		}
	}
}

func TestShrunkFileIsStale(t *testing.T) {
	dir := sample(t)
	b := book(t, dir)
	c, _ := code(t, dir)
	// The file loses its lines after the call graph was built.
	if err := os.WriteFile(filepath.Join(dir, "app", "app.go"), []byte("package app\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	c2 := freshness.New(nil, nil, func(file string) ([]byte, error) { return os.ReadFile(filepath.Join(dir, file)) })
	if _, err := c2.FuncPrint(model.Func{File: "app/app.go", Line: 19, EndLine: 29}); err == nil || !strings.Contains(err.Error(), "no lines 19-29") {
		t.Errorf("err = %v", err)
	}
	if got := c.Check(b).Funcs[run]; got != freshness.Stale {
		t.Errorf("state = %s, want stale", got)
	}
}
