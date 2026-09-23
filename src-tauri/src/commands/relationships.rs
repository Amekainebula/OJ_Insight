use tauri::State;
use reqwest::{header::CONTENT_TYPE, Client, Url};
use scraper::{Html, Selector};
use serde::Serialize;
use serde_json::{json, Value};

use crate::app::state::AppState;
use crate::db;
use crate::models::{
    WatchedAcEvent, WatchedBindingInput, WatchedPerson, WatchedSyncResult, PLATFORMS,
};
use crate::sync::relationships;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WatchedAvatar {
    mime: String,
    bytes: Vec<u8>,
}

fn profile_avatar(html: &str, selector: &str, base: &str) -> Option<String> {
    let document = Html::parse_document(html);
    let selector = Selector::parse(selector).ok()?;
    let source = document.select(&selector).find_map(|node| node.value().attr("src"))?;
    Url::parse(base).ok()?.join(source).ok().map(|url| url.to_string())
}

async fn avatar_url(client: &Client, platform: &str, account: &str) -> Option<String> {
    let encoded = urlencoding::encode(account);
    match platform {
        "codeforces" => {
            let payload: Value = client.get(format!("https://codeforces.com/api/user.info?handles={encoded}"))
                .send().await.ok()?.json().await.ok()?;
            payload.pointer("/result/0/avatar")?.as_str().map(str::to_string)
        }
        "atcoder" => {
            let html = client.get(format!("https://atcoder.jp/users/{encoded}"))
                .send().await.ok()?.text().await.ok()?;
            profile_avatar(&html, "img.avatar", "https://atcoder.jp/")
        }
        "luogu" => {
            let uid = if account.chars().all(|c| c.is_ascii_digit()) {
                account.to_string()
            } else {
                let payload: Value = client.get(format!("https://www.luogu.com.cn/api/user/search?keyword={encoded}"))
                    .header("Referer", "https://www.luogu.com.cn/").send().await.ok()?.json().await.ok()?;
                let users = payload.get("users").or_else(|| payload.pointer("/data/users"))?.as_array()?;
                let user = users.iter().find(|user| user.get("name").and_then(Value::as_str).is_some_and(|name| name.eq_ignore_ascii_case(account)))
                    .or_else(|| users.first())?;
                user.get("uid").and_then(Value::as_i64)?.to_string()
            };
            let payload: Value = client.get(format!("https://www.luogu.com.cn/user/{uid}"))
                .header("x-lentille-request", "content-only").header("Referer", "https://www.luogu.com.cn/")
                .send().await.ok()?.json().await.ok()?;
            payload.pointer("/data/user/avatar")?.as_str().map(str::to_string)
        }
        "nowcoder" if account.chars().all(|c| c.is_ascii_digit()) => {
            let html = client.get(format!("https://ac.nowcoder.com/acm/contest/profile/{encoded}"))
                .send().await.ok()?.text().await.ok()?;
            profile_avatar(&html, "img.avatar, img.user-head, img.head-pic", "https://ac.nowcoder.com/")
        }
        "qoj" => {
            let html = client.get(format!("https://qoj.ac/user/profile/{encoded}"))
                .send().await.ok()?.text().await.ok()?;
            profile_avatar(&html, "img.avatar, img.user-avatar", "https://qoj.ac/")
        }
        "leetcode" => {
            let (site, username) = account.strip_prefix("cn:").map(|name| ("leetcode.cn", name))
                .unwrap_or(("leetcode.com", account));
            let payload: Value = client.post(format!("https://{site}/graphql"))
                .json(&json!({"query":"query userAvatar($username: String!) { matchedUser(username: $username) { profile { userAvatar } } }", "variables":{"username":username}}))
                .send().await.ok()?.json().await.ok()?;
            payload.pointer("/data/matchedUser/profile/userAvatar")?.as_str().map(str::to_string)
        }
        _ => None,
    }
}

#[tauri::command]
pub(crate) async fn get_watched_avatar(
    state: State<'_, AppState>, platform: String, account: String,
) -> Result<Option<WatchedAvatar>, String> {
    if !PLATFORMS.contains(&platform.as_str()) || account.trim().is_empty() {
        return Ok(None);
    }
    let Some(raw_url) = avatar_url(&state.client, &platform, account.trim()).await else { return Ok(None); };
    let normalized = if raw_url.starts_with("//") { format!("https:{raw_url}") } else { raw_url };
    let Ok(url) = Url::parse(&normalized) else { return Ok(None); };
    let host = url.host_str().unwrap_or_default();
    let trusted = ["userpic.codeforces.com", "codeforces.com", "img.atcoder.jp", "cdn.luogu.com.cn",
        "cdn.luogu.org", "uploadfiles.nowcoder.com", "static.nowcoder.com", "images.nowcoder.com",
        "qoj.ac", "leetcode.com", "leetcode.cn", "assets.leetcode.com", "pic.leetcode.com"];
    if url.scheme() != "https" || !trusted.contains(&host) { return Ok(None); }
    let Ok(mut response) = state.client.get(url).send().await else { return Ok(None); };
    if !response.status().is_success() { return Ok(None); }
    if response.url().scheme() != "https" || !trusted.contains(&response.url().host_str().unwrap_or_default()) { return Ok(None); }
    let mime = response.headers().get(CONTENT_TYPE).and_then(|value| value.to_str().ok())
        .unwrap_or_default().split(';').next().unwrap_or_default().to_ascii_lowercase();
    if !["image/png", "image/jpeg", "image/webp", "image/gif"].contains(&mime.as_str()) { return Ok(None); }
    let mut bytes = Vec::new();
    loop {
        let chunk = match response.chunk().await { Ok(Some(chunk)) => chunk, Ok(None) => break, Err(_) => return Ok(None) };
        if bytes.len() + chunk.len() > 2_000_000 { return Ok(None); }
        bytes.extend_from_slice(&chunk);
    }
    if bytes.is_empty() { return Ok(None); }
    Ok(Some(WatchedAvatar { mime, bytes }))
}

#[tauri::command]
pub(crate) fn get_watched_people(state: State<'_, AppState>) -> Result<Vec<WatchedPerson>, String> {
    let conn = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
    db::get_watched_people(&conn)
}

#[tauri::command]
pub(crate) fn get_watched_events(
    state: State<'_, AppState>,
    retention: u32,
) -> Result<Vec<WatchedAcEvent>, String> {
    let conn = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
    db::get_watched_events(&conn, retention)
}

#[tauri::command]
pub(crate) fn get_pending_watched_notifications(
    state: State<'_, AppState>,
) -> Result<Vec<WatchedAcEvent>, String> {
    let conn = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
    db::get_pending_watched_notifications(&conn)
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
    if nickname.trim().is_empty() {
        return Err("称呼不能为空".into());
    }
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
pub(crate) fn edit_watched_person(
    state: State<'_, AppState>,
    person_ids: Vec<i64>,
    nickname: String,
    relationship: String,
    bindings: Vec<WatchedBindingInput>,
) -> Result<(), String> {
    if nickname.trim().is_empty() {
        return Err("称呼不能为空".into());
    }
    if person_ids.is_empty() {
        return Err("关注账号不存在".into());
    }
    if bindings.iter().any(|binding| {
        !PLATFORMS.contains(&binding.platform.trim()) || binding.account.trim().is_empty()
    }) {
        return Err("平台不受支持或账号为空".into());
    }
    let _operation = state.operations.enter()?;
    let mut conn = state.db.lock().map_err(|_| "数据库锁异常".to_string())?;
    db::edit_watched_person(&mut conn, &person_ids, &nickname, &relationship, &bindings)
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
