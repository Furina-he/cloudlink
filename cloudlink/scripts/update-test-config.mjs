// 更新实测（EXECUTION-PLAN P6 第 8 项）的两个脚本共用的固定值。端口和隔离目录都编译进了测试安装包，改了要重新构建
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
export const ROOT = join(dirname(PROJECT), "test-results", "update")
/** 编译进测试安装包的 CLOUDLINK_HOME；安装程序重新打开应用时没有测试进程的环境变量，靠它隔离 */
export const DATA_HOME = join(ROOT, "data")
export const INSTALL_DIR = join(ROOT, "install")
// 独立安装身份：更新测试不能卸载、覆盖或改写本机已安装的正式 CloudLink。
export const TEST_PRODUCT_NAME = "CloudLink Update Test"
export const TEST_IDENTIFIER = "com.cloudlink.desktop.updatetest"
export const TEST_PUBLISHER = "CloudLink Test"
// 两个版本均由当前源码构建，验收安装与更新机制；旧数据库迁移另由数据库回归覆盖。
export const VERSIONS = ["0.1.0", "0.1.1"]
export const UPDATE_PORT = 48765
export const DEBUG_PORT = 9333
export const installerName = (version) => `${TEST_PRODUCT_NAME}_${version}_x64-setup.exe`
