use std::fs;
use std::path::{Path, PathBuf};

use super::*;
use crate::env::{FakeSystem, detect};
use crate::model::asset::{Asset, AuthMethod};
use crate::model::delivery::{AddCustomTargetRequest, AgentId, InclusionReasonId};
use crate::ssh::managed::{self, ManagedHost};

struct Fixture {
    _temp: tempfile::TempDir,
    paths: Paths,
    envs: Vec<EnvContext>,
    targets: Vec<Target>,
}

impl Fixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let paths = Paths::isolated_in(temp.path());
        fs::create_dir_all(&paths.user_home).unwrap();
        let envs = detect(
            &paths,
            &FakeSystem {
                distros: vec!["Ubuntu-24.04".into()],
                interop: true,
                agent_keys: Some(1),
            },
        );
        for env in &envs {
            fs::create_dir_all(env.host_in_home(&[".ssh"])).unwrap();
            fs::write(
                env.host_in_home(&[".ssh", "config"]),
                format!(
                    "{}\nHost user-owned\n  HostName 127.0.0.1\n",
                    managed::include_line(&env.managed_config_native(), managed::IncludeMode::for_env(env)).unwrap()
                ),
            )
            .unwrap();
        }
        let targets = envs
            .iter()
            .map(|env| Target {
                id: format!("tgt_{}", env.id.dir_name()),
                env_id: env.id.clone(),
                agent: AgentId::ClaudeCode,
                agent_key: "claude-code".into(),
                label: "Claude Code".into(),
                path: env.native_in_home(&[".claude", "skills"]),
                enabled: true,
                detected: true,
            })
            .collect();
        let fixture = Fixture {
            _temp: temp,
            paths,
            envs,
            targets,
        };
        fixture.write_managed(&[Asset::Vps(crate::testkit::hk_edge())]);
        fixture
    }

    fn write_managed(&self, assets: &[Asset]) {
        for env in &self.envs {
            let hosts: Vec<_> = assets
                .iter()
                .filter_map(|asset| ManagedHost::from_asset(asset, env))
                .collect();
            managed::write(&env.host_in_home(&[".ssh", "cloudlink.conf"]), &hosts, env.is_windows()).unwrap();
        }
    }

    fn destination(&self, index: usize) -> PathBuf {
        resolve_target_path(&self.paths, &self.envs[index], &self.targets[index])
            .unwrap()
            .join(SKILL_DIR)
    }

    fn sync(&self, index: usize, text: &str, repair: bool) -> Delivery {
        let files = sample_files(text);
        sync(
            &self.paths,
            &self.envs[index],
            &self.targets[index],
            &files,
            &sample_marker(&self.targets[index], &files),
            repair,
        )
        .unwrap()
    }

    fn status(&self, index: usize, text: &str) -> DeliveryStatus {
        let hash = publish::files_hash(&sample_files(text));
        inspect(&self.paths, &self.envs[index], &self.targets[index], Some(&hash))
            .unwrap()
            .status
    }
}

fn sample_files(text: &str) -> Vec<CompiledFile> {
    vec![
        CompiledFile {
            path: "SKILL.md".into(),
            content: text.into(),
        },
        CompiledFile {
            path: "references/hk-edge.md".into(),
            content: "# hk-edge\n".into(),
        },
        CompiledFile {
            path: "references/health-check.md".into(),
            content: "# Health check\n".into(),
        },
    ]
}

fn sample_marker(target: &Target, files: &[CompiledFile]) -> Marker {
    Marker {
        managed_by: MANAGED_BY.into(),
        env_id: target.env_id.as_str().into(),
        agent_key: target.agent_key.clone(),
        content_hash: publish::files_hash(files),
        compiled_at: crate::testkit::NOW.into(),
        template_version: 1,
    }
}

