import { parseTimestamp } from "./format.ts"

export function createPillDom(time: string, label: string, icon?: string): HTMLSpanElement {
  const pill = document.createElement("span")
  pill.className = "md-ts"
  pill.setAttribute("role", "button")
  pill.setAttribute("aria-label", label)
  pill.title = label
  pill.dataset.seconds = String(parseTimestamp(time) ?? 0)
  if (icon) {
    const mark = document.createElement("span")
    mark.className = "md-icon"
    mark.setAttribute("aria-hidden", "true")
    const url = `url("${icon.replace(/["\\]/g, "\\$&")}")`
    mark.style.setProperty("mask-image", url)
    mark.style.setProperty("-webkit-mask-image", url)
    pill.append(mark)
  }
  pill.append(document.createTextNode(time))
  return pill
}
