import { redo, undo } from "@codemirror/commands"
import { EditorState, Prec, StateField } from "@codemirror/state"
import type { ChangeSpec, Extension, Range } from "@codemirror/state"
import { Decoration, EditorView, WidgetType, keymap } from "@codemirror/view"
import type { Command, DecorationSet, KeyBinding } from "@codemirror/view"
import { syntaxTree } from "@codemirror/language"
import type { SyntaxNode, Tree } from "@lezer/common"
import { mdConfig } from "../options.ts"
import type { MdPhrase } from "../phrases.ts"
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

function delimParts(table: SyntaxNode, src: string): string[] {
  const delim = table.getChild("TableDelimiter")
  if (!delim) return []
  const parts = src.slice(delim.from, delim.to).split("|").map((s) => s.trim())
  if (parts[0] === "") parts.shift()
  if (parts.length && parts[parts.length - 1] === "") parts.pop()
  return parts
}

const alignments = (table: SyntaxNode, src: string): string[] =>
  delimParts(table, src).map((p) => (/^:-+:$/.test(p) ? "center" : /^-+:$/.test(p) ? "right" : /^:-+$/.test(p) ? "left" : ""))

// src starts at doc position 0
const rowTexts = (row: SyntaxNode, src: string): string[] =>
  rowCellSpans(row).map((s) => {
    const t = trimSpan(src, 0, s)
    return src.slice(t.from, t.to)
  })

// An edited cell shows "|", the doc keeps it escaped
const unescapePipes = (s: string) => s.replace(/\\\|/g, "|")
export const cellSource = (text: string): string => text.replace(/[\r\n]+/g, " ").replace(/\\?\|/g, "\\|")

