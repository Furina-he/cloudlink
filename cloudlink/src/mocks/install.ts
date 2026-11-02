// Mock 后端（PRD 7.8）：在普通浏览器里模拟全部 IPC 命令与 9 个事件
import { mockIPC } from "@tauri-apps/api/mocks"

import { agentHandlers } from "./handlers-agents"
import { cliHandlers } from "./handlers-cli"
import { connectionHandlers } from "./handlers-connection"
import { miscHandlers } from "./handlers-misc"
import { probeHandlers } from "./handlers-probe"
import { serverHandlers } from "./handlers-servers"
import { db, fail, LATENCY, recompile, scenario, sleep } from "./state"

let failListAssets = scenario === "fail" ? 2 : 0

type Args = Record<string, unknown>

const handlers: Record<string, (args: Args) => unknown> = {
  detect_environments: () => db.environments,
  list_ssh_hosts: () => db.sshHosts,
  list_assets: () => {
    if (failListAssets > 0) {
      failListAssets--
      fail("internal", { message: "database is locked" })
    }
    return db.assets
  },
  ...serverHandlers,
  ...cliHandlers,
  ...connectionHandlers,
  ...probeHandlers,
  ...agentHandlers,
  ...miscHandlers,
}

export function installMocks() {
  // 启动时算一次列入和编译状态，不发事件（前端还没订阅）
  recompile({ silent: true })
  mockIPC(
    async (cmd, payload) => {
      const handler = handlers[cmd]
      if (!handler) {
        console.warn(`[mock] 未实现的命令：${cmd}`)
        return null
      }
      await sleep(LATENCY)
      // 返回副本，避免界面层意外改到 Mock 数据库
      return structuredClone(await handler((payload ?? {}) as Args))
    },
    { shouldMockEvents: true }
  )
}
