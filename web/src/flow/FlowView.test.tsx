// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { anew } from "../data/source";
import { NotesContext } from "../notes/useNotes";
import { FakeSource, get, main, notesJa, run } from "../test/fake";
import { FlowView } from "./FlowView";

afterEach(() => vi.useRealTimers());

const nodeOf = (name: string) =>
  [...document.querySelectorAll(".react-flow__node")].find(
    (n) => n.querySelector(".name")?.textContent === name,
  ) as HTMLElement | undefined;

function show(source = new FakeSource(), root?: string, notes = notesJa) {
  const onRoot = vi.fn();
  const onShowPackage = vi.fn();
  const r = render(
    <NotesContext.Provider value={notes}>
      <FlowView
        source={source}
        root={root}
        onRoot={onRoot}
        onShowPackage={onShowPackage}
      />
    </NotesContext.Provider>,
  );
  return { ...r, onRoot, onShowPackage };
}

describe("FlowView sidebar", () => {
  it("asks for a place to start, and lists the entry points", async () => {
    const { onRoot } = show();
    expect(screen.getByText(/Pick a place to start/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Programs")).toBeTruthy());
    expect(screen.getByText("Call graph built in 1.2s")).toBeTruthy();
    expect(await screen.findByText("Called from outside")).toBeTruthy();
    // Every kind of entry has its section, in order.
    expect(
      [...document.querySelectorAll(".sidebar h3")].map((h) => h.textContent),
    ).toEqual([
      "Programs",
      "Handed to libraries",
      "Called through interfaces",
      "Called from outside",
    ]);
    // An entry with a note shows its summary instead of its package.
    expect(screen.getByText("入口")).toBeTruthy();
    fireEvent.click(screen.getByTitle(main.id));
    expect(onRoot).toHaveBeenCalledWith(main.id);
  });

  it("shows the build in progress, and a failure", async () => {
    show(new FakeSource({ status: [{ state: "pending" }] }));
    expect(await screen.findByText("Building the call graph…")).toBeTruthy();
    expect(
      (screen.getByPlaceholderText("Search functions…") as HTMLInputElement)
        .disabled,
    ).toBe(true);
    show(new FakeSource({ status: [{ state: "error", error: "boom" }] }));
    expect(await screen.findByText("boom")).toBeTruthy();
  });

  it("lists packages left out of the call graph", async () => {
    show(
      new FakeSource({
        status: [
          {
            state: "ready",
            skipped: [
              { path: "ex.com/app/internal/store", error: "undefined: x" },
              { path: "ex.com/app/x", error: "syntax error" },
            ],
          },
        ],
      }),
    );
    expect(
      await screen.findByText("2 packages left out: they do not type-check"),
    ).toBeTruthy();
    expect(screen.getByTitle("undefined: x").textContent).toContain(
      "ex.com/app/internal/store",
    );
    show(
      new FakeSource({
        status: [{ state: "ready", skipped: [{ path: "p", error: "e" }] }],
      }),
    );
    expect(
      await screen.findByText("1 package left out: it does not type-check"),
    ).toBeTruthy();
  });

  it("searches as you type, and goes back to the entries when cleared", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const src = new FakeSource();
    show(src);
    await waitFor(() => expect(screen.getByText("Programs")).toBeTruthy());
    const box = screen.getByPlaceholderText("Search functions…");
    fireEvent.change(box, { target: { value: " ru" } });
    fireEvent.change(box, { target: { value: " run " } });
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(src.searches).toEqual(["run"]);
    expect(await screen.findByText("Results")).toBeTruthy();
    // A result with a note shows its summary, one without shows its place.
    expect(screen.getByText("サーバーを動かす")).toBeTruthy();
    expect(screen.getByText("internal/server/main.go:11")).toBeTruthy();
    fireEvent.change(box, { target: { value: "  " } });
    expect(screen.getByText("Programs")).toBeTruthy();
  });

  it("lists nothing when a request fails", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const src = new FakeSource();
    vi.spyOn(src, "entries").mockRejectedValue(new Error("down"));
    vi.spyOn(src, "search").mockRejectedValue(new Error("down"));
    show(src);
    await waitFor(() => expect(screen.getByText("Programs")).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText("Search functions…"), {
      target: { value: "x" },
    });
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(await screen.findByText("Results")).toBeTruthy();
    expect(document.querySelectorAll(".sidebar li")).toHaveLength(0);
  });
});

