// Package callgraph builds the call graph of the own packages.
//
// It reads the own packages from source and the dependencies from type
// information only, which needs a sixth of the memory of reading everything.
// A value that passes through a dependency hides its callees from VTA, so an
// interface call left without an own callee falls back to the class hierarchy
// and the result is marked Maybe.
package callgraph

import (
	"context"
	"fmt"
	"go/ast"
	"go/doc"
	"go/token"
	"path/filepath"
	"slices"
	"sort"
	"strings"

	"golang.org/x/tools/go/callgraph"
	"golang.org/x/tools/go/callgraph/cha"
	"golang.org/x/tools/go/callgraph/vta"
	"golang.org/x/tools/go/packages"
	"golang.org/x/tools/go/ssa"
	"golang.org/x/tools/go/ssa/ssautil"

	"github.com/mpyw/pkgsight/internal/model"
)

// Graph is the call graph, with the SSA program already released.
type Graph struct {
	funcs   map[string]*model.FuncDetail
	entries []model.Entry
	// byPkg lists the IDs of each package's functions in source order.
	byPkg map[string][]string
}

// Build loads patterns in dir and builds their call graph.
func Build(ctx context.Context, dir string, patterns ...string) (*Graph, error) {
	root, err := filepath.Abs(dir)
	if err != nil {
		return nil, err
	}
	cfg := &packages.Config{Context: ctx, Dir: root, Mode: packages.LoadSyntax}
	pkgs, err := packages.Load(cfg, patterns...)
	if err != nil {
		return nil, err
	}
	prog, _ := ssautil.Packages(pkgs, 0)
	prog.Build()

	own := map[string]bool{}
	for _, p := range pkgs {
		own[p.PkgPath] = true
	}
	hierarchy := cha.CallGraph(prog)
	b := &builder{
		root:  root,
		fset:  prog.Fset,
		own:   own,
		ids:   map[*ssa.Function]string{},
		taken: map[string]bool{},
		vta:   vta.CallGraph(ssautil.AllFunctions(prog), hierarchy),
		cha:   hierarchy,
	}
	return b.build(), nil
}

type builder struct {
	root  string
	fset  *token.FileSet
	own   map[string]bool
	ids   map[*ssa.Function]string
	taken map[string]bool
	vta   *callgraph.Graph
	cha   *callgraph.Graph
}

func (b *builder) isOwn(fn *ssa.Function) bool {
	return fn.Synthetic == "" && fn.Pkg != nil && b.own[fn.Pkg.Pkg.Path()]
}

type callKey struct {
	to      string
	mode    model.Mode
	maybe   bool
	through string
}

func (b *builder) build() *Graph {
	g := &Graph{funcs: map[string]*model.FuncDetail{}, byPkg: map[string][]string{}}
	var owned []*ssa.Function
	for fn := range b.vta.Nodes {
		if fn != nil && b.isOwn(fn) {
			owned = append(owned, fn)
		}
	}
	sort.Slice(owned, func(i, j int) bool { return owned[i].Pos() < owned[j].Pos() })
	for _, fn := range owned {
		g.funcs[b.id(fn)] = &model.FuncDetail{Func: b.describe(fn), Calls: []model.Call{}, Callers: []model.Func{}}
		path := fn.Pkg.Pkg.Path()
		g.byPkg[path] = append(g.byPkg[path], b.id(fn))
	}

	for _, fn := range owned {
		d := g.funcs[b.id(fn)]
		calls := map[callKey]*model.Call{}
		add := func(site ssa.CallInstruction, callee *ssa.Function, maybe bool) {
			mode, dispatch := classify(site)
			b.record(calls, site, callee, model.Call{Mode: mode, Dispatch: dispatch, Maybe: maybe})
		}

		resolved := map[ssa.CallInstruction]bool{}
		for _, e := range b.vta.Nodes[fn].Out {
			for _, callee := range b.unwrap(e.Callee.Func, 0) {
				add(e.Site, callee, false)
				if b.isOwn(callee) {
					resolved[e.Site] = true
				}
			}
		}
		if n := b.cha.Nodes[fn]; n != nil {
			for _, e := range n.Out {
				if e.Site == nil || !e.Site.Common().IsInvoke() || resolved[e.Site] {
					continue
				}
				for _, callee := range b.unwrap(e.Callee.Func, 0) {
					if b.isOwn(callee) {
						add(e.Site, callee, true)
					}
				}
			}
		}

		for _, site := range callSites(fn) {
			b.recordCallbacks(calls, site)
		}

		for _, c := range calls {
			sort.Ints(c.Lines)
			d.Calls = append(d.Calls, *c)
			if to, ok := g.funcs[c.To.ID]; ok && !c.Maybe && !containsFunc(to.Callers, d.ID) {
				to.Callers = append(to.Callers, d.Func)
			}
		}
		sort.Slice(d.Calls, func(i, j int) bool {
			a, b := d.Calls[i], d.Calls[j]
			if first(a.Lines) != first(b.Lines) {
				return first(a.Lines) < first(b.Lines)
			}
			return a.To.ID < b.To.ID
		})
	}

	for _, fn := range owned {
		d := g.funcs[b.id(fn)]
		switch {
		case fn.Parent() != nil || fn.Signature.Recv() != nil:
		case fn.Name() == "main" && fn.Pkg.Pkg.Name() == "main":
			g.entries = append(g.entries, model.Entry{Func: d.Func, Reason: model.EntryMain})
		case len(d.Callers) == 0 && ast.IsExported(fn.Name()) && fn.Pkg.Pkg.Name() != "main":
			g.entries = append(g.entries, model.Entry{Func: d.Func, Reason: model.EntryUncalled})
		}
	}
	sort.SliceStable(g.entries, func(i, j int) bool {
		a, b := g.entries[i], g.entries[j]
		if a.Reason != b.Reason {
			return a.Reason == model.EntryMain
		}
		return a.Pkg+"."+a.Name < b.Pkg+"."+b.Name
	})
	return g
}

