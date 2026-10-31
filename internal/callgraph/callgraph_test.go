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

// describeCalls renders the calls of fn into the module, one per line.
func describeCalls(t *testing.T, g *callgraph.Graph, id string) []string {
	t.Helper()
	d, ok := g.Func(id)
	if !ok {
		t.Fatalf("no function %s", id)
	}
	var out []string
	for _, c := range d.Calls {
		s := string(c.Dispatch) + " " + c.To.Name + " " + string(c.To.Kind)
		if c.Maybe {
			s += " maybe"
		}
		if c.Through != "" {
			s += " through " + c.Through
		}
		out = append(out, s)
	}
	return out
}

func TestEdges(t *testing.T) {
	g, err := callgraph.Build(context.Background(), "testdata/edges", "./...")
	if err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		fn   string
		want []string
	}{
		// The analysis does not see into a generic body, so a function
		// handed to the module's own generic function is handed through it.
		{"Generic", []string{"static Map own", "dynamic double own through edges.Map"}},
		// The writer comes from the standard library, so the module's
		// writers are only a guess.
		{"Guess", []string{"interface (*File).Write std", "interface (sink).Write own maybe"}},
		// The wrapper SSA makes for the promoted method is looked through.
		{"Promoted", []string{"interface (sink).Write own"}},
		// So is the one for the method value.
		{"Bound", []string{"static (sink).Write own"}},
		// A generic library function is named by its origin.
		{"Sorted", []string{
			"dynamic less own through slices.SortFunc",
			"static SortFunc std",
			"dynamic Sorted$1 own through slices.ContainsFunc",
			"static ContainsFunc std",
		}},
	}
	for _, tt := range tests {
		t.Run(tt.fn, func(t *testing.T) {
			if got := describeCalls(t, g, "example.com/edges."+tt.fn); !equal(got, tt.want) {
				t.Errorf("calls = %q, want %q", got, tt.want)
			}
		})
	}

	if c, _ := g.Func("example.com/edges.cleanup"); len(c.Callers) != 1 {
		t.Errorf("callers of cleanup = %+v, want Twice once", c.Callers)
	}
	if got := describeCalls(t, g, "example.com/edges.Twice"); len(got) != 2 {
		t.Errorf("calls of Twice = %q, want the call and the defer", got)
	}

	// Guess only guesses at Write, so it is no caller.
	sink, _ := g.Func("(example.com/edges.sink).Write")
	var callers []string
	for _, c := range sink.Callers {
		callers = append(callers, c.Name)
	}
	if want := []string{"Promoted", "Bound"}; !equal(callers, want) {
		t.Errorf("callers of (sink).Write = %v, want %v", callers, want)
	}
}

func TestSkipsPackagesThatDoNotTypeCheck(t *testing.T) {
	g, err := callgraph.Build(context.Background(), "testdata/broken", "./...")
	if err != nil {
		t.Fatal(err)
	}
	skipped := g.Skipped()
	if len(skipped) != 1 || skipped[0].Path != "example.com/broken" || !strings.Contains(skipped[0].Error, "cannot use") {
		t.Errorf("Skipped() = %+v", skipped)
	}
	if fs := g.Package("example.com/broken"); len(fs) != 0 {
		t.Errorf("functions of a package that does not type-check: %+v", fs)
	}
}

func TestBuildInMissingDirectory(t *testing.T) {
	_, err := callgraph.Build(context.Background(), "testdata/missing", "./...")
	if err == nil || !strings.Contains(err.Error(), "testdata/missing") {
		t.Errorf("err = %v, want one naming the directory", err)
	}
}

func TestSearch(t *testing.T) {
	g, err := callgraph.Build(context.Background(), "testdata/sample", "./...")
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, f := range g.Search("RUN", 10) {
		names = append(names, f.PkgName+"."+f.Name)
	}
	// Shortest first, then by ID. Matching ignores case.
	if want := []string{"app.Run", "app.Run$1"}; !equal(names, want) {
		t.Errorf("Search(RUN) = %v, want %v", names, want)
	}
	if got := g.Search("app.", 3); len(got) != 3 {
		t.Errorf("Search with limit 3 returned %d", len(got))
	}
	if got := g.Search("nothing matches this", 10); len(got) != 0 {
		t.Errorf("Search(no match) = %+v", got)
	}
	if _, ok := g.Func("nope"); ok {
		t.Error("Func(nope) found something")
	}
}

func TestResultsAreCopies(t *testing.T) {
	g, err := callgraph.Build(context.Background(), "testdata/sample", "./...")
	if err != nil {
		t.Fatal(err)
	}
	const id = "example.com/sample/app.Run"
	d, _ := g.Func(id)
	d.Calls[0].Lines[0] = -1
	d.Calls[0] = model.Call{}
	d.Callers[0] = model.Func{}
	for _, f := range g.Package("example.com/sample/app") {
		if f.ID == id && len(f.Calls) > 0 {
			f.Calls[0].To.Name = "changed"
		}
	}
	again, _ := g.Func(id)
	if again.Calls[0].To.Name != "cleanup" || again.Calls[0].Lines[0] != 21 || again.Callers[0].Name != "main" {
		t.Errorf("changing a result changed the graph: %+v", again)
	}
}
