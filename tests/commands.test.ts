import { describe, expect, it } from "vitest"
import { history, undo } from "@codemirror/commands"
import { indentUnit } from "@codemirror/language"
import { EditorSelection, EditorState } from "@codemirror/state"
import type { Extension, Transaction } from "@codemirror/state"
import { insertTab } from "../src/commands/blocks.ts"
import { mdCommandSpecs, mdCommands } from "../src/commands/index.ts"
import { mdConfig } from "../src/options.ts"
import type { MdCommandName } from "../src/options.ts"
import { mdState, nodes } from "./helpers.ts"

const cfg = mdConfig.of({ timestamps: { now: () => 3725, seek() {} } })

function make(doc: string, anchor = 0, head = anchor, extra: readonly Extension[] = []): EditorState {
  return mdState(doc, { anchor, head, extensions: [cfg, ...extra] })
}

function apply(name: MdCommandName, state: EditorState): EditorState | null {
  const spec = mdCommandSpecs[name](state)
  return spec ? state.update(spec).state : null
}

const run = (name: MdCommandName, doc: string, anchor = 0, head = anchor) => apply(name, make(doc, anchor, head))
const selected = (s: EditorState) => s.sliceDoc(s.selection.main.from, s.selection.main.to)

describe("bold and italic", () => {
  it("wraps a selection and unwraps it again, keeping the inner selection", () => {
    const s = run("bold", "word", 0, 4)!
    expect(s.doc.toString()).toBe("**word**")
    expect(selected(s)).toBe("word")
    const back = apply("bold", s)!
    expect(back.doc.toString()).toBe("word")
    expect(selected(back)).toBe("word")
  })

  it("unwraps when the markers are selected too", () => {
    expect(run("bold", "**word**", 0, 8)!.doc.toString()).toBe("word")
  })

  it("wraps the word under a bare cursor and keeps the cursor on its char", () => {
    const s = run("bold", "word", 2)!
    expect(s.doc.toString()).toBe("**word**")
    expect(s.selection.main.head).toBe(4)
    expect(s.selection.main.empty).toBe(true)
  })

  it("inserts a selected placeholder when no word is under the cursor", () => {
    const s = run("bold", "", 0)!
    expect(s.doc.toString()).toBe("**text**")
    expect(selected(s)).toBe("text")
    expect(run("bold", "word", 4)!.doc.toString()).toBe("word**text**")
  })

  it("italic inside bold gives ***word***", () => {
    const s = run("italic", "**word**", 2, 6)!
    expect(s.doc.toString()).toBe("***word***")
    const names = nodes(s).map((n) => n.split(":")[0])
    expect(names).toContain("Emphasis")
    expect(names).toContain("StrongEmphasis")
  })

  it("italic on a fully selected bold word does not strip half its marker", () => {
    expect(run("italic", "**word**", 0, 8)!.doc.toString()).toBe("***word***")
  })

  it("merges inner bold into one outer pair", () => {
    const s = run("bold", "a **b** c", 0, 9)!
    expect(s.doc.toString()).toBe("**a b c**")
    expect(selected(s)).toBe("a b c")
  })

  it("never piles up markers next to the same format", () => {
    expect(run("bold", "a**b**", 0, 1)!.doc.toString()).toBe("**ab**")
    expect(run("bold", "x\n\n**b**", 0, 7)!.doc.toString()).toBe("**x**\n\n**b**")
    expect(mdCommandSpecs.bold(make("**word**", 8))).toBeNull()
  })

  it("wraps per line and keeps list markers outside", () => {
    expect(run("bold", "- one\n- two", 0, 11)!.doc.toString()).toBe("- **one**\n- **two**")
  })

  it("wraps table cells, never the pipes", () => {
    expect(run("bold", "| a | b |\n| --- | --- |", 0, 9)!.doc.toString()).toBe("| **a** | **b** |\n| --- | --- |")
  })

  it("does nothing in code", () => {
    expect(mdCommandSpecs.bold(make("a `code` b", 4))).toBeNull()
    expect(mdCommandSpecs.inlineCode(make("```\ncode\n```", 6))).toBeNull()
    expect(mdCommandSpecs.bold(make("```\ncode\n```", 4, 8))).toBeNull()
    expect(mdCommandSpecs.bold(make("```\n**x**\n```", 4, 9))).toBeNull()
    expect(mdCommandSpecs.bold(make("```\ncode\n```", 0))).toBeNull()
  })

  it("keeps the heading marker outside", () => {
    expect(run("bold", "# Title", 0, 7)!.doc.toString()).toBe("# **Title**")
  })
})

