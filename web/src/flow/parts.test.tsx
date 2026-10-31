// @vitest-environment jsdom
import {
  ReactFlowProvider,
  type EdgeProps,
  type NodeProps,
} from "@xyflow/react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Call, Notes } from "../data/types";
import { NotesContext } from "../notes/useNotes";
import {
  details,
  FakeSource,
  main,
  notesJa,
  printLine,
  run,
  run1,
} from "../test/fake";
import { FlowEdge, type FlowEdgeType } from "./FlowEdge";
import { FuncNode, type FuncNodeType } from "./FuncNode";
import { FuncPanel } from "./FuncPanel";
import { SourceView } from "./SourceView";
import type { FlowNode } from "./tree";

const node = (over: Partial<FlowNode>): FlowNode => ({
  key: "k",
  fn: run,
  depth: 1,
  children: [],
  recursive: false,
  expanded: false,
  ...over,
});

const call = (over: Partial<Call>): Call => ({
  to: run,
  mode: "call",
  dispatch: "static",
  lines: [6],
  ...over,
});

function renderNode(n: FlowNode, extra: Partial<FuncNodeType["data"]> = {}) {
  const onToggle = vi.fn();
  const props = {
    data: { n, selected: false, onPath: false, onToggle, ...extra },
  } as unknown as NodeProps<FuncNodeType>;
  const r = render(
    <ReactFlowProvider>
      <FuncNode {...props} />
    </ReactFlowProvider>,
  );
  return { ...r, onToggle };
}

