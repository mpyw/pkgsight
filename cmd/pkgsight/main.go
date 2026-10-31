// Command pkgsight draws the structure of a Go codebase in the browser.
//
//	pkgsight serve [options] [packages]         the map, in a browser
//	pkgsight notes check [options] [packages]   notes that no longer hold
package main

import (
	"context"
	"errors"
	"io"
	"os"
	"os/signal"

	"github.com/urfave/cli/v3"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	// After the first interrupt, the next ends pkgsight at once, as a stuck
	// shutdown would otherwise wait out its timeout.
	go func() {
		<-ctx.Done()
		stop()
	}()
	code := runMain(ctx, os.Args, os.Stdout, os.Stderr)
	stop()
	os.Exit(code)
}

// runMain runs the command line in args, the program name first, and
// returns the exit status. Interrupting ctx stops the server.
//
//declscope:shared // the tests in utils_test.go run every command through it
func runMain(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	err := mainCommand(stdout, stderr).Run(ctx, args)
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

// mainCommand is pkgsight, which holds every command.
func mainCommand(stdout, stderr io.Writer) *cli.Command {
	return &cli.Command{
		Name:      "pkgsight",
		Usage:     "see how a Go module is built and how its code runs, in your browser",
		Version:   currentVersion(),
		Writer:    stdout,
		ErrWriter: stderr,
		// runMain prints errors and picks the exit status; urfave/cli must not.
		ExitErrHandler:  func(context.Context, *cli.Command, error) {},
		HideHelpCommand: true,
		Suggest:         true,
		OnUsageError:    usageError,
		Action:          groupAction,
		Commands:        []*cli.Command{serveCommand(), notesCommand()},
	}
}
