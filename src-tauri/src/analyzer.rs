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

#[tauri::command]
pub async fn analyze_and_rename_audio(
    app: tauri::AppHandle,
    file_path: String,
) -> Result<AnalyzeAndRenameResponse, String> {
    let path = PathBuf::from(&file_path);
    if !path.exists() {
        return Err("File does not exist".to_string());
    }

    let file_name_os = path.file_stem().ok_or("Invalid file name")?;
    let file_name = file_name_os.to_string_lossy().to_string();
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_string())
        .unwrap_or_else(|| "".to_string());

    // Skip if already analyzed (crude check)
    if file_name.contains("BPM_") {
        return Ok(AnalyzeAndRenameResponse {
            success: true,
            new_path: Some(file_path.clone()),
            bpm: None,
            key: None,
            message: Some("File already seems to contain BPM info".to_string()),
        });
    }

    let app_dir = app.path().app_local_data_dir().unwrap_or_else(|_| PathBuf::from("."));
    let venv_dir = app_dir.join("venv");
    
    let python_path = if cfg!(target_os = "windows") {
        venv_dir.join("Scripts").join("python.exe")
    } else {
        venv_dir.join("bin").join("python")
    };

    if !python_path.exists() {
        return Err("Python environment not found. Please run setup in STEM Extractor first.".to_string());
    }

    // Embed analyzer script directly to guarantee availability in all environments
    const EMBEDDED_ANALYZER_SCRIPT: &str = include_str!("../python/analyzer.py");
    let script_path = app_dir.join("analyzer.py");
    let _ = std::fs::write(&script_path, EMBEDDED_ANALYZER_SCRIPT);

    let file_path_cmd = file_path.clone();
    let output = tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = std::process::Command::new(&python_path);
        
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        cmd.arg(&script_path)
            .arg(&file_path_cmd)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    let stdout_str = String::from_utf8_lossy(&output.stdout);
    
    // Parse the JSON output from python
    let mut parsed_result: Option<AudioAnalysisResult> = None;
    for line in stdout_str.lines() {
        if let Ok(res) = serde_json::from_str::<AudioAnalysisResult>(line) {
            parsed_result = Some(res);
            break;
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
    let key = result.key.unwrap_or_else(|| "".to_string());
    
    // Format key (e.g. "C Minor" -> "C_Minor")
    let key_formatted = key.replace(" ", "_");
    
    // Rename file if possible, or keep original path if file is locked
    let new_file_name = if key_formatted.is_empty() {
        format!("{}_{}BPM", file_name, bpm)
    } else {
        format!("{}_{}BPM_{}", file_name, bpm, key_formatted)
    };

    let new_path = if ext.is_empty() {
        path.with_file_name(&new_file_name)
    } else {
        path.with_file_name(format!("{}.{}", new_file_name, ext))
    };
    
    let (renamed_path, rename_msg) = match fs::rename(&path, &new_path) {
        Ok(_) => (Some(new_path.to_string_lossy().to_string()), None),
        Err(e) => (Some(file_path.clone()), Some(format!("Analysis succeeded but file could not be renamed: {}", e))),
    };

    Ok(AnalyzeAndRenameResponse {
        success: true,
        new_path: renamed_path,
        bpm: Some(bpm),
        key: Some(key),
        message: rename_msg,
    })
}
