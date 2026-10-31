// Package watch tells when the Go code of a module changes.
//
// It polls instead of asking the operating system to notify it. On macOS,
// notifications cost a file descriptor for every file watched, and a large
// module runs out of them. Polling reads only the sizes and times of the Go
// files in each package directory.
package watch

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
)

// Snapshot fingerprints the Go files, go.mod, go.sum and go.work in the
// directories dirs, given relative to root, and in root itself. A change to
// any of them changes it.
func Snapshot(root string, dirs []string) string {
	dirs = append([]string{"."}, dirs...)
	slices.Sort(dirs)
	dirs = slices.Compact(dirs)
	// A hash.Hash never fails to write, so the errors below are dropped.
	h := sha256.New()
	for _, dir := range dirs {
		entries, err := os.ReadDir(filepath.Join(root, dir))
		if err != nil {
			// A directory that is gone is a change too.
			_, _ = fmt.Fprintf(h, "%s: %v\n", dir, err)
			continue
		}
		for _, e := range entries {
			if !watched(e.Name()) || e.IsDir() {
				continue
			}
			info, err := e.Info()
			if err != nil {
				continue
			}
			_, _ = fmt.Fprintf(h, "%s/%s %d %d\n", dir, e.Name(), info.Size(), info.ModTime().UnixNano())
		}
	}
	return hex.EncodeToString(h.Sum(nil))
}

func watched(name string) bool {
	switch name {
	case "go.mod", "go.sum", "go.work":
		return true
	}
	return strings.HasSuffix(name, ".go")
}

// Run calls snapshot every interval until ctx ends. Once a snapshot differs
// from the one before, it waits for two in a row to agree, so an editor that
// writes in steps triggers one change, then calls changed. A change made
// while changed runs is noticed on the next poll.
func Run(ctx context.Context, interval time.Duration, snapshot func() string, changed func()) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	last, settling := snapshot(), false
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		now := snapshot()
		switch {
		case now != last:
			last, settling = now, true
		case settling:
			// last is from before changed runs, so an edit made meanwhile
			// differs from it on the next poll.
			settling = false
			changed()
		}
	}
}
