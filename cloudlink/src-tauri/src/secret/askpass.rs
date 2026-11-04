//! `SSH_ASKPASS`（CC-SWITCH 二.1、二.2、二.3、二.6）。
//!
//! OpenSSH 把 `SSH_ASKPASS` 的值当作单个可执行文件路径调用，只追加一个参数（提示文本），
//! 所以辅助模式靠环境变量 `CLOUDLINK_SSH_ASKPASS=1` 触发，不靠命令行参数。
//! 辅助进程经 `127.0.0.1:<port>` 向主进程出示 64 位十六进制的一次性令牌，换取密码写到 stdout。
//! 密码只经这条本地连接传递，不出现在命令行、环境变量和日志里。

use std::io::{self, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::process::Command;
use std::time::Duration;

use ssh_key::rand_core::{OsRng, RngCore};
use zeroize::Zeroizing;

use super::SecretString;

pub const MARKER: &str = "CLOUDLINK_SSH_ASKPASS";
const PORT_VAR: &str = "CLOUDLINK_ASKPASS_PORT";
const TOKEN_VAR: &str = "CLOUDLINK_ASKPASS_TOKEN";
const TRUST_FINGERPRINT_VAR: &str = "CLOUDLINK_TRUST_FINGERPRINT";
const TOKEN_LEN: usize = 64;

/// `main()` 的第一条语句。检测到标记就执行辅助逻辑并立即退出，
/// 绝不进入 Tauri Builder（单实例插件会把这次调用转给已打开的窗口），也不向 stderr 或日志输出任何内容
pub fn dispatch() {
    if std::env::var_os(MARKER).is_none() {
        return;
    }
    let code = match helper() {
        Ok(()) => 0,
        Err(()) => 1,
    };
    std::process::exit(code);
}

/// 只接受密码提示：恰好一个参数、不超过 1024 字节、含 password、去掉末尾空白后以冒号结尾；
/// `SSH_ASKPASS_PROMPT=confirm`（主机密钥确认等）一律拒绝
pub fn prompt_is_password(prompt_kind: Option<&str>, args: &[String]) -> bool {
    if prompt_kind == Some("confirm") || args.len() != 1 {
        return false;
    }
    let p = &args[0];
    p.len() <= 1024 && p.to_lowercase().contains("password") && p.trim_end().ends_with(':')
}

fn helper() -> Result<(), ()> {
    let kind = std::env::var("SSH_ASKPASS_PROMPT").ok();
    let args: Vec<String> = std::env::args().skip(1).collect();
    if let Ok(fingerprint) = std::env::var(TRUST_FINGERPRINT_VAR)
        && let Some(answer) = host_key_response(&fingerprint, &args)
    {
        // OpenSSH confirm() accepts the exact fingerprint as an alternative to "yes".
        // A different fingerprint is refused before OpenSSH writes known_hosts or authenticates.
        return write_answer(answer.as_bytes()).map_err(|_| ());
    }
    if !prompt_is_password(kind.as_deref(), &args) {
        return Err(());
    }
    let port: u16 = std::env::var(PORT_VAR).map_err(|_| ())?.parse().map_err(|_| ())?;
    let token = std::env::var(TOKEN_VAR).map_err(|_| ())?;
    if token.len() != TOKEN_LEN || !token.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(());
    }
    let password = fetch(port, &token).map_err(|_| ())?;
    if password.is_empty() {
        return Err(());
    }
    write_answer(&password).map_err(|_| ())
}

fn write_answer(answer: &[u8]) -> io::Result<()> {
    let mut out = io::stdout().lock();
    out.write_all(answer)?;
    out.write_all(b"\n")?;
    out.flush()
}

