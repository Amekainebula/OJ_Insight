mod app;
mod db;
mod fetch_queue;
mod infrastructure;
mod models;
mod operation;
mod sync;
mod xcpc;

use reqwest::Url;
use tauri::{Manager, State};
use tauri_plugin_opener::OpenerExt;

use app::state::{AppState, StorageInfo};
use infrastructure::logging::log_event;
use infrastructure::paths::portable_root_dir;
use models::*;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateInfo {
    current_version: String,
    latest_version: String,
    release_url: String,
    update_available: bool,
}

#[tauri::command]
fn get_storage_info(state: State<'_, AppState>) -> StorageInfo {
    StorageInfo::from(&*state)
}

#[tauri::command]
fn get_accounts(state: State<'_, AppState>) -> Result<Vec<AccountConfig>, String> {
    let conn = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
    db::get_accounts(&*conn)
}

#[tauri::command]
fn save_account(
    state: State<'_, AppState>,
    platform: String,
    account: String,
    secret: String,
) -> Result<(), String> {
    if !PLATFORMS.contains(&platform.as_str()) {
        return Err("不支持的平台".into());
    }
    let _operation = state.operations.enter()?;
    let mut conn = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
    db::save_account(&mut conn, &platform, &account, &secret)
}

#[tauri::command]
fn save_accounts(
    state: State<'_, AppState>,
    platform: String,
    accounts: Vec<AccountConfig>,
) -> Result<(), String> {
    if !PLATFORMS.contains(&platform.as_str()) {
        return Err("不支持的平台".into());
    }
    if accounts.iter().any(|entry| entry.platform != platform) {
        return Err("账号列表的平台不一致".into());
    }
    let _operation = state.operations.enter()?;
    let mut conn = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
    db::replace_accounts(&mut conn, &platform, &accounts)
}

#[tauri::command]
fn save_all_accounts(state: State<'_, AppState>, accounts: Vec<AccountConfig>) -> Result<(), String> {
    if accounts.iter().any(|entry| !PLATFORMS.contains(&entry.platform.as_str())) {
        return Err("不支持的平台".into());
    }
    let _operation = state.operations.enter()?;
    let mut conn = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
    db::replace_all_accounts(&mut conn, &accounts)
}

#[tauri::command]
fn get_sync_statuses(state: State<'_, AppState>) -> Result<Vec<SyncStatus>, String> {
    let conn = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
    db::statuses(&*conn)
}

const TRACKER_INIT_SCRIPT: &str = r#"
(() => {
  if (window.location.origin === 'https://cftracker.netlify.app') {
    const handle = new URLSearchParams(window.location.search).get('oji_handle');
    if (!handle) return;
    try {
      const state = JSON.parse(window.localStorage.getItem('statev2') || '{}');
      const oldList = state.userList && typeof state.userList === 'object' ? state.userList : {};
      state.userList = { ...oldList, handles: [handle], error: '', id: oldList.id || 0 };
      window.localStorage.setItem('statev2', JSON.stringify(state));
    } catch (_) {}
    return;
  }
  if (window.location.hostname === 'www.nowcoder.com' || window.location.hostname === 'ac.nowcoder.com') {
    // NowCoder opens its login routes in a popup. A popup launched from a
    // nested WebView is unreliable, so keep those navigations in this frame.
    window.open = (url) => {
      if (typeof url === 'string' && url) window.location.assign(url);
      return window;
    };
    window.addEventListener('click', (event) => {
      const target = event.target;
      const anchor = target && target.closest ? target.closest('a[target="_blank"]') : null;
      if (!anchor || !anchor.href) return;
      event.preventDefault();
      window.location.assign(anchor.href);
    }, true);
  }
})();
"#;

#[tauri::command]
async fn get_xcpc_contests(
    state: State<'_, AppState>,
    force_refresh: Option<bool>,
    refresh_ratings: Option<bool>,
) -> Result<Vec<XcpcContest>, String> {
    let cookie = {
        let conn = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
        let accounts = db::get_accounts(&conn)?;
        accounts
            .iter()
            .find(|entry| entry.platform == "qoj" && !entry.secret.trim().is_empty())
            .or_else(|| accounts.iter().find(|entry| entry.platform == "qoj"))
            .map(|entry| entry.secret.clone())
            .unwrap_or_default()
    };
    let mut contests = xcpc::load_catalog(
        &state.client,
        &state.data_dir.join("xcpc-catalog.json"),
        &cookie,
        force_refresh.unwrap_or(false),
    )
    .await?;
    if refresh_ratings.unwrap_or(false) {
        xcpc::sync_public_ratings(&state.client, &state.data_dir.join("xcpc-catalog.json"), &mut contests).await?;
    }
    let solved = {
        let conn = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
        db::apply_qoj_problem_ratings(&conn, &contests)?;
        db::solved_problem_keys(&conn, "qoj")?
    };
    for contest in &mut contests {
        for problem in &mut contest.problems {
            problem.solved = solved.contains(&problem.problem_id);
        }
    }
    Ok(contests)
}

