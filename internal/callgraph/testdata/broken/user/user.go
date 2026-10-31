// Package user imports a package that does not type-check.
package user

import "example.com/broken"

// Use calls into it.
func Use() { broken.Fine() }
