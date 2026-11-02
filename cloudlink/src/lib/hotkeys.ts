// 快捷键表（PRD 6.9）。组件里用 useHotkeys(HOTKEYS.x, fn, HOTKEY_OPTIONS) 绑定，提示文字用 Kbd 渲染 KEY_HINT
import type { Options } from "react-hotkeys-hook"

import type { ViewId } from "@/lib/copy"

export const HOTKEYS = {
  command: "mod+k",
  newServer: "mod+n",
  save: "mod+s",
  /** shadcn Sidebar 内置，这里只用于提示 */
  sidebar: "mod+b",
  preview: "mod+backslash",
  focusSearch: "slash",
  views: "mod+1, mod+2, mod+3",
  escape: "escape",
} as const

export const VIEW_BY_DIGIT: Record<string, ViewId> = {
  "1": "servers",
  "2": "agents",
  "3": "settings",
}

/** 全局快捷键在输入框里也生效，并阻止浏览器默认行为（如 Ctrl+S 保存网页） */
export const HOTKEY_OPTIONS: Options = { preventDefault: true, enableOnFormTags: true }

/** 「/」这类单键：在输入框里要能正常输入，所以不在表单控件里触发 */
export const SINGLE_KEY_OPTIONS: Options = { preventDefault: true }

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
  sidebar: [MOD, "B"],
  preview: [MOD, "\\"],
  focusSearch: ["/"],
  view: (n: number) => [MOD, String(n)],
} as const
