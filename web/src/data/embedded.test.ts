// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  details,
  entries,
  graph,
  main,
  notesJa,
  run,
  sources,
} from "../test/fake";
import { EmbeddedDataSource, readEmbedded, type Embedded } from "./embedded";

const embedded: Embedded = {
  graph,
  status: { state: "ready", tookMs: 10 },
  entries,
  funcs: Object.fromEntries(details),
  packages: { [run.pkg]: [run.id], gone: ["nowhere"] },
  sources,
  notes: { ja: notesJa },
  assets: { "docs/a.png": "data:image/png;base64,AA==" },
};

describe("readEmbedded", () => {
  it("reads the data an exported page carries", () => {
    expect(readEmbedded(document)).toBeUndefined();
    const el = document.createElement("script");
    el.id = "pkgsight-data";
    el.type = "application/json";
    el.textContent = JSON.stringify({ graph });
    document.body.append(el);
    expect(readEmbedded(document)?.graph.root).toBe(graph.root);
    el.textContent = "";
    expect(readEmbedded(document)).toBeUndefined();
    el.remove();
  });
});

describe("EmbeddedDataSource", () => {
  const src = new EmbeddedDataSource(embedded);

  it("answers as the server would", async () => {
    expect(await src.graph()).toBe(graph);
    expect((await src.callStatus()).state).toBe("ready");
    expect(await src.entries()).toBe(entries);
    expect((await src.func(main.id)).name).toBe("main");
    await expect(src.func("nope")).rejects.toThrow("no such function: nope");
    expect((await src.packageFuncs(run.pkg)).map((f) => f.id)).toEqual([
      run.id,
    ]);
    expect(await src.packageFuncs("gone")).toEqual([]);
    expect(await src.packageFuncs("unknown")).toEqual([]);
    expect(await src.source(main.file!)).toBe(sources[main.file!]);
    await expect(src.source("x.go")).rejects.toThrow("no such file: x.go");
  });

  it("searches as the server does", async () => {
    const hits = await src.search("RUN");
    expect(hits.map((f) => f.name)).toEqual(["Run", "Run$1"]);
    expect("calls" in hits[0]).toBe(false);
  });

  it("gives the notes of each language, and nothing for others", async () => {
    expect(await src.notes("ja")).toBe(notesJa);
    expect(await src.notes("fr")).toEqual({
      langs: ["ja"],
      lang: "fr",
      packages: {},
      funcs: {},
    });
  });

  it("serves embedded images, and has nothing to watch", () => {
    expect(src.asset("docs/a.png")).toMatch(/^data:image\/png/);
    expect(src.asset("other.png")).toBe("other.png");
    src.watchNotes()();
    src.watchCode()();
  });
});
