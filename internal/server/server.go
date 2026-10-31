//declscope:core

// Package server serves the package graph, the call graph and the notes to
// the frontend that draws them, and to an assistant over MCP.
package server

import (
	"encoding/json/v2"
	"errors"
	"io/fs"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/mpyw/pkgsight/internal/callgraph"
	"github.com/mpyw/pkgsight/internal/mcpserver"
	"github.com/mpyw/pkgsight/internal/model"
	"github.com/mpyw/pkgsight/internal/notes"
)

// Server answers the API. The package graph is there from the start; the
// call graph arrives later through SetCalls, since it takes longer to build.
type Server struct {
	//declscope:shared // notes.go reads the code its notes describe
	model  *model.Graph
	graph  []byte
	root   string
	files  map[string]bool
	assets fs.FS
	//declscope:shared // notes.go serves the notes
	notes *notes.Store
	mux   *http.ServeMux

	mu       sync.RWMutex
	calls    *callgraph.Graph
	callsErr error
	took     time.Duration
}

// New returns a server for g that serves assets for every path outside /api
// and /mcp, and keeps notes in store. version is what MCP reports.
func New(g *model.Graph, assets fs.FS, store *notes.Store, version string) *Server {
	graph, err := json.Marshal(g)
	if err != nil {
		panic(err)
	}
	files := map[string]bool{}
	for _, p := range g.Packages {
		if p.Kind == model.KindOwn {
			for _, f := range p.Files {
				files[filepath.ToSlash(filepath.Join(p.Dir, f))] = true
			}
		}
	}
	s := &Server{model: g, graph: graph, root: g.Root, files: files, assets: assets, notes: store}
	s.mux = s.routes(version)
	return s
}

// callGraph returns the call graph, or nil while it is building. The error
// is why it failed.
//
//declscope:shared // notes.go places line notes by where each function is
func (s *Server) callGraph() (*callgraph.Graph, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.calls, s.callsErr
}

// SetCalls hands over the call graph, or the reason there is none.
func (s *Server) SetCalls(g *callgraph.Graph, err error, took time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls, s.callsErr, s.took = g, err, took
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mux.ServeHTTP(w, r)
}

func (s *Server) routes(version string) *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/graph", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(s.graph)
	})
	mux.HandleFunc("GET /api/calls/status", s.status)
	mux.HandleFunc("GET /api/calls/entries", s.withCalls(func(g *callgraph.Graph, _ *http.Request) (any, int) {
		return g.Entries(), http.StatusOK
	}))
	mux.HandleFunc("GET /api/calls/func", s.withCalls(func(g *callgraph.Graph, r *http.Request) (any, int) {
		d, ok := g.Func(r.URL.Query().Get("id"))
		if !ok {
			return "no such function", http.StatusNotFound
		}
		return d, http.StatusOK
	}))
	mux.HandleFunc("GET /api/calls/package", s.withCalls(func(g *callgraph.Graph, r *http.Request) (any, int) {
		return g.Package(r.URL.Query().Get("path")), http.StatusOK
	}))
	mux.HandleFunc("GET /api/calls/search", s.withCalls(func(g *callgraph.Graph, r *http.Request) (any, int) {
		limit, err := strconv.Atoi(r.URL.Query().Get("limit"))
		switch {
		case err != nil || limit <= 0:
			limit = 50
		case limit > 200:
			limit = 200
		}
		return g.Search(r.URL.Query().Get("q"), limit), http.StatusOK
	}))
	mux.HandleFunc("GET /api/source", s.source)
	mux.HandleFunc("GET /api/asset", s.asset)
	mux.HandleFunc("GET /api/notes", s.notesView)
	mux.HandleFunc("GET /api/notes/events", s.notesEvents)
	mcpHandler := mcpserver.Handler(mcpserver.Backend{
		Graph:      s.model,
		Notes:      s.notes,
		Calls:      s.callGraph,
		ReadSource: s.readSource,
		Version:    version,
	})
	for _, method := range []string{"GET", "POST", "DELETE"} {
		mux.Handle(method+" /mcp", mcpHandler)
	}
	mux.Handle("GET /", frontend(s.assets))
	return mux
}

