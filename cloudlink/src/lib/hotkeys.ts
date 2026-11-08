// 快捷键表（PRD 6.9）。组件里用 useHotkeys(HOTKEYS.x, fn, HOTKEY_OPTIONS) 绑定，提示文字用 Kbd 渲染 KEY_HINT
import type { Options } from "react-hotkeys-hook"

import type { ViewId } from "@/lib/copy"

export const HOTKEYS = {
  command: "mod+k",
  newServer: "mod+n",
  save: "mod+s",
  preview: "mod+backslash",
  focusSearch: "slash",
  views: "mod+1, mod+2, mod+3, mod+4",
  search: "mod+f",
  navPosition: "mod+shift+s",
  settings: "mod+comma",
  escape: "escape",
} as const

export const VIEW_BY_DIGIT: Record<string, ViewId> = {
  "1": "servers",
  "2": "agents",
  "3": "activity",
  "4": "settings",
}

/** 全局快捷键在输入框里也生效，并阻止浏览器默认行为（如 Ctrl+S 保存网页） */
export const HOTKEY_OPTIONS: Options = { preventDefault: true, enableOnFormTags: true }

/** 「/」这类单键：在输入框里要能正常输入，所以不在表单控件里触发 */
export const SINGLE_KEY_OPTIONS: Options = { preventDefault: true }

/** 有确认对话框打开时（添加弹窗里的主机指纹、Include 同意），弹窗自己的快捷键也让给它 */
export function isAlertOpen(): boolean {
  return document.querySelector("[role=alertdialog][data-open]") !== null
}

/** 有模态对话框或 Sheet 打开时，视图快捷键不响应，交给浮层自己处理 */
export function isModalOpen(): boolean {
  return document.querySelector("[role=dialog][data-open], [role=alertdialog][data-open]") !== null
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
const MOD = isMac ? "⌘" : "Ctrl"

/** 键位提示，按 KbdGroup 拆成多个 Kbd */
export const KEY_HINT = {
  command: [MOD, "K"],
  newServer: [MOD, "N"],
  save: [MOD, "S"],
  preview: [MOD, "\\"],
  focusSearch: ["/"],
  navPosition: [MOD, "Shift", "S"],
  view: (n: number) => [MOD, String(n)],
} as const
