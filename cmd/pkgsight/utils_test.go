//declscope:core
//declscope:shared

package main

import (
	"bytes"
	"context"
	"io"
	"regexp"
	"sync"
	"testing"
	"time"
)

// sample is the module that the commands run on in tests.
const sample = "../../internal/callgraph/testdata/sample"

// lockedBuffer collects what the server logs from several goroutines.
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
func pkgsight(ctx context.Context, stdout, stderr io.Writer, args ...string) int {
	return runMain(ctx, append([]string{"pkgsight"}, args...), stdout, stderr)
}
