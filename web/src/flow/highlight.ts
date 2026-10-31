// A small Go tokenizer for reading code in the panel. It colors, it does not parse.

export type TokenKind =
  "keyword" | "type" | "string" | "comment" | "number" | "func" | "plain";

export interface Token {
  kind: TokenKind;
  text: string;
}

const keywords = new Set(
  "break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var".split(
    " ",
  ),
);
const types = new Set(
  "any bool byte comparable complex64 complex128 error float32 float64 int int8 int16 int32 int64 rune string uint uint8 uint16 uint32 uint64 uintptr true false nil iota".split(
    " ",
  ),
);

const pattern =
  /(\/\/.*$)|(\/\*[\s\S]*?(?:\*\/|$))|("(?:[^"\\]|\\.)*"?|`[^`]*`?|'(?:[^'\\]|\\.)*'?)|(\b\d[\d_.xXa-fA-FoObBeEpPi]*\b)|([A-Za-z_]\w*)(?=\s*\()|([A-Za-z_]\w*)/gm;

// highlight splits each line into tokens. A block comment or raw string that
// spans lines carries over.
export function highlight(lines: string[]): Token[][] {
  let open: "comment" | "raw" | undefined;
  return lines.map((line) => {
    const out: Token[] = [];
    let rest = line;
    if (open) {
      const end = rest.indexOf(open === "comment" ? "*/" : "`");
      if (end < 0)
        return [
          { kind: open === "comment" ? "comment" : "string", text: rest },
        ];
      const cut = end + (open === "comment" ? 2 : 1);
      out.push({
        kind: open === "comment" ? "comment" : "string",
        text: rest.slice(0, cut),
      });
      rest = rest.slice(cut);
      open = undefined;
    }
    let last = 0;
    for (const m of rest.matchAll(pattern)) {
      if (m.index > last)
        out.push({ kind: "plain", text: rest.slice(last, m.index) });
      const [text, lineComment, block, str, num, call, word] = m;
      if (lineComment) out.push({ kind: "comment", text });
      else if (block) {
        out.push({ kind: "comment", text });
        if (!text.endsWith("*/")) open = "comment";
      } else if (str) {
        out.push({ kind: "string", text });
        if (text.startsWith("`") && (text.length === 1 || !text.endsWith("`")))
          open = "raw";
      } else if (num) out.push({ kind: "number", text });
      else if (call)
        out.push({ kind: keywords.has(call) ? "keyword" : "func", text });
      else if (word)
        out.push({
          kind: keywords.has(word)
            ? "keyword"
            : types.has(word)
              ? "type"
              : "plain",
          text,
        });
      last = m.index + text.length;
    }
    if (last < rest.length) out.push({ kind: "plain", text: rest.slice(last) });
    return out;
  });
}
