use std::time::Duration;

use super::*;
use crate::model::asset::{AssetFacts, FieldSource, ProbeState, ServiceKind};
use crate::model::misc::IpcErrorId;
use crate::testkit;

const UBUNTU: &str = include_str!("../../tests/probe-fixtures/ubuntu-24.04.txt");
const ALPINE: &str = include_str!("../../tests/probe-fixtures/alpine-busybox.txt");
const NO_DOCKER: &str = include_str!("../../tests/probe-fixtures/docker-permission-denied.txt");
const RUN: &str = "prb_test";
const AT: &str = "2026-11-04T10:00:00Z";

/// 用一个真实格式的完整样例，替换单段输出/退出状态来复现失败和不可信值。
fn section(raw: &str, name: &str, body: &str, status: i32) -> String {
    let marker = format!("@@{name}\n");
    let start = raw.find(&marker).unwrap();
    let finish = start + raw[start..].find(&format!("@@status {name} ")).unwrap();
    let end = finish + raw[finish..].find('\n').map_or(raw.len() - finish, |i| i + 1);
    format!(
        "{}{}{}\n@@status {name} {status}\n{}",
        &raw[..start],
        marker,
        body.trim_end_matches('\n'),
        &raw[end..]
    )
}

#[test]
fn parses_ubuntu_facts_docker_systemd_and_ipv6() {
    let data = parse(UBUNTU);
    assert!(data.valid);
    assert!(data.failed_sections.is_empty());
    assert_eq!(data.facts.os.as_deref(), Some("Ubuntu-24.04.1-LTS"));
    assert_eq!(data.facts.kernel.as_deref(), Some("6.8.0-48-generic"));
    assert_eq!(data.facts.arch.as_deref(), Some("x86_64"));
    assert_eq!(data.facts.cpu_cores, Some(2));
    assert_eq!(data.facts.memory_total_mib, Some(1987));
    assert_eq!(data.facts.disk_total_gib, Some(40));
    assert_eq!(
        data.facts.panel.as_ref().unwrap().as_ref().unwrap().install_path,
        "/opt/1panel"
    );
    assert_eq!(data.services.len(), 6);
    let openresty = data.services.iter().find(|s| s.name == "openresty").unwrap();
    assert_eq!(openresty.ports.len(), 4);
    assert!(openresty.ports.iter().any(|p| p.host_ip == "::" && p.host_port == 443));
    assert!(
        data.services
            .iter()
            .any(|s| s.kind == ServiceKind::Systemd && s.name == "ssh")
    );
    assert!(data.listening_ports.iter().any(|p| p.addr == "::" && p.port == 22));
    assert_eq!(
        data.tools,
        ["/usr/sbin/nginx", "/usr/bin/docker", "/usr/local/bin/1pctl"]
    );
}

#[test]
fn parses_alpine_busybox_netstat_without_systemd() {
    let data = parse(ALPINE);
    assert!(data.valid);
    assert_eq!(data.failed_sections, ["systemd"]);
    assert_eq!(data.facts.os.as_deref(), Some("Alpine-Linux-v3.20"));
    assert_eq!(data.facts.arch.as_deref(), Some("aarch64"));
    assert_eq!(data.facts.memory_total_mib, Some(4096));
    assert_eq!(data.facts.disk_total_gib, Some(80));
    assert_eq!(data.facts.panel, Some(None));
    assert_eq!(data.listening_ports.len(), 3);
    assert!(data.listening_ports.iter().any(|p| p.addr == "::"));
    let web = data.services.iter().find(|s| s.name == "web").unwrap();
    assert_eq!(web.ports.len(), 2);
    let dns = data.services.iter().find(|s| s.name == "dns").unwrap();
    assert_eq!(dns.ports[0].proto, crate::model::asset::Proto::Udp);
}

#[test]
fn failed_docker_section_preserves_previous_services() {
    let before = testkit::hk_edge();
    let data = parse(NO_DOCKER);
    assert!(data.valid);
    assert_eq!(data.failed_sections, ["docker"]);
    let result = merge(&before, &data, RUN, AT);
    assert_eq!(result.asset.services[0], before.services[0]);
    assert!(
        result
            .applied
            .iter()
            .all(|c| c.kind != crate::model::probe::ProbeChangeKind::Missing)
    );
    let error = result.partial.unwrap();
    assert_eq!(error.id, SshErrorId::Partial);
    assert_eq!(
        error.params.unwrap()["section"],
        crate::model::ParamValue::from("docker")
    );
}

