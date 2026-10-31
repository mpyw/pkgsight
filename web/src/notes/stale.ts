// summaryProps marks a summary whose note was written for older code.
export function summaryProps(summary: string, stale?: boolean) {
  return stale
    ? {
        className: "summary stale",
        title: `${summary}\n(written for an older version of this code)`,
      }
    : { className: "summary", title: summary };
}
