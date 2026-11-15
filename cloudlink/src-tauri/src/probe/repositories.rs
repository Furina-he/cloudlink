//! Repository evidence is collected only from registered directories and stays data,
//! never a shell program, a credential URL, or an implicit permission grant.
use super::*;
use crate::model::asset::{AssetPath, FieldSource, RepoSource};

const UBUNTU: &str = include_str!("../../tests/probe-fixtures/ubuntu-24.04.txt");

fn path(directory: &str) -> AssetPath {
    AssetPath {
        key: "app".into(),
        label: "Application checkout".into(),
        path: directory.into(),
        source: FieldSource::Manual,
        repo_source: None,
    }
}

fn observed(raw: &str, paths: &[AssetPath]) -> ProbeData {
    parse::parse_for_paths(
        &format!("{UBUNTU}\n@@git\n{raw}\n@@status git 0\n"),
        paths,
        &["github.com".into()],
    )
}

#[test]
fn registered_directories_are_posix_quoted_without_evaluating_embedded_shell_text() {
    let directory = "/srv/a 'quoted'; $(touch /must-not-run)";
    let script = script_for_paths(&[path(directory)]);
    assert!(script.contains("cloudlink_git_remote 'app' '/srv/a '\\''quoted'\\''; $(touch /must-not-run)'"));
    for directory in ["-oProxyCommand=unsafe", "/", "/srv/../private", "/srv/newline\nunsafe"] {
        assert!(!script_for_paths(&[path(directory)]).contains("cloudlink_git_remote 'app'"));
    }
    let mut non_manual = path("/srv/app");
    non_manual.source = FieldSource::Probe;
    assert!(!script_for_paths(&[non_manual]).contains("cloudlink_git_remote 'app'"));
}

#[test]
fn remote_origins_are_safely_projected_without_retaining_url_or_credentials() {
    let paths = [path("/srv/app")];
    let data = observed("app\t0\tgit@github.com:acme/app.git", &paths);
    assert!(data.valid);
    assert_eq!(data.repo_sources["app"].source.as_ref().unwrap().repo, "app");
    assert!(!format!("{data:?}").contains("git@github.com:"));
    for remote in [
        "https://fake-password@github.com/acme/app.git",
        "git@unknown.example:acme/app.git",
        "https://github.com/acme/app?token=fake-password",
    ] {
        let data = observed(&format!("app\t0\t{remote}"), &paths);
        assert!(data.valid);
        assert!(data.repo_sources["app"].source.is_none());
        assert!(!format!("{data:?}").contains("fake-password"));
    }
    assert!(
        observed("unregistered\t0\tgit@github.com:acme/app.git", &paths)
            .repo_sources
            .is_empty()
    );
}

#[test]
fn merge_and_undo_preserve_manual_path_edits_and_failed_queries_keep_prior_evidence() {
    let mut server = crate::testkit::hk_edge();
    server.paths = vec![path("/srv/app")];
    let data = observed("app\t0\tgit@github.com:acme/app.git", &server.paths);
    let merged = merge(&server, &data, "prb_repo", "2026-11-15T00:00:00Z");
    let source = RepoSource {
        host: "github.com".into(),
        owner: "acme".into(),
        repo: "app".into(),
        repo_id: None,
    };
    assert_eq!(merged.asset.paths[0].repo_source, Some(source.clone()));
    assert_eq!(undo(&merged.asset, &server, &merged.asset).paths[0].repo_source, None);
    let failed = observed("app\t128\t", &merged.asset.paths);
    assert!(failed.repo_sources.is_empty());
    assert_eq!(
        merge(&merged.asset, &failed, "prb_fail", "2026-11-15T00:00:01Z")
            .asset
            .paths[0]
            .repo_source,
        Some(source)
    );
    let mut edited = server.clone();
    edited.paths[0].path = "/srv/different".into();
    assert!(
        merge(&edited, &data, "prb_late", "2026-11-15T00:00:02Z").asset.paths[0]
            .repo_source
            .is_none()
    );
    let absent = observed("app\t1\t", &merged.asset.paths);
    assert!(
        merge(&merged.asset, &absent, "prb_absent", "2026-11-15T00:00:03Z")
            .asset
            .paths[0]
            .repo_source
            .is_none()
    );
}