// unwrap looks through the wrappers SSA synthesizes for bound methods,
// method values and promoted methods, to the functions the source names.
func (b *builder) unwrap(fn *ssa.Function, depth int) []*ssa.Function {
	n := b.vta.Nodes[fn]
	if fn.Synthetic == "" || len(fn.Blocks) == 0 || n == nil || depth > 3 {
		return []*ssa.Function{fn}
	}
	var out []*ssa.Function
	for _, e := range n.Out {
		out = append(out, b.unwrap(e.Callee.Func, depth+1)...)
	}
	if len(out) == 0 {
		return []*ssa.Function{fn}
	}
	return out
}

// record adds the call at site to callee to calls, merging it with the calls
// to the same callee in the same way.
func (b *builder) record(calls map[callKey]*model.Call, site ssa.CallInstruction, callee *ssa.Function, how model.Call) {
	k := callKey{to: b.id(callee), mode: how.Mode, maybe: how.Maybe, through: how.Through}
	c := calls[k]
	if c == nil {
		how.To = b.describe(callee)
		c = &how
		calls[k] = c
	}
	if line := b.fset.Position(site.Pos()).Line; line > 0 && !slices.Contains(c.Lines, line) {
		c.Lines = append(c.Lines, line)
	}
}

// spawners start their function argument on a new goroutine.
var spawners = map[string]bool{
	"(*sync.WaitGroup).Go":                      true,
	"(*golang.org/x/sync/errgroup.Group).Go":    true,
	"(*golang.org/x/sync/errgroup.Group).TryGo": true,
}

// recordCallbacks records an own function handed to a library function as a
// call to it. The library makes the call, and the analysis does not read the
// library, so the edge would be missing otherwise.
func (b *builder) recordCallbacks(calls map[callKey]*model.Call, site ssa.CallInstruction) {
	common := site.Common()
	callee := common.StaticCallee()
	if callee == nil || b.isOwn(callee) {
		return
	}
	// Name a generic function by its origin: the type arguments are noise here.
	named := callee
	if o := callee.Origin(); o != nil {
		named = o
	}
	through := named.String()
	mode := model.ModeCall
	if spawners[through] {
		mode = model.ModeGo
	}
	if pkg := named.Package(); pkg != nil {
		through = pkg.Pkg.Name() + "." + named.RelString(pkg.Pkg)
	}
	for _, arg := range common.Args {
		var fn *ssa.Function
		switch v := arg.(type) {
		case *ssa.MakeClosure:
			fn, _ = v.Fn.(*ssa.Function)
		case *ssa.Function:
			fn = v
		}
		if fn != nil && b.isOwn(fn) {
			b.record(calls, site, fn, model.Call{Mode: mode, Dispatch: model.DispatchDynamic, Through: through})
		}
	}
}