async fn sync_one_inner(
    state: &AppState,
    platform: &str,
    full: bool,
) -> Result<SyncResult, String> {
    let _operation = state.operations.enter()?;
    let accounts = {
        let conn = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
        db::get_accounts(&conn)?
            .into_iter()
            .filter(|entry| entry.platform == platform && !entry.account.trim().is_empty())
            .collect::<Vec<_>>()
    };
    if accounts.is_empty() {
        return Err(format!("{} 尚未填写账号", platform));
    }
    let mut inserted = 0;
    let mut updated = 0;
    let mut succeeded = 0;
    let mut partial = false;
    let mut failures = Vec::new();
    let mut advisories = Vec::new();
    for account in accounts {
        let cursor = {
            let conn = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
            let cursor = if full {
                0
            } else {
                db::get_cursor(&conn, platform, &account.account)?
            };
            db::mark_syncing(&conn, platform, &account.account)?;
            cursor
        };
        log_event(
            &state.log_dir,
            platform,
            if full {
                "full rebuild started"
            } else {
                "incremental sync started"
            },
            &account.secret,
        );
        match sync::fetch_platform(&state.client, &account, full, cursor, &state.data_dir.join("public-cache")).await {
            Ok(mut remote) => {
                partial |= remote.activity_only && platform != "luogu";
                if remote.ratings.is_none() && (platform == "codeforces" || platform == "atcoder" ||
                    (platform == "leetcode" && !account.account.to_ascii_lowercase().starts_with("cn:"))) {
                    remote.notes.push("警告：Rating 暂未更新，已有 Rating 缓存保留；提交同步不受影响".into());
                }
                // The configured identifier is the stable local account key. Some
                // providers return a display name, which must not split one account.
                remote.account = account.account.trim().to_string();
                for submission in &mut remote.submissions {
                    submission.account = remote.account.clone();
                }
                let counts = {
                    let mut conn = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
                    db::apply_remote(&mut conn, &remote)
                };
                let counts = match counts {
                    Ok(value) => value,
                    Err(message) => {
                        let conn = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
                        db::mark_failed(&conn, platform, &account.account, "error", &message)?;
                        failures.push(format!("{}：{}", account.account, message));
                        log_event(&state.log_dir, platform, &message, &account.secret);
                        continue;
                    }
                };
                for note in &remote.notes {
                    if let Some(warning) = note.strip_prefix("警告：") {
                        advisories.push(format!("{}：{}", account.account, warning));
                    }
                }
                inserted += counts.0;
                updated += counts.1;
                succeeded += 1;
                log_event(
                    &state.log_dir,
                    platform,
                    &format!(
                        "sync completed account={} inserted={} updated={}",
                        account.account, counts.0, counts.1
                    ),
                    &account.secret,
                );
            }
            Err(err) => {
                let conn = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
                let _ =
                    db::mark_failed(&conn, platform, &account.account, &err.status, &err.message);
                failures.push(format!("{}：{}", account.account, err.message));
                log_event(
                    &state.log_dir,
                    platform,
                    &format!("sync failed status={} message={}", err.status, err.message),
                    &account.secret,
                );
            }
        }
    }
    if succeeded == 0 {
        let message = failures.join("；");
        let conn = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
        conn.execute("UPDATE sync_state SET status='error',message=? WHERE platform=?",
            rusqlite::params![message,platform]).map_err(|e| e.to_string())?;
        return Err(message);
    }
    let suffix = if failures.is_empty() {
        String::new()
    } else {
        format!(" · {} 个账号失败", failures.len())
    };
    let status = if failures.is_empty() && advisories.is_empty() { "ok" } else { "warning" };
    let mut message = format!("同步成功 · 新增 {inserted}，更新 {updated}{suffix}");
    for detail in failures.iter().chain(advisories.iter()) { message.push_str(&format!("；{detail}")); }
    {
        let conn = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
        conn.execute("UPDATE sync_state SET status=?,message=? WHERE platform=?",
            rusqlite::params![status,message,platform]).map_err(|e| e.to_string())?;
    }
    Ok(SyncResult {
        platform: platform.into(),
        inserted,
        updated,
        message,
        status: status.into(),
        partial,
    })
}

