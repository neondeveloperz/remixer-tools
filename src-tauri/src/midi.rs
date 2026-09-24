use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tauri::Manager;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct MidiConversionResponse {
    pub success: bool,
    pub status: String,
    pub engine: Option<String>,
    pub midi_path: Option<String>,
    pub note_count: Option<usize>,
    pub duration: Option<f64>,
    pub duration_sec: Option<f64>,
    pub bpm: Option<f64>,
    pub first_beat: Option<f64>,
    pub quantize_grid: Option<String>,
    pub detected_key: Option<String>,
    pub file_size: Option<u64>,
    pub message: Option<String>,
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct MidiExistsResponse {
    pub exists: bool,
    pub midi_path: Option<String>,
}

#[derive(Deserialize, Debug)]
struct PythonMidiOutput {
    status: String,
    engine: Option<String>,
    midi_path: Option<String>,
    note_count: Option<usize>,
    duration: Option<f64>,
    bpm: Option<f64>,
    first_beat: Option<f64>,
    quantize_grid: Option<String>,
    detected_key: Option<String>,
    file_size: Option<u64>,
    message: Option<String>,
    fallback_reason: Option<String>,
}

fn get_python_and_venv(app: &tauri::AppHandle) -> Option<(PathBuf, PathBuf)> {
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
            return Some((python_exe, venv_dir));
        }
    }
    None
}

fn get_separated_midi_path(audio_path: &Path) -> PathBuf {
    let stem_filename = audio_path.file_stem().unwrap_or_default().to_string_lossy();
    let parent = audio_path.parent().unwrap_or_else(|| Path::new("."));
    parent.join(format!("{}.mid", stem_filename))
}

fn ensure_midi_dependencies(python_path: &Path, venv_dir: &Path) {
    // Quick check if basic_pitch and pretty_midi are importable
    let mut check_cmd = std::process::Command::new(python_path);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        check_cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let check = check_cmd
        .arg("-c")
        .arg("import basic_pitch, pretty_midi, importlib_resources")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();

    if let Ok(status) = check {
        if status.success() {
            return;
        }
    }

    // Install missing dependencies
    let pip_path = if cfg!(target_os = "windows") {
        venv_dir.join("Scripts").join("pip.exe")
    } else {
        venv_dir.join("bin").join("pip")
    };

    if pip_path.exists() {
        let mut cmd = std::process::Command::new(&pip_path);
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        let _ = cmd
            .arg("install")
            .arg("--no-deps")
            .arg("basic-pitch")
            .arg("pretty-midi")
            .arg("mir-eval")
            .arg("mido")
            .arg("importlib-resources")
            .output();
    }
}