#[test]
fn copies_windows_and_simulated_wsl_without_touching_neighbor_skills_or_ssh() {
    let fixture = Fixture::new();
    for i in 0..fixture.targets.len() {
        let skills = resolve_target_path(&fixture.paths, &fixture.envs[i], &fixture.targets[i]).unwrap();
        let sentinel = skills.join("user-owned-skill").join("SKILL.md");
        fs::create_dir_all(sentinel.parent().unwrap()).unwrap();
        fs::write(&sentinel, "keep user skill\n").unwrap();
        let user_config = fixture.envs[i].host_in_home(&[".ssh", "config"]);
        let config_before = fs::read(&user_config).unwrap();

        assert_eq!(fixture.sync(i, "one", false).status, DeliveryStatus::Ok);
        let checked = fixture.sync(i, "two", false);
        assert_eq!(checked.status, DeliveryStatus::Ok);
        assert_eq!(checked.id, format!("dlv_{}", fixture.targets[i].id));
        assert_eq!(
            fs::read_to_string(fixture.destination(i).join("SKILL.md")).unwrap(),
            "two"
        );
        assert_eq!(fs::read_to_string(&sentinel).unwrap(), "keep user skill\n");
        assert_eq!(fs::read(&user_config).unwrap(), config_before);
        assert!(remove(&fixture.paths, &fixture.envs[i], &fixture.targets[i]).unwrap());
        assert!(!fixture.destination(i).exists());
        assert_eq!(fs::read_to_string(sentinel).unwrap(), "keep user skill\n");
        assert!(
            fs::read_dir(&skills)
                .unwrap()
                .all(|entry| { !entry.unwrap().file_name().to_string_lossy().contains("cloudlink-") })
        );
    }
    assert!(fixture.destination(1).starts_with(&fixture.paths.wsl_root));
}

#[test]
fn healthy_missing_modified_outdated_and_conflict_are_distinct() {
    let fixture = Fixture::new();
    assert_eq!(fixture.status(0, "one"), DeliveryStatus::Missing);
    fixture.sync(0, "one", false);
    assert_eq!(fixture.status(0, "one"), DeliveryStatus::Ok);
    assert_eq!(fixture.status(0, "two"), DeliveryStatus::Outdated);
    fs::write(fixture.destination(0).join("references/extra.md"), "external edit").unwrap();
    assert_eq!(fixture.status(0, "two"), DeliveryStatus::Modified);
    fs::remove_file(fixture.destination(0).join(MARKER_FILE)).unwrap();
    assert_eq!(fixture.status(0, "two"), DeliveryStatus::Conflict);
    let kept = fs::read_to_string(fixture.destination(0).join("SKILL.md")).unwrap();
    assert_eq!(fixture.sync(0, "two", true).status, DeliveryStatus::Conflict);
    assert_eq!(
        fs::read_to_string(fixture.destination(0).join("SKILL.md")).unwrap(),
        kept
    );
}

#[test]
fn automatic_sync_keeps_modified_copy_until_explicit_repair() {
    let fixture = Fixture::new();
    fixture.sync(0, "one", false);
    fs::write(fixture.destination(0).join("SKILL.md"), "user changed it").unwrap();
    let extra = fixture.destination(0).join("references/extra.md");
    fs::write(&extra, "external extra file").unwrap();
    assert_eq!(fixture.sync(0, "two", false).status, DeliveryStatus::Modified);
    assert_eq!(
        fs::read_to_string(fixture.destination(0).join("SKILL.md")).unwrap(),
        "user changed it"
    );
    assert!(extra.exists());
    assert_eq!(fixture.sync(0, "two", true).status, DeliveryStatus::Ok);
    assert!(!extra.exists());
    assert_eq!(fixture.status(0, "two"), DeliveryStatus::Ok);
}

#[test]
fn empty_projection_removes_only_owned_normal_copy_and_preserves_modified_copy() {
    let fixture = Fixture::new();
    fixture.sync(0, "one", false);
    let empty = Vec::new();
    let marker = sample_marker(&fixture.targets[0], &empty);
    let removed = sync(
        &fixture.paths,
        &fixture.envs[0],
        &fixture.targets[0],
        &empty,
        &marker,
        false,
    )
    .unwrap();
    assert_eq!(removed.status, DeliveryStatus::Missing);
    assert!(!fixture.destination(0).exists());
    assert!(!remove(&fixture.paths, &fixture.envs[0], &fixture.targets[0]).unwrap());

    fixture.sync(0, "one", false);
    fs::write(fixture.destination(0).join("SKILL.md"), "user edit").unwrap();
    assert_eq!(
        sync(
            &fixture.paths,
            &fixture.envs[0],
            &fixture.targets[0],
            &empty,
            &marker,
            false
        )
        .unwrap()
        .status,
        DeliveryStatus::Modified
    );
    assert_eq!(
        fs::read_to_string(fixture.destination(0).join("SKILL.md")).unwrap(),
        "user edit"
    );
    assert!(remove(&fixture.paths, &fixture.envs[0], &fixture.targets[0]).unwrap());
}

