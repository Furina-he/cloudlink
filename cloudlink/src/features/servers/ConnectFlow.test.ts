import { describe, expect, it } from "vitest"

import type { KeyCheck } from "@/bindings"
import type { ConnectionTest } from "@/stores/connection"
import { connectSteps, stepOfError } from "./ConnectFlow"

const base: ConnectionTest = { testId: "tst", status: "running", signature: "{}", alias: "hk-edge" }
const okKey: KeyCheck = { status: "ok", keyType: "ED25519", fingerprint: "SHA256:key" }
const states = (steps: ReturnType<typeof connectSteps>) => steps.map((s) => `${s.id}:${s.state}`)

describe("连接过程的步骤（PRD 6.5）", () => {
  it("私钥方式多一步「检查私钥」，进行中时停在连接", () => {
    const steps = connectSteps({ method: "key", test: base, keyCheck: okKey, enable: null, dirs: 2 })
    expect(states(steps)).toEqual(["key:done", "reach:running", "hostKey:pending", "login:pending", "sync:pending"])
    expect(steps[0].detail).toBe("ED25519")
    const password = connectSteps({ method: "password", test: base, keyCheck: null, enable: null, dirs: 2 })
    expect(states(password)[0]).toBe("reach:running")
  })

  it("还没有预检结果时先检查私钥", () => {
    expect(states(connectSteps({ method: "key", test: base, keyCheck: null, enable: null, dirs: 0 })).slice(0, 2)).toEqual([
      "key:running",
      "reach:pending",
    ])
  })

  it("第一次连接时停在指纹，等用户核对；密钥变更时阻断后面的步骤", () => {
    const fresh = { ...base, status: "host-key" as const, hostKey: { fingerprint: "SHA256:new", known: "new" as const } }
    expect(states(connectSteps({ method: "password", test: fresh, keyCheck: null, enable: null, dirs: 0 }))).toEqual([
      "reach:done",
      "hostKey:attention",
      "login:pending",
      "convert:pending",
      "sync:pending",
    ])
    const changed = { ...fresh, hostKey: { fingerprint: "SHA256:other", known: "changed" as const } }
    expect(states(connectSteps({ method: "password", test: changed, keyCheck: null, enable: null, dirs: 0 }))).toEqual([
      "reach:done",
      "hostKey:failed",
      "login:skipped",
      "convert:skipped",
      "sync:skipped",
    ])
  })

  it("信任之后指纹这一步立即完成，正在登录", () => {
    const trusting = { ...base, hostKey: { fingerprint: "SHA256:new", known: "trusted" as const } }
    const steps = connectSteps({ method: "key", test: trusting, keyCheck: okKey, enable: null, dirs: 0 })
    expect(states(steps)).toEqual(["key:done", "reach:done", "hostKey:done", "login:running", "sync:pending"])
  })

  it("失败停在出错的那一步，之前的完成、之后的未执行", () => {
    const failed = (id: Parameters<typeof stepOfError>[0], hostKey?: ConnectionTest["hostKey"]) =>
      states(
        connectSteps({
          method: "key",
          test: { ...base, status: "failed", error: { id }, hostKey },
          keyCheck: okKey,
          enable: null,
          dirs: 0,
        })
      )
    expect(failed("key-permissions")).toEqual(["key:failed", "reach:skipped", "hostKey:skipped", "login:skipped", "sync:skipped"])
    expect(failed("timeout")).toEqual(["key:done", "reach:failed", "hostKey:skipped", "login:skipped", "sync:skipped"])
    expect(failed("auth-failed", { fingerprint: "SHA256:new", known: "trusted" })).toEqual([
      "key:done",
      "reach:done",
      "hostKey:done",
      "login:failed",
      "sync:skipped",
    ])
  })

  it("沿用 known_hosts 时写明记录的名字；启用阶段显示正在做什么", () => {
    const ok: ConnectionTest = {
      ...base,
      status: "ok",
      ms: 820,
      remoteOs: "Ubuntu 24.04 LTS",
      hostKey: { fingerprint: "SHA256:known", known: "adopted", knownAs: "141.148.177.189" },
    }
    const steps = connectSteps({ method: "password", test: ok, keyCheck: null, enable: "converting", dirs: 2 })
    expect(states(steps)).toEqual(["reach:done", "hostKey:done", "login:done", "convert:running", "sync:pending"])
    expect(steps[1].detail).toContain("141.148.177.189")
    expect(steps[2].detail).toContain("Ubuntu 24.04 LTS")
    expect(steps[3].detail).toContain("密钥")
    const syncing = connectSteps({ method: "password", test: ok, keyCheck: null, enable: "enabling", dirs: 2 })
    expect(states(syncing).slice(-2)).toEqual(["convert:done", "sync:running"])
    expect(syncing.at(-1)?.detail).toContain("2 个目录")
  })

  it("还没加入 SSH 配置时多一步「让 Agent 能用别名连接」，停在这一步等用户决定（F-107 AC1）", () => {
    const ok: ConnectionTest = { ...base, status: "ok", ms: 300 }
    const at = (include: Parameters<typeof connectSteps>[0]["include"], enable: Parameters<typeof connectSteps>[0]["enable"] = null) =>
      states(connectSteps({ method: "agent", test: ok, keyCheck: null, enable, dirs: 2, include }))
    expect(at(null)).toEqual(["reach:done", "hostKey:done", "login:done", "sync:pending"])
    expect(at("waiting")).toEqual(["reach:done", "hostKey:done", "login:done", "include:attention", "sync:pending"])
    expect(at("adding")[3]).toBe("include:running")
    expect(at("added", "saving")).toEqual(["reach:done", "hostKey:done", "login:done", "include:done", "sync:running"])
    // 暂不加入：流程继续，这一步标成未执行并写明「暂不加入」
    const declined = connectSteps({ method: "agent", test: ok, keyCheck: null, enable: "enabling", dirs: 0, include: "declined" })
    expect(states(declined)).toEqual(["reach:done", "hostKey:done", "login:done", "include:skipped", "sync:running"])
    expect(declined[3].detail).toBe("暂不加入")
    // 连接失败后「仅保存」也会问这一步
    const failed: ConnectionTest = { ...base, status: "failed", error: { id: "timeout" } }
    expect(states(connectSteps({ method: "agent", test: failed, keyCheck: null, enable: null, dirs: 0, include: "waiting" }))).toEqual([
      "reach:failed",
      "hostKey:skipped",
      "login:skipped",
      "include:attention",
      "sync:skipped",
    ])
  })
})
