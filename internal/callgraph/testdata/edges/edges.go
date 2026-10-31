// Package edges holds the call shapes that the sample does not.
package edges

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"slices"
)

// Map applies f to each value. It is generic, so calls go through an
// instance of it.
func Map[T, U any](xs []T, f func(T) U) []U {
	out := make([]U, 0, len(xs))
	for _, x := range xs {
		out = append(out, f(x))
	}
	return out
}

func double(x int) int { return x * 2 }

// Generic calls a generic function of the module.
func Generic() []int { return Map([]int{1}, double) }

type sink struct{}

func (sink) Write(p []byte) (int, error) { return len(p), nil }

type outer struct{ sink }

// Guess writes to a writer that comes from the standard library, so the
// analysis can only guess which types of the module it may be.
func Guess() {
	var w io.Writer = os.Stdout
	_, _ = w.Write(nil)
}

// Promoted calls a method promoted through an embedded field.
func Promoted() {
	var w io.Writer = outer{}
	_, _ = w.Write(nil)
}

// Bound calls a method value.
func Bound() {
	f := sink{}.Write
	_, _ = f(nil)
}

func less(a, b int) int { return a - b }

// Sorted hands a function and a closure to generic library functions.
func Sorted(n int) bool {
	xs := []int{3, 1, 2}
	slices.SortFunc(xs, less)
	return slices.ContainsFunc(xs, func(x int) bool { return x > n })
}

func cleanup() {}

// Twice calls cleanup in two ways, and is still one caller of it.
func Twice() {
	cleanup()
	defer cleanup()
}

func onConn(net.Conn, http.ConnState) {}

func serve(http.ResponseWriter, *http.Request) {}

func direct(net.Conn, http.ConnState) {}

// app is an http.Handler, and a fmt.Stringer.
type app struct{}

func (app) ServeHTTP(_ http.ResponseWriter, r *http.Request) {
	if r == nil {
		panic("no request")
	}
}

func (app) String() string { return "app" }

// Server hands functions and a handler to the standard library, which
// calls them out of sight.
func Server() *http.Server {
	direct(nil, 0)
	var s fmt.Stringer = app{}
	_ = s
	http.Handle("/app", app{})
	return &http.Server{
		ConnState:   onConn,
		Handler:     http.HandlerFunc(serve),
		ConnContext: nil,
	}
}

// Direct is also stored in a field, but the module calls it, so it is no
// entry.
var Direct = &http.Server{ConnState: direct}

// Change is closed: only this package can add a case, through the
// unexported marker method.
type Change interface{ isChange() }

type Added struct{}

func (Added) isChange() {}

// quiet is an io.Closer whose Close only returns.
type quiet struct{}

func (quiet) Close() error { return nil }

// Echoer is the module's own interface, with exported methods that do
// something, however little.
type Echoer interface {
	Echo(s string) string
	Shout(s string) string
}

type echo struct{}

func (echo) Echo(s string) string { return s }

func (echo) Shout(s string) string { return s + "!" }

// Sealed puts values in interfaces whose methods are not worth reading: a
// marker that closes a sum type, and a Close that does nothing.
func Sealed() []any {
	var c Change = Added{}
	var cl io.Closer = quiet{}
	var e Echoer = echo{}
	return []any{c, cl, e}
}

// Loop calls inLoop from the body of a loop over a function, which the
// compiler turns into a function of its own.
func Loop() {
	for x := range slices.Values([]int{1}) {
		for range slices.Values([]int{x}) {
			inLoop()
		}
	}
}

func inLoop() {}

// decider calls back what it is handed, as a unit of work does. The
// literal handed to it is wrapped to become a Decision.
type decider interface{ Decide(f Decision) int }

type Decision func() int

type runner struct{}

func (runner) Decide(f Decision) int { return f() }

func run(f func() int) int { return f() }

// Handed hands function literals to the module's own function and
// interface, and a named function to its own function.
func Handed(d decider) int {
	a := run(func() int { return picked() })
	b := d.Decide(func() int { return picked() })
	return a + b + run(named) + runner{}.Decide(named)
}

func picked() int { return 1 }

func named() int { return 2 }
