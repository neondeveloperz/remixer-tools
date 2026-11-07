use tauri::webview::PageLoadEvent;
use tauri_plugin_log::{Target, TargetKind};
use tauri_plugin_opener::OpenerExt;

pub mod models;
pub mod settings;
pub mod storage;
pub mod downloader;
pub mod extractor;
pub mod ai_models;
pub mod analyzer;
pub mod midi;
pub mod trimmer;

use settings::*;
use storage::*;
use downloader::*;
use extractor::*;
use ai_models::*;
use analyzer::*;
use midi::*;
use trimmer::*;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
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

/// (x, y, width, height) in physical pixels.
type Rect = (i32, i32, u32, u32);

/// True if a point inside the window's title bar lies on some monitor, i.e. the user can grab and drag it.
fn title_bar_visible(window: Rect, monitors: &[Rect]) -> bool {
    let (tx, ty) = (window.0 + window.2 as i32 / 2, window.1 + 16);
    monitors
        .iter()
        .any(|&(x, y, w, h)| tx >= x && tx < x + w as i32 && ty >= y && ty < y + h as i32)
}

/// window-state restores a saved position if any window corner touches a monitor, so after a monitor is
/// unplugged the title bar can end up off-screen, and a size saved on a larger monitor can exceed the
/// current one. Pull the window back onto the primary monitor in either case.
#[cfg(desktop)]
fn ensure_window_on_screen(window: &tauri::Window) {
    use tauri::{PhysicalPosition, PhysicalSize};
    if window.is_maximized().unwrap_or(false) {
        return;
    }
    let (Ok(pos), Ok(size), Ok(monitors)) =
        (window.outer_position(), window.outer_size(), window.available_monitors())
    else {
        return;
    };
    let rects: Vec<Rect> = monitors
        .iter()
        .map(|m| (m.position().x, m.position().y, m.size().width, m.size().height))
        .collect();
    let Some(target) = window.primary_monitor().ok().flatten().or_else(|| monitors.into_iter().next()) else {
        return;
    };
    let (mp, ms) = (*target.position(), *target.size());
    let too_big = size.width > ms.width || size.height > ms.height;
    if !too_big && title_bar_visible((pos.x, pos.y, size.width, size.height), &rects) {
        return;
    }

    log::info!("main window was off-screen or larger than the monitor; recentering");
    let (w, h) = if too_big {
        (size.width.min(ms.width * 9 / 10), size.height.min(ms.height * 9 / 10))
    } else {
        (size.width, size.height)
    };
    let _ = window.set_size(PhysicalSize::new(w, h));
    let _ = window.set_position(PhysicalPosition::new(
        mp.x + (ms.width.saturating_sub(w) / 2) as i32,
        mp.y + (ms.height.saturating_sub(h) / 2) as i32,
    ));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // Must be the first plugin: a second launch exits here and focuses the running window instead,
    // so two instances never race on the shared venv, settings file, or stem output folders.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        use tauri::Manager;
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }));

    // Remembers window size/position/maximized state across launches.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_window_state::Builder::default().build());

    builder
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_fs::init())
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
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(external_navigation_plugin())
        .invoke_handler(tauri::generate_handler![
            greet,
            run_ytdlp,
            get_tool_versions,
            update_ytdlp,
            list_ffmpeg_versions,
            install_ffmpeg,
            trim_audio,
            get_download_dir,
            open_download_folder,
            set_download_dir,
            set_filename_template,
            get_settings,
            save_settings,
            get_storage_dirs,
            open_storage_folder,
            open_path,
            list_storage_files,
            delete_storage_file,
            get_audio_cover,
            setup_dependencies,
            get_video_info,
            get_playlist_info,
            cancel_download,
            setup_stem_extractor,
            reset_stem_extractor,
            run_stem_extractor,
            cancel_stem_extractor,
            get_installed_models,
            download_ai_model,
            delete_ai_model,
            import_custom_model,
            open_models_directory,
            analyze_and_rename_audio,
            convert_audio_to_midi,
            check_midi_exists
        ])
        .on_page_load(|webview, payload| {
            if webview.label() == "main" && matches!(payload.event(), PageLoadEvent::Finished) {
                log::info!("main webview finished loading");
                #[cfg(desktop)]
                ensure_window_on_screen(&webview.window());
                let _ = webview.window().show();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::title_bar_visible;

    const PRIMARY: (i32, i32, u32, u32) = (0, 0, 1920, 1080);

    #[test]
    fn window_on_primary_is_visible() {
        assert!(title_bar_visible((100, 100, 1024, 600), &[PRIMARY]));
    }

    #[test]
    fn window_left_on_unplugged_right_monitor_is_not_visible() {
        // Only the bottom-left corner pokes onto the primary monitor; the plugin would restore this.
        assert!(!title_bar_visible((1900, -500, 1024, 600), &[PRIMARY]));
        assert!(!title_bar_visible((2200, 100, 1024, 600), &[PRIMARY]));
    }

    #[test]
    fn window_on_monitor_left_of_primary_is_visible_when_attached() {
        let left = (-2560, 0, 2560, 1440);
        assert!(title_bar_visible((-2000, 100, 1024, 600), &[PRIMARY, left]));
        assert!(!title_bar_visible((-2000, 100, 1024, 600), &[PRIMARY]));
    }
}
