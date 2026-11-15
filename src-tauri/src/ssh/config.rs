//! 读取用户的 ssh config（F-102）：枚举 Host（ssh2-config，支持 Include），以及解析 `ssh -G` 的生效值

use std::collections::BTreeSet;
use std::fs::File;
use std::io::BufReader;
use std::path::Path;

use ssh2_config::{ParseRule, SshConfig};

use super::validate::alias_ok;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostEntry {
    pub alias: String,
    pub hostname: Option<String>,
    pub user: Option<String>,
    pub port: Option<u16>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ScanResult {
    pub hosts: Vec<HostEntry>,
    /// 跳过的通配或否定模式（F-102 AC1）
    pub skipped: Vec<String>,
}

fn is_pattern(s: &str) -> bool {
    s.contains(['*', '?', '!']) || !alias_ok(s)
}

/// 枚举 `config`（CloudLink 能访问的位置）里的 Host。`home` 用来展开 `~` 和相对 Include；
/// 文件不存在时返回空结果。ssh2-config 解析失败时退回只认 `Host` 行的简单扫描
pub fn scan(config: &Path, home: &Path) -> ScanResult {
    let Ok(file) = File::open(config) else {
        return ScanResult::default();
    };
    let parsed = SshConfig::default().home_dir(home).parse(
        &mut BufReader::new(file),
        ParseRule::ALLOW_UNKNOWN_FIELDS | ParseRule::ALLOW_UNSUPPORTED_FIELDS,
    );
    match parsed {
        Ok(cfg) => from_parsed(&cfg),
        Err(e) => {
            log::warn!("ssh2-config could not parse {}: {e}", config.display());
            std::fs::read_to_string(config)
                .map(|s| scan_text(&s))
                .unwrap_or_default()
        }
    }
}

fn from_parsed(cfg: &SshConfig) -> ScanResult {
    let mut out = ScanResult::default();
    let mut seen = BTreeSet::new();
    for (i, host) in cfg.get_hosts().iter().enumerate() {
        // ssh2-config 把顶层指令放进第一个隐含的 `Host *`；它不是用户写的 Host，不报告为跳过
        let implicit = i == 0 && host.pattern.len() == 1 && host.pattern[0].pattern == "*" && !host.pattern[0].negated;
        for clause in &host.pattern {
            if clause.negated || is_pattern(&clause.pattern) {
                if !implicit {
                    let shown = if clause.negated {
                        format!("!{}", clause.pattern)
                    } else {
                        clause.pattern.clone()
                    };
                    if !out.skipped.contains(&shown) {
                        out.skipped.push(shown);
                    }
                }
                continue;
            }
            if seen.insert(clause.pattern.to_lowercase()) {
                out.hosts.push(HostEntry {
                    alias: clause.pattern.clone(),
                    hostname: host.params.host_name.clone(),
                    user: host.params.user.clone(),
                    port: host.params.port,
                });
            }
        }
    }
    out
}

/// 只认 `Host` 段（不跟随 Include）：用于 ssh2-config 解析失败时、隔离会话，以及读取 CloudLink 自己的托管文件。
/// 段内的 HostName / User / Port 按 ssh 的规则取第一次出现的值（排除代码托管主机要用）
pub fn scan_text(text: &str) -> ScanResult {
    let mut out = ScanResult::default();
    let mut seen = BTreeSet::new();
    // 当前 Host 段新加入的条目；遇到 Match 段就不再归属任何 Host
    let mut current: Vec<usize> = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        let Some((key, rest)) = line.split_once(|c: char| c.is_whitespace() || c == '=') else {
            continue;
        };
        let value = rest
            .trim_start_matches(|c: char| c.is_whitespace() || c == '=')
            .trim()
            .trim_matches('"');
        if key.eq_ignore_ascii_case("match") {
            current.clear();
            continue;
        }
        if !key.eq_ignore_ascii_case("host") {
            for &i in &current {
                let host = &mut out.hosts[i];
                if key.eq_ignore_ascii_case("hostname") && host.hostname.is_none() && !value.is_empty() {
                    host.hostname = Some(value.to_string());
                } else if key.eq_ignore_ascii_case("user") && host.user.is_none() && !value.is_empty() {
                    host.user = Some(value.to_string());
                } else if key.eq_ignore_ascii_case("port") && host.port.is_none() {
                    host.port = value.parse().ok();
                }
            }
            continue;
        }
        current.clear();
        for pat in rest.split_whitespace().map(|p| p.trim_matches('"')) {
            if is_pattern(pat) {
                if !out.skipped.iter().any(|s| s == pat) {
                    out.skipped.push(pat.to_string());
                }
            } else if seen.insert(pat.to_lowercase()) {
                current.push(out.hosts.len());
                out.hosts.push(HostEntry {
                    alias: pat.to_string(),
                    hostname: None,
                    user: None,
                    port: None,
                });
            }
        }
    }
    out
}

/// `ssh -G` 的生效值
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Effective {
    pub hostname: String,
    pub user: String,
    pub port: u16,
    pub proxy_jump: Option<String>,
    pub identity_files: Vec<String>,
}