#[tauri::command]
pub async fn convert_audio_to_midi(
    app: tauri::AppHandle,
    file_path: String,
    output_path: Option<String>,
    engine: Option<String>,
    preset: Option<String>,
    bpm: Option<f64>,
    sensitivity: Option<String>,
    quantize_grid: Option<String>,
    quantize_strength: Option<f64>,
) -> Result<MidiConversionResponse, String> {
    log::info!("Starting convert_audio_to_midi for: {}", file_path);
    let path = PathBuf::from(&file_path);
    if !path.exists() {
        return Err(format!("Audio file does not exist: {}", file_path));
    }

    let (python_path, venv_dir) = match get_python_and_venv(&app) {
        Some(pair) => pair,
        None => {
            return Err("Python environment not found in local AppData. Please initialize STEM Extractor first.".to_string());
        }
    };

    // Locate audio_to_midi.py
    let script = app
        .path()
        .resource_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("python")
        .join("audio_to_midi.py");

    let script_path = if script.exists() {
        script
    } else {
        let alt = PathBuf::from("python").join("audio_to_midi.py");
        let alt2 = PathBuf::from("../python").join("audio_to_midi.py");
        let alt3 = PathBuf::from("src-tauri/python").join("audio_to_midi.py");
        if alt.exists() {
            alt
        } else if alt2.exists() {
            alt2
        } else if alt3.exists() {
            alt3
        } else {
            return Err("audio_to_midi.py script not found".to_string());
        }
    };

    // Save into dedicated "midi" folder
    let target_out_path = if let Some(ref out) = output_path {
        if !out.is_empty() {
            PathBuf::from(out)
        } else {
            get_separated_midi_path(&path)
        }
    } else {
        get_separated_midi_path(&path)
    };

    let target_out_str = target_out_path.to_string_lossy().to_string();
    let file_path_clone = file_path.clone();
    let script_path_clone = script_path.clone();
    let target_out_arg = target_out_str.clone();
    let engine_arg = engine.unwrap_or_else(|| "basic-pitch".to_string());
    let preset_arg = preset.unwrap_or_else(|| "general".to_string());
    let bpm_arg = bpm;
    let sensitivity_arg = sensitivity.unwrap_or_else(|| "balanced".to_string());
    let quantize_grid_arg = quantize_grid.unwrap_or_else(|| "adaptive".to_string());
    let quantize_strength_arg = quantize_strength.unwrap_or(0.85);

    let output = tauri::async_runtime::spawn_blocking(move || {
        // Ensure dependencies exist in background thread
        ensure_midi_dependencies(&python_path, &venv_dir);

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
            .arg(&target_out_arg)
            .arg(&engine_arg)
            .arg(&preset_arg);

        if let Some(b) = bpm_arg {
            cmd.arg(b.to_string());
        } else {
            cmd.arg("");
        }

        cmd.arg(&sensitivity_arg)
            .arg(&quantize_grid_arg)
            .arg(quantize_strength_arg.to_string());

        cmd.stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    let stdout_str = String::from_utf8_lossy(&output.stdout);
    let stderr_str = String::from_utf8_lossy(&output.stderr);

    log::info!("audio_to_midi.py stdout: {}", stdout_str);

    // Look for JSON output in stdout
    for line in stdout_str.lines().rev() {
        let trimmed = line.trim();
        if trimmed.starts_with('{') && trimmed.ends_with('}') {
            if let Ok(parsed) = serde_json::from_str::<PythonMidiOutput>(trimmed) {
                if parsed.status == "success" {
                    let final_midi_path = parsed.midi_path.unwrap_or(target_out_str);

                    let _gen_path = Path::new(&final_midi_path);

                    return Ok(MidiConversionResponse {
                        success: true,
                        status: "success".to_string(),
                        engine: parsed.engine,
                        midi_path: Some(final_midi_path),
                        note_count: parsed.note_count,
                        duration: parsed.duration,
                        duration_sec: parsed.duration,
                        bpm: parsed.bpm,
                        first_beat: parsed.first_beat,
                        quantize_grid: parsed.quantize_grid,
                        detected_key: parsed.detected_key,
                        file_size: parsed.file_size,
                        message: parsed.fallback_reason,
                        error: None,
                    });
                } else {
                    let err_msg = parsed.message.unwrap_or_else(|| "Failed to convert audio to MIDI".to_string());
                    return Err(err_msg);
                }
            }
        }
    }

    if !output.status.success() {
        return Err(format!("Python process failed: {}", stderr_str));
    }

    Err(format!("Could not parse output from MIDI script. Stdout: {}, Stderr: {}", stdout_str, stderr_str))
}

#[tauri::command]
pub fn check_midi_exists(app: tauri::AppHandle, file_path: String) -> Result<MidiExistsResponse, String> {
    let p = Path::new(&file_path);
    if !p.exists() {
        return Ok(MidiExistsResponse { exists: false, midi_path: None });
    }
    let stem_name = p.file_stem().unwrap_or_default().to_string_lossy();
    let parent = p.parent().unwrap_or_else(|| Path::new("."));

    // Check 1: In same directory: parent/<stem>.mid
    let direct_midi = parent.join(format!("{}.mid", stem_name));
    if direct_midi.exists() {
        return Ok(MidiExistsResponse {
            exists: true,
            midi_path: Some(direct_midi.to_string_lossy().to_string()),
        });
    }

    // Check 2: In local midi/ subfolder (backward compatibility): parent/midi/<stem>.mid
    let local_midi = parent.join("midi").join(format!("{}.mid", stem_name));
    if local_midi.exists() {
        return Ok(MidiExistsResponse {
            exists: true,
            midi_path: Some(local_midi.to_string_lossy().to_string()),
        });
    }

    // Check 3: In central storage midi/ folder:
    let dirs = crate::storage::get_storage_dirs_internal(&app);
    let central_midi_dir = PathBuf::from(&dirs.midi_dir);
    let parent_name = parent.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if !parent_name.is_empty() {
        let song_midi = central_midi_dir.join(parent_name).join(format!("{}.mid", stem_name));
        if song_midi.exists() {
            return Ok(MidiExistsResponse {
                exists: true,
                midi_path: Some(song_midi.to_string_lossy().to_string()),
            });
        }
    }

    let direct_central = central_midi_dir.join(format!("{}.mid", stem_name));
    if direct_central.exists() {
        return Ok(MidiExistsResponse {
            exists: true,
            midi_path: Some(direct_central.to_string_lossy().to_string()),
        });
    }

    let p_ext_midi = p.with_extension("mid");
    if p_ext_midi.exists() {
        return Ok(MidiExistsResponse {
            exists: true,
            midi_path: Some(p_ext_midi.to_string_lossy().to_string()),
        });
    }

    Ok(MidiExistsResponse { exists: false, midi_path: None })
}