describe("headings", () => {
  it("toggles and switches levels", () => {
    expect(run("h1", "#tag", 0)!.doc.toString()).toBe("# #tag")
    expect(run("h2", "## x", 4)!.doc.toString()).toBe("x")
    expect(run("h1", "## x", 4)!.doc.toString()).toBe("# x")
  })

  it("prefixes every touched line, after list markers", () => {
    expect(run("h2", "a\nb\nc", 0, 5)!.doc.toString()).toBe("## a\n## b\n## c")
    expect(run("h2", "- item", 3)!.doc.toString()).toBe("- ## item")
  })

  it("leaves fence lines alone and keeps the cursor column", () => {
    expect(mdCommandSpecs.h1(make("```\ncode\n```", 5))).toBeNull()
    expect(run("h1", "text\n```\ncode\n```", 0, 13)!.doc.toString()).toBe("# text\n```\ncode\n```")
    const s = run("h1", "hello", 3)!
    expect(s.doc.toString()).toBe("# hello")
    expect(s.sliceDoc(s.selection.main.head)).toBe("lo")
  })
})

describe("blocks", () => {
  it("inserts a rule with a blank-line guard and no setext heading", () => {
    const s = run("hr", "text", 4)!
    expect(s.doc.toString()).toBe("text\n\n---\n")
    expect(s.selection.main.head).toBe(10)
    expect(nodes(s)).toContain("HorizontalRule:---")
    expect(nodes(s).some((n) => n.startsWith("SetextHeading"))).toBe(false)
  })

  it("puts one blank line on each side between paragraphs", () => {
    expect(run("hr", "a\n\nb", 1)!.doc.toString()).toBe("a\n\n---\n\nb")
    expect(run("hr", "a\n\nb", 2)!.doc.toString()).toBe("a\n\n---\n\nb")
    expect(run("hr", "a\nb", 1)!.doc.toString()).toBe("a\n\n---\n\nb")
  })

  it("code: inline for a one-line selection, a fence otherwise", () => {
    expect(run("code", "abc", 0, 3)!.doc.toString()).toBe("`abc`")
    const empty = run("code", "", 0)!
    expect(empty.doc.toString()).toBe("```\n\n```")
    expect(empty.doc.lineAt(empty.selection.main.head).number).toBe(2)
    const multi = run("code", "a\nb", 0, 3)!
    expect(multi.doc.toString()).toBe("```\na\nb\n```")
    expect(multi.selection.main.head).toBe(3)
    expect(run("code", "x `abc` y", 4)!.doc.toString()).toBe("x abc y")
    expect(mdCommandSpecs.codeBlock(make("```\ncode\n```", 5))).toBeNull()
  })

  it("code block moves a one-line selection into the fence", () => {
    expect(run("codeBlock", "p\nabc\nq", 2, 5)!.doc.toString()).toBe("p\n\n```\nabc\n```\n\nq")
  })

  it("link: url, text and empty", () => {
    const url = run("link", "https://a.b", 0, 11)!
    expect(url.doc.toString()).toBe("[Link text](https://a.b)")
    expect(selected(url)).toBe("Link text")
    const text = run("link", "site", 0, 4)!
    expect(text.doc.toString()).toBe("[site](https://)")
    expect(selected(text)).toBe("https://")
    const empty = run("link", "", 0)!
    expect(empty.doc.toString()).toBe("[Link text](https://)")
    expect(selected(empty)).toBe("Link text")
    expect(mdCommandSpecs.link(make("a\nb", 0, 3))).toBeNull()
  })

  it("toggles lists and quotes on two lines", () => {
    const on = run("bulletList", "a\nb", 0, 3)!
    expect(on.doc.toString()).toBe("- a\n- b")
    expect(apply("bulletList", on)!.doc.toString()).toBe("a\nb")
    expect(run("orderedList", "a\nb", 0, 3)!.doc.toString()).toBe("1. a\n2. b")
    expect(run("orderedList", "1. a\n2. b", 0, 9)!.doc.toString()).toBe("a\nb")
    expect(run("taskList", "- a\nb", 0, 5)!.doc.toString()).toBe("- [ ] a\n- [ ] b")
    expect(run("taskList", "- [x] a\nb", 0, 9)!.doc.toString()).toBe("- [x] a\n- [ ] b")
    const quote = run("quote", "a\nb", 0, 3)!
    expect(quote.doc.toString()).toBe("> a\n> b")
    expect(apply("quote", quote)!.doc.toString()).toBe("a\nb")
    expect(run("bulletList", "> - item", 8)!.doc.toString()).toBe("> item")
  })

  it("inserts a table under text with Column 1 selected", () => {
    const s = run("table", "text", 4)!
    expect(s.doc.toString()).toBe("text\n\n| Column 1 | Column 2 |\n| --- | --- |\n|  |  |")
    expect(selected(s)).toBe("Column 1")
  })

  it("inserts a callout under text with its type selected", () => {
    const s = run("callout", "text", 4)!
    expect(s.doc.toString()).toBe("text\n\n> [!note] ")
    expect(selected(s)).toBe("note")
  })

  it("inserts the local date", () => {
    const s = run("date", "", 0)!
    const d = new Date()
    const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    expect(s.doc.toString()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(s.doc.toString()).toBe(local)
  })

  it("Tab inserts 4 spaces at a bare cursor and indents selected lines", () => {
    const tab = (state: EditorState) => {
      let out = state
      insertTab({ state, dispatch: (tr: Transaction) => { out = tr.state } })
      return out.doc.toString()
    }
    const unit = [indentUnit.of("    ")]
    expect(tab(make("ab", 1, 1, unit))).toBe("a    b")
    expect(tab(make("a\nb", 0, 3, unit))).toBe("    a\n    b")
    expect(tab(make("- a\n- b", 7, 7, unit))).toBe("- a\n    - b")
  })
})

describe("timestamp", () => {
  it("replaces the selection with the current time", () => {
    expect(run("timestamp", "xx", 0, 2)!.doc.toString()).toBe("@[1:02:05]")
  })

  it("returns false when nothing is loaded", () => {
    const state = mdState("", { extensions: [mdConfig.of({ timestamps: { now: () => null, seek() {} } })] })
    expect(mdCommands.timestamp({ state, dispatch: () => {} })).toBe(false)
    expect(mdCommands.timestamp({ state: mdState(""), dispatch: () => {} })).toBe(false)
  })
})

describe("history", () => {
  it("tags every command transaction with a user event", () => {
    const names = Object.keys(mdCommandSpecs) as MdCommandName[]
    const red = '<span style="color:#e06c75">word</span>'
    for (const name of names) {
      const trs: Transaction[] = []
      const dispatch = (tr: Transaction) => { trs.push(tr) }
      const ok = mdCommands[name]({ state: make("word", 0, 4), dispatch }) || mdCommands[name]({ state: make(red, 28, 32), dispatch })
      expect(ok, name).toBe(true)
      expect(trs[0].isUserEvent("input.format") || trs[0].isUserEvent("input.timestamp"), name).toBe(true)
    }
  })

  it("undoes text typed after a format separately", () => {
    const s1 = apply("bold", make("", 0, 0, [history()]))!
    const s2 = s1.update({ changes: { from: 2, to: 6, insert: "hi" }, userEvent: "input.type" }).state
    expect(s2.doc.toString()).toBe("**hi**")
    let s3 = s2
    undo({ state: s2, dispatch: (tr) => { s3 = tr.state } })
    expect(s3.doc.toString()).toBe("**text**")
  })
})

describe("inline nesting guards", () => {
  it("merges a cursor word with the same format right next to it", () => {
    const s = run("bold", "foo**bar**", 1)!
    expect(s.doc.toString()).toBe("**foobar**")
    expect(s.selection.main.head).toBe(3)
    expect(run("strike", "foo~~bar~~", 1)!.doc.toString()).toBe("~~foobar~~")
    expect(run("italic", "foo*bar*", 1)!.doc.toString()).toBe("*foobar*")
    expect(run("bold", "wo**rd**", 1)!.doc.toString()).toBe("**word**")
  })

  it("never splits a timestamp around the cursor word", () => {
    expect(run("bold", "at @[1:23] x", 8)!.doc.toString()).toBe("at **@[1:23]** x")
  })

  it("unbolds every line of a multi-line selection", () => {
    expect(run("bold", "- **one**\n- **two**", 0, 19)!.doc.toString()).toBe("- one\n- two")
  })

  it("does nothing when the parser could not read the result back", () => {
    expect(mdCommandSpecs.sup(make("abc", 1, 2))).toBeNull()
    expect(run("sup", "x2 y", 1, 2)!.doc.toString()).toBe("x^2^ y")
    expect(mdCommandSpecs.inlineCode(make("a`b c", 0, 3))).toBeNull()
  })

  it("keeps the placeholder after list and heading markers", () => {
    expect(run("bold", "- a", 0)!.doc.toString()).toBe("- **text**a")
    expect(run("bold", "# a", 0)!.doc.toString()).toBe("# **text**a")
  })

  it("wraps a word once for several cursors in it", () => {
    const state = make("word", 0, 0, [EditorState.allowMultipleSelections.of(true)])
      .update({ selection: EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(3)]) }).state
    expect(apply("bold", state)!.doc.toString()).toBe("**word**")
  })
})

describe("heading toggle on mixed lines", () => {
  it("sets the level on every line unless all have it", () => {
    expect(run("h1", "# a\nb", 0, 5)!.doc.toString()).toBe("# a\n# b")
    expect(run("h1", "# a\n# b", 0, 7)!.doc.toString()).toBe("a\nb")
  })

  it("leaves table rows alone", () => {
    expect(mdCommandSpecs.h1(make("| a | b |\n| - | - |\n| c | d |", 2))).toBeNull()
  })
})