#[tauri::command]
async fn sync_platform(
    state: State<'_, AppState>,
    platform: String,
    full: bool,
) -> Result<SyncResult, String> {
    if !PLATFORMS.contains(&platform.as_str()) {
        return Err("不支持的平台".into());
    }
    sync_one_inner(&state, &platform, full).await
}

#[tauri::command]
async fn sync_all(state: State<'_, AppState>) -> Result<Vec<SyncResult>, String> {
    let mut configured = {
        let conn = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
        db::get_accounts(&conn)?
            .into_iter()
            .filter(|a| !a.account.trim().is_empty())
            .map(|a| a.platform)
            .collect::<Vec<_>>()
    };
    configured.sort();
    configured.dedup();
    let mut out = Vec::new();
    for p in configured {
        match sync_one_inner(&state, &p, false).await {
            Ok(r) => out.push(r),
            Err(message) => out.push(SyncResult {
                platform: p,
                inserted: 0,
                updated: 0,
                message,
                status: "error".into(),
                partial: false,
            }),
        }
    }
    Ok(out)
}

#[tauri::command]
fn clear_platform_records(state: State<'_, AppState>, platform: String) -> Result<(), String> {
    if !PLATFORMS.contains(&platform.as_str()) { return Err("不支持的平台".into()); }
    let _operation = state.operations.enter()?;
    let mut conn = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
    db::clear_platform(&mut conn, &platform)
}

#[tauri::command]
fn clear_all_records(state: State<'_, AppState>) -> Result<(), String> {
    let _operation = state.operations.enter()?;
    let mut conn = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
    db::clear_all(&mut conn)
}

#[tauri::command]
fn get_snapshot(
    state: State<'_, AppState>,
    platform: Option<String>,
    start_day: Option<String>,
    end_day: Option<String>,
    metric: String,
    account: Option<String>,
    source: Option<String>,
    time_zone: Option<String>,
) -> Result<Snapshot, String> {
    let conn = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
    db::snapshot(
        &*conn,
        platform.as_deref(),
        start_day.as_deref(),
        end_day.as_deref(),
        &metric,
        account.as_deref(),
        source.as_deref(),
        time_zone.as_deref().unwrap_or("Asia/Shanghai"),
    )
}

#[tauri::command]
fn get_day_detail(
    state: State<'_, AppState>,
    day: String,
    platform: Option<String>,
    account: Option<String>,
    source: Option<String>,
    time_zone: Option<String>,
) -> Result<DayDetail, String> {
    let conn = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
    db::day_detail(
        &*conn,
        &day,
        platform.as_deref(),
        account.as_deref(),
        source.as_deref(),
        time_zone.as_deref().unwrap_or("Asia/Shanghai"),
    )
}

#[tauri::command]
fn get_difficulty_detail(
    state: State<'_, AppState>,
    platform: String,
    label: String,
    account: Option<String>,
    source: Option<String>,
) -> Result<DifficultyDetail, String> {
    if !PLATFORMS.contains(&platform.as_str()) {
        return Err("不支持的平台".into());
    }
    if label.trim().is_empty() {
        return Err("难度不能为空".into());
    }
    let conn = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
    db::difficulty_detail(
        &*conn,
        &platform,
        &label,
        account.as_deref(),
        source.as_deref(),
    )
}

#[tauri::command]
fn write_export_file(path: String, data: Vec<u8>) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("导出路径为空".into());
    }
    std::fs::write(&path, data).map_err(|e| format!("写入导出文件失败：{e}"))
}

#[tauri::command]
async fn check_for_updates(state: State<'_, AppState>) -> Result<UpdateInfo, String> {
    let value = state
        .client
        .get("https://api.github.com/repos/Whalica/OJ_Insight/releases/latest")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("检查更新失败：{e}"))?
        .error_for_status()
        .map_err(|e| format!("GitHub Releases：{e}"))?
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("解析版本信息失败：{e}"))?;
    let latest = value
        .get("tag_name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim_start_matches('v')
        .to_string();
    if latest.is_empty() {
        return Err("GitHub Releases 没有可用版本".into());
    }
    let current = env!("CARGO_PKG_VERSION").to_string();
    let update_available = version_tuple(&latest) > version_tuple(&current);
    Ok(UpdateInfo {
        current_version: current,
        latest_version: latest,
        release_url: value
            .get("html_url")
            .and_then(|v| v.as_str())
            .unwrap_or("https://github.com/Whalica/OJ_Insight/releases")
            .into(),
        update_available,
    })
}

