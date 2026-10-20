import { EditorState, Prec } from "@codemirror/state"
import type { Extension, Range } from "@codemirror/state"
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap } from "@codemirror/view"
import type { Command, DecorationSet, ViewUpdate } from "@codemirror/view"
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language"
import { isolateHistory } from "@codemirror/commands"
import type { SyntaxNode } from "@lezer/common"
import { isLiteralContext } from "../context.ts"
import { mdConfig } from "../options.ts"
import { formatTimestamp, parseTimestamp } from "./format.ts"
import { createPillDom } from "./pillDom.ts"

class PillWidget extends WidgetType {
  readonly time: string
  readonly label: string
  readonly icon: string | undefined

  constructor(time: string, label: string, icon: string | undefined) {
    super()
    this.time = time
    this.label = label
    this.icon = icon
  }

  eq(other: PillWidget): boolean {
    return other.time === this.time && other.label === this.label && other.icon === this.icon
  }

  toDOM(): HTMLElement {
    return createPillDom(this.time, this.label, this.icon)
  }

  ignoreEvent(): boolean {
    return false
  }
}

function buildPills(state: EditorState, ranges: readonly { from: number; to: number }[]): DecorationSet {
  const cfg = state.facet(mdConfig)
  if (!cfg.timestamps) return Decoration.none
  const heads = state.selection.ranges.map((r) => r.head)
  const tree = syntaxTree(state)
  const out: Range<Decoration>[] = []
  let last = -1
  for (const { from, to } of ranges) {
    tree.iterate({
      from, to,
      enter: (n) => {
        if (n.name !== "Timestamp" || n.from < last) return
        last = n.to
        // Leave it editable while a head sits strictly inside
        if (heads.some((h) => n.from < h && h < n.to)) return
        const time = state.sliceDoc(n.from + 2, n.to - 1)
        const widget = new PillWidget(time, state.phrase("Jump to $1", time), cfg.icons.timestamp)
        out.push(Decoration.replace({ widget }).range(n.from, n.to))
      },
    })
  }
  return Decoration.set(out, true)
}

const pillsPlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet

  constructor(view: EditorView) {
    this.decorations = buildPills(view.state, view.visibleRanges)
  }

  update(u: ViewUpdate) {
    if (u.docChanged || u.viewportChanged || u.selectionSet || syntaxTree(u.startState) !== syntaxTree(u.state)
      || u.startState.facet(EditorState.phrases) !== u.state.facet(EditorState.phrases)) {
      this.decorations = buildPills(u.state, u.view.visibleRanges)
    }
  }
}, {
  decorations: (v) => v.decorations,
  provide: (p) => EditorView.atomicRanges.of((view) => view.plugin(p)?.decorations ?? Decoration.none),
})

const pillClicks = Prec.high(EditorView.domEventHandlers({
  mousedown(e, view) {
    const el = e.target instanceof Element ? e.target.closest(".md-ts") : null
    if (!el || e.button !== 0) return false
    e.preventDefault()
    const s = Number.parseFloat(el.getAttribute("data-seconds") ?? "")
    if (Number.isFinite(s)) view.state.facet(mdConfig).timestamps?.seek(s)
    return true
  },
}))

const HEADING_PREFIX_RE = /^[ \t]{0,3}(?:>[ \t]?)*[ \t]*#{1,6}$/
const WORD_END_RE = /[\\\p{L}\p{M}\p{N}_]$/u

export function shouldInsertTimestamp(state: EditorState, from: number, to: number, text: string, trigger: string): boolean {
  if (!trigger || state.readOnly || state.selection.ranges.length !== 1) return false
  const prefix = text.slice(0, -trigger.length)
  // A longer text is an IME/Android composition commit ending in the trigger
  const committed = text.length > trigger.length && text.endsWith(trigger) && state.sliceDoc(from, to) === prefix
  if (text !== trigger && !committed) return false
  const before = state.sliceDoc(state.doc.lineAt(from).from, from) + prefix
  if (WORD_END_RE.test(before) || HEADING_PREFIX_RE.test(before)) return false
  return !isLiteralContext(state, from)
}

const triggerHandler = EditorView.inputHandler.of((view, from, to, text, insert) => {
  const t = view.state.facet(mdConfig).timestamps
  const trig = t?.trigger ?? "#"
  if (!t || trig === false || !shouldInsertTimestamp(view.state, from, to, text, trig)) return false
  let s: number | null
  try {
    s = t.now()
  } catch {
    s = null
  }
  if (typeof s !== "number" || !Number.isFinite(s)) return false
  view.dispatch(insert())
  const head = view.state.selection.main.head
  const start = head - trig.length
  if (start < 0 || view.state.sliceDoc(start, head) !== trig) return true
  const ins = formatTimestamp(s)
  view.dispatch({
    changes: { from: start, to: head, insert: ins },
    selection: { anchor: start + ins.length },
    userEvent: "input.timestamp",
    annotations: isolateHistory.of("full"),
    scrollIntoView: true,
  })
  return true
})

function timestampAt(state: EditorState, pos: number, side: -1 | 1): SyntaxNode | null {
  for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, side); n; n = n.parent) {
    if (n.name === "Timestamp") return n
  }
  return null
}

export const seekAtCursor: Command = (view) => {
  const t = view.state.facet(mdConfig).timestamps
  const head = view.state.selection.main.head
  const node = timestampAt(view.state, head, -1) ?? timestampAt(view.state, head, 1)
  if (!t || !node) return false
  const s = parseTimestamp(view.state.sliceDoc(node.from, node.to))
  if (s === null) return false
  t.seek(s)
  return true
}

export interface MdTimestamp { from: number; to: number; text: string; seconds: number; line: number }

export function extractTimestamps(state: EditorState): MdTimestamp[] {
  const tree = ensureSyntaxTree(state, state.doc.length, 200) ?? syntaxTree(state)
  const out: MdTimestamp[] = []
  tree.iterate({
    enter: (n) => {
      if (n.name !== "Timestamp") return
      const seconds = parseTimestamp(state.sliceDoc(n.from, n.to))
      if (seconds === null) return
      out.push({ from: n.from, to: n.to, text: state.sliceDoc(n.from + 2, n.to - 1), seconds, line: state.doc.lineAt(n.from).number })
    },
  })
  return out
}

const extension: Extension = [
  pillsPlugin,
  pillClicks,
  triggerHandler,
  Prec.high(keymap.of([{ key: "Mod-Enter", run: seekAtCursor }])),
]

export function timestamps(): Extension {
  return extension
}
