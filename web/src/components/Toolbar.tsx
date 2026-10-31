import type { ViewName } from "../location";

interface Props {
  title: string;
  stats: string;
  view: ViewName;
  onView: (v: ViewName) => void;
  // Languages with notes, and the one shown.
  langs: string[];
  lang?: string;
  onLang: (lang: string | undefined) => void;
}

const tabs: { view: ViewName; label: string }[] = [
  { view: "map", label: "Packages" },
  { view: "flow", label: "Call flow" },
];

export function Toolbar({
  title,
  stats,
  view,
  onView,
  langs,
  lang,
  onLang,
}: Props) {
  return (
    <header className="toolbar">
      <div className="brand">
        <span className="logo" aria-hidden>
          ◈
        </span>
        <span>pkgsight</span>
      </div>
      <div className="project">
        <div className="title">{title}</div>
        <div className="stats">{stats}</div>
      </div>
      {langs.length > 0 && (
        <label className="notes-lang" title="Notes written over MCP">
          <span>Notes</span>
          <select
            value={lang ?? ""}
            onChange={(e) => onLang(e.target.value || undefined)}
          >
            {langs.map((l) => (
              <option key={l} value={l}>
                {languageName(l)}
              </option>
            ))}
            <option value="">Off</option>
          </select>
        </label>
      )}
      <nav className="tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.view}
            role="tab"
            aria-selected={
              view === t.view || (t.view === "map" && view === "inside")
            }
            onClick={() => onView(t.view)}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </header>
  );
}

// languageName names a language tag in its own language, like 日本語 for ja.
function languageName(tag: string): string {
  try {
    return new Intl.DisplayNames([tag], { type: "language" }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}
