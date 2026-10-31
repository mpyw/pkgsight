// @vitest-environment jsdom
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Notes } from "../data/types";
import { buildForest } from "../map/tree";
import { NotesContext } from "../notes/useNotes";
import { FakeSource, graph, notesJa } from "../test/fake";
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
) {
  const h = { onBack: vi.fn(), onInside: vi.fn(), onFlow: vi.fn() };
  const r = render(
    <NotesContext.Provider value={notes}>
      <InsideView source={source} forest={forest} path={path} {...h} />
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
