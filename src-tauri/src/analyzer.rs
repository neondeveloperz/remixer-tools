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

    let app_dir = app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from("."));
    let venv_dir = app_dir.join("venv");
    
    let python_path = if cfg!(target_os = "windows") {
        venv_dir.join("Scripts").join("python.exe")
    } else {
        venv_dir.join("bin").join("python")
    };

    if !python_path.exists() {
        return Err("Python environment not found. Please run setup in STEM Extractor first.".to_string());
    }

    // Call analyzer.py
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
        if alt.exists() { alt } else { alt2 }
    };

    if !script_path.exists() {
        return Err(format!("Analyzer script not found at {:?}", script_path));
    }

    let output = tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = std::process::Command::new(&python_path);
        
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        cmd.arg(&script_path)
            .arg(&file_path)
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
    
    // Rename file
    let new_file_name = format!("{}_{}BPM_{}", file_name, bpm, key_formatted);
    let new_path = path.with_file_name(format!("{}.{}", new_file_name, ext));
    
    if let Err(e) = fs::rename(&path, &new_path) {
        return Err(format!("Failed to rename file: {}", e));
    }

    Ok(AnalyzeAndRenameResponse {
        success: true,
        new_path: Some(new_path.to_string_lossy().to_string()),
        bpm: Some(bpm),
        key: Some(key),
        message: None,
    })
}
