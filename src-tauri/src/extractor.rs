use tauri::{Manager, Emitter};
use std::io::{BufRead, BufReader};
use std::process::Stdio;
use std::sync::atomic::{AtomicU32, Ordering};

static CURRENT_EXTRACTOR_PID: AtomicU32 = AtomicU32::new(0);

#[tauri::command]
pub fn cancel_stem_extractor() {
    let pid = CURRENT_EXTRACTOR_PID.swap(0, Ordering::SeqCst);
    if pid != 0 {
        #[cfg(not(target_os = "windows"))]
        {
            let _ = std::process::Command::new("kill").arg("-9").arg(pid.to_string()).spawn();
        }
        #[cfg(target_os = "windows")]
        {
            let _ = std::process::Command::new("taskkill").arg("/F").arg("/T").arg("/PID").arg(pid.to_string()).spawn();
        }
    }
}

use crate::models::*;
use crate::storage::get_storage_dirs_internal;
use crate::ai_models::get_models_dir;
use crate::downloader::{CommandExtForWindows, download_file_with_progress};

/// Lines from a child process pipe. Non-UTF-8 output (e.g. a Thai Windows code page) is decoded
/// lossily instead of being dropped, and iteration stops on the first I/O error instead of retrying it.
fn lossy_lines<R: BufRead>(reader: R) -> impl Iterator<Item = String> {
    reader.split(b'\n').map_while(Result::ok).map(|bytes| {
        let line = bytes.strip_suffix(b"\r").unwrap_or(&bytes);
        String::from_utf8_lossy(line).into_owned()
    })
}

#[tauri::command]
pub async fn reset_stem_extractor(app: tauri::AppHandle) -> Result<(), String> {
    cancel_stem_extractor();
    let app_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let venv_dir = app_dir.join("venv");
    if venv_dir.exists() {
        let _ = std::fs::remove_dir_all(&venv_dir);
    }
    setup_stem_extractor(app).await
}

