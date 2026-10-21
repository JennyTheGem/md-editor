import {
  SearchQuery, closeSearchPanel, findNext, findPrevious, getSearchQuery, gotoLine, openSearchPanel, replaceAll, replaceNext,
  search, searchKeymap, setSearchQuery,
} from "@codemirror/search"
import type { Extension } from "@codemirror/state"
import { keymap, runScopeHandlers } from "@codemirror/view"
import type { Command, EditorView, Panel, ViewUpdate } from "@codemirror/view"
import { mdConfig } from "./options.ts"
import type { MdIcons } from "./options.ts"
import type { MdPhrase } from "./phrases.ts"
import { setIcon } from "./preview/widgets.ts"

// Counting stops here, so a huge doc stays responsive
const MAX_COUNT = 999

type Toggle = "caseSensitive" | "wholeWord" | "regexp"

const panels = new WeakMap<EditorView, FindPanel>()

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value)
  return node
}

class FindPanel implements Panel {
  readonly dom: HTMLElement
  readonly top = true
  private query: SearchQuery
  private readonly find: HTMLInputElement
  private readonly replace: HTMLInputElement
  private readonly field: HTMLElement
  private readonly count: HTMLElement
  private readonly expand: HTMLButtonElement
  private readonly replaceRow: HTMLElement[]
  private readonly needsMatch: HTMLButtonElement[]
  private readonly toggles: Record<Toggle, HTMLButtonElement>

  private readonly view: EditorView

  constructor(view: EditorView) {
    this.view = view
    this.query = getSearchQuery(view.state)
    const icons = view.state.facet(mdConfig).icons
    const button = (cls: string, label: MdPhrase, icon: keyof MdIcons | null, run: () => void) => {
      const b = el("button", `md-find-btn ${cls}`, { type: "button" })
      const url = icon && icons[icon]
      if (url) {
        const mark = el("span", "md-icon", { "aria-hidden": "true" })
        setIcon(mark, url)
        b.append(mark)
        b.setAttribute("aria-label", this.phrase(label))
        b.title = this.phrase(label)
      } else {
        b.textContent = this.phrase(label)
      }
      b.addEventListener("click", run)
      return b
    }
    const input = (name: string, label: MdPhrase, value: string) => {
      const i = el("input", "md-find-input", { name, type: "text", placeholder: this.phrase(label), "aria-label": this.phrase(label), spellcheck: "false" })
      i.value = value
      i.addEventListener("input", () => this.commit())
      return i
    }
    const toggle = (key: Toggle, label: MdPhrase, icon: keyof MdIcons) => {
      const b = button("md-find-toggle", label, icon, () => {
        b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true"))
        this.commit()
      })
      b.setAttribute("aria-pressed", String(this.query[key]))
      return b
    }

    this.find = input("search", "Find", this.query.search)
    // CM focuses and selects [main-field] when the panel opens
    this.find.setAttribute("main-field", "true")
    this.replace = input("replace", "Replace", this.query.replace)
    this.toggles = {
      caseSensitive: toggle("caseSensitive", "match case", "matchCase"),
      wholeWord: toggle("wholeWord", "by word", "wholeWord"),
      regexp: toggle("regexp", "regexp", "regexp"),
    }
    this.field = el("div", "md-find-field")
    this.field.append(this.find, this.toggles.caseSensitive, this.toggles.wholeWord, this.toggles.regexp)
    this.count = el("span", "md-find-count")

    const prev = button("", "previous", "findPrev", () => findPrevious(view))
    const next = button("", "next", "findNext", () => findNext(view))
    const close = button("", "close", "close", () => closeSearchPanel(view))
    const tools = el("div", "md-find-tools")
    tools.append(this.count, prev, next, close)

    this.expand = button("md-find-expand", "Toggle replace", "expand", () => this.showReplace(this.expand.getAttribute("aria-expanded") !== "true", true))
    this.expand.setAttribute("aria-expanded", "false")
    const replaceField = el("div", "md-find-field md-find-replace")
    replaceField.append(this.replace)
    const one = button("md-find-action", "replace", null, () => replaceNext(view))
    const all = button("md-find-action", "replace all", null, () => replaceAll(view))
    const actions = el("div", "md-find-tools")
    actions.append(one, all)
    this.replaceRow = [replaceField, actions]
    this.needsMatch = [prev, next, one, all]

    this.dom = el("div", "md-find", { role: "search", "aria-label": this.phrase("Find") })
    this.dom.append(this.expand, this.field, tools, ...this.replaceRow)
    this.dom.addEventListener("keydown", (e) => this.keydown(e))
    this.expand.hidden = view.state.readOnly
    this.showReplace(false, false)
    this.recount()
    panels.set(view, this)
  }

