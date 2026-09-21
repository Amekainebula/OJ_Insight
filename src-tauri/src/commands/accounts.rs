use tauri::State;

use crate::app::state::AppState;
use crate::db;
use crate::models::{AccountConfig, SyncStatus, PLATFORMS};

#[tauri::command]
pub(crate) fn get_accounts(state: State<'_, AppState>) -> Result<Vec<AccountConfig>, String> {
    let conn = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
    db::get_accounts(&conn)
}

#[tauri::command]
pub(crate) fn save_account(
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
pub(crate) fn save_accounts(
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
pub(crate) fn save_all_accounts(
    state: State<'_, AppState>,
    accounts: Vec<AccountConfig>,
) -> Result<(), String> {
    if accounts
        .iter()
        .any(|entry| !PLATFORMS.contains(&entry.platform.as_str()))
    {
        return Err("不支持的平台".into());
    }
    let _operation = state.operations.enter()?;
    let mut conn = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
    db::replace_all_accounts(&mut conn, &accounts)
}

#[tauri::command]
pub(crate) fn get_sync_statuses(state: State<'_, AppState>) -> Result<Vec<SyncStatus>, String> {
    let conn = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
    db::statuses(&conn)
}