#[test]
fn failed_systemd_does_not_mark_its_services_missing() {
    let before = testkit::sg_db();
    let result = merge(&before, &parse(ALPINE), RUN, AT);
    let postgres = result.asset.services.iter().find(|s| s.name == "postgresql").unwrap();
    assert_eq!(postgres, &before.services[0]);
    let redis = result.asset.services.iter().find(|s| s.name == "redis").unwrap();
    assert!(redis.missing, "only the successful Docker segment can infer absence");
}

#[test]
fn successful_empty_service_section_marks_missing_without_deleting_annotations() {
    let before = testkit::hk_edge();
    let data = parse(&section(UBUNTU, "docker", "", 0));
    let result = merge(&before, &data, RUN, AT);
    let openresty = result.asset.services.iter().find(|s| s.name == "openresty").unwrap();
    assert!(openresty.missing);
    assert_eq!(openresty.role, before.services[0].role);
    assert!(openresty.critical);
    assert_eq!(openresty.last_seen_at, before.services[0].last_seen_at);
    assert!(
        result
            .applied
            .iter()
            .any(|c| c.kind == crate::model::probe::ProbeChangeKind::Missing && c.label == "openresty")
    );
}

#[test]
fn merge_preserves_all_manual_content_and_service_source() {
    let mut before = testkit::hk_edge();
    before.services[0].source = FieldSource::Manual;
    let result = merge(&before, &parse(UBUNTU), RUN, AT);
    let service = result.asset.services.iter().find(|s| s.name == "openresty").unwrap();
    assert_eq!(service.image.as_deref(), Some("openresty:1.25.3"));
    assert_eq!(service.role, before.services[0].role);
    assert_eq!(service.source, FieldSource::Manual);
    assert!(service.critical);
    assert_eq!(result.asset.notes, before.notes);
    assert_eq!(result.asset.guardrails, before.guardrails);
    assert_eq!(result.asset.agent, before.agent);
    assert_eq!(result.asset.paths, before.paths);
    assert_eq!(result.asset.served_hostnames, before.served_hostnames);
    assert_eq!(result.asset.export, before.export);
    assert_eq!(result.asset.probe.status, ProbeState::Ok);
    assert_eq!(result.asset.probe.last_run_id.as_deref(), Some(RUN));
    assert_eq!(result.asset.connection.verified.as_ref().unwrap().at, AT);
    assert!(result.asset.connection.verified.as_ref().unwrap().ok);
    let absent = merge(&before, &parse(&section(UBUNTU, "docker", "", 0)), RUN, AT);
    assert_eq!(
        absent.asset.services[0], before.services[0],
        "manual-only services never become missing"
    );
}

#[test]
fn repeated_probe_only_refreshes_time_and_verification() {
    let first = merge(&testkit::dev_box(), &parse(UBUNTU), RUN, AT);
    let at = "2026-11-04T10:05:00Z";
    let second = merge(&first.asset, &parse(UBUNTU), "prb_second", at);
    assert!(second.applied.is_empty());
    assert!(second.held.is_empty());
    assert!(
        second
            .asset
            .services
            .iter()
            .all(|s| s.last_seen_at.as_deref() == Some(at))
    );
    assert_eq!(second.asset.connection.verified.unwrap().at, at);
    assert_eq!(second.asset.probe.last_success_at.as_deref(), Some(at));
}

#[test]
fn malformed_complete_segment_is_partial_and_cannot_infer_absence() {
    let before = testkit::hk_edge();
    let raw = section(
        UBUNTU,
        "docker",
        "openresty\timage\tbroken-port-mapping\tUp 1 minute",
        0,
    );
    let data = parse(&raw);
    assert!(data.valid);
    assert_eq!(data.failed_sections, ["docker"]);
    let result = merge(&before, &data, RUN, AT);
    assert_eq!(result.asset.services[0], before.services[0]);
}

#[test]
fn malformed_listener_preserves_ports_and_failed_numeric_section_preserves_fact() {
    let before = testkit::hk_edge();
    let raw = section(
        &section(UBUNTU, "listen", "LISTEN 0 128 invalid:22 *:*", 0),
        "cpu",
        "unavailable",
        0,
    );
    let data = parse(&raw);
    assert!(data.valid);
    assert_eq!(data.failed_sections, ["cpu", "listen"]);
    let result = merge(&before, &data, RUN, AT);
    assert_eq!(result.asset.facts.cpu_cores, before.facts.cpu_cores);
    assert_eq!(result.asset.listening_ports, before.listening_ports);
}

