package notes_test

import (
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
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
	file := filepath.Join(root, ".pkgsight", "notes", "ja.yaml")
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

func TestOpenSkipsWhatIsNotABook(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, ".pkgsight", "notes")
	if err := os.MkdirAll(filepath.Join(dir, "sub.yaml"), 0o755); err != nil {
		t.Fatal(err)
	}
	for name, body := range map[string]string{
		"README.md":   "not a book",
		"../x.yaml":   "{}",
		"en.yaml":     "packages:\n  p:\n    summary: kept\n",
		"not_a.yaml":  "{",
		"Japanese.tx": "{",
		"ja.json":     "{",
	} {
		if err := os.WriteFile(filepath.Join(dir, filepath.Base(name)), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	s, err := notes.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	if got := s.Langs(); !reflect.DeepEqual(got, []string{"en"}) {
		t.Errorf("Langs = %v", got)
	}
}

func TestOpenFailures(t *testing.T) {
	t.Run("bad YAML", func(t *testing.T) {
		root := t.TempDir()
		dir := filepath.Join(root, ".pkgsight", "notes")
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "ja.yaml"), []byte("{"), 0o644); err != nil {
			t.Fatal(err)
		}
		if _, err := notes.Open(root); err == nil || !strings.Contains(err.Error(), "ja.yaml") {
			t.Errorf("err = %v, want one naming the file", err)
		}
	})
	t.Run("notes is a file", func(t *testing.T) {
		root := t.TempDir()
		if err := os.MkdirAll(filepath.Join(root, ".pkgsight"), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(root, ".pkgsight", "notes"), nil, 0o644); err != nil {
			t.Fatal(err)
		}
		if _, err := notes.Open(root); err == nil {
			t.Error("Open read a file as the notes directory")
		}
	})
	t.Run("unreadable book", func(t *testing.T) {
		root := t.TempDir()
		dir := filepath.Join(root, ".pkgsight", "notes")
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		// A dangling link reads as an error, whoever runs the test.
		if err := os.Symlink(filepath.Join(root, "gone"), filepath.Join(dir, "ja.yaml")); err != nil {
			t.Fatal(err)
		}
		if _, err := notes.Open(root); err == nil {
			t.Error("Open ignored a book it could not read")
		}
	})
}

func TestUpdateFailsToWrite(t *testing.T) {
	root := t.TempDir()
	s, err := notes.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	// .pkgsight is a file, so the notes directory cannot be made.
	if err := os.WriteFile(filepath.Join(root, ".pkgsight"), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	err = s.Update("ja", func(b *notes.Book) { b.Packages["p"] = notes.Note{Summary: "x"} })
	if err == nil {
		t.Fatal("Update reported no error")
	}
	// A failed write keeps the book as it was.
	if got := s.Book("ja").Packages; len(got) != 0 {
		t.Errorf("the failed note was kept: %+v", got)
	}
	if got := s.Langs(); len(got) != 0 {
		t.Errorf("Langs = %v", got)
	}
}

func TestBookIsACopy(t *testing.T) {
	s, err := notes.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	err = s.Update("ja", func(b *notes.Book) {
		b.Funcs["f"] = notes.FuncNote{Lines: []notes.LineNote{{Text: "a"}}}
	})
	if err != nil {
		t.Fatal(err)
	}
	b := s.Book("ja")
	b.Funcs["f"].Lines[0].Text = "changed"
	b.Packages["p"] = notes.Note{}
	again := s.Book("ja")
	if again.Funcs["f"].Lines[0].Text != "a" || len(again.Packages) != 0 {
		t.Errorf("changing a copy changed the store: %+v", again)
	}
	if empty := s.Book("en"); empty.Packages == nil || empty.Funcs == nil {
		t.Errorf("a missing book has nil maps: %+v", empty)
	}
}

func TestSubscribeDoesNotBlockWriters(t *testing.T) {
	s, err := notes.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	ch, cancel := s.Subscribe()
	// More changes than the channel holds, with nobody reading.
	for i := range 20 {
		if err := s.Update("ja", func(b *notes.Book) { b.Packages["p"] = notes.Note{Summary: fmt.Sprint(i)} }); err != nil {
			t.Fatal(err)
		}
	}
	if len(ch) == 0 {
		t.Error("the subscriber heard nothing")
	}
	cancel()
	for len(ch) > 0 {
		<-ch
	}
	if err := s.Update("ja", func(*notes.Book) {}); err != nil {
		t.Fatal(err)
	}
	if len(ch) != 0 {
		t.Error("a cancelled subscriber still hears changes")
	}
}

func TestPlaceAtTheEdges(t *testing.T) {
	src := []string{"func f() {", "\ta()", "}"}
	n := notes.FuncNote{Lines: []notes.LineNote{
		// Past the end of the file, and before the function.
		{Offset: 10, Hash: notes.HashLine("x"), Text: "after"},
		{Offset: -5, Hash: notes.HashLine("x"), Text: "before"},
		// The line moved up out of reach of a lower search.
		{Offset: 2, Hash: notes.HashLine("func f() {"), Text: "moved up"},
	}}
	want := []notes.Resolved{
		{Line: 1, Text: "before", Stale: true},
		{Line: 1, Text: "moved up"},
		{Line: 3, Text: "after", Stale: true},
	}
	if got := notes.Place(n, src, 1, 1, 3); !reflect.DeepEqual(got, want) {
		t.Errorf("Place = %+v, want %+v", got, want)
	}
}

func TestFailedWriteKeepsTheBook(t *testing.T) {
	if os.Getuid() == 0 {
		t.Skip("root writes to a read-only directory")
	}
	root := t.TempDir()
	s, err := notes.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	set := func(summary string) func(*notes.Book) {
		return func(b *notes.Book) { b.Packages["p"] = notes.Note{Summary: summary} }
	}
	if err := s.Update("ja", set("old")); err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(root, ".pkgsight", "notes")
	if err := os.Chmod(dir, 0o555); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(dir, 0o755) })

	if err := s.Update("ja", set("new")); err == nil {
		t.Fatal("Update wrote to a read-only directory")
	}
	if got := s.Book("ja").Packages["p"].Summary; got != "old" {
		t.Errorf("after a failed write the store has %q, the file has old", got)
	}
	// Emptying the book removes its file, which fails too.
	if err := s.Update("ja", func(b *notes.Book) { clear(b.Packages) }); err == nil {
		t.Error("Update removed a file from a read-only directory")
	}
	if got := s.Langs(); !reflect.DeepEqual(got, []string{"ja"}) {
		t.Errorf("Langs = %v", got)
	}
}

