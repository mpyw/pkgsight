// @vitest-environment jsdom
import {
  ReactFlowProvider,
  type EdgeProps,
  type NodeProps,
} from "@xyflow/react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NotesContext } from "../notes/useNotes";
import { FakeSource, graph, notesJa } from "../test/fake";
import { ContainerNode, GroupNode, PackageNode, type MapNode } from "./nodes";
import { PackagePanel } from "./PackagePanel";
import { RouteEdge, type RouteEdgeType } from "./RouteEdge";
import { buildForest, type VNode } from "./tree";

const v = (over: Partial<VNode>): VNode => ({
  id: "p:x",
  type: "package",
  label: "x",
  kind: "own",
  size: 1,
  tone: 10,
  ...over,
});

const props = (n: VNode, onToggle = vi.fn()) =>
  ({
    id: n.id,
    data: { v: n, emphasis: "plain", onToggle },
  }) as unknown as NodeProps<MapNode>;

const wrap = (el: React.ReactElement) =>
  render(
    <NotesContext.Provider value={notesJa}>
      <ReactFlowProvider>{el}</ReactFlowProvider>
    </NotesContext.Provider>,
  );

describe("map nodes", () => {
  it("shows a package with its summary and its error", () => {
    const pkg = graph.packages.find((p) => p.path.endsWith("server"))!;
    const { container } = wrap(
      <PackageNode {...props(v({ pkg, self: true, label: "server" }))} />,
    );
    expect(container.querySelector(".node")!.className).toBe(
      "node package kind-own plain self noted",
    );
    expect(screen.getByText("サーバーの起動")).toBeTruthy();
    const broken = graph.packages.find((p) => p.error)!;
    wrap(<PackageNode {...props(v({ pkg: broken }))} />);
    expect(screen.getByTitle(broken.error!).textContent).toBe("!");
  });

  it("shows a folded directory and an open one that folds", () => {
    wrap(
      <GroupNode
        {...props(v({ type: "group", label: "internal", size: 4 }))}
      />,
    );
    expect(screen.getByText("internal/")).toBeTruthy();
    expect(screen.getByText("4 packages")).toBeTruthy();
    const onToggle = vi.fn();
    wrap(
      <ContainerNode
        {...props(v({ id: "g:x", type: "container", label: "cmd" }), onToggle)}
      />,
    );
    fireEvent.click(screen.getByTitle("Collapse"));
    expect(onToggle).toHaveBeenCalledWith("g:x");
  });
});

describe("RouteEdge", () => {
  it("draws the route, thicker for more imports", () => {
    const edge = (count: number) =>
      ({
        id: "e",
        data: {
          points: [
            { x: 0, y: 0 },
            { x: 0, y: 10 },
          ],
          count,
          flow: "out",
        },
      }) as unknown as EdgeProps<RouteEdgeType>;
    const one = render(
      <svg>
        <RouteEdge {...edge(1)} />
      </svg>,
    );
    expect(one.container.querySelector("title")!.textContent).toBe("1 import");
    expect(one.container.querySelector("g")!.getAttribute("class")).toBe(
      "route out",
    );
    const four = render(
      <svg>
        <RouteEdge {...edge(4)} />
      </svg>,
    );
    expect(four.container.querySelector("title")!.textContent).toBe(
      "4 imports",
    );
    const none = render(
      <svg>
        <RouteEdge {...({ id: "x" } as EdgeProps<RouteEdgeType>)} />
      </svg>,
    );
    expect(none.container.querySelector("g")).toBeNull();
  });
});

