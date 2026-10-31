// Package app wires the store to the outside world.
package app

import (
	"fmt"
	"sync"

	"example.com/sample/app/store"
)

// Greeter says hello.
type Greeter interface{ Greet() string }

type english struct{}

func (english) Greet() string { return "hello" }

// Run prints what the store holds.
func Run() {
	var wg sync.WaitGroup
	defer cleanup()
	wg.Add(1)
	go func() {
		defer wg.Done()
		work(english{})
	}()
	wg.Wait()
	fmt.Println(store.Get())
}

func work(g Greeter) { fmt.Println(g.Greet()) }

func cleanup() {}

// Unused is exported and called by nothing in the module.
func Unused() {}

// Spawn greets on a goroutine that a WaitGroup starts.
func Spawn() {
	var wg sync.WaitGroup
	wg.Go(func() { work(english{}) })
	wg.Wait()
}
