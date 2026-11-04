# @uplift-beyond/md-editor

A React markdown editor on CodeMirror 6 with live preview. Markdown syntax hides on lines without the cursor, tables render as real tables you edit in place, task lists show a done count after the heading, text line or parent item above them, code blocks get a language label and a copy button, callouts (`> [!tip]`) render as tinted blocks, `/` and `:` open slash and emoji menus, and Mod-f / Mod-h open find and replace. Timestamp pills (`@[1:23]`) are an opt-in feature for video notes.

Everything comes from one lezer syntax tree (CommonMark + GFM + three inline additions), so code, tables and links never get mixed up by regexes. No host app imports, no i18n library, no CSS file: strings come in as phrases and colors as CSS variables.

## Install

The package ships TypeScript source (`exports: ./src/index.ts`), so the host needs a bundler like Vite and a tsconfig with `moduleResolution: "bundler"`, `allowImportingTsExtensions` and `jsx: "react-jsx"`. React 19 is a peer dependency.

Link it with `file:` and install inside the package folder first, because its CodeMirror dependencies live in its own `node_modules`:

```json
"dependencies": { "@uplift-beyond/md-editor": "file:../path/to/md-editor" }
```

```sh
cd path/to/md-editor && npm install
cd my-app && npm install
```

The package folder also has its own dev copy of React, so dedupe it and let the dev server read the linked folder (`vite.config.ts`):

```ts
import { fileURLToPath } from "node:url"
import { defineConfig, searchForWorkspaceRoot } from "vite"

const mdEditor = fileURLToPath(new URL("../path/to/md-editor", import.meta.url))

export default defineConfig({
  resolve: { dedupe: ["react", "react-dom"] },
  server: { fs: { allow: [searchForWorkspaceRoot(process.cwd()), mdEditor] } },
})
```

Use the same `resolve.dedupe` in `vitest.config.ts`. Import CodeMirror only through this package. If the host must use `@codemirror/*` itself, install the same versions in the host and add `@codemirror/state`, `@codemirror/view`, `@codemirror/language`, `@lezer/common` and `@lezer/highlight` to `resolve.dedupe`: two copies of `@codemirror/state` break the editor.

## React

A plain notes editor (no timestamps, `#` is just a heading mark):

```tsx
import { useRef } from "react"
import { MarkdownEditor } from "@uplift-beyond/md-editor"
import type { MarkdownEditorHandle } from "@uplift-beyond/md-editor"

export default function Notes() {
  const editor = useRef<MarkdownEditorHandle>(null)
  return (
    <>
      <button onMouseDown={(e) => e.preventDefault()} onClick={() => editor.current?.run("bold")}>B</button>
      <MarkdownEditor ref={editor} defaultValue="# Notes" placeholder="Write..." onChange={(doc) => save(doc)} />
    </>
  )
}
```

The editor is uncontrolled: `defaultValue` is read once, `onChange` reports every edit, and `setDoc` loads a new note. Toolbar buttons should call `preventDefault` on mousedown so the editor keeps its selection.

With timestamps (video notes): pills render, a click or Mod-Enter on a pill seeks, and typing `#` inserts the current time.

```tsx
const clock = {
  now: () => (player.ready ? player.currentTime : null), // null keeps "#" literal
  seek: (seconds: number) => player.seekTo(seconds),
}

<MarkdownEditor timestamps={clock} icons={{ timestamp: "/icons/hourglass.svg" }} />
```

## Headless

```ts
import { EditorView } from "@codemirror/view"
import { createMdState, setDoc, updateMdEditor } from "@uplift-beyond/md-editor"

const view = new EditorView({ parent: el, state: createMdState("# Hi", { onChange: (doc) => save(doc) }) })
updateMdEditor(view, { livePreview: false })
setDoc(view, "# Next note")
```

`mdEditor(options)` returns the extension set if you build the state yourself.

## Static render

For print or export: the doc as plain elements, parsed like the editor. Raw HTML stays text, links are real anchors (http, https and mailto only).

