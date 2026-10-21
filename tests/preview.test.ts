import { afterEach, describe, expect, it, vi } from "vitest"
import { ensureSyntaxTree } from "@codemirror/language"
import type { EditorState } from "@codemirror/state"
import type { DecorationSet, EditorView } from "@codemirror/view"
import { mdConfig } from "../src/options.ts"
import { revealField, revealTracking, setFocused } from "../src/preview/reveal.ts"
import { buildStyles, stylesPlugin } from "../src/preview/styles.ts"
import { buildHidden, hidePlugin } from "../src/preview/hide.ts"
import { previewClicks, taskKeymap } from "../src/preview/clicks.ts"
import { mdState, mdView } from "./helpers.ts"

const FIXTURES = [
  "# ", "#", '<span style="color:#e06c75"></span>', "<u></u>", "```js\nconst a = 1", "-  [ ] x",
  "***x***", "| a |\n| - |\n| b |", "[1:99]", "a\\*b", "> q\n> r", "> [!x]", "> [!tip]-  ",
]

function built(doc: string, anchor: number, focused: boolean): EditorState {
  let s = mdState(doc, { anchor, extensions: [revealField, mdConfig.of({})] })
  if (focused) s = s.update({ effects: setFocused.of(true) }).state
  ensureSyntaxTree(s, s.doc.length, 5000)
  return s
}

// Empty marks or replaces, and replaces crossing a line break
function badRanges(set: DecorationSet, s: EditorState): string[] {
  const bad: string[] = []
  set.between(0, s.doc.length, (from, to, v) => {
    const replace = (v as unknown as { isReplace?: boolean }).isReplace === true
    if ((!v.point || replace) && from >= to) bad.push(`empty ${from}`)
    if (replace && s.doc.lineAt(from).to < to) bad.push(`crosses ${from}-${to}`)
  })
  return bad
}

const views: EditorView[] = []
function mount(doc: string, anchor?: number): EditorView {
  const view = mdView(doc, [revealTracking, mdConfig.of({}), stylesPlugin, hidePlugin, previewClicks], anchor)
  views.push(view)
  return view
}
const focus = (view: EditorView, anchor?: number, head?: number) =>
  view.dispatch({ selection: anchor === undefined ? undefined : { anchor, head }, effects: setFocused.of(true) })
const lineTexts = (view: EditorView) => [...view.contentDOM.querySelectorAll(".cm-line")].map((l) => l.textContent)
const q = (view: EditorView, sel: string) => view.contentDOM.querySelector<HTMLElement>(sel)
const mouseDown = (el: Element, init: MouseEventInit = {}) =>
  el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, ...init }))

afterEach(() => {
  views.splice(0).forEach((v) => v.destroy())
  vi.restoreAllMocks()
  vi.useRealTimers()
  Reflect.deleteProperty(navigator, "clipboard")
})

describe("builders", () => {
  it("never throw or yield empty ranges on crash fixtures", () => {
    for (const doc of FIXTURES) {
      for (const focused of [false, true]) {
        for (const anchor of [0, doc.length]) {
          const s = built(doc, anchor, focused)
          const ranges = [{ from: 0, to: s.doc.length }]
          expect(badRanges(buildStyles(s, ranges), s), doc).toEqual([])
          const { decorations, atomic } = buildHidden(s, ranges)
          expect(badRanges(decorations, s), doc).toEqual([])
          expect(badRanges(atomic, s), doc).toEqual([])
        }
      }
    }
  })

  it("does not duplicate nodes reached from two ranges", () => {
    const s = built("```js\nx\n```", 0, false)
    let headers = 0
    buildStyles(s, [{ from: 0, to: 3 }, { from: 3, to: 10 }]).between(0, s.doc.length, (_f, _t, v) => {
      if (v.spec.widget) headers++
    })
    expect(headers).toBe(1)
  })
})

