// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { moves, readPlace, writePlace } from "./location";

afterEach(() => history.replaceState(null, "", "/"));

describe("readPlace", () => {
  it("defaults to the map", () => {
    expect(readPlace()).toEqual({ view: "map" });
  });

  it("reads every field, and only known views", () => {
    history.replaceState(null, "", "#view=inside&pkg=a%2Fb&fn=a.F");
    expect(readPlace()).toEqual({ view: "inside", pkg: "a/b", fn: "a.F" });
    history.replaceState(null, "", "#view=nope");
    expect(readPlace().view).toBe("map");
    // Inside no package is the map.
    history.replaceState(null, "", "#view=inside&fn=a.F");
    expect(readPlace()).toEqual({ view: "map", fn: "a.F" });
  });
});

describe("writePlace", () => {
  it("writes the fragment, and clears it for the plain map", () => {
    writePlace({ view: "flow", fn: "a.F" });
    expect(location.hash).toBe("#view=flow&fn=a.F");
    writePlace({ view: "map", pkg: "a/b" });
    expect(location.hash).toBe("#pkg=a%2Fb");
    writePlace({ view: "map" });
    expect(location.hash).toBe("");
    expect(location.pathname).toBe("/");
  });

  it("leaves history alone when nothing changes", () => {
    writePlace({ view: "flow", fn: "x" });
    const before = history.length;
    writePlace({ view: "flow", fn: "x" });
    expect(history.length).toBe(before);
    expect(readPlace()).toEqual({ view: "flow", fn: "x" });
  });
});

describe("history", () => {
  it("adds an entry for a move, and replaces it for a pick", () => {
    const before = history.length;
    writePlace({ view: "map", pkg: "a" });
    expect(history.length).toBe(before);
    writePlace({ view: "inside", pkg: "a" }, true);
    expect(history.length).toBe(before + 1);
    writePlace({ view: "map" }, true);
    expect(location.hash).toBe("");
  });

  it("tells a move from a pick", () => {
    expect(moves({ view: "map" }, { view: "map", pkg: "a" })).toBe(false);
    expect(moves({ view: "map" }, { view: "inside", pkg: "a" })).toBe(true);
    expect(
      moves({ view: "inside", pkg: "a" }, { view: "inside", pkg: "b" }),
    ).toBe(true);
    expect(
      moves(
        { view: "inside", pkg: "a" },
        { view: "inside", pkg: "a", fn: "f" },
      ),
    ).toBe(false);
    expect(
      moves(
        { view: "inside", pkg: "a", fn: "f" },
        { view: "inside", pkg: "a", fn: "g" },
      ),
    ).toBe(true);
    expect(moves({ view: "flow", fn: "f" }, { view: "flow", fn: "g" })).toBe(
      true,
    );
    expect(
      moves({ view: "flow", fn: "f" }, { view: "flow", fn: "f", pkg: "a" }),
    ).toBe(false);
  });
});
