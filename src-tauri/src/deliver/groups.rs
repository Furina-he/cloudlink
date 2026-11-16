//! 按真实目录动态收敛分发单位，不按品牌或行数硬编码。

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;

use super::paths;
use crate::env::EnvContext;
use crate::error::AppError;
use crate::model::asset::Asset;
use crate::model::delivery::{Delivery, DeliveryStatus, Inclusion, InclusionReasonId, Target};
use crate::model::env::EnvId;
use crate::model::{Detail, ParamValue};
use crate::paths::Paths;

#[derive(Debug, Clone)]
pub(crate) struct Unit {
    pub env_id: EnvId,
    pub parent: PathBuf,
    pub targets: Vec<Target>,
}

impl Unit {
    pub fn id(&self) -> &str {
        &self.targets[0].id
    }
    pub fn owner(&self) -> &Target {
        &self.targets[0]
    }
    pub fn keys(&self) -> Vec<String> {
        self.targets
            .iter()
            .map(|t| t.agent_key.clone())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect()
    }
    pub fn active_keys(&self) -> Vec<String> {
        self.targets
            .iter()
            .filter(|t| t.enabled)
            .map(|t| t.agent_key.clone())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect()
    }
    pub fn enabled(&self) -> bool {
        self.targets.iter().any(|t| t.enabled)
    }
    pub fn decorate(&self, mut delivery: Delivery, target: &Target, mismatch: bool) -> Delivery {
        delivery.id = format!("dlv_{}", target.id);
        delivery.target_id = target.id.clone();
        delivery.env_id = target.env_id.clone();
        delivery.path = if target.env_id.is_windows() {
            std::path::Path::new(&target.path)
                .join(super::SKILL_DIR)
                .to_string_lossy()
                .into_owned()
        } else {
            format!("{}/{}", target.path.trim_end_matches('/'), super::SKILL_DIR)
        };
        delivery.unit_id = Some(self.id().to_string());
        let keys = self.keys();
        if keys.len() > 1 {
            delivery.shared_agent_keys = Some(keys.clone());
            if !target.enabled && self.enabled() && delivery.status != DeliveryStatus::Missing {
                delivery.status = DeliveryStatus::Shared;
                delivery.status_detail = Some(Detail::with(
                    "shared-agent".into(),
                    crate::params! {"agents" => keys.join(","), "targetId" => self.id()},
                ));
            } else if mismatch && matches!(delivery.status, DeliveryStatus::Ok | DeliveryStatus::Missing) {
                delivery.status_detail = Some(Detail::with(
                    "shared-selection-mismatch".into(),
                    crate::params! {"agents" => keys.join(",")},
                ));
            } else if delivery.status == DeliveryStatus::Ok {
                delivery.status_detail = Some(Detail::with(
                    "shared-directory".into(),
                    crate::params! {"agents" => keys.join(",")},
                ));
            }
        }
        delivery
    }
}

pub(crate) struct Plan {
    pub units: Vec<Unit>,
    pub invalid: BTreeMap<String, Detail<String>>,
    pub windows_shared: BTreeMap<String, String>,
}

pub(crate) fn error_detail(error: &AppError) -> Detail<String> {
    let reason = match error {
        AppError::Ipc { params, .. } => match params.get("reason") {
            Some(ParamValue::Str(reason)) => reason.as_str(),
            _ => "path-invalid",
        },
        AppError::Io(error) if error.kind() == std::io::ErrorKind::PermissionDenied => "path-permission",
        AppError::Io(_) => "path-unavailable",
        _ => "path-invalid",
    };
    Detail::new(reason.to_string())
}

