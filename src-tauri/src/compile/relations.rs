//! 资源之间的关系（「How they fit together」，2026-11-07 起由 CloudLink 维护）。
//! 只用已经录入或探测到的数据推出，每条一句英文；用户可以隐藏某一条，或者改写成自己的一句。
//! 界面文案由前端按 `kind` 和参数生成，这里的英文只进 SKILL.md。

use std::collections::BTreeMap;
use std::net::IpAddr;

use crate::model::asset::{Asset, CliProvider, CliScopeKind, ServerAsset};
use crate::model::compile::{Relation, RelationKind, SkillConfig};
use crate::model::{ParamValue, Params};

fn code(s: &str) -> String {
    super::render::code(s)
}

/// 服务器连接的主机：录入的地址，导入的取 `ssh -G` 解析结果
fn host_of(s: &ServerAsset) -> Option<String> {
    s.connection
        .host
        .clone()
        .or_else(|| s.connection.resolved.as_ref().map(|r| r.hostname.clone()))
        .map(|h| h.trim().to_ascii_lowercase())
        .filter(|h| !h.is_empty())
}

fn jump_of(s: &ServerAsset) -> Option<String> {
    s.connection
        .proxy_jump
        .clone()
        .flatten()
        .or_else(|| s.connection.resolved.as_ref().and_then(|r| r.proxy_jump.clone()))
        .map(|j| j.trim().to_string())
        .filter(|j| !j.is_empty() && !j.eq_ignore_ascii_case("none"))
}

fn relation(
    kind: RelationKind,
    id: String,
    assets: Vec<String>,
    params: Vec<(&str, String)>,
    text: String,
) -> Relation {
    let mut p = Params::new();
    for (k, v) in params {
        p.insert(k.to_string(), ParamValue::from(v.as_str()));
    }
    Relation {
        id,
        kind,
        asset_ids: assets,
        params: p,
        text,
        hidden: false,
    }
}

