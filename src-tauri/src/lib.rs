use tauri::webview::PageLoadEvent;
use tauri_plugin_log::{Target, TargetKind};
use tauri_plugin_opener::OpenerExt;
// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

use std::io::{BufRead, BufReader, Cursor};
use std::process::Stdio;
use tauri::{Emitter, Manager};
use zip::ZipArchive;
use futures_util::StreamExt;

#[derive(serde::Serialize, Clone)]
struct ProgressPayload {
    item: String,
    progress: u8,
}

async fn download_file_with_progress(
    app: &tauri::AppHandle,
    url: &str,
    item_name: &str,
) -> Result<Vec<u8>, String> {
    app.emit("setup-progress", ProgressPayload { item: item_name.to_string(), progress: 0 }).unwrap_or(());
    
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36")
        .build()
        .map_err(|e| e.to_string())?;
        
    let res = client.get(url).send().await.map_err(|e| e.to_string())?;
    
    if !res.status().is_success() {
        return Err(format!("Download failed with status: {}", res.status()));
    }
    
    let total_size = res.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut stream = res.bytes_stream();
    let mut bytes = Vec::new();
    let mut last_percent = 0;

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        bytes.extend_from_slice(&chunk);
        
        if total_size > 0 {
            let percent = ((downloaded as f64 / total_size as f64) * 100.0) as u8;
            if percent > last_percent {
                last_percent = percent;
                let _ = app.emit("setup-progress", ProgressPayload {
                    item: item_name.to_string(),
                    progress: percent,
                });
            }
        } else {
            let percent = std::cmp::min((downloaded / 500_000) as u8, 99);
            if percent > last_percent {
                last_percent = percent;
                let _ = app.emit("setup-progress", ProgressPayload {
                    item: item_name.to_string(),
                    progress: percent,
                });
            }
        }
    }
    
    let _ = app.emit("setup-progress", ProgressPayload { item: item_name.to_string(), progress: 100 });
    Ok(bytes)
}

use serde::{Deserialize, Serialize};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x08000000;

trait CommandExtForWindows {
    fn hide_window(self) -> Self;
}

impl CommandExtForWindows for std::process::Command {
    #[cfg(target_os = "windows")]
    fn hide_window(mut self) -> Self {
        self.creation_flags(CREATE_NO_WINDOW);
        self
    }

    #[cfg(not(target_os = "windows"))]
    fn hide_window(self) -> Self {
        self
    }
}

