import { syntaxTree } from "@codemirror/language"
import type { EditorState, Extension } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import type { Command, KeyBinding } from "@codemirror/view"
import type { SyntaxNode } from "@lezer/common"
import { mdConfig } from "../options.ts"
import { setIcon } from "./widgets.ts"

function firstMarker(state: EditorState, from: number, to: number, at?: number): SyntaxNode | null {
  let found: SyntaxNode | null = null
  syntaxTree(state).iterate({
    from,
    to,
    enter: (n) => {
      if (found) return false
      if (n.name === "TaskMarker" && (at === undefined || n.from === at)) found = n.node
    },
  })
  return found
}

// Re-reads the marker text so a stale position never corrupts the line
function toggle(view: EditorView, marker: SyntaxNode | null): boolean {
  if (!marker || view.state.readOnly) return false
  const text = view.state.sliceDoc(marker.from, marker.to)
  if (!/^\[[ xX]\]$/.test(text)) return false
  view.dispatch({
    changes: { from: marker.from + 1, to: marker.from + 2, insert: /x/i.test(text) ? " " : "x" },
    userEvent: "input.toggle",
  })
  return true
}

export function toggleTaskAt(view: EditorView, pos: number): boolean {
  if (view.state.readOnly) return false
  return toggle(view, firstMarker(view.state, pos, Math.min(pos + 3, view.state.doc.length), pos))
}

const toggleTaskAtCursor: Command = (view) => {
  const line = view.state.doc.lineAt(view.state.selection.main.head)
  return toggle(view, firstMarker(view.state, line.from, line.to))
}

export const taskKeymap: readonly KeyBinding[] = [{ key: "Mod-Enter", run: toggleTaskAtCursor }]

function climb(state: EditorState, pos: number, sides: readonly (-1 | 1)[], match: (n: SyntaxNode) => boolean): SyntaxNode | null {
  const tree = syntaxTree(state)
  for (const side of sides) {
    for (let n: SyntaxNode | null = tree.resolveInner(pos, side); n; n = n.parent) if (match(n)) return n
  }
  return null
}

const timers = new WeakMap<HTMLElement, number>()

function copy(view: EditorView, btn: HTMLElement): void {
  const { state } = view
  const fence = climb(state, view.posAtDOM(btn), [-1, 1], (n) => n.name === "FencedCode")
  const code = fence ? fence.getChildren("CodeText").map((c) => state.sliceDoc(c.from, c.to)).join("").replace(/\n$/, "") : ""
  const win = view.dom.ownerDocument.defaultView ?? window

  const show = (result?: "copied" | "failed") => {
    const label = view.state.phrase(result === "copied" ? "Copied" : result === "failed" ? "Copy failed" : "Copy code")
    if (result) btn.dataset.state = result
    else delete btn.dataset.state
    btn.setAttribute("aria-label", label)
    btn.title = label
    const { icons } = view.state.facet(mdConfig)
    const icon = btn.querySelector<HTMLElement>(".md-icon")
    const url = result === "copied" ? icons.copied ?? icons.copy : icons.copy
    if (!icon) btn.textContent = label
    else if (url) setIcon(icon, url)
  }
  const done = (ok: boolean) => {
    show(ok ? "copied" : "failed")
    win.clearTimeout(timers.get(btn))
    timers.set(btn, win.setTimeout(() => show(), 1500))
  }

  try {
    const clipboard = win.navigator.clipboard as Clipboard | undefined
    if (clipboard?.writeText) clipboard.writeText(code).then(() => done(true), () => done(false))
    else done(false)
  } catch {
    done(false)
  }
}

function linkUrlAt(state: EditorState, pos: number): string | null {
  const node = climb(state, pos, [1, -1], (n) => n.name === "URL" || n.name === "Link")
  const url = node?.name === "Link" ? node.getChild("URL") : node
  return url ? state.sliceDoc(url.from, url.to) : null
}

function openLink(view: EditorView, raw: string | null): void {
  if (!raw) return
  const url = raw.replace(/^<(.*)>$/, "$1")
  const href = /^www\./i.test(url) ? `https://${url}` : url
  if (/^(https?:|mailto:)/i.test(href)) (view.dom.ownerDocument.defaultView ?? window).open(href, "_blank", "noopener,noreferrer")
}

export const previewClicks: Extension = EditorView.domEventHandlers({
  mousedown(e, view) {
    const target = e.target as Node | null
    if (e.button !== 0 || target?.nodeType !== 1) return false
    const el = target as Element
    const task = el.closest(".md-task")
    if (task) {
      e.preventDefault()
      toggleTaskAt(view, view.posAtDOM(task))
      return true
    }
    const btn = el.closest<HTMLElement>(".md-copy")
    if (btn) {
      e.preventDefault()
      copy(view, btn)
      return true
    }
    // Table cells have their own click handler
    const link = el.closest(".md-link")
    if (link && (e.ctrlKey || e.metaKey) && !link.closest(".md-table-wrap")) {
      e.preventDefault()
      openLink(view, linkUrlAt(view.state, view.posAtDOM(link)))
      return true
    }
    return false
  },
})
