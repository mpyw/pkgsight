package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"slices"

	"github.com/urfave/cli/v3"

	"github.com/mpyw/pkgsight/internal/callgraph"
	"github.com/mpyw/pkgsight/internal/freshness"
	"github.com/mpyw/pkgsight/internal/load"
	"github.com/mpyw/pkgsight/internal/model"
	"github.com/mpyw/pkgsight/internal/notes"
)

// notesCommand is pkgsight notes, which holds the commands on notes.
//
//declscope:shared // mainCommand in main.go holds it
func notesCommand() *cli.Command {
	return &cli.Command{
		Name:         "notes",
		Usage:        "work with the notes in .pkgsight/notes",
		OnUsageError: usageError,
		Action:       groupAction,
		Commands: []*cli.Command{
			{
				Name:      "check",
				Usage:     "list the notes whose code changed or is gone, and fail if there are any",
				ArgsUsage: "[packages]",
				Flags: []cli.Flag{
					dirFlag(),
					&cli.StringSliceFlag{Name: "lang", Usage: "check only these languages, such as ja (default: all)"},
				},
				OnUsageError: usageError,
				Action:       notesCheckAction,
			},
		},
	}
}

// notesCheckAction lists every note that is not fresh, one per line, and
// fails when there is any, so CI can require notes to keep up.
func notesCheckAction(ctx context.Context, cmd *cli.Command) error {
	out := cmd.Root().Writer
	dir := cmd.String("dir")
	// Check against the whole module, so a note of a package outside the
	// patterns is not taken for an orphan. The patterns only choose which
	// notes to report.
	g, err := load.Graph(ctx, dir, "./...")
	if err != nil {
		return err
	}
	calls, err := callgraph.Build(ctx, dir, "./...")
	if err != nil {
		return err
	}
	inScope := func(string) bool { return true }
	if cmd.Args().Present() {
		paths, err := load.Packages(ctx, dir, patterns(cmd)...)
		if err != nil {
			return err
		}
		inScope = func(path string) bool { return slices.Contains(paths, path) }
	}
	store, err := notes.Open(g.Root)
	if err != nil {
		return err
	}
	langs := cmd.StringSlice("lang")
	if len(langs) == 0 {
		langs = store.Langs()
	}
	code := freshness.New(g, calls, notesFileReader(g))
	bad := 0
	for _, lang := range langs {
		for _, p := range code.Check(store.Book(lang)).Problems() {
			pkg := p.Key
			if p.Kind == "function" {
				pkg = freshness.PackageOf(p.Key)
			}
			if !inScope(pkg) {
				continue
			}
			logf(out, "%s: %s %s %s\n", lang, p.State, p.Kind, p.Key)
			bad++
		}
	}
	switch {
	case bad > 0:
		return cli.Exit(fmt.Sprintf("%d notes do not match the code; ask an assistant to run the refresh_notes prompt", bad), 1)
	case len(langs) == 0:
		logf(out, "There are no notes.\n")
	default:
		logf(out, "Every note matches the code.\n")
	}
	return nil
}

// notesFileReader reads a file of g by its slash path from the root.
func notesFileReader(g *model.Graph) func(string) ([]byte, error) {
	return func(file string) ([]byte, error) {
		return os.ReadFile(filepath.Join(g.Root, filepath.FromSlash(file)))
	}
}