func (s *Server) status(w http.ResponseWriter, _ *http.Request) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	st := struct {
		State string `json:"state"`
		Error string `json:"error,omitempty"`
		Took  int64  `json:"tookMs,omitzero"`
		// Skipped lists the packages that do not type-check, whose
		// functions are missing from the call graph.
		Skipped []model.SkippedPackage `json:"skipped,omitempty"`
	}{State: "pending"}
	switch {
	case s.callsErr != nil:
		st.State, st.Error = "error", s.callsErr.Error()
	case s.calls != nil:
		st.State, st.Took, st.Skipped = "ready", s.took.Milliseconds(), s.calls.Skipped()
	}
	writeJSON(w, st, http.StatusOK)
}

// withCalls answers 503 until the call graph is built.
func (s *Server) withCalls(h func(*callgraph.Graph, *http.Request) (any, int)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		g, _ := s.callGraph()
		if g == nil {
			http.Error(w, "the call graph is not ready", http.StatusServiceUnavailable)
			return
		}
		v, status := h(g, r)
		if msg, ok := v.(string); ok && status != http.StatusOK {
			http.Error(w, msg, status)
			return
		}
		writeJSON(w, v, status)
	}
}

// source serves a Go file of an own package, and nothing else.
func (s *Server) source(w http.ResponseWriter, r *http.Request) {
	file := r.URL.Query().Get("file")
	if !s.files[file] {
		http.Error(w, "not a file of the module", http.StatusNotFound)
		return
	}
	b, err := s.readSource(file)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = w.Write(b)
}

// imageTypes are the files that /api/asset serves, so a note can show an
// image of the repository and nothing else.
var imageTypes = map[string]string{
	".png":  "image/png",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".gif":  "image/gif",
	".webp": "image/webp",
	".avif": "image/avif",
	".svg":  "image/svg+xml",
}

// asset serves an image under the root by its slash path. os.Root keeps
// the path, symbolic links included, from leaving the root.
func (s *Server) asset(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("path")
	typ, ok := imageTypes[strings.ToLower(path.Ext(name))]
	if !ok || !fs.ValidPath(name) || slices.Contains(strings.Split(name, "/"), ".git") {
		http.Error(w, "not an image of the repository", http.StatusNotFound)
		return
	}
	root, err := os.OpenRoot(s.root)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer func() { _ = root.Close() }()
	b, err := root.ReadFile(filepath.FromSlash(name))
	if err != nil {
		http.Error(w, "not an image of the repository", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", typ)
	// An SVG opened on its own must not run scripts on this origin.
	w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write(b)
}

// readSource reads a file of the module by its slash path from the root.
//
//declscope:shared // notes.go places line notes on the source
func (s *Server) readSource(file string) ([]byte, error) {
	return os.ReadFile(filepath.Join(s.root, filepath.FromSlash(file)))
}

//declscope:shared // every handler answers with it
func writeJSON(w http.ResponseWriter, v any, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.MarshalWrite(w, v)
}

// frontend serves assets, and index.html for any path that is not a file,
// so a URL the app built survives a reload.
func frontend(assets fs.FS) http.Handler {
	files := http.FileServerFS(assets)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := fs.Stat(assets, "index.html"); errors.Is(err, fs.ErrNotExist) {
			http.Error(w, "the frontend is not built: run `mise run web-build`, then rebuild pkgsight", http.StatusNotFound)
			return
		}
		name := r.URL.Path[1:]
		if name == "" {
			name = "."
		}
		if _, err := fs.Stat(assets, name); err != nil {
			http.ServeFileFS(w, r, assets, "index.html")
			return
		}
		files.ServeHTTP(w, r)
	})
}
