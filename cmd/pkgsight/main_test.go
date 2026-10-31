package main

import (
	"bytes"
	"context"
	"strings"
	"testing"
)

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
