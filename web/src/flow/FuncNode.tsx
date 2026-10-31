import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { CSSProperties } from "react";
import { summaryProps } from "../notes/stale";
import { hue } from "../tone";
import type { FlowNode } from "./tree";

export type FuncNodeType = Node<{
  n: FlowNode;
  selected: boolean;
  onPath: boolean;
  onToggle: (n: FlowNode) => void;
  // The note's summary, in the language lang.
  summary?: string;
  // The note was written for older code.
  stale?: boolean;
  lang?: string;
}>;

export function FuncNode({
  data: { n, selected, onPath, onToggle, summary, stale, lang },
}: NodeProps<FuncNodeType>) {
  const { fn, via } = n;
  const style = { "--tone": hue(fn.pkg) } as CSSProperties;
  const cls = [
    "fnode",
    `kind-${fn.kind}`,
    selected && "selected",
    onPath && "on-path",
    via?.maybe && "maybe",
  ];
  return (
    <div className={cls.filter(Boolean).join(" ")} style={style}>
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
      <div className="top">
        {via && via.mode !== "call" && (
          <span className={`tag mode-${via.mode}`}>{via.mode}</span>
        )}
        <span className="name" title={fn.name}>
          {fn.name}
        </span>
        {via && via.lines.length > 1 && (
          <span className="times">×{via.lines.length}</span>
        )}
      </div>
      <div className="sub">
        <span className="pkg">{fn.kind === "own" ? fn.pkgName : fn.pkg}</span>
        {via?.dispatch === "interface" && (
          <span className="tag dispatch">{via.maybe ? "iface?" : "iface"}</span>
        )}
        {via?.through ? (
          <span className="tag dispatch" title={`handed to ${via.through}`}>
            via {via.through.slice(via.through.indexOf(".") + 1)}
          </span>
        ) : (
          via?.dispatch === "dynamic" && (
            <span className="tag dispatch">func value</span>
          )
        )}
        {n.recursive && <span className="tag">↺ recursive</span>}
      </div>
      {summary && (
        <div lang={lang} {...summaryProps(summary, stale)}>
          {summary}
        </div>
      )}
      {((n.hidden ?? 0) > 0 || n.expanded) && (
        <button
          className={n.expanded ? "more open" : "more"}
          title={n.expanded ? "Close the calls" : "Open the calls"}
          onClick={(e) => {
            e.stopPropagation();
            onToggle(n);
          }}
        >
          {n.expanded ? "−" : `+${n.hidden}`}
        </button>
      )}
    </div>
  );
}
