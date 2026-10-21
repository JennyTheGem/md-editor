import { afterEach, describe, expect, it, vi } from "vitest"
import { CompletionContext, completionStatus } from "@codemirror/autocomplete"
import type { Completion, CompletionResult } from "@codemirror/autocomplete"
import { defaultKeymap, history, undo } from "@codemirror/commands"
import type { LanguageSupport } from "@codemirror/language"
import { EditorSelection, EditorState } from "@codemirror/state"
import type { Extension } from "@codemirror/state"
import { EditorView, keymap, runScopeHandlers } from "@codemirror/view"
import { completion } from "../src/complete/completion.ts"
import { defaultEmojiLoader, emojiSource } from "../src/complete/emoji.ts"
import { slashSource } from "../src/complete/slash.ts"
import { mdConfig, slashCommandsFacet } from "../src/options.ts"
import type { MdSlashCommand } from "../src/options.ts"
import { createMarkdown } from "../src/syntax.ts"
import { mdState } from "./helpers.ts"

const host: readonly MdSlashCommand[] = [
  { id: "clip", label: "Clip", section: "Video", apply: "clip" },
  { id: "note", label: "Note", apply: "note" },
  { id: "sec", label: "Section", block: true, apply: "## S\n- ${}" },
]

function ctx(doc: string, pos = doc.length, now: () => number | null = () => 5): CompletionContext {
  const state = mdState(doc, {
    anchor: pos,
    extensions: [mdConfig.of({ timestamps: { now, seek() {} } }), slashCommandsFacet.of(host)],
  })
  return new CompletionContext(state, pos, false)
}

const slash = (doc: string, pos?: number) => slashSource(ctx(doc, pos))
const emoji = (doc: string, pos?: number) => emojiSource(defaultEmojiLoader)(ctx(doc, pos))
const labels = (r: CompletionResult | null) => r?.options.map((o) => o.label) ?? []
const sectionOf = (o: Completion) => (typeof o.section === "object" ? o.section : null)

describe("slash triggers", () => {
  it("opens at doc start, after a space and on an indented line", () => {
    expect(slash("/")).not.toBeNull()
    expect(slash("a /")).not.toBeNull()
    expect(labels(slash("  /"))).toContain("Heading 1")
  })

  it("stays closed mid-word, after punctuation and in code", () => {
    for (const doc of ["and/or", "1/2", "(/x"]) expect(slash(doc)).toBeNull()
    expect(slash("```\n/")).toBeNull()
    expect(slash("`a /x`", 5)).toBeNull()
  })
})

describe("slash listing and ranking", () => {
  it("lists every command in sections for a bare slash, host sections after Insert", () => {
    const r = slash("/")!
    expect(r.options).toHaveLength(20 + host.length)
    expect(r.options.every((o) => sectionOf(o))).toBe(true)
    const rank = (o: Completion) => Number(sectionOf(o)!.rank)
    const names = [...r.options].sort((a, b) => rank(a) - rank(b)).map((o) => sectionOf(o)!.name)
    expect(names.filter((n, i) => n !== names[i - 1])).toEqual(["Blocks", "Format", "Insert", "Video"])
    const byLabel = (l: string) => r.options.find((o) => o.label === l)!
    expect(sectionOf(byLabel("Note"))).toBe(sectionOf(byLabel("Link")))
  })

  it("ranks id and alias prefixes first and drops sections for a query", () => {
    const r = slash("/t")!
    expect(r.options.every((o) => !o.section)).toBe(true)
    expect(labels(r).slice(0, 4)).toEqual(expect.arrayContaining(["Task list", "Table", "Timestamp"]))
  })

  it("offers only inline commands mid-line", () => {
    const l = labels(slash("x /b"))
    expect(l).toContain("Bold")
    expect(l).not.toContain("Bullet list")
  })

  it("offers Timestamp only while now() is a number", () => {
    expect(labels(slashSource(ctx("/", 1, () => null)))).not.toContain("Timestamp")
    expect(labels(slashSource(new CompletionContext(mdState("/", { anchor: 1 }), 1, false)))).not.toContain("Timestamp")
  })
})

