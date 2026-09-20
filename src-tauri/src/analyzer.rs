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

    // Locate analyzer.py
    let analyzer_script = app
        .path()
        .resource_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("python")
        .join("analyzer.py");

    let script_path = if analyzer_script.exists() {
        analyzer_script
    } else {
        let alt = PathBuf::from("python").join("analyzer.py");
        let alt2 = PathBuf::from("../python").join("analyzer.py");
        let alt3 = PathBuf::from("src-tauri/python").join("analyzer.py");
        if alt.exists() {
            alt
        } else if alt2.exists() {
            alt2
        } else if alt3.exists() {
            alt3
        } else {
            return Err("analyzer.py script not found".to_string());
        }
    };

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
                return Ok(AnalyzeAndRenameResponse {
                    success: true,
                    new_path: Some(file_path),
                    bpm: Some(bpm),
                    key: Some(key),
                    message: Some(format!("Analysis complete, but renaming was skipped: {}", e)),
                });
            }
        }
    }

    Ok(AnalyzeAndRenameResponse {
        success: true,
        new_path: Some(final_path.to_string_lossy().to_string()),
        bpm: Some(bpm),
        key: Some(key),
        message: None,
    })
}