```ts
import { renderMarkdown } from "@uplift-beyond/md-editor"

const root = renderMarkdown(doc, {
  timestampHref: (seconds) => `https://example.com/video?t=${seconds}`, // null = plain text
  phrases: { Note: "Notiz" }, // callout titles
})
```

The root is `div.md-doc`. Style it yourself: `md-ts` (timestamps), `md-link`, `md-color-<name>`, `md-callout md-callout-<type>`, `md-task` / `md-task-done` / `md-task-box`, `md-code-block`, `md-table`.

## Options

Runtime options apply without a remount and keep undo, cursor and scroll (`updateMdEditor`, or new props on `MarkdownEditor`):

| Option | Default | |
| --- | --- | --- |
| `livePreview` | `true` | `false` = source mode. Styling, pills and copy buttons stay. |
| `placeholder` | none | Text shown in an empty editor. |
| `phrases` | English | UI strings, see Phrases. |
| `slashCommands` | `[]` | Host commands added after the built-ins. |
| `vim` | `false` | Vim keys (`@replit/codemirror-vim`) with a mode line at the bottom. Loaded on first use, so it costs nothing while off. Vim sees keys first: in normal mode Ctrl-b, Ctrl-f and friends are vim's, in insert mode the package keys still work except Ctrl-u (vim deletes to the line start). |

Mount-only options are read when the state is created (mount or `setDoc`):

| Option | Default | |
| --- | --- | --- |
| `slash` | `true` | Slash menu. |
| `emoji` | `true` | Emoji menu. `true` = built-in lazy set, `false` = off, or a loader `() => Promise<EmojiEntry[]>`. |
| `timestamps` | none | `{ now, seek, trigger? }`. Without it there are no pills, no `#` trigger and no timestamp command. |
| `icons` | `{}` | Image URLs for `timestamp`, `copy`, `copied`, the callout types `note`, `tip`, `warning`, `danger`, and the find panel's `findNext`, `findPrev`, `close`, `expand`, `matchCase`, `wholeWord`, `regexp`, drawn as `currentColor` masks. A missing callout icon shows only the title; a missing panel icon shows the button's phrase as text. |
| `codeLanguages` | `defaultCodeLanguages` | Fence highlighting: js/jsx, ts/tsx, css, html, json, python. |
| `revealDelay` | `400` | Ms the raw markdown stays put after a mouse release, so text never shifts under a click. |
| `onChange` | none | `(doc, state)` on every doc change. Never called by `setDoc`. |

`MarkdownEditor` also takes `defaultValue`, `className` (the host div gets `mdEditor <className>`) and `ref`. Callbacks always reach the newest props.

A wrapper that forwards its own `ref` must type it as `MarkdownEditorProps["ref"]`, not with the host's `Ref<MarkdownEditorHandle>`. The package source resolves its own `@types/react`, and two copies of `Ref` fail tsc with "Two different types with this name exist". The other fix is a tsconfig `paths` entry that points `react` at the host's types (`"react": ["./node_modules/@types/react"]`).

```tsx
export function Notes({ ref }: { ref?: MarkdownEditorProps["ref"] }) {
  return <MarkdownEditor ref={ref} />
}
```

`timestamps.trigger` defaults to `"#"`, `false` turns typing off. It fires when one input event types the whole trigger, so in practice it is one character. It stays literal in code, URLs and HTML, after a backslash, letter or digit, after a line-start `#`, and while `now()` returns `null`. Ctrl+Z right after gives back the `#`.

Slash commands: `{ id, label, apply, aliases?, section?, block? }`. `apply` is a snippet template (`"${}"` marks a field) or a function `(view, from, to)` that must replace `from..to` (the typed `/query`) itself. `block: true` offers it only at the start of a line. Labels and sections come localized from the host.

## Handle

| Member | |
| --- | --- |
| `view` | The live `EditorView`, or `null` before mount. |
| `getDoc()` | Current text. |
| `setDoc(doc)` | Loads a doc with a fresh undo history. |
| `focus()` | Focuses the editor. |
| `reveal(pos)` | Scrolls `pos`'s line to the top and flashes it (`md-flash`), without moving the cursor or focus. |
| `run(command)` | Runs an `MdCommandName`, `"find"` (opens the find panel), or any `StateCommand` / `Command`, then refocuses the text unless the command put focus in a panel. Returns whether it applied. |

`MdCommandName`: `timestamp`, `h1`, `h2`, `h3`, `bold`, `italic`, `underline`, `strike`, `inlineCode`, `sup`, `red`, `blue`, `green`, `defaultColor`, `code`, `codeBlock`, `hr`, `link`, `bulletList`, `orderedList`, `taskList`, `quote`, `callout`, `table`, `date`.

Also exported: `mdCommands`, `toggleHeading(level)`, `setColor(color | null)`, `insertTimestamp`, `formatTime`, `formatTimestamp`, `parseTimestamp`, `revealLine(view, pos)` and `extractTimestamps(state)` (every timestamp in doc order, never inside code).

Keys: Mod-b bold, Mod-i italic, Mod-u underline, Tab indents (4 spaces at a bare cursor), Shift-Tab outdents, Mod-Enter toggles a task or seeks a pill. Tab and Shift-Tab jump between cells of a raw table. In a rendered table a click edits that cell in place: Tab, Enter and the arrows move between cells (past the last row adds one), Escape leaves, and right-click or Shift-F10 opens the row and column menu. Escape then Tab leaves the editor, and Ctrl-m (Shift-Alt-m on macOS) switches Tab to moving focus.

