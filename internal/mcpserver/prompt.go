package mcpserver

import (
	"context"
	"fmt"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// prompts become slash commands in clients such as Claude Code, so a reader
// can ask for notes without knowing the tools.
//
//declscope:shared // Handler in tools.go registers them
var prompts = []struct {
	prompt  *mcp.Prompt
	handler mcp.PromptHandler
}{
	{
		prompt: &mcp.Prompt{
			Name:        "explain_module",
			Description: "Write a note for every package of the module, and for its entry points",
			Arguments:   []*mcp.PromptArgument{promptLangArg},
		},
		handler: promptFor(func(a map[string]string) string {
			return fmt.Sprintf(`Write pkgsight notes in %q for the whole module.

1. Call the overview tool.
2. For each package, read it with the package tool and the function tool on
   its main functions, then write its note with write_package_note. Start
   from the packages that import nothing else of the module.
3. For each entry point, write a function note with a summary, and line
   notes where the flow branches or hands work off.

Tell me in a few lines what you wrote when you are done.`, a["lang"])
		}),
	},
	{
		prompt: &mcp.Prompt{
			Name:        "explain_package",
			Description: "Write notes for a package and its functions",
			Arguments: []*mcp.PromptArgument{
				{Name: "package", Description: "The import path, or the last part of it", Required: true},
				promptLangArg,
			},
		},
		handler: promptFor(func(a map[string]string) string {
			return fmt.Sprintf(`Write pkgsight notes in %q for the package %q.

1. Find the package with the overview tool if the path is not complete, and
   read it with the package tool.
2. Read each named function with the function tool, callees first, and write
   its note with write_function_note. Skip closures (names with $) unless
   they hold real logic.
3. Write the package note last with write_package_note, now that you know
   every function.

Tell me in a few lines what you wrote when you are done.`, a["lang"], a["package"])
		}),
	},
	{
		prompt: &mcp.Prompt{
			Name:        "explain_flow",
			Description: "Write notes along the call flow from a function",
			Arguments: []*mcp.PromptArgument{
				{Name: "function", Description: "A function name or ID, like \"main\" or \"server.New\"", Required: true},
				promptLangArg,
				{Name: "depth", Description: "How many calls deep to go (default 3)"},
			},
		},
		handler: promptFor(func(a map[string]string) string {
			depth := a["depth"]
			if depth == "" {
				depth = "3"
			}
			return fmt.Sprintf(`Write pkgsight notes in %q along the call flow from %q.

1. Find the function with the search tool, unless it is already an ID.
2. Walk its calls into the module up to %s levels deep with the function
   tool. Read the deepest functions first.
3. Write a note for every function on the way with write_function_note:
   a summary, and line notes where the flow branches, starts a goroutine,
   defers, calls through an interface, or handles an error in a way that
   matters.

Tell me in a few lines what you wrote when you are done.`, a["lang"], a["function"], depth)
		}),
	},
}

var promptLangArg = &mcp.PromptArgument{
	Name:        "lang",
	Description: "The language of the notes as a BCP 47 tag, like \"ja\" or \"en\"",
	Required:    true,
}

func promptFor(text func(args map[string]string) string) mcp.PromptHandler {
	return func(_ context.Context, req *mcp.GetPromptRequest) (*mcp.GetPromptResult, error) {
		return &mcp.GetPromptResult{
			Messages: []*mcp.PromptMessage{{
				Role:    "user",
				Content: &mcp.TextContent{Text: text(req.Params.Arguments)},
			}},
		}, nil
	}
}
