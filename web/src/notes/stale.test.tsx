import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NoteBlock } from "./NoteText";
import { summaryProps } from "./stale";

describe("summaryProps", () => {
  it("marks a summary written for older code", () => {
    expect(summaryProps("要約")).toEqual({
      className: "summary",
      title: "要約",
    });
    expect(summaryProps("要約", true)).toEqual({
      className: "summary stale",
      title: "要約\n(written for an older version of this code)",
    });
  });
});

describe("NoteBlock", () => {
  it("warns when the note was written for older code", () => {
    const out = renderToStaticMarkup(
      <NoteBlock note={{ summary: "s", stale: true }} lang="ja" />,
    );
    expect(out).toContain('class="stale-warning"');
    expect(out).toContain("older version of this code");
    expect(
      renderToStaticMarkup(<NoteBlock note={{ summary: "s" }} lang="ja" />),
    ).not.toContain("stale-warning");
  });
});
