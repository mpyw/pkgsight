export interface Point {
  x: number;
  y: number;
}

// rounded draws a polyline through points with its corners rounded.
export function rounded(points: Point[], radius: number): string {
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [a, b, c] = [points[i - 1], points[i], points[i + 1]];
    const r = Math.min(radius, dist(a, b) / 2, dist(b, c) / 2);
    const p = toward(b, a, r);
    const q = toward(b, c, r);
    d += ` L ${p.x} ${p.y} Q ${b.x} ${b.y} ${q.x} ${q.y}`;
  }
  const last = points[points.length - 1];
  return `${d} L ${last.x} ${last.y}`;
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

function toward(from: Point, to: Point, r: number): Point {
  const d = dist(from, to) || 1;
  return {
    x: from.x + ((to.x - from.x) * r) / d,
    y: from.y + ((to.y - from.y) * r) / d,
  };
}
