// Package callgraph builds the call graph of the own packages.
//
// It reads the own packages from source and the dependencies from type
// information only, which needs a sixth of the memory of reading everything.
// A value that passes through a dependency hides its callees from VTA, so an
// interface call left without an own callee falls back to the class hierarchy
// and the result is marked Maybe.
package callgraph

import (
	"cmp"
	"context"
	"fmt"
	"go/ast"
	"go/doc"
	"go/token"
	"go/types"
	"maps"
	"os"
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
	byPkg   map[string][]string
	skipped []model.SkippedPackage
}

// Build loads patterns in dir and builds their call graph.
func Build(ctx context.Context, dir string, patterns ...string) (*Graph, error) {
	root, err := filepath.Abs(dir)
	if err != nil {
		return nil, err
	}
	// Without this, the go command fails to start in a missing directory,
	// and reports that it cannot find itself.
	if _, err := os.Stat(root); err != nil {
		return nil, err
	}
	cfg := &packages.Config{Context: ctx, Dir: root, Mode: packages.LoadSyntax}
	pkgs, err := packages.Load(cfg, patterns...)
	if err != nil {
		return nil, err
	}
	// SSA leaves out a package that does not type-check, and every function
	// in it. It leaves out every package that imports one too, through any
	// number of imports. Say which, so the gap is not silent.
	var skipped []model.SkippedPackage
	for _, p := range pkgs {
		switch {
		case len(p.Errors) > 0:
			skipped = append(skipped, model.SkippedPackage{Path: p.PkgPath, Error: p.Errors[0].Error()})
		case p.IllTyped:
			skipped = append(skipped, model.SkippedPackage{Path: p.PkgPath, Error: brokenImport(p)})
		}
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
		prog:  prog,
	}
	g := b.build()
	g.skipped = skipped
	return g, nil
}

type builder struct {
	root  string
	fset  *token.FileSet
	own   map[string]bool
	ids   map[*ssa.Function]string
	taken map[string]bool
	vta   *callgraph.Graph
	cha   *callgraph.Graph
	prog  *ssa.Program
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
		for _, part := range withLoopBodies(fn) {
			if n := b.vta.Nodes[part]; n != nil {
				for _, e := range n.Out {
					for _, callee := range b.unwrap(e.Callee.Func, 0) {
						add(e.Site, callee, false)
						if b.isOwn(callee) {
							resolved[e.Site] = true
						}
					}
				}
			}
			if n := b.cha.Nodes[part]; n != nil {
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
			for _, site := range callSites(part) {
				b.recordCallbacks(calls, site)
			}
		}

		for _, c := range calls {
			sort.Ints(c.Lines)
			d.Calls = append(d.Calls, *c)
			// A guess does not make a caller. Otherwise every type with a
			// Write or an Error method would list every caller of the
			// interface, and none would be an entry point.
			if to, ok := g.funcs[c.To.ID]; ok && !c.Maybe && !containsFunc(to.Callers, d.ID) {
				to.Callers = append(to.Callers, d.Func)
			}
		}
		sort.Slice(d.Calls, func(i, j int) bool {
			a, b := d.Calls[i], d.Calls[j]
			// calls is a map, so every field of the key breaks ties.
			return cmp.Or(
				cmp.Compare(first(a.Lines), first(b.Lines)),
				cmp.Compare(a.To.ID, b.To.ID),
				cmp.Compare(a.Mode, b.Mode),
				cmp.Compare(a.Through, b.Through),
				boolCompare(a.Maybe, b.Maybe),
			) < 0
		})
	}

	fromLibraries := b.libraryEntries(owned)
	for _, fn := range owned {
		d := g.funcs[b.id(fn)]
		if reason, ok := fromLibraries[fn]; ok && len(d.Callers) == 0 {
			g.entries = append(g.entries, model.Entry{Func: d.Func, Reason: reason})
			continue
		}
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
		return cmp.Or(
			cmp.Compare(entryRank[a.Reason], entryRank[b.Reason]),
			cmp.Compare(a.Pkg+"."+a.Name, b.Pkg+"."+b.Name),
		) < 0
	})
	return g
}

