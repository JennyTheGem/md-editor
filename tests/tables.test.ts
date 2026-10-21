import { describe, expect, it } from "vitest"
import { history } from "@codemirror/commands"
import { EditorState } from "@codemirror/state"
import { keymap, runScopeHandlers } from "@codemirror/view"
import type { EditorView, WidgetType } from "@codemirror/view"
import { mdParser } from "../src/syntax.ts"
import { mdConfig } from "../src/options.ts"
import { applyTableOp, renderTable, rowCellSpans, tableField, tableKeymap, tables } from "../src/preview/tables.ts"
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
    expect(cellTexts("| a | b |  ")).toEqual([" a ", " b "])
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

  const cell = (view: EditorView, r: number, c: number) =>
    view.contentDOM.querySelector<HTMLElement>(`.md-table-wrap [data-row="${r}"][data-col="${c}"]`)
  const key = (el: Element, k: string, shiftKey = false, ctrlKey = false) => {
    const e = new KeyboardEvent("keydown", { key: k, shiftKey, ctrlKey, bubbles: true, cancelable: true })
    el.dispatchEvent(e)
    return e.defaultPrevented
  }
  const type = (td: HTMLElement, text: string) => {
    td.textContent = text
    td.dispatchEvent(new Event("input", { bubbles: true }))
  }
  const click = (td: HTMLElement) => {
    const e = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 })
    td.dispatchEvent(e)
    return e.defaultPrevented
  }
  // Edits cell (r, c) of src to text and returns the doc
  const edit = (src: string, r: number, c: number, text: string) => {
    const view = mdView(src, ext)
    try {
      const td = cell(view, r, c)!
      click(td)
      type(td, text)
      return view.state.doc.toString()
    } finally {
      view.destroy()
    }
  }

  it("keeps spaces typed at the ends of a cell", () => {
    const view = mdView(doc, ext, doc.length)
    try {
      const td = cell(view, 1, 1)!
      click(td)
      type(td, "x ")
      expect(td.textContent).toBe("x ")
      type(td, "x y")
      expect(view.state.doc.line(4).text).toBe("| c |   x y |")
      type(td, "a\nb")
      expect(view.state.doc.line(4).text).toBe("| c |   a b |")
      expect(td.textContent).toBe("a b")
    } finally {
      view.destroy()
    }
  })

  it("edits the raw source of a cell clicked while another is edited", () => {
    const view = mdView("| **a** | [l](https://x.y) |\n| - | - |", ext)
    try {
      click(cell(view, 0, 0)!)
      const td = cell(view, 0, 1)!
      expect(click(td)).toBe(true)
      expect(td.textContent).toBe("[l](https://x.y)")
      expect(cell(view, 0, 0)?.querySelector("strong")).not.toBeNull()
      // A press in the edited cell is the browser's, to place the caret
      expect(click(td)).toBe(false)
      expect(td.dataset.editing).toBe("")
    } finally {
      view.destroy()
    }
  })

  it("keeps rows and columns whole when editing edge cells", () => {
    // No outer pipes: the edited edge cell gets one
    expect(edit("a | b\n--- | ---\nc | d", 1, 0, "")).toBe("a | b\n--- | ---\n|  | d")
    expect(edit("a | b\n--- | ---\nc | d", 0, 1, "")).toBe("a |  |\n--- | ---\nc | d")
    expect(edit("a | b\n--- | ---\nc | d", 1, 0, "- x")).toBe("a | b\n--- | ---\n| - x | d")
    // A trailing backslash would escape the pipe after it
    expect(edit("|a|b|\n|-|-|", 0, 0, "a\\")).toBe("|a\\ |b|\n|-|-|")
    // A missing cell goes after the closing pipe, not after trailing spaces
    expect(edit("| a | b |\n| - | - |\n| c |  ", 1, 1, "e")).toBe("| a | b |\n| - | - |\n| c | e |  ")
  })

  it("re-enters a cell after an undo or a delete redraws the table", () => {
    const view = mdView("| a |\n| - |\n| b |\n| c |", [...ext, history()])
    try {
      const last = cell(view, 2, 0)!
      click(last)
      key(last, "Tab")
      type(cell(view, 3, 0)!, "d")
      expect(view.state.doc.lines).toBe(5)
      expect(key(cell(view, 3, 0)!, "z", false, true)).toBe(true)
      expect(view.state.doc.lines).toBe(4)
      expect(document.activeElement).toBe(cell(view, 2, 0))
      cell(view, 2, 0)!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }))
      const del = [...view.dom.querySelectorAll<HTMLButtonElement>(".md-table-menu button")].find((b) => b.textContent === "Delete row")
      del!.click()
      expect(view.state.doc.toString()).toBe("| a |\n| - |\n| b |")
      expect(document.activeElement).toBe(cell(view, 1, 0))
    } finally {
      view.destroy()
    }
  })

  it("keeps editing when only the window loses focus", () => {
    const view = mdView(doc, ext)
    try {
      const td = cell(view, 1, 0)!
      click(td)
      td.dispatchEvent(new FocusEvent("focusout", { bubbles: true }))
      expect(td.dataset.editing).toBe("")
    } finally {
      view.destroy()
    }
  })

  it("arrow keys pass a table in a read-only editor", () => {
    const view = mdView(doc, [...ext, EditorState.readOnly.of(true)], 1)
    try {
      expect(press(view, "ArrowDown")).toBe(false)
      expect(click(cell(view, 1, 0)!)).toBe(true)
      expect(cell(view, 1, 0)?.dataset.editing).toBeUndefined()
    } finally {
      view.destroy()
    }
  })

  it("arrow keys into a rendered table edit its first cell", () => {
    const view = mdView(doc, ext, 1)
    try {
      expect(press(view, "ArrowDown")).toBe(true)
      expect(document.activeElement).toBe(cell(view, 0, 0))
      expect(cell(view, 0, 0)?.hasAttribute("data-editing")).toBe(true)
      view.dispatch({ selection: { anchor: view.state.doc.line(6).from } })
      expect(press(view, "ArrowDown")).toBe(false)
    } finally {
      view.destroy()
    }
  })

  it("edits a clicked cell in place and keeps the table rendered", () => {
    const view = mdView(doc, ext, doc.length)
    try {
      const td = cell(view, 1, 1)!
      const e = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 })
      td.dispatchEvent(e)
      expect(e.defaultPrevented).toBe(true)
      expect(td.dataset.editing).toBe("")
      type(td, "x|y")
      expect(view.state.doc.line(4).text).toBe("| c |   x\\|y |")
      expect(cell(view, 1, 1)).toBe(td)
      expect(td.textContent).toBe("x|y")
      expect(key(td, "Tab")).toBe(true)
      expect(document.activeElement).toBe(cell(view, 2, 0))
      type(cell(view, 2, 0)!, "e")
      expect(view.state.doc.line(5).text).toBe("| e |  |")
      expect(key(cell(view, 2, 0)!, "Escape")).toBe(true)
      expect(view.state.selection.main.anchor).toBe(view.state.doc.line(6).from)
      expect(cell(view, 2, 0)?.textContent).toBe("e")
    } finally {
      view.destroy()
    }
  })

  it("tabs between raw cells", () => {
    const raw = "| a | bb |\n| - | - |\n| c | d |"
    const view = mdView(raw, [mdConfig.of({}), keymap.of(tableKeymap)], 1)
    try {
      expect(press(view, "Tab")).toBe(true)
      expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe("bb")
      expect(press(view, "Tab")).toBe(true)
      expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe("c")
      view.dispatch({ selection: { anchor: raw.length - 2 } })
      expect(press(view, "Tab")).toBe(false)
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

describe("applyTableOp", () => {
  const src = "| a | b |\n| :- | -: |\n| c |"
  it("inserts and deletes rows and columns", () => {
    expect(applyTableOp(src, "rowBelow", 0, 0)).toBe("| a | b |\n| :- | -: |\n|  |  |\n| c |  |")
    expect(applyTableOp(src, "colRight", 1, 0)).toBe("| a |  | b |\n| :- | --- | -: |\n| c |  |  |")
    expect(applyTableOp(src, "delCol", 0, 0)).toBe("| b |\n| -: |\n|  |")
    expect(applyTableOp(src, "delRow", 1, 0)).toBe("| a | b |\n| :- | -: |")
  })
  it("refuses to drop the header or the last column", () => {
    expect(applyTableOp(src, "delRow", 0, 0)).toBeNull()
    expect(applyTableOp(src, "rowAbove", 0, 0)).toBeNull()
    expect(applyTableOp("| a |\n| - |", "delCol", 0, 0)).toBeNull()
  })
})
