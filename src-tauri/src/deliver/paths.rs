//! Skills 父目录允许既有链接；叶子及应用数据路径仍严格拒绝重解析点。

use std::collections::BTreeSet;
use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};
use std::time::Duration;

use crate::env::EnvContext;
use crate::error::{AppError, Result};
use crate::fsx;
use crate::model::delivery::{AddCustomTargetRequest, Target};
use crate::model::env::EnvId;
use crate::model::misc::IpcErrorId;
use crate::paths::Paths;

const MAX_LINKS: usize = 40;

pub(super) fn path_error(reason: &str) -> AppError {
    AppError::ipc_with(IpcErrorId::TargetExists, crate::params! {"reason" => reason})
}

fn bad_path() -> AppError {
    path_error("path-invalid")
}

pub(super) fn windows_component_ok(part: &str) -> bool {
    let name = part.split('.').next().unwrap_or("").to_ascii_uppercase();
    let numbered_device = |prefix: &str| {
        name.strip_prefix(prefix)
            .is_some_and(|number| number.len() == 1 && matches!(number.as_bytes()[0], b'1'..=b'9'))
    };
    !part.ends_with(['.', ' '])
        && !matches!(name.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        && !numbered_device("COM")
        && !numbered_device("LPT")
}

fn native_path_ok(env_id: &EnvId, native: &str) -> bool {
    if native.is_empty() || native.len() > 4096 || native.chars().any(char::is_control) {
        return false;
    }
    if env_id.wsl_distro().is_some() {
        return native.starts_with('/')
            && !native.contains(['\\', ':'])
            && native.split('/').all(|part| part != "." && part != "..");
    }
    let path = Path::new(native);
    if !path.is_absolute()
        || path.components().any(|part| matches!(part, Component::ParentDir))
        || native.split(['/', '\\']).any(|part| part == "." || part == "..")
        || native.starts_with(r"\\.\")
        || native.starts_with(r"\\?\")
    {
        return false;
    }
    if cfg!(windows)
        && native
            .char_indices()
            .any(|(i, c)| c == ':' && !(i == 1 && native.as_bytes()[0].is_ascii_alphabetic()))
    {
        return false;
    }
    if cfg!(windows) {
        for part in path.components().filter_map(|c| match c {
            Component::Normal(s) => s.to_str(),
            _ => None,
        }) {
            if !windows_component_ok(part) {
                return false;
            }
        }
    }
    true
}

fn host_path(paths: &Paths, env_id: &EnvId, native: &str) -> Result<PathBuf> {
    if !native_path_ok(env_id, native) {
        return Err(bad_path());
    }
    let host = match env_id.wsl_distro() {
        Some(distro) => {
            let mut p = paths.wsl_distro_root(distro);
            p.extend(native.split('/').filter(|part| !part.is_empty()));
            p
        }
        None if env_id.is_windows() => PathBuf::from(native),
        _ => return Err(AppError::ipc(IpcErrorId::NotFound)),
    };
    if paths.isolated
        && ![&paths.data_dir, &paths.user_home, &paths.wsl_root].iter().any(|root| {
            host.starts_with(root)
                || (crate::paths::validate_directory(root).is_ok()
                    && canonical_future(root).is_ok_and(|c| comparison(&host).starts_with(comparison(&c))))
        })
    {
        return Err(path_error("path-outside-isolation"));
    }
    Ok(host)
}

/// 应用数据、叶子和内部文件使用；不能把允许父链接扩散到这些路径。
pub(super) fn reject_link_ancestors(path: &Path) -> io::Result<()> {
    for ancestor in path.ancestors() {
        if ancestor.as_os_str().is_empty() {
            continue;
        }
        match fs::symlink_metadata(ancestor) {
            Ok(meta) if fsx::is_link(&meta) => {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "delivery path contains a link or reparse point",
                ));
            }
            Ok(_) => {}
            Err(e) if e.kind() == io::ErrorKind::NotFound => {}
            Err(e) => return Err(e),
        }
    }
    Ok(())
}

pub(crate) fn canonical_future(path: &Path) -> io::Result<PathBuf> {
    let mut current = path;
    let mut suffix = Vec::new();
    loop {
        match fs::symlink_metadata(current) {
            Ok(meta) => {
                if !meta.is_dir() {
                    return Err(io::Error::new(
                        io::ErrorKind::NotADirectory,
                        "skills parent is not a directory",
                    ));
                }
                let mut resolved = fs::canonicalize(current)?;
                for name in suffix.iter().rev() {
                    resolved.push(name);
                }
                return Ok(PathBuf::from(crate::fsx::ssh_path(&resolved.to_string_lossy())));
            }
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                suffix.push(
                    current
                        .file_name()
                        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "no existing ancestor"))?
                        .to_os_string(),
                );
                current = current
                    .parent()
                    .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "no parent"))?;
            }
            Err(e) => return Err(e),
        }
    }
}