function ctxOf(state: EditorState): InlineCtx {
  const config = state.facet(mdConfig)
  return { jump: state.phrase("Jump to $1"), icon: config.icons.timestamp, pills: config.timestamps !== null }
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

// Copies freshly rendered cells into dom except keep; false when the shape changed
function refreshCells(dom: HTMLElement, source: string, ctx: InlineCtx, keep?: HTMLElement): boolean {
  const fresh = renderTable(source, ctx)
  const old = dom.querySelectorAll<HTMLElement>("td, th"), now = fresh.querySelectorAll<HTMLElement>("td, th")
  if (old.length !== now.length || dom.querySelectorAll("tr").length !== fresh.querySelectorAll("tr").length) return false
  now.forEach((cell, i) => {
    old[i].style.textAlign = cell.style.textAlign
    if (old[i] !== keep) old[i].replaceChildren(...cell.childNodes)
  })
  return true
}

class TableWidget extends WidgetType {
  source: string
  ctx: InlineCtx
  rows: number

  constructor(source: string, ctx: InlineCtx, rows: number) {
    super()
    this.source = source
    this.ctx = ctx
    this.rows = rows
  }

  eq(other: TableWidget): boolean {
    const a = other.ctx, b = this.ctx
    return other.source === this.source && a.jump === b.jump && a.icon === b.icon && a.pills === b.pills
  }

  get estimatedHeight(): number {
    return this.rows * 30
  }

  toDOM(): HTMLElement {
    const wrap = renderTable(this.source, this.ctx)
    wrap.addEventListener("input", onCellInput)
    wrap.addEventListener("keydown", onCellKey)
    wrap.addEventListener("focusout", onCellBlur)
    wrap.addEventListener("contextmenu", onCellMenu)
    return wrap
  }

  // Typing in a cell rewrites the source, so keep the DOM and the cell's focus
  updateDOM(dom: HTMLElement): boolean {
    const td = dom.querySelector<HTMLElement>("[data-editing]")
    if (!td || !refreshCells(dom, this.source, this.ctx, td)) return false
    const row = tableRows(topTables(mdParser.parse(this.source)).next().value!)[Number(td.dataset.row)]
    const text = unescapePipes(row ? rowTexts(row, this.source)[Number(td.dataset.col)] ?? "" : "")
    // Undo or a pasted line break changed the cell under the caret
    if (text !== td.textContent) {
      td.textContent = text
      caretToEnd(td)
    }
    return true
  }

  // A press outside the cells is on the wrapper's scrollbar: leave it to the browser
  ignoreEvent(e: Event): boolean {
    return e.type !== "mousedown" || !(e.target instanceof Element && e.target.closest("td, th"))
  }
}

function build(state: EditorState): DecorationSet {
  const { doc } = state
  const ctx = ctxOf(state)
  const ranges: Range<Decoration>[] = []
  for (const n of topTables(syntaxTree(state))) {
    if (isRangeRevealed(state, n.from, n.to)) continue
    const from = doc.lineAt(n.from), to = doc.lineAt(n.to)
    const widget = new TableWidget(state.sliceDoc(n.from, n.to), ctx, to.number - from.number + 1)
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

// Editing

function tableAt(state: EditorState, pos: number): SyntaxNode | undefined {
  const { doc } = state
  for (const n of topTables(syntaxTree(state))) if (doc.lineAt(n.from).from <= pos && pos <= doc.lineAt(n.to).to) return n
}

export function setCell(state: EditorState, table: SyntaxNode, r: number, c: number, text: string): ChangeSpec | null {
  const row = tableRows(table)[r]
  if (!row) return null
  const spans = rowCellSpans(row)
  const span = spans[c]
  if (span) {
    const t = trimSpan(state.sliceDoc(span.from, span.to), span.from, span)
    return t.to > t.from ? { from: t.from, to: t.to, insert: text } : { from: span.from, to: span.to, insert: ` ${text} ` }
  }
  const closed = state.sliceDoc(row.to - 1, row.to) === "|"
  return { from: row.to, insert: `${closed ? "" : " |"}${"  |".repeat(c - spans.length)} ${text} |` }
}

export type TableOp = "rowAbove" | "rowBelow" | "colLeft" | "colRight" | "delRow" | "delCol"

// Rewrites the whole table, so a structural edit also tidies its spacing. Extra cells past the header stay.
export function applyTableOp(src: string, op: TableOp, r: number, c: number): string | null {
  const table = topTables(mdParser.parse(src)).next().value
  if (!table) return null
  const rows = tableRows(table).map((row) => rowTexts(row, src))
  const cols = rows[0].length
  const align = delimParts(table, src)
  for (const cells of rows) while (cells.length < cols) cells.push("")
  while (align.length < cols) align.push("---")
  const empty = () => Array<string>(cols).fill("")
  switch (op) {
    case "rowAbove":
      if (r < 1) return null
      rows.splice(r, 0, empty())
      break
    case "rowBelow":
      rows.splice(r + 1, 0, empty())
      break
    case "delRow":
      if (r < 1) return null
      rows.splice(r, 1)
      break
    case "colLeft":
    case "colRight": {
      const at = op === "colRight" ? c + 1 : c
      for (const cells of rows) cells.splice(at, 0, "")
      align.splice(at, 0, "---")
      break
    }
    case "delCol":
      if (cols < 2) return null
      for (const cells of [...rows, align]) cells.splice(c, 1)
  }
  const line = (cells: string[]) => `| ${cells.join(" | ")} |`
  return [line(rows[0]), line(align), ...rows.slice(1).map(line)].join("\n")
}

const cellPos = (td: HTMLElement) => ({ r: Number(td.dataset.row), c: Number(td.dataset.col) })
const isEditing = (td: HTMLElement) => "editing" in td.dataset

function caretToEnd(el: HTMLElement): void {
  const sel = el.ownerDocument.getSelection()
  if (!sel) return
  const range = el.ownerDocument.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  sel.removeAllRanges()
  sel.addRange(range)
}

function located(td: HTMLElement): { view: EditorView; table: SyntaxNode; wrap: HTMLElement } | null {
  const root = td.closest<HTMLElement>(".cm-editor")
  const view = root && EditorView.findFromDOM(root)
  const wrap = td.closest<HTMLElement>(".md-table-wrap")
  const table = view && wrap ? tableAt(view.state, view.posAtDOM(wrap)) : undefined
  return view && wrap && table ? { view, table, wrap } : null
}

function startEdit(td: HTMLElement): void {
  const at = located(td)
  if (!at || at.view.state.readOnly) return
  const { view, table } = at
  const { r, c } = cellPos(td)
  const row = tableRows(table)[r]
  td.dataset.editing = ""
  td.textContent = unescapePipes(row ? rowTexts(row, view.state.sliceDoc(0, row.to))[c] ?? "" : "")
  td.setAttribute("contenteditable", "plaintext-only")
  if (!td.isContentEditable) td.setAttribute("contenteditable", "true")
  td.focus()
  caretToEnd(td)
}

function finishEdit(td: HTMLElement): void {
  if (!isEditing(td)) return
  delete td.dataset.editing
  td.removeAttribute("contenteditable")
  const at = located(td)
  if (at) refreshCells(at.wrap, at.view.state.sliceDoc(at.table.from, at.table.to), ctxOf(at.view.state))
}

function editCell(view: EditorView, table: SyntaxNode, r: number, c: number): boolean {
  const wrap = [...view.contentDOM.querySelectorAll<HTMLElement>(".md-table-wrap")]
    .find((w) => tableAt(view.state, view.posAtDOM(w))?.from === table.from)
  const td = wrap?.querySelector<HTMLElement>(`[data-row="${r}"][data-col="${c}"]`)
  if (td) startEdit(td)
  return !!td
}

function runOp(view: EditorView, table: SyntaxNode, op: TableOp, r: number, c: number): void {
  const insert = applyTableOp(view.state.sliceDoc(table.from, table.to), op, r, c)
  if (insert === null) return
  view.dispatch({ changes: { from: table.from, to: table.to, insert }, userEvent: "input.table" })
  const next = tableAt(view.state, table.from)
  const target = op === "rowBelow" ? [r + 1, c] : op === "colRight" ? [r, c + 1] : op === "rowAbove" || op === "colLeft" ? [r, c] : null
  if (!next || !target || !editCell(view, next, target[0], target[1])) view.focus()
}

function leave(view: EditorView, table: SyntaxNode, dir: 1 | -1): void {
  const { doc } = view.state
  const line = dir > 0 ? doc.lineAt(table.to).number + 1 : doc.lineAt(table.from).number - 1
  const anchor = line < 1 ? table.from : line > doc.lines ? table.to : dir > 0 ? doc.line(line).from : doc.line(line).to
  view.focus()
  view.dispatch({ selection: { anchor }, scrollIntoView: true, userEvent: "select" })
}

const editedCell = (e: Event) => (e.target as Element).closest?.<HTMLElement>("[data-editing]") ?? null

function onCellInput(e: Event): void {
  const td = editedCell(e)
  const at = td && located(td)
  if (!td || !at) return
  const { r, c } = cellPos(td)
  const changes = setCell(at.view.state, at.table, r, c, cellSource(td.textContent ?? ""))
  if (changes) at.view.dispatch({ changes, userEvent: "input.type" })
}

function onCellBlur(e: Event): void {
  const td = editedCell(e)
  if (td) finishEdit(td)
}

function onCellKey(e: KeyboardEvent): void {
  const td = editedCell(e)
  const at = td && located(td)
  if (!td || !at || e.isComposing) return
  const { view, table } = at
  const { r, c } = cellPos(td)
  const rows = tableRows(table).length
  const cols = td.parentElement?.children.length ?? 1
  const mod = e.ctrlKey || e.metaKey
  // Past the last row adds one
  const go = (row: number, col: number) => {
    finishEdit(td)
    if (row >= rows) runOp(view, table, "rowBelow", rows - 1, col)
    else editCell(view, table, row, col)
  }
  if (e.key === "Tab" && !mod && !e.altKey) {
    const i = r * cols + c + (e.shiftKey ? -1 : 1)
    if (i < 0) return
    go(Math.floor(i / cols), i % cols)
  } else if (e.key === "Enter" && !mod) go(r + 1, c)
  else if (e.key === "ArrowDown" && !mod && r + 1 < rows) go(r + 1, c)
  else if (e.key === "ArrowUp" && !mod && r > 0) go(r - 1, c)
  else if (e.key === "Escape" || ((e.key === "ArrowDown" || e.key === "ArrowUp") && !mod)) {
    finishEdit(td)
    leave(view, table, e.key === "ArrowUp" ? -1 : 1)
  } else if (mod && /^[zy]$/i.test(e.key)) (e.key.toLowerCase() === "y" || e.shiftKey ? redo : undo)(view)
  else return
  e.preventDefault()
}

// Context menu

const MENU: readonly (readonly [TableOp, MdPhrase])[] = [
  ["rowAbove", "Insert row above"], ["rowBelow", "Insert row below"], ["colLeft", "Insert column left"],
  ["colRight", "Insert column right"], ["delRow", "Delete row"], ["delCol", "Delete column"],
]

let closeMenu = () => {}

function onCellMenu(e: MouseEvent): void {
  const td = (e.target as Element).closest?.<HTMLElement>("td, th")
  const at = td && located(td)
  if (!td || !at || at.view.state.readOnly) return
  e.preventDefault()
  closeMenu()
  const { view, table } = at
  const { r, c } = cellPos(td)
  const wasEditing = isEditing(td)
  const cols = td.parentElement?.children.length ?? 0
  const win = view.dom.ownerDocument.defaultView ?? window

  const menu = document.createElement("div")
  menu.className = "md-table-menu"
  menu.setAttribute("role", "menu")
  menu.setAttribute("aria-label", view.state.phrase("Table"))
  const onDown = (ev: Event) => {
    if (!menu.contains(ev.target as Node)) close()
  }
  const close = () => {
    menu.remove()
    win.removeEventListener("pointerdown", onDown, true)
    view.scrollDOM.removeEventListener("scroll", close)
    closeMenu = () => {}
  }
  const items = MENU.flatMap(([op, label]) => {
    if (((op === "rowAbove" || op === "delRow") && r < 1) || (op === "delCol" && cols < 2)) return []
    const btn = menu.appendChild(document.createElement("button"))
    btn.type = "button"
    btn.setAttribute("role", "menuitem")
    btn.textContent = view.state.phrase(label)
    btn.addEventListener("click", () => {
      close()
      runOp(view, tableAt(view.state, table.from) ?? table, op, r, c)
    })
    return [btn]
  })
  menu.addEventListener("keydown", (ev) => {
    const i = items.indexOf(ev.target as HTMLButtonElement)
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") items.at((i + (ev.key === "ArrowDown" ? 1 : -1)) % items.length)?.focus()
    else if (ev.key === "Escape" || ev.key === "Tab") {
      close()
      if (wasEditing && td.isConnected) startEdit(td)
      else view.focus()
    } else return
    ev.preventDefault()
  })
  closeMenu = close
  win.addEventListener("pointerdown", onDown, true)
  view.scrollDOM.addEventListener("scroll", close)

  // A keyboard-opened menu has no pointer position
  const box = view.dom.getBoundingClientRect(), cell = td.getBoundingClientRect()
  const x = e.clientX || cell.left, y = e.clientY || cell.bottom
  view.dom.append(menu)
  menu.style.left = `${Math.max(0, Math.min(x - box.left, box.width - menu.offsetWidth))}px`
  menu.style.top = `${Math.max(0, Math.min(y - box.top, box.height - menu.offsetHeight))}px`
  items[0]?.focus()
}

// Navigation

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
  let entered = false
  state.field(tableField).between(target.from, target.to, (from, to) => {
    if (dir > 0 ? from !== target.from : to !== target.to) return
    const table = tableAt(state, from)
    entered = !!table && editCell(view, table, dir > 0 ? 0 : tableRows(table).length - 1, 0)
    return false
  })
  return entered
}

// Raw tables: Tab and Shift+Tab select the next or previous cell's text
const moveCell = (dir: 1 | -1): Command => (view) => {
  const { state } = view
  const head = state.selection.main.head
  const table = tableAt(state, head)
  if (!table) return false
  const src = state.sliceDoc(0, table.to)
  const spans = tableRows(table).flatMap(rowCellSpans)
  let i = spans.findIndex((s) => head <= s.to)
  if (i < 0) i = spans.length
  // Between two cells, Tab goes to the one after
  else if (head < spans[i].from && dir > 0) i--
  const target = spans[i + dir]
  if (!target) return false
  const t = trimSpan(src, 0, target)
  view.dispatch({ selection: { anchor: t.from, head: t.to }, scrollIntoView: true, userEvent: "select" })
  return true
}

export const tableKeymap: readonly KeyBinding[] = [
  { key: "Tab", run: moveCell(1) },
  { key: "Shift-Tab", run: moveCell(-1) },
]

const tableClicks = EditorView.domEventHandlers({
  mousedown(e) {
    if (e.button !== 0) return false
    const target = e.target as Element
    const td = target.closest?.<HTMLElement>(".md-table-wrap td, .md-table-wrap th")
    if (!td || target.closest(".md-ts")) return false
    // Already editing: the browser places the caret
    if (isEditing(td)) return true
    e.preventDefault()
    startEdit(td)
    return true
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
