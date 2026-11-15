//! 清洗后的观测值逐字段合并；人工标注与后续编辑不属于探测的撤销范围。

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

use super::ProbeData;
use super::parse::service_key;
use crate::error::{AppError, Result};
use crate::model::asset::{
    ConnectionVerified, FieldSource, ListeningPort, PanelInfo, ProbeState, ServerAsset, Service,
};
use crate::model::misc::IpcErrorId;
use crate::model::probe::{ProbeChange, ProbeChangeField, ProbeChangeKind, SshError, SshErrorId};
use crate::params as p;

/// 可持久化的结果只含清洗后的值和已有资源快照，不含原始输出。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeResult {
    pub asset: ServerAsset,
    pub applied: Vec<ProbeChange>,
    pub held: Vec<ProbeChange>,
    pub partial: Option<SshError>,
    pending: Vec<Pending>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Pending {
    id: String,
    mutation: Mutation,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
enum Mutation {
    Os(String),
    Kernel(String),
    Arch(String),
    CpuCores(u32),
    MemoryTotalMib(u32),
    DiskTotalGib(u32),
    Panel(Option<PanelInfo>),
    Service(Service),
    ListeningPorts(Vec<ListeningPort>),
}

fn service_at<'a>(asset: &'a ServerAsset, observed: &Service) -> Option<&'a Service> {
    asset
        .services
        .iter()
        .find(|s| s.kind == observed.kind && s.name == observed.name)
}

/// lastSeenAt、role、critical 和手工 source 不表示观测结果发生变化。
fn same_observation(a: &Service, b: &Service) -> bool {
    a.kind == b.kind
        && a.name == b.name
        && a.image == b.image
        && a.ports == b.ports
        && a.missing == b.missing
        && a.sanitized == b.sanitized
}

fn same_connection(a: &ServerAsset, b: &ServerAsset) -> bool {
    let (a, b) = (&a.connection, &b.connection);
    a.source == b.source
        && a.ssh_alias == b.ssh_alias
        && a.host == b.host
        && a.port == b.port
        && a.user == b.user
        && a.auth == b.auth
        && a.proxy_jump == b.proxy_jump
}

fn bounded(value: impl AsRef<str>) -> String {
    value.as_ref().chars().take(super::MAX_VALUE_CHARS).collect()
}

fn panel_text(panel: &Option<PanelInfo>) -> String {
    panel.as_ref().map_or_else(
        || "null".into(),
        |p| {
            format!(
                "{}:{}",
                match p.kind {
                    crate::model::asset::PanelType::OnePanel => "1panel",
                    crate::model::asset::PanelType::Bt => "bt",
                },
                p.install_path
            )
        },
    )
}

fn service_text(service: &Service) -> String {
    let mut text = service.name.clone();
    if let Some(image) = &service.image {
        text.push_str(" · ");
        text.push_str(image);
    }
    for port in &service.ports {
        text.push_str(&format!(
            " · {}:{}->{}/{}",
            port.host_ip,
            port.host_port,
            port.container_port,
            port.proto.as_str()
        ));
    }
    if service.missing {
        text.push_str(" · missing");
    }
    bounded(text)
}

impl Mutation {
    fn same_target(&self, current: &ServerAsset, baseline: &ServerAsset) -> bool {
        match self {
            Self::Os(_) => current.facts.os == baseline.facts.os,
            Self::Kernel(_) => current.facts.kernel == baseline.facts.kernel,
            Self::Arch(_) => current.facts.arch == baseline.facts.arch,
            Self::CpuCores(_) => current.facts.cpu_cores == baseline.facts.cpu_cores,
            Self::MemoryTotalMib(_) => current.facts.memory_total_mib == baseline.facts.memory_total_mib,
            Self::DiskTotalGib(_) => current.facts.disk_total_gib == baseline.facts.disk_total_gib,
            Self::Panel(_) => current.facts.panel == baseline.facts.panel,
            Self::Service(service) => match (service_at(current, service), service_at(baseline, service)) {
                (Some(a), Some(b)) => same_observation(a, b),
                (None, None) => true,
                _ => false,
            },
            Self::ListeningPorts(_) => current.listening_ports == baseline.listening_ports,
        }
    }