/// 从全部资源推出关系，按 id 排序、去重
pub fn derive(assets: &[Asset]) -> Vec<Relation> {
    let servers: Vec<&ServerAsset> = assets.iter().filter_map(Asset::as_server).collect();
    let by_alias = |alias: &str| {
        servers
            .iter()
            .find(|s| s.connection.ssh_alias.eq_ignore_ascii_case(alias))
            .copied()
    };
    let by_ip = |ip: &IpAddr| {
        servers
            .iter()
            .find(|s| host_of(s).and_then(|h| h.parse::<IpAddr>().ok()).as_ref() == Some(ip))
            .copied()
    };
    let mut out: BTreeMap<String, Relation> = BTreeMap::new();
    let mut push = |r: Relation| {
        out.entry(r.id.clone()).or_insert(r);
    };

    // 经跳板机连接
    for s in &servers {
        let Some(jump) = jump_of(s) else { continue };
        let alias = &s.connection.ssh_alias;
        let mut ids = vec![s.id.clone()];
        // 链式跳板（a,b）里每一个都要通
        for hop in jump.split(',') {
            if let Some(j) = by_alias(hop.trim()) {
                ids.push(j.id.clone());
            }
        }
        push(relation(
            RelationKind::ProxyJump,
            format!("jump:{}", s.id),
            ids,
            vec![("from", alias.clone()), ("via", jump.clone())],
            format!(
                "{} is reached through the jump host {}; if {} is unreachable, so is {}.",
                code(alias),
                code(&jump),
                code(&jump),
                code(alias)
            ),
        ));
    }

    // 同一台机器上的多个别名（同一地址、不同用户或端口）
    let mut by_host: BTreeMap<String, Vec<&ServerAsset>> = BTreeMap::new();
    for s in &servers {
        if let Some(h) = host_of(s) {
            by_host.entry(h).or_default().push(s);
        }
    }
    for group in by_host.values().filter(|g| g.len() > 1) {
        let mut aliases: Vec<&str> = group.iter().map(|s| s.connection.ssh_alias.as_str()).collect();
        aliases.sort_unstable();
        let mut ids: Vec<String> = group.iter().map(|s| s.id.clone()).collect();
        ids.sort();
        let list = aliases.iter().map(|a| code(a)).collect::<Vec<_>>().join(", ");
        push(relation(
            RelationKind::SameHost,
            format!("same:{}", ids.join("+")),
            ids,
            vec![("aliases", aliases.join("、"))],
            format!("{list} are the same machine; a change made through one affects the others."),
        ));
    }

    for a in assets {
        let Some(c) = a.as_cli() else { continue };
        let binary = c.cli.binary.as_str();
        for item in c.cli.scope.iter().filter(|i| i.selected) {
            match (c.cli_provider, item.kind) {
                // 域名：解析到哪台服务器，各台服务器上有哪些站点属于这个域名
                (CliProvider::Cloudflare, CliScopeKind::Zone) => {
                    let zone = item.name.trim().trim_end_matches('.').to_ascii_lowercase();
                    if zone.is_empty() {
                        continue;
                    }
                    let sites_on = |s: &ServerAsset| -> Vec<String> {
                        let mut sites: Vec<String> = s
                            .served_hostnames
                            .iter()
                            .map(|h| h.trim().trim_end_matches('.').to_ascii_lowercase())
                            .filter(|h| *h == zone || h.ends_with(&format!(".{zone}")))
                            .collect();
                        sites.sort();
                        sites.dedup();
                        sites
                    };
                    let list = |sites: &[String]| sites.iter().map(|h| code(h)).collect::<Vec<_>>().join(", ");
                    let linked = item
                        .linked_asset_id
                        .as_deref()
                        .and_then(|id| servers.iter().find(|s| s.id == id))
                        .copied();
                    if let Some(server) = linked {
                        let sites = sites_on(server);
                        let serves = if sites.is_empty() {
                            String::new()
                        } else {
                            format!(", which serves {}", list(&sites))
                        };
                        push(relation(
                            RelationKind::Dns,
                            format!("dns:{}:{}", c.id, item.id),
                            vec![c.id.clone(), server.id.clone()],
                            vec![
                                ("zone", item.name.clone()),
                                ("provider", c.handle.clone()),
                                ("to", server.connection.ssh_alias.clone()),
                                ("sites", sites.join("、")),
                            ],
                            format!(
                                "DNS for {} ({}, managed with `{binary}`) points at {}{serves}.",
                                code(&item.name),
                                c.handle,
                                code(&server.connection.ssh_alias)
                            ),
                        ));
                    }
                    for s in servers.iter().filter(|s| linked.is_none_or(|l| l.id != s.id)) {
                        let sites = sites_on(s);
                        if sites.is_empty() {
                            continue;
                        }
                        push(relation(
                            RelationKind::Site,
                            format!("site:{}:{}:{}", c.id, item.id, s.id),
                            vec![c.id.clone(), s.id.clone()],
                            vec![
                                ("sites", sites.join("、")),
                                ("to", s.connection.ssh_alias.clone()),
                                ("zone", item.name.clone()),
                                ("provider", c.handle.clone()),
                            ],
                            format!(
                                "{} {} served by {}; the DNS zone {} is managed with `{binary}` ({}).",
                                list(&sites),
                                if sites.len() == 1 { "is" } else { "are" },
                                code(&s.connection.ssh_alias),
                                code(&item.name),
                                c.handle
                            ),
                        ));
                    }
                }
                // 云主机实例就是某台服务器
                (CliProvider::Oracle, CliScopeKind::Instance) => {
                    let Some(server) = item
                        .address
                        .as_deref()
                        .and_then(|ip| ip.parse::<IpAddr>().ok())
                        .and_then(|ip| by_ip(&ip))
                    else {
                        continue;
                    };
                    push(relation(
                        RelationKind::Instance,
                        format!("instance:{}:{}", c.id, item.id),
                        vec![c.id.clone(), server.id.clone()],
                        vec![
                            ("instance", item.name.clone()),
                            ("provider", c.handle.clone()),
                            ("to", server.connection.ssh_alias.clone()),
                        ],
                        format!(
                            "{} is the {} instance {}: manage the VM itself (start, stop, resize) with `{binary}`, and everything inside it over SSH.",
                            code(&server.connection.ssh_alias),
                            c.handle,
                            code(&item.name)
                        ),
                    ));
                }
                _ => {}
            }
        }
    }
    out.into_values().collect()
}

/// 用户隐藏的标上 hidden，供界面列出
pub fn with_hidden(mut relations: Vec<Relation>, config: &SkillConfig) -> Vec<Relation> {
    for r in &mut relations {
        r.hidden = config.hidden_relations.iter().any(|h| h == &r.id);
    }
    relations
}

