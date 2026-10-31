package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/urfave/cli/v3"

	"github.com/mpyw/pkgsight/internal/callgraph"
	"github.com/mpyw/pkgsight/internal/load"
	"github.com/mpyw/pkgsight/internal/model"
	"github.com/mpyw/pkgsight/internal/notes"
	"github.com/mpyw/pkgsight/internal/server"
	"github.com/mpyw/pkgsight/web"
)

// exportCommand is pkgsight export.
//
//declscope:shared // mainCommand in main.go holds it
func exportCommand() *cli.Command {
	return &cli.Command{
		Name:      "export",
		Usage:     "write the module, its call graph, its notes and its source into one HTML file",
		ArgsUsage: "[packages]",
		Description: "The file opens in a browser without pkgsight, and cannot write notes.\n" +
			"It holds the source code of the module: share it only with those who may read it.",
		Flags: []cli.Flag{
			dirFlag(),
			&cli.StringFlag{Name: "output", Aliases: []string{"o"}, Value: "pkgsight.html", Usage: "the file to write"},
		},
		OnUsageError: usageError,
		Action:       exportAction,
	}
}

// exportedAssets is the built web UI. Tests replace it.
var exportedAssets = web.Dist

// exportAction builds both graphs and writes them into the page, with what
// a server in this process answers. The page then shows what pkgsight serve
// shows.
func exportAction(ctx context.Context, cmd *cli.Command) error {
	logger := log.New(cmd.Root().ErrWriter, "", 0)
	start := time.Now()
	dir, pats := cmd.String("dir"), patterns(cmd)
	g, err := load.Graph(ctx, dir, pats...)
	if err != nil {
		return err
	}
	store, err := notes.Open(g.Root)
	if err != nil {
		return err
	}
	calls, err := buildCallGraph(ctx, logger, dir, pats)
	if err != nil {
		return err
	}
	assets := exportedAssets()
	api := server.New(g, assets, store, currentVersion())
	api.SetCalls(calls, nil, time.Since(start))

	data, err := exportedData(api, g, calls)
	if err != nil {
		return err
	}
	page, err := exportedPage(assets, data)
	if err != nil {
		return err
	}
	out := cmd.String("output")
	if err := os.WriteFile(out, page, 0o644); err != nil {
		return err
	}
	logger.Printf("wrote %s, %.1f MB, in %s", out, float64(len(page))/(1<<20), time.Since(start).Round(time.Millisecond))
	return nil
}

// exportedData gathers what web/src/data/embedded.ts reads. The graphs
// and the sources go in as the API would encode them. The call status, the
// notes, with their lines placed and their freshness, and the images come
// from the API itself, so they need no second implementation.
func exportedData(api http.Handler, g *model.Graph, calls *callgraph.Graph) ([]byte, error) {
	ask := func(target string) *exportRecorder {
		rec := exportRequest(api, target)
		if rec.status != http.StatusOK {
			panic(fmt.Sprintf("%s: the server answered %d to its own data", target, rec.status))
		}
		return rec
	}
	data := struct {
		Graph    *model.Graph                `json:"graph"`
		Status   jsontext.Value              `json:"status"`
		Entries  []model.Entry               `json:"entries"`
		Funcs    map[string]model.FuncDetail `json:"funcs"`
		Packages map[string][]string         `json:"packages"`
		Sources  map[string]string           `json:"sources"`
		Notes    map[string]jsontext.Value   `json:"notes"`
		Assets   map[string]string           `json:"assets"`
	}{
		Graph:    g,
		Status:   ask("/api/calls/status").body.Bytes(),
		Entries:  calls.Entries(),
		Funcs:    map[string]model.FuncDetail{},
		Packages: map[string][]string{},
		Sources:  map[string]string{},
		Notes:    map[string]jsontext.Value{},
		Assets:   map[string]string{},
	}
	for _, p := range g.Packages {
		if p.Kind != model.KindOwn {
			continue
		}
		for _, f := range calls.Package(p.Path) {
			data.Funcs[f.ID] = f
			data.Packages[p.Path] = append(data.Packages[p.Path], f.ID)
		}
		for _, f := range p.Files {
			file := path.Join(filepath.ToSlash(p.Dir), f)
			if b, err := os.ReadFile(filepath.Join(g.Root, p.Dir, f)); err == nil {
				data.Sources[file] = string(b)
			}
		}
	}
	langs := struct {
		Langs []string `json:"langs"`
	}{}
	if err := json.Unmarshal(ask("/api/notes").body.Bytes(), &langs); err != nil {
		return nil, err
	}
	for _, lang := range langs.Langs {
		data.Notes[lang] = ask("/api/notes?" + url.Values{"lang": {lang}}.Encode()).body.Bytes()
		for _, img := range exportedImages(string(data.Notes[lang])) {
			if _, done := data.Assets[img]; done {
				continue
			}
			if rec := exportRequest(api, "/api/asset?"+url.Values{"path": {img}}.Encode()); rec.status == http.StatusOK {
				data.Assets[img] = "data:" + rec.header.Get("Content-Type") + ";base64," + base64.StdEncoding.EncodeToString(rec.body.Bytes())
			}
		}
	}
	// Escaping < and > keeps the data from closing its script element.
	return json.Marshal(data, jsontext.EscapeForHTML(true))
}

