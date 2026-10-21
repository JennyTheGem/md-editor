import { pickedCompletion, snippet } from "@codemirror/autocomplete"
import type { Completion, CompletionContext, CompletionResult, CompletionSection } from "@codemirror/autocomplete"
import type { EditorState } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import { mdCommandSpecs } from "../commands/index.ts"
import type { SpecBuilder } from "../commands/index.ts"
import { isLiteralContext } from "../context.ts"
import { mdConfig, slashCommandsFacet } from "../options.ts"
import type { MdCommandName, MdSlashCommand } from "../options.ts"
import type { MdPhrase } from "../phrases.ts"

type BuiltinSection = "Blocks" | "Format" | "Insert"

interface Builtin {
  section: BuiltinSection
  id: string
  command: MdCommandName
  label: MdPhrase
  aliases: readonly string[]
}

function def(section: BuiltinSection, id: string, command: MdCommandName, label: MdPhrase, aliases: readonly string[] = []): Builtin {
  return { section, id, command, label, aliases }
}

const BUILTINS: readonly Builtin[] = [
  def("Blocks", "h1", "h1", "Heading 1", ["heading1"]),
  def("Blocks", "h2", "h2", "Heading 2", ["heading2"]),
  def("Blocks", "h3", "h3", "Heading 3", ["heading3"]),
  def("Blocks", "ul", "bulletList", "Bullet list", ["bullet", "list"]),
  def("Blocks", "ol", "orderedList", "Numbered list", ["numbered"]),
  def("Blocks", "todo", "taskList", "Task list", ["task", "checkbox"]),
  def("Blocks", "quote", "quote", "Quote", ["blockquote"]),
  def("Blocks", "callout", "callout", "Callout", ["note", "tip", "warning", "danger"]),
  def("Blocks", "code", "codeBlock", "Code block", ["codeblock", "fence"]),
  def("Blocks", "table", "table", "Table"),
  def("Blocks", "hr", "hr", "Divider", ["divider", "line"]),
  def("Format", "bold", "bold", "Bold", ["b"]),
  def("Format", "italic", "italic", "Italic", ["i"]),
  def("Format", "underline", "underline", "Underline", ["u"]),
  def("Format", "strike", "strike", "Strikethrough", ["s", "strikethrough"]),
  def("Format", "inlinecode", "inlineCode", "Inline code", ["mono"]),
  def("Format", "sup", "sup", "Superscript", ["superscript"]),
  def("Insert", "ts", "timestamp", "Timestamp", ["time", "timestamp"]),
  def("Insert", "link", "link", "Link", ["url"]),
  def("Insert", "date", "date", "Today's date", ["today"]),
]

type Section = CompletionSection & { rank: number }

interface Entry {
  id: string
  aliases: readonly string[]
  label: string
  block: boolean
  section: Section
  apply: (view: EditorView, completion: Completion, from: number, to: number) => void
}

// Removing "/query" and the command are one transaction, so one undo restores "/query"
function runSpec(view: EditorView, completion: Completion, from: number, to: number, build: SpecBuilder): void {
  const spec = build(view.state.update({ changes: { from, to } }).state)
  view.dispatch(view.state.update(
    { changes: { from, to }, userEvent: "input.complete", annotations: pickedCompletion.of(completion) },
    ...(spec ? [{ ...spec, sequential: true }] : []),
  ))
}

function applyHost(view: EditorView, completion: Completion, cmd: MdSlashCommand, from: number, to: number): void {
  if (typeof cmd.apply === "function") return cmd.apply(view, from, to)
  let text = cmd.apply
  if (cmd.block) {
    const doc = view.state.doc, n = doc.lineAt(from).number
    if (n > 1 && doc.line(n - 1).text.trim()) text = "\n" + text
    if (n < doc.lines && doc.line(n + 1).text.trim()) text += "\n"
  }
  snippet(text)(view, completion, from, to)
}

function timestampReady(state: EditorState): boolean {
  try {
    return Number.isFinite(state.facet(mdConfig).timestamps?.now())
  } catch {
    return false
  }
}

function entries(state: EditorState, atStart: boolean): Entry[] {
  // Shared per name, ranked by first appearance: Blocks 0, Format 1, Insert 2, host sections after
  const sections = new Map<string, Section>()
  const sectionOf = (name: string): Section => {
    let s = sections.get(name)
    if (!s) sections.set(name, s = { name, rank: sections.size })
    return s
  }
  sectionOf(state.phrase("Blocks"))
  sectionOf(state.phrase("Format"))
  const insert = sectionOf(state.phrase("Insert"))
  const out: Entry[] = []
  for (const b of BUILTINS) {
    if (b.command === "timestamp" && !timestampReady(state)) continue
    const build = mdCommandSpecs[b.command]
    out.push({
      id: b.id, aliases: b.aliases, label: state.phrase(b.label), block: b.section === "Blocks",
      section: sectionOf(state.phrase(b.section)),
      apply: (view, c, from, to) => runSpec(view, c, from, to, build),
    })
  }
  for (const cmd of state.facet(slashCommandsFacet)) {
    out.push({
      id: cmd.id, aliases: cmd.aliases ?? [], label: cmd.label, block: !!cmd.block,
      section: cmd.section ? sectionOf(cmd.section) : insert,
      apply: (view, c, from, to) => applyHost(view, c, cmd, from, to),
    })
  }
  return out.filter((e) => atStart || !e.block)
}

// Lower is better, -1 = no match
function score(e: Entry, q: string): number {
  if (!q) return 0
  const keys = [e.id, ...e.aliases].map((k) => k.toLowerCase())
  if (keys.includes(q)) return 0
  if (keys.some((k) => k.startsWith(q))) return 1
  const label = e.label.toLowerCase()
  if (label.split(/[\s-]+/).some((w) => w.startsWith(q))) return 2
  return label.includes(q) ? 3 : -1
}

export function slashSource(context: CompletionContext): CompletionResult | null {
  const m = context.matchBefore(/\/[\p{L}\p{N}_-]*$/u)
  if (!m) return null
  const { state } = context
  const before = state.sliceDoc(state.doc.lineAt(m.from).from, m.from)
  if (before && !/\s$/.test(before)) return null
  // m.from + 1: an indented CodeBlock starts at the '/' itself
  if (isLiteralContext(state, m.from) || isLiteralContext(state, m.from + 1)) return null
  const q = m.text.slice(1).toLowerCase()
  const ranked = entries(state, before.trim() === "")
    .map((e, i) => ({ e, i, s: score(e, q) }))
    .filter((r) => r.s >= 0)
    .sort((a, b) => a.s - b.s || (q ? 0 : a.e.section.rank - b.e.section.rank) || a.i - b.i)
  if (!ranked.length) return null
  return {
    from: m.from,
    filter: false,
    options: ranked.map(({ e }) => ({
      label: e.label,
      detail: "/" + e.id,
      type: "md-slash",
      apply: e.apply,
      section: q ? undefined : e.section,
    })),
  }
}