describe("FuncNode", () => {
  it("tags how it was called", () => {
    const { container } = renderNode(
      node({
        via: call({
          mode: "go",
          dispatch: "dynamic",
          through: "sync.(*WaitGroup).Go",
          lines: [1, 2],
        }),
        recursive: true,
      }),
      { selected: true, onPath: true },
    );
    expect(container.querySelector(".fnode")!.className).toBe(
      "fnode kind-own selected on-path",
    );
    expect(screen.getByText("go")).toBeTruthy();
    expect(screen.getByText("×2")).toBeTruthy();
    expect(screen.getByText("via (*WaitGroup).Go")).toBeTruthy();
    expect(screen.getByText("↺ recursive")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("marks an interface call, a guess, and a function value", () => {
    renderNode(node({ via: call({ dispatch: "interface", maybe: true }) }));
    expect(screen.getByText("iface?")).toBeTruthy();
    renderNode(node({ via: call({ dispatch: "interface" }) }));
    expect(screen.getByText("iface")).toBeTruthy();
    renderNode(node({ via: call({ dispatch: "dynamic" }) }));
    expect(screen.getByText("func value")).toBeTruthy();
  });

  it("names a library function by its package path", () => {
    renderNode(node({ fn: printLine }));
    expect(screen.getByText("fmt")).toBeTruthy();
  });

  it("toggles from its badge without selecting the node", () => {
    const outer = vi.fn();
    const onToggle = vi.fn();
    const n = node({ hidden: 3 });
    const props = {
      data: {
        n,
        selected: false,
        onPath: false,
        onToggle,
        summary: "要約",
        lang: "ja",
      },
    } as unknown as NodeProps<FuncNodeType>;
    render(
      <ReactFlowProvider>
        {/* React Flow selects a node from a click on its wrapper. */}
        <div onClick={outer}>
          <FuncNode {...props} />
        </div>
      </ReactFlowProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "+3" }));
    expect(onToggle).toHaveBeenCalledWith(n);
    expect(outer).not.toHaveBeenCalled();
    expect(screen.getByText("要約").getAttribute("lang")).toBe("ja");
    expect(screen.getByText("要約").className).toBe("summary");
    render(
      <ReactFlowProvider>
        <FuncNode
          {...({
            data: { ...props.data, summary: "古い", stale: true },
          } as unknown as NodeProps<FuncNodeType>)}
        />
      </ReactFlowProvider>,
    );
    expect(screen.getByText("古い").className).toBe("summary stale");
    renderNode(node({ expanded: true }));
    expect(screen.getByTitle("Close the calls").textContent).toBe("−");
  });
});

describe("FlowEdge", () => {
  it("draws an elbow styled by the call", () => {
    const props = {
      id: "e",
      data: {
        from: { x: 0, y: 0 },
        to: { x: 100, y: 50 },
        via: call({ mode: "defer", maybe: true }),
        onPath: true,
      },
    } as unknown as EdgeProps<FlowEdgeType>;
    const { container } = render(
      <svg>
        <FlowEdge {...props} />
      </svg>,
    );
    expect(container.querySelector("g")!.getAttribute("class")).toBe(
      "flow-edge mode-defer dispatch-static maybe on-path",
    );
    expect(container.querySelector("path")!.getAttribute("d")).toContain(
      "M 0 0",
    );
    const none = render(
      <svg>
        <FlowEdge {...({ id: "x" } as EdgeProps<FlowEdgeType>)} />
      </svg>,
    );
    expect(none.container.querySelector("g")).toBeNull();
  });
});

describe("SourceView", () => {
  it("marks call lines, and puts notes above their lines at their indent", async () => {
    const src = new FakeSource();
    const { container } = render(
      <SourceView
        source={src}
        file="internal/server/main.go"
        from={8}
        to={16}
        calls={details.get(run.id)!.calls}
        notes={notesJa.funcs[run.id].lines}
        lang="ja"
        focus={14}
      />,
    );
    await waitFor(() => expect(container.textContent).toContain("func"));
    const lines = [...container.querySelectorAll(".line")];
    expect(lines).toHaveLength(9);
    expect(lines[3].className).toBe("line call mode-go");
    expect(lines[6].className).toBe("line call mode-defer focus");
    expect(lines[7].className).toBe("line call mode-call");
    const notes = [...container.querySelectorAll(".vnote")];
    expect(notes.map((n) => n.className)).toEqual([
      "vnote alert-note",
      "vnote alert-tip",
      "vnote",
      "vnote stale",
    ]);
    // Line 11 starts with one tab, which is four columns.
    expect(
      (notes[1].querySelector(".text") as HTMLElement).style.marginLeft,
    ).toBe("4ch");
    expect(notes[1].textContent).toContain("Tip");
    expect(notes[1].querySelector("strong")!.textContent).toBe("並列");
    expect(notes[3].getAttribute("title")).toContain("changed");
  });

  it("shows loading, then an error", async () => {
    const { container } = render(
      <SourceView
        source={new FakeSource({ failSource: true })}
        file="x.go"
        from={1}
        to={2}
        calls={[]}
      />,
    );
    expect(container.textContent).toBe("Loading…");
    await waitFor(() =>
      expect(container.querySelector(".source.error")).toBeTruthy(),
    );
  });

  it("counts spaces in an indent", async () => {
    const { container } = render(
      <SourceView
        source={new FakeSource()}
        file="internal/server/main.go"
        from={20}
        to={21}
        calls={[]}
        notes={[{ line: 20, text: "x" }]}
      />,
    );
    await waitFor(() =>
      expect(container.querySelector(".vnote .text")).toBeTruthy(),
    );
    expect(
      (container.querySelector(".vnote .text") as HTMLElement).style.marginLeft,
    ).toBe("2ch");
  });
});

describe("FuncPanel", () => {
  const book: Notes = notesJa;
  const props = {
    source: new FakeSource(),
    onRoot: vi.fn(),
    onShowPackage: vi.fn(),
    onClose: vi.fn(),
  };

  it("shows a function of the module, how it was reached, and its callers", async () => {
    render(
      <NotesContext.Provider value={book}>
        <FuncPanel
          {...props}
          fn={run1}
          detail={details.get(run1.id)}
          via={call({
            to: run1,
            mode: "go",
            dispatch: "dynamic",
            through: "sync.(*WaitGroup).Go",
            maybe: true,
            lines: [11],
          })}
          caller={run}
          isRoot={false}
        />
      </NotesContext.Provider>,
    );
    expect(screen.getByText("Module function")).toBeTruthy();
    expect(screen.getByText("func value")).toBeTruthy();
    expect(screen.getByText(/Handed to/)).toBeTruthy();
    expect(screen.getByText(/a guess from the types/)).toBeTruthy();
    fireEvent.click(screen.getByText("Start the flow here"));
    expect(props.onRoot).toHaveBeenCalledWith(run1.id);
    fireEvent.click(screen.getByText("Show the package"));
    expect(props.onShowPackage).toHaveBeenCalledWith(run1.pkg);
    fireEvent.click(screen.getByText("server.Run"));
    expect(props.onRoot).toHaveBeenLastCalledWith(run.id);
    fireEvent.click(screen.getByLabelText("Close"));
    expect(props.onClose).toHaveBeenCalled();
    await waitFor(() =>
      expect(document.querySelector(".source .line")).toBeTruthy(),
    );
  });

  it("shows notes, the translated doc, and the source from the doc comment", async () => {
    render(
      <NotesContext.Provider value={book}>
        <FuncPanel {...props} fn={run} detail={details.get(run.id)} isRoot />
      </NotesContext.Provider>,
    );
    expect(screen.getByText("サーバーを動かす")).toBeTruthy();
    expect(screen.getByText("失敗するまで動かす。")).toBeTruthy();
    expect(screen.getByText("Run serves until it fails.")).toBeTruthy();
    expect(screen.queryByText("Start the flow here")).toBeNull();
    await waitFor(() =>
      expect(document.querySelector(".source .line .ln")!.textContent).toBe(
        "8",
      ),
    );
  });

  it("calls a library function a leaf", () => {
    render(<FuncPanel {...props} fn={printLine} isRoot={false} />);
    expect(screen.getByText("Standard library")).toBeTruthy();
    expect(screen.getByText(/this is a leaf/)).toBeTruthy();
    expect(screen.queryByText("Show the package")).toBeNull();
    expect(screen.queryByText(/Called by/)).toBeNull();
    render(
      <FuncPanel
        {...props}
        fn={{ ...main, kind: "ext", pkg: "golang.org/x/sync/errgroup" }}
        via={call({ dispatch: "interface" })}
        caller={main}
        isRoot={false}
      />,
    );
    expect(screen.getByText("Dependency")).toBeTruthy();
  });
});