describe("slash apply", () => {
  const views: EditorView[] = []
  afterEach(() => views.splice(0).forEach((v) => v.destroy()))

  function pick(doc: string, id: string, md: LanguageSupport = createMarkdown([]), extra: readonly Extension[] = []): EditorView {
    const pos = doc.length
    const view = new EditorView({
      parent: document.body.appendChild(document.createElement("div")),
      state: EditorState.create({
        doc,
        selection: EditorSelection.cursor(pos),
        extensions: [md, history(), mdConfig.of({}), slashCommandsFacet.of(host), ...extra],
      }),
    })
    views.push(view)
    const r = slashSource(new CompletionContext(view.state, pos, false))!
    const option = r.options.find((o) => o.detail === "/" + id)!
    ;(option.apply as (v: EditorView, c: Completion, from: number, to: number) => void)(view, option, r.from, pos)
    return view
  }

  it("replaces /h1 with a heading, one undo restores /h1", () => {
    const view = pick("/h1", "h1")
    expect(view.state.doc.toString()).toBe("# ")
    undo(view)
    expect(view.state.doc.toString()).toBe("/h1")
  })

  it("inserts a divider with a blank line above", () => {
    expect(pick("text\n/hr", "hr").state.doc.toString()).toBe("text\n\n---\n")
  })

  it("puts a blank line before a block host template", () => {
    expect(pick("text\n/sec", "sec").state.doc.toString()).toBe("text\n\n## S\n- ")
  })

  it("keeps typing after a pick as its own undo step", () => {
    const md = createMarkdown([])
    const view = pick("text\n/sec", "sec", md, [completion(md.language, { slash: true, emoji: false })])
    view.dispatch({ changes: { from: view.state.doc.length, insert: "x" }, userEvent: "input.type" })
    undo(view)
    expect(view.state.doc.toString()).toBe("text\n\n## S\n- ")
    undo(view)
    expect(view.state.doc.toString()).toBe("text\n/sec")
  })

  it("registers one function per source on the markdown language", () => {
    const md = createMarkdown([])
    const state = EditorState.create({ doc: "x", extensions: [md, completion(md.language, { slash: true, emoji: true })] })
    const sources = state.languageDataAt<unknown>("autocomplete", 1)
    expect(sources).toHaveLength(2)
    expect(sources.every((s) => typeof s === "function")).toBe(true)
    expect(completion(md.language, { slash: false, emoji: false })).toEqual([])
  })
})

describe("emoji", () => {
  it("lists prefix matches", async () => {
    const l = labels(await emoji(" :ro"))
    for (const n of ["rocket", "rose", "rofl", "rolling_eyes", "robot"]) expect(l).toContain(":" + n)
  })

  it("stays closed after a word char, in code and when loading fails", async () => {
    for (const doc of ["Note:ok", "color:blue", "12:30"]) expect(await emoji(doc)).toBeNull()
    expect(await emoji("`:smile`", 7)).toBeNull()
    expect(await emoji("` :smile`", 8)).toBeNull()
    expect(await emojiSource(() => Promise.reject(new Error("offline")))(ctx(" :ro"))).toBeNull()
  })

  it("matches :+1 at line start", async () => {
    expect((await emoji(":+1"))!.options.some((o) => o.apply === "👍")).toBe(true)
  })

  it("lists a glyph once even when several names match", async () => {
    expect((await emoji(":check"))!.options.filter((o) => o.apply === "✅")).toHaveLength(1)
  })
})

describe("slash guards", () => {
  const views: EditorView[] = []
  afterEach(() => views.splice(0).forEach((v) => v.destroy()))

  it("stays closed mid-word for queries that match a command", () => {
    for (const doc of ["a/b", "w/i", "(/b", "x1/u"]) expect(slash(doc)).toBeNull()
    expect(slash("a /b")).not.toBeNull()
  })

  it("stays closed as the first char of an indented code line", async () => {
    expect(slash("text\n\n    /")).toBeNull()
    expect(await emoji("text\n\n    :smile")).toBeNull()
  })

  // Types the last char of doc, waits for the menu, presses Enter
  async function typed(doc: string): Promise<EditorView> {
    const md = createMarkdown([])
    const at = doc.length - 1
    const view = new EditorView({
      parent: document.body.appendChild(document.createElement("div")),
      state: EditorState.create({
        doc: doc.slice(0, at),
        selection: EditorSelection.cursor(at),
        extensions: [md, mdConfig.of({}), completion(md.language, { slash: true, emoji: false }), keymap.of(defaultKeymap)],
      }),
    })
    views.push(view)
    view.dispatch({ changes: { from: at, insert: doc[at] }, selection: { anchor: doc.length }, userEvent: "input.type" })
    await vi.waitFor(() => expect(completionStatus(view.state)).toBe("active"))
    // Past autocompletion's interactionDelay, so Enter can accept
    await new Promise((r) => setTimeout(r, 100))
    runScopeHandlers(view, new KeyboardEvent("keydown", { key: "Enter" }), "editor")
    return view
  }

  it("Enter on a bare slash is a newline, after a query it picks", async () => {
    expect((await typed("see /")).state.doc.toString()).toBe("see /\n")
    expect((await typed("see /b")).state.doc.toString()).toBe("see **text**")
  })
})