impl Plan {
    pub fn new(paths: &Paths, envs: &[EnvContext], targets: &[Target]) -> Self {
        let mut grouped = BTreeMap::<(EnvId, PathBuf), Unit>::new();
        let mut invalid = BTreeMap::new();
        let mut cross = Vec::new();
        for target in targets {
            let Some(env) = envs.iter().find(|e| e.id == target.env_id && e.available) else {
                continue;
            };
            match paths::resolve_parent(paths, env, target) {
                Ok(resolved) if resolved.windows_shared => cross.push((target.id.clone(), resolved.path)),
                Ok(resolved) => {
                    let key = (target.env_id.clone(), paths::comparison(&resolved.path));
                    grouped
                        .entry(key)
                        .or_insert_with(|| Unit {
                            env_id: target.env_id.clone(),
                            parent: resolved.path,
                            targets: Vec::new(),
                        })
                        .targets
                        .push(target.clone());
                }
                Err(error) => {
                    invalid.insert(target.id.clone(), error_detail(&error));
                }
            }
        }
        let mut units: Vec<_> = grouped.into_values().collect();
        for unit in &mut units {
            unit.targets
                .sort_by(|a, b| a.agent_key.cmp(&b.agent_key).then_with(|| a.id.cmp(&b.id)));
        }
        for (i, unit) in units.iter().enumerate() {
            for other in units.iter().skip(i + 1) {
                if paths::overlap(&unit.parent, &other.parent) {
                    for target in unit.targets.iter().chain(&other.targets) {
                        invalid.insert(target.id.clone(), Detail::new("path-overlap".into()));
                    }
                }
            }
        }
        units.retain(|u| !u.targets.iter().any(|t| invalid.contains_key(&t.id)));
        let mut windows_shared = BTreeMap::new();
        for (id, parent) in cross {
            if let Some(unit) = units
                .iter()
                .find(|u| u.env_id.is_windows() && paths::comparison(&u.parent) == paths::comparison(&parent))
            {
                windows_shared.insert(id, unit.id().to_string());
            } else {
                invalid.insert(id, Detail::new("wsl-path-unsupported".into()));
            }
        }
        Self {
            units,
            invalid,
            windows_shared,
        }
    }

    pub fn unit_for(&self, target_id: &str) -> Option<&Unit> {
        self.units.iter().find(|u| u.targets.iter().any(|t| t.id == target_id))
    }

    /// One Agent key can own multiple physical directories with different intersections.
    /// Preserve the legacy source path unless it would alias another unit's source/authority.
    pub fn source_key(&self, unit: &Unit) -> String {
        if self.units.iter().any(|other| {
            other.id() != unit.id() && other.env_id == unit.env_id && other.owner().agent_key == unit.owner().agent_key
        }) {
            let parent = paths::comparison(&unit.parent).to_string_lossy().into_owned();
            format!(
                "unit-{}",
                crate::compile::publish::tree_hash([("parent", parent.as_bytes())])
            )
        } else {
            unit.owner().agent_key.clone()
        }
    }

    /// A shared copy constrains content, never the persisted choices or other environments.
    pub fn selection_mismatches(&self, assets: &[Asset]) -> BTreeSet<String> {
        let mut affected = BTreeSet::new();
        for unit in &self.units {
            let keys = unit.active_keys();
            if keys.len() < 2 {
                continue;
            }
            if assets.iter().any(|asset| {
                let chosen = keys.iter().filter(|key| asset.agent().agents.contains(key)).count();
                chosen > 0 && chosen < keys.len()
            }) {
                affected.extend(unit.targets.iter().map(|target| target.id.clone()));
            }
        }
        affected
    }

    /// 无法写入的目标及 WSL 共用 Windows 的目标不是实际列入的一份。
    pub fn constrain_inclusions(&self, inclusions: &mut [Inclusion], targets: &[Target]) {
        for item in inclusions {
            let relevant: Vec<_> = targets
                .iter()
                .filter(|t| t.enabled && t.env_id == item.env_id && t.agent_key == item.agent_key)
                .collect();
            if !relevant.is_empty()
                && relevant
                    .iter()
                    .all(|t| self.invalid.contains_key(&t.id) || self.windows_shared.contains_key(&t.id))
            {
                item.included = false;
                item.reason = Some(Detail::with(
                    InclusionReasonId::NotWritten,
                    crate::params! {"env" => item.env_id.as_str()},
                ));
            }
        }
    }
}
