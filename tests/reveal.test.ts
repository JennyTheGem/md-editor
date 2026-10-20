import { describe, expect, it } from "vitest"
import type { EditorState } from "@codemirror/state"
import { mdConfig } from "../src/options.ts"
import { isLineRevealed, isRangeRevealed, revealField, revealTracking, setFocused, setFrozen } from "../src/preview/reveal.ts"
import { mdState, mdView } from "./helpers.ts"

// Lines: one [0,3], two [4,7], three [8,13], four [14,18]
const DOC = "one\ntwo\nthree\nfour"
const make = (anchor: number, head?: number) => mdState(DOC, { anchor, head, extensions: [revealField, mdConfig.of({})] })
const reveal = (s: EditorState) => s.field(revealField)
const focus = (s: EditorState) => s.update({ effects: setFocused.of(true) }).state

describe("revealField", () => {
  it("reveals nothing while unfocused", () => {
    expect(reveal(make(5)).spans).toEqual([])
  })

  it("reveals the cursor line when focused", () => {
    expect(reveal(focus(make(5))).spans).toEqual([[4, 7]])
  })

  it("reveals only the anchor and head lines", () => {
    expect(reveal(focus(make(1, 10))).spans).toEqual([[0, 3], [8, 13]])
  })

  it("keeps the identical object within one line", () => {
    const s = focus(make(5))
    expect(reveal(s.update({ selection: { anchor: 6 } }).state)).toBe(reveal(s))
  })

  it("freezes during pointer selection", () => {
    const frozen = focus(make(5)).update({ effects: setFrozen.of(true) }).state
    const dragged = frozen.update({ selection: { anchor: 16 }, userEvent: "select.pointer" }).state
    expect(reveal(dragged)).toMatchObject({ frozen: true, spans: [[4, 7]] })

    const keyed = dragged.update({ selection: { anchor: 16 }, userEvent: "select" }).state
    expect(reveal(keyed)).toMatchObject({ frozen: false, spans: [[14, 18]] })

    const typed = frozen.update({ changes: { from: 0, insert: "x" } }).state
    expect(reveal(typed)).toMatchObject({ frozen: false, spans: [[5, 8]] })
  })

  it("clears on blur", () => {
    const s = focus(make(5)).update({ effects: setFocused.of(false) }).state
    expect(reveal(s).spans).toEqual([])
  })

  it("answers line and range queries", () => {
    const s = focus(make(5))
    expect(isLineRevealed(s, 4)).toBe(true)
    expect(isLineRevealed(s, 7)).toBe(true)
    expect(isLineRevealed(s, 0)).toBe(false)
    expect(isLineRevealed(s, 8)).toBe(false)
    expect(isRangeRevealed(s, 0, 4)).toBe(true)
    expect(isRangeRevealed(s, 7, 10)).toBe(true)
    expect(isRangeRevealed(s, 0, 3)).toBe(false)
    expect(isRangeRevealed(s, 8, 13)).toBe(false)
    expect(isLineRevealed(mdState(DOC), 0)).toBe(false)
    expect(isRangeRevealed(mdState(DOC), 0, 3)).toBe(false)
  })
})

describe("pointer freeze", () => {
  it("freezes on mouse down and thaws after release", async () => {
    const view = mdView(DOC, [revealTracking, mdConfig.of({ revealDelay: 0 })], 5)
    const down = (pointerType: string) =>
      view.contentDOM.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType }))
    down("touch")
    expect(view.state.field(revealField).frozen).toBe(false)
    down("mouse")
    expect(view.state.field(revealField).frozen).toBe(true)
    window.dispatchEvent(new PointerEvent("pointerup", { pointerType: "mouse" }))
    await new Promise((r) => setTimeout(r, 20))
    expect(view.state.field(revealField).frozen).toBe(false)
    view.destroy()
  })
})
