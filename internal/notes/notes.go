// Package notes keeps the explanations that an assistant writes for a
// codebase: a summary and a body for packages and functions, and notes that
// sit between the lines of a function without taking a line number.
//
// Each language has its own file, .pkgsight/notes/<lang>.yaml under the
// analyzed directory, so a team can commit the notes for every reader.
package notes

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strings"
	"sync"

	"go.yaml.in/yaml/v3"
)

// Book holds the notes of one language.
type Book struct {
	Packages map[string]Note     `json:"packages,omitempty" yaml:"packages,omitempty"`
	Funcs    map[string]FuncNote `json:"funcs,omitempty" yaml:"funcs,omitempty"`
}

// Note explains a package or a function.
type Note struct {
	// Summary is one sentence for the map and the call flow.
	Summary string `json:"summary,omitempty" yaml:"summary,omitempty"`
	// Doc is the doc comment in the language of the book.
	Doc string `json:"doc,omitempty" yaml:"doc,omitempty"`
	// Body is a longer explanation for the side panel.
	Body string `json:"body,omitempty" yaml:"body,omitempty"`
	// Fingerprint is the code the note was written for, as the freshness
	// package hashes it.
	Fingerprint string `json:"fingerprint,omitempty" yaml:"fingerprint,omitempty"`
}

// FuncNote explains a function, and some of its lines.
type FuncNote struct {
	Note  `yaml:",inline"`
	Lines []LineNote `json:"lines,omitempty" yaml:"lines,omitempty"`
}

// LineNote sits above one line of a function or of its doc comment. It
// keeps the line by its distance from the func keyword, negative in the doc
// comment, and by a hash of its text, so it can follow the line when the
// code above the function changes.
type LineNote struct {
	Offset int    `json:"offset" yaml:"offset"`
	Hash   string `json:"hash" yaml:"hash"`
	Text   string `json:"text" yaml:"text"`
	Kind   Kind   `json:"kind,omitempty" yaml:"kind,omitempty"`
}

// Kind marks a line note as one of the alerts GitHub draws in Markdown. A
// plain note has none.
type Kind string

const (
	KindNote      Kind = "note"
	KindTip       Kind = "tip"
	KindImportant Kind = "important"
	KindWarning   Kind = "warning"
	KindCaution   Kind = "caution"
)

// Kinds lists every kind a line note may have.
var Kinds = []Kind{KindNote, KindTip, KindImportant, KindWarning, KindCaution}

// Resolved is a line note placed on a line of the current source.
type Resolved struct {
	Line int    `json:"line"`
	Text string `json:"text"`
	Kind Kind   `json:"kind,omitempty"`
	// Stale marks a note whose line changed since the note was written.
	Stale bool `json:"stale,omitzero"`
}

// HashLine returns the hash that a LineNote keeps of its line.
func HashLine(line string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(line)))
	return hex.EncodeToString(sum[:4])
}

// Place puts each note of n on a line of a function whose func keyword is
// on line anchor, and which spans lines from to to with its doc comment.
// src holds the lines of the file, the first at index 0. A note goes to the
// line at its offset when the hash matches, else to the nearest line in the
// span with the same hash, else back to its offset, marked stale.
func Place(n FuncNote, src []string, anchor, from, to int) []Resolved {
	text := func(line int) (string, bool) {
		if line < from || line > to || line > len(src) {
			return "", false
		}
		return src[line-1], true
	}
	out := make([]Resolved, 0, len(n.Lines))
	for _, l := range n.Lines {
		at := anchor + l.Offset
		if t, ok := text(at); ok && HashLine(t) == l.Hash {
			out = append(out, Resolved{Line: at, Text: l.Text, Kind: l.Kind})
			continue
		}
		found := 0
		for d := 1; d <= to-from && found == 0; d++ {
			for _, c := range []int{at - d, at + d} {
				if t, ok := text(c); ok && HashLine(t) == l.Hash {
					found = c
					break
				}
			}
		}
		if found != 0 {
			out = append(out, Resolved{Line: found, Text: l.Text, Kind: l.Kind})
			continue
		}
		out = append(out, Resolved{Line: min(max(at, from), to), Text: l.Text, Kind: l.Kind, Stale: true})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Line < out[j].Line })
	return out
}

var langPattern = regexp.MustCompile(`^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$`)

// validLang reports whether lang looks like a BCP 47 tag, such as "ja" or
// "pt-BR". Only such tags name a file.
func validLang(lang string) bool {
	return langPattern.MatchString(lang)
}