#[test]
fn ownership_requires_matching_environment_and_agent_and_valid_marker() {
    let fixture = Fixture::new();
    fixture.sync(0, "one", false);
    let marker_path = fixture.destination(0).join(MARKER_FILE);
    let original = publish::read_marker(&fixture.destination(0)).unwrap();
    for wrong in [
        Marker {
            managed_by: "someone-else".into(),
            ..original.clone()
        },
        Marker {
            env_id: "wsl:Ubuntu-24.04".into(),
            ..original.clone()
        },
        Marker {
            agent_key: "universal".into(),
            ..original.clone()
        },
        Marker {
            content_hash: "bad hash".into(),
            ..original.clone()
        },
        Marker {
            template_version: 0,
            ..original.clone()
        },
    ] {
        fs::write(&marker_path, serde_json::to_vec(&wrong).unwrap()).unwrap();
        assert_eq!(fixture.status(0, "two"), DeliveryStatus::Conflict);
        assert_eq!(fixture.sync(0, "two", true).status, DeliveryStatus::Conflict);
        assert!(remove(&fixture.paths, &fixture.envs[0], &fixture.targets[0]).is_err());
        assert_eq!(
            fs::read_to_string(fixture.destination(0).join("SKILL.md")).unwrap(),
            "one"
        );
    }
    fs::write(&marker_path, b"not json").unwrap();
    assert_eq!(fixture.status(0, "two"), DeliveryStatus::Conflict);
}

#[test]
fn failure_of_one_target_does_not_prevent_other_targets_from_syncing() {
    let fixture = Fixture::new();
    let skills = resolve_target_path(&fixture.paths, &fixture.envs[0], &fixture.targets[0]).unwrap();
    fs::create_dir_all(skills.parent().unwrap()).unwrap();
    fs::write(skills, "a file occupies the skills path").unwrap();
    let files = sample_files("one");
    let results: Vec<_> = fixture
        .targets
        .iter()
        .zip(&fixture.envs)
        .map(|(target, env)| {
            sync(
                &fixture.paths,
                env,
                target,
                &files,
                &sample_marker(target, &files),
                false,
            )
        })
        .collect();
    assert!(results[0].is_err());
    assert_eq!(results[1].as_ref().unwrap().status, DeliveryStatus::Ok);
}

#[test]
fn unavailable_environment_reports_pending_and_does_not_write() {
    let fixture = Fixture::new();
    let mut env = fixture.envs[1].clone();
    env.available = false;
    let files = sample_files("one");
    let result = sync(
        &fixture.paths,
        &env,
        &fixture.targets[1],
        &files,
        &sample_marker(&fixture.targets[1], &files),
        false,
    )
    .unwrap();
    assert_eq!(result.status, DeliveryStatus::Pending);
    assert!(!fixture.destination(1).exists());
    assert!(remove(&fixture.paths, &env, &fixture.targets[1]).is_err());
}

#[test]
fn rejects_unsafe_compiled_paths_and_hash_mismatch_before_writing() {
    let fixture = Fixture::new();
    for path in [
        "../escape",
        "/escape",
        "references/../../escape",
        r"references\escape",
        "C:/escape",
        MARKER_FILE,
    ] {
        let files = vec![CompiledFile {
            path: path.into(),
            content: "x".into(),
        }];
        assert!(
            sync(
                &fixture.paths,
                &fixture.envs[0],
                &fixture.targets[0],
                &files,
                &sample_marker(&fixture.targets[0], &files),
                false,
            )
            .is_err()
        );
    }
    let files = sample_files("one");
    let mut wrong = sample_marker(&fixture.targets[0], &files);
    wrong.content_hash = "0".repeat(64);
    assert!(
        sync(
            &fixture.paths,
            &fixture.envs[0],
            &fixture.targets[0],
            &files,
            &wrong,
            false
        )
        .is_err()
    );
    assert!(!fixture.destination(0).exists());
}

