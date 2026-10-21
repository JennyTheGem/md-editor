import { HighlightStyle, syntaxHighlighting } from "@codemirror/language"
import type { Extension } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { tags as t } from "@lezer/highlight"
import { MD_COLORS } from "./colors.ts"

const text = "var(--md-text, currentColor)"
const muted = "var(--md-muted, color-mix(in srgb, currentColor 55%, transparent))"
const accent = "var(--md-accent, LinkText)"
const surface = "var(--md-surface, color-mix(in srgb, currentColor 7%, transparent))"
const border = "var(--md-border, color-mix(in srgb, currentColor 20%, transparent))"
const codeBg = "var(--md-code-bg, color-mix(in srgb, currentColor 9%, transparent))"
const mono = "var(--md-font-mono, ui-monospace, monospace)"
const radius = "var(--md-radius, 4px)"
const red = `var(--md-red, ${MD_COLORS.red})`
const green = `var(--md-green, ${MD_COLORS.green})`
// Orange: halfway between red and green in oklch
const warning = `var(--md-warning, color-mix(in oklch, ${red}, ${green}))`
const tint = (c: string, pct: number) => `color-mix(in srgb, ${c} ${pct}%, transparent)`
const lightDark = (sel: string) => `&light ${sel}, &dark ${sel}`
// CM's tooltip and autocomplete themes win ties with ours, so these selectors carry one more class or attribute.
const menu = ".cm-tooltip.cm-tooltip-autocomplete"
const list = `${menu} > ul[role=listbox]`

const codeStyle = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.modifier], class: "md-tok-keyword" },
  { tag: [t.string, t.special(t.string), t.regexp], class: "md-tok-string" },
  { tag: [t.number, t.bool, t.null, t.atom], class: "md-tok-number" },
  { tag: [t.comment, t.lineComment, t.blockComment], class: "md-tok-comment" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], class: "md-tok-function" },
  { tag: [t.typeName, t.className, t.namespace, t.tagName], class: "md-tok-type" },
  { tag: [t.propertyName, t.attributeName], class: "md-tok-property" },
])