#[test]
fn docker_port_ranges_and_udp_are_bounded_and_validated() {
    let good = "range\tnginx:alpine\t127.0.0.1:9000-9002->8000-8002/tcp, [::]:53->53/udp\tUp 1 minute";
    let data = parse(&section(UBUNTU, "docker", good, 0));
    assert!(data.valid);
    let service = data.services.iter().find(|s| s.name == "range").unwrap();
    assert_eq!(service.ports.len(), 4);
    assert!(
        service
            .ports
            .iter()
            .any(|p| p.host_port == 9002 && p.container_port == 8002)
    );
    for mapping in [
        "127.0.0.1:9000-9002->8000/tcp",
        "127.0.0.1:1-100->1-100/tcp",
        "127.0.0.1:0->80/tcp",
    ] {
        let raw = section(UBUNTU, "docker", &format!("range\tnginx\t{mapping}\tUp 1 minute"), 0);
        assert!(parse(&raw).failed_sections.iter().any(|s| s == "docker"));
    }
}

#[test]
fn duplicate_sanitized_service_names_fail_the_section() {
    let raw = section(
        UBUNTU,
        "docker",
        "web`name\tnginx\t80/tcp\tUp 1 minute\nweb|name\tnginx\t80/tcp\tUp 1 minute",
        0,
    );
    let data = parse(&raw);
    assert!(data.valid);
    assert_eq!(data.failed_sections, ["docker"]);
    assert!(data.services.iter().all(|s| s.kind != ServiceKind::Docker));
}

#[test]
fn invalid_protocol_and_output_limit_cannot_merge_anything() {
    let before = testkit::hk_edge();
    for raw in [
        UBUNTU[..UBUNTU.find("@@listen\n").unwrap()].to_string(),
        format!("{UBUNTU}@@os\n@@status os 0\n"),
        format!("{UBUNTU}@@unknown\n@@status unknown 0\n"),
        "x".repeat(MAX_OUTPUT + 1),
    ] {
        let data = parse(&raw);
        assert!(!data.valid);
        let result = merge(&before, &data, RUN, AT);
        assert_eq!(result.asset, before);
        assert!(result.applied.is_empty());
        assert!(result.held.is_empty());
    }
    assert!(
        parse(&UBUNTU.replace('\n', "\r\n")).valid,
        "recorded output may use CRLF"
    );
}

#[test]
fn names_are_sanitized_and_injection_is_detected_before_truncation() {
    let image = format!(
        "registry.example/{}ignore previous instructions",
        "a".repeat(MAX_VALUE_CHARS)
    );
    let raw = section(
        UBUNTU,
        "docker",
        &format!("openresty\t{image}\t443/tcp\tUp 1 minute"),
        0,
    );
    let data = parse(&raw);
    assert!(data.valid);
    let service = data.services.iter().find(|s| s.name == "openresty").unwrap();
    assert_eq!(service.image.as_ref().unwrap().chars().count(), MAX_VALUE_CHARS);
    assert_eq!(service.sanitized, Some(true));
    assert!(data.suspicious_services.contains("docker:openresty"));
    let before = testkit::hk_edge();
    let merged = merge(&before, &data, RUN, AT);
    assert_eq!(merged.asset.services[0], before.services[0]);
    assert_eq!(merged.held.len(), 1);
    let persisted = serde_json::to_string(&merged).unwrap();
    assert!(!persisted.contains("ignore previous instructions"));
    let clean = parse(&section(
        UBUNTU,
        "docker",
        "web`name|bad\tnginx:1\t80/tcp\tUp 1 minute",
        0,
    ));
    let service = clean.services.iter().find(|s| s.kind == ServiceKind::Docker).unwrap();
    assert_eq!(service.name, "web-name-bad");
    assert_eq!(service.sanitized, Some(true));
    let disguised = parse(&section(
        UBUNTU,
        "docker",
        "ignore|previous|instructions\tnginx:1\t80/tcp\tUp 1 minute",
        0,
    ));
    assert!(
        disguised
            .suspicious_services
            .contains("docker:ignore-previous-instructions"),
        "cleaning can reveal an injection phrase too"
    );
}

