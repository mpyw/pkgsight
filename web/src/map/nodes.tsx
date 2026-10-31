import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { CSSProperties } from "react";
import { useNotesBook } from "../notes/useNotes";
import type { VNode } from "./tree";

export type Emphasis = "selected" | "linked" | "dim" | "plain";

export type MapNode = Node<{
  v: VNode;
  emphasis: Emphasis;
  onToggle: (id: string) => void;
}>;

const tone = (v: VNode) => ({ "--tone": v.tone }) as CSSProperties;

function Ports() {
  return (
    <>
      <Handle
        type="target"
        position={Position.Top}
        className="port"
        isConnectable={false}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="port"
        isConnectable={false}
      />
    </>
  );
}

export function PackageNode({ data: { v, emphasis } }: NodeProps<MapNode>) {
  const notes = useNotesBook();
  const summary = v.pkg && notes?.packages[v.pkg.path]?.summary;
  return (
    <div
      className={`node package kind-${v.kind} ${emphasis}${v.self ? " self" : ""}${summary ? " noted" : ""}`}
      style={tone(v)}
    >
      <Ports />
      <div className="label">
        <span className="name">{v.label}</span>
        {summary && (
          <span className="summary" lang={notes?.lang} title={summary}>
            {summary}
          </span>
        )}
      </div>
      {v.pkg?.error && (
        <span className="badge error" title={v.pkg.error}>
          !
        </span>
      )}
    </div>
  );
}

export function GroupNode({ data: { v, emphasis } }: NodeProps<MapNode>) {
  return (
    <div
      className={`node group kind-${v.kind} ${emphasis}`}
      style={tone(v)}
      title="Click to expand"
    >
      <Ports />
      <span className="name">{v.label}/</span>
      <span className="count">{v.size} packages</span>
    </div>
  );
}

export function ContainerNode({
  id,
  data: { v, emphasis, onToggle },
}: NodeProps<MapNode>) {
  return (
    <div
      className={`node container kind-${v.kind} ${emphasis}`}
      style={tone(v)}
    >
      <Ports />
      <button
        className="header nodrag"
        onClick={() => onToggle(id)}
        title="Collapse"
      >
        <span className="chevron">▾</span>
        <span className="name">{v.label}/</span>
        <span className="count">{v.size}</span>
      </button>
    </div>
  );
}

export const nodeTypes = {
  package: PackageNode,
  group: GroupNode,
  container: ContainerNode,
};
