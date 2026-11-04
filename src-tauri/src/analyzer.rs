use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::Stdio;
use tauri::Manager;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AudioAnalysisResult {
    pub status: String,
    pub bpm: Option<f64>,
    pub key: Option<String>,
    pub message: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AnalyzeAndRenameResponse {
    pub success: bool,
    pub new_path: Option<String>,
    pub bpm: Option<f64>,
    pub key: Option<String>,
    pub message: Option<String>,
}

fn get_python_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    let local_dir = app.path().app_local_data_dir().unwrap_or_default();
    let roaming_dir = app.path().app_data_dir().unwrap_or_default();

    let candidates = [
        local_dir.join("venv"),
        roaming_dir.join("venv"),
        PathBuf::from("venv"),
    ];

    for venv_dir in candidates {
        let python_exe = if cfg!(target_os = "windows") {
            venv_dir.join("Scripts").join("python.exe")
        } else {
            venv_dir.join("bin").join("python")
        };

        if python_exe.exists() {
            return Some(python_exe);
        }
    }
    None
}

#[tauri::command]
pub async fn analyze_and_rename_audio(
    app: tauri::AppHandle,
    file_path: String,
) -> Result<AnalyzeAndRenameResponse, String> {
    log::info!("Starting analyze_and_rename_audio for: {}", file_path);
    let path = PathBuf::from(&file_path);
    if !path.exists() {
        return Err("File does not exist".to_string());
    }

    let file_name_os = path.file_stem().ok_or("Invalid file name")?;
    let file_name = file_name_os.to_string_lossy().to_string();
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_string())
        .unwrap_or_default();

    // Skip if already analyzed with our naming pattern (e.g. _120BPM_F_Major)
    if file_name.contains("BPM_") {
        return Ok(AnalyzeAndRenameResponse {
            success: true,
            new_path: Some(file_path.clone()),
            bpm: None,
            key: None,
            message: Some("File already contains BPM and Key info in filename".to_string()),
        });
    }

    let python_path = match get_python_path(&app) {
        Some(p) => p,
        None => {
            return Err("Python environment not found. Please run setup in STEM Extractor first.".to_string());
        }
    };

    let app_dir = app.path().app_local_data_dir().unwrap_or_else(|_| PathBuf::from("."));
    let _ = fs::create_dir_all(&app_dir);

    // Embed analyzer script directly to guarantee availability in all environments
    const EMBEDDED_ANALYZER_SCRIPT: &str = include_str!("../python/analyzer.py");
    let script_path = app_dir.join("analyzer.py");
    let _ = fs::write(&script_path, EMBEDDED_ANALYZER_SCRIPT);

    let file_path_clone = file_path.clone();
    let script_path_clone = script_path.clone();

    let output = tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = std::process::Command::new(&python_path);
        
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        cmd.env("PYTHONIOENCODING", "utf-8")
            .env("PYTHONUTF8", "1")
            .arg(&script_path_clone)
            .arg(&file_path_clone)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    let stdout_str = String::from_utf8_lossy(&output.stdout);
    log::info!("analyzer.py stdout: {}", stdout_str);
    
    // Parse the JSON output from python (search from last line)
    let mut parsed_result: Option<AudioAnalysisResult> = None;
    for line in stdout_str.lines().rev() {
        let trimmed = line.trim();
        if trimmed.starts_with('{') && trimmed.ends_with('}') {
            if let Ok(res) = serde_json::from_str::<AudioAnalysisResult>(trimmed) {
                parsed_result = Some(res);
                break;
            }
        }
    }

    let result = match parsed_result {
        Some(r) => r,
        None => return Err(format!("Failed to parse analyzer output: {}", stdout_str)),
    };

    if result.status == "error" {
        return Err(result.message.unwrap_or_else(|| "Unknown error in analyzer".to_string()));
    }

    let bpm = result.bpm.unwrap_or(0.0);
    let key = result.key.unwrap_or_default();
    
    // Embed BPM and Key metadata directly into the audio file tags via ffmpeg
    if bpm > 0.0 || !key.is_empty() {
        let ffmpeg_exe = if cfg!(target_os = "windows") {
            app_dir.join("ffmpeg.exe")
        } else {
            app_dir.join("ffmpeg")
        };

        if ffmpeg_exe.exists() {
            let temp_tagged = path.with_extension(format!("tagged_tmp.{}", ext));
            let bpm_str = (bpm.round() as u32).to_string();

            let mut tag_cmd = std::process::Command::new(&ffmpeg_exe);
            tag_cmd.arg("-y").arg("-i").arg(&path).arg("-c").arg("copy");

            if bpm > 0.0 {
                tag_cmd
                    .arg("-metadata").arg(format!("TBPM={}", bpm_str))
                    .arg("-metadata").arg(format!("BPM={}", bpm_str))
                    .arg("-metadata").arg(format!("tmpo={}", bpm_str));
            }

            if !key.is_empty() {
                tag_cmd
                    .arg("-metadata").arg(format!("TKEY={}", key))
                    .arg("-metadata").arg(format!("KEY={}", key))
                    .arg("-metadata").arg(format!("INITIALKEY={}", key));
            }

            tag_cmd.arg(&temp_tagged);

            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                tag_cmd.creation_flags(0x08000000);
            }

            if let Ok(status) = tag_cmd.status() {
                if status.success() && temp_tagged.exists() {
                    let _ = fs::remove_file(&path);
                    let _ = fs::rename(&temp_tagged, &path);
                } else if temp_tagged.exists() {
                    let _ = fs::remove_file(&temp_tagged);
                }
            }
        }
    }

    // Format key (e.g. "C Minor" -> "C_Minor")
    let key_formatted = key.replace(' ', "_");
    
    // Determine new renamed path
    let new_path = if bpm > 0.0 && !key_formatted.is_empty() {
        let new_file_name = format!("{}_{}BPM_{}", file_name, bpm.round() as u32, key_formatted);
        if ext.is_empty() {
            path.with_file_name(new_file_name)
        } else {
            path.with_file_name(format!("{}.{}", new_file_name, ext))
        }
    } else if bpm > 0.0 {
        let new_file_name = format!("{}_{}BPM", file_name, bpm.round() as u32);
        if ext.is_empty() {
            path.with_file_name(new_file_name)
        } else {
            path.with_file_name(format!("{}.{}", new_file_name, ext))
        }
    } else {
        path.clone()
    };
    
    let mut final_path = path.clone();
    let mut rename_msg: Option<String> = None;
    if new_path != path {
        if new_path.exists() {
            let _ = fs::remove_file(&new_path);
        }
        match fs::rename(&path, &new_path) {
            Ok(_) => {
                final_path = new_path;
            }
            Err(e) => {
                log::warn!("Could not rename file after analysis: {}", e);
                // Return success with original path so workflow is not broken
                rename_msg = Some(format!("Analysis complete, but renaming was skipped: {}", e));
            }
        }
    }

    Ok(AnalyzeAndRenameResponse {
        success: true,
        new_path: Some(final_path.to_string_lossy().to_string()),
        bpm: Some(bpm),
        key: Some(key),
        message: rename_msg,
    })
}
