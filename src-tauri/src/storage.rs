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
    let stems = base.join("stems");
    let midi = base.join("midi");
    let old_extractor = base.join("extractor");

    let _ = std::fs::create_dir_all(&base);
    let _ = std::fs::create_dir_all(&library);
    let _ = std::fs::create_dir_all(&stems);
    let _ = std::fs::create_dir_all(&midi);

    // Auto-migrate any existing stems from extractor/ into stems/<title>/
    if old_extractor.exists() && old_extractor.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&old_extractor) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_file() {
                    let name = p.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_string();
                    let group = if let Some(idx) = name.rfind("_(") {
                        &name[..idx]
                    } else {
                        "General"
                    };
                    let song_dir = stems.join(group);
                    let _ = std::fs::create_dir_all(&song_dir);
                    let dest = song_dir.join(&name);
                    let _ = std::fs::rename(&p, &dest);
                }
            }
        }
        // If old extractor is now empty, remove it
        if let Ok(mut entries) = std::fs::read_dir(&old_extractor) {
            if entries.next().is_none() {
                let _ = std::fs::remove_dir(&old_extractor);
            }
        }
    }

    StorageDirs {
        base_dir: base.to_string_lossy().to_string(),
        library_dir: library.to_string_lossy().to_string(),
        extractor_dir: stems.to_string_lossy().to_string(),
        stems_dir: stems.to_string_lossy().to_string(),
        midi_dir: midi.to_string_lossy().to_string(),
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
        "extractor" | "stems" => dirs.stems_dir,
        "midi" => dirs.midi_dir,
        _ => dirs.base_dir,
    };
    
    open_directory(&path)
}

#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    open_directory(&path)
}

pub fn open_directory(path: &str) -> Result<(), String> {
    let p = std::path::Path::new(path);
    let target_dir = if p.is_file() {
        p.parent().unwrap_or(p)
    } else {
        p
    };

    #[cfg(target_os = "windows")]
    {
        let win_path = target_dir.to_string_lossy().replace('/', "\\");
        std::process::Command::new("explorer")
            .arg(&win_path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(target_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(target_dir)
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
                if !dir_name.starts_with('.') && dir_name != "library" && dir_name != "extractor" && dir_name != "stems" {
                    scan_folder_recursive(&path, category, depth + 1, items);
                }
            } else if path.is_file() {
                let name = path.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_string();
                if name.starts_with('.') {
                    continue;
                }
                let ext = path.extension().and_then(|e| e.to_str()).unwrap_or_default().to_lowercase();
                if matches!(ext.as_str(), "mp3" | "wav" | "flac" | "ogg" | "m4a" | "aac" | "mp4" | "mkv" | "webm" | "mov" | "mid" | "midi") {
                    let is_midi = matches!(ext.as_str(), "mid" | "midi");
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

                    let parent_group = if category == "stem" || category == "midi" {
                        let parent_dir_name = path.parent().and_then(|p| p.file_name()).and_then(|n| n.to_str());
                        let group = if let Some(dir) = parent_dir_name {
                            if dir != "stems" && dir != "extractor" && dir != "midi" {
                                dir.to_string()
                            } else if let Some(idx) = name.rfind("_(") {
                                name[..idx].to_string()
                            } else {
                                name.clone()
                            }
                        } else if let Some(idx) = name.rfind("_(") {
                            name[..idx].to_string()
                        } else {
                            name.clone()
                        };
                        Some(group)
                    } else {
                        None
                    };

                    let file_category = if is_midi {
                        "midi".to_string()
                    } else {
                        category.to_string()
                    };

                    let full_path_str = path.to_string_lossy().to_string();
                    if !items.iter().any(|existing| existing.path == full_path_str) {
                        items.push(StorageFileItem {
                            name,
                            path: full_path_str,
                            size_bytes,
                            modified_time,
                            category: file_category,
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
    let stems_path = std::path::PathBuf::from(&dirs.stems_dir);
    let midi_path = std::path::PathBuf::from(&dirs.midi_dir);
    let base_path = std::path::PathBuf::from(&dirs.base_dir);
    let old_extractor_path = base_path.join("extractor");

    scan_folder_recursive(&library_path, "download", 0, &mut items);
    scan_folder_recursive(&stems_path, "stem", 0, &mut items);
    scan_folder_recursive(&midi_path, "midi", 0, &mut items);
    if old_extractor_path.exists() {
        scan_folder_recursive(&old_extractor_path, "stem", 0, &mut items);
    }

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
        // If parent song folder is now empty and not a root directory, remove it
        if let Some(parent) = p.parent() {
            if let Some(dir_name) = parent.file_name().and_then(|n| n.to_str()) {
                if dir_name != "stems" && dir_name != "library" && dir_name != "extractor" && dir_name != "midi" {
                    if let Ok(mut entries) = std::fs::read_dir(parent) {
                        if entries.next().is_none() {
                            let _ = std::fs::remove_dir(parent);
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn get_audio_cover(
    app: tauri::AppHandle,
    file_path: String,
) -> Result<Option<String>, String> {
    let path = std::path::PathBuf::from(&file_path);
    if !path.exists() || !path.is_file() {
        return Ok(None);
    }

    let app_dir = app.path().app_local_data_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
    let ffmpeg_binary = if cfg!(target_os = "windows") {
        app_dir.join("ffmpeg.exe")
    } else {
        app_dir.join("ffmpeg")
    };

    let ffmpeg_path = if ffmpeg_binary.exists() {
        ffmpeg_binary
    } else {
        std::path::PathBuf::from("ffmpeg")
    };

    let output = tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = std::process::Command::new(&ffmpeg_path);

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        cmd.arg("-v")
            .arg("error")
            .arg("-y")
            .arg("-i")
            .arg(&file_path)
            .arg("-an")
            .arg("-vcodec")
            .arg("copy")
            .arg("-f")
            .arg("image2")
            .arg("-update")
            .arg("1")
            .arg("pipe:1")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output()
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    if output.status.success() && !output.stdout.is_empty() {
        let bytes = output.stdout;
        use base64::prelude::*;
        let mime = if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
            "image/jpeg"
        } else if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
            "image/png"
        } else if bytes.starts_with(b"RIFF") && bytes.len() > 12 && &bytes[8..12] == b"WEBP" {
            "image/webp"
        } else {
            "image/jpeg"
        };
        let b64 = BASE64_STANDARD.encode(&bytes);
        Ok(Some(format!("data:{};base64,{}", mime, b64)))
    } else {
        Ok(None)
    }
}
