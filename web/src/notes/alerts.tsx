import type { ReactNode } from "react";

// The alerts GitHub draws in Markdown, which notes reuse.
export type AlertKind = "note" | "tip" | "important" | "warning" | "caution";

export const alertKinds: AlertKind[] = [
  "note",
  "tip",
  "important",
  "warning",
  "caution",
];

const labels: Record<AlertKind, string> = {
  note: "Note",
  tip: "Tip",
  important: "Important",
  warning: "Warning",
  caution: "Caution",
};

// Shapes after GitHub's: info, light bulb, speech bubble, triangle, octagon.
const icons: Record<AlertKind, ReactNode> = {
  note: (
    <>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 7.25v4" />
      <circle cx="8" cy="4.9" r="0.4" fill="currentColor" />
    </>
  ),
  tip: (
    <>
      <path d="M8 1.75a4.25 4.25 0 0 0-2.45 7.73c.4.3.7.75.7 1.27v.5h3.5v-.5c0-.52.3-.98.7-1.27A4.25 4.25 0 0 0 8 1.75z" />
      <path d="M6.25 13.75h3.5" />
    </>
  ),
  important: (
    <>
      <path d="M2.25 2.75h11.5v8H8.5l-3 2.75v-2.75H2.25z" />
      <path d="M8 4.75v3" />
      <circle cx="8" cy="9.25" r="0.4" fill="currentColor" />
    </>
  ),
  warning: (
    <>
      <path d="M8 1.9 14.5 13.5h-13z" />
      <path d="M8 6v3.75" />
      <circle cx="8" cy="11.6" r="0.4" fill="currentColor" />
    </>
  ),
  caution: (
    <>
      <path d="M5.25 1.75h5.5l3.5 3.5v5.5l-3.5 3.5h-5.5l-3.5-3.5v-5.5z" />
      <path d="M8 4.75v4" />
      <circle cx="8" cy="10.9" r="0.4" fill="currentColor" />
    </>
  ),
};

export function AlertTitle({ kind }: { kind: AlertKind }) {
  return (
    <span className="alert-title">
      <svg
        viewBox="0 0 16 16"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {icons[kind]}
      </svg>
      {labels[kind]}
    </span>
  );
}
