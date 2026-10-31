// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { readPlace, writePlace } from "./location";

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
