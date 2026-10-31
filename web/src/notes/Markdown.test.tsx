import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AssetContext, Markdown } from "./Markdown";

const render = (text: string) =>
  renderToStaticMarkup(
    <AssetContext.Provider value={(p) => `/api/asset?path=${p}`}>
      <Markdown text={text} />
    </AssetContext.Provider>,
  );

describe("Markdown", () => {
  it("draws GitHub alerts", () => {
    const html = render("> [!WARNING]\n> Breaks when the map is nil.");
    expect(html).toContain('class="alert alert-warning"');
    expect(html).toContain("Breaks when the map is nil.");
    expect(html).not.toContain("[!WARNING]");
  });

  it("keeps a plain blockquote", () => {
    expect(render("> quoted")).toContain("<blockquote>");
  });

  it("renders tables and task lists", () => {
    const html = render("| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done");
    expect(html).toContain("<table>");
    expect(html).toContain('type="checkbox"');
  });

  it("allows HTML but not scripts", () => {
    const html = render(
      '<details><summary>More</summary>hidden</details>\n\n<img src="x" onerror="alert(1)"><script>alert(1)</script>',
    );
    expect(html).toContain("<details>");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("<script");
  });

  it("serves relative images from the repository", () => {
    expect(render("![arch](./docs/arch.png)")).toContain(
      'src="/api/asset?path=docs/arch.png"',
    );
    expect(render("![x](https://example.com/x.png)")).toContain(
      'src="https://example.com/x.png"',
    );
  });

  it("highlights Go code blocks", () => {
    expect(render("```go\nfunc f() {}\n```")).toContain(
      '<span class="tk-keyword">func</span>',
    );
  });
});

describe("Markdown details", () => {
  it("leaves image paths alone without an asset resolver", () => {
    expect(renderToStaticMarkup(<Markdown text="![a](b.png)" />)).toContain(
      'src="b.png"',
    );
  });

  it("opens links in a new tab", () => {
    expect(render("[x](https://example.com)")).toContain(
      'target="_blank" rel="noreferrer"',
    );
  });

  it("keeps code blocks of other languages as they are", () => {
    const html = render("```sh\necho hi\n```\n\nand `inline`");
    expect(html).toContain('<code class="language-sh">echo hi');
    expect(html).toContain("<code>inline</code>");
  });

  it("draws every alert kind, with the marker on its own line", () => {
    for (const k of ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"]) {
      const html = render(`> [!${k}]\n> body`);
      expect(html).toContain(`alert-${k.toLowerCase()}`);
      expect(html).toContain("<svg");
    }
  });

  it("drops a marker that stands alone, and keeps unknown ones", () => {
    expect(render("> [!NOTE]")).toContain('class="alert alert-note"');
    expect(render("> [!NOPE]\n> x")).toContain("[!NOPE]");
    expect(render("> **bold** [!NOTE]")).toContain("<blockquote>");
    expect(render("> - [!NOTE] in a list")).toContain("<blockquote>");
  });

  it("keeps a page anchor and a protocol-relative image as they are", () => {
    expect(render("![x](#top)")).toContain('src="#top"');
    expect(render("![x](//cdn.example/x.png)")).toContain(
      'src="//cdn.example/x.png"',
    );
  });
});
