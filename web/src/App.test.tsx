// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { FakeSource, main } from "./test/fake";

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["ja"]);
});
afterEach(() => {
  vi.restoreAllMocks();
  history.replaceState(null, "", "/");
});

describe("App", () => {
  it("shows loading, then an error", async () => {
    render(<App source={new FakeSource({ failGraph: true })} />);
    expect(screen.getByText("Loading packages…")).toBeTruthy();
    expect(await screen.findByText(/500 boom/)).toBeTruthy();
  });

  it("starts on the map, with the module and its counts", async () => {
    render(<App source={new FakeSource()} />);
    expect(await screen.findByText("ex.com/app")).toBeTruthy();
    expect(screen.getByText("3 packages · 5 imports")).toBeTruthy();
    expect(await screen.findByRole("combobox")).toBeTruthy();
    expect(location.hash).toBe("");
  });

  it("moves between views, and keeps the place in the URL", async () => {
    history.replaceState(null, "", "#pkg=ex.com%2Fapp%2Finternal%2Fserver");
    render(<App source={new FakeSource()} />);
    const panel = await waitFor(() => {
      const p = document.querySelector(".panel");
      if (!p) throw new Error("no panel");
      return p as HTMLElement;
    });
    fireEvent.click(within(panel).getByText("Look inside"));
    await waitFor(() =>
      expect(location.hash).toBe(
        "#view=inside&pkg=ex.com%2Fapp%2Finternal%2Fserver",
      ),
    );
    expect(await screen.findByText("← Packages")).toBeTruthy();
    // Going inside another package keeps the view.
    await waitFor(() =>
      expect(document.querySelector(".port-pkg")).toBeTruthy(),
    );
    const store = [...document.querySelectorAll(".port-pkg")].find((p) =>
      p.textContent?.includes("store"),
    )!;
    fireEvent.click(store);
    await waitFor(() =>
      expect(location.hash).toBe(
        "#view=inside&pkg=ex.com%2Fapp%2Finternal%2Fstore",
      ),
    );
    fireEvent.click(screen.getByText("← Packages"));
    await waitFor(() =>
      expect(location.hash).toBe("#pkg=ex.com%2Fapp%2Finternal%2Fstore"),
    );
    fireEvent.click(screen.getByRole("tab", { name: "Call flow" }));
    await waitFor(() => expect(screen.getByText("Programs")).toBeTruthy());
    fireEvent.click(await screen.findByTitle("ex.com/app/cmd/app.main"));
    await waitFor(() =>
      expect(location.hash).toBe(
        "#view=flow&pkg=ex.com%2Fapp%2Finternal%2Fstore&fn=ex.com%2Fapp%2Fcmd%2Fapp.main",
      ),
    );
    const flowPanel = await waitFor(() => {
      const p = document.querySelector(".panel");
      if (!p) throw new Error("no panel");
      return p as HTMLElement;
    });
    fireEvent.click(within(flowPanel).getByText("Show the package"));
    await waitFor(() =>
      expect(location.hash).toBe(
        "#pkg=ex.com%2Fapp%2Fcmd%2Fapp&fn=ex.com%2Fapp%2Fcmd%2Fapp.main",
      ),
    );
  });

  it("goes back to the view before with the back button", async () => {
    history.replaceState(null, "", "#pkg=ex.com%2Fapp%2Finternal%2Fserver");
    render(<App source={new FakeSource()} />);
    const panel = await waitFor(() => {
      const p = document.querySelector(".panel");
      if (!p) throw new Error("no panel");
      return p as HTMLElement;
    });
    fireEvent.click(within(panel).getByText("Look inside"));
    expect(await screen.findByText("← Packages")).toBeTruthy();
    history.back();
    await waitFor(() =>
      expect(location.hash).toBe("#pkg=ex.com%2Fapp%2Finternal%2Fserver"),
    );
    await waitFor(() => expect(screen.queryByText("← Packages")).toBeNull());
    // Going back wrote nothing new, so forward still returns.
    history.forward();
    expect(await screen.findByText("← Packages")).toBeTruthy();
  });

  it("does not push when the URL it goes back to is written another way", async () => {
    render(<App source={new FakeSource()} />);
    await screen.findByRole("tab", { name: "Packages" });
    // An entry written by hand, with its fields in another order.
    history.pushState(
      null,
      "",
      "#pkg=ex.com%2Fapp%2Finternal%2Fserver&view=inside",
    );
    history.back();
    await waitFor(() => expect(location.hash).toBe(""));
    const before = history.length;
    history.forward();
    expect(await screen.findByText("← Packages")).toBeTruthy();
    await waitFor(() =>
      expect(location.hash).toBe(
        "#view=inside&pkg=ex.com%2Fapp%2Finternal%2Fserver",
      ),
    );
    expect(history.length).toBe(before);
  });

  it("opens the flow from a function in the package panel", async () => {
    history.replaceState(null, "", "#pkg=ex.com%2Fapp%2Finternal%2Fserver");
    render(<App source={new FakeSource()} />);
    fireEvent.click(await screen.findByText("Run"));
    await waitFor(() => expect(location.hash).toContain("view=flow"));
    expect(location.hash).toContain("fn=ex.com%2Fapp%2Finternal%2Fserver.Run");
  });

  it("starts the flow from a function inside a package", async () => {
    history.replaceState(
      null,
      "",
      "#view=inside&pkg=ex.com%2Fapp%2Finternal%2Fserver",
    );
    render(<App source={new FakeSource()} />);
    const run = await waitFor(() => {
      const n = [...document.querySelectorAll(".react-flow__node")].find(
        (e) => e.querySelector(".name")?.textContent === "Run",
      );
      if (!n) throw new Error("no Run");
      return n as HTMLElement;
    });
    fireEvent.click(run);
    fireEvent.click(await screen.findByText("Start the flow here"));
    await waitFor(() =>
      expect(location.hash).toBe(
        "#view=flow&pkg=ex.com%2Fapp%2Finternal%2Fserver&fn=ex.com%2Fapp%2Finternal%2Fserver.Run",
      ),
    );
  });

  it("falls back to the map inside no package, and turns notes off", async () => {
    history.replaceState(null, "", "#view=inside");
    render(<App source={new FakeSource()} />);
    expect(await screen.findByText("Expand all")).toBeTruthy();
    const select = (await screen.findByRole("combobox")) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("ja"));
    fireEvent.change(select, { target: { value: "" } });
    await waitFor(() => expect(select.value).toBe(""));
    expect(localStorage.getItem("pkgsight.notesLang")).toBe("off");
  });

  it("fetches anew when the server analyzed the code again", async () => {
    history.replaceState(
      null,
      "",
      `#view=flow&fn=${encodeURIComponent(main.id)}`,
    );
    const source = new FakeSource();
    render(<App source={source} />);
    expect(await screen.findByText("Call graph built in 1.2s")).toBeTruthy();
    await waitFor(() => expect(source.funcCalls).toContain(main.id));
    const before = source.funcCalls.filter((id) => id === main.id).length;
    act(() => source.reload());
    await waitFor(() => expect(source.graphCalls).toBe(2));
    await waitFor(() =>
      expect(source.funcCalls.filter((id) => id === main.id).length).toBe(
        before + 1,
      ),
    );
    // The place stays.
    expect(location.hash).toContain("view=flow");
  });

  it("titles a module-less graph by its root", async () => {
    const src = new FakeSource();
    vi.spyOn(src, "graph").mockResolvedValue({
      root: "/src/x",
      modules: [],
      packages: [],
    });
    render(<App source={src} />);
    expect(await screen.findByText("/src/x")).toBeTruthy();
    expect(screen.getByText("0 packages · 0 imports")).toBeTruthy();
  });
});