#[test]
fn load_source_checks_hash_and_returns_skill_first() {
    let fixture = Fixture::new();
    let target = &fixture.targets[0];
    assert!(
        load_source(&fixture.paths, &target.env_id, &target.agent_key)
            .unwrap()
            .is_none()
    );
    let files = sample_files("one");
    let marker = sample_marker(target, &files);
    let source = publish::publish(&fixture.paths.compiled_dir(), &marker, &files).unwrap();
    let (loaded_marker, loaded_files) = load_source(&fixture.paths, &target.env_id, &target.agent_key)
        .unwrap()
        .unwrap();
    assert_eq!(loaded_marker, marker);
    assert_eq!(loaded_files.first().unwrap().path, "SKILL.md");
    assert_eq!(publish::files_hash(&loaded_files), publish::files_hash(&files));
    fs::write(source.join("SKILL.md"), "modified compiled source").unwrap();
    assert!(load_source(&fixture.paths, &target.env_id, &target.agent_key).is_err());
}

#[test]
fn custom_target_checks_future_paths_overlap_and_test_root() {
    let fixture = Fixture::new();
    let env = &fixture.envs[0];
    let request = |path: PathBuf| AddCustomTargetRequest {
        env_id: env.id.clone(),
        label: "Cursor".into(),
        path: path.to_string_lossy().into_owned(),
    };
    for path in [
        fixture.paths.data_dir.join("compiled/nested/not-created"),
        fixture.paths.user_home.join(".ssh/not-created"),
        fixture.paths.user_home.clone(),
        PathBuf::from(&fixture.targets[0].path).join("nested/not-created"),
        PathBuf::from(&fixture.targets[0].path),
    ] {
        assert!(validate_custom_target(&fixture.paths, env, &request(path), &fixture.targets).is_err());
    }
    let foreign = tempfile::tempdir().unwrap();
    assert!(validate_custom_target(&fixture.paths, env, &request(foreign.path().join("skills")), &[]).is_err());
    let safe = fixture.paths.user_home.join(".cursor/skills/not-created");
    assert_eq!(
        validate_custom_target(&fixture.paths, env, &request(safe.clone()), &fixture.targets).unwrap(),
        safe
    );
    assert!(!safe.exists(), "validation is read-only");
}

#[test]
fn custom_target_rejects_relative_and_parent_paths() {
    let fixture = Fixture::new();
    for (env_index, paths) in [
        (
            0,
            vec![
                "relative/skills",
                "../skills",
                r"C:\Users\me\..\skills",
                "x\nnew directive",
            ],
        ),
        (
            1,
            vec![
                "relative/skills",
                "/home/me/../skills",
                "/home/me/./skills",
                r"/home/me\skills",
            ],
        ),
    ] {
        for path in paths {
            let req = AddCustomTargetRequest {
                env_id: fixture.envs[env_index].id.clone(),
                label: "Cursor".into(),
                path: path.into(),
            };
            assert!(validate_custom_target(&fixture.paths, &fixture.envs[env_index], &req, &[]).is_err());
        }
    }
}

fn reason(fixture: &Fixture, asset: Asset, env_index: usize) -> Option<InclusionReasonId> {
    compute_inclusions(&[asset], &fixture.envs, &fixture.targets)
        .into_iter()
        .find(|inclusion| inclusion.env_id == fixture.envs[env_index].id)
        .unwrap()
        .reason
        .map(|reason| reason.id)
}

#[test]
fn inclusion_gates_agent_verification_password_environment_key_and_include() {
    let fixture = Fixture::new();
    let base = crate::testkit::hk_edge();
    assert!(reason(&fixture, Asset::Vps(base.clone()), 0).is_none());
    let mut changed = base.clone();
    changed.agent.agents.clear();
    assert_eq!(
        reason(&fixture, Asset::Vps(changed), 0),
        Some(InclusionReasonId::AgentOff)
    );
    let mut changed = base.clone();
    changed.connection.verified = None;
    assert_eq!(
        reason(&fixture, Asset::Vps(changed), 0),
        Some(InclusionReasonId::Unverified)
    );
    let mut changed = base.clone();
    changed.connection.auth.as_mut().unwrap().method = AuthMethod::Password;
    assert_eq!(
        reason(&fixture, Asset::Vps(changed), 0),
        Some(InclusionReasonId::PasswordOnly)
    );
    let mut changed = base.clone();
    changed.connection.defined_in.clear();
    assert_eq!(
        reason(&fixture, Asset::Vps(changed), 0),
        Some(InclusionReasonId::NotWritten)
    );
    let mut changed = base.clone();
    changed
        .connection
        .auth
        .as_mut()
        .unwrap()
        .identity_file
        .remove(&fixture.envs[1].id);
    let no_wsl_key = Asset::Vps(changed);
    fixture.write_managed(std::slice::from_ref(&no_wsl_key));
    assert_eq!(reason(&fixture, no_wsl_key, 1), Some(InclusionReasonId::NoKeyInEnv));
    fixture.write_managed(&[Asset::Vps(base.clone())]);
    fs::write(fixture.envs[0].host_in_home(&[".ssh", "config"]), "Host mine\n").unwrap();
    assert_eq!(
        reason(&fixture, Asset::Vps(base), 0),
        Some(InclusionReasonId::IncludeMissing)
    );
}

