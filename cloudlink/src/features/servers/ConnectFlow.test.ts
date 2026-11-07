import { describe, expect, it } from "vitest"

import type { KeyCheck } from "@/bindings"
import type { ConnectionTest } from "@/stores/connection"
import { connectSteps, stepOfError } from "./ConnectFlow"

const base: ConnectionTest = { testId: "tst", status: "running", signature: "{}", alias: "hk-edge" }
const okKey: KeyCheck = { status: "ok", keyType: "ED25519", fingerprint: "SHA256:key" }
const states = (steps: ReturnType<typeof connectSteps>) => steps.map((s) => `${s.id}:${s.state}`)

describe("连接过程的步骤（PRD 6.5）", () => {
  it("私钥方式多一步「检查私钥」，进行中时停在连接", () => {
    const steps = connectSteps({ method: "key", test: base, keyCheck: okKey, enable: null, agents: 2 })
    expect(states(steps)).toEqual(["key:done", "reach:running", "hostKey:pending", "login:pending", "enable:pending"])
    expect(steps[0].detail).toBe("ED25519")
    const password = connectSteps({ method: "password", test: base, keyCheck: null, enable: null, agents: 2 })
    expect(states(password)[0]).toBe("reach:running")
  })

  it("还没有预检结果时先检查私钥", () => {
    expect(states(connectSteps({ method: "key", test: base, keyCheck: null, enable: null, agents: 0 })).slice(0, 2)).toEqual([
      "key:running",
      "reach:pending",
    ])
  })

  it("第一次连接时停在指纹，等用户核对；密钥变更时阻断后面的步骤", () => {
    const fresh = { ...base, status: "host-key" as const, hostKey: { fingerprint: "SHA256:new", known: "new" as const } }
    expect(states(connectSteps({ method: "password", test: fresh, keyCheck: null, enable: null, agents: 0 }))).toEqual([
      "reach:done",
      "hostKey:attention",
      "login:pending",
      "enable:pending",
    ])
    const changed = { ...fresh, hostKey: { fingerprint: "SHA256:other", known: "changed" as const } }
    expect(states(connectSteps({ method: "password", test: changed, keyCheck: null, enable: null, agents: 0 }))).toEqual([
      "reach:done",
      "hostKey:failed",
      "login:skipped",
      "enable:skipped",
    ])
  })

  it("信任之后指纹这一步立即完成，正在登录", () => {
    const trusting = { ...base, hostKey: { fingerprint: "SHA256:new", known: "trusted" as const } }
    const steps = connectSteps({ method: "key", test: trusting, keyCheck: okKey, enable: null, agents: 0 })
    expect(states(steps)).toEqual(["key:done", "reach:done", "hostKey:done", "login:running", "enable:pending"])
  })

  it("失败停在出错的那一步，之前的完成、之后的未执行", () => {
    const failed = (id: Parameters<typeof stepOfError>[0], hostKey?: ConnectionTest["hostKey"]) =>
      states(
        connectSteps({
          method: "key",
          test: { ...base, status: "failed", error: { id }, hostKey },
          keyCheck: okKey,
          enable: null,
          agents: 0,
        })
      )
    expect(failed("key-permissions")).toEqual(["key:failed", "reach:skipped", "hostKey:skipped", "login:skipped", "enable:skipped"])
    expect(failed("timeout")).toEqual(["key:done", "reach:failed", "hostKey:skipped", "login:skipped", "enable:skipped"])
    expect(failed("auth-failed", { fingerprint: "SHA256:new", known: "trusted" })).toEqual([
      "key:done",
      "reach:done",
      "hostKey:done",
      "login:failed",
      "enable:skipped",
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
    const steps = connectSteps({ method: "password", test: ok, keyCheck: null, enable: "converting", agents: 2 })
    expect(states(steps)).toEqual(["reach:done", "hostKey:done", "login:done", "enable:running"])
    expect(steps[1].detail).toContain("141.148.177.189")
    expect(steps[2].detail).toContain("Ubuntu 24.04 LTS")
    expect(steps[3].detail).toContain("密钥")
  })
})