#[derive(Serialize, Deserialize, Default)]
struct AppSettings {
    download_dir: String,
    filename_template: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct StorageDirs {
    pub base_dir: String,
    pub library_dir: String,
    pub extractor_dir: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct StorageFileItem {
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
    pub modified_time: u64,
    pub category: String, // "download" | "stem"
    pub extension: String,
    pub stem_type: Option<String>,
    pub parent_group: Option<String>,
}

fn get_settings_path(app: &tauri::AppHandle) -> std::path::PathBuf {
    app.path()
        .app_local_data_dir()
        .unwrap()
        .join("settings.json")
}

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
fn get_settings(app: tauri::AppHandle) -> Result<AppSettings, String> {
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

    // Default
    let mut default_settings = AppSettings::default();
    default_settings.download_dir = default_base_dir;
    default_settings.filename_template = Some("%(title)s.%(ext)s".to_string());

    Ok(default_settings)
}

#[derive(Serialize, Deserialize)]
#[allow(dead_code)]
struct VideoInfo {
    id: String,
    title: String,
    thumbnail: String,
    duration: Option<f64>,
}

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

#[tauri::command]
async fn get_video_info(app: tauri::AppHandle, url: String) -> Result<String, String> {
    let app_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let ytdlp_path = if cfg!(target_os = "windows") {
        app_dir.join("yt-dlp.exe")
    } else {
        app_dir.join("yt-dlp")
    };

    let output = std::process::Command::new(&ytdlp_path)
        .hide_window()
        .arg("--dump-json")
        .arg("--no-warnings")
        .arg(&url)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(err);
    }

    let json_str = String::from_utf8_lossy(&output.stdout).to_string();
    Ok(json_str)
}

#[tauri::command]
fn get_download_dir(app: tauri::AppHandle) -> Result<String, String> {
    Ok(get_storage_dirs_internal(&app).library_dir)
}

#[tauri::command]
fn get_storage_dirs(app: tauri::AppHandle) -> Result<StorageDirs, String> {
    Ok(get_storage_dirs_internal(&app))
}

#[tauri::command]
fn open_storage_folder(app: tauri::AppHandle, folder_type: String) -> Result<(), String> {
    let dirs = get_storage_dirs_internal(&app);
    let target = match folder_type.as_str() {
        "library" => dirs.library_dir,
        "extractor" => dirs.extractor_dir,
        _ => dirs.base_dir,
    };

    if !target.is_empty() {
        let _ = std::fs::create_dir_all(&target);
        #[cfg(target_os = "windows")]
        std::process::Command::new("explorer")
            .hide_window()
            .arg(&target)
            .spawn()
            .map_err(|e| e.to_string())?;

        #[cfg(target_os = "macos")]
        std::process::Command::new("open")
            .hide_window()
            .arg(&target)
            .spawn()
            .map_err(|e| e.to_string())?;

        #[cfg(target_os = "linux")]
        std::process::Command::new("xdg-open")
            .hide_window()
            .arg(&target)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn open_download_folder(app: tauri::AppHandle) -> Result<(), String> {
    open_storage_folder(app, "library".to_string())
}

fn scan_folder_recursive(dir_path: &std::path::Path, category: &str, depth: usize, items: &mut Vec<StorageFileItem>) {
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
fn list_storage_files(app: tauri::AppHandle) -> Result<Vec<StorageFileItem>, String> {
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
                            items.push(StorageFileItem {
                                name,
                                path: full_path_str,
                                size_bytes,
                                modified_time,
                                category: "download".to_string(),
                                extension: ext,
                                stem_type: None,
                                parent_group: None,
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
fn delete_storage_file(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if p.exists() && p.is_file() {
        std::fs::remove_file(p).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn set_download_dir(app: tauri::AppHandle, dir: String) -> Result<(), String> {
    let mut settings = get_settings(app.clone())?;
    settings.download_dir = dir;
    let json = serde_json::to_string(&settings).map_err(|e| e.to_string())?;
    std::fs::write(get_settings_path(&app), json).map_err(|e| e.to_string())?;
    // Pre-create library and extractor in new base dir
    let _ = get_storage_dirs_internal(&app);
    Ok(())
}

#[tauri::command]
fn set_filename_template(app: tauri::AppHandle, template: String) -> Result<(), String> {
    let mut settings = get_settings(app.clone())?;
    settings.filename_template = Some(template);
    let json = serde_json::to_string(&settings).map_err(|e| e.to_string())?;
    std::fs::write(get_settings_path(&app), json).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn setup_dependencies(app: tauri::AppHandle) -> Result<(), String> {
    let app_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;

    let ytdlp_path = if cfg!(target_os = "windows") {
        app_dir.join("yt-dlp.exe")
    } else {
        app_dir.join("yt-dlp")
    };
    let ffmpeg_path = if cfg!(target_os = "windows") {
        app_dir.join("ffmpeg.exe")
    } else {
        app_dir.join("ffmpeg")
    };

    // Auto download yt-dlp
    if !ytdlp_path.exists() {
        app.emit("setup-log", "Downloading yt-dlp...").unwrap();
        let download_url = if cfg!(target_os = "windows") {
            "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
        } else if cfg!(target_os = "macos") {
            "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos"
        } else {
            "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp"
        };
        let bytes = download_file_with_progress(&app, download_url, "yt-dlp").await?;
        std::fs::write(&ytdlp_path, bytes).map_err(|e| e.to_string())?;

        #[cfg(unix)]
        {
            let mut perms = std::fs::metadata(&ytdlp_path)
                .map_err(|e| e.to_string())?
                .permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&ytdlp_path, perms).map_err(|e| e.to_string())?;
        }

        app.emit("setup-log", "yt-dlp downloaded.").unwrap();
    }

    // Auto download ffmpeg
    let needs_ffmpeg = !ffmpeg_path.exists()
        || std::fs::metadata(&ffmpeg_path)
            .map(|m| m.len())
            .unwrap_or(0)
            == 0;
    if needs_ffmpeg {
        if cfg!(target_os = "windows") {
            app.emit(
                "setup-log",
                "Downloading ffmpeg (required for audio extraction and HD video)...",
            )
            .unwrap();
            let bytes = download_file_with_progress(&app, "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip", "ffmpeg").await?;

            app.emit("setup-log", "Extracting ffmpeg...").unwrap();
            let reader = Cursor::new(bytes);
            let mut archive = ZipArchive::new(reader).map_err(|e| e.to_string())?;

            for i in 0..archive.len() {
                let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
                let out_name = file.name().to_string();
                if out_name.ends_with("ffmpeg.exe") {
                    let mut outfile =
                        std::fs::File::create(&ffmpeg_path).map_err(|e| e.to_string())?;
                    std::io::copy(&mut file, &mut outfile).map_err(|e| e.to_string())?;
                } else if out_name.ends_with("ffprobe.exe") {
                    let mut outfile = std::fs::File::create(app_dir.join("ffprobe.exe"))
                        .map_err(|e| e.to_string())?;
                    std::io::copy(&mut file, &mut outfile).map_err(|e| e.to_string())?;
                }
            }
            app.emit("setup-log", "ffmpeg installed.").unwrap();
        } else {
            app.emit("setup-log", "Downloading ffmpeg for macOS/Linux...")
                .unwrap();
            let target_os = if cfg!(target_os = "macos") {
                "darwin"
            } else {
                "linux"
            };
            let target_arch = if cfg!(target_arch = "aarch64") {
                "arm64"
            } else {
                "x64"
            };
            let url = format!(
                "https://github.com/eugeneware/ffmpeg-static/releases/download/b5.0.1/{}-{}",
                target_os, target_arch
            );

            let bytes = download_file_with_progress(&app, &url, "ffmpeg").await?;

            std::fs::write(&ffmpeg_path, bytes).map_err(|e| e.to_string())?;

            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mut perms = std::fs::metadata(&ffmpeg_path).unwrap().permissions();
                perms.set_mode(0o755);
                let _ = std::fs::set_permissions(&ffmpeg_path, perms);
            }
            app.emit("setup-log", "ffmpeg installed.").unwrap();

            if cfg!(target_os = "macos") {
                app.emit("setup-log", "Downloading ffprobe for macOS...").unwrap();
                let ffprobe_url = "https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v6.1/ffprobe-6.1-macos-64.zip";
                match download_file_with_progress(&app, ffprobe_url, "ffprobe").await {
                    Ok(bytes) => {
                        match zip::ZipArchive::new(std::io::Cursor::new(bytes)) {
                            Ok(mut archive) => {
                                for i in 0..archive.len() {
                                    if let Ok(mut file) = archive.by_index(i) {
                                        if file.name() == "ffprobe" {
                                            let ffprobe_path = app_dir.join("ffprobe");
                                            if let Ok(mut outfile) = std::fs::File::create(&ffprobe_path) {
                                                let _ = std::io::copy(&mut file, &mut outfile);
                                                #[cfg(unix)]
                                                {
                                                    use std::os::unix::fs::PermissionsExt;
                                                    if let Ok(meta) = std::fs::metadata(&ffprobe_path) {
                                                        let mut perms = meta.permissions();
                                                        perms.set_mode(0o755);
                                                        let _ = std::fs::set_permissions(&ffprobe_path, perms);
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                                app.emit("setup-log", "ffprobe installed.").unwrap();
                            },
                            Err(e) => {
                                app.emit("setup-log", format!("Failed to extract ffprobe: {}", e)).unwrap();
                            }
                        }
                    },
                    Err(e) => {
                        app.emit("setup-log", format!("Failed to download ffprobe: {}", e)).unwrap();
                    }
                }
            }
        }
    }

    // Check for updates
    app.emit("setup-log", "Checking for yt-dlp updates...")
        .unwrap();
    let _ = std::process::Command::new(&ytdlp_path)
        .hide_window()
        .arg("-U")
        .status();

    app.emit("setup-log", "All dependencies are ready.")
        .unwrap();
    Ok(())
}

#[tauri::command]
async fn run_ytdlp(
    app: tauri::AppHandle,
    id: String,
    url: String,
    format: String,
    quality: String,
) -> Result<(), String> {
    let app_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let ytdlp_path = if cfg!(target_os = "windows") {
        app_dir.join("yt-dlp.exe")
    } else {
        app_dir.join("yt-dlp")
    };

    app.emit("ytdlp-log", format!("Starting download for {}...", id))
        .unwrap();

    let url_clone = url.clone();
    let format_clone = format.clone();
    let quality_clone = quality.clone();
    let app_clone = app.clone();
    let app_clone2 = app.clone();
    let ffmpeg_dir = app_dir.to_str().unwrap().to_string();
    let id_clone = id.clone();

    // Get download directory
    let target_dir = get_download_dir(app.clone()).unwrap_or_default();
    let target_dir_clone = target_dir.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = std::process::Command::new(&ytdlp_path).hide_window();

        // Change working directory to target_dir so files are saved there
        if !target_dir_clone.is_empty() {
            cmd.current_dir(&target_dir_clone);
        }

        // Use JSON progress template for easier frontend parsing
        let progress_template = r#"{"progress": "%(progress._percent_str)s", "speed": "%(progress._speed_str)s", "eta": "%(progress._eta_str)s", "downloaded": "%(progress._downloaded_bytes_str)s", "total": "%(progress._total_bytes_str)s"}"#;

        cmd.arg("--newline");
        cmd.arg("--progress-template").arg(progress_template);

        // Always specify ffmpeg-location since we download it for all OS
        cmd.arg("--ffmpeg-location").arg(&ffmpeg_dir);

        #[cfg(unix)]
        {
            let current_path = std::env::var("PATH").unwrap_or_default();
            let new_path = format!("{}:{}:/opt/homebrew/bin:/usr/local/bin", ffmpeg_dir, current_path);
            cmd.env("PATH", new_path);
        }

        let settings = get_settings(app_clone2).unwrap_or_default();
        if let Some(template) = settings.filename_template {
            if !template.is_empty() {
                cmd.arg("-o").arg(template);
            }
        }

        if format_clone == "mp3" {
            cmd.arg("-x").arg("--audio-format").arg("mp3");
            if quality_clone != "best" {
                cmd.arg("--audio-quality").arg(&quality_clone);
            }
        } else {
            // Video format
            if quality_clone == "best" {
                cmd.arg("-f")
                    .arg("bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best");
            } else {
                let height = quality_clone.replace("p", "");
                let f_arg = format!("bestvideo[ext=mp4][height<={}]+bestaudio[ext=m4a]/best[ext=mp4][height<={}]/best", height, height);
                cmd.arg("-f").arg(&f_arg);
            }
            cmd.arg("--merge-output-format").arg("mp4");
        }

        cmd.arg(&url_clone);

        let mut child = match cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).spawn() {
            Ok(c) => c,
            Err(e) => {
                let _ = app_clone.emit("ytdlp-log", format!("Error: {}", e));
                return;
            }
        };

        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();

        let app_stdout = app_clone.clone();
        let id_stdout = id_clone.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                if let Ok(line) = line {
                    if line.starts_with('{') && line.ends_with('}') {
                        // Forward JSON progress string + ID to frontend
                        #[derive(Serialize, Clone)]
                        struct ProgressPayload<'a> {
                            id: &'a str,
                            data: &'a str,
                        }
                        let _ = app_stdout.emit(
                            "ytdlp-progress",
                            ProgressPayload {
                                id: &id_stdout,
                                data: &line,
                            },
                        );
                    } else {
                        if line.contains("Destination: ") {
                            if let Some(path_str) = line.split("Destination: ").last() {
                                let path = path_str.trim().trim_matches('"');
                                let full_path = std::path::Path::new(&target_dir_clone).join(path);
                                #[derive(Serialize, Clone)]
                                struct PathPayload<'a> {
                                    id: &'a str,
                                    path: String,
                                }
                                let _ = app_stdout.emit(
                                    "ytdlp-filepath",
                                    PathPayload { id: &id_stdout, path: full_path.to_string_lossy().to_string() },
                                );
                            }
                        } else if line.contains("Merging formats into ") {
                            if let Some(path_str) = line.split("Merging formats into ").last() {
                                let path = path_str.trim().trim_matches('"');
                                let full_path = std::path::Path::new(&target_dir_clone).join(path);
                                #[derive(Serialize, Clone)]
                                struct PathPayload<'a> {
                                    id: &'a str,
                                    path: String,
                                }
                                let _ = app_stdout.emit(
                                    "ytdlp-filepath",
                                    PathPayload { id: &id_stdout, path: full_path.to_string_lossy().to_string() },
                                );
                            }
                        } else if line.contains("has already been downloaded") {
                            if let Some(prefix) = line.split("has already been downloaded").next() {
                                let filename = prefix.replace("[download]", "").trim().to_string();
                                let full_path = std::path::Path::new(&target_dir_clone).join(&filename);
                                #[derive(Serialize, Clone)]
                                struct PathPayload<'a> {
                                    id: &'a str,
                                    path: String,
                                }
                                let _ = app_stdout.emit(
                                    "ytdlp-filepath",
                                    PathPayload { id: &id_stdout, path: full_path.to_string_lossy().to_string() },
                                );
                            }
                        }
                        let _ = app_stdout.emit("ytdlp-log", line);
                    }
                }
            }
        });

        let app_stderr = app_clone.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                if let Ok(line) = line {
                    let _ = app_stderr.emit("ytdlp-log", line);
                }
            }
        });

        if let Ok(_status) = child.wait() {
            let _ = app_clone.emit("ytdlp-done", id_clone);
        }
    });

    Ok(())
}

#[tauri::command]
async fn setup_stem_extractor(app: tauri::AppHandle) -> Result<(), String> {
    let app_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let venv_dir = app_dir.join("venv");

    let separator_path = if cfg!(target_os = "windows") {
        venv_dir.join("Scripts").join("audio-separator.exe")
    } else {
        venv_dir.join("bin").join("audio-separator")
    };

    let python_dir = app_dir.join("python");
    let python_exe_path = if cfg!(target_os = "windows") {
        python_dir.join("python").join("python.exe")
    } else {
        python_dir.join("python").join("bin").join("python3")
    };

    // Auto download standalone python if not exists
    if !python_dir.exists() {
        app.emit(
            "stem-log",
            "Downloading standalone Python environment (approx 35MB)...",
        )
        .unwrap();
        let python_url = if cfg!(target_os = "windows") {
            "https://github.com/indygreg/python-build-standalone/releases/download/20240107/cpython-3.11.7+20240107-x86_64-pc-windows-msvc-shared-install_only.tar.gz"
        } else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
            "https://github.com/indygreg/python-build-standalone/releases/download/20240107/cpython-3.11.7+20240107-aarch64-apple-darwin-install_only.tar.gz"
        } else if cfg!(target_os = "macos") {
            "https://github.com/indygreg/python-build-standalone/releases/download/20240107/cpython-3.11.7+20240107-x86_64-apple-darwin-install_only.tar.gz"
        } else {
            "https://github.com/indygreg/python-build-standalone/releases/download/20240107/cpython-3.11.7+20240107-x86_64-unknown-linux-gnu-install_only.tar.gz"
        };

        let bytes = download_file_with_progress(&app, python_url, "python").await?;

        let tar_path = app_dir.join("python.tar.gz");
        std::fs::write(&tar_path, bytes).map_err(|e| e.to_string())?;

        app.emit("stem-log", "Extracting Python environment...")
            .unwrap();
        std::fs::create_dir_all(&python_dir).map_err(|e| e.to_string())?;

        let mut tar_cmd = std::process::Command::new("tar").hide_window();
        tar_cmd
            .arg("-xzf")
            .arg(&tar_path)
            .arg("-C")
            .arg(&python_dir);
        let tar_status = tar_cmd
            .status()
            .map_err(|e| format!("Failed to run tar command: {}", e))?;

        if !tar_status.success() {
            return Err("Failed to extract standalone Python.".to_string());
        }

        let _ = std::fs::remove_file(&tar_path);
        app.emit("stem-log", "Standalone Python environment is ready.")
            .unwrap();
    }

