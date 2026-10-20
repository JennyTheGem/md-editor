import { LanguageDescription } from "@codemirror/language"
import type { LanguageSupport } from "@codemirror/language"
import { commonmarkLanguage, markdown } from "@codemirror/lang-markdown"
import { GFM, parser } from "@lezer/markdown"
import type { DelimiterType, MarkdownConfig } from "@lezer/markdown"
import { COLOR_OPEN_RE } from "./colors.ts"
import { TIMESTAMP_RE } from "./timestamps/format.ts"

const TimestampSyntax: MarkdownConfig = {
  defineNodes: ["Timestamp"],
  parseInline: [{
    name: "Timestamp",
    before: "Link",
    parse(cx, next, pos) {
      if (next !== 64 || cx.char(pos + 1) !== 91) return -1
      const m = TIMESTAMP_RE.exec(cx.slice(pos, Math.min(cx.end, pos + 12)))
      return m ? cx.addElement(cx.elt("Timestamp", pos, pos + m[0].length)) : -1
    },
  }],
}

const UnderlineDelim: DelimiterType = { resolve: "Underline", mark: "UnderlineMark" }
const ColorDelim: DelimiterType = { resolve: "ColorText", mark: "ColorMark" }

const InlineTagSyntax: MarkdownConfig = {
  defineNodes: ["Underline", "UnderlineMark", "ColorText", "ColorMark"],
  parseInline: [{
    name: "MdInlineTags",
    before: "HTMLTag",
    parse(cx, next, pos) {
      if (next !== 60) return -1
      const s = cx.slice(pos, Math.min(cx.end, pos + 80))
      if (/^<u>/i.test(s)) return cx.addDelimiter(UnderlineDelim, pos, pos + 3, true, false)
      if (/^<\/u>/i.test(s)) return cx.addDelimiter(UnderlineDelim, pos, pos + 4, false, true)
      const m = COLOR_OPEN_RE.exec(s)
      if (m) return cx.addDelimiter(ColorDelim, pos, pos + m[0].length, true, false)
      if (/^<\/span>/i.test(s)) return cx.addDelimiter(ColorDelim, pos, pos + 7, false, true)
      return -1
    },
  }],
}

const SupDelim: DelimiterType = { resolve: "Superscript", mark: "SuperscriptMark" }
const space = (c: number) => c === -1 || c === 32 || c === 9 || c === 10
const alnum = (c: number) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)

const SuperscriptSyntax: MarkdownConfig = {
  defineNodes: ["Superscript", "SuperscriptMark"],
  parseInline: [{
    name: "MdSuperscript",
    parse(cx, next, pos) {
      if (next !== 94) return -1
      const before = pos > cx.offset ? cx.char(pos - 1) : -1
      const after = cx.char(pos + 1)
      // '^^' stays literal
      if (after === 94 || before === 94) return -1
      const open = !space(after) && before !== 91
      const close = before !== -1 && !space(before) && !alnum(after)
      return open || close ? cx.addDelimiter(SupDelim, pos, pos + 1, open, close) : -1
    },
  }],
}

export const MD_SYNTAX: MarkdownConfig[] = [...GFM, TimestampSyntax, InlineTagSyntax, SuperscriptSyntax, { remove: ["SetextHeading"] }]

export const mdParser = parser.configure(MD_SYNTAX)

export const defaultCodeLanguages: readonly LanguageDescription[] = [
  LanguageDescription.of({
    name: "JavaScript",
    alias: ["js", "javascript", "mjs", "cjs", "jsx"],
    load: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ jsx: true })),
  }),
  LanguageDescription.of({
    name: "TypeScript",
    alias: ["ts", "typescript", "tsx"],
    load: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ typescript: true, jsx: true })),
  }),
  LanguageDescription.of({ name: "CSS", alias: ["css"], load: () => import("@codemirror/lang-css").then((m) => m.css()) }),
  LanguageDescription.of({ name: "HTML", alias: ["html", "htm"], load: () => import("@codemirror/lang-html").then((m) => m.html()) }),
  LanguageDescription.of({ name: "JSON", alias: ["json"], load: () => import("@codemirror/lang-json").then((m) => m.json()) }),
  LanguageDescription.of({ name: "Python", alias: ["py", "python"], load: () => import("@codemirror/lang-python").then((m) => m.python()) }),
]

// Never markdownLanguage: its Emoji extension parses "1:23:45"
export function createMarkdown(codeLanguages: readonly LanguageDescription[] = defaultCodeLanguages): LanguageSupport {
  return markdown({
    base: commonmarkLanguage,
    extensions: MD_SYNTAX,
    codeLanguages: [...codeLanguages],
    completeHTMLTags: false,
    addKeymap: true,
  })
}
