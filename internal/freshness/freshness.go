// Package freshness tells whether a note still describes the code it was
// written for.
//
// A note keeps a fingerprint of its code from when it was written. A
// function's fingerprint is a hash of its tokens: comments, blank lines and
// layout do not count, so gofmt or a reworded comment leaves it fresh. A
// package's fingerprint is a hash of its doc comment and the names of its
// functions.
package freshness

import (
	"crypto/sha256"
	"encoding/hex"
	"go/parser"
	"go/scanner"
	"go/token"
	"path"
	"slices"
	"strings"

	"github.com/mpyw/pkgsight/internal/callgraph"
	"github.com/mpyw/pkgsight/internal/model"
	"github.com/mpyw/pkgsight/internal/notes"
)

// State is how a note stands against the code.
type State string

const (
	// Fresh is a note whose code has not changed.
	Fresh State = "fresh"
	// Stale is a note whose code changed since it was written, or that has
	// no fingerprint to tell.
	Stale State = "stale"
	// Orphan is a note whose package or function is gone, or renamed.
	Orphan State = "orphan"
)

// Code reads the code that notes describe. It keeps each file it reads.
type Code struct {
	graph *model.Graph
	calls *callgraph.Graph
	read  func(file string) ([]byte, error)
	files map[string][]string
}

// New reads the code of g and calls through read, which takes a slash path
// from the root.
func New(g *model.Graph, calls *callgraph.Graph, read func(file string) ([]byte, error)) *Code {
	return &Code{graph: g, calls: calls, read: read, files: map[string][]string{}}
}

// Lines returns the lines of a file, the first at index 0.
func (c *Code) Lines(file string) ([]string, error) {
	if lines, ok := c.files[file]; ok {
		return lines, nil
	}
	b, err := c.read(file)
	if err != nil {
		return nil, err
	}
	lines := strings.Split(string(b), "\n")
	c.files[file] = lines
	return lines, nil
}

// FuncPrint fingerprints the code of fn, from its func keyword to its end.
func (c *Code) FuncPrint(fn model.Func) (string, error) {
	lines, err := c.Lines(fn.File)
	if err != nil {
		return "", err
	}
	from, to := max(fn.Line, 1), min(fn.EndLine, len(lines))
	return tokenPrint(strings.Join(lines[from-1:to], "\n")), nil
}

// tokenPrint hashes the tokens of src, so only a change to the code itself
// changes it.
func tokenPrint(src string) string {
	fset := token.NewFileSet()
	var s scanner.Scanner
	s.Init(fset.AddFile("", -1, len(src)), []byte(src), nil, 0)
	h := sha256.New()
	for {
		_, tok, lit := s.Scan()
		if tok == token.EOF {
			break
		}
		// An inserted semicolon reads "\n", a written one ";".
		if tok == token.SEMICOLON {
			lit = ""
		}
		h.Write([]byte(tok.String() + "\x00" + lit + "\x00"))
	}
	return hex.EncodeToString(h.Sum(nil)[:8])
}

// PackagePrint fingerprints a package of the module by its doc comment and
// the names of its functions. It needs the call graph.
func (c *Code) PackagePrint(p model.Package) string {
	var names []string
	for _, f := range c.calls.Package(p.Path) {
		if !strings.Contains(f.Name, "$") {
			names = append(names, f.Name)
		}
	}
	slices.Sort(names)
	sum := sha256.Sum256([]byte(c.PackageDoc(p) + "\x00" + strings.Join(names, "\x00")))
	return hex.EncodeToString(sum[:8])
}

// PackageDoc reads the package comment from the files of p. The package
// graph keeps only its first sentence.
func (c *Code) PackageDoc(p model.Package) string {
	var docs []string
	for _, f := range p.Files {
		src, err := c.read(path.Join(p.Dir, f))
		if err != nil {
			continue
		}
		file, err := parser.ParseFile(token.NewFileSet(), f, src, parser.PackageClauseOnly|parser.ParseComments)
		if err == nil && file.Doc != nil {
			docs = append(docs, strings.TrimSpace(file.Doc.Text()))
		}
	}
	return strings.Join(docs, "\n\n")
}

// Report is the state of each note of a book.
type Report struct {
	Packages map[string]State
	Funcs    map[string]State
}

// Check tells the state of every note in b. A function whose source cannot
// be read is stale: its note cannot be shown to hold.
func (c *Code) Check(b notes.Book) Report {
	r := Report{Packages: map[string]State{}, Funcs: map[string]State{}}
	for path, n := range b.Packages {
		p, ok := c.ownPackage(path)
		switch {
		case !ok:
			r.Packages[path] = Orphan
		case n.Fingerprint != "" && n.Fingerprint == c.PackagePrint(p):
			r.Packages[path] = Fresh
		default:
			r.Packages[path] = Stale
		}
	}
	for id, n := range b.Funcs {
		d, ok := c.calls.Func(id)
		if !ok {
			r.Funcs[id] = Orphan
			continue
		}
		print, err := c.FuncPrint(d.Func)
		if err == nil && n.Fingerprint != "" && n.Fingerprint == print {
			r.Funcs[id] = Fresh
		} else {
			r.Funcs[id] = Stale
		}
	}
	return r
}

func (c *Code) ownPackage(path string) (model.Package, bool) {
	for _, p := range c.graph.Packages {
		if p.Path == path && p.Kind == model.KindOwn {
			return p, true
		}
	}
	return model.Package{}, false
}

// Problem is a note that is not fresh.
type Problem struct {
	// Kind is "package" or "function".
	Kind  string
	Key   string
	State State
}

// Problems lists the notes that are not fresh, packages first, each sorted
// by key.
func (r Report) Problems() []Problem {
	var out []Problem
	add := func(kind string, states map[string]State) {
		var keys []string
		for k, s := range states {
			if s != Fresh {
				keys = append(keys, k)
			}
		}
		slices.Sort(keys)
		for _, k := range keys {
			out = append(out, Problem{Kind: kind, Key: k, State: states[k]})
		}
	}
	add("package", r.Packages)
	add("function", r.Funcs)
	return out
}
