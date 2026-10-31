// Package load builds the package graph with go list.
package load

import (
	"bytes"
	"context"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"

	"github.com/mpyw/pkgsight/internal/model"
)

// fields are the only fields go list computes. Asking for fewer fields
// halves the time on a large tree.
const fields = "ImportPath,Name,Dir,Doc,GoFiles,CgoFiles,Imports,Standard,Module,Error,DepsErrors"

type listed struct {
	ImportPath string
	Name       string
	Dir        string
	Doc        string
	GoFiles    []string
	CgoFiles   []string
	Imports    []string
	Standard   bool
	Module     *struct {
		Path    string
		Version string
		Main    bool
	}
	Error      *listError
	DepsErrors []listError
}

type listError struct {
	ImportStack []string
	Err         string
}

// Graph runs go list in dir on patterns and their dependencies.
func Graph(ctx context.Context, dir string, patterns ...string) (*model.Graph, error) {
	root, err := filepath.Abs(dir)
	if err != nil {
		return nil, err
	}
	// Without this, the go command fails to start in a missing directory,
	// and reports that it cannot find itself.
	if _, err := os.Stat(root); err != nil {
		return nil, err
	}
	args := append([]string{"list", "-e", "-deps", "-json=" + fields}, patterns...)
	cmd := exec.CommandContext(ctx, "go", args...)
	cmd.Dir = root
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("go list: %w: %s", err, bytes.TrimSpace(stderr.Bytes()))
	}
	return decode(root, out)
}

func decode(root string, out []byte) (*model.Graph, error) {
	var all []listed
	dec := jsontext.NewDecoder(bytes.NewReader(out))
	for {
		var l listed
		if err := json.UnmarshalDecode(dec, &l); errors.Is(err, io.EOF) {
			break
		} else if err != nil {
			return nil, fmt.Errorf("decode go list output: %w", err)
		}
		all = append(all, l)
	}

	known := make(map[string]bool, len(all))
	for _, l := range all {
		known[l.ImportPath] = true
	}

	g := &model.Graph{Root: root, Modules: []model.Module{}, Packages: make([]model.Package, 0, len(all))}
	modules := map[string]bool{}
	for _, l := range all {
		p := model.Package{
			Path:    l.ImportPath,
			Name:    l.Name,
			Kind:    model.KindExt,
			Dir:     l.Dir,
			Doc:     l.Doc,
			Files:   append(append([]string{}, l.GoFiles...), l.CgoFiles...),
			Imports: []string{},
		}
		for _, imp := range l.Imports {
			// "C" and the packages go list could not find are not in the graph.
			if known[imp] {
				p.Imports = append(p.Imports, imp)
			}
		}
		if l.Standard {
			p.Kind = model.KindStd
		}
		if l.Error != nil {
			p.Error = l.Error.Err
		}
		// A package that fails to import shows its error, but so does the
		// one that imports it: that is where the import is written. Errors
		// further down are shown only where they happen.
		for _, e := range l.DepsErrors {
			if p.Error == "" && len(e.ImportStack) > 0 && e.ImportStack[len(e.ImportStack)-1] == l.ImportPath {
				p.Error = e.Err
			}
		}
		if m := l.Module; m != nil && !l.Standard {
			p.Module = m.Path
			if m.Main {
				p.Kind = model.KindOwn
				if rel, err := filepath.Rel(root, l.Dir); err == nil {
					p.Dir = filepath.ToSlash(rel)
				}
			}
			if !modules[m.Path] {
				modules[m.Path] = true
				g.Modules = append(g.Modules, model.Module{Path: m.Path, Version: m.Version, Main: m.Main})
			}
		}
		g.Packages = append(g.Packages, p)
	}
	sort.Slice(g.Modules, func(i, j int) bool { return g.Modules[i].Path < g.Modules[j].Path })
	sort.Slice(g.Packages, func(i, j int) bool { return g.Packages[i].Path < g.Packages[j].Path })
	return g, nil
}
