import { indentLess, isolateHistory } from "@codemirror/commands"
import type { StateCommand } from "@codemirror/state"
import type { KeyBinding } from "@codemirror/view"
import { mdConfig } from "../options.ts"
import type { MdColor, MdCommandName } from "../options.ts"
import { formatTimestamp } from "../timestamps/format.ts"
import {
  codeSpec, insertCodeBlockSpec, insertDateSpec, insertHrSpec, insertLinkSpec, insertTab, insertTableSpec,
  toggleHeadingSpec, toggleLinePrefixSpec,
} from "./blocks.ts"
import { setColorSpec } from "./color.ts"
import { INLINE_FORMATS, toggleInline } from "./inline.ts"
import { toCommand } from "./util.ts"
import type { SpecBuilder } from "./util.ts"

export { toCommand }
export type { SpecBuilder }

const timestampSpec: SpecBuilder = (state) => {
  let s: number | null
  try {
    s = state.facet(mdConfig).timestamps?.now() ?? null
  } catch {
    s = null
  }
  if (s === null || !Number.isFinite(s)) return null
  return {
    ...state.replaceSelection(formatTimestamp(s)),
    userEvent: "input.timestamp",
    annotations: isolateHistory.of("full"),
    scrollIntoView: true,
  }
}

export const mdCommandSpecs: Readonly<Record<MdCommandName, SpecBuilder>> = {
  timestamp: timestampSpec,
  h1: toggleHeadingSpec(1),
  h2: toggleHeadingSpec(2),
  h3: toggleHeadingSpec(3),
  bold: toggleInline(INLINE_FORMATS.bold),
  italic: toggleInline(INLINE_FORMATS.italic),
  underline: toggleInline(INLINE_FORMATS.underline),
  strike: toggleInline(INLINE_FORMATS.strike),
  inlineCode: toggleInline(INLINE_FORMATS.inlineCode),
  sup: toggleInline(INLINE_FORMATS.sup),
  red: setColorSpec("red"),
  blue: setColorSpec("blue"),
  green: setColorSpec("green"),
  defaultColor: setColorSpec(null),
  code: codeSpec,
  codeBlock: insertCodeBlockSpec,
  hr: insertHrSpec,
  link: insertLinkSpec,
  bulletList: toggleLinePrefixSpec("bullet"),
  orderedList: toggleLinePrefixSpec("ordered"),
  taskList: toggleLinePrefixSpec("task"),
  quote: toggleLinePrefixSpec("quote"),
  table: insertTableSpec,
  date: insertDateSpec,
}

export const mdCommands = Object.fromEntries(
  Object.entries(mdCommandSpecs).map(([name, build]) => [name, toCommand(build)]),
) as Readonly<Record<MdCommandName, StateCommand>>

export function toggleHeading(level: 1 | 2 | 3 | 4 | 5 | 6): StateCommand {
  return toCommand(toggleHeadingSpec(level))
}

export function setColor(color: MdColor | null): StateCommand {
  return toCommand(setColorSpec(color))
}

export const insertTimestamp: StateCommand = mdCommands.timestamp

// A no-op format key is still handled, so it never falls through to selectParentSyntax, undoSelection or the browser
const consume = (cmd: StateCommand): StateCommand => (target) => (cmd(target), true)

// No heading keys: Ctrl+1..3 switch browser tabs, Ctrl+Alt is AltGr on German Windows
export const formatKeymap: readonly KeyBinding[] = [
  { key: "Mod-b", run: consume(mdCommands.bold) },
  { key: "Mod-i", run: consume(mdCommands.italic) },
  { key: "Mod-u", run: consume(mdCommands.underline) },
  { key: "Tab", run: insertTab, shift: indentLess },
]
