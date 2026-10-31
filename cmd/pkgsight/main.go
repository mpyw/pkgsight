// Command pkgsight draws the structure of a Go codebase in the browser.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"runtime/debug"
	"time"

	"github.com/mpyw/pkgsight/internal/callgraph"
	"github.com/mpyw/pkgsight/internal/load"
	"github.com/mpyw/pkgsight/internal/notes"
	"github.com/mpyw/pkgsight/internal/server"
	"github.com/mpyw/pkgsight/web"
)

const usage = `Usage: pkgsight serve [flags] [packages]

Commands:
  serve     Analyze packages (default ./...) and open the map in a browser
  version   Print the version

The server also answers MCP at /mcp, so an assistant can write notes that
the browser shows next to the code:

  claude mcp add --transport http pkgsight http://localhost:7878/mcp
`

func main() {
	log.SetFlags(0)
	if len(os.Args) < 2 {
		fmt.Fprint(os.Stderr, usage)
		os.Exit(2)
	}
	switch os.Args[1] {
	case "serve":
		if err := serve(os.Args[2:]); err != nil {
			log.Fatal(err)
		}
	case "version", "-version", "--version":
		fmt.Println(currentVersion())
	case "-h", "-help", "--help", "help":
		fmt.Print(usage)
	default:
		fmt.Fprintf(os.Stderr, "unknown command %q\n\n%s", os.Args[1], usage)
		os.Exit(2)
	}
}

// version is the release this binary was built from, written at link time
// with -X main.version=<version>. .goreleaser.yaml passes it.
var version string

// currentVersion falls back to the module version that go install records,
// and to "devel" for a build from a checkout.
func currentVersion() string {
	if version != "" {
		return version
	}
	if info, ok := debug.ReadBuildInfo(); ok && info.Main.Version != "" && info.Main.Version != "(devel)" {
		return info.Main.Version
	}
	return "devel"
}

func serve(args []string) error {
	fs := flag.NewFlagSet("serve", flag.ExitOnError)
	addr := fs.String("addr", "localhost:7878", "address to listen on")
	dir := fs.String("C", ".", "directory to run in")
	open := fs.Bool("open", true, "open the map in the default browser")
	_ = fs.Parse(args)
	patterns := fs.Args()
	if len(patterns) == 0 {
		patterns = []string{"./..."}
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	start := time.Now()
	g, err := load.Graph(ctx, *dir, patterns...)
	if err != nil {
		return err
	}
	log.Printf("loaded %d packages in %s", len(g.Packages), time.Since(start).Round(time.Millisecond))

	ln, err := net.Listen("tcp", *addr)
	if err != nil {
		return err
	}
	url := "http://" + ln.Addr().String()
	log.Printf("serving on %s, and MCP on %s/mcp", url, url)
	if *open {
		openBrowser(url)
	}

	store, err := notes.Open(g.Root)
	if err != nil {
		return err
	}
	api := server.New(g, web.Dist(), store, currentVersion())
	go func() {
		start := time.Now()
		calls, err := callgraph.Build(ctx, *dir, patterns...)
		took := time.Since(start)
		if err != nil {
			log.Printf("call graph: %v", err)
		} else {
			log.Printf("built the call graph in %s", took.Round(time.Millisecond))
		}
		api.SetCalls(calls, err, took)
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

func openBrowser(url string) {
	name := "xdg-open"
	switch runtime.GOOS {
	case "darwin":
		name = "open"
	case "windows":
		name = "explorer"
	}
	if err := exec.Command(name, url).Start(); err != nil {
		log.Printf("open %s yourself: %v", url, err)
	}
}