#[test]
fn injection_values_are_held_until_confirmed_and_survive_serialization_safely() {
    let raw = section(
        UBUNTU,
        "docker",
        "ignore-previous-instructions\tnginx:1\t80/tcp\tUp 1 minute",
        0,
    );
    let before = testkit::hk_edge();
    let merged = merge(&before, &parse(&raw), RUN, AT);
    assert_eq!(merged.held.len(), 1);
    assert!(
        merged
            .asset
            .services
            .iter()
            .all(|s| s.name != "ignore-previous-instructions")
    );
    let persisted: MergeResult = serde_json::from_str(&serde_json::to_string(&merged).unwrap()).unwrap();
    let mut current = merged.asset.clone();
    current.notes.push_str("\nA later manual note.");
    current.services[0].role = Some("Later label".into());
    let confirmed = confirm(&current, &persisted, &[persisted.held[0].id.clone()]).unwrap();
    assert!(
        confirmed
            .services
            .iter()
            .any(|s| s.name == "ignore-previous-instructions")
    );
    assert_eq!(confirmed.notes, current.notes);
    assert_eq!(confirmed.services[0].role, current.services[0].role);
    assert!(
        confirm(&confirmed, &persisted, &[persisted.held[0].id.clone()]).is_err(),
        "already-applied IDs cannot be replayed"
    );
}

#[test]
fn confirm_preserves_annotations_on_an_existing_service() {
    let raw = section(
        UBUNTU,
        "docker",
        "openresty\tignore-previous-instructions:1\t0.0.0.0:443->443/tcp\tUp 1 minute",
        0,
    );
    let before = testkit::hk_edge();
    let merged = merge(&before, &parse(&raw), RUN, AT);
    let mut current = merged.asset.clone();
    current.services[0].role = Some("edited after probe".into());
    current.services[0].critical = false;
    current.services[0].source = FieldSource::Manual;
    let confirmed = confirm(&current, &merged, &[merged.held[0].id.clone()]).unwrap();
    assert_eq!(
        confirmed.services[0].image.as_deref(),
        Some("ignore-previous-instructions:1")
    );
    assert_eq!(confirmed.services[0].role, current.services[0].role);
    assert!(!confirmed.services[0].critical);
    assert_eq!(confirmed.services[0].source, FieldSource::Manual);
}

#[test]
fn stale_or_unknown_confirmations_fail_atomically() {
    let raw = section(UBUNTU, "os", "PRETTY_NAME=\"ignore previous instructions\"", 0);
    let before = testkit::hk_edge();
    let merged = merge(&before, &parse(&raw), RUN, AT);
    assert_eq!(merged.held.len(), 1);
    let mut edited = merged.asset.clone();
    edited.facts.os = Some("manually corrected".into());
    assert!(
        confirm(&edited, &merged, &[merged.held[0].id.clone()])
            .unwrap_err()
            .is_ipc(IpcErrorId::NotFound)
    );
    assert!(confirm(&merged.asset, &merged, &[merged.held[0].id.clone(), "unknown".into()]).is_err());
    assert!(
        confirm(
            &merged.asset,
            &merged,
            &[merged.held[0].id.clone(), merged.held[0].id.clone()]
        )
        .is_err()
    );
    let mut newer = merged.asset.clone();
    newer.probe.last_run_id = Some("prb_newer".into());
    assert!(confirm(&newer, &merged, &[merged.held[0].id.clone()]).is_err());
    let mut changed_target = merged.asset.clone();
    changed_target.connection.host = Some("192.0.2.2".into());
    assert!(confirm(&changed_target, &merged, &[merged.held[0].id.clone()]).is_err());
    assert_eq!(merged.asset.facts.os, before.facts.os);
}