    // Check if audio-separator is installed
    if !separator_path.exists() {
        app.emit(
            "stem-log",
            "Creating Python Virtual Environment... This may take a while.",
        )
        .unwrap();

        if !venv_dir.exists() {
            let status = std::process::Command::new(&python_exe_path)
                .hide_window()
                .arg("-m")
                .arg("venv")
                .arg(&venv_dir)
                .status()
                .map_err(|e| e.to_string())?;

            if !status.success() {
                return Err(
                    "Failed to create Python virtual environment with standalone Python."
                        .to_string(),
                );
            }
        }

        app.emit(
            "stem-log",
            "Installing audio-separator... This will download AI libraries (approx 2GB).",
        )
        .unwrap();

        let pip_path = if cfg!(target_os = "windows") {
            venv_dir.join("Scripts").join("pip.exe")
        } else {
            venv_dir.join("bin").join("pip")
        };

        // 1. Uninstall CPU version of onnxruntime if it exists to prevent conflicts
        let mut cmd_rm = std::process::Command::new(&pip_path).hide_window();
        cmd_rm.arg("uninstall").arg("-y").arg("onnxruntime");
        let _ = cmd_rm.status();

        // 2. Install PyTorch with or without CUDA
        let mut cmd_torch = std::process::Command::new(&pip_path).hide_window();
        if cfg!(target_os = "windows") {
            app.emit("stem-log", "Installing PyTorch with CUDA (approx 2.5GB)...")
                .unwrap();
            cmd_torch
                .arg("install")
                .arg("torch")
                .arg("torchvision")
                .arg("torchaudio")
                .arg("--index-url")
                .arg("https://download.pytorch.org/whl/cu124")
                .arg("--prefer-binary")
                .arg("--upgrade");
        } else {
            app.emit("stem-log", "Installing PyTorch (approx 1GB)...")
                .unwrap();
            cmd_torch
                .arg("install")
                .arg("torch")
                .arg("torchvision")
                .arg("torchaudio")
                .arg("--prefer-binary")
                .arg("--upgrade");
        }

        let mut child_torch = cmd_torch
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| e.to_string())?;

