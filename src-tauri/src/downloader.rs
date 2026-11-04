use tauri::{Manager, Emitter};
use std::io::{BufRead, BufReader, Cursor};
use std::process::Stdio;
use std::collections::HashMap;
use std::sync::Mutex;
use zip::ZipArchive;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};

use crate::models::*;
use crate::settings::get_settings;
use crate::storage::get_download_dir;

static ACTIVE_DOWNLOADS: Mutex<Option<HashMap<String, u32>>> = Mutex::new(None);

pub async fn download_file_with_progress(
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

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[allow(dead_code)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

pub trait CommandExtForWindows {
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

/// yt-dlp writes stdout in the locale code page (cp1252 on English Windows) and silently drops
/// characters it cannot encode, so Thai/CJK titles came back as "  .mp3" and every such download
/// was reported under the same broken path. Force UTF-8 on every call whose output we parse.
const YTDLP_UTF8: [&str; 2] = ["--encoding", "utf-8"];

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
pub async fn get_video_info(app: tauri::AppHandle, url: String) -> Result<String, String> {
    let app_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let ytdlp_path = if cfg!(target_os = "windows") {
        app_dir.join("yt-dlp.exe")
    } else {
        app_dir.join("yt-dlp")
    };

    let output = std::process::Command::new(&ytdlp_path)
        .hide_window()
        .args(YTDLP_UTF8)
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
pub async fn get_playlist_info(app: tauri::AppHandle, url: String) -> Result<String, String> {
    let app_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let ytdlp_path = if cfg!(target_os = "windows") {
        app_dir.join("yt-dlp.exe")
    } else {
        app_dir.join("yt-dlp")
    };

    let output = std::process::Command::new(&ytdlp_path)
        .hide_window()
        .args(YTDLP_UTF8)
        .arg("--flat-playlist")
        .arg("--dump-single-json")
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
pub fn cancel_download(id: String) -> Result<(), String> {
    if let Ok(mut lock) = ACTIVE_DOWNLOADS.lock() {
        if let Some(map) = lock.as_mut() {
            if let Some(pid) = map.remove(&id) {
                #[cfg(target_os = "windows")]
                {
                    use std::os::windows::process::CommandExt;
                    let _ = std::process::Command::new("taskkill")
                        .creation_flags(0x08000000)
                        .args(["/F", "/T", "/PID", &pid.to_string()])
                        .status();
                }
                #[cfg(not(target_os = "windows"))]
                {
                    let _ = std::process::Command::new("kill")
                        .args(["-9", &pid.to_string()])
                        .status();
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn setup_dependencies(app: tauri::AppHandle) -> Result<(), String> {
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
                if let Ok(metadata) = std::fs::metadata(&ffmpeg_path) {
                    let mut perms = metadata.permissions();
                    perms.set_mode(0o755);
                    let _ = std::fs::set_permissions(&ffmpeg_path, perms);
                }
            }
            let _ = app.emit("setup-log", "ffmpeg installed.");

            #[cfg(unix)]
            {
                let _ = app.emit("setup-log", "Downloading ffprobe...");
                let ffprobe_url = if cfg!(target_os = "macos") {
                    "https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v6.1/ffprobe-6.1-macos-64.zip"
                } else if cfg!(target_arch = "aarch64") {
                    "https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v6.1/ffprobe-6.1-linux-arm-64.zip"
                } else {
                    "https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v6.1/ffprobe-6.1-linux-64.zip"
                };
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
                                let _ = app.emit("setup-log", "ffprobe installed.");
                            },
                            Err(e) => {
                                let _ = app.emit("setup-log", format!("Failed to extract ffprobe: {}", e));
                            }
                        }
                    },
                    Err(e) => {
                        let _ = app.emit("setup-log", format!("Failed to download ffprobe: {}", e));
                    }
                }
            }
        }
    }

    // Skip auto-update on startup to avoid long waiting times
    // app.emit("setup-log", "Checking for yt-dlp updates...")
    //     .unwrap();
    // let _ = std::process::Command::new(&ytdlp_path)
    //     .hide_window()
    //     .arg("-U")
    //     .status();

    app.emit("setup-log", "All dependencies are ready.")
        .unwrap();
    Ok(())
}

fn tool_path(app_dir: &std::path::Path, name: &str) -> std::path::PathBuf {
    if cfg!(target_os = "windows") {
        app_dir.join(format!("{}.exe", name))
    } else {
        app_dir.join(name)
    }
}

/// Runs `<tool> <arg>` and returns the first non-empty output line.
fn tool_output_line(path: &std::path::Path, arg: &str) -> Option<String> {
    if !path.exists() {
        return None;
    }
    let out = std::process::Command::new(path).hide_window().arg(arg).output().ok()?;
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .map(str::to_string)
}

#[derive(Serialize)]
pub struct ToolVersions {
    pub ytdlp: Option<String>,
    pub ffmpeg: Option<String>,
}

#[tauri::command]
pub async fn get_tool_versions(app: tauri::AppHandle) -> Result<ToolVersions, String> {
    let app_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let ffmpeg = tool_output_line(&tool_path(&app_dir, "ffmpeg"), "-version").map(|l| {
        // "ffmpeg version N-127900-ge2798d5cad-20261021 Copyright ..." -> "N-127900-ge2798d5cad-20261021"
        l.strip_prefix("ffmpeg version ")
            .and_then(|r| r.split_whitespace().next())
            .unwrap_or(&l)
            .to_string()
    });
    Ok(ToolVersions {
        ytdlp: tool_output_line(&tool_path(&app_dir, "yt-dlp"), "--version"),
        ffmpeg,
    })
}

/// Checks GitHub for a newer yt-dlp and installs it if found. `yt-dlp -U` verifies the
/// download against the release's SHA2-256SUMS and swaps the binary itself.
#[tauri::command]
pub async fn update_ytdlp(app: tauri::AppHandle) -> Result<String, String> {
    let app_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let path = tool_path(&app_dir, "yt-dlp");
    if !path.exists() {
        return Err("yt-dlp is not installed yet. Restart the app to run the initial setup.".into());
    }
    let out = tauri::async_runtime::spawn_blocking(move || {
        std::process::Command::new(&path).hide_window().arg("-U").output()
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    let text = format!(
        "{}\n{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    // Last line is the summary: "Updated yt-dlp to ..." or "yt-dlp is up to date (...)"
    let summary = text
        .lines()
        .map(str::trim)
        .rfind(|l| !l.is_empty())
        .unwrap_or("No output from yt-dlp")
        .to_string();
    if out.status.success() {
        log::info!("yt-dlp -U: {}", summary);
        Ok(summary)
    } else {
        log::error!("yt-dlp -U failed: {}", text);
        Err(summary)
    }
}

#[derive(Deserialize)]
struct GhAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Deserialize)]
struct GhRelease {
    tag_name: String,
    assets: Vec<GhAsset>,
}

enum FfmpegSource {
    /// Windows: BtbN zip containing bin/ffmpeg.exe and bin/ffprobe.exe
    Zip(String),
    /// macOS/Linux: separate ffmpeg and ffprobe binaries from eugeneware/ffmpeg-static
    Pair { ffmpeg: String, ffprobe: String },
}

/// "ffmpeg-master-latest-win64-gpl.zip" -> "master", "ffmpeg-n9.0-latest-win64-gpl-9.0.zip" -> "n9.0".
/// Rejects shared-library and non-win64 builds.
fn btbn_version_id(asset_name: &str) -> Option<String> {
    let rest = asset_name.strip_prefix("ffmpeg-")?;
    let (id, tail) = rest.split_once("-latest-win64-gpl")?;
    if !tail.ends_with(".zip") || tail.contains("shared") || id.is_empty() {
        return None;
    }
    Some(id.to_string())
}

async fn fetch_github<T: serde::de::DeserializeOwned>(url: &str) -> Result<T, String> {
    reqwest::Client::builder()
        .user_agent("remixer-tools")
        .build()
        .map_err(|e| e.to_string())?
        .get(url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| format!("GitHub API error: {}", e))?
        .json::<T>()
        .await
        .map_err(|e| e.to_string())
}

/// Installable FFmpeg builds for this platform, newest first. Only builds that ship both
/// ffmpeg and ffprobe are listed so the pair never ends up on mismatched versions.
async fn ffmpeg_sources() -> Result<Vec<(String, FfmpegSource)>, String> {
    if cfg!(target_os = "windows") {
        let rel: GhRelease =
            fetch_github("https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest").await?;
        let mut sources: Vec<_> = rel
            .assets
            .into_iter()
            .filter_map(|a| btbn_version_id(&a.name).map(|id| (id, FfmpegSource::Zip(a.browser_download_url))))
            .collect();
        // "master" first, then release branches newest first ("n9.0" before "n8.1")
        sources.sort_by_key(|(id, _)| {
            let ver: Vec<u32> = id.trim_start_matches('n').split('.').filter_map(|p| p.parse().ok()).collect();
            std::cmp::Reverse(if id == "master" { vec![u32::MAX] } else { ver })
        });
        return Ok(sources);
    }

    let os = if cfg!(target_os = "macos") { "darwin" } else { "linux" };
    let arch = if cfg!(target_arch = "aarch64") { "arm64" } else { "x64" };
    let releases: Vec<GhRelease> =
        fetch_github("https://api.github.com/repos/eugeneware/ffmpeg-static/releases?per_page=30").await?;
    let find = |rel: &GhRelease, name: String| {
        rel.assets.iter().find(|a| a.name == name).map(|a| a.browser_download_url.clone())
    };
    Ok(releases
        .iter()
        .filter_map(|rel| {
            let ffmpeg = find(rel, format!("ffmpeg-{}-{}", os, arch))?;
            let ffprobe = find(rel, format!("ffprobe-{}-{}", os, arch))?;
            Some((rel.tag_name.clone(), FfmpegSource::Pair { ffmpeg, ffprobe }))
        })
        .collect())
}

#[tauri::command]
pub async fn list_ffmpeg_versions() -> Result<Vec<String>, String> {
    Ok(ffmpeg_sources().await?.into_iter().map(|(id, _)| id).collect())
}

/// Writes next to the target and renames over it, so a failed or interrupted install never
/// leaves a truncated binary behind.
fn replace_binary(path: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("download");
    std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        let mut perms = std::fs::metadata(&tmp).map_err(|e| e.to_string())?.permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&tmp, perms).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!(
            "Could not replace {} ({}). Wait for running downloads/extractions to finish and try again.",
            path.file_name().unwrap_or_default().to_string_lossy(),
            e
        )
    })
}

#[tauri::command]
pub async fn install_ffmpeg(app: tauri::AppHandle, version: String) -> Result<String, String> {
    let app_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;

    // Resolving the id against the live release list is also the input validation:
    // only URLs GitHub itself returned are ever downloaded.
    let source = ffmpeg_sources()
        .await?
        .into_iter()
        .find(|(id, _)| *id == version)
        .map(|(_, s)| s)
        .ok_or_else(|| format!("FFmpeg version '{}' is not available for this platform", version))?;

    let (ffmpeg_bytes, ffprobe_bytes) = match source {
        FfmpegSource::Zip(url) => {
            let zip = download_file_with_progress(&app, &url, "ffmpeg").await?;
            let mut archive = ZipArchive::new(Cursor::new(zip)).map_err(|e| e.to_string())?;
            let mut extract = |suffix: &str| -> Result<Vec<u8>, String> {
                let idx = (0..archive.len())
                    .find(|&i| archive.by_index(i).map(|f| f.name().ends_with(suffix)).unwrap_or(false))
                    .ok_or_else(|| format!("{} not found in archive", suffix))?;
                let mut buf = Vec::new();
                std::io::copy(&mut archive.by_index(idx).map_err(|e| e.to_string())?, &mut buf)
                    .map_err(|e| e.to_string())?;
                Ok(buf)
            };
            (extract("/ffmpeg.exe")?, extract("/ffprobe.exe")?)
        }
        FfmpegSource::Pair { ffmpeg, ffprobe } => (
            download_file_with_progress(&app, &ffmpeg, "ffmpeg").await?,
            download_file_with_progress(&app, &ffprobe, "ffprobe").await?,
        ),
    };

    replace_binary(&tool_path(&app_dir, "ffmpeg"), &ffmpeg_bytes)?;
    replace_binary(&tool_path(&app_dir, "ffprobe"), &ffprobe_bytes)?;
    log::info!("Installed FFmpeg {}", version);

    Ok(get_tool_versions(app).await?.ffmpeg.unwrap_or(version))
}


#[tauri::command]
pub async fn run_ytdlp(
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
    let ffmpeg_dir = app_dir.to_string_lossy().to_string();
    let id_clone = id.clone();

    // Get download directory
    let target_dir = get_download_dir(app.clone()).unwrap_or_default();
    let target_dir_clone = target_dir.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = std::process::Command::new(&ytdlp_path).hide_window();

        // Change working directory and pass -P to target_dir so files are saved there
        if !target_dir_clone.is_empty() {
            cmd.current_dir(&target_dir_clone);
            cmd.arg("-P").arg(&target_dir_clone);
        }

        // Use JSON progress template for easier frontend parsing
        let progress_template = r#"{"progress": "%(progress._percent_str)s", "speed": "%(progress._speed_str)s", "eta": "%(progress._eta_str)s", "downloaded": "%(progress._downloaded_bytes_str)s", "total": "%(progress._total_bytes_str)s"}"#;

        cmd.args(YTDLP_UTF8);
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

        let is_audio = matches!(
            format_clone.as_str(),
            "mp3" | "mp3_meta" | "wav" | "flac" | "alac" | "aiff" | "m4a" | "aac" | "ogg" | "opus"
        );

        if is_audio {
            cmd.arg("-f").arg("bestaudio/best");
            let audio_format = match format_clone.as_str() {
                "mp3_meta" => "mp3",
                other => other,
            };
            cmd.arg("-x").arg("--audio-format").arg(audio_format);

            if matches!(format_clone.as_str(), "wav" | "flac" | "alac" | "aiff") {
                cmd.arg("--audio-quality").arg("0");
            } else {
                let audio_q = if quality_clone == "best" {
                    "320K"
                } else {
                    quality_clone.as_str()
                };
                cmd.arg("--audio-quality").arg(audio_q);
            }

            // Embed metadata and chapters for all audio formats
            cmd.arg("--embed-metadata");
            cmd.arg("--embed-chapters");
            cmd.arg("--parse-metadata").arg("%(title)s:%(artist)s - %(title)s");

            // Embed cover art thumbnail for formats that support picture embedding
            if matches!(format_clone.as_str(), "mp3" | "mp3_meta" | "flac" | "alac" | "m4a" | "opus" | "ogg" | "aiff") {
                cmd.arg("--embed-thumbnail");
                cmd.arg("--convert-thumbnails").arg("jpg");
            }
        } else {
            // Video formats: mp4, mkv, webm, mov, avi
            let container = match format_clone.as_str() {
                "mkv" => "mkv",
                "webm" => "webm",
                "mov" => "mov",
                "avi" => "avi",
                _ => "mp4",
            };

            if quality_clone == "best" {
                cmd.arg("-f")
                    .arg("bestvideo+bestaudio/best");
            } else {
                let height = quality_clone.replace("p", "");
                let f_arg = format!(
                    "bestvideo[height<={}]+bestaudio/best[height<={}]/best",
                    height, height
                );
                cmd.arg("-f").arg(&f_arg);
            }

            cmd.arg("--merge-output-format").arg(container);
            cmd.arg("--embed-metadata");
            cmd.arg("--embed-chapters");
            cmd.arg("--embed-thumbnail");
            cmd.arg("--convert-thumbnails").arg("jpg");
            cmd.arg("--parse-metadata").arg("%(title)s:%(artist)s - %(title)s");
        }

        cmd.arg(&url_clone);

        let mut child = match cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).spawn() {
            Ok(c) => c,
            Err(e) => {
                let _ = app_clone.emit("ytdlp-log", format!("Error: {}", e));
                return;
            }
        };

        let child_pid = child.id();
        if let Ok(mut lock) = ACTIVE_DOWNLOADS.lock() {
            let map = lock.get_or_insert_with(HashMap::new);
            map.insert(id_clone.clone(), child_pid);
        }

        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();

        let app_stdout = app_clone.clone();
        let id_stdout = id_clone.clone();
        let h_out = std::thread::spawn(move || {
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
                                let ext = full_path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
                                if !["webp", "jpg", "jpeg", "png", "part", "ytdl"].contains(&ext.as_str()) {
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
        let h_err = std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                if let Ok(line) = line {
                    let _ = app_stderr.emit("ytdlp-log", line);
                }
            }
        });

        let _ = child.wait();
        if let Ok(mut lock) = ACTIVE_DOWNLOADS.lock() {
            if let Some(map) = lock.as_mut() {
                map.remove(&id_clone);
            }
        }
        let _ = h_out.join();
        let _ = h_err.join();
        let _ = app_clone.emit("ytdlp-done", id_clone);
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::btbn_version_id;

    #[test]
    fn parses_btbn_asset_names() {
        assert_eq!(btbn_version_id("ffmpeg-master-latest-win64-gpl.zip").as_deref(), Some("master"));
        assert_eq!(btbn_version_id("ffmpeg-n9.0-latest-win64-gpl-9.0.zip").as_deref(), Some("n9.0"));
        assert_eq!(btbn_version_id("ffmpeg-n9.0-latest-win64-gpl-shared-9.0.zip"), None);
        assert_eq!(btbn_version_id("ffmpeg-n9.0-latest-win64-lgpl-9.0.zip"), None);
        assert_eq!(btbn_version_id("ffmpeg-master-latest-linux64-gpl.tar.xz"), None);
        assert_eq!(btbn_version_id("checksums.sha256"), None);
    }

    /// Hits the live GitHub API; run with `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn lists_ffmpeg_versions_from_github() {
        let sources = tauri::async_runtime::block_on(super::ffmpeg_sources()).expect("GitHub API reachable");
        let ids: Vec<&str> = sources.iter().map(|(id, _)| id.as_str()).collect();
        println!("ffmpeg versions: {:?}", ids);
        assert!(!ids.is_empty());
        for (_, src) in &sources {
            let urls = match src {
                super::FfmpegSource::Zip(u) => vec![u],
                super::FfmpegSource::Pair { ffmpeg, ffprobe } => vec![ffmpeg, ffprobe],
            };
            assert!(urls.iter().all(|u| u.starts_with("https://github.com/")));
        }
    }
}
