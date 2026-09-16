use tauri::{Manager, Emitter};
use std::io::{BufRead, BufReader};
use std::process::Stdio;

use crate::models::*;
use crate::downloader::CommandExtForWindows;

pub fn get_models_dir(_app: &tauri::AppHandle) -> std::path::PathBuf {
    #[cfg(target_os = "windows")]
    {
        let dir = std::path::PathBuf::from(r"C:\tmp\audio-separator-models");
        let _ = std::fs::create_dir_all(&dir);
        dir
    }
    #[cfg(not(target_os = "windows"))]
    {
        let dir = std::path::PathBuf::from("/tmp/audio-separator-models");
        let _ = std::fs::create_dir_all(&dir);
        dir
    }
}

#[tauri::command]
pub fn get_installed_models(app: tauri::AppHandle) -> Result<Vec<InstalledModel>, String> {
    let models_dir = get_models_dir(&app);
    if !models_dir.exists() {
        return Ok(Vec::new());
    }

    let custom_file = models_dir.join("custom_models.json");
    let mut custom_map: std::collections::HashMap<String, CustomModelMetadata> = std::collections::HashMap::new();
    if custom_file.exists() {
        if let Ok(content) = std::fs::read_to_string(&custom_file) {
            if let Ok(list) = serde_json::from_str::<Vec<CustomModelMetadata>>(&content) {
                for item in list {
                    custom_map.insert(item.filename.clone(), item);
                }
            }
        }
    }

    let mut installed = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&models_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                let fname = entry.file_name().to_string_lossy().to_string();
                let lower = fname.to_lowercase();
                if lower.ends_with(".yaml") || lower.ends_with(".onnx") || lower.ends_with(".pth") || lower.ends_with(".ckpt") {
                    let metadata = entry.metadata().ok();
                    let size_bytes = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
                    let modified_time = metadata
                        .as_ref()
                        .and_then(|m| m.modified().ok())
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs())
                        .unwrap_or(0);

                    let custom_info = custom_map.get(&fname);
                    installed.push(InstalledModel {
                        filename: fname.clone(),
                        size_bytes,
                        modified_time,
                        is_custom: custom_info.is_some(),
                        custom_name: custom_info.map(|c| c.friendly_name.clone()),
                        custom_type: custom_info.map(|c| c.model_type.clone()),
                        custom_stems: custom_info.map(|c| c.stems.clone()),
                    });
                }
            }
        }
    }

    installed.sort_by(|a, b| a.filename.to_lowercase().cmp(&b.filename.to_lowercase()));
    Ok(installed)
}