    fn apply(&self, asset: &mut ServerAsset) {
        match self {
            Self::Os(value) => asset.facts.os = Some(value.clone()),
            Self::Kernel(value) => asset.facts.kernel = Some(value.clone()),
            Self::Arch(value) => asset.facts.arch = Some(value.clone()),
            Self::CpuCores(value) => asset.facts.cpu_cores = Some(*value),
            Self::MemoryTotalMib(value) => asset.facts.memory_total_mib = Some(*value),
            Self::DiskTotalGib(value) => asset.facts.disk_total_gib = Some(*value),
            Self::Panel(value) => asset.facts.panel = Some(value.clone()),
            Self::Service(value) => {
                if let Some(existing) = asset
                    .services
                    .iter_mut()
                    .find(|s| s.kind == value.kind && s.name == value.name)
                {
                    existing.image.clone_from(&value.image);
                    existing.ports.clone_from(&value.ports);
                    existing.last_seen_at.clone_from(&value.last_seen_at);
                    existing.missing = value.missing;
                    existing.sanitized = value.sanitized;
                } else {
                    asset.services.push(value.clone());
                }
            }
            Self::ListeningPorts(value) => asset.listening_ports.clone_from(value),
        }
    }

    fn change(&self, before: &ServerAsset, id: String) -> ProbeChange {
        use ProbeChangeField as Field;
        let (field, label, old, new, kind) = match self {
            Self::Os(value) => (
                Field::Os,
                "os".into(),
                before.facts.os.clone(),
                Some(value.clone()),
                None,
            ),
            Self::Kernel(value) => (
                Field::Kernel,
                "kernel".into(),
                before.facts.kernel.clone(),
                Some(value.clone()),
                None,
            ),
            Self::Arch(value) => (
                Field::Facts,
                "arch".into(),
                before.facts.arch.clone(),
                Some(value.clone()),
                None,
            ),
            Self::CpuCores(value) => (
                Field::Facts,
                "cpuCores".into(),
                before.facts.cpu_cores.map(|v| v.to_string()),
                Some(value.to_string()),
                None,
            ),
            Self::MemoryTotalMib(value) => (
                Field::Facts,
                "memoryTotalMiB".into(),
                before.facts.memory_total_mib.map(|v| v.to_string()),
                Some(value.to_string()),
                None,
            ),
            Self::DiskTotalGib(value) => (
                Field::Facts,
                "diskTotalGiB".into(),
                before.facts.disk_total_gib.map(|v| v.to_string()),
                Some(value.to_string()),
                None,
            ),
            Self::Panel(value) => (
                Field::Facts,
                "panel".into(),
                before.facts.panel.as_ref().map(panel_text),
                Some(panel_text(value)),
                None,
            ),
            Self::Service(value) => {
                let old = service_at(before, value);
                (
                    Field::Service,
                    value.name.clone(),
                    old.map(service_text),
                    Some(service_text(value)),
                    value.missing.then_some(ProbeChangeKind::Missing),
                )
            }
            Self::ListeningPorts(value) => {
                let text = |ports: &[ListeningPort]| {
                    bounded(
                        ports
                            .iter()
                            .map(|p| format!("{}:{}/{}", p.addr, p.port, p.proto.as_str()))
                            .collect::<Vec<_>>()
                            .join(", "),
                    )
                };
                (
                    Field::ListeningPorts,
                    "listeningPorts".into(),
                    Some(text(&before.listening_ports)),
                    Some(text(value)),
                    None,
                )
            }
        };
        ProbeChange {
            id,
            kind: kind.unwrap_or(if old.is_some() {
                ProbeChangeKind::Changed
            } else {
                ProbeChangeKind::Added
            }),
            field,
            label,
            before: old.map(bounded),
            after: new.map(bounded),
        }
    }
}

