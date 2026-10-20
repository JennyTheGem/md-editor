import { StateEffect, StateField } from "@codemirror/state"
import { Decoration, EditorView } from "@codemirror/view"
import type { DecorationSet } from "@codemirror/view"

const FLASH_MS = 1500

const setFlash = StateEffect.define<number | null>()
const flashDeco = Decoration.line({ class: "md-flash" })

export const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes)
    for (const e of tr.effects) {
      if (e.is(setFlash)) deco = e.value === null ? Decoration.none : Decoration.set(flashDeco.range(tr.state.doc.lineAt(e.value).from))
    }
    return deco
  },
  provide: (f) => EditorView.decorations.from(f),
})

const timers = new WeakMap<EditorView, ReturnType<typeof setTimeout>>()

// Scrolls pos's line to the top and flashes it, cursor stays put
export function revealLine(view: EditorView, pos: number): void {
  const at = Math.min(Math.max(0, pos), view.state.doc.length)
  clearTimeout(timers.get(view))
  view.dispatch({ effects: [EditorView.scrollIntoView(at, { y: "start", yMargin: 20 }), setFlash.of(at)] })
  timers.set(view, setTimeout(() => {
    // destroy() detaches the dom
    if (view.dom.isConnected) view.dispatch({ effects: setFlash.of(null) })
  }, FLASH_MS))
}