// entryRank orders entries: programs first, then what libraries call, then
// what nothing calls.
var entryRank = map[model.EntryReason]int{
	model.EntryMain:      0,
	model.EntryHanded:    1,
	model.EntryInterface: 2,
	model.EntryUncalled:  3,
}

// commonMethods are required by interfaces nearly every type meets. As
// entries they would bury the ones worth reading.
var commonMethods = map[string]bool{"String": true, "Error": true}

// libraryEntries finds the named functions and methods of the module that
// another module calls without the module's code in sight: those stored in
// a field of a struct of another module, and those an interface of another
// module requires. The caller keeps those that nothing in the module calls.
func (b *builder) libraryEntries(owned []*ssa.Function) map[*ssa.Function]model.EntryReason {
	out := map[*ssa.Function]model.EntryReason{}
	named := func(fn *ssa.Function) bool { return fn != nil && b.isOwn(fn) && fn.Parent() == nil }
	for _, fn := range owned {
		for _, blk := range fn.Blocks {
			for _, instr := range blk.Instrs {
				switch v := instr.(type) {
				case *ssa.Store:
					field, ok := v.Addr.(*ssa.FieldAddr)
					if !ok || b.ownType(field.X.Type()) {
						continue
					}
					if f := funcOf(v.Val); named(f) {
						out[f] = model.EntryHanded
					}
				case *ssa.MakeInterface:
					iface, ok := v.Type().Underlying().(*types.Interface)
					if !ok || iface.NumMethods() == 0 {
						continue
					}
					// A function made a library's type, such as
					// http.HandlerFunc(serve), and handed over as its interface.
					if f := funcOf(v.X); named(f) {
						out[f] = model.EntryHanded
						continue
					}
					if !b.ownType(v.X.Type()) {
						continue
					}
					mset := b.prog.MethodSets.MethodSet(v.X.Type())
					for m := range iface.Methods() {
						// Only the package itself can call an unexported
						// method, such as the marker that closes a sum type.
						if commonMethods[m.Name()] || !m.Exported() {
							continue
						}
						sel := mset.Lookup(m.Pkg(), m.Name())
						if sel == nil {
							continue
						}
						if f := b.prog.MethodValue(sel); named(f) && !idle(f) {
							if _, handed := out[f]; !handed {
								out[f] = model.EntryInterface
							}
						}
					}
				}
			}
		}
	}
	return out
}

// idle reports whether fn only returns constants, like a Close that returns
// nil. As an entry it would show nothing.
func idle(fn *ssa.Function) bool {
	if len(fn.Blocks) != 1 {
		return false
	}
	for _, instr := range fn.Blocks[0].Instrs {
		ret, ok := instr.(*ssa.Return)
		if !ok {
			return false
		}
		for _, r := range ret.Results {
			if _, ok := r.(*ssa.Const); !ok {
				return false
			}
		}
	}
	return true
}

// funcOf returns the function a value is, or closes over. A function given
// a named func type, such as cli.ActionFunc, is wrapped in a ChangeType.
func funcOf(v ssa.Value) *ssa.Function {
	switch v := v.(type) {
	case *ssa.Function:
		return v
	case *ssa.MakeClosure:
		fn, _ := v.Fn.(*ssa.Function)
		return fn
	case *ssa.ChangeType:
		return funcOf(v.X)
	}
	return nil
}

