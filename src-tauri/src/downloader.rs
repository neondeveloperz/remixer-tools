use tauri::{Manager, Emitter};
use std::io::{BufRead, BufReader, Cursor};
use std::process::Stdio;
use zip::ZipArchive;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};

use crate::models::*;
use crate::settings::get_settings;
use crate::storage::get_download_dir;

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
    let ffmpeg_dir = app_dir.to_str().unwrap().to_string();
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
        let h_err = std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                if let Ok(line) = line {
                    let _ = app_stderr.emit("ytdlp-log", line);
                }
            }
        });

        let _ = child.wait();
        let _ = h_out.join();
        let _ = h_err.join();
        let _ = app_clone.emit("ytdlp-done", id_clone);
    });

    Ok(())
}
