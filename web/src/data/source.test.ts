import { afterEach, describe, expect, it, vi } from "vitest";
import { anew, HttpDataSource } from "./source";
import { FakeSource, main } from "../test/fake";

afterEach(() => vi.unstubAllGlobals());

// serve answers each URL from a table, and records what was asked.
function serve(table: Record<string, [number, string]>) {
  const asked: string[] = [];
  vi.stubGlobal("fetch", (url: string) => {
    asked.push(url);
    const [status, body] = table[url] ?? [404, "not found"];
    return Promise.resolve(new Response(body, { status }));
  });
  return asked;
}

describe("HttpDataSource", () => {
  it("reads JSON from each endpoint, escaping its arguments", async () => {
    const asked = serve({
      "/api/graph": [200, '{"root":"/r"}'],
      "/api/calls/status": [200, '{"state":"ready"}'],
      "/api/calls/entries": [200, "[]"],
      "/api/calls/func?id=a%2Fb.F": [200, '{"id":"a/b.F"}'],
      "/api/calls/package?path=a%2Fb": [200, "[]"],
      "/api/calls/search?q=F+x": [200, "[]"],
      "/api/notes?lang=ja": [200, '{"lang":"ja"}'],
    });
    const s = new HttpDataSource();
    expect(await s.graph()).toEqual({ root: "/r" });
    expect(await s.callStatus()).toEqual({ state: "ready" });
    expect(await s.entries()).toEqual([]);
    expect(await s.func("a/b.F")).toEqual({ id: "a/b.F" });
    expect(await s.packageFuncs("a/b")).toEqual([]);
    expect(await s.search("F x")).toEqual([]);
    expect(await s.notes("ja")).toEqual({ lang: "ja" });
    expect(asked).toHaveLength(7);
    expect(s.asset("docs/a b.png")).toBe("/api/asset?path=docs%2Fa+b.png");
  });

  it("fails with the status and the body", async () => {
    serve({ "/api/graph": [503, "the call graph is not ready"] });
    await expect(new HttpDataSource().graph()).rejects.toThrow(
      "GET /api/graph: 503 the call graph is not ready",
    );
  });

  it("fetches each source file once", async () => {
    const asked = serve({ "/api/source?file=a.go": [200, "package a"] });
    const s = new HttpDataSource();
    const [one, two] = await Promise.all([s.source("a.go"), s.source("a.go")]);
    expect(one).toBe("package a");
    expect(two).toBe("package a");
    expect(asked).toEqual(["/api/source?file=a.go"]);
  });

  it("tries a source again after a failure", async () => {
    const asked = serve({});
    const s = new HttpDataSource();
    await expect(s.source("a.go")).rejects.toThrow("404");
    serve({ "/api/source?file=a.go": [200, "package a"] });
    expect(await s.source("a.go")).toBe("package a");
    expect(asked).toHaveLength(1);
  });

  it("listens for notes until stopped", () => {
    const made: FakeEventSource[] = [];
    class FakeEventSource extends EventTarget {
      closed = false;
      constructor(readonly url: string) {
        super();
        made.push(this);
      }
      close() {
        this.closed = true;
      }
    }
    vi.stubGlobal("EventSource", FakeEventSource);
    const changed = vi.fn();
    const stop = new HttpDataSource().watchNotes(changed);
    expect(made[0].url).toBe("/api/notes/events");
    made[0].dispatchEvent(new Event("notes"));
    made[0].dispatchEvent(new Event("other"));
    expect(changed).toHaveBeenCalledTimes(1);
    stop();
    expect(made[0].closed).toBe(true);
  });

  it("shares one stream, and reads files anew after the code changed", async () => {
    const made: FakeEventSource[] = [];
    class FakeEventSource extends EventTarget {
      closed = false;
      constructor(readonly url: string) {
        super();
        made.push(this);
      }
      close() {
        this.closed = true;
      }
    }
    vi.stubGlobal("EventSource", FakeEventSource);
    const fetched: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      fetched.push(url);
      return Promise.resolve(new Response("package a"));
    });
    const src = new HttpDataSource();
    const notes = vi.fn();
    const code = vi.fn();
    const stopNotes = src.watchNotes(notes);
    const stopCode = src.watchCode(code);
    expect(made).toHaveLength(1);

    await src.source("a.go");
    await src.source("a.go");
    expect(fetched).toHaveLength(1);
    made[0].dispatchEvent(new Event("code"));
    expect(code).toHaveBeenCalledTimes(1);
    expect(notes).not.toHaveBeenCalled();
    await src.source("a.go");
    expect(fetched).toHaveLength(2);

    stopNotes();
    expect(made[0].closed).toBe(false);
    stopCode();
    expect(made[0].closed).toBe(true);
    // Listening again opens a new stream.
    src.watchCode(code)();
    expect(made).toHaveLength(2);
  });

  it("reads through the same source under a new identity", async () => {
    const base = new FakeSource();
    const live = anew(base);
    expect(live).not.toBe(base);
    expect(await live.graph()).toBe(await base.graph());
    expect((await live.entries()).length).toBe((await base.entries()).length);
    await live.callStatus();
    await live.func(main.id);
    await live.packageFuncs(main.pkg);
    await live.search("run");
    await live.notes("ja");
    await live.source(main.file!);
    expect(live.asset("a.png")).toBe(base.asset("a.png"));
    const changed = vi.fn();
    live.watchNotes(changed)();
    live.watchCode(changed)();
    expect(base.funcCalls).toContain(main.id);
  });
});
