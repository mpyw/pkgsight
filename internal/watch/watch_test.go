package watch_test

import (
	"context"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/mpyw/pkgsight/internal/watch"
)

func write(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestSnapshot(t *testing.T) {
	root := t.TempDir()
	write(t, filepath.Join(root, "go.mod"), "module x\n")
	write(t, filepath.Join(root, "a", "a.go"), "package a\n")
	snap := func() string { return watch.Snapshot(root, []string{"a", "a", "gone"}) }
	before := snap()
	if snap() != before {
		t.Fatal("two snapshots of the same files differ")
	}

	// Files that are not Go code do not count, nor do directories outside.
	write(t, filepath.Join(root, "a", "README.md"), "x")
	write(t, filepath.Join(root, "b", "b.go"), "package b\n")
	if err := os.Mkdir(filepath.Join(root, "a", "sub.go"), 0o755); err != nil {
		t.Fatal(err)
	}
	if snap() != before {
		t.Error("a file nobody watches changed the snapshot")
	}

	for name, change := range map[string]func(){
		"a Go file":  func() { write(t, filepath.Join(root, "a", "a.go"), "package a\n\nfunc F() {}\n") },
		"go.mod":     func() { write(t, filepath.Join(root, "go.mod"), "module y\n") },
		"a new file": func() { write(t, filepath.Join(root, "a", "b.go"), "package a\n") },
		"a new dir":  func() { write(t, filepath.Join(root, "gone", "g.go"), "package gone\n") },
	} {
		prev := snap()
		change()
		if snap() == prev {
			t.Errorf("changing %s left the snapshot as it was", name)
		}
	}
}

func TestRunCallsOnceTheChangeSettles(t *testing.T) {
	var state atomic.Int64
	var calls atomic.Int64
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() {
		watch.Run(ctx, 10*time.Millisecond, func() string { return string(rune('a' + state.Load())) }, func() { calls.Add(1) })
		close(done)
	}()

	// Nothing changes: nothing is called.
	time.Sleep(60 * time.Millisecond)
	if calls.Load() != 0 {
		t.Fatalf("called %d times with no change", calls.Load())
	}
	// An editor writes in two steps, close together: one call.
	state.Store(1)
	time.Sleep(5 * time.Millisecond)
	state.Store(2)
	deadline := time.Now().Add(2 * time.Second)
	for calls.Load() == 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	time.Sleep(60 * time.Millisecond)
	if calls.Load() != 1 {
		t.Errorf("called %d times for one edit", calls.Load())
	}
	cancel()
	<-done
}

func TestRunNoticesAnEditDuringTheCall(t *testing.T) {
	var state atomic.Int64
	var calls atomic.Int64
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go watch.Run(ctx, 10*time.Millisecond, func() string { return string(rune('a' + state.Load())) }, func() {
		// The code changes again while the first change is handled.
		if calls.Add(1) == 1 {
			state.Store(2)
		}
	})
	// Let Run take its first snapshot before the code changes.
	time.Sleep(30 * time.Millisecond)
	state.Store(1)
	deadline := time.Now().Add(2 * time.Second)
	for calls.Load() < 2 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if calls.Load() != 2 {
		t.Errorf("called %d times, want a second call for the edit made during the first", calls.Load())
	}
}
