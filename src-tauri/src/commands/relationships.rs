use tauri::State;

use crate::app::state::AppState;
use crate::db;
use crate::models::{
    WatchedAcEvent, WatchedBindingInput, WatchedPerson, WatchedSyncResult, PLATFORMS,
};
use crate::sync::relationships;

#[tauri::command]
pub(crate) fn get_watched_people(state: State<'_, AppState>) -> Result<Vec<WatchedPerson>, String> {
    let conn = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
    db::get_watched_people(&conn)
}

#[tauri::command]
pub(crate) fn get_watched_events(
    state: State<'_, AppState>,
) -> Result<Vec<WatchedAcEvent>, String> {
    let conn = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
    db::get_watched_events(&conn)
}

#[tauri::command]
pub(crate) fn save_watched_person(
    state: State<'_, AppState>,
    platform: String,
    account: String,
    nickname: String,
    relationship: String,
    secret: String,
) -> Result<(), String> {
    if !PLATFORMS.contains(&platform.trim()) {
        return Err("不支持的平台".into());
    }
    if account.trim().is_empty() {
        return Err("关系人的账号不能为空".into());
    }
    let _operation = state.operations.enter()?;
    let mut conn = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
    db::save_watched_person(
        &mut conn,
        &platform,
        &account,
        &nickname,
        &relationship,
        &secret,
    )
}

#[tauri::command]
pub(crate) fn save_watched_people(
    state: State<'_, AppState>,
    nickname: String,
    relationship: String,
    bindings: Vec<WatchedBindingInput>,
) -> Result<(), String> {
    if bindings.is_empty() {
        return Err("请至少填写一个平台账号".into());
    }
    if bindings.iter().any(|binding| {
        !PLATFORMS.contains(&binding.platform.trim()) || binding.account.trim().is_empty()
    }) {
        return Err("平台不受支持或账号为空".into());
    }
    let _operation = state.operations.enter()?;
    let mut conn = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
    db::save_watched_people(&mut conn, &nickname, &relationship, &bindings)
}

#[tauri::command]
pub(crate) fn delete_watched_person(
    state: State<'_, AppState>,
    person_id: i64,
) -> Result<(), String> {
    let _operation = state.operations.enter()?;
    let mut conn = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
    db::delete_watched_person(&mut conn, person_id)
}

#[tauri::command]
pub(crate) async fn sync_watched_people(
    state: State<'_, AppState>,
) -> Result<WatchedSyncResult, String> {
    relationships::sync(&state, None).await
}

#[tauri::command]
pub(crate) async fn sync_watched_person(
    state: State<'_, AppState>,
    person_id: i64,
) -> Result<WatchedSyncResult, String> {
    relationships::sync(&state, Some(person_id)).await
}

#[tauri::command]
pub(crate) fn dismiss_watched_event(
    state: State<'_, AppState>,
    event_id: i64,
) -> Result<(), String> {
    let _operation = state.operations.enter()?;
    let conn = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
    db::dismiss_watched_event(&conn, event_id)
}
