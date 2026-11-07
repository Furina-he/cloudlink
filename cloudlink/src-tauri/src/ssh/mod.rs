//! ssh（PRD 8.1 ssh、8.3）：调用系统 OpenSSH。Windows 原生环境一律用系统 OpenSSH 的绝对路径
//! （PRD 8.3 规则 1），WSL 经 `wsl.exe -d <发行版> -e` 执行。所有参数数组都在别名前放 `--`（CC-SWITCH 二.5）

pub mod classify;
pub mod config;
pub mod connect;
pub mod keycheck;
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
        let mut command = match env.distro() {
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
        };
        if env.isolated && tool == Tool::Ssh {
            command.env_remove("SSH_AUTH_SOCK").env_remove("SSH_AGENT_PID");
        }
        command
    }

    /// `ssh -F <config> -G -- <alias>`
    pub fn effective(&self, env: &EnvContext, config_native: &str, alias: &str) -> Option<config::Effective> {
        validate::alias_ok(alias).then_some(())?;
        managed::check_isolated_config(env, config_native).ok()?;
        let mut cmd = self.command(env, Tool::Ssh);
        cmd.args(isolated_options(env, None));
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

/// `-F` selects a config file, but OpenSSH still resolves default keys and known_hosts
/// against its OS account. Only isolated calls disable those defaults; explicit IdentityFile
/// entries in the supplied config remain available because that option is additive.
/// Isolated sessions only connect directly: proxy subprocesses do not inherit these options.
pub(crate) fn isolated_options(env: &EnvContext, pinned_known_hosts: Option<&str>) -> Vec<String> {
    if !env.isolated {
        return Vec::new();
    }
    let known_hosts = pinned_known_hosts
        .map(str::to_string)
        .unwrap_or_else(|| env.known_hosts_native());
    [
        format!("UserKnownHostsFile={}", managed::quote_path(&known_hosts)),
        "GlobalKnownHostsFile=none".into(),
        "IdentityAgent=none".into(),
        "IdentityFile=none".into(),
        "GSSAPIAuthentication=no".into(),
        "HostbasedAuthentication=no".into(),
        "ProxyCommand=none".into(),
        "ProxyJump=none".into(),
    ]
    .into_iter()
    .flat_map(|option| ["-o".into(), option])
    .collect()
}

/// 用户 config 里的 Host（不含 CloudLink 托管文件里的），按别名小写去重
fn user_hosts(env: &EnvContext) -> config::ScanResult {
    let user_config = env.to_host(&env.ssh_config_native());
    let mut r = if env.isolated {
        // The only permitted Include is the managed file excluded below. Never
        // let the parser expand legacy or WSL-native Include paths on this host.
        if crate::paths::validate_file(&user_config).is_err() {
            return config::ScanResult::default();
        }
        std::fs::read_to_string(&user_config)
            .map(|text| config::scan_text(&text))
            .unwrap_or_default()
    } else {
        config::scan(&user_config, &env.host_home)
    };
    let managed_config = env.to_host(&env.managed_config_native());
    let aliases = if !env.isolated || crate::paths::validate_file(&managed_config).is_ok() {
        managed::managed_aliases(&managed_config)
    } else {
        Vec::new()
    };
    let managed: BTreeSet<String> = aliases.into_iter().map(|a| a.to_lowercase()).collect();
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

    #[test]
    fn isolated_config_checks_reject_legacy_foreign_and_nested_includes() {
        let tmp = tempfile::tempdir().unwrap();
        let env = EnvContext::windows(&Paths::isolated_in(tmp.path()));
        let config = env.host_in_home(&[".ssh", "config"]);
        let managed_config = env.host_in_home(&[".ssh", "cloudlink.conf"]);
        fs::create_dir_all(config.parent().unwrap()).unwrap();
        fs::write(&managed_config, format!("{}\nHost managed\n", managed::MANAGED_HEADER)).unwrap();
        let native = env.ssh_config_native();
        let include = format!("Include {}\n", managed::quote_path(&env.managed_config_native()));
        fs::write(&config, &include).unwrap();
        assert!(managed::check_isolated_config(&env, &native).is_ok());

        let foreign = managed::quote_path(&tmp.path().join("foreign.conf").to_string_lossy());
        for unsafe_config in [
            "Include ~/.ssh/cloudlink.conf\n".to_string(),
            "Include cloudlink.conf\n".to_string(),
            "Host fixture\n  Include ~/.ssh/cloudlink.conf\n".to_string(),
            format!("Include {foreign}\n"),
            format!("{}Include {foreign}\n", include),
        ] {
            fs::write(&config, &unsafe_config).unwrap();
            assert!(
                managed::check_isolated_config(&env, &native).is_err(),
                "unsafe Include accepted: {unsafe_config}"
            );
        }
        fs::write(&config, &include).unwrap();
        fs::write(&managed_config, format!("{}\n{include}", managed::MANAGED_HEADER)).unwrap();
        assert!(managed::check_isolated_config(&env, &native).is_err());
    }

    #[test]
    fn production_config_check_preserves_user_include_rules() {
        let tmp = tempfile::tempdir().unwrap();
        let mut env = EnvContext::windows(&Paths::isolated_in(tmp.path()));
        let config = env.host_in_home(&[".ssh", "config"]);
        fs::create_dir_all(config.parent().unwrap()).unwrap();
        fs::write(&config, "Include ~/.ssh/conf.d/*.conf\nHost fixture\n").unwrap();
        assert!(managed::check_isolated_config(&env, &env.ssh_config_native()).is_err());
        env.isolated = false;
        assert!(managed::check_isolated_config(&env, &env.ssh_config_native()).is_ok());
    }

    #[test]
    fn isolated_host_scan_never_follows_native_or_foreign_includes() {
        let tmp = tempfile::tempdir().unwrap();
        let paths = Paths::isolated_in(tmp.path());
        let envs = detect(
            &paths,
            &FakeSystem {
                distros: vec!["Ubuntu-24.04".into()],
                ..Default::default()
            },
        );
        let foreign = tmp.path().join("foreign.conf");
        fs::write(&foreign, "Host must-not-be-imported\n").unwrap();
        for env in envs {
            let config = env.host_in_home(&[".ssh", "config"]);
            let managed_config = env.host_in_home(&[".ssh", "cloudlink.conf"]);
            fs::create_dir_all(config.parent().unwrap()).unwrap();
            fs::write(
                &managed_config,
                format!(
                    "{}\nHost managed\nInclude {}\n",
                    managed::MANAGED_HEADER,
                    managed::quote_path(&foreign.to_string_lossy())
                ),
            )
            .unwrap();
            for include in [
                managed::quote_path(&env.managed_config_native()),
                managed::quote_path(&foreign.to_string_lossy()),
                "~/.ssh/cloudlink.conf".to_string(),
            ] {
                fs::write(&config, format!("Include {include}\nHost kept\n  HostName 127.0.0.1\n")).unwrap();
                assert_eq!(
                    user_hosts(&env)
                        .hosts
                        .iter()
                        .map(|host| host.alias.as_str())
                        .collect::<Vec<_>>(),
                    ["kept"]
                );
            }
        }
    }

    #[cfg(windows)]
    #[test]
    fn isolated_ssh_g_keeps_explicit_key_without_os_profile_defaults() {
        let tmp = tempfile::tempdir().unwrap();
        let paths = Paths::isolated_in(tmp.path());
        let mut env = EnvContext::windows(&paths);
        let config = tmp.path().join("fixture.conf");
        let key = crate::fsx::ssh_path(&tmp.path().join("fixture-key").to_string_lossy());
        let custom_hosts = crate::fsx::ssh_path(&tmp.path().join("custom-known-hosts").to_string_lossy());
        let custom_global = crate::fsx::ssh_path(&tmp.path().join("custom-global-hosts").to_string_lossy());
        let custom_agent = crate::fsx::ssh_path(&tmp.path().join("custom-agent").to_string_lossy());
        fs::write(
            &config,
            format!(
                "Host isolation-jump isolation-command\n  HostName 127.0.0.1\n  User fixture\n  IdentityFile \"{key}\"\n  \
                 UserKnownHostsFile \"{custom_hosts}\"\n  GlobalKnownHostsFile \"{custom_global}\"\n  \
                 IdentityAgent \"{custom_agent}\"\n\n\
                 Host isolation-jump\n  ProxyJump jump-fixture\n\n\
                 Host isolation-command\n  ProxyCommand cloudlink-proxy-fixture --host %h --port %p\n"
            ),
        )
        .unwrap();
        let program_data = tmp.path().join("ProgramData");
        fs::create_dir(&program_data).unwrap();
        let tools = SshTools {
            windows_ssh: PathBuf::from(crate::model::misc::DEFAULT_WINDOWS_SSH),
        };
        for (alias, expected_proxy) in [
            ("isolation-jump", "proxyjump jump-fixture"),
            (
                "isolation-command",
                "proxycommand cloudlink-proxy-fixture --host %h --port %p",
            ),
        ] {
            for isolated in [true, false] {
                env.isolated = isolated;
                let mut command = tools.command(&env, Tool::Ssh);
                command.env_clear();
                for name in ["SystemRoot", "WINDIR"] {
                    if let Some(value) = std::env::var_os(name) {
                        command.env(name, value);
                    }
                }
                command
                    .env("ProgramData", &program_data)
                    .env("HOME", &paths.user_home)
                    .env("USERPROFILE", &paths.user_home)
                    .env("APPDATA", tmp.path())
                    .env("LOCALAPPDATA", tmp.path())
                    .env("TEMP", tmp.path())
                    .env("TMP", tmp.path())
                    .args(isolated_options(&env, None))
                    .arg("-F")
                    .arg(&config)
                    // Print effective configuration only; neither proxy is executed.
                    .args(["-G", "--", alias]);
                let output = proc::run(
                    command,
                    RunOpts {
                        timeout: Duration::from_secs(10),
                        ..Default::default()
                    },
                )
                .unwrap();
                assert!(output.success(), "{}", output.stderr_str());
                let config = output.stdout_str();
                assert!(config.lines().any(|line| line == format!("identityfile {key}")));
                assert!(!config.contains("~/.ssh/id_"));
                if isolated {
                    assert!(config.lines().any(|line| line == "identityfile none"));
                    assert!(config.lines().any(|line| line == "identityagent none"));
                    assert!(config.lines().any(|line| line == "globalknownhostsfile none"));
                    assert!(config.lines().any(|line| {
                        line == format!("userknownhostsfile {}", crate::fsx::ssh_path(&env.known_hosts_native()))
                    }));
                    for proxy in config
                        .lines()
                        .filter(|line| line.starts_with("proxyjump ") || line.starts_with("proxycommand "))
                    {
                        assert!(
                            matches!(proxy, "proxyjump none" | "proxycommand none"),
                            "isolated {alias} retained {proxy}"
                        );
                    }
                } else {
                    for expected in [
                        format!("userknownhostsfile {custom_hosts}"),
                        format!("globalknownhostsfile {custom_global}"),
                        format!("identityagent {custom_agent}"),
                    ] {
                        assert!(config.lines().any(|line| line == expected));
                    }
                    assert!(!config.lines().any(|line| line == "identityfile none"));
                    assert!(config.lines().any(|line| line == expected_proxy));
                }
            }
        }
    }
}
