package load_test

import (
	"context"
	"testing"

	"github.com/mpyw/pkgsight/internal/load"
	"github.com/mpyw/pkgsight/internal/model"
)

func TestGraph(t *testing.T) {
	g, err := load.Graph(context.Background(), "testdata/sample", "./...")
	if err != nil {
		t.Fatal(err)
	}

	byPath := map[string]model.Package{}
	for _, p := range g.Packages {
		byPath[p.Path] = p
	}

	app, ok := byPath["example.com/sample/app"]
	if !ok {
		t.Fatalf("app is missing from %d packages", len(g.Packages))
	}
	if app.Kind != model.KindOwn || app.Dir != "app" || app.Doc != "Package app wires the store to the outside world." {
		t.Errorf("app = %+v", app)
	}
	if want := []string{"example.com/sample/app/store", "fmt"}; !equal(app.Imports, want) {
		t.Errorf("app.Imports = %v, want %v", app.Imports, want)
	}
	if fmt := byPath["fmt"]; fmt.Kind != model.KindStd || fmt.Module != "" {
		t.Errorf("fmt = %+v", fmt)
	}
	if len(g.Modules) != 1 || !g.Modules[0].Main || g.Modules[0].Path != "example.com/sample" {
		t.Errorf("Modules = %+v", g.Modules)
	}
}

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
