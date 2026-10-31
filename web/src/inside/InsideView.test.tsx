// @vitest-environment jsdom
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { FuncDetail, Notes } from "../data/types";
import { buildForest } from "../map/tree";
import { NotesContext } from "../notes/useNotes";
import { FakeSource, graph, notesJa } from "../test/fake";
import { GROUP_AT } from "./graph";
import { InsideView } from "./InsideView";

const forest = buildForest(graph);
const server = "ex.com/app/internal/server";

const boxOf = (text: string) =>
  [...document.querySelectorAll(".react-flow__node")].find((n) =>
    n.querySelector(".name, .header")?.textContent?.endsWith(text),
  ) as HTMLElement | undefined;

function show(
  source = new FakeSource(),
  path = server,
  notes: Notes | undefined = notesJa,
  fn?: string,
) {
  const h = {
    onBack: vi.fn(),
    onInside: vi.fn(),
    onFlow: vi.fn(),
    onPick: vi.fn(),
  };
  // Holds the pick, as the URL does in the app.
  function Picking() {
    const [picked, setPicked] = useState(fn);
    return (
      <InsideView
        source={source}
        forest={forest}
        path={path}
        {...h}
        fn={picked}
        onPick={(id) => {
          h.onPick(id);
          setPicked(id);
        }}
      />
    );
  }
  const r = render(
    <NotesContext.Provider value={notes}>
      <Picking />
    </NotesContext.Provider>,
  );
  return { ...r, ...h };
}

describe("InsideView", () => {
  it("draws the functions, their types and the packages around them", async () => {
    const h = show();
    expect(screen.getByText(server)).toBeTruthy();
    expect(screen.getByText("サーバーの起動")).toBeTruthy();
    await waitFor(() => expect(boxOf("Run")).toBeTruthy());
    expect(boxOf("Server")).toBeTruthy();
    expect(boxOf("Serve")).toBeTruthy();
    expect(screen.getByText("2 functions · 1 calls inside")).toBeTruthy();
    expect(boxOf("Run$1")).toBeUndefined();
    fireEvent.click(screen.getByText("← Packages"));
    expect(h.onBack).toHaveBeenCalled();
    // A package on either side goes inside it.
    const port = [...document.querySelectorAll(".port-pkg")].find((p) =>
      p.textContent?.includes("store"),
    )!;
    fireEvent.click(port);
    expect(h.onInside).toHaveBeenCalledWith("ex.com/app/internal/store");
    // A type box does nothing on a click.
    fireEvent.click(boxOf("Server")!);
    expect(document.querySelector(".panel")).toBeNull();
  });

  it("shows closures on request", async () => {
    show();
    await waitFor(() => expect(boxOf("Run")).toBeTruthy());
    fireEvent.click(screen.getByText("Closures"));
    await waitFor(() => expect(boxOf("Run$1")).toBeTruthy());
  });

  it("selects a function, dims the rest, and opens its flow", async () => {
    const h = show();
    await waitFor(() => expect(boxOf("Run")).toBeTruthy());
    fireEvent.click(boxOf("Run")!);
    expect(boxOf("Run")!.querySelector(".ibox")!.className).toContain(
      "selected",
    );
    expect(boxOf("Serve")!.querySelector(".ibox")!.className).toContain(
      "linked",
    );
    const panel = document.querySelector(".panel") as HTMLElement;
    expect(within(panel).getByText("Run")).toBeTruthy();
    fireEvent.click(within(panel).getByText("Start the flow here"));
    expect(h.onFlow).toHaveBeenCalledWith(`${server}.Run`);
    fireEvent.click(within(panel).getByText("Show the package"));
    expect(h.onBack).toHaveBeenCalled();
    expect(
      document.querySelector(".react-flow__edge.dim, .iedge.out"),
    ).toBeTruthy();
    fireEvent.click(within(panel).getByLabelText("Close"));
    expect(document.querySelector(".panel")).toBeNull();
    fireEvent.click(boxOf("Run")!);
    fireEvent.click(document.querySelector(".react-flow__pane")!);
    expect(document.querySelector(".panel")).toBeNull();
  });

  it("shows the doc when there is no summary, and waits for the call graph", async () => {
    show(
      new FakeSource({ status: [{ state: "pending" }] }),
      "ex.com/app/cmd/app",
      undefined,
    );
    expect(screen.getByText("Command app serves the store.")).toBeTruthy();
    expect(await screen.findByText("Building the call graph…")).toBeTruthy();
  });

  it("says why a package is empty", async () => {
    show(new FakeSource(), "ex.com/app/nothing");
    expect(
      await screen.findByText("This package declares no functions."),
    ).toBeTruthy();
  });

  it("says why a package that does not type-check has no functions", async () => {
    show(
      new FakeSource({
        status: [
          {
            state: "ready",
            skipped: [{ path: "ex.com/app/x", error: "syntax error" }],
          },
        ],
      }),
      "ex.com/app/x",
    );
    expect(await screen.findByText(/does not type-check/)).toBeTruthy();
    expect(screen.getByText("syntax error")).toBeTruthy();
  });

  it("shows a failed call graph and a failed request", async () => {
    show(new FakeSource({ status: [{ state: "error", error: "boom" }] }));
    expect(await screen.findByText("boom")).toBeTruthy();
    show(new FakeSource({ failPackage: true }));
    expect(await screen.findByText(/503/)).toBeTruthy();
  });
});

