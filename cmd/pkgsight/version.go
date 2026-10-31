package main

import "runtime/debug"

// version is the release this binary was built from, written at link time
// with -X main.version=<version>. .goreleaser.yaml passes it.
var version string

// currentVersion falls back to the module version that go install records,
// and to "devel" for a build from a checkout.
//
//declscope:shared // main.go answers --version with it, and serve.go hands it to MCP
func currentVersion() string {
	if version != "" {
		return version
	}
	if info, ok := debug.ReadBuildInfo(); ok && info.Main.Version != "" && info.Main.Version != "(devel)" {
		return info.Main.Version
	}
	return "devel"
}
