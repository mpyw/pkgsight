package main

import (
	"bytes"
	"context"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestServe(t *testing.T) {
	var opened []string
	old := openServed
	openServed = func(_ *log.Logger, url string) { opened = append(opened, url) }
	t.Cleanup(func() { openServed = old })

	ctx, cancel := context.WithCancel(context.Background())
	var stderr lockedBuffer
	done := make(chan int)
	go func() {
		done <- pkgsight(ctx, io.Discard, &stderr, "serve", "--addr", "127.0.0.1:0", "-C", sample, "./...")
	}()

	url := waitFor(t, &stderr, `serving on (http://[^,]+),`)
	waitFor(t, &stderr, `built the call graph in`)
	if len(opened) != 1 || opened[0] != url {
		t.Errorf("opened %v, want [%s]", opened, url)
	}
	for _, path := range []string{"/api/graph", "/api/calls/entries"} {
		resp, err := http.Get(url + path)
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Errorf("GET %s = %d", path, resp.StatusCode)
		}
	}

	cancel()
	select {
	case code := <-done:
		if code != 0 {
			t.Errorf("exit %d after the interrupt:\n%s", code, stderr.String())
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the server did not stop")
	}
}

func TestServeFailures(t *testing.T) {
	badNotes := t.TempDir()
	if err := os.CopyFS(badNotes, os.DirFS(sample)); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(badNotes, ".pkgsight", "notes"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(badNotes, ".pkgsight", "notes", "ja.yaml"), []byte("{"), 0o644); err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name string
		args []string
		want string
	}{
		{"no such directory", []string{"-C", filepath.Join(t.TempDir(), "missing")}, "missing: no such file or directory"},
		{"bad notes file", []string{"-C", badNotes}, "ja.yaml"},
		{"bad address", []string{"--addr", "256.0.0.1:0", "-C", sample}, "listen"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var stderr bytes.Buffer
			args := append([]string{"serve", "--open=false"}, tt.args...)
			if code := pkgsight(context.Background(), io.Discard, &stderr, args...); code != 1 {
				t.Errorf("exit %d, want 1", code)
			}
			if !strings.Contains(stderr.String(), tt.want) {
				t.Errorf("stderr = %q, want %q in it", stderr.String(), tt.want)
			}
			if strings.Contains(stderr.String(), "serving on") {
				t.Errorf("it listened before failing:\n%s", stderr.String())
			}
		})
	}
}

func TestOpenServedPage(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("explorer cannot be faked with a shell script")
	}
	bin := t.TempDir()
	got := filepath.Join(bin, "opened")
	for _, name := range []string{"open", "xdg-open"} {
		script := "#!/bin/sh\necho \"$1\" > " + got + "\n"
		if err := os.WriteFile(filepath.Join(bin, name), []byte(script), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("PATH", bin)

	var logged bytes.Buffer
	openServedPage(log.New(&logged, "", 0), "http://example.test")
	deadline := time.Now().Add(5 * time.Second)
	for {
		b, _ := os.ReadFile(got)
		if strings.TrimSpace(string(b)) == "http://example.test" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("the browser got %q", b)
		}
		time.Sleep(20 * time.Millisecond)
	}

	t.Setenv("PATH", t.TempDir())
	openServedPage(log.New(&logged, "", 0), "http://example.test")
	if !strings.Contains(logged.String(), "open http://example.test yourself") {
		t.Errorf("log = %q", logged.String())
	}
}

func TestServeWarnsOfSkippedPackages(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	var stderr lockedBuffer
	done := make(chan int)
	go func() {
		done <- pkgsight(ctx, io.Discard, &stderr, "serve", "--open=false", "--addr", "127.0.0.1:0", "-C", "../../internal/callgraph/testdata/broken")
	}()
	waitFor(t, &stderr, `call graph: left out example.com/broken, which does not type-check: `)
	cancel()
	<-done
}

// serveCopy serves a copy of the sample with args, and returns its URL, its
// directory, its log and a function that stops it.
func serveCopy(t *testing.T, args ...string) (string, string, *lockedBuffer, func()) {
	t.Helper()
	dir := t.TempDir()
	if err := os.CopyFS(dir, os.DirFS(sample)); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	var stderr lockedBuffer
	done := make(chan int)
	go func() {
		done <- pkgsight(ctx, io.Discard, &stderr, append([]string{"serve", "--open=false", "--addr", "127.0.0.1:0", "-C", dir}, args...)...)
	}()
	url := waitFor(t, &stderr, `serving on (http://[^,]+),`)
	waitFor(t, &stderr, `built the call graph in`)
	return url, dir, &stderr, func() { cancel(); <-done }
}

// servedStatus returns the HTTP status of GET url.
func servedStatus(t *testing.T, url string) int {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	return resp.StatusCode
}

func TestServeReloadsWhenTheCodeChanges(t *testing.T) {
	url, dir, stderr, stop := serveCopy(t)
	defer stop()
	added := url + "/api/calls/func?id=example.com/sample/app.Added"
	if got := servedStatus(t, added); got != http.StatusNotFound {
		t.Fatalf("Added before it exists: %d", got)
	}
	f, err := os.OpenFile(filepath.Join(dir, "app", "app.go"), os.O_APPEND|os.O_WRONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.WriteString("\n// Added is new.\nfunc Added() {}\n"); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	waitFor(t, stderr, `reloaded after a change`)
	if got := servedStatus(t, added); got != http.StatusOK {
		t.Errorf("Added after the reload: %d", got)
	}
}

func TestServeWithoutWatching(t *testing.T) {
	url, dir, stderr, stop := serveCopy(t, "--watch=false")
	defer stop()
	if err := os.WriteFile(filepath.Join(dir, "app", "more.go"), []byte("package app\n\nfunc More() {}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	time.Sleep(1500 * time.Millisecond)
	if strings.Contains(stderr.String(), "reloaded") {
		t.Error("reloaded with --watch=false")
	}
	if got := servedStatus(t, url+"/api/calls/func?id=example.com/sample/app.More"); got != http.StatusNotFound {
		t.Errorf("More without watching: %d", got)
	}
}