#[tauri::command]
pub async fn setup_stem_extractor(app: tauri::AppHandle) -> Result<(), String> {
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

    let venv_python = if cfg!(target_os = "windows") {
        venv_dir.join("Scripts").join("python.exe")
    } else {
        venv_dir.join("bin").join("python")
    };

    // Auto download standalone python if not exists or corrupted
    if !python_exe_path.exists() {
        if python_dir.exists() {
            let _ = std::fs::remove_dir_all(&python_dir);
        }

        app.emit(
            "stem-log",
            "Downloading standalone Python environment (approx 35MB)...",
        )
        .unwrap();
        let python_url = if cfg!(target_os = "windows") {
            "https://github.com/astral-sh/python-build-standalone/releases/download/20240107/cpython-3.11.7+20240107-x86_64-pc-windows-msvc-shared-install_only.tar.gz"
        } else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
            "https://github.com/astral-sh/python-build-standalone/releases/download/20240107/cpython-3.11.7+20240107-aarch64-apple-darwin-install_only.tar.gz"
        } else if cfg!(target_os = "macos") {
            "https://github.com/astral-sh/python-build-standalone/releases/download/20240107/cpython-3.11.7+20240107-x86_64-apple-darwin-install_only.tar.gz"
        } else if cfg!(all(target_os = "linux", target_arch = "aarch64")) {
            "https://github.com/astral-sh/python-build-standalone/releases/download/20240107/cpython-3.11.7+20240107-aarch64-unknown-linux-gnu-install_only.tar.gz"
        } else {
            "https://github.com/astral-sh/python-build-standalone/releases/download/20240107/cpython-3.11.7+20240107-x86_64-unknown-linux-gnu-install_only.tar.gz"
        };

        let bytes = download_file_with_progress(&app, python_url, "python").await?;

        let tar_path = app_dir.join("python.tar.gz");
        std::fs::write(&tar_path, bytes).map_err(|e| e.to_string())?;

        let _ = app.emit("stem-log", "Extracting Python environment...");
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

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Ok(metadata) = std::fs::metadata(&python_exe_path) {
                let mut perms = metadata.permissions();
                perms.set_mode(0o755);
                let _ = std::fs::set_permissions(&python_exe_path, perms);
            }
        }

        if !tar_status.success() || !python_exe_path.exists() {
            return Err("Failed to extract standalone Python.".to_string());
        }

        let _ = std::fs::remove_file(&tar_path);
        let _ = app.emit("stem-log", "Standalone Python environment is ready.");
    }

    // Check if audio-separator is installed
    if !separator_path.exists() {
        let _ = app.emit(
            "stem-log",
            "Creating Python Virtual Environment... This may take a while.",
        );

        if !venv_dir.exists() || !venv_python.exists() {
            if venv_dir.exists() {
                let _ = std::fs::remove_dir_all(&venv_dir);
            }

            let status = std::process::Command::new(&python_exe_path)
                .hide_window()
                .arg("-m")
                .arg("venv")
                .arg(&venv_dir)
                .status()
                .map_err(|e| e.to_string())?;

            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if let Ok(metadata) = std::fs::metadata(&venv_python) {
                    let mut perms = metadata.permissions();
                    perms.set_mode(0o755);
                    let _ = std::fs::set_permissions(&venv_python, perms);
                }
            }

            if !status.success() || !venv_python.exists() {
                return Err(
                    "Failed to create Python virtual environment with standalone Python."
                        .to_string(),
                );
            }
        }

        // Ensure pip is available inside the venv
        let _ = std::process::Command::new(&venv_python)
            .hide_window()
            .arg("-m")
            .arg("ensurepip")
            .arg("--default-pip")
            .status();

        app.emit(
            "stem-log",
            "Installing audio-separator... This will download AI libraries (approx 2GB).",
        )
        .unwrap();

        // 1. Uninstall CPU version of onnxruntime if it exists to prevent conflicts
        let mut cmd_rm = std::process::Command::new(&venv_python).hide_window();
        cmd_rm
            .arg("-m")
            .arg("pip")
            .arg("uninstall")
            .arg("-y")
            .arg("onnxruntime");
        let _ = cmd_rm.status();

        // 2. Install PyTorch with or without CUDA
        let mut torch_installed = false;
        if cfg!(target_os = "windows") {
            app.emit("stem-log", "Installing PyTorch with CUDA (approx 2.5GB)...")
                .unwrap();
            let mut cmd_torch = std::process::Command::new(&venv_python).hide_window();
            cmd_torch
                .arg("-m")
                .arg("pip")
                .arg("install")
                .arg("torch")
                .arg("torchvision")
                .arg("torchaudio")
                .arg("--index-url")
                .arg("https://download.pytorch.org/whl/cu124")
                .arg("--prefer-binary");

            if let Ok(mut child_torch) = cmd_torch.stdout(Stdio::piped()).stderr(Stdio::piped()).spawn() {
                let stdout_torch = child_torch.stdout.take().unwrap();
                let stderr_torch = child_torch.stderr.take().unwrap();

                let app_torch = app.clone();
                std::thread::spawn(move || {
                    let reader = BufReader::new(stdout_torch);
                    for line in lossy_lines(reader) {
                        let _ = app_torch.emit("stem-log", line);
                    }
                });

                let app_torch_err = app.clone();
                std::thread::spawn(move || {
                    let reader = BufReader::new(stderr_torch);
                    for line in lossy_lines(reader) {
                        let _ = app_torch_err.emit("stem-log", line);
                    }
                });

                if let Ok(status) = child_torch.wait() {
                    torch_installed = status.success();
                }
            }

            if !torch_installed {
                app.emit("stem-log", "CUDA PyTorch install failed or timed out. Falling back to standard PyTorch...")
                    .unwrap();
                let mut cmd_fallback = std::process::Command::new(&venv_python).hide_window();
                cmd_fallback
                    .arg("-m")
                    .arg("pip")
                    .arg("install")
                    .arg("torch")
                    .arg("torchvision")
                    .arg("torchaudio")
                    .arg("--prefer-binary");

                if let Ok(mut child_fb) = cmd_fallback.stdout(Stdio::piped()).stderr(Stdio::piped()).spawn() {
                    let stdout_fb = child_fb.stdout.take().unwrap();
                    let stderr_fb = child_fb.stderr.take().unwrap();

                    let app_fb = app.clone();
                    std::thread::spawn(move || {
                        let reader = BufReader::new(stdout_fb);
                        for line in lossy_lines(reader) {
                            let _ = app_fb.emit("stem-log", line);
                        }
                    });

                    let app_fb_err = app.clone();
                    std::thread::spawn(move || {
                        let reader = BufReader::new(stderr_fb);
                        for line in lossy_lines(reader) {
                            let _ = app_fb_err.emit("stem-log", line);
                        }
                    });

                    if let Ok(status) = child_fb.wait() {
                        torch_installed = status.success();
                    }
                }
            }
        } else {
            app.emit("stem-log", "Installing PyTorch (approx 1GB)...")
                .unwrap();
            let mut cmd_torch = std::process::Command::new(&venv_python).hide_window();
            cmd_torch
                .arg("-m")
                .arg("pip")
                .arg("install")
                .arg("torch")
                .arg("torchvision")
                .arg("torchaudio")
                .arg("--prefer-binary");

            if let Ok(mut child_torch) = cmd_torch.stdout(Stdio::piped()).stderr(Stdio::piped()).spawn() {
                let stdout_torch = child_torch.stdout.take().unwrap();
                let stderr_torch = child_torch.stderr.take().unwrap();

                let app_torch = app.clone();
                std::thread::spawn(move || {
                    let reader = BufReader::new(stdout_torch);
                    for line in lossy_lines(reader) {
                        let _ = app_torch.emit("stem-log", line);
                    }
                });

                let app_torch_err = app.clone();
                std::thread::spawn(move || {
                    let reader = BufReader::new(stderr_torch);
                    for line in lossy_lines(reader) {
                        let _ = app_torch_err.emit("stem-log", line);
                    }
                });

                if let Ok(status) = child_torch.wait() {
                    torch_installed = status.success();
                }
            }
        }

        if !torch_installed {
            return Err("Failed to install PyTorch. Check the logs for details.".to_string());
        }

        // 3. Install audio-separator and onnxruntime
        let mut cmd = std::process::Command::new(&venv_python).hide_window();
        if cfg!(target_os = "windows") {
            app.emit(
                "stem-log",
                "Installing audio-separator, librosa, and ONNX Runtime DirectML...",
            )
            .unwrap();
            cmd.arg("-m")
                .arg("pip")
                .arg("install")
                .arg("audio-separator")
                .arg("audioread")
                .arg("librosa")
                .arg("soundfile")
                .arg("onnxruntime-directml")
                .arg("--extra-index-url")
                .arg("https://download.pytorch.org/whl/cu124")
                .arg("--prefer-binary")
                .arg("--no-warn-script-location");
        } else {
            app.emit("stem-log", "Installing audio-separator, librosa, and ONNX Runtime...")
                .unwrap();
            cmd.arg("-m")
                .arg("pip")
                .arg("install")
                .arg("audio-separator")
                .arg("audioread")
                .arg("librosa")
                .arg("soundfile")
                .arg("onnxruntime")
                .arg("--prefer-binary")
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
            for line in lossy_lines(reader) {
                let _ = app_clone.emit("stem-log", line);
            }
        });

        let app_clone_err = app.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in lossy_lines(reader) {
                let _ = app_clone_err.emit("stem-log", line);
            }
        });

        let status = child.wait().map_err(|e| e.to_string())?;
        if !status.success() {
            return Err("Failed to install audio-separator.".to_string());
        }

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Ok(metadata) = std::fs::metadata(&separator_path) {
                let mut perms = metadata.permissions();
                perms.set_mode(0o755);
                let _ = std::fs::set_permissions(&separator_path, perms);
            }
        }

        // Ensure CPU onnxruntime is removed if pulled in transitively on Windows
        #[cfg(target_os = "windows")]
        {
            let mut cmd_rm_final = std::process::Command::new(&venv_python).hide_window();
            cmd_rm_final
                .arg("-m")
                .arg("pip")
                .arg("uninstall")
                .arg("-y")
                .arg("onnxruntime");
            let _ = cmd_rm_final.status();
        }
    }

    ensure_separator_dml_patch(&venv_python);

    let _ = app.emit("stem-log", "STEM Extractor is ready!");
    Ok(())
}