impl MergeResult {
    fn record(&mut self, before: &ServerAsset, mutation: Mutation, suspicious: bool, run_id: &str) {
        let id = format!("{run_id}:chg:{}", self.applied.len() + self.held.len());
        let change = mutation.change(before, id.clone());
        if suspicious {
            self.held.push(change);
            self.pending.push(Pending { id, mutation });
        } else {
            mutation.apply(&mut self.asset);
            self.applied.push(change);
        }
    }
}

pub fn merge(current: &ServerAsset, data: &ProbeData, run_id: &str, at: &str) -> MergeResult {
    let mut result = MergeResult {
        asset: current.clone(),
        applied: Vec::new(),
        held: Vec::new(),
        partial: None,
        pending: Vec::new(),
    };
    if !data.valid {
        result.partial = Some(SshError::new(
            SshErrorId::Unknown,
            p! {"alias" => current.connection.ssh_alias.clone(), "reason" => "invalid-output"},
        ));
        return result;
    }
    macro_rules! fact {
        ($section:literal, $key:literal, $member:ident, $variant:ident) => {
            if data.successful_sections.contains($section)
                && let Some(value) = &data.facts.$member
                && current.facts.$member.as_ref() != Some(value)
            {
                result.record(
                    current,
                    Mutation::$variant(value.to_owned()),
                    data.suspicious_fields.contains($key),
                    run_id,
                );
            }
        };
    }
    fact!("os", "os", os, Os);
    fact!("kernel", "kernel", kernel, Kernel);
    fact!("kernel", "arch", arch, Arch);
    fact!("cpu", "cpuCores", cpu_cores, CpuCores);
    fact!("mem", "memoryTotalMiB", memory_total_mib, MemoryTotalMib);
    fact!("disk", "diskTotalGiB", disk_total_gib, DiskTotalGib);
    fact!("panel", "panel", panel, Panel);

    let observed: BTreeSet<_> = data.services.iter().map(service_key).collect();
    for service in &data.services {
        let section = service.kind.as_str();
        if !data.successful_sections.contains(section) {
            continue;
        }
        let mut service = service.clone();
        service.last_seen_at = Some(at.into());
        let suspicious = data.suspicious_services.contains(&service_key(&service));
        if service_at(current, &service).is_none_or(|previous| !same_observation(previous, &service)) {
            result.record(current, Mutation::Service(service), suspicious, run_id);
        } else if !suspicious {
            // 时间更新不增加「更新几处」计数，也不盖掉人工标注。
            Mutation::Service(service).apply(&mut result.asset);
        }
    }
    for previous in &current.services {
        if previous.source == FieldSource::Probe
            && !previous.missing
            && data.successful_sections.contains(previous.kind.as_str())
            && !observed.contains(&service_key(previous))
        {
            let mut missing = previous.clone();
            missing.missing = true;
            result.record(current, Mutation::Service(missing), false, run_id);
        }
    }
    if data.successful_sections.contains("listen") && current.listening_ports != data.listening_ports {
        result.record(
            current,
            Mutation::ListeningPorts(data.listening_ports.clone()),
            false,
            run_id,
        );
    }
    result.asset.probe.last_run_id = Some(run_id.into());
    result.asset.probe.last_success_at = Some(at.into());
    result.asset.probe.status = ProbeState::Ok;
    result.asset.connection.verified = Some(ConnectionVerified {
        ok: true,
        at: at.into(),
        // IPC 层把此次实际执行的 envId 加入列表，不猜测其它环境已验证。
        env_ids: current
            .connection
            .verified
            .as_ref()
            .map(|v| v.env_ids.clone())
            .unwrap_or_default(),
    });
    result.asset.updated_at = at.into();
    if !data.failed_sections.is_empty() {
        result.partial = Some(SshError::new(
            SshErrorId::Partial,
            p! {"alias" => current.connection.ssh_alias.clone(), "section" => data.failed_sections.join(", ")},
        ));
    }
    result
}

