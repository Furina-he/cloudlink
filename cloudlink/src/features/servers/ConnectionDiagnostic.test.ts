import { describe, expect, it } from "vitest"

import type { ConnectionDiagnostic } from "@/bindings"
import { copy } from "@/lib/copy"
import { diagnosticText } from "./ConnectionDiagnostic"

describe("安全 SSH 诊断摘要", () => {
  it("仅输出阶段、客户端、版本、退出码和枚举摘要", () => {
    const value: ConnectionDiagnostic = { stage: "authentication", client: "windows-openssh", clientVersion: "9.5p1", exitCode: 255, summary: ["check-login-and-auth"] }
    const text = diagnosticText({ ...value, stderr: "root@203.0.113.10 password=hidden PRIVATE KEY", host: "203.0.113.10", user: "root", identityFile: "D:/private.pem" } as ConnectionDiagnostic)
    expect(text).toContain(copy.diagnostic.stage.authentication)
    expect(text).toContain("Windows OpenSSH 9.5p1")
    expect(text).toContain("255")
    for (const secret of ["203.0.113.10", "root@", "hidden", "PRIVATE KEY", "private.pem", "stderr"]) expect(text).not.toContain(secret)
  })
  it("权限问题说明同一密钥副本，不承诺改ACL或消除原风险", () => {
    const text = diagnosticText({ stage: "key-check", client: "git-openssh", summary: ["key-permissions"] })
    expect(text).toContain("同一把密钥")
    expect(text).toContain("原文件的权限不会改变")
    expect(copy.diagnostic.originalKeyRisk).toContain("不会生成新密钥")
    expect(copy.diagnostic.originalKeyRisk).toContain("不会修改或移动原文件")
  })
})
