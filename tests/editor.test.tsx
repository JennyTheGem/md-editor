import { StrictMode, createRef } from "react"
import { fireEvent, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CompletionContext } from "@codemirror/autocomplete"
import type { CompletionResult, CompletionSource } from "@codemirror/autocomplete"
import { undoDepth } from "@codemirror/commands"
import { EditorState } from "@codemirror/state"
import { EditorView, runScopeHandlers } from "@codemirror/view"
import { mdEditor } from "../src/editor.ts"
import { MarkdownEditor, createMdState, mdCommands, setDoc, updateMdEditor } from "../src/index.ts"
import { revealField } from "../src/preview/reveal.ts"
import type { MarkdownEditorHandle, MdEditorOptions } from "../src/index.ts"
import { nodes } from "./helpers.ts"

const views: EditorView[] = []
afterEach(() => {
  for (const v of views.splice(0)) {
    const parent = v.dom.parentElement
    v.destroy()
    parent?.remove()
  }
})

function mount(doc: string, o: MdEditorOptions = {}): EditorView {
  const parent = document.body.appendChild(document.createElement("div"))
  const view = new EditorView({ parent, state: createMdState(doc, o) })
  views.push(view)
  return view
}

const clock = (seek: (s: number) => void = () => {}) => ({ now: () => 83.9, seek })
const firstLine = (v: EditorView) => v.contentDOM.querySelector(".cm-line")?.textContent
const pill = (v: EditorView) => v.contentDOM.querySelector<HTMLElement>(".md-ts")

// Calls every input handler the way CM does for a typed '#', then applies the default insert if none took it
function typeHash(view: EditorView, pos: number): boolean {
  const insert = () => view.state.update({ changes: { from: pos, insert: "#" }, selection: { anchor: pos + 1 }, userEvent: "input.type" })
  const handled = view.state.facet(EditorView.inputHandler).some((h) => h(view, pos, pos, "#", insert))
  if (!handled) view.dispatch(insert())
  return handled
}

async function slashLabels(o: MdEditorOptions): Promise<string[]> {
  const state = EditorState.create({ doc: "/t", selection: { anchor: 2 }, extensions: mdEditor(o) })
  const sources = state.languageDataAt<CompletionSource>("autocomplete", 2)
  const results = await Promise.all(sources.map((s) => s(new CompletionContext(state, 2, false))))
  return results.flatMap((r: CompletionResult | null) => r?.options.map((c) => c.label) ?? [])
}

