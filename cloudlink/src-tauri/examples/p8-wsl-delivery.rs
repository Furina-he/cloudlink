//! Manual P8 regression against an explicitly owned Windows/WSL fixture; never discovers HOME.
//! Usage: cargo run --example p8-wsl-delivery -- <windows-root> <wsl-root> <distro>

use std::fs;
use std::path::{Path, PathBuf};

use cloudlink_lib::compile::publish::{self, Marker};
use cloudlink_lib::deliver;
use cloudlink_lib::env::{EnvContext, WslInfo};
use cloudlink_lib::model::compile::CompiledFile;
use cloudlink_lib::model::delivery::{AgentId, DeliveryStatus, Target};
use cloudlink_lib::paths::Paths;

fn require_fixture(root: &Path, kind: &str) {
    let metadata = fs::symlink_metadata(root).expect("fixture root must exist");
    assert!(metadata.is_dir() && !cloudlink_lib::fsx::is_link(&metadata));
    let marker = root.join(".cloudlink.json");
    let metadata = fs::symlink_metadata(&marker).expect("fixture marker must exist");
    assert!(metadata.is_file() && !cloudlink_lib::fsx::is_link(&metadata));
    let value: serde_json::Value = serde_json::from_slice(&fs::read(marker).unwrap()).unwrap();
    assert_eq!(value, serde_json::json!({"managedBy": "cloudlink", "kind": kind}));
}

fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    assert_eq!(args.len(), 3, "all fixture paths must be explicit");
    let windows = PathBuf::from(&args[0]);
    let native = &args[1];
    let distro = &args[2];
    assert!(windows.is_absolute());
    assert!(native.starts_with("/tmp/cloudlink-p8-parents-"));
    assert!(!native.contains("..") && !native.chars().any(char::is_control));
    assert!(cloudlink_lib::model::env::valid_distro(distro));
    require_fixture(&windows, "p8-windows-parent-fixture");
    let paths = Paths {
        data_dir: windows.join("data"),
        user_home: windows.join("home"),
        wsl_root: PathBuf::from(r"\\wsl.localhost"),
        // The library is compiled without cfg(test), so this takes the actual WSL resolver.
        // Every reachable input is instead pinned to the explicit fixture above/below.
        isolated: false,
    };
    let env = EnvContext::wsl(
        &paths,
        distro,
        WslInfo {
            home: format!("{native}/home"),
            user: "fixture".into(),
            interop: true,
            mount_prefix: "/mnt/".into(),
        },
    );
    let root = env.to_host(native);
    require_fixture(&root, "p8-wsl-parent-fixture");
    let target = |rel: &str| Target {
        id: "tgt_manual_p8_wsl".into(),
        env_id: env.id.clone(),
        agent: AgentId::Universal,
        agent_key: "universal".into(),
        label: "Fixture".into(),
        path: format!("{native}/home/{rel}"),
        enabled: true,
        detected: true,
    };
    let selected = target(".agents/skills");
    let real = deliver::resolve_target_path(&paths, &env, &selected).unwrap();
    assert_eq!(real, env.to_host(&format!("{native}/home/real skills")));
    assert!(real.starts_with(&root));
    let neighbor = real.join("neighbor.txt");
    let before = fs::read(&neighbor).unwrap();
    let files = vec![CompiledFile {
        path: "SKILL.md".into(),
        content: "# Isolated WSL delivery fixture\n".into(),
    }];
    let marker = Marker {
        managed_by: publish::MANAGED_BY.into(),
        env_id: env.id.to_string(),
        agent_key: "universal".into(),
        agent_keys: Vec::new(),
        content_hash: publish::files_hash(&files),
        compiled_at: cloudlink_lib::time::now_rfc3339(),
        template_version: 1,
    };
    let delivered = deliver::sync(&paths, &env, &selected, &files, &marker, false).unwrap();
    assert_eq!(delivered.status, DeliveryStatus::Ok);
    assert_eq!(
        fs::read(real.join(publish::SKILL_DIR).join("SKILL.md")).unwrap(),
        files[0].content.as_bytes()
    );
    assert!(deliver::remove(&paths, &env, &selected).unwrap());
    assert!(!real.join(publish::SKILL_DIR).exists());
    assert_eq!(fs::read(neighbor).unwrap(), before);

    let missing = target("ancestor link/new/skills");
    assert_eq!(
        deliver::resolve_target_path(&paths, &env, &missing).unwrap(),
        env.to_host(&format!("{native}/home/ancestor real/new/skills"))
    );
    assert!(!env.to_host(&format!("{native}/home/ancestor real/new")).exists());
    for path in ["dangling", "cycle-a", "deep-0"] {
        assert_eq!(
            deliver::inspect(&paths, &env, &target(path), None).unwrap().status,
            DeliveryStatus::Broken
        );
    }
    let cross = target(".claude/skills");
    assert_eq!(
        deliver::sync(&paths, &env, &cross, &files, &marker, false)
            .unwrap()
            .status,
        DeliveryStatus::Broken
    );
    assert!(!windows.join("Windows shared skills").join(publish::SKILL_DIR).exists());
    println!(
        "{}",
        serde_json::json!({"realWslDelivery": true, "parentResolved": true, "copyAndRemove": true, "neighborsPreserved": true, "windowsNotWrittenFromWsl": true})
    );
}