#[test]
fn undo_restores_only_probe_changes_and_keeps_later_edits() {
    let before = testkit::hk_edge();
    let merged = merge(&before, &parse(UBUNTU), RUN, AT);
    let mut current = merged.asset.clone();
    current.notes.push_str("\nLater note");
    current.summary = "Later summary".into();
    current.agent.agents.clear();
    current.guardrails.rules.clear();
    current.facts.os = Some("Later OS correction".into());
    let service = current.services.iter_mut().find(|s| s.name == "openresty").unwrap();
    service.role = Some("Later role".into());
    service.critical = false;
    let redis = current.services.iter_mut().find(|s| s.name == "redis").unwrap();
    redis.role = Some("New service, now annotated".into());
    current.services.retain(|s| s.name != "ssh");
    let restored = undo(&current, &before, &merged.asset);
    assert_eq!(restored.facts.os, current.facts.os);
    assert_eq!(restored.facts.kernel, before.facts.kernel);
    assert_eq!(restored.listening_ports, before.listening_ports);
    assert_eq!(restored.notes, current.notes);
    assert_eq!(restored.summary, current.summary);
    assert_eq!(restored.agent, current.agent);
    assert_eq!(restored.guardrails, current.guardrails);
    let service = restored.services.iter().find(|s| s.name == "openresty").unwrap();
    assert_eq!(service.image, before.services[0].image);
    assert_eq!(service.ports, before.services[0].ports);
    assert_eq!(service.role.as_deref(), Some("Later role"));
    assert!(!service.critical);
    assert!(restored.services.iter().any(|s| s.name == "redis"));
    assert!(restored.services.iter().all(|s| s.name != "api" && s.name != "ssh"));
}

#[test]
fn undo_does_not_restore_human_deleted_services_or_older_runs() {
    let before = testkit::hk_edge();
    let merged = merge(&before, &parse(UBUNTU), RUN, AT);
    let mut current = merged.asset.clone();
    current.services.retain(|s| s.name != "openresty");
    let restored = undo(&current, &before, &merged.asset);
    assert!(restored.services.iter().all(|s| s.name != "openresty"));
    current.probe.last_run_id = Some("prb_newer".into());
    assert_eq!(undo(&current, &before, &merged.asset), current);
}

#[test]
fn undo_after_confirm_restores_accepted_values_using_final_snapshot() {
    let before = testkit::hk_edge();
    let raw = section(UBUNTU, "os", "PRETTY_NAME=\"ignore previous instructions\"", 0);
    let merged = merge(&before, &parse(&raw), RUN, AT);
    let final_asset = confirm(&merged.asset, &merged, &[merged.held[0].id.clone()]).unwrap();
    let restored = undo(&final_asset, &before, &final_asset);
    assert_eq!(restored, before);
}

#[test]
fn ssh_command_has_strict_policy_and_separator_in_each_environment() {
    let tmp = tempfile::tempdir().unwrap();
    let paths = crate::paths::Paths::isolated_in(tmp.path());
    let envs = crate::env::detect(
        &paths,
        &crate::env::FakeSystem {
            distros: vec!["Ubuntu-24.04".into()],
            ..Default::default()
        },
    );
    let tools = SshTools {
        windows_ssh: tmp.path().join("ssh-test.exe"),
    };
    for env in &envs {
        let command = ssh_command(&tools, env, "hk-edge", false);
        let args: Vec<_> = command.get_args().map(|s| s.to_string_lossy().into_owned()).collect();
        let alias_at = args.iter().position(|s| s == "hk-edge").unwrap();
        assert_eq!(args[alias_at - 1], "--");
        assert_eq!(args[alias_at + 1], "sh -s");
        for required in [
            "BatchMode=yes",
            "ConnectTimeout=10",
            "StrictHostKeyChecking=yes",
            "PermitLocalCommand=no",
            "ControlMaster=no",
            "ControlPath=none",
            "ClearAllForwardings=yes",
            "ForwardAgent=no",
            "GlobalKnownHostsFile=none",
            "IdentityAgent=none",
            "IdentityFile=none",
            "-T",
        ] {
            assert!(args.iter().any(|s| s == required));
        }
        assert!(args.contains(&format!(
            "UserKnownHostsFile={}",
            crate::ssh::managed::quote_path(&env.known_hosts_native())
        )));
        if env.distro().is_some() {
            assert_eq!(&args[..4], ["-d", "Ubuntu-24.04", "-e", "ssh"]);
        } else {
            assert_eq!(command.get_program(), tools.windows_ssh.as_os_str());
        }
    }
}

#[test]
fn production_probe_leaves_imported_host_files_and_identity_selection_to_config() {
    let tmp = tempfile::tempdir().unwrap();
    let mut paths = crate::paths::Paths::isolated_in(tmp.path());
    paths.isolated = false;
    let env = crate::env::EnvContext::windows(&paths);
    let tools = SshTools {
        windows_ssh: tmp.path().join("nonexistent-ssh.exe"),
    };
    let command = ssh_command(&tools, &env, "fixture", false);
    let args: Vec<_> = command.get_args().map(|s| s.to_string_lossy().into_owned()).collect();
    for option in [
        "UserKnownHostsFile=",
        "GlobalKnownHostsFile=",
        "IdentityAgent=",
        "IdentityFile=",
    ] {
        assert!(args.iter().all(|arg| !arg.starts_with(option)));
    }
    assert!(
        command
            .get_envs()
            .all(|(key, _)| key != "SSH_AUTH_SOCK" && key != "SSH_AGENT_PID")
    );
}

