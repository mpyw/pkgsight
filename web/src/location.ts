// The URL fragment keeps what is on screen, so a link opens the same view.
// It reads like a query string: #view=flow&fn=<id>.

// "inside" is the functions of the package pkg, reached from the map.
export type ViewName = "map" | "inside" | "flow";

const views: ViewName[] = ["map", "inside", "flow"];

export interface Place {
  view: ViewName;
  pkg?: string;
  fn?: string;
}

export function readPlace(): Place {
  const q = new URLSearchParams(location.hash.slice(1));
  const pkg = q.get("pkg") ?? undefined;
  let view = views.find((v) => v === q.get("view")) ?? "map";
  // Inside no package is the map.
  if (view === "inside" && pkg === undefined) view = "map";
  return { view, pkg, fn: q.get("fn") ?? undefined };
}

// moves reports whether going from a to b is a move the back button should
// undo: to another view, or to another package or function of the same
// view. Inside a package, going from one function to another is one too,
// since focus redraws around it. Picking a package on the map, or picking
// or dropping a function inside, is not.
export function moves(a: Place, b: Place): boolean {
  if (a.view !== b.view) return true;
  if (b.view === "inside")
    return (
      a.pkg !== b.pkg ||
      (a.fn !== undefined && b.fn !== undefined && a.fn !== b.fn)
    );
  if (b.view === "flow") return a.fn !== b.fn;
  return false;
}

// writePlace puts p in the fragment, as a new history entry when push is
// set, or in place of the current one.
export function writePlace(p: Place, push = false): void {
  const q = new URLSearchParams();
  if (p.view !== "map") q.set("view", p.view);
  if (p.pkg) q.set("pkg", p.pkg);
  if (p.fn) q.set("fn", p.fn);
  const hash = q.size > 0 ? `#${q}` : "";
  if (location.hash === hash) return;
  if (push) history.pushState(null, "", hash || location.pathname);
  else history.replaceState(null, "", hash || location.pathname);
}
