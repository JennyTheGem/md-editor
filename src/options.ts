import { Facet } from "@codemirror/state"
import type { EditorState, StateCommand } from "@codemirror/state"
import type { Command, EditorView } from "@codemirror/view"
import type { LanguageDescription } from "@codemirror/language"
import type { Ref } from "react"
import type { MdPhrase } from "./phrases.ts"

export type MdColor = "red" | "blue" | "green"

export type MdCommandName =
  | "timestamp" | "h1" | "h2" | "h3" | "bold" | "italic" | "underline" | "strike" | "inlineCode" | "sup"
  | "red" | "blue" | "green" | "defaultColor" | "code" | "codeBlock" | "hr" | "link"
  | "bulletList" | "orderedList" | "taskList" | "quote" | "callout" | "table" | "date"

export type MdPhrases = Partial<Record<MdPhrase, string>> & Readonly<Record<string, string>>

// Image URLs, drawn as currentColor CSS masks
export interface MdIcons {
  timestamp?: string; copy?: string; copied?: string
  // Callout types
  note?: string; tip?: string; warning?: string; danger?: string
  // Find panel, buttons fall back to their text label
  findNext?: string; findPrev?: string; close?: string; expand?: string
  matchCase?: string; wholeWord?: string; regexp?: string
}

export interface TimestampOptions {
  // Media time in seconds, null when nothing is loaded
  now(): number | null
  seek(seconds: number): void
  // Typed text that becomes a timestamp, default "#", false = off
  trigger?: string | false
}

export interface MdSlashCommand {
  id: string
  aliases?: readonly string[]
  label: string
  section?: string
  // Offered only when "/" starts the line
  block?: boolean
  // String = snippet template, fn must replace from..to itself
  apply: string | ((view: EditorView, from: number, to: number) => void)
}

export type EmojiEntry = readonly [glyph: string, name: string, ...aliases: string[]]

export interface MdEditorOptions {
  livePreview?: boolean
  placeholder?: string
  phrases?: MdPhrases
  slashCommands?: readonly MdSlashCommand[]
  slash?: boolean
  emoji?: boolean | (() => Promise<readonly EmojiEntry[]>)
  timestamps?: TimestampOptions
  icons?: MdIcons
  codeLanguages?: readonly LanguageDescription[]
  revealDelay?: number
  onChange?: (doc: string, state: EditorState) => void
}

export type MdRuntimeOptions = Pick<MdEditorOptions, "livePreview" | "placeholder" | "phrases" | "slashCommands">

export interface MarkdownEditorHandle {
  readonly view: EditorView | null
  getDoc(): string
  setDoc(doc: string): void
  focus(): void
  // Scroll to pos's line and flash it, without moving the cursor
  reveal(pos: number): void
  // "find" opens the find panel and leaves focus in its field
  run(command: MdCommandName | "find" | StateCommand | Command): boolean
}

export interface MarkdownEditorProps extends MdEditorOptions {
  defaultValue?: string
  className?: string
  ref?: Ref<MarkdownEditorHandle>
}

export interface MdConfig { timestamps: TimestampOptions | null; icons: MdIcons; revealDelay: number }

export const mdConfig = Facet.define<Partial<MdConfig>, MdConfig>({
  combine: (values) => ({ timestamps: null, icons: {}, revealDelay: 400, ...(values[0] ?? {}) }),
})

export const slashCommandsFacet = Facet.define<readonly MdSlashCommand[], readonly MdSlashCommand[]>({
  combine: (values) => values.flat(),
})
