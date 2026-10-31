package main

import (
	"bytes"
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mpyw/pkgsight/internal/callgraph"
	"github.com/mpyw/pkgsight/internal/freshness"
	"github.com/mpyw/pkgsight/internal/load"
	"github.com/mpyw/pkgsight/internal/notes"
)

func TestNotesCheck(t *testing.T) {
	dir := t.TempDir()
	if err := os.CopyFS(dir, os.DirFS(sample)); err != nil {
		t.Fatal(err)
	}
	check := func(args ...string) (int, string, string) {
		t.Helper()
		var stdout, stderr bytes.Buffer
		code := pkgsight(context.Background(), &stdout, &stderr, append([]string{"notes", "check", "-C", dir}, args...)...)
		return code, stdout.String(), stderr.String()
	}

	if code, out, _ := check(); code != 0 || out != "There are no notes.\n" {
		t.Errorf("no notes: exit %d, %q", code, out)
	}

	// A note written for the code as it is now.
	g, err := load.Graph(context.Background(), dir, "./...")
	if err != nil {
		t.Fatal(err)
	}
	calls, err := callgraph.Build(context.Background(), dir, "./...")
	if err != nil {
		t.Fatal(err)
	}
	run, _ := calls.Func("example.com/sample/app.Run")
	print, err := freshness.New(g, calls, notesFileReader(g)).FuncPrint(run.Func)
	if err != nil {
		t.Fatal(err)
	}
	store, err := notes.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Update("ja", func(b *notes.Book) {
		b.Funcs[run.ID] = notes.FuncNote{Note: notes.Note{Summary: "s", Fingerprint: print}}
	}); err != nil {
		t.Fatal(err)
	}
	if code, out, _ := check(); code != 0 || out != "Every note matches the code.\n" {
		t.Errorf("fresh notes: exit %d, %q", code, out)
	}

	// Another language with a note of a function that is gone.
	if err := store.Update("en", func(b *notes.Book) { b.Funcs["example.com/sample/app.Gone"] = notes.FuncNote{} }); err != nil {
		t.Fatal(err)
	}
	code, out, errOut := check()
	if code != 1 || out != "en: orphan function example.com/sample/app.Gone\n" || !strings.Contains(errOut, "1 notes do not match the code") {
		t.Errorf("an orphan: exit %d, %q, %q", code, out, errOut)
	}
	if code, out, _ := check("--lang", "ja"); code != 0 || out != "Every note matches the code.\n" {
		t.Errorf("only ja: exit %d, %q", code, out)
	}
	// Patterns choose which notes to report. The orphan lives in app, which
	// ./cmd/... does not cover, and it is not taken for an orphan of cmd.
	if code, out, _ := check("./cmd/..."); code != 0 || out != "Every note matches the code.\n" {
		t.Errorf("only cmd: exit %d, %q", code, out)
	}
	if code, out, _ := check("./app"); code != 1 || out != "en: orphan function example.com/sample/app.Gone\n" {
		t.Errorf("only app: exit %d, %q", code, out)
	}
	if code, _, _ := check("example.com/nope"); code != 1 {
		t.Errorf("a bad pattern: exit %d", code)
	}
}

func TestNotesCheckFailures(t *testing.T) {
	badNotes := t.TempDir()
	if err := os.CopyFS(badNotes, os.DirFS(sample)); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(badNotes, ".pkgsight", "notes"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(badNotes, ".pkgsight", "notes", "ja.json"), []byte("{"), 0o644); err != nil {
		t.Fatal(err)
	}
	for name, dir := range map[string]string{
		"no such directory": filepath.Join(t.TempDir(), "missing"),
		"bad notes file":    badNotes,
	} {
		t.Run(name, func(t *testing.T) {
			if code := pkgsight(context.Background(), io.Discard, io.Discard, "notes", "check", "-C", dir); code != 1 {
				t.Errorf("exit %d, want 1", code)
			}
		})
	}
}
