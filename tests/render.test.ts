import { describe, expect, it } from "vitest"
import { renderMarkdown } from "../src/render.ts"

const html = (doc: string, href?: (s: number) => string | null) =>
  renderMarkdown(doc, { timestampHref: href, phrases: { Tip: "Tipp" } }).innerHTML

describe("renderMarkdown", () => {
  it("renders headings, emphasis, color and lists", () => {
    expect(html("## Title ##")).toBe("<h2>Title</h2>")
    expect(html("# Round 1\n\nx")).toBe("<h1>Round 1</h1><p>x</p>")
    expect(html("**bold** <span style=\"color:#e06c75\">red</span>")).toBe('<p><strong class="md-strong">bold</strong> <span class="md-color-red">red</span></p>')
    expect(html("3. a\n4. b")).toBe('<ol start="3"><li><p>a</p></li><li><p>b</p></li></ol>')
  })

  it("renders tasks with their state", () => {
    const out = html("- [x] done\n- [ ] open")
    expect(out).toContain('<li class="md-task md-task-done"><p><span class="md-task-box" role="checkbox" aria-checked="true" aria-disabled="true">✓</span> done</p></li>')
    expect(out).toContain('aria-checked="false"')
  })

  it("links timestamps when given an href, plain text otherwise", () => {
    expect(html("at @[1:23]", (s) => `https://v.example/?t=${s}`)).toBe('<p>at <a class="md-ts" href="https://v.example/?t=83">1:23</a></p>')
    expect(html("at @[1:23]", () => null)).toBe('<p>at <span class="md-ts">1:23</span></p>')
  })

  it("only links safe urls", () => {
    expect(html("[a](https://x.dev) [b](javascript:alert(1))")).toBe('<p><a class="md-link" href="https://x.dev">a</a> <span class="md-link">b</span></p>')
  })

  it("keeps raw html as text", () => {
    const root = renderMarkdown('<img src=x onerror="alert(1)">\n\nhi <b onclick="x">b</b>')
    expect(root.querySelector("img, b")).toBeNull()
    expect(root.textContent).toContain("<img src=x")
  })

  it("renders callouts, quotes, code and tables", () => {
    expect(html("> [!tip]\n> body")).toBe('<div class="md-callout md-callout-tip"><div class="md-callout-title">Tipp</div><p> body</p></div>')
    expect(html("> [!warning] Careful\n> - item")).toContain('<div class="md-callout-title">Careful</div><ul><li><p>item</p></li></ul>')
    expect(html("> quoted")).toBe("<blockquote><p>quoted</p></blockquote>")
    expect(html("```js\nlet a = 1\n```")).toBe('<pre class="md-code-block"><code>let a = 1</code></pre>')
    expect(html("| a | b |\n| - | - |\n| @[0:05] | 2 |", () => "#t")).toContain('<td data-row="1" data-col="0"><a class="md-ts" href="#t">0:05</a></td>')
  })

  it("drops quote marks and indent inside blocks, reads CRLF", () => {
    const code = (doc: string) => renderMarkdown(doc).querySelector("code")?.textContent
    expect(code("> ```\n> a\n>\n> b\n> ```")).toBe("a\n\nb")
    expect(code("- x\n  ```\n  a\n\n    b\n  ```")).toBe("a\n\n  b")
    expect(code("        deep\n    flat")).toBe("    deep\nflat")
    expect(html("> [!tip] T\n> | a |\n> | - |\n> | 1 |")).toContain("<td")
    expect(html("> [!tip]\r\n> body\r\n")).toBe('<div class="md-callout md-callout-tip"><div class="md-callout-title">Tipp</div><p> body</p></div>')
  })
})
