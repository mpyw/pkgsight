// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSource, notesJa } from "../test/fake";
import { useNotes } from "./useNotes";

const langs = (list: string[]) =>
  vi.spyOn(navigator, "languages", "get").mockReturnValue(list);

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("useNotes", () => {
  it("picks the browser's language among those with notes", async () => {
    langs(["ja-JP", "en"]);
    const src = new FakeSource({
      notes: { ja: notesJa, en: { ...notesJa, lang: "en" } },
    });
    const { result } = renderHook(() => useNotes(src));
    await waitFor(() => expect(result.current.lang).toBe("ja"));
    expect(result.current.langs).toEqual(["en", "ja"]);
    await waitFor(() => expect(result.current.notes?.lang).toBe("ja"));
  });

  it("falls back to the first language, and to none", async () => {
    langs(["fr"]);
    const { result } = renderHook(() => useNotes(new FakeSource()));
    await waitFor(() => expect(result.current.lang).toBe("ja"));
    const empty = renderHook(() => useNotes(new FakeSource({ notes: {} })));
    await waitFor(() => expect(empty.result.current.langs).toEqual([]));
    expect(empty.result.current.lang).toBeUndefined();
    expect(empty.result.current.notes).toBeUndefined();
  });

  it("remembers a choice, including off", async () => {
    langs(["ja"]);
    const src = new FakeSource({
      notes: { ja: notesJa, en: { ...notesJa, lang: "en" } },
    });
    const { result } = renderHook(() => useNotes(src));
    await waitFor(() => expect(result.current.lang).toBe("ja"));
    act(() => result.current.choose("en"));
    await waitFor(() => expect(result.current.notes?.lang).toBe("en"));
    expect(localStorage.getItem("pkgsight.notesLang")).toBe("en");
    act(() => result.current.choose(undefined));
    await waitFor(() => expect(result.current.notes).toBeUndefined());
    expect(result.current.lang).toBeUndefined();
    expect(localStorage.getItem("pkgsight.notesLang")).toBe("off");
  });

  it("reads a stored choice, and ignores one with no notes", async () => {
    langs(["ja"]);
    localStorage.setItem("pkgsight.notesLang", "en");
    const src = new FakeSource({
      notes: { ja: notesJa, en: { ...notesJa, lang: "en" } },
    });
    const { result } = renderHook(() => useNotes(src));
    await waitFor(() => expect(result.current.lang).toBe("en"));
    localStorage.setItem("pkgsight.notesLang", "de");
    const other = renderHook(() => useNotes(new FakeSource()));
    await waitFor(() => expect(other.result.current.lang).toBe("ja"));
  });

  it("works when storage is off", async () => {
    langs(["ja"]);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const { result } = renderHook(() => useNotes(new FakeSource()));
    await waitFor(() => expect(result.current.lang).toBe("ja"));
    act(() => result.current.choose(undefined));
    await waitFor(() => expect(result.current.lang).toBeUndefined());
  });

  it("loads again when notes change and when the call graph is ready", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    langs(["ja"]);
    const src = new FakeSource({
      // One pending answer for each run of the effect, then ready.
      status: [{ state: "pending" }, { state: "pending" }, { state: "ready" }],
    });
    const notes = vi.spyOn(src, "notes");
    const { result, unmount } = renderHook(() => useNotes(src));
    await waitFor(() => expect(result.current.lang).toBe("ja"));
    const before = notes.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(1100));
    expect(notes.mock.calls.length).toBeGreaterThan(before);
    const after = notes.mock.calls.length;
    act(() => src.notify());
    expect(notes.mock.calls.length).toBe(after + 1);
    unmount();
    expect(src.watchers.size).toBe(0);
  });

  it("drops the notes when loading fails", async () => {
    langs(["ja"]);
    const src = new FakeSource();
    const { result } = renderHook(() => useNotes(src));
    await waitFor(() => expect(result.current.notes).toBeDefined());
    vi.spyOn(src, "notes").mockRejectedValue(new Error("down"));
    act(() => src.notify());
    await waitFor(() => expect(result.current.notes).toBeUndefined());
  });
});

describe("useNotes polling", () => {
  it("asks for the call status again after a failure", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    langs(["ja"]);
    const src = new FakeSource();
    const status = vi
      .spyOn(src, "callStatus")
      .mockRejectedValueOnce(new Error("down"))
      .mockRejectedValueOnce(new Error("down"));
    const { result } = renderHook(() => useNotes(src));
    await waitFor(() => expect(result.current.lang).toBe("ja"));
    await act(() => vi.advanceTimersByTimeAsync(1100));
    expect(status.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});
