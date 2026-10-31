package load

import (
	"context"
	"strings"
	"testing"

	"github.com/mpyw/pkgsight/internal/model"
)

func TestGraph(t *testing.T) {
	g, err := Graph(context.Background(), "testdata/sample", "./...")
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
	// go list -e reports a package it cannot load, rather than failing. The
	// package that imports it shows the error too, where the import is.
	if broken := byPath["example.com/sample/broken"]; !strings.Contains(broken.Error, "example.com/sample/nope") {
		t.Errorf("broken = %+v", broken)
	}
	// A package that cannot be found is no part of the standard library,
	// which the map hides by default.
	if nope := byPath["example.com/sample/nope"]; nope.Kind != model.KindExt || nope.Error == "" {
		t.Errorf("nope = %+v", nope)
	}
	// Only the package that writes the import shows the error, not those
	// that import it in turn.
	if uses := byPath["example.com/sample/uses"]; uses.Error != "" {
		t.Errorf("uses = %+v", uses)
	}
}

func TestGraphInMissingDirectory(t *testing.T) {
	_, err := Graph(context.Background(), "testdata/missing", "./...")
	if err == nil || !strings.Contains(err.Error(), "testdata/missing") {
		t.Errorf("err = %v, want one naming the directory", err)
	}
}

func TestGraphWithBadPattern(t *testing.T) {
	_, err := Graph(context.Background(), "testdata/sample", "-not-a-flag")
	if err == nil || !strings.Contains(err.Error(), "go list") {
		t.Errorf("err = %v", err)
	}
}

func TestDecodeRejectsGarbage(t *testing.T) {
	if _, err := decode("/r", []byte(`{"ImportPath": "a"} {`)); err == nil || !strings.Contains(err.Error(), "decode go list output") {
		t.Errorf("err = %v", err)
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

func TestPackages(t *testing.T) {
	got, err := Packages(context.Background(), "testdata/sample", "./app/...")
	if err != nil {
		t.Fatal(err)
	}
	// Only what the pattern matches, not what it imports.
	if want := []string{"example.com/sample/app", "example.com/sample/app/store"}; !equal(got, want) {
		t.Errorf("Packages = %v, want %v", got, want)
	}
	if _, err := Packages(context.Background(), "testdata/sample", "example.com/nope"); err == nil || !strings.Contains(err.Error(), "go list") {
		t.Errorf("err = %v", err)
	}
}
