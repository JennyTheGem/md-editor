import { EditorState } from "@codemirror/state"
import type { SyntaxNode } from "@lezer/common"
import type { MdPhrase } from "./phrases.ts"
import { CALLOUT_LABELS, calloutOf } from "./preview/callouts.ts"
import { appendInline } from "./preview/inlineDom.ts"
import type { InlineCtx } from "./preview/inlineDom.ts"
import { renderTable } from "./preview/tables.ts"
import { mdParser } from "./syntax.ts"

export interface RenderOptions {
  // A timestamp's link, or null for plain text
  timestampHref?: (seconds: number) => string | null
  phrases?: Partial<Record<MdPhrase, string>>
}

function el(tag: string, cls?: string): HTMLElement {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  return e
}

// The doc as static elements for print or export, parsed like the editor. Text only goes in as text nodes.
export function renderMarkdown(text: string, options: RenderOptions = {}): HTMLElement {
  const state = EditorState.create({ doc: text })
  // CRLF as "\n", so positions match the state
  const doc = state.doc.toString()
  const ctx: InlineCtx = { jump: "", links: true, timestampHref: options.timestampHref ?? (() => null) }
  const phrase = (p: MdPhrase) => options.phrases?.[p] ?? p

  const space = (pos: number) => doc[pos] === " " || doc[pos] === "\t"
  const skipSpace = (pos: number) => {
    while (space(pos)) pos++
    return pos
  }
  const trimBack = (pos: number, min: number) => {
    while (pos > min && space(pos - 1)) pos--
    return pos
  }

  const inline = (tag: string, n: SyntaxNode, from: number, to = n.to): HTMLElement => {
    const e = el(tag)
    appendInline(e, doc, n, from, to, ctx)
    return e
  }

  const blocks = (parent: HTMLElement, node: SyntaxNode, start = node.from) => {
    for (let n = node.firstChild; n; n = n.nextSibling) if (n.from >= start) block(parent, n)
  }

  const quote = (n: SyntaxNode): HTMLElement => {
    const c = calloutOf(state, n)
    const para = n.getChild("Paragraph")
    if (!c || !para) {
      const e = el("blockquote")
      blocks(e, n)
      return e
    }
    const box = el("div", `md-callout md-callout-${c.type}`)
    const line = state.doc.lineAt(c.to)
    const title = box.appendChild(el("div", "md-callout-title"))
    if (c.title) appendInline(title, doc, para, c.to, line.to, ctx)
    else title.textContent = phrase(CALLOUT_LABELS[c.type])
    if (line.to < para.to) appendInline(box.appendChild(el("p")), doc, para, line.to + 1, para.to, ctx)
    blocks(box, n, para.to)
    return box
  }

  const task = (li: HTMLElement, n: SyntaxNode) => {
    const marker = n.getChild("TaskMarker")
    const done = !!marker && /x/i.test(doc.slice(marker.from, marker.to))
    li.className = done ? "md-task md-task-done" : "md-task"
    const box = el("span", "md-task-box")
    box.setAttribute("role", "checkbox")
    box.setAttribute("aria-checked", String(done))
    box.setAttribute("aria-disabled", "true")
    if (done) box.textContent = "✓"
    const p = li.appendChild(el("p"))
    p.append(box)
    appendInline(p, doc, n, marker?.to ?? n.from, n.to, ctx)
  }

  const list = (n: SyntaxNode): HTMLElement => {
    const e = el(n.name === "OrderedList" ? "ol" : "ul")
    const items = n.getChildren("ListItem")
    const mark = items[0]?.getChild("ListMark")
    const start = n.name === "OrderedList" && mark ? parseInt(doc.slice(mark.from, mark.to), 10) : 1
    if (Number.isFinite(start) && start !== 1) e.setAttribute("start", String(start))
    for (const item of items) {
      const li = e.appendChild(el("li"))
      for (let c = item.firstChild; c; c = c.nextSibling) {
        if (c.name === "Task") task(li, c)
        else block(li, c)
      }
    }
    return e
  }

  // Between code lines only their line breaks, no quote marks or indent
  const code = (n: SyntaxNode): HTMLElement => {
    let raw = "", pos = -1
    for (const t of n.getChildren("CodeText")) {
      if (pos >= 0) raw += doc.slice(pos, t.from).replace(/[^\n]/g, "")
      raw += doc.slice(t.from, t.to)
      pos = t.to
    }
    const pre = el("pre", "md-code-block")
    pre.appendChild(el("code")).textContent = raw
    return pre
  }

  const block = (parent: HTMLElement, n: SyntaxNode): void => {
    const level = /^ATXHeading(\d)$/.exec(n.name)?.[1]
    if (level) {
      const open = n.firstChild?.name === "HeaderMark" ? n.firstChild : null
      const last = n.lastChild
      const close = last?.name === "HeaderMark" && last.from !== open?.from ? last : null
      const from = skipSpace(open?.to ?? n.from)
      parent.append(inline(`h${level}`, n, from, trimBack(close?.from ?? n.to, from)))
      return
    }
    switch (n.name) {
      case "Paragraph":
        parent.append(inline("p", n, n.from))
        return
      case "HTMLBlock":
      case "LinkReference":
        parent.appendChild(el("p")).textContent = doc.slice(n.from, n.to)
        return
      case "Blockquote":
        parent.append(quote(n))
        return
      case "BulletList":
      case "OrderedList":
        parent.append(list(n))
        return
      case "FencedCode":
      case "CodeBlock":
        parent.append(code(n))
        return
      case "HorizontalRule":
        parent.append(el("hr"))
        return
      case "Table": {
        // Rows only, so a table in a quote parses on its own
        const rows: string[] = []
        for (let c = n.firstChild; c; c = c.nextSibling) if (c.name !== "QuoteMark") rows.push(doc.slice(c.from, c.to))
        parent.append(renderTable(rows.join("\n"), ctx))
        return
      }
    }
  }

  const root = el("div", "md-doc")
  blocks(root, mdParser.parse(doc).topNode)
  return root
}
