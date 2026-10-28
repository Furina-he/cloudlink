import { describe, expect, it } from "vitest"

import { slugSchema, uniqueSlugSchema } from "./schemas"

const err = (r: { success: boolean; error?: { issues: { message: string }[] } }) =>
  r.success ? null : r.error!.issues[0].message

describe("slug 校验（PRD 5.1、5.4）", () => {
  it("接受合法 slug", () => {
    expect(slugSchema.safeParse("vps-hk-edge").success).toBe(true)
    expect(slugSchema.safeParse("a".repeat(64)).success).toBe(true)
  })

  it("拒绝格式错误、超长与保留名", () => {
    expect(err(slugSchema.safeParse("VPS"))).toBe("slug-format")
    expect(err(slugSchema.safeParse("-a"))).toBe("slug-format")
    expect(err(slugSchema.safeParse("a--b"))).toBe("slug-format")
    expect(err(slugSchema.safeParse("a".repeat(65)))).toBe("slug-too-long")
    expect(err(slugSchema.safeParse("synced"))).toBe("slug-reserved")
  })

  it("唯一性检查排除自身", () => {
    const taken = [{ id: "a1", slug: "vps-hk-edge" }]
    expect(err(uniqueSlugSchema(taken).safeParse("vps-hk-edge"))).toBe("slug-taken")
    expect(uniqueSlugSchema(taken, "a1").safeParse("vps-hk-edge").success).toBe(true)
  })
})