fn lexical(path: &Path) -> Result<PathBuf> {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() {
                    return Err(bad_path());
                }
            }
            other => out.push(other.as_os_str()),
        }
    }
    if !out.is_absolute() {
        return Err(bad_path());
    }
    Ok(out)
}

pub(super) fn comparison(path: &Path) -> PathBuf {
    let text = crate::fsx::ssh_path(&path.to_string_lossy());
    if !cfg!(windows) {
        return PathBuf::from(text);
    }
    let lower = text.to_lowercase();
    for prefix in ["//wsl.localhost/", "//wsl$/"] {
        if lower.starts_with(prefix) {
            // UNC server/share names are Windows identifiers; everything after the
            // distro belongs to Linux. Folding it would merge different real directories.
            let rest = &text[prefix.len()..];
            let (distro, native) = rest.split_once('/').unwrap_or((rest, ""));
            return PathBuf::from(format!("//wsl.localhost/{}/{native}", distro.to_lowercase()));
        }
    }
    PathBuf::from(lower)
}

pub(super) fn overlap(a: &Path, b: &Path) -> bool {
    let (a, b) = (comparison(a), comparison(b));
    a.starts_with(&b) || b.starts_with(&a)
}

/// 逐个检查路径段，只对明确的父目录链接解引用；不存在后缀不会掩盖链接或重叠。
fn real_directory(path: &Path, simulated_wsl_root: Option<&Path>) -> Result<PathBuf> {
    let mut pending = path.to_path_buf();
    let mut seen = BTreeSet::new();
    for depth in 0..=MAX_LINKS {
        if !seen.insert(comparison(&pending)) {
            return Err(path_error("path-loop"));
        }
        let components: Vec<_> = pending.components().collect();
        let mut walked = PathBuf::new();
        let mut next = None;
        for (index, part) in components.iter().enumerate() {
            walked.push(part.as_os_str());
            let meta = match fs::symlink_metadata(&walked) {
                Ok(meta) => meta,
                Err(e) if e.kind() == io::ErrorKind::NotFound => break,
                Err(e) => return Err(e.into()),
            };
            if fsx::is_link(&meta) {
                if depth == MAX_LINKS {
                    return Err(path_error("path-loop"));
                }
                let link = fs::read_link(&walked)?;
                let link = if let Some(root) = simulated_wsl_root {
                    // 测试里的 Linux 绝对链接以发行版根解释，不跟随到宿主机的 /home。
                    let text = link.to_string_lossy();
                    if text.starts_with('/') && !link.starts_with(root) {
                        let mut mapped = root.to_path_buf();
                        mapped.extend(text.split('/').filter(|p| !p.is_empty()));
                        mapped
                    } else {
                        link
                    }
                } else {
                    link
                };
                let mut resolved = if link.is_absolute() {
                    link
                } else {
                    walked.parent().ok_or_else(bad_path)?.join(link)
                };
                // 悬空链接本身不是一个允许新建的目录。
                match fs::symlink_metadata(&resolved) {
                    Ok(meta) if meta.is_dir() || fsx::is_link(&meta) => {}
                    _ => return Err(path_error("path-unavailable")),
                }
                for suffix in components.iter().skip(index + 1) {
                    resolved.push(suffix.as_os_str());
                }
                next = Some(lexical(&resolved)?);
                break;
            }
            if !meta.is_dir() {
                return Err(path_error("path-invalid"));
            }
        }
        match next {
            Some(path) => pending = path,
            None => {
                let real = canonical_future(&pending)?;
                reject_link_ancestors(&real)?;
                return Ok(real);
            }
        }
    }
    Err(path_error("path-loop"))
}

