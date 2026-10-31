package server

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/mpyw/pkgsight/internal/model"
	"github.com/mpyw/pkgsight/internal/notes"
)

// NotesView is the book of one language as the frontend reads it, with each
// line note placed on a line of the current source.
type NotesView struct {
	// Langs lists every language that has notes.
	Langs    []string              `json:"langs"`
	Lang     string                `json:"lang"`
	Packages map[string]notes.Note `json:"packages"`
	Funcs    map[string]FuncNotes  `json:"funcs"`
}

// FuncNotes is the note of a function with its lines placed.
type FuncNotes struct {
	notes.Note
	// Lines are left out while the call graph, which knows where each
	// function is, is still building.
	Lines []notes.Resolved `json:"lines,omitempty"`
}

//declscope:shared // routes in server.go serves it
func (s *Server) notesView(w http.ResponseWriter, r *http.Request) {
	lang := r.URL.Query().Get("lang")
	book := s.notes.Book(lang)
	v := NotesView{
		Langs:    s.notes.Langs(),
		Lang:     lang,
		Packages: book.Packages,
		Funcs:    make(map[string]FuncNotes, len(book.Funcs)),
	}
	g, _ := s.callGraph()
	files := map[string][]string{}
	for id, n := range book.Funcs {
		fn := FuncNotes{Note: n.Note}
		if g != nil {
			if d, ok := g.Func(id); ok {
				fn.Lines = s.placedNotes(n, d.Func, files)
			}
		}
		v.Funcs[id] = fn
	}
	writeJSON(w, v, http.StatusOK)
}

// placedNotes places the line notes of n in fn, reading each file once
// through cache.
func (s *Server) placedNotes(n notes.FuncNote, fn model.Func, cache map[string][]string) []notes.Resolved {
	if len(n.Lines) == 0 || fn.File == "" {
		return nil
	}
	src, ok := cache[fn.File]
	if !ok {
		if b, err := s.readSource(fn.File); err == nil {
			src = strings.Split(string(b), "\n")
		}
		cache[fn.File] = src
	}
	return notes.Place(n, src, fn.Line, fn.FirstLine(), fn.EndLine)
}

// notesEvents streams the language of each book that changes, so the
// frontend shows a note as soon as the assistant writes it.
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
		}
	}
}
