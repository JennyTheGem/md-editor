import { EditorSelection } from "@codemirror/state"
import type { EditorState, Line, StateCommand, TransactionSpec } from "@codemirror/state"
import { isolateHistory } from "@codemirror/commands"
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language"
import type { SyntaxNode, Tree } from "@lezer/common"
import { isCodeContext } from "../context.ts"

export type SpecBuilder = (state: EditorState) => TransactionSpec | null

export function toCommand(build: SpecBuilder): StateCommand {
  return ({ state, dispatch }) => {
    const s = build(state)
    if (!s) return false
    dispatch(state.update(s))
    return true
  }
}

export const CONTAINER_RE = /^[ \t]*(?:>[ \t]?)*[ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)?/
const HEADING_RE = /^#{1,6}[ \t]+/

// Isolated after, so typing right after a format is its own undo step
export function formatSpec(spec: TransactionSpec): TransactionSpec {
  return { ...spec, userEvent: "input.format", annotations: isolateHistory.of("after"), scrollIntoView: true }
}

export function fullTree(state: EditorState): Tree {
  return ensureSyntaxTree(state, state.doc.length, 100) ?? syntaxTree(state)
}

export function contentStart(line: Line): number {
  const p = CONTAINER_RE.exec(line.text)![0].length
  return line.from + p + (HEADING_RE.exec(line.text.slice(p))?.[0].length ?? 0)
}

export function ancestor(node: SyntaxNode | null, names: readonly string[]): SyntaxNode | null {
  for (let n = node; n; n = n.parent) if (names.includes(n.name)) return n
  return null
}

const CODE_BLOCKS = ["FencedCode", "CodeBlock"]

// Also checks the line end: indented code and quoted fences start after line.from
export function inCodeLine(state: EditorState, line: Line): boolean {
  const tree = fullTree(state)
  return !!(ancestor(tree.resolveInner(line.from, 1), CODE_BLOCKS) || ancestor(tree.resolveInner(line.to, -1), CODE_BLOCKS))
}

export function inCode(state: EditorState, pos: number): boolean {
  return isCodeContext(state, pos) || inCodeLine(state, state.doc.lineAt(pos))
}

const WORD = /[\p{L}\p{N}_]/u

export function strictWordAt(state: EditorState, pos: number): { from: number; to: number } | null {
  const line = state.doc.lineAt(pos)
  const t = line.text
  let a = pos - line.from, b = a
  if (!WORD.test(t.charAt(a - 1)) || !WORD.test(t.charAt(b))) return null
  while (a > 0 && WORD.test(t.charAt(a - 1))) a--
  while (b < t.length && WORD.test(t.charAt(b))) b++
  return { from: line.from + a, to: line.from + b }
}

// A non-empty range ending at a line start does not touch that line
export function rangeLines(state: EditorState, from: number, to: number): Line[] {
  const doc = state.doc
  const first = doc.lineAt(from).number
  const last = doc.lineAt(to > from && doc.lineAt(to).from === to ? to - 1 : to).number
  const out: Line[] = []
  for (let n = first; n <= last; n++) out.push(doc.line(n))
  return out
}

export function touchedLines(state: EditorState): Line[] {
  const out: Line[] = []
  for (const r of state.selection.ranges) {
    for (const line of rangeLines(state, r.from, r.to)) {
      if (!out.length || out[out.length - 1].number < line.number) out.push(line)
    }
  }
  return out
}

export function enclosing(state: EditorState, from: number, to: number, name: string): SyntaxNode | null {
  const tree = fullTree(state)
  for (const start of [tree.resolveInner(from, 1), tree.resolveInner(from, -1), tree.resolveInner(to, -1)]) {
    for (let n: SyntaxNode | null = start; n; n = n.parent) {
      if (n.name !== name) continue
      if (from === to ? n.from < from && from < n.to : n.from <= from && to <= n.to) return n
    }
  }
  return null
}

// Checks both ends, like inCodeLine: quoted tables start after line.from
export function tableAt(state: EditorState, line: Line): SyntaxNode | null {
  const tree = fullTree(state)
  return ancestor(tree.resolveInner(line.from, 1), ["Table"]) ?? ancestor(tree.resolveInner(line.to, -1), ["Table"])
}

export const isBlank = (text: string) => text.trim() === ""