Find and replace (`@codemirror/search`, panel on top): Mod-f find, Mod-h replace (Cmd-Alt-f on macOS, where Cmd-h hides the app), Enter or F3 / Mod-g next, Shift for previous, Escape closes. Mod-d selects the next occurrence, Mod-Shift-l every match. While the panel is open the line of the current match shows its raw markdown.

The panel is the package's own (`.md-find`): a chevron that opens the replace row, the find field with case, whole word and regexp toggles, a match counter (`3 of 12`, `? of 12` when the cursor is not on a match, capped at 999), previous, next and close. Previous, next and both replace buttons are disabled without a match, and an invalid regexp marks the field. It sits on the editor surface, so the host's background shows through.

## Phrases

Every UI string goes through CodeMirror's `EditorState.phrases`. The keys are the English defaults, listed in `MD_PHRASES`; pass a translation for any of them:

Markdown editor, Completions, Copy code, Copied, Copy failed, Jump to $1, Toggle task, $1+click to open link, Ctrl, Cmd, text, Link text, Column, Insert, Format, Blocks, Timestamp, Heading 1, Heading 2, Heading 3, Bold, Italic, Underline, Strikethrough, Inline code, Superscript, Link, Bullet list, Numbered list, Task list, Quote, Code block, Table, Divider, Today's date, Callout, Note, Tip, Warning, Danger, $1 of $2 done, Insert row above, Insert row below, Insert column left, Insert column right, Delete row, Delete column.

Find panel: Find, Replace, next, previous, match case, regexp, by word, replace, replace all, close, Toggle replace, $1 of $2, No results. With icons, the lowercase ones are tooltips and screen reader labels, so translate them in sentence case. CodeMirror's own screen reader keys: current match, on line, replaced match on line $, replaced $ matches.

`$1` is filled in (a time, or the Ctrl/Cmd label), `$` with a line number or match count.

## CSS variables

Set any of these on the editor or a parent. All are optional, the fallbacks follow `currentColor` and system colors, so light and dark hosts both work.

- Text: `--md-font`, `--md-font-mono`, `--md-line-height`, `--md-text`, `--md-muted`
- Accent: `--md-accent`, `--md-on-accent`, `--md-selection`, `--md-flash`
- Surfaces: `--md-surface`, `--md-menu-bg`, `--md-code-bg`, `--md-code-text`, `--md-border`, `--md-radius`, `--md-shadow`, `--md-z-tooltip`
- Pills: `--md-pill-bg`, `--md-pill-text`
- Note colors: `--md-red`, `--md-blue`, `--md-green`
- Callouts: note uses `--md-accent`, tip `--md-green`, danger `--md-red`, warning `--md-warning` (falls back to a red-green mix). Each gets a flat tint of its color and a colored title line.
- Code tokens: `--md-tok-keyword`, `--md-tok-string`, `--md-tok-number`, `--md-tok-comment`, `--md-tok-function`, `--md-tok-type`, `--md-tok-property`

Every class the package adds starts with `md-`.

## Stored format

The document is plain markdown (UTF-8, `\n`): CommonMark + GFM tables, task lists, `~~strike~~` and autolinks. Setext headings are off, so `---` under text is always a divider.

- Timestamps: `@[M:SS]` under an hour, `@[H:MM:SS]` from an hour. Invalid ones (`@[1:75]`), escaped ones (`\@[1:23]`) and any in code stay text.
- Colors: `<span style="color:#e06c75">x</span>` (red), `#61afef` (blue), `#98c379` (green), exported as `MD_COLORS`. Other values keep their bytes but show uncolored. Document text never reaches a style attribute.
- Underline: `<u>x</u>`. Superscript: `^x^` (spaces allowed; `[^1]` and `2^10` stay text).
- Emoji are stored as Unicode characters, never `:shortcodes:`.
- Callouts (Obsidian syntax): a blockquote whose first line starts with `[!type]`, e.g. `> [!tip] Optional title`. Types `note`, `tip`, `warning`, `danger`, case-insensitive; anything else shows as a note. A `+` or `-` fold mark is kept but ignored. Without a title the type's phrase is shown. The raw line returns while the cursor is in the callout.

## Offline

Code languages and the emoji list load as lazy chunks the first time they are needed. A PWA should precache those chunks too, or fences stay unhighlighted and the emoji menu stays empty while offline.

## Development

```sh
npm test           # vitest + jsdom
npm run lint
npm run typecheck
```

## License

MIT, see `LICENSE`. Emoji names come from [gemoji](https://github.com/github/gemoji) (MIT).
