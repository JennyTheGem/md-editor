import { afterEach, describe, expect, it, vi } from "vitest"
import { EditorSelection, EditorState } from "@codemirror/state"
import type { Extension } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { cursorCharLeft, deleteCharBackward, history, undo } from "@codemirror/commands"
import { mdConfig } from "../src/options.ts"
import { extractTimestamps, seekAtCursor, shouldInsertTimestamp, timestamps } from "../src/timestamps/timestamps.ts"
import { mdState, mdView } from "./helpers.ts"

const views: EditorView[] = []
afterEach(() => views.splice(0).forEach((v) => v.destroy()))

function setup(doc: string, anchor: number, now: () => number | null = () => 83.9, extra: readonly Extension[] = []) {
  const seek = vi.fn()
  const view = mdView(doc, [mdConfig.of({ timestamps: { now, seek } }), timestamps(), history(), ...extra], anchor)
  views.push(view)
  return { view, seek }
}

const should = (doc: string, pos = doc.length) => shouldInsertTimestamp(mdState(doc, { anchor: pos }), pos, pos, "#", "#")

// Calls every input handler the way CM does for a typed '#'
const typeHash = (view: EditorView, pos: number) =>
  view.state.facet(EditorView.inputHandler).map((h) =>
    h(view, pos, pos, "#", () => view.state.update({ changes: { from: pos, insert: "#" }, selection: { anchor: pos + 1 }, userEvent: "input.type" })))

const pill = (view: EditorView) => view.contentDOM.querySelector<HTMLElement>(".md-ts")

describe("shouldInsertTimestamp", () => {
  it("stays literal in code, URLs, after escapes, words and heading marks", () => {
    expect(should("```\nx \n```", 6)).toBe(false)
    expect(should("a `b ` c", 5)).toBe(false)
    expect(should("see https://a.b")).toBe(false)
    expect(should("see https://a.b/")).toBe(false)
    expect(should("a \\")).toBe(false)
    expect(should("C")).toBe(false)
    expect(should("issue")).toBe(false)
    expect(should("#")).toBe(false)
    expect(should("> ##")).toBe(false)
    expect(should("para\n\n    def f():\n    ")).toBe(false)
    expect(should("para\n\n    def f():\n\n    ")).toBe(false)
    expect(should("para\n    ")).toBe(true)
  })

  it("fires after a space, at line start and after punctuation", () => {
    expect(should("x ")).toBe(true)
    expect(should("")).toBe(true)
    expect(should("a\n")).toBe(true)
    expect(should("(a)")).toBe(true)
    expect(should("a #")).toBe(true)
  })

  it("accepts a composition commit ending in the trigger", () => {
    const s = mdState("x ab ", { anchor: 5 })
    expect(shouldInsertTimestamp(s, 2, 5, "ab #", "#")).toBe(true)
    expect(shouldInsertTimestamp(s, 2, 4, "ab#", "#")).toBe(false)
    expect(shouldInsertTimestamp(s, 2, 5, "xy #", "#")).toBe(false)
  })

  it("rejects an empty trigger, read-only and multiple cursors", () => {
    expect(shouldInsertTimestamp(mdState("x "), 2, 2, "", "")).toBe(false)
    expect(shouldInsertTimestamp(mdState("x ", { anchor: 2, extensions: [EditorState.readOnly.of(true)] }), 2, 2, "#", "#")).toBe(false)
    const multi = mdState("x ", { extensions: [EditorState.allowMultipleSelections.of(true)] })
      .update({ selection: EditorSelection.create([EditorSelection.cursor(0), EditorSelection.cursor(2)]) }).state
    expect(shouldInsertTimestamp(multi, 2, 2, "#", "#")).toBe(false)
  })
})

describe("'#' trigger", () => {
  it("inserts an isolated timestamp, undo gives back '#'", () => {
    const { view } = setup("x ", 2)
    expect(typeHash(view, 2)).toContain(true)
    expect(view.state.doc.toString()).toBe("x @[1:23]")
    expect(view.state.selection.main.head).toBe(9)
    view.dispatch({ changes: { from: 9, insert: "a" }, selection: { anchor: 10 }, userEvent: "input.type" })
    undo(view)
    expect(view.state.doc.toString()).toBe("x @[1:23]")
    undo(view)
    expect(view.state.doc.toString()).toBe("x #")
    undo(view)
    expect(view.state.doc.toString()).toBe("x ")
  })

  it("stays literal without media time", () => {
    for (const now of [() => null, () => { throw new Error("no video") }]) {
      const { view } = setup("x ", 2, now)
      expect(typeHash(view, 2).every((r) => r === false)).toBe(true)
      expect(view.state.doc.toString()).toBe("x ")
    }
  })

  it("is off without the timestamps option", () => {
    const view = mdView("x @[1:23]", [timestamps()], 0)
    views.push(view)
    expect(typeHash(view, 2).every((r) => r === false)).toBe(true)
    expect(pill(view)).toBeNull()
  })
})

describe("pills", () => {
  it("are atomic for delete and cursor moves", () => {
    const del = setup("ab @[1:23] cd", 10).view
    deleteCharBackward(del)
    expect(del.state.doc.toString()).toBe("ab  cd")

    const move = setup("ab @[1:23] cd", 10).view
    cursorCharLeft(move)
    expect(move.state.selection.main.head).toBe(3)
  })

  it("hide while the head is inside", () => {
    const { view } = setup("ab @[1:23] cd", 0)
    expect(pill(view)?.textContent).toBe("1:23")
    expect(pill(view)?.dataset.seconds).toBe("83")
    view.dispatch({ selection: { anchor: 5 } })
    expect(pill(view)).toBeNull()
    view.dispatch({ selection: { anchor: 12 } })
    expect(pill(view)).not.toBeNull()
  })

  it("seek on mouse down without moving the selection", () => {
    const { view, seek } = setup("ab @[1:23] cd", 1)
    const e = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 })
    pill(view)?.dispatchEvent(e)
    expect(seek).toHaveBeenCalledWith(83)
    expect(e.defaultPrevented).toBe(true)
    expect(view.state.selection.main.head).toBe(1)
  })

  it("use the phrase for the label", () => {
    const { view } = setup("ab @[1:23]", 0, undefined, [EditorState.phrases.of({ "Jump to $1": "Springe zu $1" })])
    expect(pill(view)?.getAttribute("aria-label")).toBe("Springe zu 1:23")
  })
})

describe("seekAtCursor", () => {
  it("seeks the pill next to the cursor", () => {
    const { view, seek } = setup("ab @[1:23] cd", 10)
    expect(seekAtCursor(view)).toBe(true)
    expect(seek).toHaveBeenCalledWith(83)
    view.dispatch({ selection: { anchor: 12 } })
    expect(seekAtCursor(view)).toBe(false)
    expect(seek).toHaveBeenCalledTimes(1)
  })
})

describe("extractTimestamps", () => {
  it("lists timestamps in doc order, never in code", () => {
    const list = extractTimestamps(mdState("a @[1:23]\n`@[2:00]`\n```\n@[3:00]\n```\nb @[1:02:03]"))
    expect(list.map((t) => t.seconds)).toEqual([83, 3723])
    expect(list.map((t) => t.line)).toEqual([1, 6])
    expect(list[0]).toEqual({ from: 2, to: 9, text: "1:23", seconds: 83, line: 1 })
  })
})
