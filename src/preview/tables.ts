import { EditorState, Prec, StateField } from "@codemirror/state"
import type { Extension, Range } from "@codemirror/state"
import { Decoration, EditorView, WidgetType, keymap } from "@codemirror/view"
import type { Command, DecorationSet } from "@codemirror/view"
import { syntaxTree } from "@codemirror/language"
import type { SyntaxNode, Tree } from "@lezer/common"
import { mdConfig } from "../options.ts"
import { mdParser } from "../syntax.ts"
import { appendInline } from "./inlineDom.ts"
import type { InlineCtx } from "./inlineDom.ts"
import { isRangeRevealed, revealField } from "./reveal.ts"

type Span = { from: number; to: number }

function* topTables(tree: Tree): Generator<SyntaxNode, void> {
  for (let n = tree.topNode.firstChild; n; n = n.nextSibling) if (n.name === "Table") yield n
}

const tableRows = (table: SyntaxNode): SyntaxNode[] => [...table.getChildren("TableHeader"), ...table.getChildren("TableRow")]

export function rowCellSpans(row: SyntaxNode): Span[] {
  const delims = row.getChildren("TableDelimiter")
  if (!delims.length) return [{ from: row.from, to: row.to }]
  const first = delims[0], last = delims[delims.length - 1]
  const spans: Span[] = []
  if (first.from !== row.from) spans.push({ from: row.from, to: first.from })
  for (let i = 1; i < delims.length; i++) spans.push({ from: delims[i - 1].to, to: delims[i].from })
  if (last.to !== row.to) spans.push({ from: last.to, to: row.to })
  return spans
}

const isSpace = (ch: string) => ch === " " || ch === "\t"

function trimSpan(text: string, offset: number, { from, to }: Span): Span {
  while (from < to && isSpace(text[from - offset])) from++
  while (to > from && isSpace(text[to - 1 - offset])) to--
  return { from, to }
}

function alignments(table: SyntaxNode, src: string): string[] {
  const delim = table.getChild("TableDelimiter")
  if (!delim) return []
  const parts = src.slice(delim.from, delim.to).split("|").map((s) => s.trim())
  if (parts[0] === "") parts.shift()
  if (parts.length && parts[parts.length - 1] === "") parts.pop()
  return parts.map((p) => (/^:-+:$/.test(p) ? "center" : /^-+:$/.test(p) ? "right" : /^:-+$/.test(p) ? "left" : ""))
}

export function renderTable(source: string, ctx: InlineCtx): HTMLElement {
  const wrap = document.createElement("div")
  wrap.className = "md-table-wrap"
  const table = topTables(mdParser.parse(source)).next().value
  if (!table) {
    wrap.textContent = source
    return wrap
  }
  const rows = tableRows(table)
  const cols = rowCellSpans(rows[0]).length
  const align = alignments(table, source)
  const dom = document.createElement("table")
  dom.className = "md-table"
  const head = dom.appendChild(document.createElement("thead"))
  const body = dom.appendChild(document.createElement("tbody"))
  rows.forEach((row, r) => {
    const tr = (r ? body : head).appendChild(document.createElement("tr"))
    const spans = rowCellSpans(row)
    for (let c = 0; c < cols; c++) {
      const cell = tr.appendChild(document.createElement(r ? "td" : "th"))
      cell.dataset.row = String(r)
      cell.dataset.col = String(c)
      if (align[c]) cell.style.textAlign = align[c]
      const span = spans[c]
      if (span) {
        const t = trimSpan(source, 0, span)
        appendInline(cell, source, row, t.from, t.to, ctx)
      }
    }
  })
  wrap.append(dom)
  return wrap
}

class TableWidget extends WidgetType {
  source: string
  jump: string
  icon: string | undefined
  pills: boolean
  rows: number

  constructor(source: string, jump: string, icon: string | undefined, pills: boolean, rows: number) {
    super()
    this.source = source
    this.jump = jump
    this.icon = icon
    this.pills = pills
    this.rows = rows
  }

  eq(other: TableWidget): boolean {
    return other.source === this.source && other.jump === this.jump && other.icon === this.icon && other.pills === this.pills
  }

  get estimatedHeight(): number {
    return this.rows * 30
  }

