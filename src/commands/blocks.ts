import { indentMore } from "@codemirror/commands"
import { EditorSelection } from "@codemirror/state"
import type { ChangeSpec, Line, StateCommand } from "@codemirror/state"
import { INLINE_FORMATS, toggleInline } from "./inline.ts"
import { CONTAINER_RE, ancestor, blockInsert, enclosing, formatSpec, fullTree, inCode, inCodeLine, isBlank, rangeLines, tableAt, touchedLines } from "./util.ts"
import type { SpecBuilder } from "./util.ts"

export function toggleHeadingSpec(level: 1 | 2 | 3 | 4 | 5 | 6): SpecBuilder {
  return (state) => {
    const hashes = "#".repeat(level) + " "
    const lines = touchedLines(state).filter((l) => !inCodeLine(state, l) && !tableAt(state, l))
    const found = lines.map((line) => {
      const p = CONTAINER_RE.exec(line.text)![0].length
      return { at: line.from + p, m: /^(#{1,6})(?:[ \t]+|$)/.exec(line.text.slice(p)) }
    })
    // Removes only when every line already has this level, like the list toggles
    const all = found.every((f) => f.m?.[1].length === level)
    const changes: ChangeSpec[] = []
    for (const { at, m } of found) {
      if (!m) changes.push({ from: at, insert: hashes })
      else if (all || m[1].length !== level) changes.push({ from: at, to: at + m[0].length, insert: all ? "" : hashes })
    }
    if (!changes.length) return null
    const cs = state.changes(changes)
    return formatSpec({ changes: cs, selection: state.selection.map(cs, 1) })
  }
}

type PrefixKind = "bullet" | "ordered" | "task" | "quote"
type ListKind = Exclude<PrefixKind, "quote">

const LIST_RES: Record<ListKind, RegExp> = {
  task: /^([ \t]*)[-*+][ \t]+\[[ xX]\](?:[ \t]+|$)/,
  bullet: /^([ \t]*)[-*+][ \t]+(?![ \t]*\[[ xX]\](?:[ \t]|$))/,
  ordered: /^([ \t]*)\d{1,9}[.)][ \t]+/,
}
const QUOTE_RE = /^>[ \t]?/
// Quote markers stay in front of a list prefix
const QUOTED_RE = /^(?:[ \t]*>[ \t]?)*/

function listPrefix(line: Line): { at: number; kind: ListKind | null; indent: number; len: number } {
  const q = QUOTED_RE.exec(line.text)![0].length
  const rest = line.text.slice(q)
  for (const kind of ["task", "bullet", "ordered"] as const) {
    const m = LIST_RES[kind].exec(rest)
    if (m) return { at: line.from + q, kind, indent: m[1].length, len: m[0].length }
  }
  const indent = /^[ \t]*/.exec(rest)![0].length
  return { at: line.from + q, kind: null, indent, len: indent }
}

export function toggleLinePrefixSpec(kind: PrefixKind): SpecBuilder {
  return (state) => {
    const lines = touchedLines(state).filter((l) => !inCodeLine(state, l))
    const filled = lines.filter((l) => !isBlank(l.text))
    const targets = filled.length ? filled : lines
    if (!targets.length) return null
    const changes: ChangeSpec[] = []
    if (kind === "quote") {
      const all = targets.every((l) => QUOTE_RE.test(l.text))
      for (const l of targets) {
        if (all) changes.push({ from: l.from, to: l.from + QUOTE_RE.exec(l.text)![0].length })
        else if (!QUOTE_RE.test(l.text)) changes.push({ from: l.from, insert: "> " })
      }
    } else {
      const found = targets.map(listPrefix)
      const all = found.every((f) => f.kind === kind)
      found.forEach((f, i) => {
        const from = f.at + f.indent, to = f.at + f.len
        if (all) changes.push({ from, to })
        // Keeps a task's checked state; ordered lines get renumbered
        else if (f.kind !== kind || kind === "ordered") {
          const insert = kind === "bullet" ? "- " : kind === "task" ? "- [ ] " : `${i + 1}. `
          if (state.sliceDoc(from, to) !== insert) changes.push({ from, to, insert })
        }
      })
    }
    if (!changes.length) return null
    const cs = state.changes(changes)
    return formatSpec({ changes: cs, selection: state.selection.map(cs, 1) })
  }
}

export const insertHrSpec: SpecBuilder = (state) => blockInsert(state, "---\n", 4, 4)

// "note" selected, so typing picks the type
export const insertCalloutSpec: SpecBuilder = (state) => blockInsert(state, "> [!note] ", 4, 8)

export const insertCodeBlockSpec: SpecBuilder = (state) => {
  const { from, to, empty } = state.selection.main
  const lines = rangeLines(state, from, to)
  if (lines.some((l) => inCodeLine(state, l))) return null
  if (empty) return blockInsert(state, "```\n\n```", 4, 4)
  // A selection is moved into the fence, never copied
  const doc = state.doc
  const first = lines[0], last = lines[lines.length - 1]
  const prev = first.number > 1 ? doc.line(first.number - 1) : null
  const next = last.number < doc.lines ? doc.line(last.number + 1) : null
  const prefix = prev && !isBlank(prev.text) ? "\n" : ""
  const suffix = next && !isBlank(next.text) ? "\n" : ""
  return formatSpec({
    changes: { from: first.from, to: last.to, insert: `${prefix}\`\`\`\n${state.sliceDoc(first.from, last.to)}\n\`\`\`${suffix}` },
    selection: EditorSelection.cursor(first.from + prefix.length + 3),
  })
}

export const codeSpec: SpecBuilder = (state) => {
  const { from, to, empty } = state.selection.main
  const inline = empty ? !!enclosing(state, from, to, "InlineCode") : state.doc.lineAt(from).number === state.doc.lineAt(to).number
  return inline ? toggleInline(INLINE_FORMATS.inlineCode)(state) : insertCodeBlockSpec(state)
}

const URL_RE = /^(https?:\/\/|mailto:)\S+$/

export const insertLinkSpec: SpecBuilder = (state) => {
  const { from, to, empty } = state.selection.main
  const sel = state.sliceDoc(from, to)
  if (sel.includes("\n") || inCode(state, from) || inCode(state, to)) return null
  const label = state.phrase("Link text")
  let insert: string, a: number, b: number
  if (URL_RE.test(sel)) {
    insert = `[${label}](${sel})`
    a = from + 1
    b = a + label.length
  } else if (!empty) {
    insert = `[${sel}](https://)`
    a = from + sel.length + 3
    b = a + "https://".length
  } else {
    insert = `[${label}](https://)`
    a = from + 1
    b = a + label.length
  }
  return formatSpec({ changes: { from, to, insert }, selection: EditorSelection.single(a, b) })
}

export const insertTableSpec: SpecBuilder = (state) => {
  const c = state.phrase("Column")
  return blockInsert(state, `| ${c} 1 | ${c} 2 |\n| --- | --- |\n|  |  |`, 2, 2 + c.length + 2)
}

const pad2 = (n: number) => String(n).padStart(2, "0")

// Local date, never toISOString (UTC)
export const insertDateSpec: SpecBuilder = (state) => {
  const d = new Date()
  return formatSpec(state.replaceSelection(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`))
}

export const insertTab: StateCommand = (target) => {
  const { state, dispatch } = target
  const head = state.selection.main.head
  const tree = fullTree(state)
  const inList = ancestor(tree.resolveInner(head, -1), ["ListItem"]) || ancestor(tree.resolveInner(head, 1), ["ListItem"])
  if (inList || state.selection.ranges.some((r) => !r.empty)) return indentMore(target)
  dispatch(state.update(state.replaceSelection("    "), { userEvent: "input.type", scrollIntoView: true }))
  return true
}