// ownType reports whether t, or what it points to, is a named type of the
// module.
func (b *builder) ownType(t types.Type) bool {
	if p, ok := t.Underlying().(*types.Pointer); ok {
		t = p.Elem()
	}
	n, ok := types.Unalias(t).(*types.Named)
	return ok && n.Obj().Pkg() != nil && b.own[n.Obj().Pkg().Path()]
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
//
// A function literal handed to the module's own function or method is
// recorded too. The analysis does see that call, but from the callee's side,
// and with no context: a helper that calls back what it is handed calls back
// every literal any caller hands it, often several layers down. The literal
// is the caller's code, so its calls are read best under the caller.
func (b *builder) recordCallbacks(calls map[callKey]*model.Call, site ssa.CallInstruction) {
	common := site.Common()
	through, mode, library := b.handedTo(common)
	if through == "" {
		return
	}
	for _, arg := range common.Args {
		fn := funcOf(arg)
		// A named function handed to the module's own code is left to VTA,
		// which follows it to where it is called.
		if fn != nil && b.isOwn(fn) && (library || fn.Parent() != nil) {
			b.record(calls, site, fn, model.Call{Mode: mode, Dispatch: model.DispatchDynamic, Through: through})
		}
	}
}

// handedTo names the function or interface method a call at common hands
// its arguments to, tells how that one calls them, and reports whether it is
// outside the module. The name is empty for a call of a function value.
func (b *builder) handedTo(common *ssa.CallCommon) (string, model.Mode, bool) {
	if common.IsInvoke() {
		m := common.Method
		recv := types.TypeString(common.Value.Type(), func(p *types.Package) string { return p.Name() })
		if n, ok := types.Unalias(common.Value.Type()).(*types.Named); ok && n.Obj().Pkg() != nil {
			recv = n.Obj().Pkg().Name() + ".(" + n.Obj().Name() + ")"
		}
		return recv + "." + m.Name(), model.ModeCall, m.Pkg() == nil || !b.own[m.Pkg().Path()]
	}
	callee := common.StaticCallee()
	if callee == nil {
		return "", model.ModeCall, false
	}
	// An instance of the module's own generic function is synthetic, so it
	// counts as a library. That is right: the analysis does not see into the
	// generic body either, so the instance calls the function out of sight,
	// as a library would. Name it by its origin: the type arguments are
	// noise here.
	named := callee
	if o := callee.Origin(); o != nil {
		named = o
	}
	mode := model.ModeCall
	if spawners[named.String()] {
		mode = model.ModeGo
	}
	through := named.String()
	if pkg := named.Package(); pkg != nil {
		through = pkg.Pkg.Name() + "." + named.RelString(pkg.Pkg)
	}
	return through, mode, !b.isOwn(callee)
}

// withLoopBodies returns fn and the bodies of its loops over a function,
// such as for m := range iface.Methods(). The compiler turns each body
// into a synthetic function of its own, which is not an own function. The
// code in it is fn's, so its calls are too.
func withLoopBodies(fn *ssa.Function) []*ssa.Function {
	out := []*ssa.Function{fn}
	for _, anon := range fn.AnonFuncs {
		if anon.Synthetic == "range-over-func yield" {
			out = append(out, withLoopBodies(anon)...)
		}
	}
	return out
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
	return detailCopy(d), true
}

// detailCopy copies d with its slices, so a caller cannot change the graph.
func detailCopy(d *model.FuncDetail) model.FuncDetail {
	out := *d
	out.Calls = slices.Clone(d.Calls)
	out.Callers = slices.Clone(d.Callers)
	for i := range out.Calls {
		out.Calls[i].Lines = slices.Clone(d.Calls[i].Lines)
	}
	return out
}

// Package returns the functions of the package at path in source order,
// each with its calls and callers.
func (g *Graph) Package(path string) []model.FuncDetail {
	out := make([]model.FuncDetail, 0, len(g.byPkg[path]))
	for _, id := range g.byPkg[path] {
		out = append(out, detailCopy(g.funcs[id]))
	}
	return out
}

// brokenImport says which import of p keeps it from type-checking.
func brokenImport(p *packages.Package) string {
	paths := slices.Sorted(maps.Keys(p.Imports))
	for _, path := range paths {
		if imp := p.Imports[path]; imp.IllTyped || len(imp.Errors) > 0 {
			return fmt.Sprintf("imports %s, which does not type-check", path)
		}
	}
	return "a package it imports does not type-check"
}

// Skipped returns the packages left out because they do not type-check.
func (g *Graph) Skipped() []model.SkippedPackage {
	return g.skipped
}

// Entries returns the functions worth starting a call flow from.
func (g *Graph) Entries() []model.Entry {
	return g.entries
}

// Search returns up to limit own functions whose "pkgname.Name", such as
// "server.New", contains q, ignoring case, the shortest names first.
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

func boolCompare(a, b bool) int {
	switch {
	case a == b:
		return 0
	case a:
		return 1
	}
	return -1
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
