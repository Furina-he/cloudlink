//! ssh（PRD 8.1 ssh、8.3）：调用系统 OpenSSH。Windows 原生环境一律用系统 OpenSSH 的绝对路径
//! （PRD 8.3 规则 1），WSL 经 `wsl.exe -d <发行版> -e` 执行。所有参数数组都在别名前放 `--`（CC-SWITCH 二.5）

pub mod classify;
pub mod config;
pub mod connect;
pub mod keyconv;
pub mod managed;
pub mod validate;

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

use crate::env::EnvContext;
use crate::model::env::{EnvId, ScannedConfig, SshHost, SshHostList};
use crate::proc::{self, RunOpts};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tool {
    Ssh,
    SshKeygen,
}

impl Tool {
    fn name(self) -> &'static str {
        match self {
            Tool::Ssh => "ssh",
            Tool::SshKeygen => "ssh-keygen",
        }
    }
}

#[derive(Debug, Clone)]
pub struct SshTools {
    /// 设置里的 Windows ssh 路径（默认系统 OpenSSH），同目录下找 ssh-keygen
    pub windows_ssh: PathBuf,
}

impl SshTools {
    pub fn command(&self, env: &EnvContext, tool: Tool) -> Command {
        match env.distro() {
            None => {
                let exe = match tool {
                    Tool::Ssh => self.windows_ssh.clone(),
                    Tool::SshKeygen => self.windows_ssh.with_file_name("ssh-keygen.exe"),
                };
                proc::command(exe)
            }
            Some(distro) => {
                let mut c = proc::command("wsl.exe");
                c.args(["-d", distro, "-e", tool.name()]);
                c
            }
        }
    }

    /// `ssh -F <config> -G -- <alias>`
    pub fn effective(&self, env: &EnvContext, config_native: &str, alias: &str) -> Option<config::Effective> {
        validate::alias_ok(alias).then_some(())?;
        let mut cmd = self.command(env, Tool::Ssh);
        cmd.args(["-F", &crate::fsx::ssh_path(config_native), "-G", "--", alias]);
        let o = proc::run(
            cmd,
            RunOpts {
                timeout: Duration::from_secs(10),
                ..Default::default()
            },
        )
        .ok()?;
        o.success().then(|| config::parse_ssh_g(&o.stdout_str()))
    }
}

/// 用户 config 里的 Host（不含 CloudLink 托管文件里的），按别名小写去重
fn user_hosts(env: &EnvContext) -> config::ScanResult {
    let mut r = config::scan(&env.to_host(&env.ssh_config_native()), &env.host_home);
    let managed: BTreeSet<String> = managed::managed_aliases(&env.to_host(&env.managed_config_native()))
        .into_iter()
        .map(|a| a.to_lowercase())
        .collect();
    r.hosts.retain(|h| !managed.contains(&h.alias.to_lowercase()));
    r
}

/// F-107 AC3：别名与该环境用户 ssh config 里已有的 Host 重名
pub fn alias_conflicts(env: &EnvContext, alias: &str) -> bool {
    user_hosts(env)
        .hosts
        .iter()
        .any(|h| h.alias.eq_ignore_ascii_case(alias))
}

/// F-102：按运行环境分别扫描，同名合并为一行；`existing` 是已有资源的别名（小写），标为已导入
pub fn list_hosts(envs: &[EnvContext], existing: &BTreeSet<String>) -> SshHostList {
    let mut merged: BTreeMap<String, SshHost> = BTreeMap::new();
    let mut scanned = Vec::new();
    let mut skipped: Vec<String> = Vec::new();
    for env in envs.iter().filter(|e| e.available) {
        scanned.push(ScannedConfig {
            env_id: env.id.clone(),
            path: env.ssh_config_native(),
        });
        let r = user_hosts(env);
        for s in r.skipped {
            if !skipped.contains(&s) {
                skipped.push(s);
            }
        }
        for h in r.hosts {
            let key = h.alias.to_lowercase();
            let entry = merged.entry(key.clone()).or_insert_with(|| SshHost {
                alias: h.alias.clone(),
                defined_in: Vec::new(),
                hostname: h.hostname.clone(),
                user: h.user.clone(),
                port: h.port,
                imported: existing.contains(&key),
            });
            if !entry.defined_in.contains(&env.id) {
                entry.defined_in.push(env.id.clone());
            }
        }
    }
    SshHostList {
        hosts: merged.into_values().collect(),
        scanned,
        skipped_patterns: skipped,
    }
}

/// F-107 AC4：写入后用 `ssh -G` 回读，返回生效值和录入值不一致的字段
pub fn readback_mismatches(tools: &SshTools, env: &EnvContext, h: &managed::ManagedHost) -> Vec<&'static str> {
    let Some(e) = tools.effective(env, &env.ssh_config_native(), &h.alias) else {
        return vec!["sshAlias"];
    };
    let mut bad = Vec::new();
    if !e
        .hostname
        .eq_ignore_ascii_case(h.host.trim_start_matches('[').trim_end_matches(']'))
    {
        bad.push("host");
    }
    if e.user != h.user {
        bad.push("user");
    }
    if e.port != h.port {
        bad.push("port");
    }
    bad
}

/// 这些环境里，哪些写了这台服务器的连接配置（imported：ssh config 里有这个别名）
pub fn defined_in(envs: &[EnvContext], alias: &str) -> Vec<EnvId> {
    envs.iter()
        .filter(|e| e.available && user_hosts(e).hosts.iter().any(|h| h.alias.eq_ignore_ascii_case(alias)))
        .map(|e| e.id.clone())
        .collect()
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;
    use crate::env::{FakeSystem, detect};
    use crate::paths::Paths;

    #[test]
    fn lists_hosts_across_envs_and_excludes_managed() {
        let tmp = tempfile::tempdir().unwrap();
        let paths = Paths::isolated_in(tmp.path());
        let envs = detect(
            &paths,
            &FakeSystem {
                distros: vec!["Ubuntu-24.04".into()],
                ..Default::default()
            },
        );
        let (win, wsl) = (&envs[0], &envs[1]);
        let write = |env: &EnvContext, name: &str, text: &str| {
            let p = env.host_in_home(&[".ssh", name]);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(p, text).unwrap();
        };
        write(
            win,
            "config",
            "Include ~/.ssh/cloudlink.conf\nHost sg-db\n  HostName 198.51.100.7\nHost *\n",
        );
        write(
            win,
            "cloudlink.conf",
            &format!("{}\nHost hk-edge\n  HostName 203.0.113.10\n", managed::MANAGED_HEADER),
        );
        write(wsl, "config", "Host SG-DB\n  User deploy\nHost box\n");

        let existing = BTreeSet::from(["sg-db".to_string()]);
        let list = list_hosts(&envs, &existing);
        let aliases: Vec<_> = list.hosts.iter().map(|h| h.alias.as_str()).collect();
        assert_eq!(aliases, ["box", "sg-db"]);
        let sg = &list.hosts[1];
        assert_eq!(sg.defined_in, vec![win.id.clone(), wsl.id.clone()]);
        assert!(sg.imported);
        assert_eq!(list.skipped_patterns, ["*"]);
        assert_eq!(list.scanned[1].path, "/home/me/.ssh/config");

        assert!(alias_conflicts(win, "SG-db"));
        assert!(
            !alias_conflicts(win, "hk-edge"),
            "managed hosts are ours, not a conflict"
        );
        assert_eq!(defined_in(&envs, "box"), vec![wsl.id.clone()]);
    }
}