fn stale() -> AppError {
    AppError::ipc_with(IpcErrorId::NotFound, p! {"reason" => "probe-stale"})
}

/// 先验证整组选项，任何一处已被编辑都拒绝整次确认；role/critical 等标注不阻止确认。
pub fn confirm(current: &ServerAsset, merged: &MergeResult, change_ids: &[String]) -> Result<ServerAsset> {
    if current.id != merged.asset.id
        || current.probe.last_run_id != merged.asset.probe.last_run_id
        || !same_connection(current, &merged.asset)
    {
        return Err(stale());
    }
    let ids: BTreeSet<_> = change_ids.iter().collect();
    if ids.len() != change_ids.len() {
        return Err(stale());
    }
    let mut pending = Vec::new();
    for id in ids {
        if !merged.held.iter().any(|change| &change.id == id) {
            return Err(stale());
        }
        let value = merged
            .pending
            .iter()
            .find(|pending| &pending.id == id)
            .ok_or_else(stale)?;
        if !value.mutation.same_target(current, &merged.asset) {
            return Err(stale());
        }
        pending.push(&value.mutation);
    }
    let mut asset = current.clone();
    for mutation in pending {
        mutation.apply(&mut asset);
    }
    Ok(asset)
}

fn restore<T: PartialEq + Clone>(current: &mut T, before: &T, after: &T) {
    if before != after && *current == *after {
        current.clone_from(before);
    }
}

/// 撤销只恢复本次探测实际修改且此后未再编辑的字段；不复活已被用户删除的服务。
pub fn undo(current: &ServerAsset, before: &ServerAsset, after: &ServerAsset) -> ServerAsset {
    if current.id != before.id || current.id != after.id || current.probe.last_run_id != after.probe.last_run_id {
        return current.clone();
    }
    let mut restored = current.clone();
    macro_rules! fact {
        ($member:ident) => {
            restore(
                &mut restored.facts.$member,
                &before.facts.$member,
                &after.facts.$member,
            );
        };
    }
    fact!(os);
    fact!(kernel);
    fact!(arch);
    fact!(cpu_cores);
    fact!(memory_total_mib);
    fact!(disk_total_gib);
    fact!(panel);
    restore(
        &mut restored.listening_ports,
        &before.listening_ports,
        &after.listening_ports,
    );
    restored.services.retain_mut(|service| {
        let Some(probed) = service_at(after, service) else {
            return true;
        };
        let Some(previous) = service_at(before, service) else {
            // 新服务被标注或编辑过就留住，避免丢失用户在探测后录入的信息。
            return !same_observation(service, probed)
                || service.role != probed.role
                || service.critical != probed.critical
                || service.source != probed.source
                || service.last_seen_at != probed.last_seen_at;
        };
        if service.source != probed.source {
            return true;
        }
        restore(&mut service.image, &previous.image, &probed.image);
        restore(&mut service.ports, &previous.ports, &probed.ports);
        restore(&mut service.last_seen_at, &previous.last_seen_at, &probed.last_seen_at);
        restore(&mut service.missing, &previous.missing, &probed.missing);
        restore(&mut service.sanitized, &previous.sanitized, &probed.sanitized);
        true
    });
    if same_connection(current, after) {
        restore(
            &mut restored.connection.verified,
            &before.connection.verified,
            &after.connection.verified,
        );
    }
    restore(
        &mut restored.probe.last_run_id,
        &before.probe.last_run_id,
        &after.probe.last_run_id,
    );
    restore(
        &mut restored.probe.last_success_at,
        &before.probe.last_success_at,
        &after.probe.last_success_at,
    );
    restore(&mut restored.probe.status, &before.probe.status, &after.probe.status);
    restore(&mut restored.updated_at, &before.updated_at, &after.updated_at);
    restored
}