/// Only a complete OpenSSH host-key question may receive the user-confirmed fingerprint.
/// This branch never reads the broker password, including when SSH_ASKPASS_PROMPT=confirm.
pub fn host_key_response<'a>(fingerprint: &'a str, args: &[String]) -> Option<&'a str> {
    let [prompt] = args else { return None };
    if prompt.len() > 4096
        || !prompt.contains("The authenticity of host ")
        || !prompt
            .trim_end()
            .ends_with("Are you sure you want to continue connecting (yes/no/[fingerprint])?")
    {
        return None;
    }
    if prompt.contains(&format!(" key fingerprint is {fingerprint}.")) {
        Some(fingerprint)
    } else {
        Some("no")
    }
}

fn configure_helper(cmd: &mut Command) -> io::Result<()> {
    let exe = std::env::current_exe()?;
    if cfg!(windows) {
        let dir = exe.parent().ok_or_else(|| io::Error::other("exe has no parent"))?;
        let name = exe.file_name().ok_or_else(|| io::Error::other("exe has no name"))?;
        cmd.current_dir(dir)
            .env("SSH_ASKPASS", format!("./{}", name.to_string_lossy()));
    } else {
        cmd.env("SSH_ASKPASS", &exe);
    }
    cmd.env("SSH_ASKPASS_REQUIRE", "force")
        .env("DISPLAY", "cloudlink-askpass")
        .env(MARKER, "1");
    Ok(())
}

/// Public host-key confirmation, separate from the one-time password capability.
pub fn configure_host_key(cmd: &mut Command, fingerprint: &str) -> io::Result<()> {
    validate_fingerprint(fingerprint)?;
    configure_helper(cmd)?;
    cmd.env(TRUST_FINGERPRINT_VAR, fingerprint)
        .env_remove(PORT_VAR)
        .env_remove(TOKEN_VAR);
    Ok(())
}

fn validate_fingerprint(fingerprint: &str) -> io::Result<()> {
    if !fingerprint.starts_with("SHA256:")
        || fingerprint.len() <= 7
        || fingerprint.len() > 100
        || !fingerprint[7..]
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '/'))
    {
        return Err(io::Error::other("invalid host-key fingerprint"));
    }
    Ok(())
}

/// WSL ssh executes the Windows helper through interop. All transferred values are public;
/// the password capability variables are explicitly excluded in both directions.
pub fn configure_wsl_host_key(
    cmd: &mut Command,
    fingerprint: &str,
    helper_native: &str,
    inherited_wslenv: &str,
) -> io::Result<()> {
    validate_fingerprint(fingerprint)?;
    if !helper_native.starts_with('/') || helper_native.contains('\\') || helper_native.chars().any(char::is_control) {
        return Err(io::Error::other("invalid WSL askpass helper path"));
    }
    let public = [
        MARKER,
        TRUST_FINGERPRINT_VAR,
        "SSH_ASKPASS",
        "SSH_ASKPASS_REQUIRE",
        "DISPLAY",
    ];
    let mut entries: Vec<&str> = inherited_wslenv
        .split(':')
        .filter(|entry| {
            let name = entry.split('/').next().unwrap_or("");
            !name.is_empty() && !public.contains(&name) && name != PORT_VAR && name != TOKEN_VAR
        })
        .collect();
    entries.extend(public);
    cmd.env("SSH_ASKPASS", helper_native)
        .env("SSH_ASKPASS_REQUIRE", "force")
        .env("DISPLAY", "cloudlink-askpass")
        .env(MARKER, "1")
        .env(TRUST_FINGERPRINT_VAR, fingerprint)
        .env("WSLENV", entries.join(":"))
        .env_remove(PORT_VAR)
        .env_remove(TOKEN_VAR);
    Ok(())
}

fn fetch(port: u16, token: &str) -> io::Result<Zeroizing<Vec<u8>>> {
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_secs(2))?;
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    stream.set_write_timeout(Some(Duration::from_secs(5)))?;
    stream.write_all(token.as_bytes())?;
    stream.write_all(b"\n")?;
    let mut buf = Zeroizing::new(Vec::with_capacity(256));
    stream.take(4097).read_to_end(&mut buf)?;
    Ok(buf)
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// 主进程一侧。不起后台线程：由子进程执行循环的 tick 驱动 `poll()`
pub struct AskpassBroker {
    listener: TcpListener,
    token: Zeroizing<String>,
    password: Option<SecretString>,
}

