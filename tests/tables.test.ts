import { describe, expect, it } from "vitest"
import type { EditorState } from "@codemirror/state"
import { runScopeHandlers } from "@codemirror/view"
import type { EditorView, WidgetType } from "@codemirror/view"
import { mdParser } from "../src/syntax.ts"
import { mdConfig } from "../src/options.ts"
import { renderTable, rowCellSpans, tableField, tables } from "../src/preview/tables.ts"
import { revealField, revealTracking, setFocused } from "../src/preview/reveal.ts"
import { mdState, mdView } from "./helpers.ts"

function cellTexts(row: string): string[] {
  const src = `| h | h |\n| --- | --- |\n${row}`
  const node = mdParser.parse(src).topNode.getChild("Table")?.getChild("TableRow")
  if (!node) throw new Error("no row")
  return rowCellSpans(node).map((s) => src.slice(s.from, s.to))
}

function widgets(state: EditorState): { from: number; to: number; block: boolean; widget: WidgetType }[] {
  const out: { from: number; to: number; block: boolean; widget: WidgetType }[] = []
  state.field(tableField).between(0, state.doc.length, (from, to, v) => {
    out.push({ from, to, block: v.spec.block === true, widget: v.spec.widget as WidgetType })
  })
  return out
}

const press = (view: EditorView, key: string) => runScopeHandlers(view, new KeyboardEvent("keydown", { key }), "editor")

describe("rowCellSpans", () => {
  it("splits on delimiters only", () => {
    expect(cellTexts("| a | b |")).toEqual([" a ", " b "])
    expect(cellTexts("a | b")).toEqual(["a ", " b"])
    expect(cellTexts("| a |  |")).toEqual([" a ", "  "])
    expect(cellTexts("| a \\| b | c |")).toEqual([" a \\| b ", " c "])
  })
})

describe("renderTable", () => {
  const dom = renderTable("| a | b |\n| --- | :-: |\n| **x** | @[1:23] |\n| y |", { jump: "Jump to $1" })

  it("builds header, padded body rows and inline marks", () => {
    expect(dom.className).toBe("md-table-wrap")
    expect(dom.querySelectorAll("table.md-table > thead > tr > th")).toHaveLength(2)
    const rows = dom.querySelectorAll("tbody > tr")
    expect(rows).toHaveLength(2)
    rows.forEach((tr) => expect(tr.querySelectorAll("td")).toHaveLength(2))
    expect(dom.querySelector("strong.md-strong")?.textContent).toBe("x")
  })

  it("renders pills, alignment and cell coordinates", () => {
    const pill = dom.querySelector<HTMLElement>(".md-ts")
    expect(pill?.dataset.seconds).toBe("83")
    expect(pill?.getAttribute("aria-label")).toBe("Jump to 1:23")
    const center = dom.querySelector<HTMLElement>('td[data-row="1"][data-col="1"]')
    expect(center?.style.textAlign).toBe("center")
    expect(dom.querySelector<HTMLElement>('th[data-row="0"][data-col="0"]')?.style.textAlign).toBe("")
    expect(dom.querySelector('td[data-row="2"][data-col="1"]')?.textContent).toBe("")
  })

  it("keeps html as text and maps only allowlisted colors", () => {
    const html = renderTable("| a |\n| - |\n| <img src=x onerror=alert(1)> |", { jump: "" })
    expect(html.querySelector("img")).toBeNull()
    expect(html.querySelector("td")?.textContent).toBe("<img src=x onerror=alert(1)>")
    const colors = renderTable('| a | b |\n| - | - |\n| <span style="color:#e06c75">r</span> | <span style="color:#123456">u</span> |', { jump: "" })
    const [red, other] = colors.querySelectorAll("td")
    expect(red.querySelector("span.md-color-red")?.textContent).toBe("r")
    expect(other.querySelector("span")?.className).toBe("")
    expect(other.textContent).toBe("u")
  })

  it("renders links, escapes and plain timestamps when pills are off", () => {
    const d = renderTable("| a | b | c |\n| - | - | - |\n| [**l**](https://x.y) | a \\| b | [^1] @[1:23] |", { jump: "J $1", pills: false })
    const link = d.querySelector("td span.md-link")
    expect(link?.textContent).toBe("l")
    expect(link?.querySelector("strong.md-strong")).not.toBeNull()
    expect(d.querySelector('td[data-col="1"]')?.textContent).toBe("a | b")
    expect(d.querySelector('td[data-col="2"]')?.textContent).toBe("[^1] @[1:23]")
    expect(d.querySelector(".md-ts")).toBeNull()
  })

  it("falls back to text when the source is not a table", () => {
    expect(renderTable("plain", { jump: "" }).textContent).toBe("plain")
  })
})

