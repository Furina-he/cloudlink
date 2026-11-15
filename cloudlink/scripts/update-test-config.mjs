// P8 updater fixtures use a fresh installation identity and a new directory on every preparation.
// Paths are compiled into both test builds; no fixture falls back to a user profile.
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
export const ROOT = join(dirname(PROJECT), "test-results", "p8")
export const VERSIONS = ["0.1.0", "0.1.1"]
export const UPDATE_PORT = 48765
export const DEBUG_PORT = 9333

export function layout(root, runId) {
  const dataHome = join(root, "data")
  const productName = `CloudLink P8 Update ${runId}`
  return {
    root, runId, dataHome,
    userHome: join(dataHome, "home"),
    wslRoot: join(dataHome, "wsl"),
    installDir: join(root, "install"),
    appData: join(root, "os-profile", "AppData", "Roaming"),
    localAppData: join(root, "os-profile", "AppData", "Local"),
    programData: join(root, "os-profile", "ProgramData"),
    tmp: join(root, "tmp"),
    productName,
    identifier: `com.cloudlink.test.updater.r${runId}`,
    publisher: "CloudLink P8 Fixture",
    updatePort: UPDATE_PORT,
    debugPort: DEBUG_PORT,
    versions: VERSIONS,
  }
}

export const installerName = (fixture, version) => `${fixture.productName}_${version}_x64-setup.exe`
