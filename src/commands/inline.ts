import { EditorSelection } from "@codemirror/state"
import type { ChangeSet, ChangeSpec, EditorState, SelectionRange } from "@codemirror/state"
import type { SyntaxNode, Tree } from "@lezer/common"
import { isLiteralContext } from "../context.ts"
import { alignSegment, contentStart, enclosing, formatSpec, fullTree, inCode, lineSegments, strictWordAt } from "./util.ts"
import type { Segment, SpecBuilder } from "./util.ts"

export const INLINE_FORMATS = {
  bold: { node: "StrongEmphasis", mark: "EmphasisMark", open: "**", close: "**" },
  italic: { node: "Emphasis", mark: "EmphasisMark", open: "*", close: "*" },
  strike: { node: "Strikethrough", mark: "StrikethroughMark", open: "~~", close: "~~" },
  inlineCode: { node: "InlineCode", mark: "CodeMark", open: "`", close: "`" },
  underline: { node: "Underline", mark: "UnderlineMark", open: "<u>", close: "</u>" },
  sup: { node: "Superscript", mark: "SuperscriptMark", open: "^", close: "^" },
} as const

export type InlineFormat = (typeof INLINE_FORMATS)[keyof typeof INLINE_FORMATS]

type RangeResult = { range: SelectionRange; changes?: ChangeSpec }
type Change = { from: number; to?: number; insert?: string }

function outerMarks(node: SyntaxNode, mark: string): [SyntaxNode, SyntaxNode] | null {
  const marks = node.getChildren(mark)
  return marks.length >= 2 ? [marks[0], marks[marks.length - 1]] : null
}

function unmark(node: SyntaxNode, fmt: InlineFormat): Change[] {
  const m = outerMarks(node, fmt.mark)
  return m ? [{ from: m[0].from, to: m[0].to }, { from: m[1].from, to: m[1].to }] : []
}

// Outermost format nodes inside a segment, in doc order
function formatNodes(tree: Tree, fmt: InlineFormat, seg: Segment): SyntaxNode[] {
  const out: SyntaxNode[] = []
  tree.iterate({
    from: seg.from,
    to: seg.to,
    enter: (n) => {
      if (n.name !== fmt.node || n.from < seg.from || n.to > seg.to) return
      out.push(n.node)
      return false
    },
  })
  return out
}

// Only whitespace outside the format nodes
function covered(state: EditorState, seg: Segment, found: readonly SyntaxNode[]): boolean {
  let pos = seg.from
  for (const n of found) {
    if (state.sliceDoc(pos, n.from).trim()) return false
    pos = n.to
  }
  return found.length > 0 && !state.sliceDoc(pos, seg.to).trim()
}

// Wraps each segment, merging same-format nodes inside it. Null when the parser would not read the result back.
function wrap(state: EditorState, fmt: InlineFormat, segs: readonly Segment[], found: readonly SyntaxNode[][]): ChangeSet | null {
  const changes = state.changes(segs.flatMap((s, i) => [
    { from: s.from, insert: fmt.open }, ...found[i].flatMap((n) => unmark(n, fmt)), { from: s.to, insert: fmt.close },
  ]))
  const next = state.update({ changes }).state
  return segs.every((s) => enclosing(next, changes.mapPos(s.from, 1), changes.mapPos(s.to, -1), fmt.node)) ? changes : null
}

function toggleRange(state: EditorState, fmt: InlineFormat, range: SelectionRange, seen: Set<string>): RangeResult {
  const { from, to } = range
  const node = enclosing(state, from, to, fmt.node)
  const marks = node && outerMarks(node, fmt.mark)
  if (marks) {
    const [o, c] = marks
    const changes = state.changes([{ from: o.from, to: o.to }, { from: c.from, to: c.to }])
    const shift = o.to - o.from
    return { changes, range: range.empty ? EditorSelection.cursor(changes.mapPos(from)) : EditorSelection.range(o.from, c.from - shift) }
  }

  const tree = fullTree(state)
  if (range.empty) {
    if (inCode(state, from) || isLiteralContext(state, from)) return { range }
    const w = strictWordAt(state, from)
    if (w) {
      const s = alignSegment(state, tree, w, fmt.node)
      // Several cursors in one word wrap it once
      const key = `${s.from}:${s.to}`
      if (seen.has(key)) return { range }
      seen.add(key)
      const changes = wrap(state, fmt, [s], [formatNodes(tree, fmt, s)])
      return changes ? { changes, range: EditorSelection.cursor(changes.mapPos(from)) } : { range }
    }
    // Never in front of a list, quote or heading marker
    const at = Math.max(from, contentStart(state.doc.lineAt(from)))
    // Next to the same marker char the new run would merge with it ('**a**' + '**text**')
    if (state.sliceDoc(Math.max(0, at - 1), at) === fmt.open[0] || state.sliceDoc(at, at + 1) === fmt.close[fmt.close.length - 1]) return { range }
    const text = state.phrase("text")
    const sel = at + fmt.open.length
    return { changes: { from: at, insert: fmt.open + text + fmt.close }, range: EditorSelection.range(sel, sel + text.length) }
  }

  const segs = lineSegments(state, from, to).map((s) => alignSegment(state, tree, s, fmt.node))
  if (!segs.length) return { range }
  const found = segs.map((s) => formatNodes(tree, fmt, s))
  // Already formatted everywhere: toggle off
  if (segs.every((s, i) => covered(state, s, found[i]))) {
    const changes = state.changes(found.flat().flatMap((n) => unmark(n, fmt)))
    return { changes, range: EditorSelection.range(changes.mapPos(from, 1), changes.mapPos(to, -1)) }
  }
  const changes = wrap(state, fmt, segs, found)
  if (!changes) return { range }
  return { changes, range: EditorSelection.range(changes.mapPos(segs[0].from, 1), changes.mapPos(segs[segs.length - 1].to, -1)) }
}

export function toggleInline(fmt: InlineFormat): SpecBuilder {
  return (state) => {
    const seen = new Set<string>()
    const res = state.changeByRange((range) => toggleRange(state, fmt, range, seen))
    return res.changes.empty || res.changes.apply(state.doc).eq(state.doc) ? null : formatSpec(res)
  }
}