describe("tableField", () => {
  const doc = "| a |\n| - |\n| b |\n\nafter"
  const ext = [revealField, mdConfig.of({}), tableField]
  const focus = (s: EditorState) => s.update({ effects: setFocused.of(true) }).state

  it("renders while unfocused, hides while the cursor is inside", () => {
    const s = mdState(doc, { anchor: 2, extensions: ext })
    const w = widgets(s)
    expect(w).toHaveLength(1)
    expect(w[0]).toMatchObject({ from: 0, to: s.doc.line(3).to, block: true })
    expect(widgets(focus(s))).toHaveLength(0)
    expect(widgets(focus(mdState(doc, { anchor: doc.length, extensions: ext })))).toHaveLength(1)
  })

  it("ignores tables in fences and quotes", () => {
    expect(widgets(mdState("```\n| a |\n| - |\n```", { extensions: ext }))).toHaveLength(0)
    expect(widgets(mdState("> | a |\n> | - |", { extensions: ext }))).toHaveLength(0)
    expect(widgets(mdState("- | a |\n  | - |", { extensions: ext }))).toHaveLength(0)
  })

  it("keeps an eq widget when editing outside the table", () => {
    const s = focus(mdState(doc, { anchor: doc.length, extensions: ext }))
    const next = s.update({ changes: { from: doc.length, insert: "!" }, selection: { anchor: doc.length + 1 } }).state
    const [a] = widgets(s), [b] = widgets(next)
    expect(b.widget).not.toBe(a.widget)
    expect(b.widget.eq(a.widget)).toBe(true)
  })
})

describe("tables in a view", () => {
  const doc = "top\n| a | b |\n| --- | --- |\n| c |   d |\n\nend"
  const ext = [revealTracking, mdConfig.of({}), tables()]

  it("enters a rendered table with the arrow keys", () => {
    const view = mdView(doc, ext, 1)
    try {
      expect(press(view, "ArrowDown")).toBe(true)
      expect(view.state.selection.main.anchor).toBe(4)
      view.dispatch({ selection: { anchor: view.state.doc.line(5).from } })
      expect(press(view, "ArrowUp")).toBe(true)
      expect(view.state.selection.main.anchor).toBe(view.state.doc.line(4).from)
      view.dispatch({ selection: { anchor: view.state.doc.line(5).from } })
      expect(press(view, "ArrowDown")).toBe(false)
    } finally {
      view.destroy()
    }
  })

  it("puts the cursor in the clicked cell", () => {
    const view = mdView(doc, ext, doc.length)
    try {
      const td = view.contentDOM.querySelector<HTMLElement>('.md-table-wrap td[data-row="1"][data-col="1"]')
      expect(td?.textContent).toBe("d")
      const e = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 })
      td?.dispatchEvent(e)
      expect(e.defaultPrevented).toBe(true)
      expect(view.state.selection.main.anchor).toBe(doc.indexOf("   d") + 3)
    } finally {
      view.destroy()
    }
  })

  it("leaves a press on the wrapper itself (its scrollbar) to the browser", () => {
    const view = mdView(doc, ext, doc.length)
    try {
      const e = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 })
      view.contentDOM.querySelector(".md-table-wrap")?.dispatchEvent(e)
      expect(e.defaultPrevented).toBe(false)
      expect(view.state.selection.main.anchor).toBe(doc.length)
    } finally {
      view.destroy()
    }
  })

  it("shows pills in cells only when timestamps are on", () => {
    const src = "| t |\n| - |\n| @[1:23] |"
    const plain = mdView(src, ext)
    const on = mdView(src, [revealTracking, mdConfig.of({ timestamps: { now: () => 0, seek: () => {} } }), tables()])
    try {
      expect(plain.contentDOM.querySelector(".md-table-wrap .md-ts")).toBeNull()
      expect(plain.contentDOM.querySelector(".md-table-wrap td")?.textContent).toBe("@[1:23]")
      expect(on.contentDOM.querySelector(".md-table-wrap .md-ts")).not.toBeNull()
    } finally {
      plain.destroy()
      on.destroy()
    }
  })
})
