import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete"
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
import { indentUnit } from "@codemirror/language"
import { Compartment, EditorState, Prec } from "@codemirror/state"
import type { Extension, StateEffect } from "@codemirror/state"
import { EditorView, drawSelection, dropCursor, keymap, placeholder } from "@codemirror/view"
import { formatKeymap } from "./commands/index.ts"
import { flashField } from "./flash.ts"
import { completion } from "./complete/completion.ts"
import { mdConfig, slashCommandsFacet } from "./options.ts"
import type { MdEditorOptions, MdRuntimeOptions } from "./options.ts"
import { previewClicks, taskKeymap } from "./preview/clicks.ts"
import { hidePlugin } from "./preview/hide.ts"
import { revealTracking, setFocused } from "./preview/reveal.ts"
import { stylesPlugin } from "./preview/styles.ts"
import { tables } from "./preview/tables.ts"
import { findReplace } from "./search.ts"
import { createMarkdown, defaultCodeLanguages } from "./syntax.ts"
import { mdTheme } from "./theme.ts"
import { timestamps } from "./timestamps/timestamps.ts"

const previewC = new Compartment()
const phrasesC = new Compartment()
const placeholderC = new Compartment()
const slashC = new Compartment()

const livePreviewExt = (): Extension => [hidePlugin, tables()]
const previewExt = (on: boolean | undefined): Extension => (on === false ? [] : livePreviewExt())
const placeholderExt = (text: string | undefined): Extension => (text ? placeholder(text) : [])

// No paste handler on purpose: CM pastes text/plain only and lang-markdown keeps pasteURLAsLink.
export function mdEditor(o: MdEditorOptions = {}): Extension {
  const md = createMarkdown(o.codeLanguages ?? defaultCodeLanguages)
  const onChange = o.onChange
  return [
    mdConfig.of({ timestamps: o.timestamps ?? null, icons: o.icons ?? {}, revealDelay: o.revealDelay ?? 400 }),
    phrasesC.of(EditorState.phrases.of(o.phrases ?? {})),
    placeholderC.of(placeholderExt(o.placeholder)),
    slashC.of(slashCommandsFacet.of(o.slashCommands ?? [])),
    md,
    indentUnit.of("    "),
    history(),
    drawSelection(),
    dropCursor(),
    EditorView.lineWrapping,
    closeBrackets(),
    revealTracking,
    stylesPlugin,
    previewClicks,
    flashField,
    o.timestamps ? timestamps() : [],
    previewC.of(previewExt(o.livePreview)),
    completion(md.language, { slash: o.slash !== false, emoji: o.emoji ?? true }),
    Prec.high(keymap.of([...formatKeymap, ...taskKeymap])),
    findReplace,
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap]),
    mdTheme,
    EditorView.contentAttributes.of((view) => ({ "aria-label": view.state.phrase("Markdown editor") })),
    onChange ? EditorView.updateListener.of((u) => { if (u.docChanged) onChange(u.state.doc.toString(), u.state) }) : [],
  ]
}

export function createMdState(doc: string, o: MdEditorOptions = {}): EditorState {
  return EditorState.create({ doc, extensions: mdEditor(o) })
}

export function setDoc(view: EditorView, doc: string, o: MdEditorOptions = {}): void {
  const focused = view.hasFocus
  view.setState(createMdState(doc, o))
  if (focused) view.dispatch({ effects: setFocused.of(true) })
}

export function updateMdEditor(view: EditorView, o: MdRuntimeOptions): void {
  const effects: StateEffect<unknown>[] = []
  if (Object.hasOwn(o, "livePreview")) effects.push(previewC.reconfigure(previewExt(o.livePreview)))
  if (Object.hasOwn(o, "placeholder")) effects.push(placeholderC.reconfigure(placeholderExt(o.placeholder)))
  if (Object.hasOwn(o, "phrases")) effects.push(phrasesC.reconfigure(EditorState.phrases.of(o.phrases ?? {})))
  if (Object.hasOwn(o, "slashCommands")) effects.push(slashC.reconfigure(slashCommandsFacet.of(o.slashCommands ?? [])))
  if (effects.length) view.dispatch({ effects })
}