        let stdout_torch = child_torch.stdout.take().unwrap();
        let stderr_torch = child_torch.stderr.take().unwrap();

        let app_torch = app.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout_torch);
            for line in reader.lines() {
                if let Ok(line) = line {
                    let _ = app_torch.emit("stem-log", line);
                }
            }
        });

        let app_torch_err = app.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr_torch);
            for line in reader.lines() {
                if let Ok(line) = line {
                    let _ = app_torch_err.emit("stem-log", line);
                }
            }
        });

        let status_torch = child_torch.wait().map_err(|e| e.to_string())?;
        if !status_torch.success() {
            return Err("Failed to install PyTorch. Check the logs for details.".to_string());
        }

        // 3. Install audio-separator and onnxruntime
        let mut cmd = std::process::Command::new(&pip_path).hide_window();
        if cfg!(target_os = "windows") {
            app.emit(
                "stem-log",
                "Installing audio-separator and ONNX Runtime DirectML...",
            )
            .unwrap();
            cmd.arg("install")
                .arg("audio-separator")
                .arg("audioread")
                .arg("onnxruntime-directml")
                .arg("--prefer-binary")
                .arg("--upgrade")
                .arg("--no-warn-script-location");
        } else {
            app.emit("stem-log", "Installing audio-separator and ONNX Runtime...")
                .unwrap();
            cmd.arg("install")
                .arg("audio-separator")
                .arg("audioread")
                .arg("onnxruntime")
                .arg("--prefer-binary")
                .arg("--upgrade")
                .arg("--no-warn-script-location");
        }

        let mut child = cmd
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| e.to_string())?;

        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();

        let app_clone = app.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                if let Ok(line) = line {
                    let _ = app_clone.emit("stem-log", line);
                }
            }
        });

        let app_clone_err = app.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                if let Ok(line) = line {
                    let _ = app_clone_err.emit("stem-log", line);
                }
            }
        });

        let status = child.wait().map_err(|e| e.to_string())?;
        if !status.success() {
            return Err("Failed to install audio-separator.".to_string());
        }
    }

    let venv_python = if cfg!(target_os = "windows") {
        venv_dir.join("Scripts").join("python.exe")
    } else {
        venv_dir.join("bin").join("python")
    };
    ensure_separator_dml_patch(&venv_python);

    app.emit("stem-log", "STEM Extractor is ready!").unwrap();
    Ok(())
}

