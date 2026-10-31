package main

import (
	"bytes"
	"context"
	"io"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"
)

//declscope:shared // every command's tests run against it
const sample = "../../internal/callgraph/testdata/sample"

// lockedBuffer collects what the server logs from several goroutines.
//
//declscope:shared // serve_test.go reads the server's log through it
type lockedBuffer struct {
	//declscope:private // only its methods touch it
	mu sync.Mutex
	//declscope:private // only its methods touch it
	buf bytes.Buffer
}

func (b *lockedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *lockedBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

// waitFor polls the log until pattern matches, and returns the first group.
//
//declscope:shared // serve_test.go waits for the server through it
func waitFor(t *testing.T, log *lockedBuffer, pattern string) string {
	t.Helper()
	re := regexp.MustCompile(pattern)
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		if m := re.FindStringSubmatch(log.String()); m != nil {
			if len(m) > 1 {
				return m[1]
			}
			return m[0]
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("no %q in the log:\n%s", pattern, log.String())
	return ""
}

// pkgsight runs the command line args, without the program name.
//
//declscope:shared // every command's tests run through it
func pkgsight(ctx context.Context, stdout, stderr io.Writer, args ...string) int {
	return run(ctx, append([]string{"pkgsight"}, args...), stdout, stderr)
}

func TestRunCommands(t *testing.T) {
	tests := []struct {
		args   []string
		code   int
		stdout string
		stderr string
	}{
		{args: nil, code: 0, stdout: "COMMANDS:"},
		{args: []string{"--help"}, code: 0, stdout: "serve"},
		{args: []string{"--version"}, code: 0, stdout: "pkgsight version devel\n"},
		{args: []string{"nope"}, code: 2, stderr: `unknown command "nope"; see pkgsight --help`},
		{args: []string{"--bogus"}, code: 2, stderr: "flag provided but not defined: -bogus"},
		{args: []string{"serve", "--bogus"}, code: 2, stderr: "flag provided but not defined: -bogus"},
		{args: []string{"serve", "--help"}, code: 0, stdout: "--addr string"},
		{args: []string{"notes"}, code: 0, stdout: "check"},
		{args: []string{"notes", "nope"}, code: 2, stderr: `unknown command "nope"; see pkgsight notes --help`},
		{args: []string{"notes", "--bogus"}, code: 2, stderr: "flag provided but not defined: -bogus"},
		{args: []string{"notes", "check", "--bogus"}, code: 2, stderr: "flag provided but not defined: -bogus"},
	}
	for _, tt := range tests {
		t.Run(strings.Join(tt.args, " "), func(t *testing.T) {
			var stdout, stderr bytes.Buffer
			if code := pkgsight(context.Background(), &stdout, &stderr, tt.args...); code != tt.code {
				t.Errorf("exit %d, want %d; stderr:\n%s", code, tt.code, stderr.String())
			}
			if !strings.Contains(stdout.String(), tt.stdout) {
				t.Errorf("stdout = %q, want %q in it", stdout.String(), tt.stdout)
			}
			if !strings.Contains(stderr.String(), tt.stderr) {
				t.Errorf("stderr = %q, want %q in it", stderr.String(), tt.stderr)
			}
		})
	}
}

func TestBadFlagIsReportedOnce(t *testing.T) {
	var stdout, stderr bytes.Buffer
	pkgsight(context.Background(), &stdout, &stderr, "serve", "--bogus")
	if n := strings.Count(stdout.String()+stderr.String(), "not defined"); n != 1 {
		t.Errorf("the error shows %d times:\n%s%s", n, stdout.String(), stderr.String())
	}
}
