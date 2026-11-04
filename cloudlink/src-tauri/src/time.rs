//! UTC 时间：RFC 3339 字符串（`2026-10-27T10:30:00Z`）与日期。只用标准库，按 Howard Hinnant 的公历算法换算

use std::time::{SystemTime, UNIX_EPOCH};

/// 自 1970-01-01 起的天数 → (年, 月, 日)
pub fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// (年, 月, 日) → 自 1970-01-01 起的天数
pub fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400);
    let m = i64::from(m);
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + i64::from(d) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

pub fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub fn format_rfc3339(secs: i64) -> String {
    let (y, mo, d) = civil_from_days(secs.div_euclid(86_400));
    let t = secs.rem_euclid(86_400);
    format!(
        "{y:04}-{mo:02}-{d:02}T{:02}:{:02}:{:02}Z",
        t / 3600,
        t % 3600 / 60,
        t % 60
    )
}

pub fn format_date(secs: i64) -> String {
    let (y, mo, d) = civil_from_days(secs.div_euclid(86_400));
    format!("{y:04}-{mo:02}-{d:02}")
}

pub fn now_rfc3339() -> String {
    format_rfc3339(now_secs())
}

/// UTC bounds of the workstation's current calendar day. Windows uses the same operating
/// system time zone as WebView/Intl, including daylight-saving transitions. Non-Windows
/// packaging is outside v0.1; its fallback is UTC until native support is added.
pub fn local_day_bounds(now: i64) -> (i64, i64) {
    #[cfg(windows)]
    if let Some(bounds) = windows_zone::bounds(now) {
        return bounds;
    }
    let start = now.div_euclid(86_400) * 86_400;
    (start, start + 86_400)
}

#[cfg(any(windows, test))]
fn day_bounds_in_zone(
    now: i64,
    to_local: impl Fn(i64) -> Option<i64>,
    to_utc: impl Fn(i64) -> Option<i64>,
) -> Option<(i64, i64)> {
    let local_midnight = to_local(now)?.div_euclid(86_400) * 86_400;
    let start = to_utc(local_midnight)?;
    let end = to_utc(local_midnight + 86_400)?;
    (start <= now && now < end).then_some((start, end))
}

#[cfg(windows)]
mod windows_zone {
    use std::ffi::c_void;

    #[repr(C)]
    #[derive(Default)]
    struct WinTime {
        year: u16,
        month: u16,
        day_of_week: u16,
        day: u16,
        hour: u16,
        minute: u16,
        second: u16,
        milliseconds: u16,
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn SystemTimeToTzSpecificLocalTimeEx(zone: *const c_void, utc: *const WinTime, local: *mut WinTime) -> i32;
        fn TzSpecificLocalTimeToSystemTimeEx(zone: *const c_void, local: *const WinTime, utc: *mut WinTime) -> i32;
    }

    impl WinTime {
        fn from_secs(secs: i64) -> Option<Self> {
            let (year, month, day) = super::civil_from_days(secs.div_euclid(86_400));
            let time = secs.rem_euclid(86_400);
            Some(Self {
                year: year.try_into().ok()?,
                month: month as u16,
                day: day as u16,
                hour: (time / 3600) as u16,
                minute: (time % 3600 / 60) as u16,
                second: (time % 60) as u16,
                ..Default::default()
            })
        }

        fn to_secs(&self) -> i64 {
            super::days_from_civil(i64::from(self.year), u32::from(self.month), u32::from(self.day)) * 86_400
                + i64::from(self.hour) * 3600
                + i64::from(self.minute) * 60
                + i64::from(self.second)
        }
    }

    fn convert(secs: i64, to_local: bool) -> Option<i64> {
        let input = WinTime::from_secs(secs)?;
        let mut output = WinTime::default();
        // SAFETY: WinTime has the documented SYSTEMTIME layout. Both pointers refer to
        // initialized, correctly aligned values alive for the call; a null zone requests the
        // current system zone. Windows 10+ supplies both Ex functions, with no retained pointers.
        let ok = unsafe {
            if to_local {
                SystemTimeToTzSpecificLocalTimeEx(std::ptr::null(), &input, &mut output)
            } else {
                TzSpecificLocalTimeToSystemTimeEx(std::ptr::null(), &input, &mut output)
            }
        };
        (ok != 0).then(|| output.to_secs())
    }

