//! 运行环境检测（F-301、PRD 8.1 env）。
//!
//! 每个环境有两套路径写法：该环境自己的写法（`native`，例如 `/home/me/.ssh/config`，交给该环境里的
//! ssh 用），以及 CloudLink 进程能直接读写的位置（`host`，例如 `\\wsl.localhost\Ubuntu\home\me\.ssh\config`）。
//! 隔离模式（设置了 `CLOUDLINK_HOME`）下不调用 `wsl.exe`，WSL 发行版由 `CLOUDLINK_FAKE_WSL` 模拟。

use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::model::env::{EnvId, valid_distro};
use crate::paths::Paths;
use crate::proc::{self, RunOpts};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EnvKind {
    Windows,
    Wsl { distro: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnvContext {
    pub id: EnvId,
    pub label: String,
    pub kind: EnvKind,
    /// Explicit path overrides must also constrain the SSH client's built-in profile fallbacks.
    pub isolated: bool,
    /// 该环境写法的家目录
    pub home: String,
    /// CloudLink 能访问的家目录位置
    pub host_home: PathBuf,
    /// WSL：发行版的 `/` 在 Windows 侧的位置
    pub host_root: Option<PathBuf>,
    pub available: bool,
    /// WSL 互操作是否可用（WSL 里的护栏依赖它）；Windows 恒为 true
    pub interop: bool,
    /// WSL 的 Windows 盘挂载前缀，默认 `/mnt/`
    pub mount_prefix: String,
}

impl EnvContext {
    pub fn windows(paths: &Paths) -> Self {
        EnvContext {
            id: EnvId::windows(),
            label: "Windows".into(),
            kind: EnvKind::Windows,
            isolated: paths.isolated,
            home: paths.user_home.to_string_lossy().into_owned(),
            host_home: paths.user_home.clone(),
            host_root: None,
            available: true,
            interop: true,
            mount_prefix: String::new(),
        }
    }

    pub fn wsl(paths: &Paths, distro: &str, info: WslInfo) -> Self {
        let root = paths.wsl_distro_root(distro);
        let available = info.home.starts_with('/');
        let home = if available {
            info.home
        } else {
            format!("/home/{}", if info.user.is_empty() { "user" } else { &info.user })
        };
        EnvContext {
            id: EnvId::wsl(distro),
            label: format!("WSL - {distro}"),
            kind: EnvKind::Wsl {
                distro: distro.to_string(),
            },
            isolated: paths.isolated,
            host_home: join_native(&root, &home),
            home,
            host_root: Some(root),
            available,
            interop: info.interop,
            mount_prefix: if info.mount_prefix.is_empty() {
                "/mnt/".into()
            } else {
                info.mount_prefix
            },
        }
    }

    pub fn distro(&self) -> Option<&str> {
        match &self.kind {
            EnvKind::Wsl { distro } => Some(distro),
            EnvKind::Windows => None,
        }
    }

    pub fn is_windows(&self) -> bool {
        self.kind == EnvKind::Windows
    }

    /// 家目录下的路径，用该环境的写法
    pub fn native_in_home(&self, rel: &[&str]) -> String {
        match self.kind {
            EnvKind::Windows => {
                let mut p = PathBuf::from(&self.home);
                p.extend(rel);
                p.to_string_lossy().into_owned()
            }
            EnvKind::Wsl { .. } => format!("{}/{}", self.home.trim_end_matches('/'), rel.join("/")),
        }
    }

    /// 家目录下的路径，CloudLink 访问的位置
    pub fn host_in_home(&self, rel: &[&str]) -> PathBuf {
        let mut p = self.host_home.clone();
        p.extend(rel);
        p
    }

    /// 该环境写法的绝对路径 → CloudLink 访问的位置
    pub fn to_host(&self, native: &str) -> PathBuf {
        match &self.host_root {
            Some(root) => join_native(root, native),
            None => PathBuf::from(native),
        }
    }

    /// Windows 侧的路径 → 该环境的写法（WSL 中为 `/mnt/c/...`，PRD F-308 笔记收件箱、8.6 护栏路径）
    pub fn windows_path_to_native(&self, win: &Path) -> String {
        let s = crate::fsx::ssh_path(&win.to_string_lossy());
        match self.kind {
            EnvKind::Windows => s,
            EnvKind::Wsl { .. } => match s.as_bytes() {
                [d, b':', b'/', ..] if d.is_ascii_alphabetic() => {
                    format!("{}{}/{}", self.mount_prefix, (*d as char).to_ascii_lowercase(), &s[3..])
                }
                _ => s,
            },
        }
    }

    pub fn ssh_config_native(&self) -> String {
        self.native_in_home(&[".ssh", "config"])
    }
    pub fn managed_config_native(&self) -> String {
        self.native_in_home(&[".ssh", "cloudlink.conf"])
    }
    pub fn known_hosts_native(&self) -> String {
        self.native_in_home(&[".ssh", "known_hosts"])
    }
}

/// 把 `/a/b/c` 这样的绝对路径接到 root 下（只接受正常的路径段，丢弃 `.`、`..` 和空段）
fn join_native(root: &Path, native: &str) -> PathBuf {
    // On Windows, pushing a segment such as C:\Users or \\server\share resets PathBuf's root.
    // These forms cannot be represented as WSL-native path segments on the host filesystem.
    if native.contains(['\\', ':']) || native.chars().any(char::is_control) {
        return root.join(".cloudlink-invalid-path");
    }
    let mut p = root.to_path_buf();
    for seg in native.split('/') {
        if !seg.is_empty() && seg != "." && seg != ".." {
            p.push(seg);
        }
    }
    p
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct WslInfo {
    pub home: String,
    pub user: String,
    pub interop: bool,
    pub mount_prefix: String,
}

/// `wsl.exe -l -q` 的输出：通常是 UTF-16LE（可能带 BOM），设置了 `WSL_UTF8=1` 时是 UTF-8
pub fn parse_wsl_list(raw: &[u8]) -> Vec<String> {
    let looks_utf16 = raw.len() >= 2 && raw.iter().skip(1).step_by(2).filter(|b| **b == 0).count() * 2 >= raw.len() / 2;
    let text = if looks_utf16 {
        let units: Vec<u16> = raw.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        String::from_utf16_lossy(&units)
    } else {
        String::from_utf8_lossy(raw).into_owned()
    };
    text.replace(['\u{feff}', '\0', '\r'], "")
        .lines()
        .map(str::trim)
        .filter(|d| !d.is_empty() && valid_distro(d) && !d.starts_with("docker-desktop"))
        .map(String::from)
        .collect()
}

/// 在发行版里一次取回家目录、用户名、互操作状态和挂载前缀
pub const WSL_INFO_SCRIPT: &str = r#"printf 'home=%s\n' "$HOME"; printf 'user=%s\n' "$(id -un 2>/dev/null)"; if [ -e /proc/sys/fs/binfmt_misc/WSLInterop ] || [ -e /proc/sys/fs/binfmt_misc/WSLInterop-late ]; then echo interop=1; else echo interop=0; fi; printf 'mnt=%s\n' "$(wslpath -u 'C:\' 2>/dev/null)""#;

pub fn parse_wsl_info(out: &str) -> WslInfo {
    let mut info = WslInfo::default();
    for line in out.lines() {
        let line = line.trim_end_matches('\r');
        if let Some(v) = line.strip_prefix("home=") {
            info.home = v.to_string();
        } else if let Some(v) = line.strip_prefix("user=") {
            info.user = v.to_string();
        } else if let Some(v) = line.strip_prefix("interop=") {
            info.interop = v == "1";
        } else if let Some(v) = line.strip_prefix("mnt=") {
            // `/mnt/c/` → `/mnt/`
            let v = v.trim_end_matches('/');
            if let Some(prefix) = v.strip_suffix("/c") {
                info.mount_prefix = format!("{prefix}/");
            }
        }
    }
    info
}

/// `ssh-add -l`：0 = 有密钥（每行一个），1 = agent 里没有密钥，2 及其他 = 连不上 agent
pub fn parse_ssh_add(code: Option<i32>, stdout: &str) -> Option<u32> {
    match code {
        Some(0) => Some(stdout.lines().filter(|l| !l.trim().is_empty()).count() as u32),
        Some(1) => Some(0),
        _ => None,
    }
}

/// 检测时会调用的外部程序。真实实现调用 `wsl.exe`，测试和隔离模式用假的
pub trait System: Send + Sync {
    fn wsl_distros(&self) -> Vec<String>;
    fn wsl_info(&self, distro: &str) -> Option<WslInfo>;
    fn ssh_agent_keys(&self, env: &EnvContext) -> Option<u32>;
}

pub struct RealSystem {
    /// Windows OpenSSH 目录，用来找 `ssh-add.exe`
    pub openssh_dir: PathBuf,
}

const WSL_TIMEOUT: Duration = Duration::from_secs(20);

impl System for RealSystem {
    fn wsl_distros(&self) -> Vec<String> {
        if !cfg!(windows) {
            return Vec::new();
        }
        let mut cmd = proc::command("wsl.exe");
        cmd.args(["-l", "-q"]);
        match proc::run(
            cmd,
            RunOpts {
                timeout: WSL_TIMEOUT,
                ..Default::default()
            },
        ) {
            Ok(o) if o.success() => parse_wsl_list(&o.stdout),
            _ => Vec::new(),
        }
    }

    fn wsl_info(&self, distro: &str) -> Option<WslInfo> {
        if !valid_distro(distro) {
            return None;
        }
        let mut cmd = proc::command("wsl.exe");
        cmd.args(["-d", distro, "-e", "sh", "-c", WSL_INFO_SCRIPT]);
        let o = proc::run(
            cmd,
            RunOpts {
                timeout: WSL_TIMEOUT,
                ..Default::default()
            },
        )
        .ok()?;
        o.success().then(|| parse_wsl_info(&o.stdout_str()))
    }

    fn ssh_agent_keys(&self, env: &EnvContext) -> Option<u32> {
        let mut cmd = match env.distro() {
            None => proc::command(self.openssh_dir.join("ssh-add.exe")),
            Some(d) => {
                let mut c = proc::command("wsl.exe");
                c.args(["-d", d, "-e"]);
                c
            }
        };
        if env.distro().is_some() {
            cmd.arg("ssh-add");
        }
        cmd.arg("-l");
        let o = proc::run(
            cmd,
            RunOpts {
                timeout: Duration::from_secs(10),
                ..Default::default()
            },
        )
        .ok()?;
        if o.ended != proc::Ended::Exited {
            return None;
        }
        parse_ssh_add(o.code, &o.stdout_str())
    }
}

/// 隔离模式：`CLOUDLINK_FAKE_WSL=Ubuntu-24.04,Debian` 模拟发行版，家目录为 `/home/me`，不执行任何外部程序
#[derive(Default)]
pub struct FakeSystem {
    pub distros: Vec<String>,
    pub interop: bool,
    pub agent_keys: Option<u32>,
}

impl FakeSystem {
    pub fn from_env() -> Self {
        let distros = std::env::var("CLOUDLINK_FAKE_WSL")
            .unwrap_or_default()
            .split(',')
            .map(str::trim)
            .filter(|d| valid_distro(d))
            .map(String::from)
            .collect();
        FakeSystem {
            distros,
            interop: true,
            agent_keys: None,
        }
    }
}

impl System for FakeSystem {
    fn wsl_distros(&self) -> Vec<String> {
        self.distros.clone()
    }
    fn wsl_info(&self, distro: &str) -> Option<WslInfo> {
        self.distros.iter().any(|d| d == distro).then(|| WslInfo {
            home: "/home/me".into(),
            user: "me".into(),
            interop: self.interop,
            mount_prefix: "/mnt/".into(),
        })
    }
    fn ssh_agent_keys(&self, _env: &EnvContext) -> Option<u32> {
        self.agent_keys
    }
}

/// 列出全部运行环境：Windows 在前，然后是各个 WSL 发行版。取不到信息的发行版标为不可用
pub fn detect(paths: &Paths, sys: &dyn System) -> Vec<EnvContext> {
    let mut out = vec![EnvContext::windows(paths)];
    for distro in sys.wsl_distros() {
        let info = sys.wsl_info(&distro).unwrap_or_default();
        out.push(EnvContext::wsl(paths, &distro, info));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utf16(s: &str) -> Vec<u8> {
        let mut v = vec![0xff, 0xfe];
        v.extend(s.encode_utf16().flat_map(u16::to_le_bytes));
        v
    }

    #[test]
    fn wsl_list_decodes_utf16_and_drops_noise() {
        let raw = utf16("Ubuntu-24.04\r\ndocker-desktop\r\nDebian\r\n\r\n");
        assert_eq!(parse_wsl_list(&raw), ["Ubuntu-24.04", "Debian"]);
        assert_eq!(parse_wsl_list(b"Ubuntu\nkali-linux\n"), ["Ubuntu", "kali-linux"]);
        assert!(parse_wsl_list(&utf16("")).is_empty());
        assert!(parse_wsl_list(&utf16("../evil\r\n-d\r\n")).is_empty());
    }

    #[test]
    fn wsl_info_parsing() {
        let i = parse_wsl_info("home=/home/furina\nuser=furina\ninterop=1\nmnt=/mnt/c/\n");
        assert_eq!(
            i,
            WslInfo {
                home: "/home/furina".into(),
                user: "furina".into(),
                interop: true,
                mount_prefix: "/mnt/".into()
            }
        );
        let i = parse_wsl_info("home=/root\r\ninterop=0\r\nmnt=/win/c\r\n");
        assert!(!i.interop);
        assert_eq!(i.mount_prefix, "/win/");
    }

    #[test]
    fn ssh_add_exit_codes() {
        assert_eq!(
            parse_ssh_add(Some(0), "256 SHA256:x a (ED25519)\n256 SHA256:y b (ED25519)\n"),
            Some(2)
        );
        assert_eq!(parse_ssh_add(Some(1), "The agent has no identities.\n"), Some(0));
        assert_eq!(parse_ssh_add(Some(2), ""), None);
        assert_eq!(parse_ssh_add(None, ""), None);
    }

    #[test]
    fn path_mapping_stays_inside_isolated_roots() {
        let tmp = tempfile::tempdir().unwrap();
        let paths = Paths::isolated_in(tmp.path());
        let sys = FakeSystem {
            distros: vec!["Ubuntu-24.04".into()],
            interop: true,
            agent_keys: None,
        };
        let envs = detect(&paths, &sys);
        assert_eq!(envs.len(), 2);
        let (win, wsl) = (&envs[0], &envs[1]);
        assert_eq!(wsl.id.as_str(), "wsl:Ubuntu-24.04");
        assert_eq!(wsl.ssh_config_native(), "/home/me/.ssh/config");
        assert_eq!(
            wsl.to_host("/home/me/.ssh/config"),
            tmp.path().join("wsl/Ubuntu-24.04/home/me/.ssh/config")
        );
        assert_eq!(
            wsl.to_host("/home/me/../../etc/shadow"),
            tmp.path().join("wsl/Ubuntu-24.04/home/me/etc/shadow")
        );
        assert_eq!(
            wsl.windows_path_to_native(Path::new(r"C:\Users\me\.cloudlink\inbox")),
            "/mnt/c/Users/me/.cloudlink/inbox"
        );
        assert_eq!(
            win.windows_path_to_native(Path::new(r"C:\Users\me\.cloudlink\inbox")),
            "C:/Users/me/.cloudlink/inbox"
        );
        for e in &envs {
            assert!(e.host_home.starts_with(tmp.path()), "{:?}", e.host_home);
        }
    }

    #[test]
    fn unavailable_distro_keeps_a_safe_home() {
        let tmp = tempfile::tempdir().unwrap();
        let paths = Paths::isolated_in(tmp.path());
        let e = EnvContext::wsl(&paths, "Broken", WslInfo::default());
        assert!(!e.available);
        assert!(e.host_home.starts_with(tmp.path()));
    }

    #[cfg(windows)]
    #[test]
    fn windows_shaped_native_paths_never_escape_the_wsl_root() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("isolated-wsl");
        for native in [
            "/C:\\Users\\outside\\.ssh\\config",
            "/home/me/C:\\outside\\config",
            "C:/outside/config",
            "/\\\\server\\share\\config",
            "/home/me/dir\\other/config",
        ] {
            let mapped = join_native(&root, native);
            assert!(mapped.starts_with(&root), "{native} escaped to {}", mapped.display());
            assert!(
                mapped.ends_with(".cloudlink-invalid-path"),
                "invalid native path must be rejected"
            );
        }
    }
}
