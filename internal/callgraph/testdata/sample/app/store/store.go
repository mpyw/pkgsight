// Package store keeps one value.
package store

import "iter"

// Get returns the value.
func Get() string {
	for v := range values() {
		return v
	}
	return ""
}

// values yields every value. The compiler calls the function it returns,
// at no position of the source.
func values() iter.Seq[string] {
	return func(yield func(string) bool) { yield("value") }
}
