import { expect, test } from "@playwright/test"
import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { SHOTS } from "./helpers"

// A responsive old server is not evidence of the current worktree.
test("P8 浏览器服务确实提供当前源码", async ({ request }) => {
  const files = [
    ["src/lib/operation-status.ts", "operation.checked !== true"],
    ["src/mocks/render.ts", "requestId.ownerToken"],
    ["src/mocks/handlers-execution.ts", "record(request, false)"],
  ]
  const proof = []
  for (const [path, marker] of files) {
    const source = await readFile(resolve(path), "utf8")
    const response = await request.get(`/${path}`)
    expect(response.ok()).toBe(true)
    expect(await response.text()).toContain(marker)
    proof.push({ path, sha256: createHash("sha256").update(source).digest("hex") })
  }
  if (process.env.CLOUDLINK_E2E_SHOTS) await writeFile(resolve(SHOTS, "source-freshness.json"), `${JSON.stringify({ checkedAt: new Date().toISOString(), files: proof }, null, 2)}\n`, { flag: "wx" })
})
