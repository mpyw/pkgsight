import type { Element } from "hast";
import type { Root } from "mdast";
import { createContext, useContext } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema, type Options } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { visit } from "unist-util-visit";
import { highlight } from "../flow/highlight";
import { AlertTitle, alertKinds, type AlertKind } from "./alerts";

// AssetContext turns a path from the module root into the URL that serves
// the file, so a note can show an image of the repository.
export const AssetContext = createContext<(path: string) => string>(
  (path) => path,
);

// Markdown renders a note as GitHub does: GitHub Flavored Markdown with
// HTML and alerts. The HTML is sanitized, so a note cannot run scripts.
export function Markdown({ text }: { text: string }) {
  const asset = useContext(AssetContext);
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkAlerts]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, schema]]}
        components={components(asset)}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

const marker = /^\[!(\w+)\][ \t]*(\n|$)/;

// remarkAlerts marks a blockquote that starts with [!NOTE] and the like as
// a GitHub alert, and drops the marker.
function remarkAlerts() {
  return (tree: Root) => {
    visit(tree, "blockquote", (node) => {
      const first = node.children[0];
      if (first?.type !== "paragraph") return;
      const text = first.children[0];
      if (text?.type !== "text") return;
      const m = marker.exec(text.value);
      const kind = m?.[1].toLowerCase() as AlertKind | undefined;
      if (!m || !kind || !alertKinds.includes(kind)) return;
      text.value = text.value.slice(m[0].length);
      if (text.value === "") first.children.shift();
      if (first.children[0]?.type === "break") first.children.shift();
      if (first.children.length === 0) node.children.shift();
      node.data = { ...node.data, hProperties: { dataAlert: kind } };
    });
  };
}

const schema: Options = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    blockquote: [...(defaultSchema.attributes?.blockquote ?? []), "dataAlert"],
  },
};

// isRelative tells a path in the repository from a URL.
const isRelative = (src: string) => !/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(src);

function components(asset: (path: string) => string): Components {
  return {
    blockquote({ node, children }) {
      const kind = (node as Element | undefined)?.properties?.dataAlert as
        AlertKind | undefined;
      if (!kind) return <blockquote>{children}</blockquote>;
      return (
        <div className={`alert alert-${kind}`}>
          <AlertTitle kind={kind} />
          {children}
        </div>
      );
    },
    img({ src, alt, title, width, height }) {
      const url =
        typeof src === "string" && isRelative(src)
          ? asset(src.replace(/^\.\//, ""))
          : src;
      return (
        <img
          src={url}
          alt={alt}
          title={title}
          width={width}
          height={height}
          loading="lazy"
        />
      );
    },
    a({ href, children }) {
      return (
        <a href={href} target="_blank" rel="noreferrer">
          {children}
        </a>
      );
    },
    code({ className, children }) {
      if (className !== "language-go")
        return <code className={className}>{children}</code>;
      const lines = String(children).replace(/\n$/, "").split("\n");
      return (
        <code className={className}>
          {highlight(lines).map((line, i) => (
            <span key={i}>
              {line.map((t, j) => (
                <span key={j} className={`tk-${t.kind}`}>
                  {t.text}
                </span>
              ))}
              {i < lines.length - 1 && "\n"}
            </span>
          ))}
        </code>
      );
    },
  };
}