func callSites(fn *ssa.Function) []ssa.CallInstruction {
	var sites []ssa.CallInstruction
	for _, block := range fn.Blocks {
		for _, instr := range block.Instrs {
			if site, ok := instr.(ssa.CallInstruction); ok {
				sites = append(sites, site)
			}
		}
	}
	return sites
}

func classify(site ssa.CallInstruction) (model.Mode, model.Dispatch) {
	mode := model.ModeCall
	switch site.(type) {
	case *ssa.Go:
		mode = model.ModeGo
	case *ssa.Defer:
		mode = model.ModeDefer
	}
	switch c := site.Common(); {
	case c.IsInvoke():
		return mode, model.DispatchInterface
	case c.StaticCallee() == nil:
		return mode, model.DispatchDynamic
	}
	return mode, model.DispatchStatic
}

func (b *builder) id(fn *ssa.Function) string {
	if id, ok := b.ids[fn]; ok {
		return id
	}
	id := fn.String()
	for i := 2; b.taken[id]; i++ {
		id = fmt.Sprintf("%s#%d", fn.String(), i)
	}
	b.taken[id] = true
	b.ids[fn] = id
	return id
}

func (b *builder) describe(fn *ssa.Function) model.Func {
	f := model.Func{ID: b.id(fn), Name: fn.Name(), Kind: model.KindStd}
	pkg := fn.Package()
	if pkg == nil && fn.Origin() != nil {
		pkg = fn.Origin().Package()
	}
	if pkg != nil {
		f.Pkg, f.PkgName = pkg.Pkg.Path(), pkg.Pkg.Name()
		f.Name = fn.RelString(pkg.Pkg)
		if strings.Contains(strings.SplitN(f.Pkg, "/", 2)[0], ".") {
			f.Kind = model.KindExt
		}
	} else if recv := fn.Signature.Recv(); recv != nil {
		f.Name = fn.RelString(recv.Pkg())
	}
	if !b.isOwn(fn) {
		return f
	}
	f.Kind = model.KindOwn
	if syn := fn.Syntax(); syn != nil {
		start, end := b.fset.Position(syn.Pos()), b.fset.Position(syn.End())
		if rel, err := filepath.Rel(b.root, start.Filename); err == nil {
			f.File = filepath.ToSlash(rel)
		}
		f.Line, f.EndLine = start.Line, end.Line
		if decl, ok := syn.(*ast.FuncDecl); ok && decl.Doc != nil {
			f.Doc = new(doc.Package).Synopsis(decl.Doc.Text())
			f.DocLine = b.fset.Position(decl.Doc.Pos()).Line
		}
	}
	return f
}

// Func returns the function with id, with its calls and callers.
func (g *Graph) Func(id string) (model.FuncDetail, bool) {
	d, ok := g.funcs[id]
	if !ok {
		return model.FuncDetail{}, false
	}
	return *d, true
}

// Package returns the functions of the package at path in source order,
// each with its calls and callers.
func (g *Graph) Package(path string) []model.FuncDetail {
	out := make([]model.FuncDetail, 0, len(g.byPkg[path]))
	for _, id := range g.byPkg[path] {
		out = append(out, *g.funcs[id])
	}
	return out
}

// Entries returns the functions worth starting a call flow from.
func (g *Graph) Entries() []model.Entry {
	return g.entries
}

// Search returns up to limit own functions whose name or package contains q,
// ignoring case, the shortest names first.
func (g *Graph) Search(q string, limit int) []model.Func {
	q = strings.ToLower(q)
	var hits []model.Func
	for _, d := range g.funcs {
		if strings.Contains(strings.ToLower(d.PkgName+"."+d.Name), q) {
			hits = append(hits, d.Func)
		}
	}
	sort.Slice(hits, func(i, j int) bool {
		if len(hits[i].Name) != len(hits[j].Name) {
			return len(hits[i].Name) < len(hits[j].Name)
		}
		return hits[i].ID < hits[j].ID
	})
	if len(hits) > limit {
		hits = hits[:limit]
	}
	return hits
}

func first(lines []int) int {
	if len(lines) == 0 {
		return 0
	}
	return lines[0]
}

func containsFunc(s []model.Func, id string) bool {
	for _, f := range s {
		if f.ID == id {
			return true
		}
	}
	return false
}