describe("PackagePanel", () => {
  const forest = buildForest(graph);
  const handlers = () => ({
    onReveal: vi.fn(),
    onOpenFunc: vi.fn(),
    onInside: vi.fn(),
    onClose: vi.fn(),
  });

  it("lists imports, importers, functions and files of a module package", async () => {
    const h = handlers();
    const pkg = forest.packages.get("ex.com/app/internal/server")!;
    render(
      <NotesContext.Provider value={notesJa}>
        <PackagePanel
          source={new FakeSource()}
          pkg={pkg}
          forest={forest}
          {...h}
        />
      </NotesContext.Provider>,
    );
    expect(screen.getByText("Module package")).toBeTruthy();
    expect(screen.getByText("サーバーを動かす。")).toBeTruthy();
    // Imports put the module first, then dependencies, then the standard library.
    const imports = [...document.querySelectorAll("section")][0];
    expect(
      [...imports.querySelectorAll("button")].map((b) => b.textContent),
    ).toEqual([
      "ex.com/app/internal/store",
      "golang.org/x/sync/errgroup",
      "fmt",
    ]);
    fireEvent.click(screen.getByText("ex.com/app/cmd/app"));
    expect(h.onReveal).toHaveBeenCalledWith("ex.com/app/cmd/app");
    fireEvent.click(screen.getByText("Look inside"));
    expect(h.onInside).toHaveBeenCalledWith(pkg.path);
    await waitFor(() => expect(screen.getByText("Run")).toBeTruthy());
    // Closures are left out of the list.
    expect(screen.queryByText("Run$1")).toBeNull();
    expect(screen.getByText("サーバーを動かす")).toBeTruthy();
    fireEvent.click(screen.getByText("Run"));
    expect(h.onOpenFunc).toHaveBeenCalledWith("ex.com/app/internal/server.Run");
    fireEvent.click(screen.getByLabelText("Close"));
    expect(h.onClose).toHaveBeenCalled();
  });

  it("says why a package that does not type-check has no functions", async () => {
    const pkg = forest.packages.get("ex.com/app/internal/store")!;
    render(
      <PackagePanel
        source={
          new FakeSource({
            status: [
              {
                state: "ready",
                skipped: [
                  { path: pkg.path, error: "store.go:3: undefined: x" },
                ],
              },
            ],
          })
        }
        pkg={pkg}
        forest={forest}
        {...handlers()}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText(/does not type-check/)).toBeTruthy(),
    );
    expect(
      screen.getByText("store.go:3: undefined: x", { selector: "pre" }),
    ).toBeTruthy();
  });

  it("waits for the call graph before listing functions", async () => {
    const src = new FakeSource({
      status: [{ state: "pending" }, { state: "ready" }],
    });
    const asked = vi.spyOn(src, "packageFuncs");
    render(
      <PackagePanel
        source={src}
        pkg={forest.packages.get("ex.com/app/internal/server")!}
        forest={forest}
        {...handlers()}
      />,
    );
    expect(screen.getByText("…")).toBeTruthy();
    expect(asked).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText("Run")).toBeTruthy(), {
      timeout: 2000,
    });
  });

  it("shows a failed call graph, and a library package without functions", async () => {
    render(
      <PackagePanel
        source={new FakeSource({ status: [{ state: "error", error: "boom" }] })}
        pkg={forest.packages.get("ex.com/app/internal/server")!}
        forest={forest}
        {...handlers()}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText("The call graph failed: boom")).toBeTruthy(),
    );
    const lib = render(
      <PackagePanel
        source={new FakeSource({ failPackage: true })}
        pkg={forest.packages.get("fmt")!}
        forest={forest}
        {...handlers()}
      />,
    );
    expect(lib.container.textContent).toContain("Standard library");
    expect(lib.container.textContent).not.toContain("Look inside");
    expect(lib.container.textContent).not.toContain("Functions");
  });

  it("lists no functions when the request fails", async () => {
    render(
      <PackagePanel
        source={new FakeSource({ failPackage: true })}
        pkg={{
          ...forest.packages.get("ex.com/app/internal/server")!,
          doc: undefined,
        }}
        forest={forest}
        {...handlers()}
      />,
    );
    await waitFor(() =>
      expect(
        [...document.querySelectorAll("h3")].find((h) =>
          h.textContent?.startsWith("Functions"),
        )!.textContent,
      ).toBe("Functions 0"),
    );
  });
});