#[test]
fn temporary_verification_does_not_prove_a_missing_or_foreign_managed_config() {
    let asset = Asset::Vps(crate::testkit::hk_edge());
    for index in 0..2 {
        let fixture = Fixture::new();
        let env = &fixture.envs[index];
        let path = env.host_in_home(&[".ssh", "cloudlink.conf"]);
        fs::remove_file(&path).unwrap();
        assert_eq!(
            reason(&fixture, asset.clone(), index),
            Some(InclusionReasonId::NotWritten)
        );
        fixture.write_managed(std::slice::from_ref(&asset));
        assert!(reason(&fixture, asset.clone(), index).is_none());

        let foreign = "Host hk-edge\n  HostName 192.0.2.99\n";
        fs::write(&path, foreign).unwrap();
        let hosts = vec![ManagedHost::from_asset(&asset, env).unwrap()];
        assert!(managed::write(&path, &hosts, env.is_windows()).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), foreign);
        assert_eq!(
            reason(&fixture, asset.clone(), index),
            Some(InclusionReasonId::NotWritten)
        );
    }
}

#[test]
fn a_verified_new_target_is_not_included_until_the_managed_file_is_rewritten() {
    let fixture = Fixture::new();
    let mut server = crate::testkit::hk_edge();
    server.connection.host = Some("192.0.2.99".into());
    let asset = Asset::Vps(server);
    for index in 0..2 {
        assert_eq!(
            reason(&fixture, asset.clone(), index),
            Some(InclusionReasonId::NotWritten)
        );
    }
    fixture.write_managed(std::slice::from_ref(&asset));
    for index in 0..2 {
        assert!(reason(&fixture, asset.clone(), index).is_none());
    }
}

#[test]
fn an_owned_header_with_extra_ssh_directives_is_not_a_written_receipt() {
    let fixture = Fixture::new();
    let asset = Asset::Vps(crate::testkit::hk_edge());
    for index in 0..2 {
        let path = fixture.envs[index].host_in_home(&[".ssh", "cloudlink.conf"]);
        let current = fs::read_to_string(&path).unwrap();
        for extra in [
            "  ProxyCommand unwanted-helper\n",
            "\nHost extra\n  HostName 192.0.2.99\n",
        ] {
            fs::write(&path, format!("{current}{extra}")).unwrap();
            assert_eq!(
                reason(&fixture, asset.clone(), index),
                Some(InclusionReasonId::NotWritten)
            );
            fixture.write_managed(std::slice::from_ref(&asset));
            assert!(reason(&fixture, asset.clone(), index).is_none());
        }
    }
}

#[test]
fn the_written_receipt_covers_all_managed_assets_even_when_the_agent_is_off() {
    let fixture = Fixture::new();
    let base = Asset::Vps(crate::testkit::hk_edge());
    let mut other = crate::testkit::hk_edge();
    other.id = "ast_other".into();
    other.connection.ssh_alias = "other-server".into();
    other.agent.agents.clear();
    let assets = vec![base, Asset::Vps(other)];
    let before = compute_inclusions(&assets, &fixture.envs, &fixture.targets);
    assert!(
        before
            .iter()
            .filter(|i| i.asset_id == assets[0].id())
            .all(|i| { !i.included && i.reason.as_ref().unwrap().id == InclusionReasonId::NotWritten })
    );
    fixture.write_managed(&assets);
    let after = compute_inclusions(&assets, &fixture.envs, &fixture.targets);
    assert!(
        after
            .iter()
            .filter(|i| i.asset_id == assets[0].id())
            .all(|i| i.included)
    );
    assert!(
        after
            .iter()
            .filter(|i| i.asset_id == assets[1].id())
            .all(|i| { !i.included && i.reason.as_ref().unwrap().id == InclusionReasonId::AgentOff })
    );
}

