import { EditorSelection } from "@codemirror/state"
import type { EditorState } from "@codemirror/state"
import type { SyntaxNode } from "@lezer/common"
import { COLOR_CLOSE_TAG, colorOfOpenTag, colorOpenTag } from "../colors.ts"
import type { MdColor } from "../options.ts"
import { formatSpec, fullTree, lineSegments, splitNode, strictWordAt } from "./util.ts"
import type { SpecBuilder } from "./util.ts"

export interface Recolor { from: number; to: number; insert: string; selFrom: number; selTo: number }

// Rewrites a..b plus every color span it overlaps as flat, balanced runs. selFrom/selTo are offsets in insert.
export function recolorLine(state: EditorState, a: number, b: number, color: MdColor | null): Recolor | null {
  const tree = fullTree(state)
  for (;;) {
    const hit: SyntaxNode[] = []
    tree.iterate({ from: a, to: b, enter: (n) => { if (n.name === "ColorText" && n.from < b && n.to > a) hit.push(n.node) } })
    if (hit.some((n) => state.sliceDoc(n.from, n.to).includes("\n"))) return null
    const from = Math.min(a, ...hit.map((n) => n.from)), to = Math.max(b, ...hit.map((n) => n.to))

    const spans: { from: number; to: number; tag: string; marks: SyntaxNode[] }[] = []
    tree.iterate({
      from,
      to,
      enter: (n) => {
        if (n.name !== "ColorText" || n.from < from || n.to > to) return
        const marks = n.node.getChildren("ColorMark")
        if (marks.length) spans.push({ from: n.from, to: n.to, tag: state.sliceDoc(marks[0].from, marks[0].to), marks })
      },
    })

    const text = state.sliceDoc(from, to)
    const chars: { pos: number; tag: string | null }[] = []
    for (let pos = from; pos < to; pos++) {
      if (spans.some((s) => s.marks.some((m) => m.from <= pos && pos < m.to))) continue
      let tag: string | null = null, inner = -1
      for (const s of spans) if (s.from <= pos && pos < s.to && s.from > inner) { inner = s.from; tag = s.tag }
      chars.push({ pos, tag })
    }
    const sel = chars.filter((c) => c.pos >= a && c.pos < b)
    if (!sel.length) return null
    const same = color !== null && sel.every((c) => c.tag !== null && colorOfOpenTag(c.tag) === color)
    const target = color === null || same ? null : colorOpenTag(color)
    for (const c of sel) c.tag = target

    // A span may not split a bold, link or other inline node: recolor the whole node instead
    let split: SyntaxNode | null = null
    for (let i = 0; i < chars.length && !split;) {
      let j = i
      while (j < chars.length && chars[j].tag === chars[i].tag) j++
      if (chars[i].tag) split = splitNode(state, tree, chars[i].pos, chars[j - 1].pos + 1, { skip: "ColorText" })
      i = j
    }
    if (split) {
      if (split.from >= a && split.to <= b) return null
      a = Math.min(a, split.from)
      b = Math.max(b, split.to)
      continue
    }

    let insert = "", selFrom = 0, selTo = 0
    for (let i = 0; i < chars.length;) {
      const tag = chars[i].tag
      if (tag) insert += tag
      for (; i < chars.length && chars[i].tag === tag; i++) {
        if (chars[i] === sel[0]) selFrom = insert.length
        insert += text[chars[i].pos - from]
        if (chars[i] === sel[sel.length - 1]) selTo = insert.length
      }
      if (tag) insert += COLOR_CLOSE_TAG
    }
    return { from, to, insert, selFrom, selTo }
  }
}

export function setColorSpec(color: MdColor | null): SpecBuilder {
  return (state) => {
    const seen = new Set<string>()
    const res = state.changeByRange((range) => {
      const w = range.empty ? strictWordAt(state, range.from) : range
      // Several cursors in one word color it once
      if (!w || (range.empty && seen.has(`${w.from}:${w.to}`))) return { range }
      seen.add(`${w.from}:${w.to}`)
      const edits = lineSegments(state, w.from, w.to)
        .map((s) => recolorLine(state, s.from, s.to, color))
        .filter((r): r is Recolor => !!r && r.insert !== state.sliceDoc(r.from, r.to))
      if (!edits.length) return { range }
      let delta = 0, selFrom = 0, selTo = 0
      edits.forEach((r, i) => {
        if (i === 0) selFrom = r.from + delta + r.selFrom
        selTo = r.from + delta + r.selTo
        delta += r.insert.length - (r.to - r.from)
      })
      return { changes: edits.map(({ from, to, insert }) => ({ from, to, insert })), range: EditorSelection.range(selFrom, selTo) }
    })
    return res.changes.empty ? null : formatSpec(res)
  }
}
