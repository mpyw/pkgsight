package callgraph_test

import (
	"context"
	"encoding/json/v2"
	"strings"
	"testing"

	"github.com/mpyw/pkgsight/internal/callgraph"
	"github.com/mpyw/pkgsight/internal/model"
)

func TestBuild(t *testing.T) {
	g, err := callgraph.Build(context.Background(), "testdata/sample", "./...")
	if err != nil {
		t.Fatal(err)
	}

	var entries []string
	for _, e := range g.Entries() {
		entries = append(entries, string(e.Reason)+" "+e.Pkg+"."+e.Name)
	}
	want := []string{
		"main example.com/sample/cmd/sample.main",
		"uncalled example.com/sample/app.Spawn",
		"uncalled example.com/sample/app.Unused",
	}
	if !equal(entries, want) {
		t.Errorf("Entries() = %v, want %v", entries, want)
	}

	run, ok := g.Func("example.com/sample/app.Run")
	if !ok {
		t.Fatal("Run is missing")
	}
	if run.File != "app/app.go" || run.Line != 19 || run.Doc != "Run prints what the store holds." {
		t.Errorf("Run = %+v", run.Func)
	}
	var calls []string
	for _, c := range run.Calls {
		if c.To.Kind == model.KindOwn {
			calls = append(calls, string(c.Mode)+" "+c.To.Name)
		}
	}
	// In source order: defer cleanup(), go func(), store.Get().
	if want := []string{"defer cleanup", "go Run$1", "call Get"}; !equal(calls, want) {
		t.Errorf("own calls of Run = %v, want %v", calls, want)
	}

	work, _ := g.Func("example.com/sample/app.work")
	var greet *model.Call
	for i, c := range work.Calls {
		if c.To.Name == "(english).Greet" {
			greet = &work.Calls[i]
		}
	}
	if greet == nil || greet.Dispatch != model.DispatchInterface || greet.Maybe {
		t.Errorf("work -> english.Greet = %+v", greet)
	}
	if len(work.Callers) != 2 || work.Callers[0].Name != "Run$1" || work.Callers[1].Name != "Spawn$1" {
		t.Errorf("work.Callers = %+v", work.Callers)
	}

	// wg.Go calls the closure inside the standard library, out of sight.
	spawn, _ := g.Func("example.com/sample/app.Spawn")
	var spawned []string
	for _, c := range spawn.Calls {
		if c.To.Kind == model.KindOwn {
			spawned = append(spawned, string(c.Mode)+" "+c.To.Name+" through "+c.Through)
		}
	}
	if want := []string{"go Spawn$1 through sync.(*WaitGroup).Go"}; !equal(spawned, want) {
		t.Errorf("own calls of Spawn = %v, want %v", spawned, want)
	}

	var names []string
	for _, f := range g.Package("example.com/sample/app") {
		names = append(names, f.Name)
	}
	if want := []string{"(english).Greet", "Run", "Run$1", "work", "cleanup", "Unused", "Spawn", "Spawn$1"}; !equal(names, want) {
		t.Errorf("Package(app) = %v, want %v", names, want)
	}
	if hits := g.Search("greet", 10); len(hits) != 1 || hits[0].Name != "(english).Greet" {
		t.Errorf("Search(greet) = %+v", hits)
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

func TestCallWithoutPosition(t *testing.T) {
	g, err := callgraph.Build(context.Background(), "testdata/sample", "./...")
	if err != nil {
		t.Fatal(err)
	}
	get, ok := g.Func("example.com/sample/app/store.Get")
	if !ok {
		t.Fatal("no store.Get")
	}
	var yield *model.Call
	for i, c := range get.Calls {
		if c.To.Name == "values$1" {
			yield = &get.Calls[i]
		}
	}
	if yield == nil {
		t.Fatalf("store.Get does not call values$1: %+v", get.Calls)
	}
	// The frontend reads lines as a list, never null.
	b, err := json.Marshal(yield)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), `"lines":[]`) {
		t.Errorf("a call at no position encodes as %s", b)
	}
}
