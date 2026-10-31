// Package broken does not type-check.
package broken

// Fine is well typed.
func Fine() { helper() }

func helper() {}

// Bad assigns a string to an int.
func Bad() int { return "x" }
