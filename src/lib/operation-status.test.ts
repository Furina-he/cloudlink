import { describe, expect, it } from "vitest"

import type { Operation } from "@/bindings"
import { copy } from "./copy"
import { operationStatus } from "./operation-status"

const operation = (fields: Partial<Operation> = {}): Operation => ({ id: "op", assetId: "asset", envId: "windows", at: "2026-11-15T00:00:00Z", sessionId: "", command: "uptime", cwd: "D:/fixture", decision: "allowed", ...fields })

describe("许可和执行结果分开", () => {
  it("旧hook放行不是执行成功", () => {
    expect(operationStatus(operation())).toEqual({ text: copy.feed.allowed, tone: "off" })
    expect(operationStatus(operation({ source: "hook", executionState: "succeeded", exitCode: 0 }))).toEqual({ text: copy.feed.allowed, tone: "off" })
  })
  it("已允许、执行中都不显示绿色成功", () => {
    for (const state of ["waiting", "approved", "dispatching", "running"] as const) expect(operationStatus(operation({ source: "runner", checked: true, executionState: state })).tone).toBe("off")
  })
  it("只有已受检且实际退出0的runner结果显示成功", () => {
    expect(operationStatus(operation({ source: "runner", checked: true, executionState: "succeeded", exitCode: 0 })).tone).toBe("ok")
    expect(operationStatus(operation({ source: "runner", checked: true, executionState: "succeeded" })).tone).toBe("warn")
    expect(operationStatus(operation({ source: "runner", executionState: "succeeded", exitCode: 0 })).tone).not.toBe("ok")
  })
  it("启动失败、非零和未知分开", () => {
    expect(operationStatus(operation({ source: "runner", checked: true, executionState: "failed" })).text).toBe(copy.execution.startFailed)
    expect(operationStatus(operation({ source: "runner", checked: true, executionState: "failed", exitCode: 2 })).text).toBe(copy.execution.state.failed)
    expect(operationStatus(operation({ source: "runner", checked: true, executionState: "unknown" })).text).toBe(copy.execution.state.unknown)
  })
  it("未受检不冒称护栏检查或成功", () => {
    expect(operationStatus(operation({ source: "runner", checked: false, executionState: "succeeded", exitCode: 0 }))).toEqual({ text: copy.execution.unchecked, tone: "warn" })
  })
})
