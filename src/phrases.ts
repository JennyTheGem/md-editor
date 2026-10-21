import type { EditorState } from "@codemirror/state"

export const MD_PHRASES = [
  "Markdown editor", "Completions", "Copy code", "Copied", "Copy failed", "Jump to $1", "Toggle task",
  "$1+click to open link", "Ctrl", "Cmd", "text", "Link text", "Column", "Insert", "Format", "Blocks",
  "Timestamp", "Heading 1", "Heading 2", "Heading 3", "Bold", "Italic", "Underline", "Strikethrough",
  "Inline code", "Superscript", "Link", "Bullet list", "Numbered list", "Task list", "Quote", "Code block",
  "Table", "Divider", "Today's date", "Callout", "Note", "Tip", "Warning", "Danger",
  "Find", "Replace", "next", "previous", "match case", "regexp", "by word", "replace", "replace all", "close",
  "Toggle replace", "$1 of $2", "No results",
  "current match", "on line", "replaced match on line $", "replaced $ matches",
] as const

export type MdPhrase = (typeof MD_PHRASES)[number]

export function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent)
}

export function modKeyLabel(state: EditorState): string {
  return state.phrase(isMac() ? "Cmd" : "Ctrl")
}
