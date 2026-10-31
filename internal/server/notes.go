package server

import (
	"fmt"
	"net/http"

	"github.com/mpyw/pkgsight/internal/freshness"
	"github.com/mpyw/pkgsight/internal/model"
	"github.com/mpyw/pkgsight/internal/notes"
)

// NotesView is the book of one language as the frontend reads it, with each
// line note placed on a line of the current source.
type NotesView struct {
	// Langs lists every language that has notes.
	Langs    []string                `json:"langs"`
	Lang     string                  `json:"lang"`
	Packages map[string]PackageNotes `json:"packages"`
	Funcs    map[string]FuncNotes    `json:"funcs"`
}

// PackageNotes is the note of a package, and whether it still holds.
type PackageNotes struct {
	notes.Note
	// Stale marks a note whose code changed since it was written. It is
	// left unset while the call graph is building.
	Stale bool `json:"stale,omitzero"`
}

// FuncNotes is the note of a function with its lines placed.
type FuncNotes struct {
	notes.Note
	// Lines are left out while the call graph, which knows where each
	// function is, is still building.
	Lines []notes.Resolved `json:"lines,omitempty"`
	Stale bool             `json:"stale,omitzero"`
}

//declscope:shared // routes in server.go serves it
func (s *Server) notesView(w http.ResponseWriter, r *http.Request) {
	lang := r.URL.Query().Get("lang")
	book := s.notes.Book(lang)
	v := NotesView{
		Langs:    s.notes.Langs(),
		Lang:     lang,
		Packages: make(map[string]PackageNotes, len(book.Packages)),
		Funcs:    make(map[string]FuncNotes, len(book.Funcs)),
	}
	g, _ := s.callGraph()
	var report freshness.Report
	code := freshness.New(s.packageGraph(), g, s.readSource)
	if g != nil {
		report = code.Check(book)
	}
	for path, n := range book.Packages {
		v.Packages[path] = PackageNotes{Note: n, Stale: report.Packages[path] == freshness.Stale}
	}
	for id, n := range book.Funcs {
		fn := FuncNotes{Note: n.Note, Stale: report.Funcs[id] == freshness.Stale}
		if g != nil {
			if d, ok := g.Func(id); ok {
				fn.Lines = placedNotes(code, n, d.Func)
			}
		}
		v.Funcs[id] = fn
	}
	writeJSON(w, v, http.StatusOK)
}

// placedNotes places the line notes of n in fn. A file that cannot be read
// leaves every note stale.
func placedNotes(code *freshness.Code, n notes.FuncNote, fn model.Func) []notes.Resolved {
	if len(n.Lines) == 0 {
		return nil
	}
	src, _ := code.Lines(fn.File)
	return notes.Place(n, src, fn.Line, fn.FirstLine(), fn.EndLine)
}

// notesEvents streams the language of each book that changes, so the
// frontend shows a note as soon as the assistant writes it. It streams each
// reload of the code too, as a code event.
//
//declscope:shared // routes in server.go serves it
func (s *Server) notesEvents(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming is not supported", http.StatusInternalServerError)
		return
	}
	ch, cancel := s.notes.Subscribe()
	defer cancel()
	code, stop := s.subscribeCode()
	defer stop()
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()
	for {
		select {
		case <-r.Context().Done():
			return
		case lang := <-ch:
			if _, err := fmt.Fprintf(w, "event: notes\ndata: %s\n\n", lang); err != nil {
				return
			}
			flusher.Flush()
		case <-code:
			if _, err := fmt.Fprint(w, "event: code\ndata: reloaded\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}