fn ensure_separator_dml_patch(python_path: &std::path::Path) {
    #[cfg(target_os = "windows")]
    {
        let script = r#"
try:
    import inspect, audio_separator.separator.separator as s
    path = inspect.getfile(s)
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    old = 'if "CUDAExecutionProvider" in ort_providers:\n            self.logger.info("ONNXruntime has CUDAExecutionProvider available, enabling acceleration")\n            self.onnx_execution_provider = ["CUDAExecutionProvider"]'
    new = 'if "CUDAExecutionProvider" in ort_providers:\n            self.logger.info("ONNXruntime has CUDAExecutionProvider available, enabling acceleration")\n            self.onnx_execution_provider = ["CUDAExecutionProvider"]\n        elif "DmlExecutionProvider" in ort_providers:\n            self.logger.info("ONNXruntime has DmlExecutionProvider available, enabling acceleration")\n            self.onnx_execution_provider = ["DmlExecutionProvider"]'
    if old in content and new not in content:
        content = content.replace(old, new, 1)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)
except Exception:
    pass
"#;
        let _ = std::process::Command::new(python_path)
            .hide_window()
            .arg("-c")
            .arg(script)
            .output();
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct StemExtractResult {
    pub success: bool,
    pub input_file: String,
    pub output_files: Vec<String>,
}

#[tauri::command]
async fn run_stem_extractor(
    app: tauri::AppHandle,
    input_file: String,
    model: String,
    output_format: String,
    use_gpu: bool,
    overlap: Option<String>,
    segment_size: Option<String>,
    low_memory: Option<bool>,
) -> Result<(), String> {
    let app_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let venv_dir = app_dir.join("venv");

    let separator_path = if cfg!(target_os = "windows") {
        venv_dir.join("Scripts").join("audio-separator.exe")
    } else {
        venv_dir.join("bin").join("audio-separator")
    };

    let python_path = if cfg!(target_os = "windows") {
        venv_dir.join("Scripts").join("python.exe")
    } else {
        venv_dir.join("bin").join("python")
    };

    if !separator_path.exists() {
        return Err("audio-separator not found. Please wait for setup to complete.".to_string());
    }

    ensure_separator_dml_patch(&python_path);

    let target_dir = get_storage_dirs_internal(&app).extractor_dir;
    let models_dir = get_models_dir(&app);

    app.emit(
        "stem-extract-log",
        format!("Starting extraction with model {}...", model),
    )
    .unwrap();

    let app_clone = app.clone();
    let app_dir_clone = app_dir.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let start_time = std::time::SystemTime::now();
        let out_dir = if target_dir.is_empty() {
            std::env::current_dir().unwrap_or_default()
        } else {
            std::path::PathBuf::from(&target_dir)
        };
        let input_file_path = std::path::PathBuf::from(&input_file);
        let input_stem = input_file_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_string();

        let mut cmd = std::process::Command::new(&separator_path).hide_window();

        // Add ffmpeg to PATH so audio-separator can find it
        let current_path = std::env::var("PATH").unwrap_or_default();
        #[cfg(target_os = "windows")]
        let new_path = format!("{};{}", app_dir_clone.to_string_lossy(), current_path);
        #[cfg(not(target_os = "windows"))]
        let new_path = format!("{}:{}:/opt/homebrew/bin:/usr/local/bin", app_dir_clone.to_string_lossy(), current_path);

        cmd.env("PATH", new_path);
        cmd.env("PYTHONUNBUFFERED", "1");

        // Memory optimization: prevent CPU thread explosion across all logical cores
        cmd.env("OMP_NUM_THREADS", "4");
        cmd.env("MKL_NUM_THREADS", "4");
        cmd.env("OPENBLAS_NUM_THREADS", "4");
        cmd.env("NUMEXPR_NUM_THREADS", "4");
        cmd.env("VECLIB_MAXIMUM_THREADS", "4");

        // Prevent PyTorch CUDA memory fragmentation on 4GB-8GB GPUs
        cmd.env("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True");
        
        #[cfg(not(target_os = "windows"))]
        {
            // Fix for "invalid buffer size" and memory issues on Apple Silicon (M1/M2/M3/M4)
            cmd.env("PYTORCH_MPS_HIGH_WATERMARK_RATIO", "0.0");
            cmd.env("PYTORCH_ENABLE_MPS_FALLBACK", "1");
            cmd.env("COREML_ENABLE_STRICT_SHAPES", "1");
        }

        cmd.arg(&input_file);
        cmd.arg("--model_filename").arg(&model);
        cmd.arg("--output_format").arg(&output_format);

        let is_low_mem = low_memory.unwrap_or(true);

        // Enforce batch size 1 across all architectures to dramatically reduce RAM/VRAM footprint
        cmd.arg("--mdxc_batch_size").arg("1");
        cmd.arg("--mdx_batch_size").arg("1");
        cmd.arg("--vr_batch_size").arg("1");

        // Chunk long audio files into smaller durations to keep memory flat regardless of song length
        if is_low_mem {
            cmd.arg("--chunk_duration").arg("300"); // 5-minute chunks
        } else {
            cmd.arg("--chunk_duration").arg("600"); // 10-minute chunks
        }

        let model_lower = model.to_lowercase();
        let is_demucs = model_lower.contains("demucs") || (model_lower.ends_with(".yaml") && !model_lower.contains("roformer") && !model_lower.contains("bs_") && !model_lower.contains("mel_band"));

        if let Some(overlap_val) = &overlap {
            let overlap_float = match overlap_val.as_str() {
                "2" => "0.2",
                "4" => "0.25",
                "6" => "0.5",
                "8" => "0.75",
                "10" => "0.99",
                other => other,
            };

            cmd.arg("--mdx_overlap").arg(overlap_float);
            cmd.arg("--demucs_overlap").arg(overlap_float);
            cmd.arg("--mdxc_overlap").arg(overlap_val);

            // In Demucs, shifts = number of full repeated passes with random shifts.
            // Do NOT use overlap_val directly for shifts, as 4 or 6 shifts multiplies Demucs RAM 4x!
            let shifts = if is_low_mem {
                "1"
            } else {
                match overlap_val.as_str() {
                    "2" => "1",
                    "4" => "2",
                    "6" | "8" | "10" => "2",
                    _ => "2",
                }
            };
            cmd.arg("--demucs_shifts").arg(shifts);
        } else {
            let shifts = if is_low_mem { "1" } else { "2" };
            cmd.arg("--demucs_shifts").arg(shifts);
        }

        if let Some(segment_val) = &segment_size {
            cmd.arg("--mdx_segment_size").arg(segment_val);
            cmd.arg("--mdxc_segment_size").arg(segment_val);

            if is_low_mem {
                cmd.arg("--mdxc_override_model_segment_size");
            }

            // Demucs segment size is in SECONDS (not FFT frames 128/256/512/1024)!
            // Blindly passing 256 or 512 caused Demucs to allocate 4-8.5 minute tensors in RAM at once!
            if is_demucs {
                if is_low_mem {
                    cmd.arg("--demucs_segment_size").arg("20");
                } else {
                    cmd.arg("--demucs_segment_size").arg("Default");
                }
            }
        } else if is_demucs {
            if is_low_mem {
                cmd.arg("--demucs_segment_size").arg("20");
            } else {
                cmd.arg("--demucs_segment_size").arg("Default");
            }
        }

        if is_demucs {
            cmd.arg("--demucs_segments_enabled").arg("True");
        }

        if use_gpu {
            if cfg!(target_os = "windows") {
                cmd.arg("--use_directml");
            }
            #[cfg(not(target_os = "macos"))]
            {
                // Use PyTorch FP16 autocast to halve intermediate activation memory on GPU
                cmd.arg("--use_autocast");
            }
        }

        cmd.arg("--model_file_dir").arg(&models_dir);

        if !target_dir.is_empty() {
            cmd.arg("--output_dir").arg(&target_dir);
        }

        let mut child = match cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).spawn() {
            Ok(c) => c,
            Err(e) => {
                let _ = app_clone.emit("stem-extract-log", format!("Error: {}", e));
                let _ = app_clone.emit("stem-extract-done", false);
                return;
            }
        };

        let logged_files: std::sync::Arc<std::sync::Mutex<Vec<String>>> =
            std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let logged_files_out = logged_files.clone();
        let logged_files_err = logged_files.clone();

        let stdout = child.stdout.take().unwrap();
        let app_stdout = app_clone.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                if let Ok(line) = line {
                    if let Some(pos) = line.find("Exported audio file successfully to ") {
                        let rest = &line[pos + "Exported audio file successfully to ".len()..];
                        let file_path = if let Some(idx) = rest.find(" with ") {
                            rest[..idx].trim()
                        } else {
                            rest.trim()
                        };
                        if !file_path.is_empty() {
                            if let Ok(mut list) = logged_files_out.lock() {
                                list.push(file_path.to_string());
                            }
                        }
                    }
                    let _ = app_stdout.emit("stem-extract-log", line);
                }
            }
        });

        let stderr = child.stderr.take().unwrap();
        let app_stderr = app_clone.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                if let Ok(line) = line {
                    if let Some(pos) = line.find("Exported audio file successfully to ") {
                        let rest = &line[pos + "Exported audio file successfully to ".len()..];
                        let file_path = if let Some(idx) = rest.find(" with ") {
                            rest[..idx].trim()
                        } else {
                            rest.trim()
                        };
                        if !file_path.is_empty() {
                            if let Ok(mut list) = logged_files_err.lock() {
                                list.push(file_path.to_string());
                            }
                        }
                    }
                    let _ = app_stderr.emit("stem-extract-log", line);
                }
            }
        });

        let success = match child.wait() {
            Ok(status) => status.success(),
            Err(_) => false,
        };

        let mut output_files: Vec<String> = Vec::new();

        if success {
            if let Ok(list) = logged_files.lock() {
                for path_str in list.iter() {
                    let p = std::path::PathBuf::from(path_str);
                    if p.exists() {
                        let canonical = p.to_string_lossy().to_string();
                        if !output_files.contains(&canonical) {
                            output_files.push(canonical);
                        }
                    }
                }
            }

            if let Ok(entries) = std::fs::read_dir(&out_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_file() {
                        if let Ok(metadata) = path.metadata() {
                            let is_recent = metadata.modified().map(|m| {
                                m >= start_time - std::time::Duration::from_secs(15)
                            }).unwrap_or(false);

                            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or_default();
                            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or_default().to_lowercase();
                            let is_audio = matches!(ext.as_str(), "flac" | "wav" | "mp3" | "ogg" | "m4a");

                            if is_audio && is_recent && (name.starts_with(&input_stem) || (name.contains("_(") && name.contains(")_"))) {
                                let full_str = path.to_string_lossy().to_string();
                                if !output_files.contains(&full_str) {
                                    output_files.push(full_str);
                                }
                            }
                        }
                    }
                }
            }

            output_files.sort();
        }

        let result = StemExtractResult {
            success,
            input_file: input_file.clone(),
            output_files,
        };

        let _ = app_clone.emit("stem-extract-result", result);
        let _ = app_clone.emit("stem-extract-done", success);
    });

    Ok(())
}

