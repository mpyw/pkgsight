import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DocBlock, Inline, NoteBlock } from "./NoteText";

const html = (el: React.ReactElement) => renderToStaticMarkup(el);

describe("NoteBlock", () => {
  it("shows nothing for an empty note", () => {
    expect(html(<NoteBlock lang="ja" />)).toBe("");
    expect(html(<NoteBlock note={{}} lang="ja" />)).toBe("");
  });

  it("shows the summary with code spans, then the body", () => {
    const out = html(
      <NoteBlock
        note={{ summary: "calls `Run`", body: "**bold**" }}
        lang="ja"
      />,
    );
    expect(out).toContain('lang="ja"');
    expect(out).toContain("calls <code>Run</code>");
    expect(out).toContain("<strong>bold</strong>");
    expect(html(<NoteBlock note={{ body: "only" }} lang="en" />)).not.toContain(
      "summary",
    );
  });
});

describe("DocBlock", () => {
  it("shows the original alone, or nothing", () => {
    expect(html(<DocBlock original="Run runs." />)).toBe(
      '<p class="doc">Run runs.</p>',
    );
    expect(html(<DocBlock />)).toBe("");
  });

  it("shows the translation over the original", () => {
    const out = html(
      <DocBlock original="Run runs." translated="Run は動く。" lang="ja" />,
    );
    expect(out).toContain("Run は動く。");
    expect(out).toContain('<p class="original">Run runs.</p>');
    expect(html(<DocBlock translated="訳だけ" />)).not.toContain("original");
  });
});

describe("Inline", () => {
  it("renders only paired backquotes as code", () => {
    expect(html(<Inline text="a `b` c ` d" />)).toBe("a <code>b</code> c ` d");
  });
});