#[allow(unused_variables)]
pub fn ensure_separator_dml_patch(python_path: &std::path::Path) {
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

#[tauri::command]
pub async fn run_stem_extractor(
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

fn sanitize_folder_name(name: &str) -> String {
    let invalid = ['/', '\\', ':', '*', '?', '"', '<', '>', '|'];
    let cleaned: String = name
        .chars()
        .map(|c| if invalid.contains(&c) { '_' } else { c })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.');
    if trimmed.is_empty() {
        "Untitled".to_string()
    } else {
        trimmed.to_string()
    }
}

    ensure_separator_dml_patch(&python_path);

    let target_base_dir = get_storage_dirs_internal(&app).stems_dir;
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
        let input_file_path = std::path::PathBuf::from(&input_file);
        let input_stem = input_file_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Untitled")
            .to_string();

        let folder_title = sanitize_folder_name(&input_stem);
        let out_dir = if target_base_dir.is_empty() {
            std::env::current_dir().unwrap_or_default().join("stems").join(&folder_title)
        } else {
            std::path::PathBuf::from(&target_base_dir).join(&folder_title)
        };
        let _ = std::fs::create_dir_all(&out_dir);

        let mut cmd = std::process::Command::new(&separator_path).hide_window();

        // Add ffmpeg to PATH so audio-separator can find it
        let current_path = std::env::var("PATH").unwrap_or_default();
        #[cfg(target_os = "windows")]
        let new_path = format!("{};{}", app_dir_clone.to_string_lossy(), current_path);
        #[cfg(not(target_os = "windows"))]
        let new_path = format!("{}:{}:/opt/homebrew/bin:/usr/local/bin", app_dir_clone.to_string_lossy(), current_path);

        cmd.env("PATH", new_path);
        cmd.env("PYTHONUNBUFFERED", "1");
        
        // Force Demucs to cache its PyTorch models in our models folder instead of /tmp/audio-separator-models
        cmd.env("TORCH_HOME", &models_dir);

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

            // In Demucs, shifts = number of extra random shift passes.
            // 0 = fastest (1 single pass), 1 = balanced (2 passes). Avoid 2+ on CPU or low VRAM.
            let shifts = if is_low_mem {
                "0"
            } else {
                match overlap_val.as_str() {
                    "2" => "0",
                    "4" => "1",
                    _ => "1",
                }
            };
            cmd.arg("--demucs_shifts").arg(shifts);
        } else {
            let shifts = if is_low_mem { "0" } else { "1" };
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
                    cmd.arg("--demucs_segment_size").arg("40");
                } else {
                    cmd.arg("--demucs_segment_size").arg("Default");
                }
            }
        } else if is_demucs {
            if is_low_mem {
                cmd.arg("--demucs_segment_size").arg("40");
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

        cmd.arg("--output_dir").arg(&out_dir);

        let mut child = match cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).spawn() {
            Ok(c) => c,
            Err(e) => {
                let _ = app_clone.emit("stem-extract-log", format!("Error: {}", e));
                let _ = app_clone.emit("stem-extract-done", false);
                return;
            }
        };

        CURRENT_EXTRACTOR_PID.store(child.id(), Ordering::SeqCst);

        let logged_files: std::sync::Arc<std::sync::Mutex<Vec<String>>> =
            std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let logged_files_out = logged_files.clone();
        let logged_files_err = logged_files.clone();

        let stdout = child.stdout.take().unwrap();
        let app_stdout = app_clone.clone();
        std::thread::spawn(move || {
            use std::io::Read;
            let mut reader = BufReader::new(stdout);
            let mut buf = Vec::new();
            let mut byte = [0u8; 1];
            while let Ok(1) = reader.read(&mut byte) {
                let b = byte[0];
                if b == b'\n' || b == b'\r' {
                    let line = String::from_utf8_lossy(&buf).to_string();
                    if !line.trim().is_empty() {
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
                    buf.clear();
                } else {
                    buf.push(b);
                }
            }
            if !buf.is_empty() {
                let line = String::from_utf8_lossy(&buf).to_string();
                let _ = app_stdout.emit("stem-extract-log", line);
            }
        });

        let stderr = child.stderr.take().unwrap();
        let app_stderr = app_clone.clone();
        std::thread::spawn(move || {
            use std::io::Read;
            let mut reader = BufReader::new(stderr);
            let mut buf = Vec::new();
            let mut byte = [0u8; 1];
            while let Ok(1) = reader.read(&mut byte) {
                let b = byte[0];
                if b == b'\n' || b == b'\r' {
                    let line = String::from_utf8_lossy(&buf).to_string();
                    if !line.trim().is_empty() {
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
                    buf.clear();
                } else {
                    buf.push(b);
                }
            }
            if !buf.is_empty() {
                let line = String::from_utf8_lossy(&buf).to_string();
                let _ = app_stderr.emit("stem-extract-log", line);
            }
        });

        let success = match child.wait() {
            Ok(status) => status.success(),
            Err(_) => false,
        };

        CURRENT_EXTRACTOR_PID.store(0, Ordering::SeqCst);

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
