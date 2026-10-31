import { useRef, useState, type PointerEvent, type ReactNode } from "react";

const MIN = 300;
const KEY = "pkgsight.panelWidth";

// Panel is the side panel. Dragging its left edge sets its width, which the
// browser remembers for next time.
export function Panel({ children }: { children: ReactNode }) {
  const [width, setWidth] = useState(readWidth);
  const latest = useRef(width);

  const drag = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = latest.current;
    const move = (ev: globalThis.PointerEvent) => {
      latest.current = Math.round(
        Math.min(Math.max(w0 + x0 - ev.clientX, MIN), window.innerWidth * 0.8),
      );
      setWidth(latest.current);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("resizing");
      try {
        localStorage.setItem(KEY, String(latest.current));
      } catch {
        // Storage may be off; the width then lasts until reload.
      }
    };
    document.body.classList.add("resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <aside className="panel" style={{ width }}>
      <div
        className="resize-handle"
        onPointerDown={drag}
        role="separator"
        aria-orientation="vertical"
        title="Drag to resize"
      />
      <div className="panel-body">{children}</div>
    </aside>
  );
}

function readWidth(): number {
  try {
    const w = Number(localStorage.getItem(KEY));
    if (w >= MIN) return Math.min(w, window.innerWidth * 0.8);
  } catch {
    // Fall through to the default.
  }
  return Math.min(560, Math.max(MIN, window.innerWidth * 0.36));
}