// big is a package too large to show every function at first: F0 in a.go
// calls F1 in b.go, and the rest call nothing.
const big = "ex.com/app/big";
const bigFuncs: FuncDetail[] = Array.from({ length: GROUP_AT + 1 }, (_, i) => ({
  id: `${big}.F${i}`,
  name: `F${i}`,
  pkg: big,
  pkgName: "big",
  kind: "own",
  file: i % 2 === 0 ? "big/a.go" : "big/b.go",
  calls: [],
  callers: [],
}));
bigFuncs[0].calls = [
  { to: bigFuncs[1], mode: "call", dispatch: "static", lines: [3] },
];
bigFuncs[1].callers = [bigFuncs[0]];

class BigSource extends FakeSource {
  packageFuncs = () => Promise.resolve(bigFuncs);
}

describe("InsideView of a large package", () => {
  it("starts with its files closed, and opens them", async () => {
    show(new BigSource(), big);
    await waitFor(() => expect(boxOf("a.go")).toBeTruthy());
    expect(boxOf("F0")).toBeUndefined();
    expect(
      screen.getByText(`${GROUP_AT + 1} functions · 1 calls inside`),
    ).toBeTruthy();
    fireEvent.click(boxOf("a.go")!);
    await waitFor(() => expect(boxOf("F0")).toBeTruthy());
    expect(boxOf("F1")).toBeUndefined();
    // Clicking an open file does nothing; its header closes it.
    fireEvent.click(boxOf("a.go")!);
    expect(boxOf("F0")).toBeTruthy();
    fireEvent.click(boxOf("a.go")!.querySelector(".header")!);
    await waitFor(() => expect(boxOf("F0")).toBeUndefined());
    fireEvent.click(screen.getByText("Open all files"));
    await waitFor(() => expect(boxOf("F1")).toBeTruthy());
    fireEvent.click(screen.getByText("Close all files"));
    await waitFor(() => expect(boxOf("F1")).toBeUndefined());
  });

  it("shows only the neighbors of the function picked, unless asked not to", async () => {
    show(new BigSource(), big);
    await waitFor(() => expect(boxOf("a.go")).toBeTruthy());
    fireEvent.click(boxOf("a.go")!);
    await waitFor(() => expect(boxOf("F0")).toBeTruthy());
    fireEvent.click(boxOf("F0")!);
    await waitFor(() => expect(boxOf("F1")).toBeTruthy());
    expect(boxOf("F2")).toBeUndefined();
    expect(screen.queryByText("Open all files")).toBeNull();
    // Focus off: the files come back, with the pick dimming the rest.
    fireEvent.click(screen.getByText("Focus"));
    await waitFor(() => expect(boxOf("F2")).toBeTruthy());
    expect(boxOf("b.go")!.querySelector(".ibox")!.className).toContain(
      "linked",
    );
    expect(boxOf("F2")!.querySelector(".ibox")!.className).toContain("dim");
    fireEvent.click(document.querySelector(".react-flow__pane")!);
    expect(document.querySelector(".panel")).toBeNull();
  });

  it("picks the function the URL names, and ignores one of another package", async () => {
    show(new FakeSource(), server, notesJa, `${server}.Run`);
    await waitFor(() =>
      expect(boxOf("Run")!.querySelector(".ibox")!.className).toContain(
        "selected",
      ),
    );
    show(new FakeSource(), server, notesJa, "ex.com/app/cmd/app.main");
    await waitFor(() => expect(boxOf("Serve")).toBeTruthy());
    expect(document.querySelectorAll(".panel")).toHaveLength(1);
  });

  it("opens the file of the function picked", async () => {
    show(new BigSource(), big, notesJa, `${big}.F2`);
    await waitFor(() => expect(boxOf("F2")).toBeTruthy());
    fireEvent.click(screen.getByText("Focus"));
    await waitFor(() => expect(boxOf("b.go")).toBeTruthy());
    expect(boxOf("F2")).toBeTruthy();
    expect(boxOf("F1")).toBeUndefined();
  });

  it("lets a small package focus too", async () => {
    show();
    await waitFor(() => expect(boxOf("Run")).toBeTruthy());
    fireEvent.click(screen.getByText("Focus"));
    fireEvent.click(boxOf("Run")!);
    await waitFor(() => expect(boxOf("Serve")).toBeTruthy());
  });
});