    pub(super) fn bounds(now: i64) -> Option<(i64, i64)> {
        super::day_bounds_in_zone(now, |secs| convert(secs, true), |secs| convert(secs, false))
    }
}

/// 解析 `YYYY-MM-DDTHH:MM:SS[.fff](Z|±HH:MM)`，也接受只有日期的 `YYYY-MM-DD`
pub fn parse_rfc3339(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    let num = |r: std::ops::Range<usize>| -> Option<i64> { s.get(r)?.parse().ok() };
    if b.len() < 10 || b[4] != b'-' || b[7] != b'-' {
        return None;
    }
    let (y, mo, d) = (num(0..4)?, num(5..7)? as u32, num(8..10)? as u32);
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) {
        return None;
    }
    let days = days_from_civil(y, mo, d);
    if b.len() == 10 {
        return Some(days * 86_400);
    }
    if b.len() < 19 || !matches!(b[10], b'T' | b't' | b' ') || b[13] != b':' || b[16] != b':' {
        return None;
    }
    let (h, mi, sec) = (num(11..13)?, num(14..16)?, num(17..19)?);
    let mut rest = &s[19..];
    if let Some(frac) = rest.strip_prefix('.') {
        let n = frac.bytes().take_while(u8::is_ascii_digit).count();
        rest = &frac[n..];
    }
    let offset = match rest {
        "Z" | "z" => 0,
        o if o.len() == 6 && (o.starts_with('+') || o.starts_with('-')) && &o[3..4] == ":" => {
            let sign = if o.starts_with('-') { -1 } else { 1 };
            sign * (o[1..3].parse::<i64>().ok()? * 3600 + o[4..6].parse::<i64>().ok()? * 60)
        }
        _ => return None,
    };
    Some(days * 86_400 + h * 3600 + mi * 60 + sec - offset)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips() {
        let t = parse_rfc3339("2026-10-27T10:30:00Z").unwrap();
        assert_eq!(format_rfc3339(t), "2026-10-27T10:30:00Z");
        assert_eq!(format_date(t), "2026-10-27");
        assert_eq!(parse_rfc3339("2026-10-27T10:30:00.123Z"), Some(t));
        assert_eq!(parse_rfc3339("2026-10-27T18:30:00+08:00"), Some(t));
        assert_eq!(parse_rfc3339("1970-01-01"), Some(0));
        assert_eq!(
            parse_rfc3339("2024-02-29T00:00:00Z").map(format_date).as_deref(),
            Some("2024-02-29")
        );
        assert!(parse_rfc3339("yesterday").is_none());
    }

    #[test]
    fn local_day_uses_calendar_midnight_not_utc_midnight() {
        let now = parse_rfc3339("2026-11-03T20:00:00Z").unwrap();
        let (start, end) = day_bounds_in_zone(now, |t| Some(t + 8 * 3600), |t| Some(t - 8 * 3600)).unwrap();
        assert_eq!(format_rfc3339(start), "2026-11-03T16:00:00Z");
        assert_eq!(format_rfc3339(end), "2026-11-04T16:00:00Z");
    }

    #[test]
    fn local_day_respects_a_twenty_three_hour_spring_transition() {
        let now = parse_rfc3339("2026-03-08T16:00:00Z").unwrap();
        let transition = parse_rfc3339("2026-03-08T07:00:00Z").unwrap();
        let local_transition = parse_rfc3339("2026-03-08T03:00:00Z").unwrap();
        let (start, end) = day_bounds_in_zone(
            now,
            |t| Some(t - if t < transition { 5 * 3600 } else { 4 * 3600 }),
            |t| Some(t + if t < local_transition { 5 * 3600 } else { 4 * 3600 }),
        )
        .unwrap();
        assert_eq!(end - start, 23 * 3600);
        assert_eq!(format_rfc3339(start), "2026-03-08T05:00:00Z");
        assert_eq!(format_rfc3339(end), "2026-03-09T04:00:00Z");
    }

    #[cfg(windows)]
    #[test]
    fn windows_native_day_conversion_succeeds_and_contains_now() {
        let now = now_secs();
        let (start, end) = windows_zone::bounds(now).expect("Windows system time zone conversion");
        assert!(start <= now && now < end);
        assert!((23 * 3600..=25 * 3600).contains(&(end - start)));
    }
}
