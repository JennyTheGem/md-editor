import { Compartment } from "@codemirror/state"
import type { Extension } from "@codemirror/state"
import { EditorView, ViewPlugin } from "@codemirror/view"

export const vimC = new Compartment()

const accent = "var(--md-accent, LinkText)"
// One class more than the package's own Prec.highest theme
const vimTheme = EditorView.baseTheme({
  ".cm-vimCursorLayer .cm-fat-cursor": { background: accent, color: "var(--md-on-accent, Canvas) !important" },
  "&:not(.cm-focused) .cm-vimCursorLayer .cm-fat-cursor": { background: "none", outline: `1px solid ${accent}` },
  ".cm-panels .cm-vim-panel": { padding: ".2em .6em", fontFamily: "var(--md-font-mono, ui-monospace, monospace)", fontSize: ".85em" },
  // The : and / prompt, else it keeps the browser's field colors
  ".cm-panels .cm-vim-panel input": { color: "inherit", font: "inherit" },
  "&light .cm-panels-bottom, &dark .cm-panels-bottom": {
    borderTop: "1px solid var(--md-border, color-mix(in srgb, currentColor 20%, transparent))",
  },
})

let loaded: Extension | null = null

// The vim package is ~500 KB, so it loads on first use and swaps itself into the compartment
const vimLoader = ViewPlugin.define((view) => {
  let live = true
  void import("@replit/codemirror-vim").then(({ vim }) => {
    loaded ??= [vim({ status: true }), vimTheme]
    if (live) view.dispatch({ effects: vimC.reconfigure(loaded) })
  })
  return { destroy: () => { live = false } }
})

export const vimExt = (on: boolean | undefined): Extension => (on ? loaded ?? vimLoader : [])
