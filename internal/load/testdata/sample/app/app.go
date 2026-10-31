// Package app wires the store to the outside world.
package app

import (
	"fmt"

	"example.com/sample/app/store"
)

// Run prints what the store holds.
func Run() { fmt.Println(store.Get()) }
