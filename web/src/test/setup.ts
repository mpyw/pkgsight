// jsdom lacks what React Flow measures with. These stubs give every element
// the size its style asks for, which is enough for nodes to render.
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

if (typeof window !== "undefined") {
  afterEach(cleanup);

  class ResizeObserver {
    constructor(private callback: ResizeObserverCallback) {}
    observe(target: Element) {
      const el = target as HTMLElement;
      const contentRect = { width: el.offsetWidth, height: el.offsetHeight };
      this.callback(
        [{ target, contentRect } as unknown as ResizeObserverEntry],
        this as unknown as globalThis.ResizeObserver,
      );
    }
    unobserve() {}
    disconnect() {}
  }
  class DOMMatrixReadOnly {
    m22: number;
    constructor(transform?: string) {
      const scale = /scale\(([\d.]+)\)/.exec(transform ?? "")?.[1];
      this.m22 = scale === undefined ? 1 : Number(scale);
    }
  }
  Object.assign(globalThis, { ResizeObserver, DOMMatrixReadOnly });
  Object.defineProperties(HTMLElement.prototype, {
    offsetWidth: {
      configurable: true,
      get(this: HTMLElement) {
        return parseFloat(this.style.width) || 800;
      },
    },
    offsetHeight: {
      configurable: true,
      get(this: HTMLElement) {
        return parseFloat(this.style.height) || 600;
      },
    },
  });
  (SVGElement.prototype as unknown as { getBBox: () => DOMRect }).getBBox =
    () => ({ x: 0, y: 0, width: 0, height: 0 }) as DOMRect;
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}
