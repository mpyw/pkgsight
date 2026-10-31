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
  return {
    view: views.find((v) => v === q.get("view")) ?? "map",
    pkg: q.get("pkg") ?? undefined,
    fn: q.get("fn") ?? undefined,
  };
}

export function writePlace(p: Place): void {
  const q = new URLSearchParams();
  if (p.view !== "map") q.set("view", p.view);
  if (p.pkg) q.set("pkg", p.pkg);
  if (p.fn) q.set("fn", p.fn);
  const hash = q.size > 0 ? `#${q}` : "";
  if (location.hash !== hash)
    history.replaceState(null, "", hash || location.pathname);
}