#[test]
fn native_absolute_managed_includes_are_accepted_in_windows_and_wsl() {
    let fixture = Fixture::new();
    let asset = Asset::Vps(crate::testkit::hk_edge());
    for (index, env) in fixture.envs.iter().enumerate() {
        fs::write(
            env.host_in_home(&[".ssh", "config"]),
            format!(
                "Include {}\nHost user-owned\n",
                managed::quote_path(&env.managed_config_native())
            ),
        )
        .unwrap();
        assert!(reason(&fixture, asset.clone(), index).is_none());
    }
}

#[test]
fn a_single_connection_verification_allows_other_configured_environment_and_units_are_unique() {
    let fixture = Fixture::new();
    let mut asset = crate::testkit::hk_edge();
    asset.connection.verified.as_mut().unwrap().env_ids = vec![EnvId::windows()];
    assert!(reason(&fixture, Asset::Vps(asset.clone()), 1).is_none());
    let mut targets = fixture.targets.clone();
    let mut second = targets[0].clone();
    second.id = "second-directory".into();
    targets.push(second);
    let mut disabled = targets[0].clone();
    disabled.id = "disabled-directory".into();
    disabled.agent_key = "custom:disabled".into();
    disabled.enabled = false;
    targets.push(disabled);
    let inclusions = compute_inclusions(&[Asset::Vps(asset)], &fixture.envs, &targets);
    assert_eq!(inclusions.len(), 2);
    assert!(inclusions.iter().all(|inclusion| inclusion.included));
}

#[test]
fn inclusion_handles_imported_missing_environment_and_cli_bound_account() {
    let fixture = Fixture::new();
    let mut imported = crate::testkit::sg_db();
    imported.connection.defined_in = vec![EnvId::windows()];
    assert_eq!(
        reason(&fixture, Asset::Vps(imported), 1),
        Some(InclusionReasonId::NotDefined)
    );
    let mut envs = fixture.envs.clone();
    envs[1].available = false;
    let items = compute_inclusions(&[Asset::Vps(crate::testkit::hk_edge())], &envs, &fixture.targets);
    assert_eq!(items[1].reason.as_ref().unwrap().id, InclusionReasonId::EnvUnavailable);
    let base = crate::testkit::cloudflare();
    assert!(reason(&fixture, Asset::Cli(base.clone()), 0).is_none());
    let mut cli = base.clone();
    cli.cli.env_states.clear();
    assert_eq!(
        reason(&fixture, Asset::Cli(cli), 0),
        Some(InclusionReasonId::CliNotInstalled)
    );
    let mut cli = base.clone();
    cli.cli.env_states.get_mut(&EnvId::windows()).unwrap().expired = true;
    assert_eq!(
        reason(&fixture, Asset::Cli(cli), 0),
        Some(InclusionReasonId::CliNotLoggedIn)
    );
    let mut cli = base;
    cli.account = Some("different-account".into());
    assert_eq!(
        reason(&fixture, Asset::Cli(cli), 0),
        Some(InclusionReasonId::CliNotLoggedIn)
    );
}