fn get_models_dir(_app: &tauri::AppHandle) -> std::path::PathBuf {
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

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct InstalledModel {
    pub filename: String,
    pub size_bytes: u64,
    pub modified_time: u64,
    pub is_custom: bool,
    pub custom_name: Option<String>,
    pub custom_type: Option<String>,
    pub custom_stems: Option<Vec<String>>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct CustomModelMetadata {
    pub filename: String,
    pub friendly_name: String,
    pub model_type: String,
    pub stems: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ModelDownloadProgress {
    pub filename: String,
    pub log: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ModelDownloadDone {
    pub filename: String,
    pub success: bool,
    pub error: Option<String>,
}

#[tauri::command]
fn get_installed_models(app: tauri::AppHandle) -> Result<Vec<InstalledModel>, String> {
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
async fn download_ai_model(app: tauri::AppHandle, filename: String) -> Result<(), String> {
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
fn delete_ai_model(app: tauri::AppHandle, filename: String) -> Result<(), String> {
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
fn import_custom_model(
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
fn open_models_directory(app: tauri::AppHandle) -> Result<(), String> {
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

fn external_navigation_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::<R>::new("external-navigation")
        .on_navigation(|webview, url| {
            let is_internal_host = matches!(
                url.host_str(),
                Some("localhost") | Some("127.0.0.1") | Some("tauri.localhost") | Some("::1")
            );

            let is_internal = url.scheme() == "tauri" || is_internal_host;

            if is_internal {
                return true;
            }

            let is_external_link = matches!(url.scheme(), "http" | "https" | "mailto" | "tel");

            if is_external_link {
                log::info!("opening external link in system browser: {}", url);
                let _ = webview.opener().open_url(url.as_str(), None::<&str>);
                return false;
            }

            true
        })
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir { file_name: None }),
                    Target::new(TargetKind::Webview),
                ])
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(external_navigation_plugin())
        .invoke_handler(tauri::generate_handler![
            greet,
            run_ytdlp,
            get_download_dir,
            open_download_folder,
            set_download_dir,
            set_filename_template,
            get_settings,
            get_storage_dirs,
            open_storage_folder,
            list_storage_files,
            delete_storage_file,
            setup_dependencies,
            get_video_info,
            setup_stem_extractor,
            run_stem_extractor,
            get_installed_models,
            download_ai_model,
            delete_ai_model,
            import_custom_model,
            open_models_directory
        ])
        .on_page_load(|webview, payload| {
            if webview.label() == "main" && matches!(payload.event(), PageLoadEvent::Finished) {
                log::info!("main webview finished loading");
                let _ = webview.window().show();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
