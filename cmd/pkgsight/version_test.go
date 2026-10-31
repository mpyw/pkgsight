package main

import (
	"bytes"
	"context"
	"io"
	"testing"
)

func TestVersionFromLinker(t *testing.T) {
	old := version
	version = "1.2.3"
	t.Cleanup(func() { version = old })
	var stdout bytes.Buffer
	pkgsight(context.Background(), &stdout, io.Discard, "--version")
	if stdout.String() != "pkgsight version 1.2.3\n" {
		t.Errorf("version = %q", stdout.String())
	}
}