pub fn parse_ssh_g(out: &str) -> Effective {
    let mut e = Effective {
        port: 22,
        ..Default::default()
    };
    for line in out.lines() {
        let Some((k, v)) = line.trim_end_matches('\r').split_once(' ') else {
            continue;
        };
        match k {
            "hostname" => e.hostname = v.to_string(),
            "user" => e.user = v.to_string(),
            "port" => e.port = v.parse().unwrap_or(22),
            "proxyjump" if v != "none" => e.proxy_jump = Some(v.to_string()),
            "identityfile" => e.identity_files.push(v.to_string()),
            _ => {}
        }
    }
    e
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    #[test]
    fn scans_hosts_follows_include_and_skips_patterns() {
        let home = tempfile::tempdir().unwrap();
        let ssh = home.path().join(".ssh");
        fs::create_dir_all(ssh.join("conf.d")).unwrap();
        fs::write(
            ssh.join("config"),
            "Include conf.d/*.conf\nServerAliveInterval 30\n\nHost hk-edge sg-db\n  HostName 203.0.113.10\n  User root\n  Port 2222\n\nHost *.internal !bastion\n  User ops\n\nHost *\n  IdentitiesOnly yes\n",
        )
        .unwrap();
        fs::write(
            ssh.join("conf.d").join("work.conf"),
            "Host work-box\n  HostName 10.0.0.5\n",
        )
        .unwrap();

        let r = scan(&ssh.join("config"), home.path());
        let aliases: Vec<_> = r.hosts.iter().map(|h| h.alias.as_str()).collect();
        assert!(
            aliases.contains(&"hk-edge") && aliases.contains(&"sg-db") && aliases.contains(&"work-box"),
            "{aliases:?}"
        );
        let hk = r.hosts.iter().find(|h| h.alias == "hk-edge").unwrap();
        assert_eq!(
            (hk.hostname.as_deref(), hk.user.as_deref(), hk.port),
            (Some("203.0.113.10"), Some("root"), Some(2222))
        );
        assert!(r.skipped.contains(&"*.internal".to_string()), "{:?}", r.skipped);
        assert!(r.skipped.contains(&"!bastion".to_string()), "{:?}", r.skipped);
        assert!(r.skipped.contains(&"*".to_string()), "{:?}", r.skipped);
    }

    #[test]
    fn missing_config_is_empty() {
        let home = tempfile::tempdir().unwrap();
        assert_eq!(scan(&home.path().join("nope"), home.path()), ScanResult::default());
    }

    #[test]
    fn text_scan_reads_host_lines() {
        let r = scan_text("# Generated by CloudLink\nHost hk-edge\n  HostName x\nhost=dev-box\nHost *\n");
        assert_eq!(
            r.hosts.iter().map(|h| h.alias.as_str()).collect::<Vec<_>>(),
            ["hk-edge", "dev-box"]
        );
        assert_eq!(r.skipped, ["*"]);
        assert_eq!(r.hosts[0].hostname.as_deref(), Some("x"));
        assert_eq!(r.hosts[1].hostname, None);
    }

    #[test]
    fn text_scan_keeps_the_first_block_values_and_ignores_match_blocks() {
        let r = scan_text(concat!(
            "Host gh work\n  HostName = github.com\n  User git\n  Port 443\n  HostName other.example\n",
            "Match host box\n  User root\n",
            "Host box\n  User \"deploy\"\n",
        ));
        let gh = &r.hosts[0];
        assert_eq!(
            (gh.hostname.as_deref(), gh.user.as_deref(), gh.port),
            (Some("github.com"), Some("git"), Some(443))
        );
        assert_eq!(r.hosts[1].hostname.as_deref(), Some("github.com"));
        assert_eq!(r.hosts[2].user.as_deref(), Some("deploy"));
    }

    #[test]
    fn parsed_scan_reports_code_host_fields() {
        let home = tempfile::tempdir().unwrap();
        let config = home.path().join("config");
        std::fs::write(
            &config,
            "Host gh-443\n  HostName ssh.github.com\n  User git\n  Port 443\n",
        )
        .unwrap();
        let r = scan(&config, home.path());
        assert_eq!(r.hosts[0].hostname.as_deref(), Some("ssh.github.com"));
        assert_eq!(r.hosts[0].user.as_deref(), Some("git"));
    }

    #[test]
    fn parses_ssh_g() {
        let e = parse_ssh_g(
            "host hk-edge\r\nuser root\r\nhostname 203.0.113.10\r\nport 2222\r\nproxyjump none\r\nidentityfile ~/.ssh/id_ed25519\r\n",
        );
        assert_eq!(e.hostname, "203.0.113.10");
        assert_eq!(e.user, "root");
        assert_eq!(e.port, 2222);
        assert_eq!(e.proxy_jump, None);
        assert_eq!(e.identity_files, ["~/.ssh/id_ed25519"]);
        assert_eq!(
            parse_ssh_g("proxyjump bastion\n").proxy_jump.as_deref(),
            Some("bastion")
        );
    }
}
