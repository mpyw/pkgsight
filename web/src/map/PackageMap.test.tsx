// @vitest-environment jsdom
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NotesContext } from "../notes/useNotes";
import { FakeSource, graph, notesJa } from "../test/fake";
import { PackageMap } from "./PackageMap";
import { buildForest } from "./tree";

const forest = buildForest(graph);

const nodeOf = (text: string) =>
  [...document.querySelectorAll(".react-flow__node")].find(
    (n) => n.querySelector(".name")?.textContent === text,
  ) as HTMLElement | undefined;

function show(selected?: string) {
  const h = { onSelect: vi.fn(), onOpenFunc: vi.fn(), onInside: vi.fn() };
  const r = render(
    <NotesContext.Provider value={notesJa}>
      <PackageMap
        source={new FakeSource()}
        forest={forest}
        selected={selected}
        {...h}
      />
    </NotesContext.Provider>,
  );
  return { ...r, ...h };
}

describe("PackageMap", () => {
  it("lays out the module, and selects and opens packages", async () => {
    const h = show();
    await waitFor(() => expect(nodeOf("cmd/app")).toBeTruthy());
    expect(screen.queryByText("laying out…")).toBeNull();
    fireEvent.click(nodeOf("cmd/app")!);
    expect(h.onSelect).toHaveBeenCalledWith("ex.com/app/cmd/app");
    fireEvent.doubleClick(nodeOf("cmd/app")!);
    expect(h.onInside).toHaveBeenCalledWith("ex.com/app/cmd/app");
    fireEvent.click(document.querySelector(".react-flow__pane")!);
    expect(h.onSelect).toHaveBeenLastCalledWith(undefined);
  });

  it("shows the standard library on demand, and never goes inside it", async () => {
    const h = show();
    await waitFor(() => expect(nodeOf("cmd/app")).toBeTruthy());
    expect(nodeOf("std/")).toBeUndefined();
    fireEvent.click(screen.getByText("Standard library"));
    await waitFor(() => expect(nodeOf("std/")).toBeTruthy());
    // A folded directory opens on a click.
    fireEvent.click(nodeOf("std/")!);
    await waitFor(() => expect(nodeOf("fmt")).toBeTruthy());
    fireEvent.doubleClick(nodeOf("fmt")!);
    expect(h.onInside).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Standard library"));
    await waitFor(() => expect(nodeOf("fmt")).toBeUndefined());
  });

  it("collapses and expands every directory", async () => {
    show();
    await waitFor(() => expect(nodeOf("cmd/app")).toBeTruthy());
    // Collapsing keeps the top directories open, with what they hold folded.
    fireEvent.click(screen.getByText("Collapse all"));
    await waitFor(() => expect(nodeOf("server")).toBeUndefined());
    expect(nodeOf("internal/")).toBeTruthy();
    fireEvent.click(screen.getByText("Expand all"));
    await waitFor(() => expect(nodeOf("server")).toBeTruthy());
    // An open directory folds from its header.
    const header = screen.getAllByTitle("Collapse")[0];
    fireEvent.click(header);
    await waitFor(() => expect(nodeOf("cmd/app")).toBeUndefined());
  });

  it("opens the panel of a selected package, and reveals what it links to", async () => {
    const h = show("ex.com/app/internal/server");
    await waitFor(() => expect(nodeOf("server")).toBeTruthy());
    expect(nodeOf("server")!.querySelector(".node")!.className).toContain(
      "selected",
    );
    expect(document.querySelector(".react-flow__edge")).toBeTruthy();
    const panel = document.querySelector(".panel") as HTMLElement;
    fireEvent.click(within(panel).getByText("fmt"));
    expect(h.onSelect).toHaveBeenCalledWith("fmt");
    await waitFor(() =>
      expect(
        screen.getByText("Standard library").getAttribute("aria-pressed"),
      ).toBe("true"),
    );
    fireEvent.click(within(panel).getByText("ex.com/app/internal/store"));
    fireEvent.click(within(panel).getByLabelText("Close"));
    expect(h.onSelect).toHaveBeenLastCalledWith(undefined);
    fireEvent.click(await within(panel).findByText("Run"));
    expect(h.onOpenFunc).toHaveBeenCalledWith("ex.com/app/internal/server.Run");
  });

  it("starts with the kind of a selected library package shown", async () => {
    show("golang.org/x/sync/errgroup");
    expect(screen.getByText("Dependencies").getAttribute("aria-pressed")).toBe(
      "true",
    );
    await waitFor(() => expect(nodeOf("errgroup")).toBeTruthy());
  });
});
