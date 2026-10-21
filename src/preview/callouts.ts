import type { EditorState } from "@codemirror/state"
import type { SyntaxNode } from "@lezer/common"
import type { MdPhrase } from "../phrases.ts"

export type CalloutType = "note" | "tip" | "warning" | "danger"

export const CALLOUT_LABELS: Readonly<Record<CalloutType, MdPhrase>> = { note: "Note", tip: "Tip", warning: "Warning", danger: "Danger" }

const MARKER_RE = /^\[!([\w-]+)\][+-]?[ \t]*/

// marker = "[!type]" plus trailing spaces; unknown types are notes
export interface Callout { type: CalloutType; from: number; to: number; title: boolean }

export function calloutOf(state: EditorState, quote: SyntaxNode): Callout | null {
  let p = quote.firstChild
  while (p?.name === "QuoteMark") p = p.nextSibling
  if (p?.name !== "Paragraph") return null
  const line = state.doc.lineAt(p.from)
  if (line.from > quote.from) return null
  const m = MARKER_RE.exec(state.sliceDoc(p.from, line.to))
  if (!m) return null
  const t = m[1].toLowerCase()
  const type = Object.hasOwn(CALLOUT_LABELS, t) ? (t as CalloutType) : "note"
  return { type, from: p.from, to: p.from + m[0].length, title: p.from + m[0].length < line.to }
}