// exportImagePattern finds the images notes show: Markdown images and img
// elements.
var exportImagePattern = regexp.MustCompile(`!\[[^\]]*\]\(\s*<?([^)\s>]+)|<img[^>]*?\ssrc=\\?["']([^"'\\]+)`)

// exportedImages lists the relative image paths in notes, as the frontend
// resolves them: from the root, without a leading ./.
func exportedImages(notesJSON string) []string {
	var out []string
	for _, m := range exportImagePattern.FindAllStringSubmatch(notesJSON, -1) {
		src := m[1] + m[2]
		if strings.Contains(src, ":") || strings.HasPrefix(src, "/") || strings.HasPrefix(src, "#") {
			continue
		}
		out = append(out, strings.TrimPrefix(src, "./"))
	}
	return out
}

// exportRequest answers a GET from api, without a network.
func exportRequest(api http.Handler, target string) *exportRecorder {
	r, err := http.NewRequest(http.MethodGet, target, nil)
	if err != nil {
		panic(err) // target is a path this file builds, always valid
	}
	rec := &exportRecorder{header: http.Header{}, status: http.StatusOK}
	api.ServeHTTP(rec, r)
	return rec
}

// exportRecorder keeps one response in memory.
type exportRecorder struct {
	header http.Header
	status int
	body   bytes.Buffer
}

func (r *exportRecorder) Header() http.Header         { return r.header }
func (r *exportRecorder) Write(b []byte) (int, error) { return r.body.Write(b) }
func (r *exportRecorder) WriteHeader(status int)      { r.status = status }

var (
	exportScriptTag = regexp.MustCompile(`<script type="module" crossorigin src="/([^"]+)"></script>`)
	exportStyleTag  = regexp.MustCompile(`<link rel="stylesheet" crossorigin href="/([^"]+)">`)
)

// exportedPage puts the built UI and data into one HTML file: the script and
// the style inline, the data in a script element the UI reads.
func exportedPage(assets fs.FS, data []byte) ([]byte, error) {
	index, err := fs.ReadFile(assets, "index.html")
	if errors.Is(err, fs.ErrNotExist) {
		return nil, errors.New("the web UI is not built: run `mise run web-build`, then rebuild pkgsight")
	}
	if err != nil {
		return nil, err
	}
	page := string(index)
	var inlineErr error
	inline := func(tag *regexp.Regexp, open, close string, escape func(string) string) {
		page = tag.ReplaceAllStringFunc(page, func(m string) string {
			b, err := fs.ReadFile(assets, tag.FindStringSubmatch(m)[1])
			if err != nil {
				// The first failure is the one to report.
				if inlineErr == nil {
					inlineErr = err
				}
				return m
			}
			return open + escape(string(b)) + close
		})
	}
	// "</script" inside the code would end the element early. In a string or
	// a pattern, "<\/script" means the same.
	inline(exportScriptTag, `<script type="module">`, `</script>`, func(s string) string {
		return strings.ReplaceAll(s, "</script", `<\/script`)
	})
	inline(exportStyleTag, "<style>", "</style>", func(s string) string {
		return strings.ReplaceAll(s, "</style", `<\/style`)
	})
	if inlineErr != nil {
		return nil, inlineErr
	}
	tag := `<script id="pkgsight-data" type="application/json">` + string(data) + "</script>\n  </body>"
	return []byte(strings.Replace(page, "</body>", tag, 1)), nil
}
