// Package model defines the data that the analysis sends to the frontend.
package model

// Kind tells where a package comes from.
type Kind string

const (
	// KindOwn is a package of a main module, or of any module in go.work.
	KindOwn Kind = "own"
	// KindStd is a package of the standard library.
	KindStd Kind = "std"
	// KindExt is a package of a dependency module.
	KindExt Kind = "ext"
)

// Graph is the package graph of one analysis run.
type Graph struct {
	// Root is the directory the analysis ran in.
	Root     string    `json:"root"`
	Modules  []Module  `json:"modules"`
	Packages []Package `json:"packages"`
}

// Module is a module that provides at least one package of the graph.
type Module struct {
	Path    string `json:"path"`
	Version string `json:"version,omitempty"`
	Main    bool   `json:"main"`
}

// Package is one Go package and the packages it imports.
type Package struct {
	Path string `json:"path"`
	Name string `json:"name"`
	Kind Kind   `json:"kind"`
	// Module is the module path. It is empty for the standard library.
	Module string `json:"module,omitempty"`
	// Dir is relative to Graph.Root for an own package, and absolute otherwise.
	Dir string `json:"dir"`
	// Doc is the first sentence of the package comment.
	Doc   string   `json:"doc,omitempty"`
	Files []string `json:"files"`
	// Imports lists only the packages that are in the graph.
	Imports []string `json:"imports"`
	Error   string   `json:"error,omitempty"`
}

// Func is one function or method, closures included.
type Func struct {
	// ID is unique within one analysis run.
	ID string `json:"id"`
	// Name is relative to the package, like "Run", "(*Server).Start" or "Run$1".
	Name    string `json:"name"`
	Pkg     string `json:"pkg"`
	PkgName string `json:"pkgName"`
	Kind    Kind   `json:"kind"`
	// File is relative to Graph.Root. It and the lines are set for own functions only.
	File    string `json:"file,omitempty"`
	Line    int    `json:"line,omitzero"`
	EndLine int    `json:"endLine,omitzero"`
	// DocLine is the first line of the doc comment, when there is one.
	DocLine int `json:"docLine,omitzero"`
	// Doc is the first sentence of the doc comment.
	Doc string `json:"doc,omitempty"`
}

// FirstLine is the first line of the function with its doc comment.
func (f Func) FirstLine() int {
	if f.DocLine != 0 {
		return f.DocLine
	}
	return f.Line
}

// Mode tells how a call starts the callee.
type Mode string

const (
	ModeCall  Mode = "call"
	ModeGo    Mode = "go"
	ModeDefer Mode = "defer"
)

// Dispatch tells how a call finds its callee.
type Dispatch string

const (
	// DispatchStatic names the callee in the source.
	DispatchStatic Dispatch = "static"
	// DispatchInterface calls a method of an interface value.
	DispatchInterface Dispatch = "interface"
	// DispatchDynamic calls a function value.
	DispatchDynamic Dispatch = "dynamic"
)

// Call is every call from one function to one callee in one mode.
type Call struct {
	To       Func     `json:"to"`
	Mode     Mode     `json:"mode"`
	Dispatch Dispatch `json:"dispatch"`
	// Lines are the lines of the call sites, in order.
	Lines []int `json:"lines"`
	// Maybe marks a callee that only the class hierarchy suggests: the value
	// reaches the call through code the analysis did not read.
	Maybe bool `json:"maybe,omitzero"`
	// Through names the library function the callee was handed to, such as
	// "sync.(*WaitGroup).Go". That function makes the call, out of sight.
	Through string `json:"through,omitempty"`
}

// FuncDetail is a function with its callees and callers.
type FuncDetail struct {
	Func
	// Calls are in the order of their first call site.
	Calls   []Call `json:"calls"`
	Callers []Func `json:"callers"`
}

// SkippedPackage is a package of the module that the call graph leaves out,
// because it does not type-check.
type SkippedPackage struct {
	Path  string `json:"path"`
	Error string `json:"error"`
}

// EntryReason tells why a function is offered as a place to start reading.
type EntryReason string

const (
	EntryMain EntryReason = "main"
	// EntryHanded is a function stored in a struct of another module, such
	// as the Run of an analysis.Analyzer or the Action of a cli.Command. The
	// library calls it, and nothing in the module does.
	EntryHanded EntryReason = "handed"
	// EntryInterface is a method that an interface of another module
	// requires, such as ServeHTTP, and that nothing in the module calls.
	EntryInterface EntryReason = "interface"
	// EntryUncalled is an exported function that nothing in the module calls.
	EntryUncalled EntryReason = "uncalled"
)

// Entry is a function to start a call flow from.
type Entry struct {
	Func
	Reason EntryReason `json:"reason"`
}
