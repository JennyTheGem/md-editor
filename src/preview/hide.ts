import type { EditorState, Extension, Range } from "@codemirror/state"
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view"
import type { DecorationSet, ViewUpdate } from "@codemirror/view"
import type { SyntaxNode } from "@lezer/common"
import { isLineRevealed, isRangeRevealed, revealField } from "./reveal.ts"
import { baseChanged, walk } from "./styles.ts"
import type { Span } from "./styles.ts"
import { BulletWidget, CheckboxWidget } from "./widgets.ts"

const HIDDEN = Decoration.replace({})
const BULLET = Decoration.replace({ widget: new BulletWidget() })
const HR_ON = Decoration.line({ class: "md-hr-on" })
const MARKS = new Set(["EmphasisMark", "StrikethroughMark", "UnderlineMark", "SuperscriptMark", "ColorMark"])

const spaces = (s: string, re: RegExp) => re.exec(s)?.[0].length ?? 0

export function buildHidden(state: EditorState, ranges: readonly Span[]): { decorations: DecorationSet; atomic: DecorationSet } {
  const { doc } = state
  const replaces: Range<Decoration>[] = []
  const lines: Range<Decoration>[] = []
  const heads = state.selection.ranges.map((r) => r.head)
  const boxes: Decoration[] = []
  const box = (checked: boolean) =>
    (boxes[+checked] ??= Decoration.replace({ widget: new CheckboxWidget(checked, state.phrase("Toggle task")) }))
  const shown = (pos: number) => isLineRevealed(state, pos)

  // A plugin replace may not cross a line break
  const hide = (from: number, to: number, deco = HIDDEN) => {
    if (from < to && doc.lineAt(from).to >= to) replaces.push(deco.range(from, to))
  }
  const hideMark = (from: number, to: number) => {
    if (!shown(from)) hide(from, to)
  }
  const quote = (m: Span) => {
    if (!shown(m.from)) hide(m.from, m.to + (doc.sliceString(m.to, m.to + 1) === " " ? 1 : 0))
  }

  const headerMark = (m: SyntaxNode) => {
    if (shown(m.from)) return
    const line = doc.lineAt(m.from)
    if (m.parent?.firstChild?.from === m.from) hide(m.from, m.to + spaces(doc.sliceString(m.to, line.to), /^[ \t]*/))
    else hide(m.from - spaces(doc.sliceString(line.from, m.from), /[ \t]*$/), m.to)
  }

  const link = (node: SyntaxNode) => {
    const marks = node.getChildren("LinkMark")
    // An empty label would make the whole link invisible
    if (!node.getChild("URL") || marks.length < 2 || marks[0].to === marks[1].from) return
    hideMark(marks[0].from, marks[0].to)
    hideMark(marks[1].from, node.to)
  }

  const listMark = (m: SyntaxNode) => {
    if (shown(m.from)) return
    const item = m.parent
    const marker = item?.getChild("Task")?.getChild("TaskMarker")
    if (marker) hide(m.from, marker.from)
    else if (item?.parent?.name === "BulletList") hide(m.from, m.to, BULLET)
  }

  const fence = (node: SyntaxNode) => {
    if (!isRangeRevealed(state, node.from, node.to)) {
      const open = node.firstChild
      if (open?.name === "CodeMark") hide(open.from, doc.lineAt(node.from).to)
      const close = node.lastChild
      if (close?.name === "CodeMark" && close.from > doc.lineAt(node.from).to) hide(close.from, close.to)
    }
    node.getChildren("QuoteMark").forEach(quote)
  }

  walk(state, ranges, (n, _range, fresh) => {
    switch (n.name) {
      case "FencedCode":
        if (fresh) fence(n.node)
        return false
      case "CodeBlock":
        if (fresh) n.node.getChildren("QuoteMark").forEach(quote)
        return false
      case "InlineCode":
        if (fresh) for (const m of n.node.getChildren("CodeMark")) hideMark(m.from, m.to)
        return false
      case "Table":
        return n.node.parent?.type.isTop ? false : undefined
      case "Timestamp":
      case "Image":
      case "HTMLBlock":
        return false
    }
    if (!fresh) return
    if (MARKS.has(n.name)) hideMark(n.from, n.to)
    else if (n.name === "HeaderMark") headerMark(n.node)
    else if (n.name === "QuoteMark") quote(n)
    else if (n.name === "Escape") hideMark(n.from, n.from + 1)
    else if (n.name === "Link") link(n.node)
    else if (n.name === "ListMark") listMark(n.node)
    else if (n.name === "TaskMarker") {
      if (!heads.some((h) => h > n.from && h < n.to)) hide(n.from, n.to, box(/x/i.test(doc.sliceString(n.from, n.to))))
    } else if (n.name === "HorizontalRule" && !shown(n.from)) {
      hide(n.from, n.to)
      lines.push(HR_ON.range(doc.lineAt(n.from).from))
    }
  })

  // Overlapping replaces would throw, keep the first
  replaces.sort((a, b) => a.from - b.from || a.to - b.to)
  const kept: Range<Decoration>[] = []
  let end = -1
  for (const r of replaces) {
    if (r.from < end) continue
    kept.push(r)
    end = r.to
  }
  const atomic = kept.filter((r) => r.value.spec.widget instanceof CheckboxWidget)
  return { decorations: Decoration.set([...lines, ...kept], true), atomic: Decoration.set(atomic, true) }
}

class HideView {
  decorations: DecorationSet
  atomic: DecorationSet

  constructor(view: EditorView) {
    const built = buildHidden(view.state, view.visibleRanges)
    this.decorations = built.decorations
    this.atomic = built.atomic
  }

  update(u: ViewUpdate) {
    if (!baseChanged(u) && !u.selectionSet && u.startState.field(revealField, false) === u.state.field(revealField, false)) return
    const built = buildHidden(u.state, u.view.visibleRanges)
    this.decorations = built.decorations
    this.atomic = built.atomic
  }
}

export const hidePlugin: Extension = ViewPlugin.fromClass(HideView, {
  decorations: (v) => v.decorations,
  provide: (p) => EditorView.atomicRanges.of((view) => view.plugin(p)?.atomic ?? Decoration.none),
})