describe("live preview", () => {
  it("mounts every fixture without a plugin crash", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    for (const doc of FIXTURES) {
      const view = mount(doc)
      focus(view, doc.length)
      view.dispatch({ effects: setFocused.of(false) })
    }
    expect(error).not.toHaveBeenCalled()
  })

  it("hides syntax off the cursor line and keeps styling on it", () => {
    const doc = "**b** [t](https://a.b) `c`"
    const view = mount(doc)
    expect(lineTexts(view)).toEqual(["b t c"])
    focus(view, 1)
    expect(lineTexts(view)).toEqual([doc])
    for (const sel of [".md-strong", ".md-link", ".md-code-inline"]) expect(q(view, sel), sel).not.toBeNull()
  })

  it("hides block syntax and keeps empty link labels visible", () => {
    const view = mount("> q\n\n---\n\n```js\nx\n```\n[](https://x)")
    expect(lineTexts(view)).toEqual(["q", "", "", "", "jsCopy code", "x", "", "[](https://x)"])
    expect(q(view, ".cm-line.md-hr.md-hr-on")).not.toBeNull()
    expect(q(view, ".cm-line.md-quote.md-quote-first.md-quote-last")).not.toBeNull()
    focus(view, 15)
    expect(lineTexts(view)[4]).toBe("```jsjsCopy code")
  })

  it("reveals only the anchor and head lines", () => {
    const view = mount("**x**\n**x**\n**x**\n**x**")
    focus(view, 0, 14)
    expect(lineTexts(view)).toEqual(["**x**", "x", "**x**", "x"])
  })

  it("styles headings in both states", () => {
    const view = mount("# Title")
    expect(q(view, ".cm-line.md-h1")).not.toBeNull()
    expect(lineTexts(view)).toEqual(["Title"])
    focus(view, 3)
    expect(q(view, ".cm-line.md-h1")).not.toBeNull()
    expect(lineTexts(view)).toEqual(["# Title"])
  })

  it("keeps snake_case literal", () => {
    expect(q(mount("snake_case_name"), ".md-em")).toBeNull()
  })

  it("colors only allowlisted spans", () => {
    expect(q(mount('<span style="color:#e06c75">r</span>'), ".md-color-red")).not.toBeNull()
    for (const doc of ['<span style="color:red;position:fixed">x</span>', '<span style="color:#123456">x</span>']) {
      const view = mount(doc)
      expect(q(view, '[class*="md-color-"]'), doc).toBeNull()
      const styles = [...view.contentDOM.querySelectorAll("[style]")].map((el) => el.getAttribute("style") ?? "")
      expect(styles.some((s) => s.includes("position")), doc).toBe(false)
    }
  })

  it("draws bullets and checkboxes", () => {
    expect(q(mount("- a"), ".md-bullet")).not.toBeNull()
    expect(q(mount("1. a"), ".md-bullet")).toBeNull()
    const view = mount("- [ ] a")
    expect(q(view, ".md-task")).not.toBeNull()
    expect(q(view, ".md-bullet")).toBeNull()
    focus(view, 7)
    expect(q(view, ".md-task")).not.toBeNull()
    focus(view, 3)
    expect(q(view, ".md-task")).toBeNull()
  })

  it("renders callouts, unknown types as notes, raw while the cursor is inside", () => {
    const view = mount("> [!TIP] Hi\n> body\n\n> [!foo]\n> x\n\n> plain")
    expect(q(view, ".cm-line.md-callout.md-callout-tip.md-callout-first")).not.toBeNull()
    expect(q(view, ".cm-line.md-callout-note.md-callout-first")).not.toBeNull()
    expect(view.contentDOM.querySelectorAll(".md-quote")).toHaveLength(1)
    expect(lineTexts(view)).toEqual(["Hi", "body", "", "Note", "x", "", "plain"])
    focus(view, 15)
    expect(lineTexts(view).slice(0, 4)).toEqual(["[!TIP] Hi", "> body", "", "Note"])
  })
})

describe("clicks", () => {
  it("toggles a task checkbox", () => {
    const view = mount("-  [ ] x")
    mouseDown(q(view, ".md-task")!)
    expect(view.state.doc.toString()).toBe("-  [x] x")
    mouseDown(q(view, ".md-task")!)
    expect(view.state.doc.toString()).toBe("-  [ ] x")
  })

  it("toggles the task on the cursor line with Mod-Enter", () => {
    const run = taskKeymap[0].run!
    const view = mount("plain\n- [ ] a", 8)
    expect(run(view)).toBe(true)
    expect(view.state.doc.toString()).toBe("plain\n- [x] a")
    view.dispatch({ selection: { anchor: 1 } })
    expect(run(view)).toBe(false)
  })

  it("copies fenced code", async () => {
    const view = mount("```js\nconst a = 1\n```")
    expect(q(view, ".md-copy")).not.toBeNull()
    focus(view, 8)
    const btn = q(view, ".md-copy")!
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
    mouseDown(btn)
    expect(writeText).toHaveBeenCalledWith("const a = 1")
    await Promise.resolve()
    expect(btn.dataset.state).toBe("copied")
    expect(btn.getAttribute("aria-label")).toBe("Copied")
  })

  it("reports a failed copy without a clipboard and restores", () => {
    vi.useFakeTimers()
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const view = mount("```js\nconst a = 1\n```")
    const btn = q(view, ".md-copy")!
    expect(() => mouseDown(btn)).not.toThrow()
    expect(btn.dataset.state).toBe("failed")
    expect(btn.getAttribute("aria-label")).toBe("Copy failed")
    vi.advanceTimersByTime(1500)
    expect(btn.dataset.state).toBeUndefined()
    expect(btn.getAttribute("aria-label")).toBe("Copy code")
    expect(error).not.toHaveBeenCalled()
  })

  it("opens only safe links on Ctrl+click", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null)
    mouseDown(q(mount("[t](https://a.b)"), ".md-link")!, { ctrlKey: true })
    expect(open).toHaveBeenCalledWith("https://a.b", "_blank", "noopener,noreferrer")
    mouseDown(q(mount("see www.a.com"), ".md-link")!, { ctrlKey: true })
    expect(open).toHaveBeenLastCalledWith("https://www.a.com", "_blank", "noopener,noreferrer")
    open.mockClear()
    mouseDown(q(mount("[x](javascript:alert(1))"), ".md-link")!, { ctrlKey: true })
    mouseDown(q(mount("[t](https://a.b)"), ".md-link")!)
    expect(open).not.toHaveBeenCalled()
  })
})
