package notes_test

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/mpyw/pkgsight/internal/notes"
)

func TestPlace(t *testing.T) {
	src := []string{
		"func f() {", // 1
		"\tx := 1",   // 2
		"\tgo g(x)",  // 3
		"}",          // 4
	}
	n := notes.FuncNote{Lines: []notes.LineNote{
		{Offset: 2, Hash: notes.HashLine("go g(x)"), Text: "on its line"},
		{Offset: 1, Hash: notes.HashLine("\tgo g(x)  "), Text: "moved down a line"},
		{Offset: 1, Hash: notes.HashLine("gone()"), Text: "lost"},
	}}
	want := []notes.Resolved{
		{Line: 2, Text: "lost", Stale: true},
		{Line: 3, Text: "on its line"},
		{Line: 3, Text: "moved down a line"},
	}
	if got := notes.Place(n, src, 1, 1, 4); !reflect.DeepEqual(got, want) {
		t.Errorf("Place = %+v, want %+v", got, want)
	}
}

func TestStore(t *testing.T) {
	root := t.TempDir()
	s, err := notes.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	ch, cancel := s.Subscribe()
	defer cancel()

	if err := s.Update("../x", func(*notes.Book) {}); err == nil {
		t.Error("Update accepted a path as a language")
	}
	err = s.Update("ja", func(b *notes.Book) { b.Packages["p"] = notes.Note{Summary: "要約"} })
	if err != nil {
		t.Fatal(err)
	}
	if got := <-ch; got != "ja" {
		t.Errorf("event = %q", got)
	}
	file := filepath.Join(root, ".pkgsight", "notes", "ja.json")
	if _, err := os.Stat(file); err != nil {
		t.Fatal(err)
	}

	reopened, err := notes.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	if got := reopened.Book("ja").Packages["p"].Summary; got != "要約" {
		t.Errorf("summary after reopening = %q", got)
	}
	if got := reopened.Langs(); !reflect.DeepEqual(got, []string{"ja"}) {
		t.Errorf("Langs = %v", got)
	}

	if err := s.Update("ja", func(b *notes.Book) { clear(b.Packages) }); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(file); !os.IsNotExist(err) {
		t.Errorf("the empty book kept its file: %v", err)
	}
}
