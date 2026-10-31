//declscope:core
//declscope:shared

package main

import (
	"context"
	"fmt"
	"io"
	"log"
	"time"

	"github.com/urfave/cli/v3"

	"github.com/mpyw/pkgsight/internal/callgraph"
)

// logf writes a diagnostic. A failed write to stderr has nowhere to be
// reported, so its error is dropped here.
func logf(w io.Writer, format string, args ...any) {
	_, _ = fmt.Fprintf(w, format, args...)
}

// dirFlag is the directory a command analyzes.
func dirFlag() cli.Flag {
	return &cli.StringFlag{
		Name:    "dir",
		Aliases: []string{"C"},
		Value:   ".",
		Usage:   "the directory to run in",
	}
}

// groupAction runs a command that only holds others. Without arguments it
// shows the help. An argument is a command that does not exist.
func groupAction(_ context.Context, cmd *cli.Command) error {
	if cmd.Args().Present() {
		return cli.Exit(fmt.Sprintf("unknown command %q; see %s --help", cmd.Args().First(), cmd.FullName()), 2)
	}
	return cli.ShowSubcommandHelp(cmd)
}

// usageError reports a bad command line once, with exit status 2, as the
// flag package does. urfave/cli would print it, then return it too.
func usageError(_ context.Context, _ *cli.Command, err error, _ bool) error {
	return cli.Exit(err.Error()+"; see --help", 2)
}

// patterns returns the package patterns of cmd, ./... by default.
func patterns(cmd *cli.Command) []string {
	if cmd.Args().Len() == 0 {
		return []string{"./..."}
	}
	return cmd.Args().Slice()
}

// buildCallGraph builds the call graph, and logs how it went.
func buildCallGraph(ctx context.Context, logger *log.Logger, dir string, pats []string) (*callgraph.Graph, error) {
	start := time.Now()
	calls, err := callgraph.Build(ctx, dir, pats...)
	if err != nil {
		logger.Printf("call graph: %v", err)
		return nil, err
	}
	logger.Printf("built the call graph in %s", time.Since(start).Round(time.Millisecond))
	for _, p := range calls.Skipped() {
		logger.Printf("call graph: left out %s, which does not type-check: %s", p.Path, p.Error)
	}
	return calls, nil
}