#[cfg(any(windows, unix))]
fn link_dir(link: &Path, target: &Path) {
    #[cfg(windows)]
    use std::os::windows::process::CommandExt;

    assert!(link.is_absolute() && target.is_absolute());
    #[cfg(unix)]
    std::os::unix::fs::symlink(target, link).unwrap();
    #[cfg(windows)]
    match std::os::windows::fs::symlink_dir(target, link) {
        Ok(()) => {}
        Err(error) if error.raw_os_error() == Some(1314) => {
            // 仅创建 Junction；不用 shell 删除或移动测试目录。
            let result = crate::proc::command("cmd.exe")
                .args(["/D", "/V:OFF", "/C"])
                .raw_arg(r#"mklink /J "%CLOUDLINK_TEST_LINK%" "%CLOUDLINK_TEST_TARGET%""#)
                .env("CLOUDLINK_TEST_LINK", link)
                .env("CLOUDLINK_TEST_TARGET", target)
                .output()
                .unwrap();
            assert!(result.status.success(), "{}", String::from_utf8_lossy(&result.stderr));
        }
        Err(error) => panic!("cannot create directory link: {error}"),
    }
}

#[cfg(any(windows, unix))]
fn remove_link_dir(link: &Path) {
    #[cfg(unix)]
    fs::remove_file(link).unwrap();
    #[cfg(windows)]
    fs::remove_dir(link).unwrap();
}

#[cfg(any(windows, unix))]
#[test]
fn managed_configuration_paths_do_not_follow_links_or_junctions() {
    let fixture = Fixture::new();
    let asset = Asset::Vps(crate::testkit::hk_edge());
    let config = fixture.envs[0].host_in_home(&[".ssh", "cloudlink.conf"]);
    let outside = fixture.paths.user_home.join("outside-managed-config");
    fs::create_dir_all(&outside).unwrap();
    let sentinel = outside.join("sentinel.md");
    fs::write(&sentinel, "keep user config\n").unwrap();
    fs::remove_file(&config).unwrap();
    link_dir(&config, &outside);
    assert_eq!(reason(&fixture, asset.clone(), 0), Some(InclusionReasonId::NotWritten));
    assert_eq!(fs::read_to_string(&sentinel).unwrap(), "keep user config\n");
    remove_link_dir(&config);
    fixture.write_managed(std::slice::from_ref(&asset));
    assert!(reason(&fixture, asset.clone(), 0).is_none());

    let ssh_dir = fixture.envs[0].host_in_home(&[".ssh"]);
    let relocated = fixture.paths.user_home.join("relocated-managed-ssh");
    fs::rename(&ssh_dir, &relocated).unwrap();
    link_dir(&ssh_dir, &relocated);
    assert_eq!(
        reason(&fixture, asset.clone(), 0),
        Some(InclusionReasonId::IncludeMissing)
    );
    remove_link_dir(&ssh_dir);
    fs::rename(&relocated, &ssh_dir).unwrap();
    assert!(reason(&fixture, asset, 0).is_none());
}

#[cfg(any(windows, unix))]
#[test]
fn root_and_nested_links_are_never_overwritten_or_followed() {
    let fixture = Fixture::new();
    let outside = fixture.paths.user_home.join("outside");
    fs::create_dir_all(&outside).unwrap();
    fs::write(outside.join("sentinel.md"), "keep outside content").unwrap();
    let destination = fixture.destination(0);
    fs::create_dir_all(destination.parent().unwrap()).unwrap();
    link_dir(&destination, &outside);
    assert_eq!(fixture.status(0, "one"), DeliveryStatus::Conflict);
    assert_eq!(fixture.sync(0, "one", true).status, DeliveryStatus::Conflict);
    assert!(remove(&fixture.paths, &fixture.envs[0], &fixture.targets[0]).is_err());
    assert_eq!(
        fs::read_to_string(outside.join("sentinel.md")).unwrap(),
        "keep outside content"
    );
    remove_link_dir(&destination);

    fixture.sync(0, "one", false);
    let nested = destination.join("references/external");
    link_dir(&nested, &outside);
    assert_eq!(fixture.status(0, "one"), DeliveryStatus::Modified);
    assert_eq!(fixture.sync(0, "two", false).status, DeliveryStatus::Modified);
    let files = sample_files("two");
    assert!(
        sync(
            &fixture.paths,
            &fixture.envs[0],
            &fixture.targets[0],
            &files,
            &sample_marker(&fixture.targets[0], &files),
            true,
        )
        .is_err()
    );
    assert!(remove(&fixture.paths, &fixture.envs[0], &fixture.targets[0]).is_err());
    assert_eq!(
        fs::read_to_string(outside.join("sentinel.md")).unwrap(),
        "keep outside content"
    );
    remove_link_dir(&nested);
}

#[cfg(any(windows, unix))]
#[test]
fn ancestor_aliases_cannot_bypass_future_path_overlap_or_delivery_checks() {
    let fixture = Fixture::new();
    fs::create_dir_all(&fixture.paths.data_dir).unwrap();
    let alias = fixture.paths.user_home.join("data-alias");
    link_dir(&alias, &fixture.paths.data_dir);
    let request = AddCustomTargetRequest {
        env_id: EnvId::windows(),
        label: "Cursor".into(),
        path: alias.join("new/skills").to_string_lossy().into_owned(),
    };
    assert!(validate_custom_target(&fixture.paths, &fixture.envs[0], &request, &fixture.targets).is_err());
    let mut target = fixture.targets[0].clone();
    target.path = request.path;
    let hash = publish::files_hash(&sample_files("one"));
    assert_eq!(
        inspect(&fixture.paths, &fixture.envs[0], &target, Some(&hash))
            .unwrap()
            .status,
        DeliveryStatus::Conflict
    );
    assert!(!fixture.paths.data_dir.join("new").exists());
    remove_link_dir(&alias);
}

#[cfg(any(windows, unix))]
#[test]
fn compiled_source_with_nested_link_is_not_read_or_copied() {
    let fixture = Fixture::new();
    let target = &fixture.targets[0];
    let files = sample_files("one");
    let source = publish::publish(&fixture.paths.compiled_dir(), &sample_marker(target, &files), &files).unwrap();
    let outside = fixture.paths.user_home.join("outside-source");
    fs::create_dir_all(&outside).unwrap();
    fs::write(outside.join("secret.md"), "must not be copied").unwrap();
    let link = source.join("references/external");
    link_dir(&link, &outside);
    assert!(load_source(&fixture.paths, &target.env_id, &target.agent_key).is_err());
    assert!(!fixture.destination(0).exists());
    assert_eq!(
        fs::read_to_string(outside.join("secret.md")).unwrap(),
        "must not be copied"
    );
    remove_link_dir(&link);
}

#[test]
fn backups_keep_the_newest_twenty_or_thirty_days_and_skip_foreign_directories() {
    let fixture = Fixture::new();
    fixture.sync(0, "one", false);
    let source = fixture.destination(0);
    let target = &fixture.targets[0];
    let mut ids = Vec::new();
    for _ in 0..23 {
        ids.push(
            backup::create(&fixture.paths, target, &source, BackupReason::Modified)
                .unwrap()
                .backup_id,
        );
    }
    // Three oldest are 40 days old, one more is recent but outside the newest twenty by age order.
    let now = crate::time::now_secs();
    for (i, id) in ids.iter().enumerate() {
        let age = if i < 3 { 40 * 86_400 + i as i64 } else { 100 - i as i64 };
        backup::rewrite_created_at(&fixture.paths, id, &target.id, &crate::time::format_rfc3339(now - age));
    }
    let foreign = fixture.paths.backups_dir().join("user-folder");
    fs::create_dir_all(&foreign).unwrap();
    fs::write(foreign.join("notes.txt"), b"mine").unwrap();

    assert_eq!(backup::prune(&fixture.paths, now).unwrap(), 3);
    for (i, id) in ids.iter().enumerate() {
        assert_eq!(fixture.paths.backups_dir().join(id).exists(), i >= 3, "backup {i}");
    }
    assert_eq!(fs::read(foreign.join("notes.txt")).unwrap(), b"mine");
    // The copied tree is byte-identical and the backed-up copy itself is untouched.
    let (_, tree) = backup::load(&fixture.paths, &ids[5], target).unwrap();
    assert_eq!(
        fs::read(tree.join("SKILL.md")).unwrap(),
        fs::read(source.join("SKILL.md")).unwrap()
    );
    assert_eq!(fixture.status(0, "one"), DeliveryStatus::Ok);
}

#[test]
fn automatic_sync_backs_up_a_modified_copy_but_never_a_linked_one() {
    let fixture = Fixture::new();
    fixture.sync(0, "one", false);
    fs::write(fixture.destination(0).join("SKILL.md"), b"edited").unwrap();
    let files = sample_files("two");
    let marker = sample_marker(&fixture.targets[0], &files);
    let (delivery, saved) = sync_auto(&fixture.paths, &fixture.envs[0], &fixture.targets[0], &files, &marker).unwrap();
    assert_eq!(delivery.status, DeliveryStatus::Ok);
    let saved = saved.expect("modified copy was backed up");
    let (_, tree) = backup::load(&fixture.paths, &saved.backup_id, &fixture.targets[0]).unwrap();
    assert_eq!(fs::read(tree.join("SKILL.md")).unwrap(), b"edited");
    // A healthy copy produces no backup.
    let (_, none) = sync_auto(&fixture.paths, &fixture.envs[0], &fixture.targets[0], &files, &marker).unwrap();
    assert!(none.is_none());
}