/// SKILL.md「How they fit together」的各行：涉及的资源都在这份 Skill 里的自动关系（未隐藏），再加用户写的
pub fn lines(included: &[&Asset], config: &SkillConfig) -> Vec<String> {
    let owned: Vec<Asset> = included.iter().map(|a| (*a).clone()).collect();
    let present = |id: &String| included.iter().any(|a| a.id() == id);
    derive(&owned)
        .into_iter()
        .filter(|r| !config.hidden_relations.contains(&r.id) && r.asset_ids.iter().all(present))
        .map(|r| r.text)
        .chain(
            config
                .relation_notes
                .iter()
                .map(|n| n.text.split_whitespace().collect::<Vec<_>>().join(" "))
                .filter(|t| !t.is_empty()),
        )
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::asset::{CliScopeItem, ResolvedConnection};
    use crate::model::compile::RelationNote;
    use crate::testkit;

    fn zone(id: &str, name: &str, linked: Option<&str>) -> CliScopeItem {
        CliScopeItem {
            id: id.into(),
            kind: CliScopeKind::Zone,
            name: name.into(),
            selected: true,
            linked_asset_id: linked.map(String::from),
            address: None,
            default_branch: None,
            visibility: None,
        }
    }

    #[test]
    fn derives_jump_hosts_dns_sites_instances_and_shared_machines() {
        let mut hk = testkit::hk_edge();
        hk.served_hostnames = vec!["api.example.com".into(), "blog.other.org".into()];
        let mut relay = testkit::dev_box();
        relay.connection.ssh_alias = "jp-relay".into();
        relay.connection.host = Some("198.51.100.7".into());
        let mut behind = testkit::dev_box();
        behind.id = "ast_behind".into();
        behind.connection.ssh_alias = "sg-db".into();
        behind.connection.host = Some("10.0.0.5".into());
        behind.connection.proxy_jump = Some(Some("jp-relay".into()));
        let mut twin = testkit::hk_edge();
        twin.id = "ast_twin".into();
        twin.connection.ssh_alias = "hk-edge-root".into();
        twin.served_hostnames = vec!["www.example.com".into()];

        let mut cf = testkit::cloudflare();
        cf.cli.scope = vec![
            zone("z1", "example.com", Some(&hk.id)),
            zone("z2", "unlinked.dev", None),
        ];
        let mut oci = testkit::cloudflare();
        oci.id = "ast_oci".into();
        oci.handle = "oracle".into();
        oci.cli_provider = CliProvider::Oracle;
        oci.cli.binary = crate::model::asset::CliBinary::Oci;
        oci.cli.scope = vec![CliScopeItem {
            id: "i1".into(),
            kind: CliScopeKind::Instance,
            name: "instance-20260501".into(),
            selected: true,
            linked_asset_id: None,
            address: Some("198.51.100.7".into()),
            default_branch: None,
            visibility: None,
        }];

        let assets = vec![
            Asset::Vps(hk.clone()),
            Asset::Vps(relay.clone()),
            Asset::Vps(behind.clone()),
            Asset::Vps(twin.clone()),
            Asset::Cli(cf.clone()),
            Asset::Cli(oci.clone()),
        ];
        let relations = derive(&assets);
        let kinds: Vec<_> = relations.iter().map(|r| (r.kind, r.id.clone())).collect();
        assert!(
            kinds.contains(&(RelationKind::ProxyJump, "jump:ast_behind".into())),
            "{kinds:?}"
        );
        let dns = relations.iter().find(|r| r.kind == RelationKind::Dns).unwrap();
        assert_eq!(dns.asset_ids, vec![cf.id.clone(), hk.id.clone()]);
        assert!(
            dns.text
                .ends_with("points at `hk-edge`, which serves `api.example.com`."),
            "{}",
            dns.text
        );
        assert!(
            !relations.iter().any(|r| r.text.contains("blog.other.org")),
            "no zone, no relation"
        );
        // 同一地址的另一个别名也有这个站点时单独一条
        assert!(
            kinds
                .iter()
                .any(|(k, id)| *k == RelationKind::Site && id.ends_with(&twin.id))
        );
        let instance = relations.iter().find(|r| r.kind == RelationKind::Instance).unwrap();
        assert_eq!(instance.asset_ids, vec![oci.id.clone(), relay.id.clone()]);
        assert!(kinds.iter().any(|(k, _)| *k == RelationKind::SameHost));
        let jump = relations.iter().find(|r| r.kind == RelationKind::ProxyJump).unwrap();
        assert_eq!(jump.asset_ids, vec![behind.id.clone(), relay.id.clone()]);
        assert!(jump.text.contains("`jp-relay`"));
        assert_eq!(derive(&assets), relations, "stable order and ids");
    }

    #[test]
    fn hidden_and_missing_assets_are_left_out_and_user_notes_follow() {
        let mut hk = testkit::hk_edge();
        hk.connection.proxy_jump = Some(Some("jp-relay".into()));
        let mut imported = testkit::dev_box();
        imported.connection.host = None;
        imported.connection.proxy_jump = None;
        imported.connection.resolved = Some(ResolvedConnection {
            hostname: "192.0.2.44".into(),
            user: "ubuntu".into(),
            port: 22,
            proxy_jump: Some("hk-edge".into()),
            resolved_at: "2026-11-01T00:00:00Z".into(),
        });
        let assets = [Asset::Vps(hk.clone()), Asset::Vps(imported.clone())];
        let included: Vec<&Asset> = assets.iter().collect();
        let mut config = SkillConfig {
            relation_notes: vec![RelationNote {
                id: "rel_1".into(),
                text: "  sg-db   backs\nthe API ".into(),
                replaces: None,
            }],
            ..Default::default()
        };
        let all = lines(&included, &config);
        assert_eq!(all.len(), 3, "{all:?}");
        assert_eq!(all.last().unwrap(), "sg-db backs the API");
        config.hidden_relations = vec![format!("jump:{}", hk.id)];
        assert_eq!(lines(&included, &config).len(), 2);
        let only_hk = [&assets[0]];
        assert!(
            lines(&only_hk, &SkillConfig::default())
                .iter()
                .all(|l| !l.contains("192.0.2.44"))
        );
        let marked = with_hidden(derive(&assets), &config);
        assert!(marked.iter().any(|r| r.hidden));
    }
}
