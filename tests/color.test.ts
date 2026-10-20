import { describe, expect, it } from "vitest"
import { EditorSelection, EditorState } from "@codemirror/state"
import { setColor } from "../src/commands/index.ts"
import { setColorSpec } from "../src/commands/color.ts"
import type { MdColor } from "../src/options.ts"
import { mdState, nodes } from "./helpers.ts"

const R = '<span style="color:#e06c75">'
const B = '<span style="color:#61afef">'
const G = '<span style="color:#98c379">'
const E = "</span>"

function color(c: MdColor | null, doc: string, anchor: number, head = anchor): EditorState | null {
  const state = mdState(doc, { anchor, head })
  const spec = setColorSpec(c)(state)
  return spec ? state.update(spec).state : null
}

const at = (doc: string, part: string) => [doc.indexOf(part), doc.indexOf(part) + part.length] as const
const selected = (s: EditorState) => s.sliceDoc(s.selection.main.from, s.selection.main.to)

describe("setColor", () => {
  it("wraps with the legacy hex, clears on the same color, replaces on another", () => {
    const red = color("red", "word", 0, 4)!
    expect(red.doc.toString()).toBe(`${R}word${E}`)
    expect(selected(red)).toBe("word")
    const { from, to } = red.selection.main
    expect(color("red", red.doc.toString(), from, to)!.doc.toString()).toBe("word")
    expect(color("blue", red.doc.toString(), from, to)!.doc.toString()).toBe(`${B}word${E}`)
  })

  it("default color splits a span into balanced pieces", () => {
    const doc = `${R}abcdef${E}`
    expect(color(null, doc, ...at(doc, "cd"))!.doc.toString()).toBe(`${R}ab${E}cd${R}ef${E}`)
  })

  it("stays balanced across the end of a span", () => {
    const doc = `x ${R}abc${E}def`
    const out = color("blue", doc, doc.indexOf("abc") + 2, doc.indexOf("def") + 2)!.doc.toString()
    expect(out).toBe(`x ${R}ab${E}${B}cde${E}f`)
    const parsed = mdState(out)
    const marks = nodes(parsed).filter((n) => n.startsWith("ColorMark:"))
    const opens = marks.filter((n) => n.includes("<span")).length
    expect(opens).toBe(marks.length - opens)
    expect(marks.length).toBe((out.match(/<\/?span/g) ?? []).length)
  })

  it("flattens nested spans", () => {
    const doc = `${R}a${B}b${E}c${E}`
    expect(color("green", doc, ...at(doc, "b"))!.doc.toString()).toBe(`${R}a${E}${G}b${E}${R}c${E}`)
    expect(color("red", doc, 0, doc.length)!.doc.toString()).toBe(`${R}abc${E}`)
  })

  it("keeps an unknown span outside the range byte for byte", () => {
    const purple = '<span style="color: purple;">x</span>'
    const doc = `${purple} word`
    expect(color("red", doc, ...at(doc, "word"))!.doc.toString()).toBe(`${purple} ${R}word${E}`)
  })

  it("reads a named color as that color", () => {
    const doc = '<span style="color:red">x</span>'
    expect(color("red", doc, ...at(doc, "x"))!.doc.toString()).toBe("x")
  })

  it("writes one span per line with list markers outside", () => {
    expect(color("red", "- one\n- two", 0, 11)!.doc.toString()).toBe(`- ${R}one${E}\n- ${R}two${E}`)
  })

  it("colors the word under a bare cursor", () => {
    expect(color("green", "a word b", 4)!.doc.toString()).toBe(`a ${G}word${E} b`)
  })

  it("returns false for an empty selection with no word, or plain text and default color", () => {
    expect(setColor("red")({ state: mdState("a  b", { anchor: 2 }), dispatch: () => {} })).toBe(false)
    expect(setColor(null)({ state: mdState("word", { anchor: 0, head: 4 }), dispatch: () => {} })).toBe(false)
  })
})

describe("setColor guards", () => {
  it("leaves a span that crosses a line break alone", () => {
    const doc = `${R}ab\ncd${E}`
    expect(color("blue", doc, 0, doc.length)).toBeNull()
    expect(color("blue", doc, ...at(doc, "ab"))).toBeNull()
  })

  it("recolors a whole bold instead of splitting it", () => {
    const doc = "**a b** c"
    const out = color("red", doc, 4, 9)!.doc.toString()
    expect(out).toBe(`${R}**a b** c${E}`)
    expect(nodes(mdState(out))).toContain("StrongEmphasis:**a b**")
  })

  it("colors a word once for several cursors in it", () => {
    const state = mdState("word", { extensions: [EditorState.allowMultipleSelections.of(true)] })
      .update({ selection: EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(3)]) }).state
    expect(state.update(setColorSpec("red")(state)!).state.doc.toString()).toBe(`${R}word${E}`)
  })
})