func TestFailedRenameLeavesNoTemporaryFile(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, ".pkgsight", "notes")
	// The book's name is taken by a directory, so the rename fails.
	if err := os.MkdirAll(filepath.Join(dir, "ja.yaml", "x"), 0o755); err != nil {
		t.Fatal(err)
	}
	s, err := notes.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Update("ja", func(b *notes.Book) { b.Packages["p"] = notes.Note{Summary: "x"} }); err == nil {
		t.Fatal("Update renamed over a directory")
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Errorf("left in the notes directory: %v", entries)
	}
}

func TestBookFileIsReadableYAML(t *testing.T) {
	root := t.TempDir()
	s, err := notes.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	err = s.Update("ja", func(b *notes.Book) {
		b.Packages["p"] = notes.Note{Summary: "no", Body: "一行目\n\n> [!NOTE]\n> 二行目"}
		b.Funcs["f"] = notes.FuncNote{Lines: []notes.LineNote{{Offset: -1, Hash: "12345678", Text: "t", Kind: notes.KindTip}}}
	})
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(root, ".pkgsight", "notes", "ja.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	// A multi-line body stays a block, and strings that look like other
	// types are quoted, so they read back as strings.
	for _, want := range []string{"body: |-\n      一行目\n\n      > [!NOTE]", `summary: "no"`, `hash: "12345678"`} {
		if !strings.Contains(text, want) {
			t.Errorf("the file has no %q:\n%s", want, text)
		}
	}
	again, err := notes.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	if got := again.Book("ja"); got.Packages["p"].Summary != "no" || got.Funcs["f"].Lines[0].Hash != "12345678" {
		t.Errorf("read back %+v", got)
	}
}

func TestUnknownKeysAreRejected(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, ".pkgsight", "notes")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "ja.yaml"), []byte("packages:\n  p:\n    colour: blue\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := notes.Open(root); err == nil || !strings.Contains(err.Error(), "colour") {
		t.Errorf("err = %v, want one naming the unknown key", err)
	}
}

func TestEmptyBookFile(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, ".pkgsight", "notes")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "ja.yaml"), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	s, err := notes.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	if b := s.Book("ja"); len(b.Packages)+len(b.Funcs) != 0 {
		t.Errorf("an empty file read as %+v", b)
	}
}