const baseTheme = EditorView.baseTheme({
  ".cm-content :where(span), .cm-tooltip :where(span)": { fontSize: "inherit", letterSpacing: "inherit" },
  "&": { height: "100%", color: text, fontFamily: "var(--md-font, inherit)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "inherit", lineHeight: "var(--md-line-height, 1.6)", overflow: "auto" },
  ".cm-content": { padding: "0 4px 3em", caretColor: text },
  "&light .cm-cursor, &light .cm-dropCursor, &dark .cm-cursor, &dark .cm-dropCursor": { borderLeftColor: text },
  "&light .cm-selectionBackground, &dark .cm-selectionBackground, &light.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, &dark.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
    background: "var(--md-selection, color-mix(in srgb, currentColor 25%, transparent))",
  },
  ".cm-placeholder": { color: muted, fontStyle: "italic" },

  ".cm-content .md-h1": { fontSize: "1.6em", fontWeight: 700, lineHeight: 1.3, paddingTop: ".4em" },
  ".cm-content .md-h2": { fontSize: "1.35em", fontWeight: 700, lineHeight: 1.3, paddingTop: ".3em" },
  ".cm-content .md-h3": { fontSize: "1.15em", fontWeight: 600, paddingTop: ".2em" },
  ".cm-content .md-h4": { fontSize: "1.05em", fontWeight: 600 },
  ".cm-content .md-h5, .cm-content .md-h6": { fontSize: "1em", fontWeight: 600 },
  ".md-quote": { background: surface, paddingInlineStart: "1em", color: muted, fontStyle: "italic" },
  ".md-quote-first": { borderTopLeftRadius: radius, borderTopRightRadius: radius },
  ".md-quote-last": { borderBottomLeftRadius: radius, borderBottomRightRadius: radius },
  ".md-callout": { background: tint("var(--md-callout)", 12), paddingInlineStart: "1em" },
  ".md-callout-note": { "--md-callout": accent },
  ".md-callout-tip": { "--md-callout": green },
  ".md-callout-warning": { "--md-callout": warning },
  ".md-callout-danger": { "--md-callout": red },
  ".md-callout-first": { borderTopLeftRadius: radius, borderTopRightRadius: radius, color: "var(--md-callout)", fontWeight: 600 },
  ".md-callout-last": { borderBottomLeftRadius: radius, borderBottomRightRadius: radius },
  ".md-callout-head": { display: "inline-flex", alignItems: "center", gap: ".35em", marginInlineEnd: ".35em" },
  ".cm-content .md-code-line": {
    fontFamily: mono, fontSize: ".9em", background: codeBg, color: "var(--md-code-text, inherit)", paddingInline: "1em",
  },
  ".cm-content .cm-line.md-flash": { background: `var(--md-flash, color-mix(in srgb, ${accent} 18%, transparent))` },
  ".md-code-first": { position: "relative", paddingTop: ".35em", borderTopLeftRadius: radius, borderTopRightRadius: radius },
  ".md-code-last": { paddingBottom: ".35em", borderBottomLeftRadius: radius, borderBottomRightRadius: radius },
  ".md-code-line .md-tok-keyword": { color: `var(--md-tok-keyword, ${accent})` },
  ".md-code-line .md-tok-string": { color: "var(--md-tok-string, inherit)" },
  ".md-code-line .md-tok-number": { color: "var(--md-tok-number, inherit)" },
  ".md-code-line .md-tok-comment": { color: `var(--md-tok-comment, ${muted})` },
  ".md-code-line .md-tok-function": { color: `var(--md-tok-function, ${accent})` },
  ".md-code-line .md-tok-type": { color: "var(--md-tok-type, inherit)" },
  ".md-code-line .md-tok-property": { color: "var(--md-tok-property, inherit)" },
  ".md-hr": { position: "relative" },
  ".md-hr-on::after": { content: '""', position: "absolute", left: 0, right: 0, top: "50%", borderTop: `1px solid ${border}` },
  ".cm-content .md-table-row": { fontFamily: mono, fontSize: ".9em" },

  ".md-strong": { fontWeight: 700 },
  ".md-em": { fontStyle: "italic" },
  ".md-strike": { textDecoration: "line-through", color: muted },
  ".md-underline": { textDecoration: "underline", textUnderlineOffset: "2px" },
  ".cm-content .md-sup": { verticalAlign: "super", fontSize: ".75em", lineHeight: 1 },
  ".cm-content .md-code-inline": { fontFamily: mono, fontSize: ".9em", background: codeBg, borderRadius: radius, padding: "0 .25em" },
  ".md-link": { color: accent, textDecoration: "underline" },
  ".md-syntax": { opacity: 0.45 },
  ".md-task-done": { textDecoration: "line-through", opacity: 0.6 },
  ".md-color-red": { color: red },
  ".md-color-blue": { color: `var(--md-blue, ${MD_COLORS.blue})` },
  ".md-color-green": { color: green },

  ".cm-content .md-ts": {
    display: "inline-flex", alignItems: "center", gap: ".25em", padding: "2px 5px", borderRadius: "3px",
    background: `var(--md-pill-bg, ${accent})`, color: "var(--md-pill-text, inherit)",
    fontSize: ".85em", lineHeight: 1, verticalAlign: "middle", position: "relative", top: "-1px",
    cursor: "pointer", whiteSpace: "nowrap", userSelect: "none", fontVariantNumeric: "tabular-nums",
    opacity: .8, transition: "opacity 150ms, filter 150ms", animation: "md-ts-appear 100ms ease-out",
  },
  ".cm-content .md-ts:hover": { opacity: 1, filter: `brightness(1.5) drop-shadow(0 0 2px ${accent})` },
  "@keyframes md-ts-appear": { from: { opacity: 0, transform: "translateX(-.1em)" }, to: { opacity: .8, transform: "none" } },
  "@media (prefers-reduced-motion: reduce)": {
    ".cm-content .md-ts": { animation: "none", transition: "none" },
    ".md-find-field, .md-find-btn, .md-find-expand .md-icon": { transition: "none" },
  },
  ".md-icon": {
    display: "inline-block", width: "1em", height: "1em", flexShrink: 0, backgroundColor: "currentColor",
    maskSize: "contain", maskRepeat: "no-repeat", maskPosition: "center",
    WebkitMaskSize: "contain", WebkitMaskRepeat: "no-repeat", WebkitMaskPosition: "center",
  },
  ".md-bullet": { display: "inline-block", width: "1ch", fontWeight: 700, textAlign: "center" },
  ".md-task": {
    display: "inline-block", width: "1em", height: "1em", boxSizing: "border-box", border: "1.5px solid currentColor",
    borderRadius: "3px", verticalAlign: "-.15em", position: "relative", cursor: "pointer",
  },
  ".md-task-checked": { background: accent, borderColor: accent },
  ".md-task-checked::after": {
    content: '""', position: "absolute", left: ".26em", top: ".04em", width: ".3em", height: ".55em", boxSizing: "border-box",
    border: "solid var(--md-on-accent, Canvas)", borderWidth: "0 2px 2px 0", transform: "rotate(45deg)",
  },
  ".cm-content .md-code-header": {
    position: "absolute", top: ".2em", right: ".5em", display: "flex", gap: ".5em", alignItems: "center", fontSize: ".75em", color: muted,
  },
  ".md-copy": {
    display: "inline-flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box", minWidth: "1.8em", minHeight: "1.8em",
    padding: "0 .4em", border: "1px solid transparent", borderRadius: radius, background: "transparent", color: "inherit",
    font: "inherit", cursor: "pointer", opacity: 0.7,
  },
  ".md-copy:hover, .md-copy:focus-visible": { opacity: 1, background: surface },
  "@media (hover: none)": { ".md-copy": { opacity: 1 } },
  ".md-copy[data-state=copied]": { color: accent },
  ".md-copy[data-state=failed]": { color: red },
  ".md-table-wrap": { overflowX: "auto", padding: ".4em 0" },
  ".cm-content .md-table": { borderCollapse: "collapse", fontSize: ".95em" },
  ".md-table th, .md-table td": { border: `1px solid ${border}`, padding: ".3em .6em", verticalAlign: "top" },
  ".md-table th": { background: surface, fontWeight: 600, textAlign: "start" },

  [`&light ${menu}, &dark ${menu}`]: {
    background: "var(--md-menu-bg, Canvas)", color: "var(--md-text, CanvasText)", border: `1px solid ${border}`,
    borderRadius: radius, boxShadow: "var(--md-shadow, none)", zIndex: "var(--md-z-tooltip, 100)",
  },
  [list]: { fontFamily: "var(--md-font, inherit)", maxHeight: "16em", borderRadius: "inherit" },
  [`${list} > li`]: { padding: ".25em .6em" },
  [`&light ${list} > li[aria-selected], &dark ${list} > li[aria-selected]`]: {
    background: "color-mix(in srgb, var(--md-accent, Highlight) 30%, transparent)", color: "inherit",
  },
  [`${list} > completion-section`]: { color: muted, fontSize: ".75em", borderBottomColor: border },
  [`${menu} .cm-completionDetail`]: { marginInlineStart: "1em", fontFamily: mono, fontStyle: "normal", opacity: 0.6 },

  // Find panel sits on the editor surface; CM's own panel theme uses fixed colors
  [lightDark(".cm-panels")]: { background: "transparent", color: "inherit" },
  [lightDark(".cm-panels-top")]: { borderBottom: `1px solid ${border}` },
  ".md-find": {
    display: "grid", gridTemplateColumns: "auto minmax(0, 1fr) auto", alignItems: "center", gap: ".35em .3em",
    padding: ".5em .4em", fontSize: ".85em",
  },
  ".md-find > [hidden]": { display: "none" },
  ".md-find-field": {
    display: "flex", alignItems: "center", gap: "2px", minWidth: 0, padding: "2px 2px 2px .6em",
    background: surface, border: `1px solid ${border}`, borderRadius: radius, transition: "border-color 150ms",
  },
  ".md-find-field:focus-within": { borderColor: accent },
  ".md-find-field[data-invalid]": { borderColor: red },
  ".md-find-replace": { gridColumn: "2", paddingInlineEnd: ".6em" },
  ".md-find-input": {
    flex: "1 1 auto", minWidth: "3em", padding: ".3em 0", border: "none", outline: "none", background: "transparent",
    color: "inherit", font: "inherit",
  },
  ".md-find-input::placeholder": { color: muted, opacity: 1 },
  ".md-find-tools": { display: "flex", alignItems: "center", gap: "2px" },
  ".md-find-btn": {
    display: "inline-flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box", minWidth: "2em", height: "2em",
    padding: "0 .35em", border: "none", borderRadius: radius, background: "transparent", color: muted, font: "inherit",
    cursor: "pointer", transition: "background-color 150ms, color 150ms",
  },
  ".md-find-btn .md-icon": { width: "1.3em", height: "1.3em" },
  ".md-find-btn:hover:not(:disabled)": { background: surface, color: text },
  ".md-find-btn:focus-visible": { outline: `2px solid ${accent}`, outlineOffset: "-2px" },
  ".md-find-btn:disabled": { opacity: 0.4, cursor: "default" },
  ".md-find-toggle": { minWidth: "1.75em", height: "1.75em" },
  ".md-find-toggle .md-icon": { width: "1.15em", height: "1.15em" },
  ".md-find-toggle[aria-pressed=true]": { background: tint(accent, 35), color: text },
  ".md-find-toggle[aria-pressed=true]:hover": { background: tint(accent, 45) },
  ".md-find-expand .md-icon": { transition: "transform 150ms" },
  ".md-find-expand[aria-expanded=true] .md-icon": { transform: "rotate(90deg)" },
  ".md-find-action": { padding: "0 .75em", background: surface, color: text, whiteSpace: "nowrap" },
  ".md-find-action:hover:not(:disabled)": { background: tint(accent, 25) },
  ".md-find-count": {
    minWidth: "4.5em", paddingInline: ".3em .4em", textAlign: "end", color: muted, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums",
  },
  ".md-find-count[data-empty]": { color: red },
  "@media (pointer: coarse)": {
    // 16px stops iOS zooming into the field
    ".md-find-input": { fontSize: "16px" },
    ".md-find-btn": { minWidth: "2.5em", height: "2.5em" },
  },
  [lightDark(".cm-content .cm-searchMatch")]: { backgroundColor: tint(accent, 25) },
  [lightDark(".cm-content .cm-searchMatch-selected")]: { backgroundColor: tint(accent, 50), outline: `1px solid ${accent}` },
})

export const mdTheme: Extension = [baseTheme, syntaxHighlighting(codeStyle)]
