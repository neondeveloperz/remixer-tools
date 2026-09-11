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

use std::sync::Mutex;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Default)]
struct AppSettings {
    download_dir: String,
    filename_template: Option<String>,
}

fn get_settings_path(app: &tauri::AppHandle) -> std::path::PathBuf {
    app.path().app_local_data_dir().unwrap().join("settings.json")
}

#[tauri::command]
fn get_settings(app: tauri::AppHandle) -> Result<AppSettings, String> {
    let settings_path = get_settings_path(&app);
    if let Ok(content) = std::fs::read_to_string(settings_path) {
        if let Ok(settings) = serde_json::from_str::<AppSettings>(&content) {
            return Ok(settings);
        }
    }
    
    // Default
    let mut default_settings = AppSettings::default();
    if let Ok(path) = app.path().download_dir() {
        default_settings.download_dir = path.to_string_lossy().to_string();
    }
    default_settings.filename_template = Some("%(title)s.%(ext)s".to_string());
    
    Ok(default_settings)
}

#[derive(Serialize, Deserialize)]
struct VideoInfo {
    id: String,
    title: String,
    thumbnail: String,
    duration: Option<f64>,
}

#[tauri::command]
async fn get_video_info(app: tauri::AppHandle, url: String) -> Result<String, String> {
    let app_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let ytdlp_path = app_dir.join("yt-dlp.exe");
    
    let output = std::process::Command::new(&ytdlp_path)
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
    Ok(get_settings(app)?.download_dir)
}

#[tauri::command]
fn set_download_dir(app: tauri::AppHandle, dir: String) -> Result<(), String> {
    let mut settings = get_settings(app.clone())?;
    settings.download_dir = dir;
    let json = serde_json::to_string(&settings).map_err(|e| e.to_string())?;
    std::fs::write(get_settings_path(&app), json).map_err(|e| e.to_string())?;
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

    let ytdlp_path = app_dir.join("yt-dlp.exe");
    let ffmpeg_path = app_dir.join("ffmpeg.exe");

    // Auto download yt-dlp.exe
    if !ytdlp_path.exists() {
        app.emit("setup-log", "Downloading yt-dlp...").unwrap();
        let response =
            reqwest::get("https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe")
                .await
                .map_err(|e| e.to_string())?;
        let bytes = response.bytes().await.map_err(|e| e.to_string())?;
        std::fs::write(&ytdlp_path, bytes).map_err(|e| e.to_string())?;
        app.emit("setup-log", "yt-dlp downloaded.").unwrap();
    }

    // Auto download ffmpeg
    if !ffmpeg_path.exists() {
        app.emit("setup-log", "Downloading ffmpeg (required for audio extraction and HD video)...").unwrap();
        let response = reqwest::get("https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip")
            .await.map_err(|e| e.to_string())?;
        let bytes = response.bytes().await.map_err(|e| e.to_string())?;

        app.emit("setup-log", "Extracting ffmpeg...").unwrap();
        let reader = Cursor::new(bytes);
        let mut archive = ZipArchive::new(reader).map_err(|e| e.to_string())?;

        for i in 0..archive.len() {
            let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
            let out_name = file.name().to_string();
            if out_name.ends_with("ffmpeg.exe") {
                let mut outfile = std::fs::File::create(&ffmpeg_path).map_err(|e| e.to_string())?;
                std::io::copy(&mut file, &mut outfile).map_err(|e| e.to_string())?;
            } else if out_name.ends_with("ffprobe.exe") {
                let mut outfile = std::fs::File::create(app_dir.join("ffprobe.exe")).map_err(|e| e.to_string())?;
                std::io::copy(&mut file, &mut outfile).map_err(|e| e.to_string())?;
            }
        }
        app.emit("setup-log", "ffmpeg installed.").unwrap();
    }

    // Check for updates
    app.emit("setup-log", "Checking for yt-dlp updates...").unwrap();
    let _ = std::process::Command::new(&ytdlp_path).arg("-U").status();

    app.emit("setup-log", "All dependencies are ready.").unwrap();
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
    let ytdlp_path = app_dir.join("yt-dlp.exe");

    app.emit("ytdlp-log", format!("Starting download for {}...", id)).unwrap();

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
        let mut cmd = std::process::Command::new(&ytdlp_path);
        
        // Change working directory to target_dir so files are saved there
        if !target_dir_clone.is_empty() {
            cmd.current_dir(&target_dir_clone);
        }
        
        // Use JSON progress template for easier frontend parsing
        let progress_template = r#"{"progress": "%(progress._percent_str)s", "speed": "%(progress._speed_str)s", "eta": "%(progress._eta_str)s", "downloaded": "%(progress._downloaded_bytes_str)s", "total": "%(progress._total_bytes_str)s"}"#;
        
        cmd.arg("--newline");
        cmd.arg("--progress-template").arg(progress_template);
        cmd.arg("--ffmpeg-location").arg(&ffmpeg_dir);
        
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
                        let _ = app_stdout.emit("ytdlp-progress", ProgressPayload { id: &id_stdout, data: &line });
                    } else {
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

        if let Ok(status) = child.wait() {
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
    
    // Check if audio-separator is installed
    if !separator_path.exists() {
        app.emit("stem-log", "Creating Python Virtual Environment... This may take a while.").unwrap();
        
        if !venv_dir.exists() {
            let status = std::process::Command::new("python")
                .arg("-m")
                .arg("venv")
                .arg(&venv_dir)
                .status()
                .map_err(|e| e.to_string())?;
                
            if !status.success() {
                return Err("Failed to create Python virtual environment. Is Python installed?".to_string());
            }
        }
        
        app.emit("stem-log", "Installing audio-separator... This will download AI libraries (approx 2GB).").unwrap();
        
        let pip_path = if cfg!(target_os = "windows") {
            venv_dir.join("Scripts").join("pip.exe")
        } else {
            venv_dir.join("bin").join("pip")
        };
        
        // Spawn pip and stream output
        let mut cmd = std::process::Command::new(&pip_path);
        cmd.arg("install").arg("audio-separator").arg("audioread").arg("--no-warn-script-location");
        
        let mut child = cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| e.to_string())?;
        
        let stdout = child.stdout.take().unwrap();
        let app_clone = app.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                if let Ok(line) = line {
                    let _ = app_clone.emit("stem-log", line);
                }
            }
        });
        
        let status = child.wait().map_err(|e| e.to_string())?;
        if !status.success() {
            return Err("Failed to install audio-separator.".to_string());
        }
    }
    
    app.emit("stem-log", "STEM Extractor is ready!").unwrap();
    Ok(())
}

