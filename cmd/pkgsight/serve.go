package main

import (
	"context"
	"errors"
	"log"
	"net"
	"net/http"
	"os/exec"
	"runtime"
	"time"

	"github.com/urfave/cli/v3"

	"github.com/mpyw/pkgsight/internal/load"
	"github.com/mpyw/pkgsight/internal/model"
	"github.com/mpyw/pkgsight/internal/notes"
	"github.com/mpyw/pkgsight/internal/server"
	"github.com/mpyw/pkgsight/internal/watch"
	"github.com/mpyw/pkgsight/web"
)

// serveCommand is pkgsight serve.
//
//declscope:shared // mainCommand in main.go holds it
func serveCommand() *cli.Command {
	return &cli.Command{
		Name:      "serve",
		Usage:     "analyze the packages and open them in the browser",
		ArgsUsage: "[packages]",
		Description: "Packages default to ./..., as for the go command.\n" +
			"The server also answers MCP at /mcp, so an assistant can write notes:\n\n" +
			"  claude mcp add --transport http pkgsight http://localhost:7878/mcp",
		Flags: []cli.Flag{
			dirFlag(),
			&cli.StringFlag{Name: "addr", Value: "localhost:7878", Usage: "the address to listen on"},
			&cli.BoolFlag{Name: "open", Value: true, Usage: "open the browser; --open=false does not"},
			&cli.BoolFlag{Name: "watch", Value: true, Usage: "analyze again when the code changes; --watch=false does not"},
		},
		OnUsageError: usageError,
		Action:       serveAction,
	}
}

// openServed opens url in the default browser. Tests replace it.
var openServed = openServedPage

// serveAction serves the map, the API and MCP until ctx ends.
func serveAction(ctx context.Context, cmd *cli.Command) error {
	logger := log.New(cmd.Root().ErrWriter, "", 0)
	dir, pats := cmd.String("dir"), patterns(cmd)

	start := time.Now()
	g, err := load.Graph(ctx, dir, pats...)
	if err != nil {
		return err
	}
	logger.Printf("loaded %d packages in %s", len(g.Packages), time.Since(start).Round(time.Millisecond))

	// Read the notes before listening, so a bad notes file leaves no
	// listener behind.
	store, err := notes.Open(g.Root)
	if err != nil {
		return err
	}

	ln, err := net.Listen("tcp", cmd.String("addr"))
	if err != nil {
		return err
	}
	url := "http://" + ln.Addr().String()
	logger.Printf("serving on %s, and MCP on %s/mcp", url, url)
	if cmd.Bool("open") {
		openServed(logger, url)
	}

	api := server.New(g, web.Dist(), store, currentVersion())
	go func() {
		start := time.Now()
		calls, err := buildCallGraph(ctx, logger, dir, pats)
		api.SetCalls(calls, err, time.Since(start))
		// Watch only now, so a reload never lands before the first build.
		if cmd.Bool("watch") {
			serveWatching(ctx, logger, api, g, dir, pats)
		}
	}()

	// Requests share ctx, so open streams end when the server stops.
	srv := &http.Server{
		Handler:           api,
		ReadHeaderTimeout: 5 * time.Second,
		BaseContext:       func(net.Listener) context.Context { return ctx },
	}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdown)
	}()
	if err := srv.Serve(ln); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// serveWatching analyzes the code again each time it changes, until ctx
// ends, and hands the result to api. g is the package graph to start from.
func serveWatching(ctx context.Context, logger *log.Logger, api *server.Server, g *model.Graph, dir string, pats []string) {
	snapshot := func() string {
		var dirs []string
		for _, p := range g.Packages {
			if p.Kind == model.KindOwn {
				dirs = append(dirs, p.Dir)
			}
		}
		return watch.Snapshot(g.Root, dirs)
	}
	watch.Run(ctx, 500*time.Millisecond, snapshot, func() {
		start := time.Now()
		next, err := load.Graph(ctx, dir, pats...)
		if err != nil {
			logger.Printf("reload: %v", err)
			return
		}
		calls, err := buildCallGraph(ctx, logger, dir, pats)
		g = next
		api.Reload(next, calls, err, time.Since(start))
		logger.Printf("reloaded after a change, in %s", time.Since(start).Round(time.Millisecond))
	})
}

// openServedPage opens url with the platform's opener.
func openServedPage(logger *log.Logger, url string) {
	name := "xdg-open"
	switch runtime.GOOS {
	case "darwin":
		name = "open"
	case "windows":
		name = "explorer"
	}
	if err := exec.Command(name, url).Start(); err != nil {
		logger.Printf("open %s yourself: %v", url, err)
	}
}