describe("headless", () => {
  it("parses headings", () => {
    expect(nodes(createMdState("# x"))).toContain("ATXHeading1:# x")
  })

  it("setDoc replaces the doc with a fresh history and no onChange", () => {
    const onChange = vi.fn()
    const view = mount("a", { onChange })
    view.dispatch({ changes: { from: 1, insert: "b" }, userEvent: "input.type" })
    expect(undoDepth(view.state)).toBe(1)
    expect(onChange).toHaveBeenCalledTimes(1)
    setDoc(view, "new", { onChange })
    expect(view.state.doc.toString()).toBe("new")
    expect(undoDepth(view.state)).toBe(0)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it("setDoc keeps the focus flag", () => {
    const view = mount("a")
    view.focus()
    setDoc(view, "b")
    expect(view.state.field(revealField).focused).toBe(true)
  })

  it("switches live preview at runtime and keeps undo", () => {
    const doc = "**b**\n\n| a | b |\n| - | - |\n| 1 | 2 |"
    const view = mount(doc)
    view.dispatch({ changes: { from: doc.length, insert: "\n\nend" }, userEvent: "input.type" })
    expect(firstLine(view)).toBe("b")
    expect(view.contentDOM.querySelector(".md-table-wrap")).not.toBeNull()
    updateMdEditor(view, { livePreview: false })
    expect(firstLine(view)).toBe("**b**")
    expect(view.contentDOM.querySelector(".md-table-wrap")).toBeNull()
    expect(undoDepth(view.state)).toBe(1)
    updateMdEditor(view, { livePreview: true })
    expect(firstLine(view)).toBe("b")
    expect(view.contentDOM.querySelector(".md-table-wrap")).not.toBeNull()
  })

  it("switches phrases at runtime on the same view", () => {
    const view = mount("@[1:23]", { timestamps: clock() })
    expect(pill(view)?.getAttribute("aria-label")).toBe("Jump to 1:23")
    expect(view.contentDOM.getAttribute("aria-label")).toBe("Markdown editor")
    updateMdEditor(view, { phrases: { "Jump to $1": "Springe zu $1", "Markdown editor": "Notizen" } })
    expect(pill(view)?.getAttribute("aria-label")).toBe("Springe zu 1:23")
    expect(view.contentDOM.getAttribute("aria-label")).toBe("Notizen")
  })

  it("does not dispatch when no runtime key is present", () => {
    const view = mount("x")
    const spy = vi.spyOn(view, "dispatch")
    updateMdEditor(view, {})
    expect(spy).not.toHaveBeenCalled()
  })

  it("registers the slash and emoji sources as two functions", () => {
    const sources = createMdState("x").languageDataAt<unknown>("autocomplete", 1)
    expect(sources).toHaveLength(2)
    expect(sources.every((s) => typeof s === "function")).toBe(true)
  })

  it("calls onChange once per doc change", () => {
    const onChange = vi.fn()
    const view = mount("a", { onChange })
    view.dispatch({ selection: { anchor: 0 } })
    expect(onChange).not.toHaveBeenCalled()
    view.dispatch({ changes: { from: 1, insert: "b" } })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenLastCalledWith("ab", view.state)
    view.dispatch({ changes: { from: 2, insert: "c" } })
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it("binds Mod-b to bold", () => {
    const view = mount("word")
    view.dispatch({ selection: { anchor: 0, head: 4 } })
    expect(runScopeHandlers(view, new KeyboardEvent("keydown", { key: "b", ctrlKey: true }), "editor")).toBe(true)
    expect(view.state.doc.toString()).toBe("**word**")
  })

  it("keeps a no-op format key from falling through", () => {
    const key = (k: string) => runScopeHandlers(view, new KeyboardEvent("keydown", { key: k, ctrlKey: true }), "editor")
    const view = mount("`abc`")
    view.dispatch({ selection: { anchor: 2 } })
    expect(key("i")).toBe(true)
    expect(key("b")).toBe(true)
    expect(key("u")).toBe(true)
    expect(view.state.doc.toString()).toBe("`abc`")
    expect(view.state.selection.main.from).toBe(2)
    expect(view.state.selection.main.empty).toBe(true)
  })
})

describe("timestamps are opt-in", () => {
  it("renders no pill without the option", () => {
    const view = mount("@[1:23]")
    expect(pill(view)).toBeNull()
    expect(firstLine(view)).toBe("@[1:23]")
  })

  it("keeps '#' literal without the option", () => {
    const view = mount("x ")
    expect(typeHash(view, 2)).toBe(false)
    expect(view.state.doc.toString()).toBe("x #")
    const on = mount("x ", { timestamps: clock() })
    expect(typeHash(on, 2)).toBe(true)
    expect(on.state.doc.toString()).toBe("x @[1:23]")
  })

  it("has no timestamp command without the option", () => {
    expect(mdCommands.timestamp(mount("x"))).toBe(false)
  })

  it("lists the slash Timestamp entry only with the option", async () => {
    expect(await slashLabels({})).not.toContain("Timestamp")
    expect(await slashLabels({ timestamps: clock() })).toContain("Timestamp")
  })
})

describe("MarkdownEditor", () => {
  it("mounts one editor under StrictMode and none after unmount", () => {
    const { container, unmount } = render(<StrictMode><MarkdownEditor defaultValue="x" className="notes" /></StrictMode>)
    expect(document.querySelectorAll(".cm-editor")).toHaveLength(1)
    expect(container.querySelector(".mdEditor.notes .cm-editor")).not.toBeNull()
    unmount()
    expect(document.querySelectorAll(".cm-editor")).toHaveLength(0)
  })

  it("exposes a working handle", () => {
    const ref = createRef<MarkdownEditorHandle>()
    render(<MarkdownEditor ref={ref} defaultValue="x" />)
    const h = ref.current
    if (!h?.view) throw new Error("no handle")
    expect(h.getDoc()).toBe("x")
    h.setDoc("y")
    expect(h.getDoc()).toBe("y")
    expect(undoDepth(h.view.state)).toBe(0)
    h.view.dispatch({ selection: { anchor: 0, head: 1 } })
    expect(h.run("bold")).toBe(true)
    expect(h.getDoc()).toBe("**y**")
    h.view.dispatch({ selection: { anchor: 0, head: 5 } })
    expect(h.run("red")).toBe(true)
    expect(h.getDoc()).toBe('<span style="color:#e06c75">**y**</span>')
    expect(h.run("timestamp")).toBe(false)
  })

  it("calls only the newest onChange without a remount", () => {
    const first = vi.fn()
    const second = vi.fn()
    const ref = createRef<MarkdownEditorHandle>()
    const { rerender } = render(<MarkdownEditor ref={ref} defaultValue="x" onChange={first} />)
    const view = ref.current?.view
    rerender(<MarkdownEditor ref={ref} defaultValue="x" onChange={second} />)
    expect(ref.current?.view).toBe(view)
    view?.dispatch({ changes: { from: 1, insert: "y" } })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith("xy", view?.state)
  })

  it("applies new phrases without a remount and skips shallow-equal ones", () => {
    const ref = createRef<MarkdownEditorHandle>()
    const { rerender } = render(<MarkdownEditor ref={ref} phrases={{ "Markdown editor": "Notes" }} />)
    const view = ref.current?.view
    if (!view) throw new Error("no view")
    expect(view.contentDOM.getAttribute("aria-label")).toBe("Notes")
    rerender(<MarkdownEditor ref={ref} phrases={{ "Markdown editor": "Notizen" }} />)
    expect(ref.current?.view).toBe(view)
    expect(view.contentDOM.getAttribute("aria-label")).toBe("Notizen")
    const spy = vi.spyOn(view, "dispatch")
    rerender(<MarkdownEditor ref={ref} phrases={{ "Markdown editor": "Notizen" }} />)
    expect(spy).not.toHaveBeenCalled()
  })

  it("seeks through the newest timestamps object", () => {
    const first = vi.fn()
    const second = vi.fn()
    const ref = createRef<MarkdownEditorHandle>()
    const { rerender } = render(<MarkdownEditor ref={ref} defaultValue="@[1:23]" timestamps={clock(first)} />)
    rerender(<MarkdownEditor ref={ref} defaultValue="@[1:23]" timestamps={clock(second)} />)
    const el = ref.current?.view && pill(ref.current.view)
    if (!el) throw new Error("no pill")
    fireEvent.mouseDown(el, { button: 0 })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith(83)
  })
})
