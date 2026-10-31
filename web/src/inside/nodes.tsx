import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { CSSProperties } from "react";
import type { Emphasis } from "../map/nodes";
import { summaryProps } from "../notes/stale";
import { hue } from "../tone";
import type { INode } from "./graph";

export type InsideNode = Node<{
  n: INode;
  emphasis: Emphasis;
  // The package the view is inside, for tone and short names.
  home: string;
  summary?: string;
  // The note was written for older code.
  stale?: boolean;
  lang?: string;
}>;

function Ports() {
  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        className="port"
        isConnectable={false}
      />
      <Handle
        type="source"
        position={Position.Right}
        className="port"
        isConnectable={false}
      />
    </>
  );
}

export function FuncBox({
  data: { n, emphasis, home, summary, stale, lang },
}: NodeProps<InsideNode>) {
  const exported = /^\p{Lu}/u.test(n.label);
  return (
    <div
      className={`ibox func ${emphasis}${exported ? " exported" : ""}`}
      style={{ "--tone": hue(home) } as CSSProperties}
    >
      <Ports />
      <div className="top">
        <span className="name" title={n.fn?.name}>
          {n.label}
        </span>
        {n.folded !== undefined && (
          <span
            className="folded"
            title={`${n.folded} closure${n.folded === 1 ? "" : "s"} folded in`}
          >
            +{n.folded}ƒ
          </span>
        )}
      </div>
      {summary && (
        <div lang={lang} {...summaryProps(summary, stale)}>
          {summary}
        </div>
      )}
    </div>
  );
}

export function TypeBox({ data: { n, home } }: NodeProps<InsideNode>) {
  return (
    <div className="ibox type" style={{ "--tone": hue(home) } as CSSProperties}>
      <Ports />
      <div className="header">
        <span className="kw">type</span> {n.label}
      </div>
    </div>
  );
}

export function PackagePort({
  data: { n, emphasis, home },
}: NodeProps<InsideNode>) {
  const label = shortPath(home, n.pkg ?? n.label);
  return (
    <div
      className={`ibox port-pkg ${n.kind} ${emphasis}`}
      style={{ "--tone": hue(n.pkg ?? "") } as CSSProperties}
      title={`${n.pkg}\nClick to look inside`}
    >
      <Ports />
      {n.kind === "out" && <span className="arrow">→</span>}
      <span className="name">{label}</span>
      {n.kind === "in" && <span className="arrow">→</span>}
    </div>
  );
}

// shortPath drops the directories that path shares with home, so sibling
// packages read as "internal/config" rather than the whole import path.
export function shortPath(home: string, path: string): string {
  const a = home.split("/");
  const b = path.split("/");
  let i = 0;
  while (i < a.length - 1 && i < b.length - 1 && a[i] === b[i]) i++;
  return b.slice(i).join("/");
}

export const insideNodeTypes = {
  func: FuncBox,
  type: TypeBox,
  in: PackagePort,
  out: PackagePort,
};