fn version_tuple(v: &str) -> (u64, u64, u64) {
    let mut p = v
        .split('.')
        .map(|x| x.split('-').next().unwrap_or("0").parse().unwrap_or(0));
    (
        p.next().unwrap_or(0),
        p.next().unwrap_or(0),
        p.next().unwrap_or(0),
    )
}

#[tauri::command]
fn open_external(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|_| "链接格式无效".to_string())?;
    let host = parsed.host_str().unwrap_or_default();
    let path = parsed.path();
    let allowed = parsed.scheme() == "https" && match host {
        "github.com" => path.starts_with("/Whalica/OJ_Insight"),
        "codeforces.com" | "www.codeforces.com" => path.starts_with("/contest/"),
        "atcoder.jp" | "www.atcoder.jp" => path.starts_with("/contests/"),
        "leetcode.com" | "www.leetcode.com" => path.starts_with("/contest/"),
        "qoj.ac" | "www.qoj.ac" => {
            path.starts_with("/problem/") || path.starts_with("/contest/")
        }
        "cftracker.netlify.app" | "kenkoooo.com" | "www.nowcoder.com" | "ac.nowcoder.com" => true,
        _ => false,
    };
    if !allowed {
        return Err("不允许打开该链接".into());
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn prepare_tracker_session(webview: tauri::WebviewWindow, tracker: String, secret: String) -> Result<(), String> {
    if tracker != "nowcoder" || secret.trim().is_empty() { return Ok(()); }
    let raw = secret.trim().trim_matches(|character| character == '"' || character == '\'');
    let header = raw.split_once(':')
        .filter(|(prefix, _)| prefix.trim().eq_ignore_ascii_case("cookie"))
        .map(|(_, value)| value.trim())
        .unwrap_or(raw);
    let ignored = ["path", "domain", "expires", "max-age", "secure", "httponly", "samesite"];
    let mut written = 0usize;
    let mut last_error = None;
    for part in header.split(';') {
        let Some((name, value)) = part.trim().split_once('=') else { continue };
        let name = name.trim();
        if name.is_empty() || !name.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'!' | b'#' | b'$' | b'%' | b'&' | b'\'' | b'*' | b'+' | b'-' | b'.' | b'^' | b'_' | b'`' | b'|' | b'~')) || ignored.iter().any(|item| name.eq_ignore_ascii_case(item)) { continue; }
        let cookie = tauri::webview::Cookie::build((name.to_string(), value.trim().to_string()))
            .domain("nowcoder.com")
            .path("/")
            .secure(true)
            .same_site(tauri::webview::cookie::SameSite::None)
            .build();
        match webview.set_cookie(cookie) {
            Ok(()) => written += 1,
            Err(error) => last_error = Some(error.to_string()),
        }
    }
    if written == 0 {
        return Err(last_error
            .map(|error| format!("写入牛客登录状态失败：{error}"))
            .unwrap_or_else(|| "Cookie 内容中没有可用字段".into()));
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // Portable-data layout: every piece of persistent application data lives
            // in one root directory. On Windows that root sits next to the
            // executable; macOS and Linux use their per-user application data
            // directories because installed application locations may be read-only.
            let root_dir = portable_root_dir(app.handle())?;
            let state = AppState::initialize(root_dir)?;
            let webview_dir = state.webview_dir.clone();
            app.manage(state);

            // The main WebView is created manually so WebView localStorage/cache also
            // stays inside the application root instead of the system app-data folders.
            tauri::WebviewWindowBuilder::from_config(app.handle(), &app.config().app.windows[0])?
                .data_directory(webview_dir)
                .initialization_script_for_all_frames(TRACKER_INIT_SCRIPT)
                .build()?;
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_storage_info,
            get_accounts,
            get_xcpc_contests,
            save_account,
            save_accounts,
            save_all_accounts,
            get_sync_statuses,
            sync_platform,
            sync_all,
            clear_platform_records,
            clear_all_records,
            get_snapshot,
            get_day_detail,
            get_difficulty_detail,
            write_export_file,
            check_for_updates,
            open_external,
            prepare_tracker_session
        ])
        .run(tauri::generate_context!())
        .expect("error while running OJ Insight");
}