describe("FlowView tree", () => {
  it("opens the root, and a click opens a node but never closes it", async () => {
    show(new FakeSource(), main.id);
    await waitFor(() => expect(nodeOf("Run")).toBeTruthy());
    expect(screen.getByText("Library calls")).toBeTruthy();
    // The root is selected, so its panel is open.
    expect(document.querySelector(".panel h2")!.textContent).toBe("main");
    fireEvent.click(nodeOf("Run")!);
    await waitFor(() => expect(nodeOf("Run$1")).toBeTruthy());
    expect(document.querySelector(".panel h2")!.textContent).toBe("Run");
    expect(document.querySelector(".panel .via")!.textContent).toContain(
      "from main at line 6, 7",
    );
    fireEvent.click(nodeOf("main")!);
    fireEvent.click(nodeOf("Run")!);
    expect(nodeOf("Run$1")).toBeTruthy();
    // The badge closes it, and opening it again brings the subtree back.
    fireEvent.click(within(nodeOf("Run")!).getByTitle("Close the calls"));
    await waitFor(() => expect(nodeOf("Run$1")).toBeUndefined());
    fireEvent.click(within(nodeOf("Run")!).getByTitle("Open the calls"));
    await waitFor(() => expect(nodeOf("Run$1")).toBeTruthy());
  });

  it("stops at recursion and leaves library calls closed", async () => {
    show(new FakeSource(), get.id);
    await waitFor(() => expect(nodeOf("loop")).toBeTruthy());
    fireEvent.click(nodeOf("loop")!);
    await waitFor(() =>
      expect(document.querySelectorAll(".react-flow__node")).toHaveLength(3),
    );
    const deepest = [...document.querySelectorAll(".react-flow__node")].at(-1)!;
    expect(deepest.textContent).toContain("↺ recursive");
    fireEvent.click(deepest);
    expect(document.querySelectorAll(".react-flow__node")).toHaveLength(3);
  });

  it("adds library calls on demand, as leaves", async () => {
    show(new FakeSource(), main.id);
    await waitFor(() => expect(nodeOf("Run")).toBeTruthy());
    expect(nodeOf("Println")).toBeUndefined();
    fireEvent.click(screen.getByText("Library calls"));
    await waitFor(() => expect(nodeOf("Println")).toBeTruthy());
    fireEvent.click(nodeOf("Println")!);
    expect(screen.getByText(/this is a leaf/)).toBeTruthy();
  });

  it("starts afresh on a new root, keeping the library switch", async () => {
    const r = show(new FakeSource(), main.id);
    await waitFor(() => expect(nodeOf("Run")).toBeTruthy());
    fireEvent.click(screen.getByText("Library calls"));
    fireEvent.click(nodeOf("Run")!);
    await waitFor(() => expect(nodeOf("Run$1")).toBeTruthy());
    // The root changes from outside, as the back button does.
    r.rerender(
      <NotesContext.Provider value={notesJa}>
        <FlowView
          source={new FakeSource()}
          root={run.id}
          onRoot={r.onRoot}
          onShowPackage={r.onShowPackage}
        />
      </NotesContext.Provider>,
    );
    await waitFor(() =>
      expect(document.querySelector(".panel h2")!.textContent).toBe("Run"),
    );
    expect(nodeOf("main")).toBeUndefined();
    expect(
      screen
        .getByText("Library calls")
        .closest("button")!
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("starts again from a caller, and closes the panel", async () => {
    const { onRoot, onShowPackage } = show(new FakeSource(), run.id);
    await waitFor(() =>
      expect(document.querySelector(".panel h2")!.textContent).toBe("Run"),
    );
    fireEvent.click(screen.getByText("Show the package"));
    expect(onShowPackage).toHaveBeenCalledWith(run.pkg);
    fireEvent.click(screen.getByLabelText("Close"));
    expect(document.querySelector(".panel")).toBeNull();
    await waitFor(() => expect(nodeOf("Run")).toBeTruthy());
    fireEvent.click(nodeOf("Run")!);
    expect(document.querySelector(".panel")).toBeTruthy();
    fireEvent.click(document.querySelector(".react-flow__pane")!);
    expect(document.querySelector(".panel")).toBeNull();
    fireEvent.click(nodeOf("Run")!);
    fireEvent.click(await screen.findByText("main.main"));
    expect(onRoot).toHaveBeenCalledWith(main.id);
  });

  it("says when the root cannot be loaded, and tries again on request", async () => {
    const src = new FakeSource();
    const func = vi.spyOn(src, "func");
    func.mockRejectedValueOnce(new Error("no such function"));
    show(src, main.id, { ...notesJa, funcs: {} });
    expect(await screen.findByText(/Could not load/)).toBeTruthy();
    expect(screen.getByText(/no such function/)).toBeTruthy();
    fireEvent.click(screen.getByText("Try again"));
    await waitFor(() => expect(nodeOf("Run")).toBeTruthy());
    expect(func.mock.calls.filter(([id]) => id === main.id)).toHaveLength(2);
  });
});

describe("FlowView after the code changed", () => {
  it.each(["succeeds", "fails"])(
    "drops an answer that %s for the source it left",
    async (how) => {
      // A source whose answers wait until the test lets them through.
      const waiting: (() => void)[] = [];
      const slow = new FakeSource();
      const answer =
        how === "fails"
          ? () => Promise.reject(new Error("late"))
          : slow.func.bind(slow);
      slow.func = (id: string) =>
        new Promise((resolve, reject) =>
          waiting.push(() => {
            answer(id).then(resolve, reject);
          }),
        );
      const { rerender } = show(slow, main.id);
      await waitFor(() => expect(waiting.length).toBeGreaterThan(0));

      rerender(
        <NotesContext.Provider value={notesJa}>
          <FlowView
            source={anew(new FakeSource())}
            root={main.id}
            onRoot={vi.fn()}
            onShowPackage={vi.fn()}
          />
        </NotesContext.Provider>,
      );
      await waitFor(() => expect(nodeOf("main")).toBeTruthy());
      // The old answer lands after the switch, and changes nothing.
      await act(async () => {
        for (const go of waiting) go();
        await Promise.resolve();
      });
      expect(screen.queryByText(/Could not load/)).toBeNull();
      expect(nodeOf("main")).toBeTruthy();
    },
  );
});
