#[tauri::command]
pub(crate) fn write_export_file(path: String, data: Vec<u8>) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("导出路径为空".into());
    }
    std::fs::write(&path, data).map_err(|e| format!("写入导出文件失败：{e}"))
}
