mod app;
mod commands;
mod db;
mod fetch_queue;
mod infrastructure;
mod models;
mod operation;
mod sync;
mod xcpc;

use tauri::Manager;

use app::state::AppState;
use commands::accounts::{
    get_accounts, get_sync_statuses, save_account, save_accounts, save_all_accounts,
};
use commands::analytics::{get_day_detail, get_difficulty_detail, get_snapshot};
use commands::contest_review::{generate_contest_review, inspect_contest_review};
use commands::export::write_export_file;
use commands::external::open_external;
use commands::relationships::{
    delete_watched_person, dismiss_watched_event, get_watched_events, get_watched_people,
    save_watched_people, save_watched_person, sync_watched_people, sync_watched_person,
    update_watched_person,
};
use commands::storage::get_storage_info;
use commands::sync::{clear_all_records, clear_platform_records, sync_all, sync_platform};
use commands::tracker::TRACKER_INIT_SCRIPT;
use commands::update::check_for_updates;
use commands::xcpc::get_xcpc_contests;
use infrastructure::paths::portable_root_dir;

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
            inspect_contest_review,
            generate_contest_review,
            get_watched_people,
            get_watched_events,
            save_watched_person,
            save_watched_people,
            update_watched_person,
            delete_watched_person,
            sync_watched_people,
            sync_watched_person,
            dismiss_watched_event,
            write_export_file,
            check_for_updates,
            open_external
        ])
        .run(tauri::generate_context!())
        .expect("error while running OJ Insight");
}
