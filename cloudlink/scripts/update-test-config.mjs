// 更新实测（EXECUTION-PLAN P6 第 8 项）的两个脚本共用的固定值。端口和隔离目录都编译进了测试安装包，改了要重新构建
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
export const ROOT = join(dirname(PROJECT), "test-results", "update")
/** 编译进测试安装包的 CLOUDLINK_HOME；安装程序重新打开应用时没有测试进程的环境变量，靠它隔离 */
export const DATA_HOME = join(ROOT, "data")
export const INSTALL_DIR = join(ROOT, "install")
export const VERSIONS = ["0.1.0", "0.1.1"]
export const UPDATE_PORT = 8765
export const DEBUG_PORT = 9333
export const installerName = (version) => `CloudLink_${version}_x64-setup.exe`
