// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // SSH_ASKPASS 辅助模式必须最先分流：在单实例插件、日志和数据库初始化之前（CC-SWITCH 二.3）
    cloudlink_lib::secret::askpass::dispatch();
    cloudlink_lib::run();
}
