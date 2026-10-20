import { WidgetType } from "@codemirror/view"

// Same CSS mask as createPillDom
export function setIcon(el: HTMLElement, url: string): void {
  const value = `url("${url.replace(/["\\]/g, "\\$&")}")`
  el.style.setProperty("mask-image", value)
  el.style.setProperty("-webkit-mask-image", value)
}

export class BulletWidget extends WidgetType {
  eq(_other: BulletWidget): boolean {
    return true
  }

  toDOM(): HTMLElement {
    const el = document.createElement("span")
    el.className = "md-bullet"
    el.setAttribute("aria-hidden", "true")
    el.textContent = "•"
    return el
  }

  ignoreEvent(): boolean {
    return false
  }
}

export class CheckboxWidget extends WidgetType {
  readonly checked: boolean
  readonly label: string

  constructor(checked: boolean, label: string) {
    super()
    this.checked = checked
    this.label = label
  }

  eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked && other.label === this.label
  }

  toDOM(): HTMLElement {
    const el = document.createElement("span")
    el.className = this.checked ? "md-task md-task-checked" : "md-task"
    el.setAttribute("role", "checkbox")
    el.setAttribute("aria-checked", String(this.checked))
    el.setAttribute("aria-label", this.label)
    return el
  }

  ignoreEvent(): boolean {
    return false
  }
}

export class CodeHeaderWidget extends WidgetType {
  readonly lang: string
  readonly copyLabel: string
  readonly icon: string | undefined

  constructor(lang: string, copyLabel: string, icon?: string) {
    super()
    this.lang = lang
    this.copyLabel = copyLabel
    this.icon = icon
  }

  eq(other: CodeHeaderWidget): boolean {
    return other.lang === this.lang && other.copyLabel === this.copyLabel && other.icon === this.icon
  }

  toDOM(): HTMLElement {
    const header = document.createElement("span")
    header.className = "md-code-header"
    header.setAttribute("contenteditable", "false")
    if (this.lang) {
      const lang = document.createElement("span")
      lang.className = "md-code-lang"
      lang.textContent = this.lang
      header.append(lang)
    }
    const btn = document.createElement("button")
    btn.className = "md-copy"
    btn.type = "button"
    btn.tabIndex = -1
    btn.setAttribute("aria-label", this.copyLabel)
    btn.title = this.copyLabel
    if (this.icon) {
      const mark = document.createElement("span")
      mark.className = "md-icon"
      mark.setAttribute("aria-hidden", "true")
      setIcon(mark, this.icon)
      btn.append(mark)
    } else {
      btn.textContent = this.copyLabel
    }
    header.append(btn)
    return header
  }

  ignoreEvent(): boolean {
    return false
  }
}
