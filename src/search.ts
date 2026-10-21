import { gotoLine, openSearchPanel, search, searchKeymap } from "@codemirror/search"
import type { Extension } from "@codemirror/state"
import { keymap } from "@codemirror/view"
import type { Command } from "@codemirror/view"

export const openReplacePanel: Command = (view) => {
  openSearchPanel(view)
  const field = view.dom.querySelector<HTMLInputElement>(".cm-search [name=replace]")
  field?.focus()
  field?.select()
  return true
}

// No go-to-line: Ctrl+Alt is AltGr on German Windows. Cmd+H hides the app on macOS, so replace is Cmd+Alt+F there.
export const findReplace: Extension = [
  search({ top: true }),
  keymap.of([
    ...searchKeymap.filter((b) => b.run !== gotoLine),
    { key: "Mod-h", mac: "Mod-Alt-f", run: openReplacePanel, scope: "editor search-panel" },
  ]),
]
