import type { AlertKind } from "../notes/alerts";

// Mirrors internal/model in the Go code.

export type Kind = "own" | "std" | "ext";

export interface Package {
  path: string;
  name: string;
  kind: Kind;
  module?: string;
  dir: string;
  doc?: string;
  files: string[];
  imports: string[];
  error?: string;
}

export interface Module {
  path: string;
  version?: string;
  main: boolean;
}

export interface Graph {
  root: string;
  modules: Module[];
  packages: Package[];
}

export interface Func {
  id: string;
  // Relative to the package, like "Run", "(*Server).Start" or "Run$1".
  name: string;
  pkg: string;
  pkgName: string;
  kind: Kind;
  file?: string;
  line?: number;
  endLine?: number;
  // The first line of the doc comment, when there is one.
  docLine?: number;
  doc?: string;
}

export type Mode = "call" | "go" | "defer";
export type Dispatch = "static" | "interface" | "dynamic";

export interface Call {
  to: Func;
  mode: Mode;
  dispatch: Dispatch;
  lines: number[];
  maybe?: boolean;
  // The library function the callee was handed to, which makes the call.
  through?: string;
}

export interface FuncDetail extends Func {
  calls: Call[];
  callers: Func[];
}

export interface Entry extends Func {
  // Why a reader may start here: a program, a function a library calls, a
  // method a library's interface requires, or an exported function that
  // nothing in the module calls.
  reason: "main" | "handed" | "interface" | "uncalled";
}

export interface CallStatus {
  state: "pending" | "ready" | "error";
  error?: string;
  tookMs?: number;
  // Packages left out of the call graph because they do not type-check.
  skipped?: Skipped[];
}

export interface Skipped {
  path: string;
  error: string;
}

// Notes that an assistant wrote over MCP, in one language.
export interface Note {
  // One sentence for the map and the call flow.
  summary?: string;
  // The doc comment in the language of the notes.
  doc?: string;
  // A longer explanation for the side panel.
  body?: string;
  // The code changed since the note was written. Unset while the call
  // graph is building.
  stale?: boolean;
}

// A note shown above a line of a function, without a line number of its own.
export interface LineNote {
  line: number;
  text: string;
  // Drawn like a GitHub alert, when set.
  kind?: AlertKind;
  // The line changed since the note was written.
  stale?: boolean;
}

export interface FuncNotes extends Note {
  lines?: LineNote[];
}

export interface Notes {
  // Every language that has notes.
  langs: string[];
  lang: string;
  packages: Record<string, Note>;
  funcs: Record<string, FuncNotes>;
}