  toDOM(): HTMLElement {
    return renderTable(this.source, { jump: this.jump, icon: this.icon, pills: this.pills })
  }

  // A press outside the cells is on the wrapper's scrollbar: leave it to the browser
  ignoreEvent(e: Event): boolean {
    return e.type === "mousedown" && !(e.target instanceof Element && e.target.closest("td, th"))
  }
}

function build(state: EditorState): DecorationSet {
  const { doc } = state
  const config = state.facet(mdConfig)
  const jump = state.phrase("Jump to $1")
  const ranges: Range<Decoration>[] = []
  for (const n of topTables(syntaxTree(state))) {
    if (isRangeRevealed(state, n.from, n.to)) continue
    const from = doc.lineAt(n.from), to = doc.lineAt(n.to)
    const widget = new TableWidget(state.sliceDoc(n.from, n.to), jump, config.icons.timestamp, config.timestamps !== null, to.number - from.number + 1)
    ranges.push(Decoration.replace({ widget, block: true }).range(from.from, to.to))
  }
  return Decoration.set(ranges)
}

export const tableField = StateField.define<DecorationSet>({
  create: build,
  update(deco, tr) {
    const s = tr.startState, n = tr.state
    if (
      tr.docChanged ||
      syntaxTree(s) !== syntaxTree(n) ||
      s.field(revealField, false) !== n.field(revealField, false) ||
      s.facet(EditorState.phrases) !== n.facet(EditorState.phrases) ||
      s.facet(mdConfig) !== n.facet(mdConfig)
    ) return build(n)
    return deco
  },
  provide: (f) => EditorView.decorations.from(f),
})

const enterTable = (dir: 1 | -1): Command => (view) => {
  const { state } = view
  const sel = state.selection.main
  if (!sel.empty) return false
  const line = state.doc.lineAt(sel.head)
  const next = line.number + dir
  if (next < 1 || next > state.doc.lines) return false
  // On a wrapped line, let the native motion reach its last visual row first
  if (view.moveToLineBoundary(sel, dir > 0).head !== (dir > 0 ? line.to : line.from)) return false
  const target = state.doc.line(next)
  let anchor = -1
  state.field(tableField).between(target.from, target.to, (from, to) => {
    if (dir > 0 ? from !== target.from : to !== target.to) return
    anchor = dir > 0 ? from : state.doc.lineAt(to).from
    return false
  })
  if (anchor < 0) return false
  view.dispatch({ selection: { anchor }, scrollIntoView: true, userEvent: "select" })
  return true
}

function focusCell(view: EditorView, wrap: HTMLElement, target: Element): boolean {
  const { state } = view
  const { doc } = state
  const pos = view.posAtDOM(wrap)
  let table: SyntaxNode | undefined
  for (const n of topTables(syntaxTree(state))) {
    if (doc.lineAt(n.from).from <= pos && pos <= doc.lineAt(n.to).to) {
      table = n
      break
    }
  }
  if (!table) return false
  const td = target.closest<HTMLElement>("td, th")
  const row = tableRows(table)[Number(td?.dataset.row ?? 0)]
  if (!row) return false
  const span = rowCellSpans(row)[Number(td?.dataset.col ?? 0)]
  let anchor = row.to
  if (span) {
    const t = trimSpan(state.sliceDoc(span.from, span.to), span.from, span)
    anchor = t.to > t.from ? t.from : span.from + (span.to > span.from ? 1 : 0)
  }
  view.dispatch({ selection: { anchor }, scrollIntoView: true, userEvent: "select" })
  view.focus()
  return true
}

const tableClicks = EditorView.domEventHandlers({
  mousedown(e, view) {
    if (e.button !== 0) return false
    const target = e.target as Element
    const wrap = target.closest?.<HTMLElement>(".md-table-wrap")
    if (!wrap || target.closest(".md-ts")) return false
    e.preventDefault()
    return focusCell(view, wrap, target)
  },
})

export function tables(): Extension {
  return [
    tableField,
    Prec.high(keymap.of([
      { key: "ArrowDown", run: enterTable(1) },
      { key: "ArrowUp", run: enterTable(-1) },
    ])),
    tableClicks,
  ]
}