// 路径是独立 argv。GNU realpath 可解析超过 40 层，先逐段 readlink 显式计数；-e 拒绝悬空链接。
const WSL_REAL_PARENT: &str = r#"LC_ALL=C; export LC_ALL
check=$1; links=0
newline='
'
while :; do
  parent=/; rest=${check#/}; linked=0
  while [ -n "$rest" ]; do
    part=${rest%%/*}
    if [ "$part" = "$rest" ]; then rest=; else rest=${rest#*/}; fi
    case "$part" in ''|.) continue ;; ..) parent=${parent%/*}; [ -n "$parent" ] || parent=/; continue ;; esac
    parent=${parent%/}/$part
    if [ -L "$parent" ]; then
      links=$((links + 1)); [ "$links" -le 40 ] || exit 4
      link=$(readlink -- "$parent" && printf '.') || exit 2
      link=${link%.}; link=${link%"$newline"}
      case "$link" in *[[:cntrl:]]*) exit 5 ;; esac
      case "$link" in /*) check=$link ;; *) check=${parent%/*}/$link ;; esac
      [ -z "$rest" ] || check=$check/$rest
      linked=1; break
    fi
    [ -e "$parent" ] || break
    [ -d "$parent" ] || exit 3
  done
  [ "$linked" = 1 ] || break
done
path=$1; suffix=
while [ ! -e "$path" ] && [ ! -L "$path" ]; do
  [ "$path" != / ] || exit 2
  name=${path##*/}; suffix=/$name$suffix; path=${path%/*}; [ -n "$path" ] || path=/
done
real=$(realpath -e -- "$path" && printf '.') || exit 2
real=${real%.}; real=${real%"$newline"}
case "$real" in *[[:cntrl:]]*) exit 5 ;; esac
[ -d "$real" ] || exit 3
dev=$(stat -c %d -- "$real") || exit 3
rootdev=$(stat -c %d /) || exit 3
homedev=$(stat -c %d -- "$2") || exit 3
printf '%s%s\n' "$real" "$suffix"
if [ "$dev" = "$rootdev" ] || [ "$dev" = "$homedev" ]; then printf 'local\n'; else printf 'mount\n'; fi"#;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResolvedParent {
    pub path: PathBuf,
    pub windows_shared: bool,
}

fn windows_mount(env: &EnvContext, native: &str) -> Option<PathBuf> {
    let rest = native.strip_prefix(&env.mount_prefix)?;
    let (drive, suffix) = rest.split_once('/')?;
    if drive.len() != 1 || !drive.as_bytes()[0].is_ascii_alphabetic() {
        return None;
    }
    Some(PathBuf::from(format!("{}:/{}", drive.to_ascii_uppercase(), suffix)))
}

fn checked_parent(paths: &Paths, env: &EnvContext, real: PathBuf, windows_shared: bool) -> Result<ResolvedParent> {
    reject_link_ancestors(&real)?;
    let permitted = [paths.data_dir.clone(), paths.user_home.clone(), paths.wsl_root.clone()];
    if paths.isolated {
        let roots: Vec<_> = permitted
            .iter()
            .map(|p| canonical_future(p).map(|p| comparison(&p)))
            .collect::<io::Result<_>>()?;
        if !roots.iter().any(|root| comparison(&real).starts_with(root)) {
            return Err(path_error("path-outside-isolation"));
        }
    }
    let data = canonical_future(&paths.data_dir)?;
    // CLOUDLINK_HOME 的默认模拟 home/wsl 在数据根下面；只给这些明确覆盖的测试树例外。
    let in_overlay = paths.isolated
        && [&paths.user_home, &paths.wsl_root]
            .iter()
            .any(|root| canonical_future(root).is_ok_and(|root| comparison(&real).starts_with(comparison(&root))));
    if overlap(&real, &data) && !in_overlay {
        return Err(path_error("path-overlap"));
    }
    for protected in [
        paths.compiled_dir(),
        paths.inbox_dir(),
        paths.tmp_dir(),
        paths.backups_dir(),
        paths.data_dir.join("guard"),
        paths.data_dir.join("bin"),
        paths.user_home.join(".ssh"),
        env.host_in_home(&[".ssh"]),
    ] {
        if overlap(&real, &canonical_future(&protected)?) {
            return Err(path_error("path-overlap"));
        }
    }
    Ok(ResolvedParent {
        path: real,
        windows_shared,
    })
}

/// WSL 真实链接必须在发行版内解析；隔离树使用同一套受控根的链接测试，不调用真实 WSL。
pub(crate) fn resolve_parent(paths: &Paths, env: &EnvContext, target: &Target) -> Result<ResolvedParent> {
    if target.env_id != env.id {
        return Err(AppError::ipc(IpcErrorId::NotFound));
    }
    let host = host_path(paths, &target.env_id, &target.path)?;
    let Some(distro) = env.distro() else {
        return checked_parent(paths, env, real_directory(&host, None)?, false);
    };
    if paths.isolated || cfg!(test) {
        let root = env.host_root.as_deref().ok_or_else(bad_path)?;
        let real = real_directory(&host, Some(root))?;
        let windows_shared = !comparison(&real).starts_with(comparison(&canonical_future(root)?));
        if windows_shared && !comparison(&real).starts_with(comparison(&canonical_future(&paths.user_home)?)) {
            return Err(path_error("wsl-path-unsupported"));
        }
        return checked_parent(paths, env, real, windows_shared);
    }
    let mut command = crate::proc::command("wsl.exe");
    command.args([
        "-d",
        distro,
        "-e",
        "sh",
        "-c",
        WSL_REAL_PARENT,
        "cloudlink-real-parent",
        &target.path,
        &env.home,
    ]);
    let output = crate::proc::run(
        command,
        crate::proc::RunOpts {
            timeout: Duration::from_secs(10),
            max_output: 16 * 1024,
            ..Default::default()
        },
    )?;
    if !output.success() {
        return Err(path_error(match output.code {
            Some(4) => "path-loop",
            Some(5) => "path-invalid",
            _ => "path-unavailable",
        }));
    }
    let text = output.stdout_str();
    let mut lines = text.lines();
    let native = lines.next().ok_or_else(bad_path)?;
    let location = lines.next().ok_or_else(bad_path)?;
    if lines.next().is_some() || !native_path_ok(&env.id, native) {
        return Err(bad_path());
    }
    if let Some(win) = windows_mount(env, native) {
        return checked_parent(paths, env, real_directory(&win, None)?, true);
    }
    if location != "local" {
        return Err(path_error("wsl-path-unsupported"));
    }
    checked_parent(paths, env, canonical_future(&env.to_host(native))?, false)
}

/// 普通操作不能通过 WSL 指向 Windows 的目录写入；D15 由计划层绑定现有 Windows 写入者。
pub fn resolve_target_path(paths: &Paths, env: &EnvContext, target: &Target) -> Result<PathBuf> {
    let resolved = resolve_parent(paths, env, target)?;
    if resolved.windows_shared {
        return Err(path_error("wsl-path-unsupported"));
    }
    Ok(resolved.path)
}

pub(crate) fn recheck_parent(paths: &Paths, env: &EnvContext, target: &Target, expected: &Path) -> Result<()> {
    let actual = resolve_target_path(paths, env, target)?;
    if comparison(&actual) != comparison(expected) {
        return Err(path_error("path-retargeted"));
    }
    reject_link_ancestors(expected)?;
    Ok(())
}

/// 相同的真实父目录允许加入共用组，嵌套仍拒绝。
pub fn validate_custom_target(
    paths: &Paths,
    env: &EnvContext,
    req: &AddCustomTargetRequest,
    targets: &[Target],
) -> Result<PathBuf> {
    let candidate = Target {
        id: "candidate".into(),
        env_id: req.env_id.clone(),
        agent: crate::model::delivery::AgentId::Custom,
        agent_key: "candidate".into(),
        label: req.label.clone(),
        path: req.path.clone(),
        enabled: true,
        detected: false,
    };
    let resolved = resolve_parent(paths, env, &candidate)?;
    for target in targets.iter().filter(|t| t.env_id == req.env_id) {
        let other = host_path(paths, &target.env_id, &target.path)?;
        if let Ok(other) = real_directory(
            &other,
            env.host_root.as_deref().filter(|_| paths.isolated || cfg!(test)),
        ) && comparison(&resolved.path) != comparison(&other)
            && overlap(&resolved.path, &other)
        {
            return Err(path_error("path-overlap"));
        }
    }
    Ok(resolved.path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn p8_wsl_native_paths_reject_segments_the_host_mapper_cannot_represent() {
        let env_id = EnvId::wsl("Fixture");
        assert!(native_path_ok(&env_id, "/home/fixture/资料 skills"));
        // EnvContext::to_host rejects colons and backslashes. Never turn those paths
        // into its .cloudlink-invalid-path sentinel and inspect or write outside the target.
        assert!(!native_path_ok(&env_id, "/home/fixture/colon:name"));
        assert!(!native_path_ok(&env_id, r"/home/fixture/back\slash"));
    }

    #[cfg(windows)]
    #[test]
    fn p8_wsl_real_directory_identity_preserves_linux_case() {
        assert_eq!(
            comparison(Path::new(r"C:\Fixture\Skills")),
            comparison(Path::new(r"c:\fixture\skills"))
        );
        assert_ne!(
            comparison(Path::new(r"\\wsl.localhost\Fixture\home\Skills")),
            comparison(Path::new(r"\\wsl.localhost\Fixture\home\skills"))
        );
        assert_eq!(
            comparison(Path::new(r"\\wsl.localhost\Fixture\home\skills")),
            comparison(Path::new(r"\\wsl$\fixture\home\skills"))
        );
    }
}