impl AskpassBroker {
    pub fn start(password: SecretString) -> io::Result<Self> {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
        listener.set_nonblocking(true)?;
        let mut raw = [0u8; TOKEN_LEN / 2];
        OsRng.fill_bytes(&mut raw);
        let token = Zeroizing::new(raw.iter().map(|b| format!("{b:02x}")).collect::<String>());
        Ok(AskpassBroker {
            listener,
            token,
            password: Some(password),
        })
    }

    pub fn port(&self) -> io::Result<u16> {
        Ok(self.listener.local_addr()?.port())
    }

    /// 密码是否已经交出去了（一次性）
    pub fn consumed(&self) -> bool {
        self.password.is_none()
    }

    /// 给 ssh 子进程配置 askpass 环境。Windows 上用 `current_dir(exe 所在目录)` 加 `./cloudlink.exe`，
    /// 规避 OpenSSH 9.5p1 读取非 ASCII 路径时的损坏（CC-SWITCH 二.2）
    pub fn configure(&self, cmd: &mut Command) -> io::Result<()> {
        configure_helper(cmd)?;
        cmd.env_remove(TRUST_FINGERPRINT_VAR)
            .env(PORT_VAR, self.port()?.to_string())
            .env(TOKEN_VAR, self.token.as_str());
        Ok(())
    }

    /// 处理一个待接入的连接；没有连接时立即返回
    pub fn poll(&mut self) -> io::Result<()> {
        let (mut conn, peer) = match self.listener.accept() {
            Ok(c) => c,
            Err(e) if e.kind() == io::ErrorKind::WouldBlock => return Ok(()),
            Err(e) => return Err(e),
        };
        if !peer.ip().is_loopback() {
            return Ok(());
        }
        // Windows 上 accept() 返回的连接继承了监听端的非阻塞模式，必须改回阻塞，再设短超时
        conn.set_nonblocking(false)?;
        conn.set_read_timeout(Some(Duration::from_millis(100)))?;
        conn.set_write_timeout(Some(Duration::from_millis(100)))?;
        let mut presented = Zeroizing::new([0u8; TOKEN_LEN + 1]);
        if conn.read_exact(&mut presented[..]).is_err() {
            return Ok(());
        }
        let ok = presented[TOKEN_LEN] == b'\n' && constant_time_eq(&presented[..TOKEN_LEN], self.token.as_bytes());
        if !ok {
            return Ok(());
        }
        if let Some(password) = self.password.take() {
            let _ = conn.write_all(password.expose().as_bytes());
            let _ = conn.flush();
        }
        Ok(())
    }

