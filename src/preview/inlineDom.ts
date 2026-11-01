import type { SyntaxNode } from "@lezer/common"
import { colorOfOpenTag } from "../colors.ts"
import { parseTimestamp } from "../timestamps/format.ts"
import { createPillDom } from "../timestamps/pillDom.ts"

// pills: false renders timestamps as plain text (timestamps are opt-in).
// links and timestampHref are for static export: real anchors instead of editor spans.
export type InlineCtx = { jump: string; icon?: string; pills?: boolean; links?: boolean; timestampHref?: (seconds: number) => string | null }

const WRAPS: Readonly<Record<string, readonly [tag: string, cls: string]>> = {
  StrongEmphasis: ["strong", "md-strong"],
  Emphasis: ["em", "md-em"],
  Strikethrough: ["s", "md-strike"],
  Underline: ["u", "md-underline"],
  Superscript: ["sup", "md-sup"],
}

const HIDDEN = new Set(["EmphasisMark", "StrikethroughMark", "UnderlineMark", "SuperscriptMark", "ColorMark", "CodeMark", "LinkMark", "LinkTitle", "HeaderMark", "QuoteMark"])

function el(tag: string, cls?: string): HTMLElement {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  return e
}

// http(s) and mailto only, a bare "www." gets https
function safeHref(url: string): string | null {
  const u = /^www\./i.test(url) ? `https://${url}` : url
  return /^(https?:|mailto:)/i.test(u) ? u : null
}

function linkEl(url: string, ctx: InlineCtx): HTMLElement {
  const href = ctx.links ? safeHref(url) : null
  const e = el(href ? "a" : "span", "md-link")
  if (href) e.setAttribute("href", href)
  return e
}

export function appendInline(parent: HTMLElement, src: string, container: SyntaxNode, from: number, to: number, ctx: InlineCtx): void {
  let pos = from
  for (let n = container.firstChild; n && n.from < to; n = n.nextSibling) {
    if (n.to <= from) continue
    if (n.from > pos) parent.append(src.slice(pos, n.from))
    renderNode(parent, src, n, ctx)
    pos = Math.max(pos, n.to)
  }
  if (to > pos) parent.append(src.slice(pos, to))
}

function renderNode(parent: HTMLElement, src: string, n: SyntaxNode, ctx: InlineCtx): void {
  const wrap = WRAPS[n.name]
  if (wrap) {
    const e = el(wrap[0], wrap[1])
    appendInline(e, src, n, n.from, n.to, ctx)
    parent.append(e)
    return
  }
  switch (n.name) {
    case "TableCell":
      appendInline(parent, src, n, n.from, n.to, ctx)
      return
    case "InlineCode": {
      const open = n.firstChild, close = n.lastChild
      const e = el("code", "md-code-inline")
      e.textContent = src.slice(open?.to ?? n.from, close && close !== open ? close.from : n.to)
      parent.append(e)
      return
    }
    case "ColorText": {
      const open = n.firstChild
      const color = open?.name === "ColorMark" ? colorOfOpenTag(src.slice(open.from, open.to)) : null
      const e = el("span", color ? `md-color-${color}` : undefined)
      appendInline(e, src, n, n.from, n.to, ctx)
      parent.append(e)
      return
    }
    case "Link": {
      const marks = n.getChildren("LinkMark")
      // Bare brackets like '[^1]' or '[1:99]' stay literal
      const url = n.getChild("URL")
      if (marks.length < 2 || !url) break
      const e = linkEl(src.slice(url.from, url.to), ctx)
      appendInline(e, src, n, marks[0].to, marks[1].from, ctx)
      parent.append(e)
      return
    }
    case "URL": {
      const e = linkEl(src.slice(n.from, n.to), ctx)
      e.textContent = src.slice(n.from, n.to)
      parent.append(e)
      return
    }
    case "Timestamp": {
      const time = src.slice(n.from + 2, n.to - 1)
      if (ctx.timestampHref) {
        const href = ctx.timestampHref(parseTimestamp(time) ?? 0)
        const e = el(href ? "a" : "span", "md-ts")
        if (href) e.setAttribute("href", href)
        e.textContent = time
        parent.append(e)
        return
      }
      if (ctx.pills === false) break
      parent.append(createPillDom(time, ctx.jump.replace("$1", time), ctx.icon))
      return
    }
    case "Escape":
      parent.append(src.slice(n.from + 1, n.to))
      return
  }
  if (!HIDDEN.has(n.name)) parent.append(src.slice(n.from, n.to))
}
