import { describe, expect, it } from "vitest"
import { buildProgress } from "../src/preview/progress.ts"
import { mdState } from "./helpers.ts"

function counts(doc: string): string[] {
  const state = mdState(doc)
  const out: string[] = []
  buildProgress(state, [{ from: 0, to: state.doc.length }]).between(0, state.doc.length, (from, _to, v) => {
    const el = (v.spec.widget as { toDOM(): HTMLElement }).toDOM()
    out.push(`${state.doc.lineAt(from).text}|${el.textContent}|${el.classList.contains("md-progress-done")}`)
  })
  return out
}

describe("checklist progress", () => {
  it("counts the list under a heading, nested tasks included", () => {
    expect(counts("## Warmup\n\n- [x] a\n- [ ] b\n    - [X] c\n\ntext")).toEqual([
      "## Warmup|2/3|false",
      "- [ ] b|1/1|true",
    ])
  })

  it("counts subtasks of a plain list item", () => {
    expect(counts("- Review\n    - [x] r1\n    - [ ] r2\n- Other")).toEqual(["- Review|1/2|false"])
  })

  it("counts the text line right above a task list", () => {
    expect(counts("Bring this:\n- [x] a\n- [x] b")).toEqual(["Bring this:|2/2|true"])
    expect(counts("> Quote:\n> - [ ] a")).toEqual(["> Quote:|0/1|false"])
  })

  it("skips lists without tasks and blocks not right above a list", () => {
    expect(counts("# A\n\n- a\n    - b\n\n# B\n\n```\nx\n```\n\n- [ ] c")).toEqual([])
  })
})