    /// 取消或超时：立即销毁密码
    pub fn revoke(&mut self) {
        self.password = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompt_filter() {
        let one = |s: &str| vec![s.to_string()];
        assert!(prompt_is_password(None, &one("root@203.0.113.10's password: ")));
        assert!(prompt_is_password(None, &one("(root@h) Password:")));
        assert!(!prompt_is_password(Some("confirm"), &one("root@h's password: ")));
        assert!(!prompt_is_password(
            None,
            &one("Are you sure you want to continue connecting (yes/no)?")
        ));
        assert!(!prompt_is_password(None, &one("Enter passphrase for key '/k': ")));
        assert!(!prompt_is_password(None, &[]));
        assert!(!prompt_is_password(None, &["a password:".into(), "b".into()]));
        assert!(!prompt_is_password(
            None,
            &one(&format!("{}password:", "x".repeat(1100)))
        ));
    }

    #[test]
    fn host_confirmation_returns_only_the_exact_confirmed_fingerprint() {
        let prompt = |fingerprint: &str| {
            vec![format!(
                "The authenticity of host 'hk-edge (127.0.0.1)' can't be established.\nED25519 key fingerprint is {fingerprint}.\nAre you sure you want to continue connecting (yes/no/[fingerprint])? "
            )]
        };
        assert_eq!(
            host_key_response("SHA256:confirmed", &prompt("SHA256:confirmed")),
            Some("SHA256:confirmed")
        );
        assert_eq!(
            host_key_response("SHA256:confirmed", &prompt("SHA256:changed")),
            Some("no")
        );
        assert_eq!(
            host_key_response("SHA256:confirmed", &["root@hk-edge's password: ".into()]),
            None
        );
        assert_eq!(
            host_key_response("SHA256:confirmed", &["Please type 'yes' or 'no': ".into()]),
            None
        );
    }

    #[test]
    fn wsl_host_confirmation_uses_an_absolute_helper_and_only_public_values() {
        let mut cmd = Command::new("wsl.exe");
        configure_wsl_host_key(
            &mut cmd,
            "SHA256:confirmed",
            "/mnt/c/Users/中文 名/cloudlink.exe",
            "USER_VAR/p:CLOUDLINK_TRUST_FINGERPRINT/u:CLOUDLINK_ASKPASS_PORT:CLOUDLINK_ASKPASS_TOKEN",
        )
        .unwrap();
        let vars: std::collections::HashMap<_, _> = cmd
            .get_envs()
            .map(|(key, value)| {
                (
                    key.to_string_lossy().into_owned(),
                    value.map(|v| v.to_string_lossy().into_owned()),
                )
            })
            .collect();
        assert_eq!(
            vars["SSH_ASKPASS"].as_deref(),
            Some("/mnt/c/Users/中文 名/cloudlink.exe")
        );
        let transferred: Vec<_> = vars["WSLENV"].as_deref().unwrap().split(':').collect();
        for name in [
            "USER_VAR/p",
            MARKER,
            TRUST_FINGERPRINT_VAR,
            "SSH_ASKPASS",
            "SSH_ASKPASS_REQUIRE",
            "DISPLAY",
        ] {
            assert!(transferred.contains(&name), "missing {name}");
        }
        assert!(!transferred.contains(&PORT_VAR));
        assert!(!transferred.contains(&TOKEN_VAR));
        assert_eq!(vars[PORT_VAR], None);
        assert_eq!(vars[TOKEN_VAR], None);
        assert_eq!(
            transferred
                .iter()
                .filter(|name| **name == TRUST_FINGERPRINT_VAR)
                .count(),
            1
        );
    }

    fn serve_once(broker: &mut AskpassBroker, client: impl FnOnce(u16) -> Vec<u8> + Send + 'static) -> Vec<u8> {
        let port = broker.port().unwrap();
        let handle = std::thread::spawn(move || client(port));
        for _ in 0..200 {
            broker.poll().unwrap();
            if handle.is_finished() {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        handle.join().unwrap()
    }

    #[test]
    fn broker_hands_out_password_once_for_the_right_token() {
        let mut broker = AskpassBroker::start(SecretString::new("s3 cret".into()).unwrap()).unwrap();
        let token = broker.token.to_string();

        let wrong = "0".repeat(TOKEN_LEN);
        let got = serve_once(&mut broker, move |port| {
            fetch(port, &wrong).map(|b| b.to_vec()).unwrap_or_default()
        });
        assert!(got.is_empty());
        assert!(!broker.consumed());

        let t = token.clone();
        let got = serve_once(&mut broker, move |port| fetch(port, &t).unwrap().to_vec());
        assert_eq!(got, b"s3 cret");
        assert!(broker.consumed());

        let got = serve_once(&mut broker, move |port| {
            fetch(port, &token).map(|b| b.to_vec()).unwrap_or_default()
        });
        assert!(got.is_empty(), "the password is single-use");
    }

    #[test]
    fn main_dispatches_askpass_before_anything_else() {
        let src = include_str!("../main.rs");
        let body = src.split("fn main()").nth(1).expect("fn main");
        let first = body
            .lines()
            .map(str::trim)
            .find(|l| !l.is_empty() && *l != "{" && !l.starts_with("//"))
            .expect("first statement");
        assert_eq!(first, "cloudlink_lib::secret::askpass::dispatch();");
    }
}
