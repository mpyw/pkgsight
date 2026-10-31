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
  // Opens or closes a file node.
  onToggle?: (file: string) => void;
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
        <Hub n={n} />
      </div>
      {summary && (
        <div lang={lang} {...summaryProps(summary, stale)}>
          {summary}
        </div>
      )}
      <Stubs n={n} />
    </div>
  );
}

// Hub counts the callers of a hub, which draw tags instead of lines to it.
function Hub({ n }: { n: INode }) {
  if (n.hub === undefined) return null;
  return (
    <span
      className="hub"
      title={`Called from ${n.hub} places, drawn as tags on them`}
    >
      ←{n.hub}
    </span>
  );
}

// Stubs tags the hubs a node calls, in place of the lines to them.
function Stubs({ n }: { n: INode }) {
  if (!n.stubs) return null;
  return (
    <div className="stubs">
      {n.stubs.map((s) => (
        <span
          key={s.id}
          className={s.from ? "stub from" : "stub"}
          title={s.from ? `Called from ${s.id.slice(3)}` : `Calls ${s.label}`}
        >
          {s.from ? `${s.label} →` : `→ ${s.label}`}
        </span>
      ))}
    </div>
  );
}

// FileBox is a source file: closed, one box for its functions, or open,
// a box that holds them.
export function FileBox({
  data: { n, emphasis, home, onToggle },
}: NodeProps<InsideNode>) {
  const style = { "--tone": hue(home) } as CSSProperties;
  if (n.open)
    return (
      <div className="ibox file open" style={style}>
        <Ports />
        <button
          className="header"
          title="Close the file"
          onClick={(e) => {
            e.stopPropagation();
            onToggle?.(n.file ?? "");
          }}
        >
          <span className="chevron">▾</span> {n.label}
        </button>
      </div>
    );
  return (
    <div
      className={`ibox file closed ${emphasis}`}
      style={style}
      title="Click to open the file"
    >
      <Ports />
      <div className="top">
        <span className="chevron">▸</span>
        <span className="name">{n.label}</span>
        <span className="count">{n.count}</span>
        <Hub n={n} />
      </div>
      <Stubs n={n} />
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
      {n.hub !== undefined && (
        <span
          className="hub"
          title={`Calls into ${n.hub} boxes, tagged on them`}
        >
          {n.hub}
        </span>
      )}
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
  file: FileBox,
  in: PackagePort,
  out: PackagePort,
};