export function blockInsert(state: EditorState, text: string, selFrom: number, selTo: number): TransactionSpec {
  const doc = state.doc
  let L = doc.lineAt(state.selection.main.head)
  // Reuse a blank line right below instead of stacking a second one
  if (!isBlank(L.text) && L.number < doc.lines && isBlank(doc.line(L.number + 1).text)) L = doc.line(L.number + 1)
  const blank = isBlank(L.text)
  const from = blank ? L.from : L.to
  const before = blank ? (L.number > 1 ? doc.line(L.number - 1) : null) : L
  const prefix = (blank ? "" : "\n") + (before && !isBlank(before.text) ? "\n" : "")
  const next = L.number < doc.lines ? doc.line(L.number + 1) : null
  // A text ending in "\n" already leaves a blank line above the next one
  const suffix = next && !isBlank(next.text) && !isBlank(text.slice(text.lastIndexOf("\n") + 1)) ? "\n" : ""
  const at = from + prefix.length
  return formatSpec({
    changes: { from, to: blank ? L.to : from, insert: prefix + text + suffix },
    selection: EditorSelection.single(at + selFrom, at + selTo),
  })
}

export interface Segment { from: number; to: number }

// Trimmed pieces of from..to: one per line, one per cell in table rows; never in code
export function lineSegments(state: EditorState, from: number, to: number): Segment[] {
  const out: Segment[] = []
  const tree = fullTree(state)
  for (const line of rangeLines(state, from, to)) {
    if (inCodeLine(state, line)) continue
    const start = contentStart(line)
    const row = ancestor(tree.resolveInner(start, 1), ["TableHeader", "TableRow", "Table"])
    const pieces: readonly Segment[] = !row ? [{ from: start, to: line.to }] : row.name === "Table" ? [] : row.getChildren("TableCell")
    for (const p of pieces) {
      const a = Math.max(from, p.from), b = Math.min(to, p.to)
      if (a >= b) continue
      const text = state.sliceDoc(a, b)
      const s = a + text.length - text.trimStart().length, e = b - (text.length - text.trimEnd().length)
      if (s < e && !isCodeContext(state, s) && !isCodeContext(state, e)) out.push({ from: s, to: e })
    }
  }
  return out
}

// Nodes a marker or tag may never split, and wrappers that may hold one between their first two marks
const ATOMIC = new Set(["InlineCode", "Timestamp", "URL", "Autolink", "HTMLTag", "Escape", "Entity"])
const WRAPPERS: Readonly<Record<string, string>> = {
  StrongEmphasis: "EmphasisMark", Emphasis: "EmphasisMark", Strikethrough: "StrikethroughMark", Underline: "UnderlineMark",
  Superscript: "SuperscriptMark", ColorText: "ColorMark", Link: "LinkMark", Image: "LinkMark",
}

function splits(n: SyntaxNode, from: number, to: number): boolean {
  if (to <= n.from || from >= n.to || (from <= n.from && n.to <= to)) return false
  const mark = WRAPPERS[n.name]
  if (!mark) return ATOMIC.has(n.name)
  const m = n.getChildren(mark)
  return !(m.length >= 2 && m[0].to <= from && to <= m[1].from)
}

// First node on the line that markers at from and to would split. `merge` nodes count when they overlap or touch it.
export function splitNode(state: EditorState, tree: Tree, from: number, to: number, o: { merge?: string; skip?: string } = {}): SyntaxNode | null {
  const line = state.doc.lineAt(from)
  let hit: SyntaxNode | null = null
  tree.iterate({
    from,
    to,
    enter: (n) => {
      if (hit) return false
      if (n.from < line.from || n.to > line.to || n.name === o.skip) return
      if (n.name === o.merge ? n.from < from || n.to > to : splits(n.node, from, to)) hit = n.node
    },
  })
  return hit
}

// Widens a segment until wrapping it nests cleanly with every inline node on its line
export function alignSegment(state: EditorState, tree: Tree, seg: Segment, merge?: string): Segment {
  let { from, to } = seg
  for (let n = splitNode(state, tree, from, to, { merge }); n; n = splitNode(state, tree, from, to, { merge })) {
    from = Math.min(from, n.from)
    to = Math.max(to, n.to)
  }
  return { from, to }
}
