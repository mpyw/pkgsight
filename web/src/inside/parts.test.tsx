// @vitest-environment jsdom
import {
  ReactFlowProvider,
  type EdgeProps,
  type NodeProps,
} from "@xyflow/react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { details, run } from "../test/fake";
import type { IEdge, INode } from "./graph";
import { InsideEdge, type InsideEdgeType } from "./InsideEdge";
import {
  FileBox,
  FuncBox,
  PackagePort,
  shortPath,
  TypeBox,
  type InsideNode,
} from "./nodes";

const props = (n: INode, extra: Partial<InsideNode["data"]> = {}) =>
  ({
    data: {
      n,
      emphasis: "plain",
      home: "ex.com/app/internal/server",
      ...extra,
    },
  }) as unknown as NodeProps<InsideNode>;

const wrap = (el: React.ReactElement) =>
  render(<ReactFlowProvider>{el}</ReactFlowProvider>);

describe("inside nodes", () => {
  it("bolds exported functions and counts folded closures", () => {
    const { container } = wrap(
      <FuncBox
        {...props(
          {
            id: run.id,
            kind: "func",
            label: "Run",
            fn: details.get(run.id),
            folded: 1,
          },
          { summary: "要約", lang: "ja", emphasis: "selected" },
        )}
      />,
    );
    expect(container.querySelector(".ibox")!.className).toBe(
      "ibox func selected exported",
    );
    expect(screen.getByTitle("1 closure folded in").textContent).toBe("+1ƒ");
    expect(screen.getByText("要約").getAttribute("lang")).toBe("ja");
    wrap(
      <FuncBox
        {...props(
          { id: "s", kind: "func", label: "old" },
          { summary: "古い", stale: true },
        )}
      />,
    );
    expect(screen.getByText("古い").className).toBe("summary stale");
    wrap(
      <FuncBox
        {...props({ id: "f", kind: "func", label: "loop", folded: 2 })}
      />,
    );
    expect(screen.getByTitle("2 closures folded in")).toBeTruthy();
    expect(document.querySelectorAll(".ibox.func.exported")).toHaveLength(1);
  });

  it("names a type box and a package on either side", () => {
    wrap(
      <TypeBox
        {...props({ id: "type:Server", kind: "type", label: "Server" })}
      />,
    );
    expect(screen.getByText("Server")).toBeTruthy();
    const out = wrap(
      <PackagePort
        {...props({
          id: "out:p",
          kind: "out",
          label: "x",
          pkg: "ex.com/app/internal/store",
        })}
      />,
    );
    expect(out.container.textContent).toBe("→store");
    const into = wrap(
      <PackagePort
        {...props({ id: "in:p", kind: "in", label: "ex.com/app/cmd/app" })}
      />,
    );
    expect(into.container.textContent).toBe("cmd/app→");
  });
});

describe("shortPath", () => {
  it("drops the directories shared with home", () => {
    expect(shortPath("a/b/c", "a/b/d")).toBe("d");
    expect(shortPath("a/b/c", "a/x/y")).toBe("x/y");
    expect(shortPath("a/b/c", "a/b")).toBe("b");
    expect(shortPath("a", "z")).toBe("z");
  });
});

describe("InsideEdge", () => {
  const edge = (e: Partial<IEdge>, flow = "plain") =>
    ({
      id: "e",
      data: {
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        e: {
          id: "e",
          source: "a",
          target: "b",
          count: 1,
          mode: "call",
          dispatch: "static",
          maybe: false,
          ...e,
        },
        flow,
      },
    }) as unknown as EdgeProps<InsideEdgeType>;

  it("counts call sites inside, and functions across packages", () => {
    const inner = render(
      <svg>
        <InsideEdge {...edge({ count: 2, mode: "go", maybe: true }, "out")} />
      </svg>,
    );
    expect(inner.container.querySelector("title")!.textContent).toBe(
      "2 call sites",
    );
    expect(inner.container.querySelector("g")!.getAttribute("class")).toBe(
      "iedge mode-go dispatch-static maybe out",
    );
    const cross = render(
      <svg>
        <InsideEdge {...edge({ source: "in:x" })} />
        <InsideEdge {...edge({ target: "out:y", count: 3 })} />
      </svg>,
    );
    expect(
      [...cross.container.querySelectorAll("title")].map((t) => t.textContent),
    ).toEqual(["1 function", "3 functions"]);
    expect(cross.container.querySelector("g")!.getAttribute("class")).toContain(
      "cross",
    );
    const one = render(
      <svg>
        <InsideEdge {...edge({})} />
      </svg>,
    );
    expect(one.container.querySelector("title")!.textContent).toBe(
      "1 call site",
    );
    const none = render(
      <svg>
        <InsideEdge {...({ id: "x" } as EdgeProps<InsideEdgeType>)} />
      </svg>,
    );
    expect(none.container.querySelector("g")).toBeNull();
  });
});

describe("files and hubs", () => {
  it("draws a closed file with its count, hub and tags", () => {
    const { container } = wrap(
      <FileBox
        {...props(
          {
            id: "file:a/x.go",
            kind: "file",
            label: "x.go",
            file: "a/x.go",
            count: 3,
            hub: 6,
            stubs: [
              { id: "f:y", label: "y.go" },
              { id: "in:ex.com/app/cmd", label: "cmd", from: true },
            ],
          },
          { emphasis: "dim" },
        )}
      />,
    );
    expect(container.querySelector(".ibox")!.className).toBe(
      "ibox file closed dim",
    );
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("←6")).toBeTruthy();
    expect(screen.getByTitle("Calls y.go").textContent).toBe("→ y.go");
    expect(screen.getByTitle("Called from ex.com/app/cmd").textContent).toBe(
      "cmd →",
    );
  });

  it("closes an open file from its header", () => {
    const onToggle = vi.fn();
    wrap(
      <FileBox
        {...props(
          {
            id: "file:a/x.go",
            kind: "file",
            label: "x.go",
            file: "a/x.go",
            open: true,
          },
          { onToggle },
        )}
      />,
    );
    fireEvent.click(screen.getByTitle("Close the file"));
    expect(onToggle).toHaveBeenCalledWith("a/x.go");
    // A file node of generated code has no file.
    wrap(
      <FileBox
        {...props(
          { id: "file:", kind: "file", label: "(generated)", open: true },
          { onToggle },
        )}
      />,
    );
    fireEvent.click(screen.getAllByTitle("Close the file")[1]);
    expect(onToggle).toHaveBeenLastCalledWith("");
    // Without a handler, the header does nothing.
    wrap(
      <FileBox
        {...props({ id: "file:b", kind: "file", label: "b.go", open: true })}
      />,
    );
    fireEvent.click(screen.getAllByTitle("Close the file")[2]);
  });

  it("counts the callers of a hub function, and of a package calling in", () => {
    wrap(
      <FuncBox {...props({ id: "h", kind: "func", label: "err", hub: 9 })} />,
    );
    expect(screen.getByTitle(/Called from 9 places/).textContent).toBe("←9");
    wrap(
      <PackagePort
        {...props({ id: "in:p", kind: "in", label: "p", pkg: "p", hub: 4 })}
      />,
    );
    expect(
      screen.getByTitle("Calls into 4 boxes, tagged on them").textContent,
    ).toBe("4");
  });
});
