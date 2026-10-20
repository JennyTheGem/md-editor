import { acceptCompletion, autocompletion, closeCompletion, completionStatus, selectedCompletionIndex } from "@codemirror/autocomplete"
import { isolateHistory } from "@codemirror/commands"
import type { Language } from "@codemirror/language"
import { EditorState, Prec } from "@codemirror/state"
import type { Extension } from "@codemirror/state"
import { keymap } from "@codemirror/view"
import type { EditorView } from "@codemirror/view"
import type { EmojiEntry } from "../options.ts"
import { defaultEmojiLoader, emojiSource } from "./emoji.ts"
import { slashSource } from "./slash.ts"

// Closes the menu and returns false, so Enter falls through to the newline command
function bareSlashEnter(view: EditorView): boolean {
  const { state } = view, head = state.selection.main.head
  if (completionStatus(state) === "active" && selectedCompletionIndex(state) === 0 && state.sliceDoc(head - 1, head) === "/") closeCompletion(view)
  return false
}

export function completion(
  language: Language,
  options: { slash: boolean; emoji: boolean | (() => Promise<readonly EmojiEntry[]>) },
): Extension {
  const { slash, emoji } = options
  if (!slash && !emoji) return []
  return [
    // Before autocompletion(): Enter on a bare '/' is a newline, not the first command
    Prec.highest(keymap.of([{ key: "Enter", run: bareSlashEnter }])),
    autocompletion({
      icons: false,
      maxRenderedOptions: 50,
      optionClass: (c) => (c.type === "md-emoji" ? "md-ac-emoji" : "md-ac-slash"),
    }),
    Prec.highest(keymap.of([{ key: "Tab", run: acceptCompletion }])),
    // Typing right after an accepted completion is its own undo step
    EditorState.transactionExtender.of((tr) => (tr.isUserEvent("input.complete") ? { annotations: isolateHistory.of("after") } : null)),
    // One data.of per source: an array value would be read as a completion list
    slash ? language.data.of({ autocomplete: slashSource }) : [],
    emoji ? language.data.of({ autocomplete: emojiSource(emoji === true ? defaultEmojiLoader : emoji) }) : [],
  ]
}
