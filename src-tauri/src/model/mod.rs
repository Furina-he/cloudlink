//! IPC 数据模型（PRD 3.3、3.4、7.8）。字段与 `src/bindings/*.ts` 的手写契约一一对应，
//! ts-rs 导出到 `src/bindings/generated/`，由 `src/bindings/contract.check.ts` 做双向可赋值比对。

pub mod asset;
pub mod compile;
pub mod connection;
pub mod delivery;
pub mod env;
pub mod guard;
pub mod misc;
pub mod notes;
pub mod probe;

use std::collections::BTreeMap;

use serde::{Deserialize, Deserializer, Serialize};
use ts_rs::TS;

/// 文案参数：后端只返回 id 和参数，句子由 copy.ts 拼出
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(untagged)]
#[ts(export, export_to = "misc.ts")]
pub enum ParamValue {
    Str(String),
    Num(f64),
}

impl From<&str> for ParamValue {
    fn from(v: &str) -> Self {
        ParamValue::Str(v.to_string())
    }
}
impl From<String> for ParamValue {
    fn from(v: String) -> Self {
        ParamValue::Str(v)
    }
}
impl From<usize> for ParamValue {
    fn from(v: usize) -> Self {
        ParamValue::Num(v as f64)
    }
}
impl From<u32> for ParamValue {
    fn from(v: u32) -> Self {
        ParamValue::Num(f64::from(v))
    }
}
impl From<i64> for ParamValue {
    fn from(v: i64) -> Self {
        ParamValue::Num(v as f64)
    }
}

pub type Params = BTreeMap<String, ParamValue>;

/// 按键值对构造参数：`params!{"alias" => alias, "line" => 3usize}`
#[macro_export]
macro_rules! params {
    () => { $crate::model::Params::new() };
    ($($k:expr => $v:expr),+ $(,)?) => {{
        let mut p = $crate::model::Params::new();
        $( p.insert($k.to_string(), $crate::model::ParamValue::from($v)); )+
        p
    }};
}

/// `{ id, params? }`：未列入原因、副本状态说明、护栏说明共用的形状
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "misc.ts")]
pub struct Detail<I> {
    pub id: I,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "Record<string, string | number>")]
    pub params: Option<Params>,
}

impl<I> Detail<I> {
    pub fn new(id: I) -> Self {
        Detail { id, params: None }
    }
    pub fn with(id: I, params: Params) -> Self {
        Detail {
            id,
            params: Some(params),
        }
    }
}

/// 区分「字段缺失」（None）和「显式 null」（Some(None)）
pub fn double_option<'de, T, D>(d: D) -> Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: Deserializer<'de>,
{
    Option::<T>::deserialize(d).map(Some)
}
