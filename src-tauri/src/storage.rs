use tauri::Manager;
use crate::models::*;
use crate::settings::get_settings;

pub fn get_storage_dirs_internal(app: &tauri::AppHandle) -> StorageDirs {
    let settings = get_settings(app.clone()).unwrap_or_default();
    let base = if settings.download_dir.is_empty() {
        if let Ok(p) = app.path().download_dir() {
            p.join("remixer-tools")
        } else {
            std::env::current_dir().unwrap_or_default().join("remixer-tools")
        }
    } else {
        std::path::PathBuf::from(&settings.download_dir)
    };

    let library = base.join("library");
    let extractor = base.join("extractor");

    let _ = std::fs::create_dir_all(&base);
    let _ = std::fs::create_dir_all(&library);
    let _ = std::fs::create_dir_all(&extractor);

    StorageDirs {
        base_dir: base.to_string_lossy().to_string(),
        library_dir: library.to_string_lossy().to_string(),
        extractor_dir: extractor.to_string_lossy().to_string(),
    }
}

#[tauri::command]
pub fn get_download_dir(app: tauri::AppHandle) -> Result<String, String> {
    Ok(get_storage_dirs_internal(&app).library_dir)
}

#[tauri::command]
pub fn get_storage_dirs(app: tauri::AppHandle) -> Result<StorageDirs, String> {
    Ok(get_storage_dirs_internal(&app))
}

#[tauri::command]
pub fn open_storage_folder(app: tauri::AppHandle, folder_type: String) -> Result<(), String> {
    let dirs = get_storage_dirs_internal(&app);
    let path = match folder_type.as_str() {
        "library" => dirs.library_dir,
        "extractor" => dirs.extractor_dir,
        _ => dirs.base_dir,
    };
    
    open_directory(&path)
}

#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    open_directory(&path)
}

pub fn open_directory(path: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

#[tauri::command]
pub fn open_download_folder(app: tauri::AppHandle) -> Result<(), String> {
    open_storage_folder(app, "library".to_string())
}

pub fn scan_folder_recursive(dir_path: &std::path::Path, category: &str, depth: usize, items: &mut Vec<StorageFileItem>) {
    if depth > 3 {
        return;
    }
    if let Ok(entries) = std::fs::read_dir(dir_path) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let dir_name = path.file_name().and_then(|n| n.to_str()).unwrap_or_default();
                if !dir_name.starts_with('.') && dir_name != "library" && dir_name != "extractor" {
                    scan_folder_recursive(&path, category, depth + 1, items);
                }
            } else if path.is_file() {
                let name = path.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_string();
                if name.starts_with('.') {
                    continue;
                }
                let ext = path.extension().and_then(|e| e.to_str()).unwrap_or_default().to_lowercase();
                if matches!(ext.as_str(), "mp3" | "wav" | "flac" | "ogg" | "m4a" | "aac" | "mp4" | "mkv" | "webm" | "mov") {
                    let (size_bytes, modified_time) = if let Ok(meta) = path.metadata() {
                        let size = meta.len();
                        let mod_time = meta.modified().ok()
                            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                            .map(|d| d.as_secs())
                            .unwrap_or(0);
                        (size, mod_time)
                    } else {
                        (0, 0)
                    };

                    let stem_type = if category == "stem" {
                        name.rfind("_(").and_then(|start| {
                            let after = &name[start + 2..];
                            after.find(')').map(|end| after[..end].to_string())
                        })
                    } else {
                        None
                    };

                    let parent_group = if category == "stem" {
                        let group = if let Some(idx) = name.rfind("_(") {
                            name[..idx].to_string()
                        } else {
                            name.clone()
                        };
                        Some(group)
                    } else {
                        None
                    };

                    let full_path_str = path.to_string_lossy().to_string();
                    if !items.iter().any(|existing| existing.path == full_path_str) {
                        items.push(StorageFileItem {
                            name,
                            path: full_path_str,
                            size_bytes,
                            modified_time,
                            category: category.to_string(),
                            extension: ext,
                            stem_type,
                            parent_group,
                        });
                    }
                }
            }
        }
    }
}

#[tauri::command]
pub fn list_storage_files(app: tauri::AppHandle) -> Result<Vec<StorageFileItem>, String> {
    let dirs = get_storage_dirs_internal(&app);
    let mut items = Vec::new();

    let library_path = std::path::PathBuf::from(&dirs.library_dir);
    let extractor_path = std::path::PathBuf::from(&dirs.extractor_dir);
    let base_path = std::path::PathBuf::from(&dirs.base_dir);

    scan_folder_recursive(&library_path, "download", 0, &mut items);
    scan_folder_recursive(&extractor_path, "stem", 0, &mut items);

    // Also scan any root files directly in base_dir
    if let Ok(entries) = std::fs::read_dir(&base_path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() {
                let name = p.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_string();
                if !name.starts_with('.') {
                    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or_default().to_lowercase();
                    if matches!(ext.as_str(), "mp3" | "wav" | "flac" | "ogg" | "m4a" | "aac" | "mp4" | "mkv" | "webm" | "mov") {
                        let size_bytes = p.metadata().map(|m| m.len()).unwrap_or(0);
                        let modified_time = p.metadata().ok()
                            .and_then(|m| m.modified().ok())
                            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                            .map(|d| d.as_secs())
                            .unwrap_or(0);
                        let full_path_str = p.to_string_lossy().to_string();
                        if !items.iter().any(|existing| existing.path == full_path_str) {
                            let is_stem = name.contains("_(") && name.contains(")_");
                            let (category, stem_type, parent_group) = if is_stem {
                                let st = name.rfind("_(").and_then(|start| {
                                    let after = &name[start + 2..];
                                    after.find(')').map(|end| after[..end].to_string())
                                });
                                let pg = if let Some(idx) = name.rfind("_(") {
                                    Some(name[..idx].to_string())
                                } else {
                                    Some(name.clone())
                                };
                                ("stem".to_string(), st, pg)
                            } else {
                                ("download".to_string(), None, None)
                            };

                            items.push(StorageFileItem {
                                name,
                                path: full_path_str,
                                size_bytes,
                                modified_time,
                                category,
                                extension: ext,
                                stem_type,
                                parent_group,
                            });
                        }
                    }
                }
            }
        }
    }

    items.sort_by(|a, b| b.modified_time.cmp(&a.modified_time));

    Ok(items)
}

#[tauri::command]
pub fn delete_storage_file(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if p.exists() && p.is_file() {
        std::fs::remove_file(p).map_err(|e| e.to_string())?;
    }
    Ok(())
}