#[test]
fn invalid_alias_is_rejected_without_invoking_a_real_ssh() {
    let tmp = tempfile::tempdir().unwrap();
    let paths = crate::paths::Paths::isolated_in(tmp.path());
    let envs = crate::env::detect(&paths, &crate::env::FakeSystem::default());
    let tools = SshTools {
        windows_ssh: tmp.path().join("nonexistent-ssh.exe"),
    };
    let result = execute(
        &tools,
        &envs[0],
        "--malicious-option",
        None,
        Duration::from_secs(30),
        &AtomicBool::new(false),
        &mut |_, _, _| {},
    );
    assert!(matches!(
        result,
        Err(ExecuteError::Failed(SshError {
            id: SshErrorId::ResolveFailed,
            ..
        }))
    ));
}

#[test]
fn password_policy_is_explicit_and_wsl_password_never_invokes_wsl() {
    let tmp = tempfile::tempdir().unwrap();
    let paths = crate::paths::Paths::isolated_in(tmp.path());
    let envs = crate::env::detect(
        &paths,
        &crate::env::FakeSystem {
            distros: vec!["Ubuntu-24.04".into()],
            ..Default::default()
        },
    );
    let tools = SshTools {
        windows_ssh: tmp.path().join("nonexistent-ssh.exe"),
    };
    let password = SecretString::new("test-only password".into()).unwrap();
    let command = ssh_command(&tools, &envs[0], "hk-edge", true);
    let args: Vec<_> = command.get_args().map(|s| s.to_string_lossy().into_owned()).collect();
    assert!(!args.iter().any(|s| s == "BatchMode=yes"));
    for required in [
        "BatchMode=no",
        "PreferredAuthentications=password,keyboard-interactive",
        "NumberOfPasswordPrompts=1",
        "PubkeyAuthentication=no",
        "StrictHostKeyChecking=yes",
    ] {
        assert!(args.iter().any(|s| s == required));
    }
    assert!(args.iter().all(|s| !s.contains(password.expose())));
    let result = execute(
        &tools,
        &envs[1],
        "hk-edge",
        Some(&password),
        Duration::from_secs(30),
        &AtomicBool::new(false),
        &mut |_, _, _| {},
    );
    assert!(matches!(
        result,
        Err(ExecuteError::Failed(SshError {
            id: SshErrorId::NeedsInteraction,
            ..
        }))
    ));
}

#[test]
fn empty_unvalidated_data_never_changes_an_asset() {
    let before = testkit::dev_box();
    let result = merge(
        &before,
        &ProbeData {
            facts: AssetFacts {
                os: Some("unvalidated".into()),
                ..Default::default()
            },
            ..Default::default()
        },
        RUN,
        AT,
    );
    assert_eq!(result.asset, before);
}

#[cfg(windows)]
mod windows_runner {
    use std::os::windows::process::CommandExt;
    use std::sync::atomic::Ordering;
    use std::time::Instant;

    use super::*;

    fn shell(script: &str) -> std::process::Command {
        let mut command = crate::proc::command("cmd.exe");
        // These are fixed test scripts. cmd.exe does not use CRT argument quoting:
        // Command::arg would turn their inner quotes into backslash-quote sequences.
        command.args(["/D", "/C"]).raw_arg(script);
        command
    }

