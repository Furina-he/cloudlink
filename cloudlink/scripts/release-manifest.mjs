// 从 tauri build 的产物生成 F-406 的版本清单 latest.json（只用 Node 标准库）。
//
// 正式发布：
//   node scripts/release-manifest.mjs --notes-file notes.txt
// 会核对三处版本号一致、tauri.conf.json 里已写入公钥、安装包和 .sig 都在，然后把 latest.json 写到安装包旁边。
//
// 本地更新实测（EXECUTION-PLAN P6 第 8 项），安装包地址指向本地 HTTP 服务：
//   node scripts/release-manifest.mjs --notes "测试" --version 0.1.1 --base-url http://127.0.0.1:8765 --bundle-dir <目录>
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const RELEASES = "https://github.com/Furina-he/cloudlink/releases/download"
const PLATFORM = "windows-x86_64"

function fail(message) {
  console.error(`release-manifest: ${message}`)
  process.exit(1)
}

const readJson = (path) => JSON.parse(readFileSync(join(ROOT, path), "utf8"))

/** 三处版本号必须一致（EXECUTION-PLAN P6 第 6 项），否则已安装的版本比较出来的结果是错的 */
function releaseVersion(conf) {
  const cargo = /^version\s*=\s*"([^"]+)"/m.exec(readFileSync(join(ROOT, "src-tauri/Cargo.toml"), "utf8"))?.[1]
  const versions = { "tauri.conf.json": conf.version, "src-tauri/Cargo.toml": cargo, "package.json": readJson("package.json").version }
  if (new Set(Object.values(versions)).size !== 1) fail(`版本号不一致：${JSON.stringify(versions)}`)
  return conf.version
}

const { values: args } = parseArgs({
  options: {
    notes: { type: "string" },
    "notes-file": { type: "string" },
    version: { type: "string" },
    "base-url": { type: "string" },
    "bundle-dir": { type: "string" },
    out: { type: "string" },
  },
})

const notes = args["notes-file"] ? readFileSync(args["notes-file"], "utf8") : args.notes
if (!notes?.trim()) fail("缺少更新说明：用 --notes 或 --notes-file 提供")

const testing = args["base-url"] !== undefined
if (testing !== (args.version !== undefined)) fail("--version 和 --base-url 只用于本地实测，必须一起提供")

const conf = readJson("src-tauri/tauri.conf.json")
if (!testing && !conf.plugins?.updater?.pubkey?.trim()) {
  // 公钥为空的安装包永远过不了签名校验，装上之后就再也无法在应用内更新
  fail("tauri.conf.json 的 plugins.updater.pubkey 还是空的：先生成签名密钥并写入公钥")
}
const version = testing ? args.version : releaseVersion(conf)

const bundleDir = resolve(args["bundle-dir"] ?? join(ROOT, "src-tauri/target/release/bundle/nsis"))
const installer = `${conf.productName}_${version}_x64-setup.exe`
const installerPath = join(bundleDir, installer)
const signaturePath = `${installerPath}.sig`
for (const path of [installerPath, signaturePath]) {
  if (!existsSync(path)) fail(`找不到 ${path}：先用签名私钥运行 tauri build`)
}
const signature = readFileSync(signaturePath, "utf8").trim()
if (!signature) fail(`${signaturePath} 是空的`)

const base = testing ? args["base-url"].replace(/\/+$/, "") : `${RELEASES}/v${version}`
const manifest = {
  version,
  notes: notes.trim(),
  pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  platforms: { [PLATFORM]: { signature, url: `${base}/${encodeURIComponent(installer)}` } },
}

const out = resolve(args.out ?? join(bundleDir, "latest.json"))
writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`已写入 ${out}`)
