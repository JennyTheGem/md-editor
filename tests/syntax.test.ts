import { describe, expect, it } from "vitest"
import { ensureSyntaxTree } from "@codemirror/language"
import { colorFromValue, colorOfOpenTag, colorOpenTag } from "../src/colors.ts"
import { isCodeContext, isLiteralContext } from "../src/context.ts"
import { mdState, nodes } from "./helpers.ts"

const names = (doc: string) => nodes(mdState(doc)).map((n) => n.slice(0, n.indexOf(":")))
const count = (doc: string, name: string) => names(doc).filter((n) => n === name).length

// Parent name of every node called `name`
function parents(doc: string, name: string): string[] {
  const state = mdState(doc)
  const out: string[] = []
  ensureSyntaxTree(state, state.doc.length, 5000)?.iterate({
    enter: (n) => {
      if (n.name === name) out.push(n.node.parent?.name ?? "")
    },
  })
  return out
}

const code = (doc: string, pos = doc.length) => isCodeContext(mdState(doc), pos)

describe("parser", () => {
  it("parses timestamps", () => {
    expect(count("a @[1:23] b @[1:02:03]", "Timestamp")).toBe(2)
    for (const doc of ["@[1:99]", "`@[1:23]`", "```\n@[1:23]\n```", "\\@[1:23]"]) expect(count(doc, "Timestamp")).toBe(0)
  })

  it("nests timestamps in links and table cells", () => {
    expect(parents("[see @[1:23]](https://x)", "Timestamp")).toEqual(["Link"])
    const table = "| t | b |\n| --- | --- |\n| @[0:05] | **x** |"
    expect(parents(table, "Timestamp")).toEqual(["TableCell"])
    expect(parents(table, "StrongEmphasis")).toEqual(["TableCell"])
  })

  it("parses underline and color spans", () => {
    expect(parents("<u>a **b**</u>", "StrongEmphasis")).toEqual(["Underline"])
    expect(count("<span style='color: blue;'>x</span>", "ColorText")).toBe(1)
    expect(() => names('<span style="color:#e06c75"></span>')).not.toThrow()
    expect(count("<u>unclosed", "Underline")).toBe(0)
  })

  it("parses superscript", () => {
    expect(count("x ^two words^ y", "Superscript")).toBe(1)
    expect(count("[^1] text [^2]", "Superscript")).toBe(0)
    expect(count("2^10 and 3^5", "Superscript")).toBe(0)
    expect(count("E=mc^2^", "Superscript")).toBe(1)
    expect(count("a^ b^", "Superscript")).toBe(0)
    expect(count("see [^a b^]", "Superscript")).toBe(0)
    expect(count("a^^b^^", "Superscript")).toBe(0)
  })

  it("keeps the dialect rules", () => {
    expect(count("text\n---", "HorizontalRule")).toBe(1)
    expect(count("text\n---", "SetextHeading2")).toBe(0)
    expect(count("1:23:45 :smile:", "Emoji")).toBe(0)
    expect(count("```c++\n# x\n", "FencedCode")).toBe(1)
    expect(count("```c++\n# x\n", "ATXHeading1")).toBe(0)
    expect(count("snake_case_name", "Emphasis")).toBe(0)
    expect(nodes(mdState("-  [ ] two"))).toContain("TaskMarker:[ ]")
  })
})

describe("context", () => {
  it("detects code", () => {
    expect(code("```\nabc\n```", 5)).toBe(true)
    expect(code("```js\nabc")).toBe(true)
    expect(code("a `xy` b", 4)).toBe(true)
    expect(code("para\n\n    code")).toBe(true)
  })

  it("does not flag text next to code", () => {
    expect(code("a `xy` b", 6)).toBe(false)
    expect(code("```\nabc\n```\nplain")).toBe(false)
    expect(code("```\nabc\n```\nplain", 12)).toBe(false)
    expect(code("hello world", 3)).toBe(false)
  })

  it("detects literal URLs", () => {
    const url = "see https://a.b"
    expect(isLiteralContext(mdState(url), url.length)).toBe(true)
    const link = "[t](https://a.b)"
    expect(isLiteralContext(mdState(link), link.length - 1)).toBe(true)
    expect(isLiteralContext(mdState("plain text"), 5)).toBe(false)
  })
})

describe("colors", () => {
  it("maps values through the allowlist", () => {
    expect(colorFromValue("#E06C75")).toBe("red")
    expect(colorFromValue(" blue ")).toBe("blue")
    expect(colorFromValue("#fff")).toBe(null)
    expect(colorFromValue("red;position:fixed")).toBe(null)
  })

  it("reads open tags", () => {
    expect(colorOfOpenTag('<span style="color:#61afef">')).toBe("blue")
    expect(colorOfOpenTag("<span style='color: #98c379'>")).toBe("green")
    expect(colorOfOpenTag('<span style="color:#e06c75;">')).toBe("red")
    expect(colorOfOpenTag("<SPAN style = ' color : Green ; ' >")).toBe("green")
    expect(colorOfOpenTag('<span style="color:#123456">')).toBe(null)
  })

  it("writes open tags", () => {
    expect(colorOpenTag("green")).toBe('<span style="color:#98c379">')
  })
})