// Store reads and writes the books under one directory, and tells
// subscribers when a book changes.
type Store struct {
	dir string

	mu    sync.Mutex
	books map[string]*Book
	subs  map[chan string]struct{}
}

// Open reads every book under root/.pkgsight/notes.
func Open(root string) (*Store, error) {
	s := &Store{
		dir:   filepath.Join(root, ".pkgsight", "notes"),
		books: map[string]*Book{},
		subs:  map[chan string]struct{}{},
	}
	entries, err := os.ReadDir(s.dir)
	if errors.Is(err, fs.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	for _, e := range entries {
		lang, ok := strings.CutSuffix(e.Name(), ".yaml")
		if !ok || !validLang(lang) || e.IsDir() {
			continue
		}
		b, err := os.ReadFile(filepath.Join(s.dir, e.Name()))
		if err != nil {
			return nil, err
		}
		var book Book
		if err := decodeBook(b, &book); err != nil {
			return nil, fmt.Errorf("%s: %w", e.Name(), err)
		}
		s.books[lang] = &book
	}
	return s, nil
}

// Langs lists the languages that have notes, sorted.
func (s *Store) Langs() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	langs := make([]string, 0, len(s.books))
	for l := range s.books {
		langs = append(langs, l)
	}
	slices.Sort(langs)
	return langs
}

// Book returns a copy of the book of lang, empty when there is none.
func (s *Store) Book(lang string) Book {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.copyBook(lang)
}

// copyBook copies the book of lang, with its maps made. The caller holds
// s.mu.
func (s *Store) copyBook(lang string) Book {
	out := Book{Packages: map[string]Note{}, Funcs: map[string]FuncNote{}}
	if b := s.books[lang]; b != nil {
		for k, v := range b.Packages {
			out.Packages[k] = v
		}
		for k, v := range b.Funcs {
			v.Lines = slices.Clone(v.Lines)
			out.Funcs[k] = v
		}
	}
	return out
}

// Update changes the book of lang with edit, writes it, and tells the
// subscribers. A book left empty loses its file.
func (s *Store) Update(lang string, edit func(*Book)) error {
	if !validLang(lang) {
		return fmt.Errorf("%q is not a language tag like \"ja\" or \"pt-BR\"", lang)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	// Edit a copy, so a failed write leaves the book as the file has it.
	copied := s.copyBook(lang)
	b := &copied
	edit(b)
	if err := s.write(lang, b); err != nil {
		return err
	}
	if len(b.Packages) == 0 && len(b.Funcs) == 0 {
		delete(s.books, lang)
	} else {
		s.books[lang] = b
	}
	for ch := range s.subs {
		select {
		case ch <- lang:
		default:
		}
	}
	return nil
}

func (s *Store) write(lang string, b *Book) error {
	path := filepath.Join(s.dir, lang+".yaml")
	if len(b.Packages) == 0 && len(b.Funcs) == 0 {
		if err := os.Remove(path); err != nil && !errors.Is(err, fs.ErrNotExist) {
			return err
		}
		return nil
	}
	data, err := encodeBook(b)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(s.dir, lang+".*.tmp")
	if err != nil {
		return err
	}
	// Cleans up when a step below fails. After the rename the name is gone,
	// and this does nothing.
	defer func() { _ = os.Remove(tmp.Name()) }()
	// CreateTemp makes the file private, but the notes are for the team.
	if err := tmp.Chmod(0o644); err != nil {
		_ = tmp.Close()
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}

// Subscribe returns a channel that receives the language of each changed
// book, and a function that ends the subscription.
func (s *Store) Subscribe() (<-chan string, func()) {
	ch := make(chan string, 8)
	s.mu.Lock()
	s.subs[ch] = struct{}{}
	s.mu.Unlock()
	return ch, func() {
		s.mu.Lock()
		delete(s.subs, ch)
		s.mu.Unlock()
	}
}

// encodeBook writes b as YAML, which keeps a multi-line body readable in a
// diff. The encoder quotes any string that would read back as another type.
func encodeBook(b *Book) ([]byte, error) {
	var buf bytes.Buffer
	enc := yaml.NewEncoder(&buf)
	enc.SetIndent(2)
	if err := enc.Encode(b); err != nil {
		return nil, err
	}
	if err := enc.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// decodeBook reads a book, and rejects keys it does not know, so a typo in
// a hand-edited file is not dropped without a word.
func decodeBook(data []byte, b *Book) error {
	dec := yaml.NewDecoder(bytes.NewReader(data))
	dec.KnownFields(true)
	if err := dec.Decode(b); err != nil && !errors.Is(err, io.EOF) {
		return err
	}
	return nil
}
