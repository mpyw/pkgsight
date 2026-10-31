//declscope:core

// Command pkgsight draws the structure of a Go codebase in the browser.
//
//	pkgsight serve [options] [packages]         the map, in a browser
//	pkgsight notes check [options] [packages]   notes that no longer hold
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"

	"github.com/urfave/cli/v3"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	code := run(ctx, os.Args, os.Stdout, os.Stderr)
	stop()
	os.Exit(code)
}

// run runs the command line in args, the program name first, and returns
// the exit status. Interrupting ctx stops the server.
func run(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	err := newRootCommand(stdout, stderr).Run(ctx, args)
	exit, isExit := errors.AsType[cli.ExitCoder](err)
	switch {
	case isExit:
		if msg := err.Error(); msg != "" {
			logf(stderr, "pkgsight: %s\n", msg)
		}
		return exit.ExitCode()
	case err != nil:
		logf(stderr, "pkgsight: %v\n", err)
		return 1
	}
	return 0
}

// logf writes a diagnostic. A failed write to stderr has nowhere to be
// reported, so its error is dropped here.
//
//declscope:shared // every command reports through it
func logf(w io.Writer, format string, args ...any) {
	_, _ = fmt.Fprintf(w, format, args...)
}

func newRootCommand(stdout, stderr io.Writer) *cli.Command {
	return &cli.Command{
		Name:      "pkgsight",
		Usage:     "see how a Go module is built and how its code runs, in your browser",
		Version:   currentVersion(),
		Writer:    stdout,
		ErrWriter: stderr,
		// run prints errors and picks the exit status; urfave/cli must not.
		ExitErrHandler:  func(context.Context, *cli.Command, error) {},
		HideHelpCommand: true,
		Suggest:         true,
		OnUsageError:    usageError,
		Action:          groupAction,
		Commands:        []*cli.Command{serveCommand(), notesCommand()},
	}
}

// dirFlag is the directory a command analyzes.
//
//declscope:shared // every command that analyzes packages takes it
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
//
//declscope:shared // notes.go holds its subcommands with it
func groupAction(_ context.Context, cmd *cli.Command) error {
	if cmd.Args().Present() {
		return cli.Exit(fmt.Sprintf("unknown command %q; see %s --help", cmd.Args().First(), cmd.FullName()), 2)
	}
	return cli.ShowSubcommandHelp(cmd)
}

// usageError reports a bad command line once, with exit status 2, as the
// flag package does. urfave/cli would print it, then return it too.
//
//declscope:shared // every command reports a bad command line with it
func usageError(_ context.Context, _ *cli.Command, err error, _ bool) error {
	return cli.Exit(err.Error()+"; see --help", 2)
}

// patterns returns the package patterns of cmd, ./... by default.
//
//declscope:shared // every command that analyzes packages takes them
func patterns(cmd *cli.Command) []string {
	if cmd.Args().Len() == 0 {
		return []string{"./..."}
	}
	return cmd.Args().Slice()
}
