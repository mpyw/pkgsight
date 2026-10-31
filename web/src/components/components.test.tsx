// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Panel } from "./Panel";
import { Toolbar } from "./Toolbar";

beforeEach(() => {
  localStorage.clear();
  window.innerWidth = 1600;
});
afterEach(() => vi.restoreAllMocks());

const width = () =>
  parseFloat((document.querySelector(".panel") as HTMLElement).style.width);

describe("Panel", () => {
  it("starts at a width that fits the window", () => {
    render(<Panel>body</Panel>);
    expect(width()).toBe(560);
    expect(screen.getByText("body")).toBeTruthy();
  });

  it("reads a remembered width, and caps it", () => {
    localStorage.setItem("pkgsight.panelWidth", "700");
    const { unmount } = render(<Panel>x</Panel>);
    expect(width()).toBe(700);
    unmount();
    localStorage.setItem("pkgsight.panelWidth", "5000");
    render(<Panel>x</Panel>);
    expect(width()).toBe(1280);
  });

  it("resizes by dragging its left edge, within bounds, and remembers", () => {
    render(<Panel>x</Panel>);
    const handle = screen.getByRole("separator");
    fireEvent.pointerDown(handle, { clientX: 1000 });
    expect(document.body.classList.contains("resizing")).toBe(true);
    fireEvent.pointerMove(window, { clientX: 900 });
    expect(width()).toBe(660);
    fireEvent.pointerMove(window, { clientX: 2000 });
    expect(width()).toBe(300);
    fireEvent.pointerMove(window, { clientX: -2000 });
    expect(width()).toBe(1280);
    fireEvent.pointerUp(window);
    expect(document.body.classList.contains("resizing")).toBe(false);
    expect(localStorage.getItem("pkgsight.panelWidth")).toBe("1280");
    fireEvent.pointerMove(window, { clientX: 1000 });
    expect(width()).toBe(1280);
  });

  it("works when storage is off", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    render(<Panel>x</Panel>);
    expect(width()).toBe(560);
    fireEvent.pointerDown(screen.getByRole("separator"), { clientX: 0 });
    fireEvent.pointerUp(window);
  });
});

describe("Toolbar", () => {
  const props = {
    title: "ex.com/app",
    stats: "3 packages",
    view: "map" as const,
    onView: vi.fn(),
    langs: [] as string[],
    onLang: vi.fn(),
  };

  it("selects the Packages tab inside a package too", () => {
    const { rerender } = render(<Toolbar {...props} view="inside" />);
    const [map, flow] = screen.getAllByRole("tab");
    expect(map.getAttribute("aria-selected")).toBe("true");
    expect(flow.getAttribute("aria-selected")).toBe("false");
    fireEvent.click(flow);
    expect(props.onView).toHaveBeenCalledWith("flow");
    rerender(<Toolbar {...props} view="flow" />);
    expect(flow.getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("names each language in itself, and turns notes off", () => {
    render(<Toolbar {...props} langs={["en", "ja"]} lang="ja" />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect([...select.options].map((o) => o.text)).toEqual([
      "English",
      "日本語",
      "Off",
    ]);
    fireEvent.change(select, { target: { value: "" } });
    expect(props.onLang).toHaveBeenLastCalledWith(undefined);
    fireEvent.change(select, { target: { value: "en" } });
    expect(props.onLang).toHaveBeenLastCalledWith("en");
  });

  it("shows a tag it cannot name as it is", () => {
    vi.spyOn(Intl, "DisplayNames").mockImplementation(() => {
      throw new RangeError("bad tag");
    });
    render(<Toolbar {...props} langs={["xx-bogus"]} />);
    expect(screen.getByRole("option", { name: "xx-bogus" })).toBeTruthy();
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("");
  });
});
