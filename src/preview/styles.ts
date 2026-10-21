import { syntaxTree } from "@codemirror/language"
import { EditorState } from "@codemirror/state"
import type { Extension, Range } from "@codemirror/state"
import { Decoration, ViewPlugin } from "@codemirror/view"
import type { DecorationSet, EditorView, ViewUpdate } from "@codemirror/view"
import type { SyntaxNode, SyntaxNodeRef } from "@lezer/common"
import { colorOfOpenTag } from "../colors.ts"
import { mdConfig } from "../options.ts"
import { modKeyLabel } from "../phrases.ts"
import { calloutOf } from "./callouts.ts"
import { CodeHeaderWidget } from "./widgets.ts"

export type Span = { from: number; to: number }

// Visits each node once across all ranges; fresh is false on a revisit from a later range
export function walk(
  state: EditorState,
  ranges: readonly Span[],
  visit: (n: SyntaxNodeRef, range: Span, fresh: boolean) => false | void,
): void {
  const tree = syntaxTree(state)
  const seen = new Set<string>()
  for (const range of ranges) {
    tree.iterate({
      from: range.from,
      to: range.to,
      enter: (n) => {
        const key = `${n.from}:${n.name}`
        const fresh = !seen.has(key)
        seen.add(key)
        return visit(n, range, fresh)
      },
    })
  }
}

export function baseChanged(u: ViewUpdate): boolean {
  return u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state) ||
    u.startState.facet(EditorState.phrases) !== u.state.facet(EditorState.phrases)
}

const MARKS = new Map([
  ["StrongEmphasis", "md-strong"], ["Emphasis", "md-em"], ["Strikethrough", "md-strike"],
  ["Underline", "md-underline"], ["Superscript", "md-sup"], ["InlineCode", "md-code-inline"],
])

const SYNTAX = new Set([
  "HeaderMark", "EmphasisMark", "StrikethroughMark", "UnderlineMark", "SuperscriptMark",
  "ColorMark", "QuoteMark", "CodeMark", "CodeInfo",
])

const cache = new Map<string, Decoration>()
function cached(key: string, make: () => Decoration): Decoration {
  let deco = cache.get(key)
  if (!deco) cache.set(key, (deco = make()))
  return deco
}

export function buildStyles(state: EditorState, ranges: readonly Span[]): DecorationSet {
  const { doc } = state
  const out: Range<Decoration>[] = []
  const lineSeen = new Set<string>()
  let linkDeco: Decoration | undefined

  const mark = (from: number, to: number, deco: Decoration) => {
    if (from < to) out.push(deco.range(from, to))
  }
  const cls = (from: number, to: number, c: string) => mark(from, to, cached(`m:${c}`, () => Decoration.mark({ class: c })))
  const syntax = (n: Span) => cls(n.from, n.to, "md-syntax")
  const link = (from: number, to: number) => mark(from, to, (linkDeco ??= Decoration.mark({
    class: "md-link",
    attributes: { title: state.phrase("$1+click to open link", modKeyLabel(state)) },
  })))

  const line = (pos: number, c: string) => {
    const key = `${pos}:${c}`
    if (lineSeen.has(key)) return
    lineSeen.add(key)
    out.push(cached(`l:${c}`, () => Decoration.line({ class: c })).range(pos))
  }
  // Only the node's lines inside the visible range
  const lines = (node: Span, range: Span, c: string, first?: string, last?: string) => {
    const end = Math.min(node.to, range.to)
    const firstNo = doc.lineAt(node.from).number
    const lastNo = doc.lineAt(node.to).number
    for (let pos = doc.lineAt(Math.max(node.from, range.from)).from; pos <= end;) {
      const l = doc.lineAt(pos)
      line(l.from, c)
      if (first && l.number === firstNo) line(l.from, first)
      if (last && l.number === lastNo) line(l.from, last)
      pos = l.to + 1
    }
  }

  const fence = (node: SyntaxNode) => {
    const info = node.getChild("CodeInfo")
    const lang = info ? state.sliceDoc(info.from, info.to).trim().split(/\s/, 1)[0] : ""
    const widget = new CodeHeaderWidget(lang, state.phrase("Copy code"), state.facet(mdConfig).icons.copy)
    out.push(Decoration.widget({ widget, side: 1 }).range(doc.lineAt(node.from).to))
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.name === "CodeMark" || c.name === "CodeInfo" || c.name === "QuoteMark") syntax(c)
    }
  }

  const color = (node: SyntaxNode) => {
    const open = node.firstChild
    const c = open && colorOfOpenTag(state.sliceDoc(open.from, open.to))
    if (!open || !c) return
    const last = node.lastChild
    const close = last && last.name === "ColorMark" && last.from !== open.from ? last : null
    cls(open.to, close ? close.from : node.to, `md-color-${c}`)
  }

  const linkNode = (node: SyntaxNode) => {
    const url = node.getChild("URL")
    if (!url) return
    const marks = node.getChildren("LinkMark")
    if (marks.length >= 2) link(marks[0].to, marks[1].from)
    for (const m of marks) syntax(m)
    syntax(url)
  }

  const task = (node: SyntaxNode) => {
    const m = node.getChild("TaskMarker")
    if (m && /x/i.test(state.sliceDoc(m.from, m.to))) cls(m.to, node.to, "md-task-done")
  }

  walk(state, ranges, (n, range, fresh) => {
    const heading = /^ATXHeading([1-6])$/.exec(n.name)
    if (heading) return lines(n, range, `md-h${heading[1]}`)
    switch (n.name) {
      case "Blockquote": {
        const c = calloutOf(state, n.node)
        return c
          ? lines(n, range, `md-callout md-callout-${c.type}`, "md-callout-first", "md-callout-last")
          : lines(n, range, "md-quote", "md-quote-first", "md-quote-last")
      }
      case "CodeBlock": return lines(n, range, "md-code-line", "md-code-first", "md-code-last")
      case "HorizontalRule": return lines(n, range, "md-hr")
      case "Table": return lines(n, range, "md-table-row")
      case "FencedCode":
        lines(n, range, "md-code-line", "md-code-first", "md-code-last")
        if (fresh) fence(n.node)
        return false
      case "HTMLBlock":
      case "Image":
        return false
    }
    if (!fresh) return
    const markClass = MARKS.get(n.name)
    if (markClass) cls(n.from, n.to, markClass)
    else if (SYNTAX.has(n.name)) syntax(n)
    else if (n.name === "ColorText") color(n.node)
    else if (n.name === "Link") linkNode(n.node)
    else if (n.name === "Task") task(n.node)
    else if (n.name === "URL") {
      const parent = n.node.parent?.name
      if (parent !== "Link" && parent !== "Image") link(n.from, n.to)
    }
  })
  return Decoration.set(out, true)
}

class StylesView {
  decorations: DecorationSet

  constructor(view: EditorView) {
    this.decorations = buildStyles(view.state, view.visibleRanges)
  }

  update(u: ViewUpdate) {
    if (baseChanged(u)) this.decorations = buildStyles(u.state, u.view.visibleRanges)
  }
}

export const stylesPlugin: Extension = ViewPlugin.fromClass(StylesView, { decorations: (v) => v.decorations })
