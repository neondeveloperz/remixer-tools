use std::path::{Path, PathBuf};
use tauri::Manager;

use crate::downloader::CommandExtForWindows;
use crate::storage::get_storage_dirs_internal;

/// Cuts `[start, end)` seconds of `input_file` into the library folder and returns the new path.
/// `format`: "original" (keep source format), "mp3", "wav" or "flac". Fades are in seconds.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn trim_audio(
    app: tauri::AppHandle,
    input_file: String,
    start: f64,
    end: f64,
    fade_in: Option<f64>,
    fade_out: Option<f64>,
    format: Option<String>,
) -> Result<String, String> {
    validate_range(start, end)?;
    let (fade_in, fade_out) = (fade_in.unwrap_or(0.0), fade_out.unwrap_or(0.0));
    validate_fades(fade_in, fade_out, end - start)?;
    let input = PathBuf::from(&input_file);
    if !input.is_file() {
        return Err("Input file not found".to_string());
    }
    let app_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let library = PathBuf::from(get_storage_dirs_internal(&app).library_dir);
    std::fs::create_dir_all(&library).map_err(|e| e.to_string())?;

    let stem = input.file_stem().and_then(|s| s.to_str()).unwrap_or("audio");
    let ext = input
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
        .to_lowercase();
    let has_fade = fade_in > 0.0 || fade_out > 0.0;
    let (out_ext, codec) = encode_args(&ext, format.as_deref().unwrap_or("original"), has_fade)?;
    let output = library.join(format!("{} (trim {}-{}).{}", stem, fmt_ts(start), fmt_ts(end), out_ext));

    let mut args: Vec<String> = Vec::new();
    if has_fade {
        args.push("-af".into());
        args.push(fade_filter(fade_in, fade_out, end - start));
    }
    args.extend(codec.iter().map(|a| a.to_string()));

    let ffmpeg = {
        let bundled = app_dir.join(if cfg!(target_os = "windows") { "ffmpeg.exe" } else { "ffmpeg" });
        if bundled.exists() { bundled } else { PathBuf::from("ffmpeg") }
    };
    let out = output.clone();
    tauri::async_runtime::spawn_blocking(move || run_ffmpeg(&ffmpeg, &input, &out, start, end, &args))
        .await
        .map_err(|e| e.to_string())??;
    Ok(output.to_string_lossy().to_string())
}

fn run_ffmpeg(ffmpeg: &Path, input: &Path, output: &Path, start: f64, end: f64, encode: &[String]) -> Result<(), String> {
    let res = std::process::Command::new(ffmpeg)
        .hide_window()
        .args(["-y", "-hide_banner", "-loglevel", "error", "-ss", &format!("{:.3}", start), "-i"])
        .arg(input)
        .args(["-t", &format!("{:.3}", end - start), "-vn", "-map_metadata", "0"])
        .args(encode)
        .arg(output)
        .output()
        .map_err(|e| format!("Failed to run ffmpeg: {}", e))?;
    if !res.status.success() || !output.exists() {
        let _ = std::fs::remove_file(output);
        return Err(format!("ffmpeg failed: {}", String::from_utf8_lossy(&res.stderr).trim()));
    }
    Ok(())
}

/// Returns (output extension, ffmpeg codec args).
/// "original": lossy sources are stream-copied (no generation loss) unless a fade forces a
/// re-encode; FLAC stays FLAC; anything else (WAV, video containers) becomes WAV.
fn encode_args(src_ext: &str, format: &str, has_fade: bool) -> Result<(String, Vec<&'static str>), String> {
    const MP3: [&str; 4] = ["-c:a", "libmp3lame", "-b:a", "320k"];
    let target = match format {
        "original" => match src_ext {
            "mp3" | "m4a" | "aac" | "ogg" | "opus" | "flac" => src_ext,
            _ => "wav",
        },
        "mp3" | "wav" | "flac" => format,
        other => return Err(format!("Unsupported output format: {}", other)),
    };
    let copy_ok = format == "original" && !has_fade;
    let args = match target {
        "mp3" if copy_ok => vec!["-c:a", "copy"],
        "mp3" => MP3.to_vec(),
        "m4a" | "aac" | "ogg" | "opus" if copy_ok => vec!["-c:a", "copy"],
        "m4a" | "aac" => vec!["-c:a", "aac", "-b:a", "256k"],
        "ogg" => vec!["-c:a", "libvorbis", "-q:a", "6"],
        "opus" => vec!["-c:a", "libopus", "-b:a", "192k"],
        "flac" => vec!["-c:a", "flac"],
        _ => vec!["-c:a", "pcm_s16le"],
    };
    Ok((target.to_string(), args))
}

fn validate_fades(fade_in: f64, fade_out: f64, length: f64) -> Result<(), String> {
    let ok = |f: f64| f.is_finite() && f >= 0.0;
    if ok(fade_in) && ok(fade_out) && fade_in + fade_out <= length {
        Ok(())
    } else {
        Err("Fades must be 0 or more and fit inside the selection".to_string())
    }
}

/// Timestamps restart at 0 after the input-side `-ss`, so fade-out starts at `length - fade_out`.
fn fade_filter(fade_in: f64, fade_out: f64, length: f64) -> String {
    let mut f = Vec::new();
    if fade_in > 0.0 {
        f.push(format!("afade=t=in:st=0:d={:.3}", fade_in));
    }
    if fade_out > 0.0 {
        f.push(format!("afade=t=out:st={:.3}:d={:.3}", length - fade_out, fade_out));
    }
    f.join(",")
}

fn validate_range(start: f64, end: f64) -> Result<(), String> {
    if start.is_finite() && end.is_finite() && start >= 0.0 && end > start {
        Ok(())
    } else {
        Err("Invalid trim range".to_string())
    }
}

/// Seconds -> "1m05s" (filename-safe).
fn fmt_ts(secs: f64) -> String {
    let t = secs.max(0.0) as u64;
    format!("{}m{:02}s", t / 60, t % 60)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn range_and_naming() {
        assert!(validate_range(1.5, 30.0).is_ok());
        assert!(validate_range(10.0, 10.0).is_err());
        assert!(validate_range(-1.0, 5.0).is_err());
        assert!(validate_range(f64::NAN, 5.0).is_err());
        assert_eq!(fmt_ts(65.9), "1m05s");
        assert_eq!(encode_args("mp3", "original", false).unwrap(), ("mp3".into(), vec!["-c:a", "copy"]));
        assert_eq!(encode_args("mp3", "original", true).unwrap().1[1], "libmp3lame");
        assert_eq!(encode_args("mp4", "original", false).unwrap().0, "wav");
        assert_eq!(encode_args("wav", "mp3", false).unwrap().0, "mp3");
        assert!(encode_args("wav", "exe", false).is_err());
        assert!(validate_fades(2.0, 3.0, 5.0).is_ok());
        assert!(validate_fades(3.0, 3.0, 5.0).is_err());
        assert!(validate_fades(-1.0, 0.0, 5.0).is_err());
        assert_eq!(fade_filter(1.0, 2.0, 10.0), "afade=t=in:st=0:d=1.000,afade=t=out:st=8.000:d=2.000");
        assert_eq!(fade_filter(0.0, 2.0, 10.0), "afade=t=out:st=8.000:d=2.000");
    }
}