  // CM only focuses [main-field] when the panel is already open
  mount(): void {
    this.find.focus()
    this.find.select()
  }

  private phrase(p: MdPhrase, ...insert: unknown[]): string {
    return this.view.state.phrase(p, ...insert)
  }

  showReplace(open: boolean, focus: boolean): void {
    const show = open && !this.view.state.readOnly
    for (const node of this.replaceRow) node.hidden = !show
    this.expand.setAttribute("aria-expanded", String(show))
    if (show && focus) {
      this.replace.focus()
      this.replace.select()
    }
  }

  private commit(): void {
    const pressed = (key: Toggle) => this.toggles[key].getAttribute("aria-pressed") === "true"
    const query = new SearchQuery({
      search: this.find.value, replace: this.replace.value,
      caseSensitive: pressed("caseSensitive"), wholeWord: pressed("wholeWord"), regexp: pressed("regexp"),
    })
    if (query.eq(this.query)) return
    this.query = query
    this.view.dispatch({ effects: setSearchQuery.of(query) })
  }

  private keydown(e: KeyboardEvent): void {
    if (runScopeHandlers(this.view, e, "search-panel")) e.preventDefault()
    else if (e.key === "Enter" && e.target === this.find) {
      e.preventDefault();
      (e.shiftKey ? findPrevious : findNext)(this.view)
    } else if (e.key === "Enter" && e.target === this.replace) {
      e.preventDefault()
      replaceNext(this.view)
    }
  }

  private recount(): void {
    const { state } = this.view
    const query = this.query
    let total = 0
    let current = 0
    if (query.search && query.valid) {
      const { from, to } = state.selection.main
      const cursor = query.getCursor(state)
      for (let m = cursor.next(); !m.done && total < MAX_COUNT; m = cursor.next()) {
        total++
        if (m.value.from === from && m.value.to === to) current = total
      }
    }
    const searched = query.search !== ""
    this.count.textContent = !searched ? "" : total
      ? this.phrase("$1 of $2", current || "?", total < MAX_COUNT ? total : `${MAX_COUNT}+`)
      : this.phrase("No results")
    this.count.toggleAttribute("data-empty", searched && !total)
    this.field.toggleAttribute("data-invalid", searched && !query.valid)
    this.find.setAttribute("aria-invalid", String(searched && !query.valid))
    for (const b of this.needsMatch) b.disabled = !total
  }

  update(update: ViewUpdate): void {
    const query = getSearchQuery(update.state)
    if (query !== getSearchQuery(update.startState) && !query.eq(this.query)) this.setQuery(query)
    if (update.docChanged || update.selectionSet || query !== getSearchQuery(update.startState)) this.recount()
  }

  private setQuery(query: SearchQuery): void {
    this.query = query
    this.find.value = query.search
    this.replace.value = query.replace
    for (const key of Object.keys(this.toggles) as Toggle[]) this.toggles[key].setAttribute("aria-pressed", String(query[key]))
  }

  destroy(): void {
    panels.delete(this.view)
  }
}

export const openFind: Command = openSearchPanel

export const openReplacePanel: Command = (view) => {
  openSearchPanel(view)
  panels.get(view)?.showReplace(true, true)
  return true
}

// No go-to-line: Ctrl+Alt is AltGr on German Windows. Cmd+H hides the app on macOS, so replace is Cmd+Alt+F there.
export const findReplace: Extension = [
  search({ top: true, createPanel: (view) => new FindPanel(view) }),
  keymap.of([
    ...searchKeymap.filter((b) => b.run !== gotoLine),
    { key: "Mod-h", mac: "Mod-Alt-f", run: openReplacePanel, scope: "editor search-panel" },
  ]),
]
