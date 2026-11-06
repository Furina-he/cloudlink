// 构建更新实测用的两个安装包（EXECUTION-PLAN P6 第 8 项），之后运行 scripts/check-update.mjs。
// 这两个安装包绝不能发布：用一次性的测试密钥签名，更新端点是本地 HTTP 服务，隔离目录编译在程序里（src-tauri/src/paths.rs）。
// 所以全部产物放在 test-results/update/，包括单独的 target 目录，不会和 src-tauri/target 下的正式构建混在一起。
import { spawnSync } from "node:child_process"
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"

import { assertTestRoot } from "./desktop-ssh-target.mjs"
import { DATA_HOME, DEBUG_PORT, PROJECT, ROOT, UPDATE_PORT, VERSIONS, installerName } from "./update-test-config.mjs"

const tauriCli = join(PROJECT, "node_modules/@tauri-apps/cli/tauri.js")
const signing = join(ROOT, "signing")
const privateKey = join(signing, "test.key")
const password = "cloudlink-update-test"
const targetDir = join(ROOT, "target")

await assertTestRoot(ROOT)
await mkdir(signing, { recursive: true })
await assertTestRoot(signing, { inspectContents: true })

function tauri(args, env = {}) {
  const result = spawnSync(process.execPath, [tauriCli, ...args], { cwd: PROJECT, env: { ...process.env, ...env }, stdio: "inherit", windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`tauri ${args[0]} exited with ${result.status}`)
}

if (!existsSync(privateKey)) tauri(["signer", "generate", "-w", privateKey, "-p", password, "--ci"])
const publicKey = (await readFile(`${privateKey}.pub`, "utf8")).trim()

const base = JSON.parse(await readFile(join(PROJECT, "src-tauri/tauri.conf.json"), "utf8"))
for (const version of VERSIONS) {
  const configPath = join(ROOT, `tauri.update-test-${version}.json`)
  await writeFile(configPath, `${JSON.stringify({
    version,
    app: {
      // 安装程序重新打开的新版本也要能被测试驱动，所以调试端口写在配置里，不靠环境变量
      windows: base.app.windows.map((window) => ({
        ...window,
        additionalBrowserArgs: `--remote-debugging-port=${DEBUG_PORT} --remote-debugging-address=127.0.0.1`,
      })),
    },
    plugins: {
      updater: {
        pubkey: publicKey,
        endpoints: [`http://127.0.0.1:${UPDATE_PORT}/latest.json`],
        // PRD 8.5：只有测试配置允许 http
        dangerousInsecureTransportProtocol: true,
      },
    },
  }, null, 2)}\n`)
  tauri(["build", "--ci", "--config", configPath, "--", "--locked", "--jobs", "1"], {
    CARGO_TARGET_DIR: targetDir,
    CLOUDLINK_TEST_BUILD_HOME: DATA_HOME,
    TAURI_SIGNING_PRIVATE_KEY: privateKey,
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: password,
  })
  const output = join(ROOT, version)
  await mkdir(output, { recursive: true })
  const installer = installerName(version)
  for (const name of [installer, `${installer}.sig`]) {
    await copyFile(join(targetDir, "release/bundle/nsis", name), join(output, name))
  }
  console.log(`Prepared ${join(output, installer)}`)
}
