import type { EditorState, Extension, Range } from "@codemirror/state"
import { Decoration, ViewPlugin, WidgetType } from "@codemirror/view"
import type { DecorationSet, EditorView, ViewUpdate } from "@codemirror/view"
import type { SyntaxNode } from "@lezer/common"
import { baseChanged, walk } from "./styles.ts"
import type { Span } from "./styles.ts"

const isList = (n: SyntaxNode): boolean => n.name === "BulletList" || n.name === "OrderedList"

export function countTasks(state: EditorState, node: SyntaxNode): { done: number; total: number } {
  let done = 0, total = 0
  node.toTree().iterate({
    enter: (n) => {
      if (n.name !== "TaskMarker") return
      total++
      if (/x/i.test(state.sliceDoc(node.from + n.from, node.from + n.to))) done++
    },
  })
  return { done, total }
}

class ProgressWidget extends WidgetType {
  readonly done: number
  readonly total: number
  readonly label: string

  constructor(done: number, total: number, label: string) {
    super()
    this.done = done
    this.total = total
    this.label = label
  }

  eq(other: ProgressWidget): boolean {
    return other.done === this.done && other.total === this.total && other.label === this.label
  }

  toDOM(): HTMLElement {
    const el = document.createElement("span")
    el.className = this.done === this.total ? "md-progress md-progress-done" : "md-progress"
    el.textContent = `${this.done}/${this.total}`
    el.setAttribute("aria-label", this.label)
    return el
  }
}

// A done count after the heading or text line right above a task list, and after a list item with subtasks
export function buildProgress(state: EditorState, ranges: readonly Span[]): DecorationSet {
  const out: Range<Decoration>[] = []
  const add = (at: number, lists: SyntaxNode[]) => {
    let done = 0, total = 0
    for (const l of lists) {
      const c = countTasks(state, l)
      done += c.done
      total += c.total
    }
    if (!total) return
    const widget = new ProgressWidget(done, total, state.phrase("$1 of $2 done", done, total))
    out.push(Decoration.widget({ widget, side: 1 }).range(at))
  }
  walk(state, ranges, (n, _range, fresh) => {
    if (!fresh) return
    if (isList(n.node)) {
      let prev = n.node.prevSibling
      while (prev?.name === "QuoteMark") prev = prev.prevSibling
      // Nested lists count on their item instead
      if (prev && n.node.parent?.name !== "ListItem" && (/^ATXHeading/.test(prev.name) || prev.name === "Paragraph")) add(prev.to, [n.node])
    } else if (n.name === "ListItem") {
      const lists = n.node.getChildren("BulletList").concat(n.node.getChildren("OrderedList"))
      const head = n.node.getChild("Task") ?? n.node.getChild("Paragraph")
      if (lists.length && head) add(head.to, lists)
    }
  })
  return Decoration.set(out, true)
}

class ProgressView {
  decorations: DecorationSet

  constructor(view: EditorView) {
    this.decorations = buildProgress(view.state, view.visibleRanges)
  }

  update(u: ViewUpdate) {
    if (baseChanged(u)) this.decorations = buildProgress(u.state, u.view.visibleRanges)
  }
}

export const progressPlugin: Extension = ViewPlugin.fromClass(ProgressView, { decorations: (v) => v.decorations })