    #[test]
    fn captures_both_streams_in_memory_and_only_static_script_is_on_stdin() {
        let tmp = tempfile::tempdir().unwrap();
        let mut command = shell(
            "findstr /C:\"CloudLink probe v1\" & echo raw-server-stdout & echo raw-server-stderr 1>&2 & exit /B 3",
        );
        command.current_dir(tmp.path());
        let output = runner::capture(
            command,
            Duration::from_secs(3),
            &AtomicBool::new(false),
            &mut || Ok(()),
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(output.code, Some(3));
        let stdout = String::from_utf8(output.stdout).unwrap();
        let stderr = String::from_utf8(output.stderr).unwrap();
        assert!(
            stdout.contains("CloudLink probe v1"),
            "stdout={stdout:?}, stderr={stderr:?}"
        );
        assert!(stdout.contains("raw-server-stdout"));
        assert!(stderr.contains("raw-server-stderr"));
        assert_eq!(std::fs::read_dir(tmp.path()).unwrap().count(), 0);
    }

    #[test]
    fn cancellation_during_capture_and_deadline_reap_the_direct_child() {
        let flag = AtomicBool::new(false);
        let started = Instant::now();
        let result = runner::capture(
            shell("echo began & for /L %i in (1,0,2) do @rem"),
            Duration::from_secs(3),
            &flag,
            &mut || Ok(()),
            &mut |out| {
                if out.windows(5).any(|bytes| bytes == b"began") {
                    flag.store(true, Ordering::SeqCst);
                }
            },
        );
        assert!(matches!(result, Err(runner::CaptureError::Cancelled)));
        assert!(started.elapsed() < Duration::from_secs(2));
        let started = Instant::now();
        let result = runner::capture(
            shell("for /L %i in (1,0,2) do @rem"),
            Duration::from_millis(120),
            &AtomicBool::new(false),
            &mut || Ok(()),
            &mut |_| {},
        );
        assert!(matches!(result, Err(runner::CaptureError::TimedOut)));
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn output_bomb_is_limited_across_both_streams() {
        // 每个 stream 约 63 KiB，分别没超限；合计必须拒绝。
        let command = shell(
            "(for /L %i in (1,1,1500) do @echo 0123456789012345678901234567890123456789) & (for /L %i in (1,1,1500) do @echo 0123456789012345678901234567890123456789 1>&2)",
        );
        let result = runner::capture(
            command,
            Duration::from_secs(5),
            &AtomicBool::new(false),
            &mut || Ok(()),
            &mut |_| {},
        );
        assert!(matches!(result, Err(runner::CaptureError::OutputLimit)));
    }

    #[test]
    fn memory_capture_tick_serves_and_revokes_a_mock_password_broker() {
        use std::io::{Read, Write};
        use std::net::{Ipv4Addr, TcpStream};
        use std::sync::Arc;

        let mut broker = AskpassBroker::start(SecretString::new("test-only password".into()).unwrap()).unwrap();
        let mut command = shell("for /L %i in (1,0,2) do @rem");
        broker.configure(&mut command).unwrap();
        let token = command
            .get_envs()
            .find_map(|(key, value)| {
                (key == "CLOUDLINK_ASKPASS_TOKEN").then(|| value.unwrap().to_string_lossy().into_owned())
            })
            .unwrap();
        let port = broker.port().unwrap();
        let flag = Arc::new(AtomicBool::new(false));
        let client_flag = flag.clone();
        let client = std::thread::spawn(move || {
            let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).unwrap();
            stream.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
            stream.write_all(token.as_bytes()).unwrap();
            stream.write_all(b"\n").unwrap();
            let mut response = Vec::new();
            stream.read_to_end(&mut response).unwrap();
            client_flag.store(true, Ordering::SeqCst);
            response
        });
        let result = runner::capture(
            command,
            Duration::from_secs(3),
            &flag,
            &mut || broker.poll(),
            &mut |_| {},
        );
        broker.revoke();
        assert!(matches!(result, Err(runner::CaptureError::Cancelled)));
        assert_eq!(client.join().unwrap(), b"test-only password");
        assert!(broker.consumed());
    }

    #[test]
    fn inherited_pipe_handles_do_not_delay_return_until_grandchild_exit() {
        let command = shell("start \"\" /B cmd.exe /D /C \"ping -n 4 127.0.0.1 >NUL\" & echo direct-exit");
        let started = Instant::now();
        let output = runner::capture(
            command,
            Duration::from_secs(5),
            &AtomicBool::new(false),
            &mut || Ok(()),
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(output.code, Some(0));
        let elapsed = started.elapsed();
        let stdout = String::from_utf8(output.stdout).unwrap();
        let stderr = String::from_utf8(output.stderr).unwrap();
        assert!(stdout.contains("direct-exit"), "stdout={stdout:?}, stderr={stderr:?}");
        assert!(
            elapsed < Duration::from_secs(2),
            "must not wait for inherited pipe EOF: elapsed={elapsed:?}, stdout={stdout:?}, stderr={stderr:?}"
        );
    }
}