#[tauri::command]
async fn run_stem_extractor(
    app: tauri::AppHandle,
    input_file: String,
    model: String,
) -> Result<(), String> {
    let app_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let venv_dir = app_dir.join("venv");
    
    let separator_path = if cfg!(target_os = "windows") {
        venv_dir.join("Scripts").join("audio-separator.exe")
    } else {
        venv_dir.join("bin").join("audio-separator")
    };
    
    if !separator_path.exists() {
        return Err("audio-separator not found. Please wait for setup to complete.".to_string());
    }
    
    let target_dir = get_settings(app.clone()).unwrap_or_default().download_dir;
    
    app.emit("stem-extract-log", format!("Starting extraction with model {}...", model)).unwrap();
    
    let app_clone = app.clone();
    let app_dir_clone = app_dir.clone();
    
    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = std::process::Command::new(&separator_path);
        
        // Add ffmpeg to PATH so audio-separator can find it
        let current_path = std::env::var("PATH").unwrap_or_default();
        let new_path = format!("{};{}", app_dir_clone.to_string_lossy(), current_path);
        cmd.env("PATH", new_path);
        
        cmd.arg(&input_file);
        cmd.arg("--model_filename").arg(&model);
        
        if !target_dir.is_empty() {
            cmd.arg("--output_dir").arg(&target_dir);
        }
        
        let mut child = match cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).spawn() {
            Ok(c) => c,
            Err(e) => {
                let _ = app_clone.emit("stem-extract-log", format!("Error: {}", e));
                return;
            }
        };
        
        let stdout = child.stdout.take().unwrap();
        let app_stdout = app_clone.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                if let Ok(line) = line {
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
                    let _ = app_stderr.emit("stem-extract-log", line);
                }
            }
        });
        
        if let Ok(status) = child.wait() {
            let _ = app_clone.emit("stem-extract-done", status.success());
        }
    });

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
        .invoke_handler(tauri::generate_handler![greet, run_ytdlp, get_download_dir, set_download_dir, set_filename_template, get_settings, setup_dependencies, get_video_info, setup_stem_extractor, run_stem_extractor])
        .on_page_load(|webview, payload| {
            if webview.label() == "main" && matches!(payload.event(), PageLoadEvent::Finished) {
                log::info!("main webview finished loading");
                let _ = webview.window().show();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
