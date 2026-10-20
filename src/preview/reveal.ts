import { StateEffect, StateField } from "@codemirror/state"
import type { EditorState, Extension } from "@codemirror/state"
import { EditorView, ViewPlugin } from "@codemirror/view"
import { mdConfig } from "../options.ts"

export const setFocused = StateEffect.define<boolean>()
export const setFrozen = StateEffect.define<boolean>()

type Span = readonly [number, number]

export interface RevealState { readonly focused: boolean; readonly frozen: boolean; readonly spans: readonly Span[] }

function computeSpans(state: EditorState): Span[] {
  const spans: Span[] = []
  for (const r of state.selection.ranges) {
    for (const pos of [r.anchor, r.head]) {
      const line = state.doc.lineAt(pos)
      spans.push([line.from, line.to])
    }
  }
  spans.sort((a, b) => a[0] - b[0])
  return spans.filter((s, i) => i === 0 || s[0] !== spans[i - 1][0])
}

const sameSpans = (a: readonly Span[], b: readonly Span[]) =>
  a.length === b.length && a.every((s, i) => s[0] === b[i][0] && s[1] === b[i][1])

export const revealField = StateField.define<RevealState>({
  create: () => ({ focused: false, frozen: false, spans: [] }),
  update(v, tr) {
    let { focused, frozen } = v
    let freezing = false
    for (const e of tr.effects) {
      if (e.is(setFocused)) focused = e.value
      else if (e.is(setFrozen)) {
        frozen = e.value
        if (e.value) freezing = true
      }
    }
    if (frozen && !freezing && (tr.docChanged || (tr.selection && !tr.isUserEvent("select.pointer")))) frozen = false
    // Old spans are stale after a doc change, so recompute even while frozen
    const spans = !focused ? [] : frozen && !tr.docChanged ? v.spans : computeSpans(tr.state)
    if (focused === v.focused && frozen === v.frozen && sameSpans(spans, v.spans)) return v
    return { focused, frozen, spans }
  },
})

export function isLineRevealed(state: EditorState, pos: number): boolean {
  const r = state.field(revealField, false)
  if (!r) return false
  const line = state.doc.lineAt(pos)
  return r.spans.some(([a, b]) => a <= line.to && b >= line.from)
}

export function isRangeRevealed(state: EditorState, from: number, to: number): boolean {
  const r = state.field(revealField, false)
  return !!r && r.spans.some(([a, b]) => a <= to && b >= from)
}

// Holds the reveal while the mouse button is down so text never shifts under the pointer
class FreezePlugin {
  view: EditorView
  timer = -1
  dead = false
  listening = false
  readonly onRelease = () => this.release()
  readonly onMove = (e: MouseEvent) => {
    if (e.buttons === 0) this.release()
  }

  constructor(view: EditorView) {
    this.view = view
  }

  get win(): Window {
    return this.view.dom.ownerDocument.defaultView ?? window
  }

  freeze() {
    this.win.clearTimeout(this.timer)
    this.attach()
    if (!this.view.state.field(revealField, false)?.frozen) this.view.dispatch({ effects: setFrozen.of(true) })
  }

  attach() {
    if (this.listening) return
    this.listening = true
    const w = this.win
    w.addEventListener("pointerup", this.onRelease, true)
    w.addEventListener("pointercancel", this.onRelease, true)
    w.addEventListener("mousemove", this.onMove)
    w.addEventListener("blur", this.onRelease)
  }

  detach() {
    if (!this.listening) return
    this.listening = false
    const w = this.win
    w.removeEventListener("pointerup", this.onRelease, true)
    w.removeEventListener("pointercancel", this.onRelease, true)
    w.removeEventListener("mousemove", this.onMove)
    w.removeEventListener("blur", this.onRelease)
  }

  release() {
    this.detach()
    this.win.clearTimeout(this.timer)
    this.timer = this.win.setTimeout(() => {
      if (!this.dead && this.view.state.field(revealField, false)?.frozen) this.view.dispatch({ effects: setFrozen.of(false) })
    }, this.view.state.facet(mdConfig).revealDelay)
  }

  destroy() {
    this.dead = true
    this.detach()
    this.win.clearTimeout(this.timer)
  }
}

const freezePlugin = ViewPlugin.fromClass(FreezePlugin, {
  eventObservers: {
    pointerdown(e) {
      if (e.pointerType === "mouse" && e.button === 0) this.freeze()
    },
  },
})

export const revealTracking: Extension = [
  revealField,
  EditorView.focusChangeEffect.of((_s, focusing) => setFocused.of(focusing)),
  freezePlugin,
]
