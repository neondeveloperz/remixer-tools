use tauri::Manager;
use crate::models::*;
use crate::storage::get_storage_dirs_internal;

pub fn get_settings_path(app: &tauri::AppHandle) -> std::path::PathBuf {
    app.path()
        .app_local_data_dir()
        .unwrap()
        .join("settings.json")
}

#[tauri::command]
pub fn get_settings(app: tauri::AppHandle) -> Result<AppSettings, String> {
    let default_base_dir = if let Ok(path) = app.path().download_dir() {
        path.join("remixer-tools").to_string_lossy().to_string()
    } else {
        std::env::current_dir()
            .unwrap_or_default()
            .join("remixer-tools")
            .to_string_lossy()
            .to_string()
    };

    let settings_path = get_settings_path(&app);
    if let Ok(content) = std::fs::read_to_string(&settings_path) {
        if let Ok(mut settings) = serde_json::from_str::<AppSettings>(&content) {
            // Auto-migrate if download_dir was empty or raw downloads folder
            let should_migrate = if settings.download_dir.is_empty() {
                true
            } else if let Ok(dl_path) = app.path().download_dir() {
                let dl_str = dl_path.to_string_lossy().to_string();
                settings.download_dir == dl_str
            } else {
                false
            };

            if should_migrate {
                settings.download_dir = default_base_dir.clone();
                let _ = serde_json::to_string(&settings)
                    .map(|json| std::fs::write(&settings_path, json));
            }

            return Ok(settings);
        }
    }

    let mut default_settings = AppSettings::default();
    default_settings.download_dir = default_base_dir;
    default_settings.filename_template = Some("%(title)s.%(ext)s".to_string());

    Ok(default_settings)
}

#[tauri::command]
pub fn set_download_dir(app: tauri::AppHandle, dir: String) -> Result<(), String> {
    let mut settings = get_settings(app.clone())?;
    settings.download_dir = dir;
    let json = serde_json::to_string(&settings).map_err(|e| e.to_string())?;
    std::fs::write(get_settings_path(&app), json).map_err(|e| e.to_string())?;
    // Pre-create library and extractor in new base dir
    let _ = get_storage_dirs_internal(&app);
    Ok(())
}

#[tauri::command]
pub fn set_filename_template(app: tauri::AppHandle, template: String) -> Result<(), String> {
    let mut settings = get_settings(app.clone())?;
    settings.filename_template = Some(template);
    let json = serde_json::to_string(&settings).map_err(|e| e.to_string())?;
    std::fs::write(get_settings_path(&app), json).map_err(|e| e.to_string())?;
    Ok(())
}
