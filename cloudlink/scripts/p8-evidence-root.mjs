// Fresh evidence roots never replace prior runs or user files.
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { assertTestRoot } from "./desktop-ssh-target.mjs"

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const parent = join(workspace, "test-results", "p8")
await assertTestRoot(parent)
await mkdir(parent, { recursive: true })
const root = await mkdtemp(join(parent, "p8cf-"))
await assertTestRoot(root)
await writeFile(join(root, ".cloudlink.json"), `${JSON.stringify({ managedBy: "cloudlink", kind: "p8-evidence" })}\n`, { flag: "wx" })
console.log(root)
