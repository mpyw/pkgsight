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