#[tauri::command]
pub async fn download_ai_model(app: tauri::AppHandle, filename: String) -> Result<(), String> {
    let app_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let venv_dir = app_dir.join("venv");

    let separator_path = if cfg!(target_os = "windows") {
        venv_dir.join("Scripts").join("audio-separator.exe")
    } else {
        venv_dir.join("bin").join("audio-separator")
    };

    if !separator_path.exists() {
        return Err("audio-separator environment not found. Please wait for STEM setup to complete.".to_string());
    }

    let models_dir = get_models_dir(&app);
    let app_clone = app.clone();
    let fname_clone = filename.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = std::process::Command::new(&separator_path).hide_window();

        let current_path = std::env::var("PATH").unwrap_or_default();
        #[cfg(target_os = "windows")]
        let new_path = format!("{};{}", app_dir.to_string_lossy(), current_path);
        #[cfg(not(target_os = "windows"))]
        let new_path = format!("{}:{}:/opt/homebrew/bin:/usr/local/bin", app_dir.to_string_lossy(), current_path);

        cmd.env("PATH", new_path);
        cmd.env("PYTHONUNBUFFERED", "1");

        cmd.arg("--download_model_only");
        cmd.arg("--model_filename").arg(&fname_clone);
        cmd.arg("--model_file_dir").arg(&models_dir);

        let mut child = match cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).spawn() {
            Ok(c) => c,
            Err(e) => {
                let _ = app_clone.emit("model-download-done", ModelDownloadDone {
                    filename: fname_clone,
                    success: false,
                    error: Some(e.to_string()),
                });
                return;
            }
        };

        let stdout = child.stdout.take().unwrap();
        let app_stdout = app_clone.clone();
        let fname_stdout = fname_clone.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().flatten() {
                let _ = app_stdout.emit("model-download-log", ModelDownloadProgress {
                    filename: fname_stdout.clone(),
                    log: line,
                });
            }
        });

        let stderr = child.stderr.take().unwrap();
        let app_stderr = app_clone.clone();
        let fname_stderr = fname_clone.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().flatten() {
                let _ = app_stderr.emit("model-download-log", ModelDownloadProgress {
                    filename: fname_stderr.clone(),
                    log: line,
                });
            }
        });

        match child.wait() {
            Ok(status) => {
                let _ = app_clone.emit("model-download-done", ModelDownloadDone {
                    filename: fname_clone,
                    success: status.success(),
                    error: if status.success() { None } else { Some("Download failed. Check the logs for details.".to_string()) },
                });
            }
            Err(e) => {
                let _ = app_clone.emit("model-download-done", ModelDownloadDone {
                    filename: fname_clone,
                    success: false,
                    error: Some(e.to_string()),
                });
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub fn delete_ai_model(app: tauri::AppHandle, filename: String) -> Result<(), String> {
    if filename.contains('/') || filename.contains('\\') || filename.contains("..") {
        return Err("Invalid filename".to_string());
    }

    let models_dir = get_models_dir(&app);
    let target = models_dir.join(&filename);
    if target.exists() {
        std::fs::remove_file(&target).map_err(|e| format!("Failed to delete model file: {}", e))?;
    }

    let custom_file = models_dir.join("custom_models.json");
    if custom_file.exists() {
        if let Ok(content) = std::fs::read_to_string(&custom_file) {
            if let Ok(mut list) = serde_json::from_str::<Vec<CustomModelMetadata>>(&content) {
                list.retain(|m| m.filename != filename);
                let _ = std::fs::write(&custom_file, serde_json::to_string_pretty(&list).unwrap_or_default());
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub fn import_custom_model(
    app: tauri::AppHandle,
    source_path: String,
    custom_name: String,
    model_type: String,
    stems: Vec<String>,
) -> Result<InstalledModel, String> {
    let src = std::path::PathBuf::from(&source_path);
    if !src.exists() || !src.is_file() {
        return Err("Selected source file does not exist".to_string());
    }

    let file_name = src
        .file_name()
        .ok_or_else(|| "Invalid source file path".to_string())?
        .to_string_lossy()
        .to_string();

    let lower = file_name.to_lowercase();
    if !lower.ends_with(".onnx") && !lower.ends_with(".pth") && !lower.ends_with(".ckpt") && !lower.ends_with(".yaml") {
        return Err("Unsupported model file format. Allowed: .onnx, .pth, .ckpt, .yaml".to_string());
    }

    let models_dir = get_models_dir(&app);
    let dest = models_dir.join(&file_name);

    std::fs::copy(&src, &dest).map_err(|e| format!("Failed to copy model file: {}", e))?;

    let metadata = dest.metadata().map_err(|e| e.to_string())?;
    let size_bytes = metadata.len();
    let modified_time = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let custom_file = models_dir.join("custom_models.json");
    let mut list: Vec<CustomModelMetadata> = Vec::new();
    if custom_file.exists() {
        if let Ok(content) = std::fs::read_to_string(&custom_file) {
            if let Ok(existing) = serde_json::from_str::<Vec<CustomModelMetadata>>(&content) {
                list = existing;
            }
        }
    }

    list.retain(|m| m.filename != file_name);
    list.push(CustomModelMetadata {
        filename: file_name.clone(),
        friendly_name: custom_name.clone(),
        model_type: model_type.clone(),
        stems: stems.clone(),
    });

    let _ = std::fs::write(&custom_file, serde_json::to_string_pretty(&list).unwrap_or_default());

    Ok(InstalledModel {
        filename: file_name,
        size_bytes,
        modified_time,
        is_custom: true,
        custom_name: Some(custom_name),
        custom_type: Some(model_type),
        custom_stems: Some(stems),
    })
}

#[tauri::command]
pub fn open_models_directory(app: tauri::AppHandle) -> Result<(), String> {
    let models_dir = get_models_dir(&app);
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&models_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&models_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&models_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
